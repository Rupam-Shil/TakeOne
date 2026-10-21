import AppKit
import Foundation

// studio-recorder <command>
//   list [--exclude-pid N] [--devices] → {"event":"list", displays, windows, apps, cameras, microphones, mobileDevices}
//   resize-window <id> <w> <h>    → resizes another app's window (Accessibility) and prints its new frame
//   permissions                   → {"event":"permissions", ...}
//   request-permission <kind>     → prompts, then prints permissions
//   record '<json config>'        → streams events; reads pause|resume|stop|cancel lines on stdin
//                                    with "waitForGo": warms the camera, emits "prepared", then waits for "go"
//   locales                       → {"event":"locales", supported, installed}
//   transcribe <file> --locale L  → {"event":"word", text, start, end} lines, then {"event":"complete"}

setvbuf(stdout, nil, _IOLBF, 0)
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

let args = CommandLine.arguments
guard args.count >= 2 else { Output.fail("usage: studio-recorder list|permissions|request-permission|record") }

func runAsync(_ body: @escaping () async -> Void) -> Never {
  Task {
    await body()
    exit(0)
  }
  app.run()
  exit(0)
}

switch args[1] {
case "list":
  var pid: pid_t?
  if let i = args.firstIndex(of: "--exclude-pid"), i + 1 < args.count { pid = pid_t(args[i + 1]) }
  let mobile = args.contains("--devices")
  runAsync { await Listing.run(excludingPid: pid, includeMobile: mobile) }

case "resize-window":
  guard args.count >= 5, let id = UInt32(args[2]), let w = Double(args[3]), let h = Double(args[4]) else {
    Output.fail("usage: resize-window <windowId> <width> <height>")
  }
  WindowControl.resize(windowId: id, width: w, height: h)

case "locales":
  runAsync { await Transcribe.locales() }

case "transcribe":
  guard args.count >= 3 else { Output.fail("usage: transcribe <audio file> [--locale en-US]") }
  var locale = Locale.current.identifier
  if let i = args.firstIndex(of: "--locale"), i + 1 < args.count { locale = args[i + 1] }
  runAsync { await Transcribe.run(file: args[2], locale: locale) }

case "permissions":
  Output.event("permissions", Permissions.status())

case "request-permission":
  guard args.count >= 3 else { Output.fail("missing permission kind") }
  runAsync { await Permissions.request(args[2]) }

case "record":
  guard args.count >= 3, let data = args[2].data(using: .utf8) else { Output.fail("missing config") }
  let config: RecordConfig
  do { config = try JSONDecoder().decode(RecordConfig.self, from: data) } catch {
    Output.fail("invalid config: \(error)")
  }
  let recorder = Recorder(config: config)
  Task {
    if config.waitForGo == true {
      await recorder.prepare()
      Output.event("prepared", [:])
      let command = await readCommand(until: ["go", "cancel", "stop"])
      if command != "go" {
        await recorder.stop(cancel: true)
        exit(0)
      }
    }
    do {
      try await recorder.start()
    } catch {
      Output.fail("failed to start recording: \(error)")
    }
    // Commands arrive line by line; EOF means the parent went away, so finish the file cleanly.
    DispatchQueue.global().async {
      while let line = readLine() {
        switch line.trimmingCharacters(in: .whitespaces) {
        case "pause": recorder.pause()
        case "marker": recorder.addMarker()
        case "resume": recorder.resume()
        case "stop":
          Task { await recorder.stop(cancel: false); exit(0) }
          return
        case "cancel":
          Task { await recorder.stop(cancel: true); exit(0) }
          return
        default: break
        }
      }
      Task { await recorder.stop(cancel: false); exit(0) }
    }
  }
  app.run()

default:
  Output.fail("unknown command \(args[1])")
}

/// Reads stdin lines off the cooperative pool until one of `commands` arrives; nil on EOF.
func readCommand(until commands: Set<String>) async -> String? {
  await withCheckedContinuation { (c: CheckedContinuation<String?, Never>) in
    DispatchQueue.global().async {
      while let line = readLine() {
        let l = line.trimmingCharacters(in: .whitespaces)
        if commands.contains(l) { return c.resume(returning: l) }
      }
      c.resume(returning: nil)
    }
  }
}
