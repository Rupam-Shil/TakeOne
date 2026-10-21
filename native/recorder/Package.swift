// swift-tools-version:6.0
import PackageDescription

let package = Package(
  name: "StudioRecorder",
  platforms: [.macOS(.v15)],
  targets: [
    .executableTarget(
      name: "studio-recorder",
      path: "Sources/StudioRecorder",
      swiftSettings: [.unsafeFlags(["-Onone"], .when(configuration: .debug))],
      linkerSettings: [
        .linkedFramework("ScreenCaptureKit"),
        .linkedFramework("AVFoundation"),
        .linkedFramework("CoreMediaIO"),
        .linkedFramework("AppKit"),
        .linkedFramework("Speech"),
      ]
    )
  ],
  swiftLanguageModes: [.v5]
)
