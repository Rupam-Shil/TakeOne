import AVFoundation
import Speech

/// On-device transcription with word timings (macOS 26 SpeechAnalyzer). Emits one JSON line per word.
enum Transcribe {
  static func locales() async {
    guard #available(macOS 26.0, *) else {
      Output.event("locales", ["supported": [], "installed": [], "available": false])
      return
    }
    let supported = await SpeechTranscriber.supportedLocales.map { $0.identifier(.bcp47) }
    let installed = await SpeechTranscriber.installedLocales.map { $0.identifier(.bcp47) }
    Output.event("locales", ["supported": supported.sorted(), "installed": installed.sorted(), "available": SpeechTranscriber.isAvailable])
  }

  static func run(file: String, locale identifier: String) async {
    guard #available(macOS 26.0, *) else { Output.fail("On-device transcription needs macOS 26 or later") }
    do {
      let wanted = Locale(identifier: identifier)
      guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: wanted) else {
        Output.fail("Language \(identifier) isn't supported for on-device transcription")
      }
      let transcriber = SpeechTranscriber(
        locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange, .transcriptionConfidence])
      if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        Output.event("download", ["progress": 0])
        let progress = request.progress
        let timer = DispatchSource.makeTimerSource(queue: .global())
        timer.schedule(deadline: .now(), repeating: 0.5)
        timer.setEventHandler { Output.event("download", ["progress": progress.fractionCompleted]) }
        timer.resume()
        try await request.downloadAndInstall()
        timer.cancel()
      }
      let audio = try AVAudioFile(forReading: URL(fileURLWithPath: file))
      let duration = Double(audio.length) / audio.fileFormat.sampleRate
      let analyzer = SpeechAnalyzer(modules: [transcriber])

      let collector = Task {
        var index = 0
        for try await result in transcriber.results {
          for run in result.text.runs {
            guard let range = run.audioTimeRange else { continue }
            let text = String(result.text[run.range].characters).trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { continue }
            let start = range.start.seconds
            let end = range.end.seconds
            Output.event("word", [
              "index": index, "text": text, "start": start, "end": end,
              "confidence": run.transcriptionConfidence ?? 1,
              "progress": duration > 0 ? min(1, end / duration) : 0,
            ])
            index += 1
          }
        }
      }
      if let last = try await analyzer.analyzeSequence(from: audio) {
        try await analyzer.finalizeAndFinish(through: last)
      } else {
        await analyzer.cancelAndFinishNow()
      }
      try await collector.value
      Output.event("complete", ["locale": locale.identifier(.bcp47)])
    } catch {
      Output.fail("Transcription failed: \(error.localizedDescription)")
    }
  }
}
