#!/usr/bin/env bash
# Builds the Swift capture helper and wraps it in a small app bundle, so macOS lists it with the
# app's name and icon when it asks for Screen Recording, Accessibility and Input Monitoring.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/resources/bin/Studio Clone Helper.app"
swift build -c release --package-path "$ROOT/native/recorder" 2>&1 | grep -vE '^\[[0-9]+/[0-9]+\]' || true
BIN="$(swift build -c release --package-path "$ROOT/native/recorder" --show-bin-path)/studio-recorder"
if [ ! -f "$BIN" ]; then echo "native build failed" >&2; exit 1; fi

rm -rf "$APP" "$ROOT/resources/bin/studio-recorder"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/studio-recorder"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>studio-recorder</string>
  <key>CFBundleIdentifier</key><string>dev.studioclone.helper</string>
  <key>CFBundleName</key><string>Studio Clone Helper</string>
  <key>CFBundleDisplayName</key><string>Studio Clone Helper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSCameraUsageDescription</key><string>Studio Clone records your camera for the camera overlay.</string>
  <key>NSMicrophoneUsageDescription</key><string>Studio Clone records your microphone for narration.</string>
  <key>NSAudioCaptureUsageDescription</key><string>Studio Clone records system audio.</string>
  <key>NSScreenCaptureUsageDescription</key><string>Studio Clone records your screen.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>Studio Clone transcribes your narration on this Mac.</string>
</dict>
</plist>
PLIST

# Icon: the app icon as an .icns, built with the system tools.
ICONSET="$(mktemp -d)/icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$ROOT/build/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$ROOT/build/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns"
rm -rf "$(dirname "$ICONSET")"

codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
echo "built $APP"
