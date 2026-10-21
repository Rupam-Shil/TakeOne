import AppKit
import AVFoundation
import ScreenCaptureKit

struct RecordConfig: Decodable {
  struct Rect: Decodable { var x: Double; var y: Double; var width: Double; var height: Double }
  struct Source: Decodable {
    var type: String  // display | window | area | device
    var displayId: UInt32?
    var windowId: UInt32?
    var rect: Rect?  // area: display-local points
    var deviceId: String?
  }
  var outputDir: String
  var source: Source
  var fps: Int?
  var microphoneId: String?
  var cameraId: String?
  var captureSystemAudio: Bool?
  /// Bundle ids whose audio to record; empty/nil records every app.
  var systemAudioApps: [String]?
  var hideDesktopIcons: Bool?
  var excludePids: [Int32]?
  var excludeWindowIds: [UInt32]?
  var keystrokes: String?  // off | shortcuts | all
  var showCursor: Bool?
  var cameraMaxHeight: Int?
  /// Warm up the camera, then wait for a "go" line on stdin before capturing (set during the countdown).
  var waitForGo: Bool?
}

/// Coordinates every capture track against one pause-aware clock.
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
  let config: RecordConfig
  let dir: URL
  let fps: Int
  private var stream: SCStream?
  /// Separate audio-only stream, used when the audio filter differs from the video filter
  /// (window recordings, or "only these apps").
  private var audioStream: SCStream?
  private var screenWriter: VideoTrackWriter?
  private var systemWriter: AudioTrackWriter?
  private var micWriter: AudioTrackWriter?
  private var camera: CameraCapture?
  private var device: DeviceCapture?
  private var input: InputMonitor?
  private let queue = DispatchQueue(label: "recorder.samples")
  private let stateLock = NSLock()
  private var pausedTotal = 0.0
  private var pauseStartedAt: Double?
  private var pauses: [[Double]] = []
  private var origin: Double?  // pause-adjusted time of the first screen frame
  private var stopped = false
  private var captureRect = CGRect.zero  // global points
  private var scale = 2.0
  private var videoSize = CGSize.zero
  private var startedAtWallClock = Date()
  private var displayId: UInt32?

  init(config: RecordConfig) {
    self.config = config
    self.dir = URL(fileURLWithPath: config.outputDir)
    self.fps = max(10, min(config.fps ?? 60, 120))
    super.init()
  }

  /// Pause-adjusted host time, or nil while paused / after stop.
  func adjustedNow() -> Double? {
    stateLock.lock(); defer { stateLock.unlock() }
    if pauseStartedAt != nil || stopped { return nil }
    return HostClock.now() - pausedTotal
  }

  private func adjusted(_ hostTime: Double) -> Double? {
    stateLock.lock(); defer { stateLock.unlock() }
    if stopped { return nil }
    if let p = pauseStartedAt, hostTime >= p { return nil }
    return hostTime - pausedTotal
  }

  /// Starts the camera and waits until it delivers real frames. Safe to call more than once.
  func prepare() async {
    guard camera == nil, let camId = config.cameraId, !camId.isEmpty else { return }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let cam = CameraCapture(deviceId: camId, url: dir.appendingPathComponent("camera.mp4"), maxHeight: config.cameraMaxHeight ?? 1080) { [weak self] t in
      self?.adjusted(t)
    }
    do { try cam.start(); camera = cam } catch { Output.log("camera failed: \(error)"); return }
    let t0 = HostClock.now()
    await cam.waitUntilWarm(timeout: 3)
    Output.log(String(format: "camera warm after %.2fs", HostClock.now() - t0))
  }

  func start() async throws {
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    // The camera goes first so its track starts with the screen instead of ~1.5 s late.
    await prepare()
    startedAtWallClock = Date()
    var trackedWindow: CGWindowID?

    if config.source.type == "device" {
      guard let id = config.source.deviceId else { throw RecorderError.message("missing deviceId") }
      Listing.enableScreenCaptureDevices()
      try await Task.sleep(nanoseconds: 600_000_000)
      let dev = DeviceCapture(deviceId: id, dir: dir, fps: fps) { [weak self] t in self?.adjusted(t) }
      try dev.start()
      device = dev
    } else {
      trackedWindow = try await startScreenStream()
    }

    // Screen recordings open the camera gate on their first frame (see the stream output); devices here.
    if config.source.type == "device" { camera?.beginWriting() }

    if config.source.type != "device" {
      let monitor = InputMonitor(
        keyMode: InputMonitor.KeyMode(rawValue: config.keystrokes ?? "shortcuts") ?? .shortcuts,
        cursorDir: dir.appendingPathComponent("cursors"),
        trackedWindowId: trackedWindow,
        clock: { [weak self] in self?.adjustedNow() })
      await MainActor.run { monitor.start() }
      input = monitor
    }
    startCheckpoints()
    Output.event("started", [
      "captureRect": Listing.rectJSON(captureRect), "scale": scale,
      "width": videoSize.width, "height": videoSize.height,
    ])
  }

  private func startScreenStream() async throws -> CGWindowID? {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    let excludePids = Set(config.excludePids ?? [])
    let excludeIds = Set(config.excludeWindowIds ?? [])
    let streamConfig = SCStreamConfiguration()
    var filter: SCContentFilter
    var trackedWindow: CGWindowID?

    switch config.source.type {
    case "window":
      guard let wid = config.source.windowId,
            let window = content.windows.first(where: { $0.windowID == wid }) else {
        throw RecorderError.message("window not found")
      }
      filter = SCContentFilter(desktopIndependentWindow: window)
      captureRect = window.frame
      let screenForWindow = content.displays.first(where: { $0.frame.intersects(window.frame) })
      displayId = screenForWindow?.displayID
      scale = Listing.scaleFactor(forDisplay: displayId ?? CGMainDisplayID())
      trackedWindow = wid
      streamConfig.scalesToFit = true
      streamConfig.preservesAspectRatio = true
    default:
      let wanted = config.source.displayId ?? CGMainDisplayID()
      guard let display = content.displays.first(where: { $0.displayID == wanted }) ?? content.displays.first else {
        throw RecorderError.message("no display")
      }
      displayId = display.displayID
      scale = Listing.scaleFactor(forDisplay: display.displayID)
      var excluded = content.windows.filter { w in
        if excludeIds.contains(w.windowID) { return true }
        if let app = w.owningApplication, excludePids.contains(app.processID) { return true }
        return false
      }
      if config.hideDesktopIcons == true {
        let iconLevel = Int(CGWindowLevelForKey(.desktopIconWindow))
        excluded += content.windows.filter {
          $0.owningApplication?.bundleIdentifier == "com.apple.finder" && $0.windowLayer == iconLevel
        }
      }
      filter = SCContentFilter(display: display, excludingWindows: excluded)
      captureRect = display.frame
      if config.source.type == "area", let r = config.source.rect {
        let local = CGRect(x: r.x, y: r.y, width: r.width, height: r.height)
          .intersection(CGRect(origin: .zero, size: display.frame.size))
        streamConfig.sourceRect = local
        captureRect = local.offsetBy(dx: display.frame.origin.x, dy: display.frame.origin.y)
      }
    }

    // Encoders want even dimensions.
    let w = Int((captureRect.width * scale).rounded()) & ~1
    let h = Int((captureRect.height * scale).rounded()) & ~1
    videoSize = CGSize(width: w, height: h)
    streamConfig.width = w
    streamConfig.height = h
    streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
    streamConfig.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    streamConfig.colorSpaceName = CGColorSpace.sRGB
    streamConfig.showsCursor = config.showCursor ?? false
    streamConfig.showMouseClicks = false
    streamConfig.queueDepth = 8
    let selectedApps = Set(config.systemAudioApps ?? [])
    var separateAudio: SCContentFilter?
    if config.captureSystemAudio ?? true {
      systemWriter = AudioTrackWriter(url: dir.appendingPathComponent("system.m4a"))
      if config.source.type == "window" || !selectedApps.isEmpty {
        // A window filter only hears its own app, so audio gets its own display-wide stream.
        guard let display = content.displays.first(where: { $0.displayID == displayId }) ?? content.displays.first else {
          throw RecorderError.message("no display")
        }
        if selectedApps.isEmpty {
          separateAudio = SCContentFilter(display: display, excludingWindows: [])
        } else {
          let apps = content.applications.filter { selectedApps.contains($0.bundleIdentifier) }
          if apps.isEmpty { Output.log("none of the selected audio apps are running; system audio will be silent") }
          separateAudio = SCContentFilter(display: display, including: apps, exceptingWindows: [])
        }
      } else {
        streamConfig.capturesAudio = true
        streamConfig.excludesCurrentProcessAudio = true
        streamConfig.sampleRate = 48_000
        streamConfig.channelCount = 2
      }
    }
    if let mic = config.microphoneId, !mic.isEmpty {
      streamConfig.captureMicrophone = true
      streamConfig.microphoneCaptureDeviceID = mic
      micWriter = AudioTrackWriter(url: dir.appendingPathComponent("mic.m4a"))
    }

    screenWriter = try VideoTrackWriter(url: dir.appendingPathComponent("screen.mp4"), width: w, height: h, fps: fps)
    let s = SCStream(filter: filter, configuration: streamConfig, delegate: self)
    try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
    if systemWriter != nil && separateAudio == nil { try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue) }
    if micWriter != nil { try s.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue) }
    try await s.startCapture()
    stream = s

    if let separateAudio {
      let audioConfig = SCStreamConfiguration()
      audioConfig.capturesAudio = true
      audioConfig.excludesCurrentProcessAudio = true
      audioConfig.sampleRate = 48_000
      audioConfig.channelCount = 2
      // The video side of this stream is never delivered; keep it as cheap as possible.
      audioConfig.width = 2
      audioConfig.height = 2
      audioConfig.minimumFrameInterval = CMTime(value: 1, timescale: 1)
      audioConfig.showsCursor = false
      audioConfig.queueDepth = 3
      let a = SCStream(filter: separateAudio, configuration: audioConfig, delegate: self)
      try a.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
      do { try await a.startCapture(); audioStream = a } catch { Output.log("system audio stream failed: \(error)") }
    }
    return trackedWindow
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard sb.isValid else { return }
    let pts = CMSampleBufferGetPresentationTimeStamp(sb).seconds
    guard let t = adjusted(pts) else { return }
    switch type {
    case .screen:
      guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false)
              as? [[SCStreamFrameInfo: Any]],
            let raw = attachments.first?[.status] as? Int,
            SCFrameStatus(rawValue: raw) == .complete,
            let pixels = CMSampleBufferGetImageBuffer(sb) else { return }
      if origin == nil {
        origin = t
        camera?.beginWriting()
        Output.event("firstFrame", [:])
      }
      screenWriter?.append(pixels, at: t)
    case .audio:
      guard origin != nil else { return }
      systemWriter?.append(sb, at: t)
    case .microphone:
      guard origin != nil else { return }
      micWriter?.append(sb, at: t)
    @unknown default:
      break
    }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    Output.log("stream stopped: \(error.localizedDescription)")
    // Losing only the system-audio stream isn't worth abandoning the take.
    if stream === audioStream { return }
    Output.event("streamError", ["message": error.localizedDescription])
  }

  func addMarker() {
    input?.addMarker()
    Output.event("marker")
  }

  /// Periodically persists input events and provisional metadata so a crash loses little.
  private var checkpointTimer: DispatchSourceTimer?
  private func startCheckpoints() {
    let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
    timer.schedule(deadline: .now() + 5, repeating: 5)
    timer.setEventHandler { [weak self] in self?.checkpoint() }
    timer.resume()
    checkpointTimer = timer
  }

  private func checkpoint() {
    guard let o = origin ?? device?.firstVideoTime, let now = adjustedNow() else { return }
    let partial: [String: Any] = [
      "version": 1, "partial": true,
      "createdAt": ISO8601DateFormatter().string(from: startedAtWallClock),
      "source": ["type": config.source.type, "displayId": displayId.map { $0 as Any } ?? NSNull(), "windowId": NSNull(), "deviceId": NSNull()],
      "fps": fps, "scale": scale, "captureRect": Listing.rectJSON(captureRect),
      "videoSize": ["width": videoSize.width, "height": videoSize.height],
      "duration": now - o, "pauses": [],
      "tracks": [
        "screen": ["file": "screen.mp4", "offset": 0],
        "system": systemWriter?.firstTime.map { ["file": "system.m4a", "offset": $0 - o] as Any } ?? NSNull(),
        "mic": micWriter?.firstTime.map { ["file": "mic.m4a", "offset": $0 - o] as Any } ?? NSNull(),
        "camera": camera?.firstTime.map { ["file": "camera.mp4", "offset": $0 - o] as Any } ?? NSNull(),
      ],
      "frames": screenWriter?.frameCount ?? 0,
    ]
    try? Output.writeJSON(partial, to: dir.appendingPathComponent("meta.partial.json"))
    if let input { try? Output.writeJSON(input.export(origin: o), to: dir.appendingPathComponent("events.json")) }
  }

  func pause() {
    stateLock.lock()
    if pauseStartedAt == nil && !stopped { pauseStartedAt = HostClock.now() }
    stateLock.unlock()
    Output.event("paused")
  }

  func resume() {
    stateLock.lock()
    if let p = pauseStartedAt {
      let now = HostClock.now()
      pauses.append([p - pausedTotal, now - p])
      pausedTotal += now - p
      pauseStartedAt = nil
    }
    stateLock.unlock()
    Output.event("resumed")
  }

  /// Freezes the clock and returns the pause-adjusted end time.
  private func markStopped() -> Double {
    stateLock.lock(); defer { stateLock.unlock() }
    let endHost = pauseStartedAt ?? HostClock.now()
    stopped = true
    return endHost - pausedTotal
  }

  func stop(cancel: Bool) async {
    let end = markStopped()
    checkpointTimer?.cancel()

    if let stream { try? await stream.stopCapture() }
    if let audioStream { try? await audioStream.stopCapture() }
    await MainActor.run { input?.stop() }
    camera?.stop()
    device?.stopSessions()

    let screenOrigin = origin ?? device?.firstVideoTime
    await screenWriter?.finish(endTime: end)
    await systemWriter?.finish()
    await micWriter?.finish()
    await camera?.finish()
    await device?.finish(endTime: end)

    if cancel {
      try? FileManager.default.removeItem(at: dir)
      Output.event("cancelled")
      return
    }
    guard let o = screenOrigin else {
      Output.event("error", ["message": "No frames were captured. Check Screen Recording permission."])
      return
    }

    func trackInfo(_ file: String, first: Double?) -> Any {
      guard let first, FileManager.default.fileExists(atPath: dir.appendingPathComponent(file).path) else {
        return NSNull()
      }
      return ["file": file, "offset": (first - o).rounded(toPlaces: 4)]
    }

    var tracks: [String: Any] = [
      "screen": device == nil ? trackInfo("screen.mp4", first: screenWriter?.firstTime)
        : trackInfo("screen.mp4", first: device?.firstVideoTime),
      "system": device == nil ? trackInfo("system.m4a", first: systemWriter?.firstTime)
        : trackInfo("system.m4a", first: device?.firstAudioTime),
      "mic": trackInfo("mic.m4a", first: micWriter?.firstTime),
      "camera": trackInfo("camera.mp4", first: camera?.firstTime),
    ]
    if let cam = camera, cam.width > 0 { tracks["cameraSize"] = ["width": cam.width, "height": cam.height] }
    let size = device.map { CGSize(width: $0.width, height: $0.height) } ?? videoSize

    let meta: [String: Any] = [
      "version": 1,
      "createdAt": ISO8601DateFormatter().string(from: startedAtWallClock),
      "source": [
        "type": config.source.type,
        "displayId": displayId.map { $0 as Any } ?? NSNull(),
        "windowId": config.source.windowId.map { $0 as Any } ?? NSNull(),
        "deviceId": config.source.deviceId.map { $0 as Any } ?? NSNull(),
      ],
      "fps": fps,
      "scale": scale,
      "captureRect": Listing.rectJSON(captureRect),
      "videoSize": ["width": size.width, "height": size.height],
      "duration": (end - o).rounded(toPlaces: 4),
      "pauses": pauses.map { ["at": ($0[0] - o).rounded(toPlaces: 4), "duration": $0[1].rounded(toPlaces: 4)] },
      "tracks": tracks,
      "frames": screenWriter?.frameCount ?? 0,
    ]
    do {
      try Output.writeJSON(meta, to: dir.appendingPathComponent("meta.json"))
      if let input { try Output.writeJSON(input.export(origin: o), to: dir.appendingPathComponent("events.json")) }
      try? FileManager.default.removeItem(at: dir.appendingPathComponent("meta.partial.json"))
    } catch {
      Output.event("error", ["message": "failed to write metadata: \(error.localizedDescription)"])
      return
    }
    Output.event("finished", ["dir": dir.path, "duration": end - o])
  }
}

enum RecorderError: Error, CustomStringConvertible {
  case message(String)
  var description: String { if case .message(let m) = self { return m }; return "error" }
}
