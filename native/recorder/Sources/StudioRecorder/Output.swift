import Foundation
import CoreMedia

/// Line-delimited JSON messages to the Electron parent process.
enum Output {
  private static let lock = NSLock()

  static func emit(_ object: [String: Any]) {
    lock.lock()
    defer { lock.unlock() }
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
  }

  static func event(_ name: String, _ fields: [String: Any] = [:]) {
    var payload = fields
    payload["event"] = name
    emit(payload)
  }

  static func log(_ message: String) {
    FileHandle.standardError.write("[studio-recorder] \(message)\n".data(using: .utf8)!)
  }

  static func fail(_ message: String, code: Int32 = 1) -> Never {
    event("error", ["message": message])
    exit(code)
  }

  static func writeJSON(_ object: Any, to url: URL) throws {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: url, options: .atomic)
  }
}

/// All timing is expressed in host-clock seconds (mach absolute time), the same clock that
/// ScreenCaptureKit, AVCaptureSession (after conversion) and CGEvent timestamps use.
enum HostClock {
  static func now() -> Double {
    CMClockGetTime(CMClockGetHostTimeClock()).seconds
  }

  private static let timebase: mach_timebase_info_data_t = {
    var info = mach_timebase_info_data_t()
    mach_timebase_info(&info)
    return info
  }()

  /// CGEventTimestamp is nanoseconds of mach absolute time on every supported Mac.
  static func seconds(fromEventTimestamp ts: UInt64) -> Double {
    let s = Double(ts) / 1_000_000_000
    let n = now()
    return abs(s - n) < 5 ? s : n
  }
}
