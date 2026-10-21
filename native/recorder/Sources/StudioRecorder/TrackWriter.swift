import AVFoundation
import CoreMedia
import VideoToolbox

/// Writes one video track. Each file starts at its own first frame (media time zero) and the
/// recorder stores that frame's offset from the session origin in meta.json, so no player has to
/// honour MP4 edit lists to stay in sync.
final class VideoTrackWriter {
  let url: URL
  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  private let adaptor: AVAssetWriterInputPixelBufferAdaptor
  private(set) var firstTime: Double?
  private(set) var lastTime: Double?
  private var lastBuffer: CVPixelBuffer?
  let width: Int
  let height: Int
  private(set) var frameCount = 0

  init(url: URL, width: Int, height: Int, fps: Int, bitrate: Int? = nil) throws {
    self.url = url
    self.width = width
    self.height = height
    try? FileManager.default.removeItem(at: url)
    writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    // Fragmented writing keeps everything up to the last couple of seconds playable after a crash.
    writer.movieFragmentInterval = CMTime(seconds: 2, preferredTimescale: 600)
    // H.264 tops out around 4096px wide in VideoToolbox; fall back to HEVC for 5K/6K panels.
    let useHEVC = width > 4096 || height > 4096
    let rate = bitrate ?? min(max(width * height * fps / 10, 6_000_000), 90_000_000)
    var compression: [String: Any] = [
      AVVideoAverageBitRateKey: rate,
      AVVideoExpectedSourceFrameRateKey: fps,
      // Dense keyframes keep editor scrubbing fast.
      AVVideoMaxKeyFrameIntervalKey: fps,
      AVVideoAllowFrameReorderingKey: false,
    ]
    if !useHEVC { compression[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel }
    let settings: [String: Any] = [
      AVVideoCodecKey: useHEVC ? AVVideoCodecType.hevc : AVVideoCodecType.h264,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height,
      AVVideoCompressionPropertiesKey: compression,
      AVVideoColorPropertiesKey: [
        AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
        AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
      ],
    ]
    input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = true
    adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
    writer.add(input)
  }

  /// `time` is already pause-adjusted host time.
  func append(_ buffer: CVPixelBuffer, at time: Double) {
    if firstTime == nil {
      guard writer.startWriting() else {
        Output.log("video writer failed to start: \(String(describing: writer.error))")
        return
      }
      writer.startSession(atSourceTime: CMTime(seconds: time, preferredTimescale: 600_000))
      firstTime = time
    }
    if let last = lastTime, time <= last { return }
    guard input.isReadyForMoreMediaData else { return }
    if adaptor.append(buffer, withPresentationTime: CMTime(seconds: time, preferredTimescale: 600_000)) {
      lastTime = time
      lastBuffer = buffer
      frameCount += 1
    }
  }

  /// Holds the last frame until `endTime` so a static screen doesn't truncate the track.
  func finish(endTime: Double) async {
    guard firstTime != nil else {
      if writer.status == .writing { writer.cancelWriting() }
      return
    }
    if let buffer = lastBuffer, let last = lastTime, endTime - last > 0.001 {
      // A failed writer never becomes ready again; don't spin forever on it.
      while !input.isReadyForMoreMediaData && writer.status == .writing { try? await Task.sleep(nanoseconds: 2_000_000) }
      adaptor.append(buffer, withPresentationTime: CMTime(seconds: endTime, preferredTimescale: 600_000))
      lastTime = endTime
    }
    lastBuffer = nil
    input.markAsFinished()
    writer.endSession(atSourceTime: CMTime(seconds: lastTime ?? endTime, preferredTimescale: 600_000))
    await writer.finishWriting()
    if writer.status == .failed { Output.log("video writer failed: \(String(describing: writer.error))") }
  }
}

/// AAC audio track created lazily from the first buffer's format so mono mics and stereo system
/// audio both encode without channel-mapping surprises.
final class AudioTrackWriter {
  let url: URL
  private var writer: AVAssetWriter?
  private var input: AVAssetWriterInput?
  private(set) var firstTime: Double?
  private(set) var lastEnd: Double?
  private(set) var channels = 0
  private(set) var sampleRate = 0.0

  init(url: URL) {
    self.url = url
    try? FileManager.default.removeItem(at: url)
  }

  private func setup(from sample: CMSampleBuffer, at time: Double) -> Bool {
    guard let fmt = CMSampleBufferGetFormatDescription(sample),
          let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fmt)?.pointee else { return false }
    channels = Int(min(asbd.mChannelsPerFrame, 2))
    sampleRate = asbd.mSampleRate
    do {
      let w = try AVAssetWriter(outputURL: url, fileType: .m4a)
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: asbd.mSampleRate,
        AVNumberOfChannelsKey: channels,
        AVEncoderBitRateKey: channels == 1 ? 128_000 : 192_000,
      ]
      let i = AVAssetWriterInput(mediaType: .audio, outputSettings: settings, sourceFormatHint: fmt)
      i.expectsMediaDataInRealTime = true
      w.add(i)
      guard w.startWriting() else { return false }
      w.startSession(atSourceTime: CMTime(seconds: time, preferredTimescale: 600_000))
      writer = w
      input = i
      firstTime = time
      return true
    } catch {
      Output.log("audio writer error: \(error)")
      return false
    }
  }

  func append(_ sample: CMSampleBuffer, at time: Double) {
    if writer == nil && !setup(from: sample, at: time) { return }
    guard let input, input.isReadyForMoreMediaData else { return }
    // Buffers still in flight across a pause/resume can land before the last one; AAC needs monotonic times.
    if let last = lastEnd, time < last - 0.0005 { return }
    var timing = CMSampleTimingInfo(
      duration: CMSampleBufferGetDuration(sample),
      presentationTimeStamp: CMTime(seconds: time, preferredTimescale: 600_000),
      decodeTimeStamp: .invalid)
    var retimed: CMSampleBuffer?
    CMSampleBufferCreateCopyWithNewTiming(
      allocator: kCFAllocatorDefault, sampleBuffer: sample, sampleTimingEntryCount: 1,
      sampleTimingArray: &timing, sampleBufferOut: &retimed)
    guard let retimed else { return }
    if input.append(retimed) {
      let dur = CMSampleBufferGetDuration(sample).seconds
      lastEnd = time + (dur.isFinite ? dur : 0)
    }
  }

  func finish() async {
    guard let writer, let input else { return }
    input.markAsFinished()
    if let end = lastEnd { writer.endSession(atSourceTime: CMTime(seconds: end, preferredTimescale: 600_000)) }
    await writer.finishWriting()
    if writer.status == .failed { Output.log("audio writer failed: \(String(describing: writer.error))") }
  }
}
