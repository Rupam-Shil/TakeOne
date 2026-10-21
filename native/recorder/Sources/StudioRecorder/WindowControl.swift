import AppKit
import ApplicationServices

// Maps an accessibility element to its CGWindowID. Private, but stable since 10.x and what every
// window manager on macOS relies on.
@_silgen_name("_AXUIElementGetWindow")
private func _AXUIElementGetWindow(_ element: AXUIElement, _ identifier: UnsafeMutablePointer<CGWindowID>) -> AXError

/// Resizes other apps' windows before a recording (the "window size presets" feature).
enum WindowControl {
  struct Target {
    let element: AXUIElement
    let bounds: CGRect  // global points, top-left origin (CGWindow coordinates)
  }

  /// Finds the AX window for a CGWindowID, matching by id and falling back to its frame.
  static func find(windowId: CGWindowID) -> Target? {
    guard let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], windowId) as? [[String: Any]],
          let info = list.first,
          let pid = info[kCGWindowOwnerPID as String] as? pid_t,
          let dict = info[kCGWindowBounds as String] as? NSDictionary,
          let bounds = CGRect(dictionaryRepresentation: dict) else { return nil }
    let appElement = AXUIElementCreateApplication(pid)
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &value) == .success,
          let windows = value as? [AXUIElement] else { return nil }
    for w in windows {
      var id: CGWindowID = 0
      if _AXUIElementGetWindow(w, &id) == .success, id == windowId { return Target(element: w, bounds: bounds) }
    }
    for w in windows where frame(of: w).map({ abs($0.origin.x - bounds.origin.x) < 2 && abs($0.origin.y - bounds.origin.y) < 2 && abs($0.width - bounds.width) < 2 }) == true {
      return Target(element: w, bounds: bounds)
    }
    return nil
  }

  static func frame(of element: AXUIElement) -> CGRect? {
    var posRef: CFTypeRef?
    var sizeRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef) == .success,
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
          let posRef, let sizeRef else { return nil }
    var pos = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(posRef as! AXValue, .cgPoint, &pos), AXValueGetValue(sizeRef as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: pos, size: size)
  }

  /// The usable area (no menu bar / Dock) of the display containing `point`, in CGWindow coordinates.
  static func visibleArea(containing point: CGPoint) -> CGRect {
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    func flipped(_ r: NSRect) -> CGRect { CGRect(x: r.origin.x, y: primaryHeight - r.origin.y - r.height, width: r.width, height: r.height) }
    let screen = NSScreen.screens.first(where: { flipped($0.frame).contains(point) }) ?? NSScreen.main ?? NSScreen.screens[0]
    return flipped(screen.visibleFrame)
  }

  /// Resizes the window to `width`×`height` points (clamped to its display) and centres it there.
  static func resize(windowId: CGWindowID, width: Double, height: Double) {
    guard AXIsProcessTrusted() else { Output.fail("Accessibility access is needed to resize windows") }
    guard let target = find(windowId: windowId) else { Output.fail("That window can't be resized") }
    let area = visibleArea(containing: CGPoint(x: target.bounds.midX, y: target.bounds.midY))
    let w = max(150, min(width, area.width))
    let h = max(150, min(height, area.height))
    var origin = CGPoint(x: (area.midX - w / 2).rounded(), y: (area.midY - h / 2).rounded())
    var size = CGSize(width: w, height: h)
    guard let posValue = AXValueCreate(.cgPoint, &origin), let sizeValue = AXValueCreate(.cgSize, &size) else {
      Output.fail("Could not build the new window frame")
    }
    // Position → size → position: apps that constrain their size can shift when the size changes.
    AXUIElementSetAttributeValue(target.element, kAXPositionAttribute as CFString, posValue)
    let result = AXUIElementSetAttributeValue(target.element, kAXSizeAttribute as CFString, sizeValue)
    AXUIElementSetAttributeValue(target.element, kAXPositionAttribute as CFString, posValue)
    guard result == .success else { Output.fail("The app refused the new size") }
    // Give the app a moment to apply the change before reading it back.
    usleep(120_000)
    let actual = frame(of: target.element) ?? CGRect(origin: origin, size: size)
    Output.event("resized", ["frame": Listing.rectJSON(actual), "requested": ["width": w, "height": h]])
  }
}

extension Listing {
  /// Apps a user can pick for per-app system audio: regular, visible apps other than ourselves.
  static func runningApps(excludingPid: pid_t?) -> [[String: Any]] {
    NSWorkspace.shared.runningApplications
      .filter { $0.activationPolicy == .regular && $0.processIdentifier != excludingPid && $0.bundleIdentifier != nil }
      .sorted { ($0.localizedName ?? "").localizedCaseInsensitiveCompare($1.localizedName ?? "") == .orderedAscending }
      .map { ["bundleId": $0.bundleIdentifier ?? "", "name": $0.localizedName ?? $0.bundleIdentifier ?? "", "pid": $0.processIdentifier] }
  }
}
