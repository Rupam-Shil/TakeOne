import AppKit
import CoreGraphics
import CryptoKit
import Carbon

/// Records mouse movement, clicks, scrolls, keystrokes and the system cursor shape.
/// Positions are global display points with a top-left origin (CoreGraphics space).
final class InputMonitor {
  enum KeyMode: String { case off, shortcuts, all }

  private let clock: () -> Double?  // pause-adjusted host time, nil while paused
  private let keyMode: KeyMode
  private let cursorDir: URL
  private var tap: CFMachPort?
  private var runLoopSource: CFRunLoopSource?
  private var cursorTimer: Timer?
  private var windowTimer: Timer?
  private var pollTimer: Timer?
  private let trackedWindowId: CGWindowID?

  private let lock = NSLock()
  private var moves: [[Double]] = []
  private var clicks: [[String: Any]] = []
  private var scrolls: [[Double]] = []
  private var keys: [[String: Any]] = []
  private var cursorChanges: [[String: Any]] = []
  private var cursorImages: [String: [String: Any]] = [:]
  private var windowFrames: [[Double]] = []
  private var markers: [Double] = []
  private var lastCursorHash: String?
  private var lastWindowFrame: CGRect?
  private var lastPolledLocation: CGPoint?
  private var lastPolledButtons = 0
  private var knownCursorHashes: [String: String] = [:]
  private(set) var usingEventTap = false
  /// Host time of the last mouse event the tap delivered; a tap that never speaks is a tap without permission.
  private var lastTapMouseAt: Double = 0
  private var tapSilentLogged = false

  init(keyMode: KeyMode, cursorDir: URL, trackedWindowId: CGWindowID?, clock: @escaping () -> Double?) {
    self.keyMode = keyMode
    self.cursorDir = cursorDir
    self.trackedWindowId = trackedWindowId
    self.clock = clock
    try? FileManager.default.createDirectory(at: cursorDir, withIntermediateDirectories: true)
    let standard: [(String, NSCursor)] = [
      ("arrow", .arrow), ("ibeam", .iBeam), ("pointingHand", .pointingHand), ("openHand", .openHand),
      ("closedHand", .closedHand), ("crosshair", .crosshair), ("resizeLeftRight", .resizeLeftRight),
      ("resizeUpDown", .resizeUpDown), ("resizeLeft", .resizeLeft), ("resizeRight", .resizeRight),
      ("resizeUp", .resizeUp), ("resizeDown", .resizeDown), ("notAllowed", .operationNotAllowed),
      ("contextualMenu", .contextualMenu), ("dragCopy", .dragCopy), ("dragLink", .dragLink),
      ("ibeamVertical", .iBeamCursorForVerticalLayout), ("disappearingItem", .disappearingItem),
    ]
    for (name, cursor) in standard {
      if let h = Self.hash(cursor) { knownCursorHashes[h] = name }
    }
  }

  static func hash(_ cursor: NSCursor) -> String? {
    guard let tiff = cursor.image.tiffRepresentation else { return nil }
    let digest = SHA256.hash(data: tiff)
    return digest.prefix(8).map { String(format: "%02x", $0) }.joined()
  }

  func start() {
    var mask: CGEventMask = 0
    let mouseTypes: [CGEventType] = [
      .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
      .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp,
      .scrollWheel,
    ]
    for t in mouseTypes { mask |= CGEventMask(1) << t.rawValue }
    var fullMask = mask
    if keyMode != .off {
      fullMask |= CGEventMask(1) << CGEventType.keyDown.rawValue
      fullMask |= CGEventMask(1) << CGEventType.keyUp.rawValue
      fullMask |= CGEventMask(1) << CGEventType.flagsChanged.rawValue
    }
    let me = Unmanaged.passUnretained(self).toOpaque()
    let callback: CGEventTapCallBack = { _, type, event, refcon in
      if let refcon {
        Unmanaged<InputMonitor>.fromOpaque(refcon).takeUnretainedValue().handle(type: type, event: event)
      }
      return Unmanaged.passUnretained(event)
    }
    tap = CGEvent.tapCreate(
      tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly,
      eventsOfInterest: fullMask, callback: callback, userInfo: me)
    if tap == nil && fullMask != mask {
      Output.log("keyboard tap unavailable (Input Monitoring not granted); recording mouse only")
      tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly,
        eventsOfInterest: mask, callback: callback, userInfo: me)
    }
    if let tap {
      usingEventTap = true
      runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
      CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
      CGEvent.tapEnable(tap: tap, enable: true)
    } else {
      Output.log("event tap unavailable; polling mouse state")
    }
    // Always poll the pointer too. A listen-only tap can be created and still deliver nothing (a re-signed
    // helper whose Input Monitoring grant no longer matches), and NSEvent needs no permission at all.
    // The poller stays quiet while the tap is delivering, so nothing is recorded twice.
    pollTimer = Timer(timeInterval: 1.0 / 120.0, repeats: true) { [weak self] _ in self?.poll() }
    RunLoop.main.add(pollTimer!, forMode: .common)

    cursorTimer = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in self?.sampleCursor() }
    RunLoop.main.add(cursorTimer!, forMode: .common)
    if trackedWindowId != nil {
      windowTimer = Timer(timeInterval: 1.0 / 20.0, repeats: true) { [weak self] _ in self?.sampleWindow() }
      RunLoop.main.add(windowTimer!, forMode: .common)
    }
    recordCurrentPosition()
    sampleCursor()
    sampleWindow()
  }

  func stop() {
    if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
    if let runLoopSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes) }
    cursorTimer?.invalidate()
    windowTimer?.invalidate()
    pollTimer?.invalidate()
  }

  private func recordCurrentPosition() {
    guard let t = clock(), let loc = CGEvent(source: nil)?.location else { return }
    lock.lock(); moves.append([t, loc.x, loc.y]); lock.unlock()
  }

  private func poll() {
    guard let t = clock(), let loc = CGEvent(source: nil)?.location else { return }
    lock.lock()
    defer { lock.unlock() }
    let tapAlive = usingEventTap && HostClock.now() - lastTapMouseAt < 0.5
    if tapAlive {
      lastPolledLocation = loc
      lastPolledButtons = NSEvent.pressedMouseButtons
      return
    }
    if loc != lastPolledLocation {
      if usingEventTap && !tapSilentLogged {
        tapSilentLogged = true
        Output.log("event tap is silent (Input Monitoring / Accessibility not granted to this build); polling the pointer instead")
      }
      moves.append([t, loc.x, loc.y])
      lastPolledLocation = loc
    }
    let buttons = NSEvent.pressedMouseButtons
    for bit in 0..<3 {
      let was = lastPolledButtons & (1 << bit) != 0
      let isDown = buttons & (1 << bit) != 0
      if was != isDown {
        clicks.append(["t": t, "x": loc.x, "y": loc.y, "button": ["left", "right", "middle"][bit],
                       "type": isDown ? "down" : "up"])
      }
    }
    lastPolledButtons = buttons
  }

  private func handle(type: CGEventType, event: CGEvent) {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
      return
    }
    guard let base = clock() else { return }
    // Re-express the event timestamp on the pause-adjusted clock.
    let t = base - (HostClock.now() - HostClock.seconds(fromEventTimestamp: event.timestamp))
    let loc = event.location
    lock.lock()
    defer { lock.unlock() }
    switch type {
    case .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
      lastTapMouseAt = HostClock.now()
      moves.append([t, loc.x, loc.y])
    case .leftMouseDown, .rightMouseDown, .otherMouseDown, .leftMouseUp, .rightMouseUp, .otherMouseUp:
      let button: String = (type == .leftMouseDown || type == .leftMouseUp) ? "left"
        : (type == .rightMouseDown || type == .rightMouseUp) ? "right" : "middle"
      let isDown = type == .leftMouseDown || type == .rightMouseDown || type == .otherMouseDown
      lastTapMouseAt = HostClock.now()
      moves.append([t, loc.x, loc.y])
      clicks.append(["t": t, "x": loc.x, "y": loc.y, "button": button, "type": isDown ? "down" : "up",
                     "clickCount": event.getIntegerValueField(.mouseEventClickState)])
    case .scrollWheel:
      let dy = Double(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1))
      let dx = Double(event.getIntegerValueField(.scrollWheelEventPointDeltaAxis2))
      scrolls.append([t, loc.x, loc.y, dx, dy])
    case .keyDown, .keyUp, .flagsChanged:
      recordKey(type: type, event: event, t: t)
    default:
      break
    }
  }

  private func recordKey(type: CGEventType, event: CGEvent, t: Double) {
    let flags = event.flags
    var modifiers: [String] = []
    if flags.contains(.maskCommand) { modifiers.append("cmd") }
    if flags.contains(.maskShift) { modifiers.append("shift") }
    if flags.contains(.maskAlternate) { modifiers.append("alt") }
    if flags.contains(.maskControl) { modifiers.append("ctrl") }
    if flags.contains(.maskSecondaryFn) { modifiers.append("fn") }
    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    if type == .flagsChanged {
      keys.append(["t": t, "type": "modifiers", "modifiers": modifiers, "keyCode": keyCode])
      return
    }
    // ⌥ alone types characters on most layouts, so only ⌘/⌃ combos count as shortcuts.
    let isShortcut = modifiers.contains(where: { $0 == "cmd" || $0 == "ctrl" })
    // Password fields turn on secure input; never name keys typed there, whatever the mode.
    if IsSecureEventInputEnabled() {
      keys.append(["t": t, "type": type == .keyDown ? "down" : "up", "modifiers": [], "keyCode": -1, "secure": true])
      return
    }
    var record: [String: Any] = [
      "t": t, "type": type == .keyDown ? "down" : "up", "modifiers": modifiers, "keyCode": keyCode,
      "isRepeat": event.getIntegerValueField(.keyboardEventAutorepeat) != 0,
    ]
    // Without "all keys" we keep the timing of plain typing (for typing detection) but not the text.
    if keyMode == .all || isShortcut || Self.isSpecialKey(keyCode) {
      record["key"] = Self.keyName(event: event, keyCode: keyCode)
    }
    keys.append(record)
  }

  static func isSpecialKey(_ code: Int64) -> Bool {
    // Return, tab, space, delete, escape, arrows, paging keys and F1–F12.
    [36, 48, 49, 51, 53, 76, 117, 123, 124, 125, 126, 115, 119, 116, 121,
     122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111].contains(code)
  }

  static func keyName(event: CGEvent, keyCode: Int64) -> String {
    let named: [Int64: String] = [
      36: "return", 48: "tab", 49: "space", 51: "delete", 53: "escape", 76: "enter", 117: "forwardDelete",
      123: "left", 124: "right", 125: "down", 126: "up", 115: "home", 119: "end", 116: "pageUp", 121: "pageDown",
      122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9", 109: "F10",
      103: "F11", 111: "F12",
    ]
    if let n = named[keyCode] { return n }
    // Ask for the unmodified character so ⌘⇧K is reported as "k" rather than a control code.
    var length = 0
    var chars = [UniChar](repeating: 0, count: 4)
    if let copy = event.copy() {
      copy.flags = []
      copy.keyboardGetUnicodeString(maxStringLength: 4, actualStringLength: &length, unicodeString: &chars)
    }
    let s = String(utf16CodeUnits: chars, count: length)
    return s.isEmpty ? "key\(keyCode)" : s.lowercased()
  }

  private func sampleCursor() {
    guard let t = clock() else { return }
    guard let cursor = NSCursor.currentSystem, let h = Self.hash(cursor) else { return }
    if h == lastCursorHash { return }
    lastCursorHash = h
    lock.lock()
    if cursorImages[h] == nil {
      var info: [String: Any] = [
        "hotspotX": cursor.hotSpot.x, "hotspotY": cursor.hotSpot.y,
        "width": cursor.image.size.width, "height": cursor.image.size.height,
      ]
      if let known = knownCursorHashes[h] { info["type"] = known }
      if let png = Self.pngData(cursor.image) {
        let file = "\(h).png"
        try? png.write(to: cursorDir.appendingPathComponent(file))
        info["file"] = "cursors/\(file)"
      }
      cursorImages[h] = info
    }
    cursorChanges.append(["t": t, "id": h])
    lock.unlock()
  }

  static func pngData(_ image: NSImage) -> Data? {
    // Prefer the highest-resolution representation for crisp re-rendering when zoomed in.
    let best = image.representations.max(by: { $0.pixelsWide < $1.pixelsWide })
    if let bitmap = best as? NSBitmapImageRep { return bitmap.representation(using: .png, properties: [:]) }
    guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
    return rep.representation(using: .png, properties: [:])
  }

  private func sampleWindow() {
    guard let id = trackedWindowId, let t = clock() else { return }
    guard let info = (CGWindowListCopyWindowInfo([.optionIncludingWindow], id) as? [[String: Any]])?.first,
          let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
          let rect = CGRect(dictionaryRepresentation: boundsDict) else { return }
    if rect == lastWindowFrame { return }
    lastWindowFrame = rect
    lock.lock()
    windowFrames.append([t, rect.origin.x, rect.origin.y, rect.width, rect.height])
    lock.unlock()
  }

  func addMarker() {
    guard let t = clock() else { return }
    lock.lock(); markers.append(t); lock.unlock()
  }

  /// Serialises everything relative to `origin` (the first screen frame).
  func export(origin: Double) -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    func rel(_ t: Double) -> Double { (t - origin).rounded(toPlaces: 4) }
    return [
      "version": 1,
      "mouse": moves.map { [rel($0[0]), $0[1].rounded(toPlaces: 2), $0[2].rounded(toPlaces: 2)] },
      "clicks": clicks.map { var c = $0; c["t"] = rel(c["t"] as! Double); return c },
      "scrolls": scrolls.map { [rel($0[0]), $0[1], $0[2], $0[3], $0[4]] },
      "keys": keys.map { var k = $0; k["t"] = rel(k["t"] as! Double); return k },
      "cursors": cursorChanges.map { var c = $0; c["t"] = rel(c["t"] as! Double); return c },
      "cursorImages": cursorImages,
      "windowFrames": windowFrames.map { [rel($0[0]), $0[1], $0[2], $0[3], $0[4]] },
      "markers": markers.map(rel),
      "eventTap": usingEventTap,
      "mouseSource": tapSilentLogged || !usingEventTap ? "poll" : "tap",
    ]
  }
}

extension Double {
  func rounded(toPlaces p: Int) -> Double {
    let m = pow(10.0, Double(p))
    return (self * m).rounded() / m
  }
}
