import AVFoundation

/// Records the webcam to its own file on the shared host clock.
final class CameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  private let deviceId: String
  private let url: URL
  private let clock: (Double) -> Double?
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "camera.samples")
  private var writer: VideoTrackWriter?
  private(set) var width = 0
  private(set) var height = 0
  var firstTime: Double? { writer?.firstTime }

  // Cameras need a moment after `startRunning` and hand out a few black frames while the sensor
  // settles. The recorder starts the camera first, waits for it to warm up, then starts the screen
  // and only then lets camera frames into the file, so the camera track starts with the screen.
  private let gate = NSLock()
  private var warm = false
  private var writing = false
  private var framesSeen = 0
  /// Frames after which the camera counts as warm even if the picture stays dark (a dark room).
  private let maxWarmupFrames = 45

  private let maxHeight: Int

  init(deviceId: String, url: URL, maxHeight: Int, clock: @escaping (Double) -> Double?) {
    self.deviceId = deviceId
    self.url = url
    self.maxHeight = maxHeight
    self.clock = clock
  }

  func start() throws {
    guard let device = AVCaptureDevice(uniqueID: deviceId) ?? Listing.cameras().first(where: { $0.localizedName == deviceId })
    else { throw RecorderError.message("camera not found") }
    session.beginConfiguration()
    let presets: [(Int, AVCaptureSession.Preset)] = [(2160, .hd4K3840x2160), (1080, .hd1920x1080), (720, .hd1280x720)]
    if let p = presets.first(where: { $0.0 <= maxHeight && session.canSetSessionPreset($0.1) }) { session.sessionPreset = p.1 }
    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else { throw RecorderError.message("cannot add camera input") }
    session.addInput(input)
    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: queue)
    guard session.canAddOutput(output) else { throw RecorderError.message("cannot add camera output") }
    session.addOutput(output)
    session.commitConfiguration()
    session.startRunning()
  }

  var isWarm: Bool {
    gate.lock(); defer { gate.unlock() }
    return warm
  }

  /// Returns once the camera delivers real frames, or after `timeout` seconds.
  func waitUntilWarm(timeout: Double) async {
    let deadline = HostClock.now() + timeout
    while !isWarm && HostClock.now() < deadline {
      try? await Task.sleep(nanoseconds: 15_000_000)
    }
  }

  /// Lets frames into the file; call right after the screen capture has started.
  func beginWriting() {
    gate.lock(); writing = true; gate.unlock()
  }

  /// Mean luma of a sparse grid over the Y plane (video range, so black is about 16).
  private static func meanLuma(_ pixels: CVPixelBuffer) -> Double {
    guard CVPixelBufferIsPlanar(pixels), CVPixelBufferLockBaseAddress(pixels, .readOnly) == kCVReturnSuccess else { return 255 }
    defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddressOfPlane(pixels, 0) else { return 255 }
    let w = CVPixelBufferGetWidthOfPlane(pixels, 0), h = CVPixelBufferGetHeightOfPlane(pixels, 0)
    let row = CVPixelBufferGetBytesPerRowOfPlane(pixels, 0)
    let y = base.assumingMemoryBound(to: UInt8.self)
    var sum = 0, n = 0
    for gy in 1..<12 {
      for gx in 1..<16 {
        sum += Int(y[(gy * h / 12) * row + gx * w / 16])
        n += 1
      }
    }
    return Double(sum) / Double(max(1, n))
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sb: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let pixels = CMSampleBufferGetImageBuffer(sb) else { return }
    gate.lock()
    if !warm {
      framesSeen += 1
      if framesSeen >= maxWarmupFrames || Self.meanLuma(pixels) > 24 { warm = true }
    }
    let accept = warm && writing
    gate.unlock()
    guard accept else { return }
    var pts = CMSampleBufferGetPresentationTimeStamp(sb)
    if let sync = session.synchronizationClock {
      pts = CMSyncConvertTime(pts, from: sync, to: CMClockGetHostTimeClock())
    }
    guard let t = clock(pts.seconds) else { return }
    if writer == nil {
      width = CVPixelBufferGetWidth(pixels) & ~1
      height = CVPixelBufferGetHeight(pixels) & ~1
      writer = try? VideoTrackWriter(url: url, width: width, height: height, fps: 30, bitrate: height > 1200 ? 24_000_000 : 10_000_000)
    }
    writer?.append(pixels, at: t)
  }

  func stop() {
    session.stopRunning()
  }

  func finish() async {
    await queue.asyncAwait {}
    await writer?.finish(endTime: writer?.lastTime ?? 0)
  }
}

/// Mirrors an iPhone / iPad screen (and its audio) connected over USB.
final class DeviceCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
  private let deviceId: String
  private let dir: URL
  private let fps: Int
  private let clock: (Double) -> Double?
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "device.samples")
  private var videoWriter: VideoTrackWriter?
  private let audioWriter: AudioTrackWriter
  private var videoOutput: AVCaptureVideoDataOutput?
  private(set) var width = 0
  private(set) var height = 0
  var firstVideoTime: Double? { videoWriter?.firstTime }
  var firstAudioTime: Double? { audioWriter.firstTime }

  init(deviceId: String, dir: URL, fps: Int, clock: @escaping (Double) -> Double?) {
    self.deviceId = deviceId
    self.dir = dir
    self.fps = fps
    self.clock = clock
    self.audioWriter = AudioTrackWriter(url: dir.appendingPathComponent("system.m4a"))
  }

  func start() throws {
    guard let device = AVCaptureDevice(uniqueID: deviceId) else { throw RecorderError.message("device not found") }
    session.beginConfiguration()
    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else { throw RecorderError.message("cannot add device input") }
    session.addInput(input)
    let v = AVCaptureVideoDataOutput()
    v.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
    v.setSampleBufferDelegate(self, queue: queue)
    if session.canAddOutput(v) { session.addOutput(v) }
    videoOutput = v
    let a = AVCaptureAudioDataOutput()
    a.setSampleBufferDelegate(self, queue: queue)
    if session.canAddOutput(a) { session.addOutput(a) }
    session.commitConfiguration()
    session.startRunning()
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sb: CMSampleBuffer, from connection: AVCaptureConnection) {
    var pts = CMSampleBufferGetPresentationTimeStamp(sb)
    if let sync = session.synchronizationClock {
      pts = CMSyncConvertTime(pts, from: sync, to: CMClockGetHostTimeClock())
    }
    guard let t = clock(pts.seconds) else { return }
    if output === videoOutput {
      guard let pixels = CMSampleBufferGetImageBuffer(sb) else { return }
      if videoWriter == nil {
        width = CVPixelBufferGetWidth(pixels) & ~1
        height = CVPixelBufferGetHeight(pixels) & ~1
        videoWriter = try? VideoTrackWriter(url: dir.appendingPathComponent("screen.mp4"), width: width, height: height, fps: fps)
        Output.event("firstFrame", [:])
      }
      videoWriter?.append(pixels, at: t)
    } else if videoWriter != nil {
      audioWriter.append(sb, at: t)
    }
  }

  func stopSessions() {
    session.stopRunning()
  }

  func finish(endTime: Double) async {
    await queue.asyncAwait {}
    await videoWriter?.finish(endTime: endTime)
    await audioWriter.finish()
  }
}

extension DispatchQueue {
  /// Waits until previously queued sample callbacks have drained.
  func asyncAwait(_ work: @escaping () -> Void) async {
    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
      self.async {
        work()
        c.resume()
      }
    }
  }
}
