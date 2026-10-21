import AppKit
import AVFoundation
import CoreMediaIO
import ScreenCaptureKit
import IOKit.hid

enum Listing {
  /// iPhone / iPad screens only show up as capture devices once this CoreMediaIO flag is set.
  static func enableScreenCaptureDevices() {
    var prop = CMIOObjectPropertyAddress(
      mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
      mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
      mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
    var allow: UInt32 = 1
    CMIOObjectSetPropertyData(
      CMIOObjectID(kCMIOObjectSystemObject), &prop, 0, nil, UInt32(MemoryLayout<UInt32>.size), &allow)
  }

  static func cameras() -> [AVCaptureDevice] {
    AVCaptureDevice.DiscoverySession(
      deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera, .deskViewCamera],
      mediaType: .video, position: .unspecified
    ).devices
  }

  static func microphones() -> [AVCaptureDevice] {
    AVCaptureDevice.DiscoverySession(
      deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified
    ).devices
  }

  static func mobileDevices() -> [AVCaptureDevice] {
    AVCaptureDevice.DiscoverySession(
      deviceTypes: [.external], mediaType: .muxed, position: .unspecified
    ).devices
  }

  static func rectJSON(_ r: CGRect) -> [String: Any] {
    ["x": r.origin.x, "y": r.origin.y, "width": r.size.width, "height": r.size.height]
  }

  static func scaleFactor(forDisplay id: CGDirectDisplayID) -> Double {
    if let mode = CGDisplayCopyDisplayMode(id) {
      let points = Double(mode.width)
      if points > 0 { return Double(mode.pixelWidth) / points }
    }
    return 2
  }

  static func run(excludingPid: pid_t?, includeMobile: Bool) async {
    let t0 = Date()
    let trace = ProcessInfo.processInfo.environment["STUDIO_TRACE"] != nil
    func mark(_ label: String) { if trace { Output.log("\(label) +\(Int(Date().timeIntervalSince(t0) * 1000))ms") } }
    // Allowing iPhone/iPad screens through CoreMediaIO can take seconds, so it's opt-in.
    if includeMobile {
      enableScreenCaptureDevices()
      try? await Task.sleep(nanoseconds: 400_000_000)
      mark("cmio")
    }

    var displays: [[String: Any]] = []
    var windows: [[String: Any]] = []
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
      mark("shareable")
      let mainId = CGMainDisplayID()
      for d in content.displays {
        let name = NSScreen.screens.first(where: {
          ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == d.displayID
        })?.localizedName ?? "Display \(d.displayID)"
        displays.append([
          "id": d.displayID,
          "name": name,
          "frame": rectJSON(d.frame),
          "scale": scaleFactor(forDisplay: d.displayID),
          "isMain": d.displayID == mainId,
        ])
      }
      // ScreenCaptureKit doesn't report stacking order; CGWindowList does (front to back).
      var zOrder: [CGWindowID: Int] = [:]
      if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
        for (i, info) in list.enumerated() {
          if let n = info[kCGWindowNumber as String] as? CGWindowID { zOrder[n] = i }
        }
      }
      let ordered = content.windows.sorted { (zOrder[$0.windowID] ?? Int.max) < (zOrder[$1.windowID] ?? Int.max) }
      for w in ordered {
        guard w.windowLayer == 0, w.isOnScreen, w.frame.width >= 80, w.frame.height >= 60,
              let app = w.owningApplication else { continue }
        if let pid = excludingPid, app.processID == pid { continue }
        if app.bundleIdentifier == "com.apple.dock" || app.bundleIdentifier == "com.apple.WindowManager" { continue }
        windows.append([
          "id": w.windowID,
          "title": w.title ?? "",
          "appName": app.applicationName,
          "bundleId": app.bundleIdentifier,
          "pid": app.processID,
          "frame": rectJSON(w.frame),
        ])
      }
    } catch {
      Output.event("error", ["message": "Couldn't list screens and windows: \(error.localizedDescription)"])
      return
    }

    func deviceJSON(_ d: AVCaptureDevice) -> [String: Any] {
      ["id": d.uniqueID, "name": d.localizedName, "model": d.modelID]
    }

    mark("windows")
    let cams = cameras().map(deviceJSON)
    mark("cameras")
    let mics = microphones().map(deviceJSON)
    mark("mics")
    let mobile = includeMobile ? mobileDevices().map(deviceJSON) : []
    mark("mobile")
    Output.event("list", [
      "displays": displays,
      "windows": windows,
      "apps": runningApps(excludingPid: excludingPid),
      "cameras": cams,
      "microphones": mics,
      "mobileDevices": mobile,
    ])
  }
}

enum Permissions {
  static func status() -> [String: Any] {
    func av(_ t: AVMediaType) -> String {
      switch AVCaptureDevice.authorizationStatus(for: t) {
      case .authorized: return "granted"
      case .denied: return "denied"
      case .restricted: return "restricted"
      default: return "not-determined"
      }
    }
    let input: String
    switch IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) {
    case kIOHIDAccessTypeGranted: input = "granted"
    case kIOHIDAccessTypeDenied: input = "denied"
    default: input = "not-determined"
    }
    return [
      "screen": CGPreflightScreenCaptureAccess() ? "granted" : "denied",
      "accessibility": AXIsProcessTrusted() ? "granted" : "denied",
      "inputMonitoring": input,
      "camera": av(.video),
      "microphone": av(.audio),
    ]
  }

  static func request(_ kind: String) async {
    switch kind {
    case "screen": _ = CGRequestScreenCaptureAccess()
    case "accessibility":
      let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
      _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    case "inputMonitoring": _ = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
    case "camera": _ = await AVCaptureDevice.requestAccess(for: .video)
    case "microphone": _ = await AVCaptureDevice.requestAccess(for: .audio)
    default: break
    }
    Output.event("permissions", status())
  }
}
