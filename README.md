# Studio Clone

An open-source screen recorder and editor for macOS that turns a raw recording into a polished demo. Zooms follow your clicks, the cursor is re-rendered smooth and sharp, and the recording sits on a wallpaper with padding, rounded corners and a shadow. Camera layouts, captions, on-device voiceovers and fast MP4/GIF export are built in.

Everything runs on your Mac. There are no accounts, no watermark and no paid tier.

> Studio Clone is an independent project. It is not affiliated with, endorsed by, or connected to Screen Studio or its makers.

## Features

**Recording**
- Display, window or area recording, plus iPhone/iPad over USB. The real cursor is hidden during capture and re-rendered later.
- Camera, microphone and system audio on separate tracks that stay in sync. System audio can come from every app or only the apps you pick.
- Countdown, pause/resume, restart, discard, timeline markers and speaker notes. The recording controls never appear in the capture.
- Window size presets before you record, hidden desktop icons, a dimmed area outside the recorded region, and auto-stop on low disk.
- Crash-safe files: an interrupted recording is recovered the next time the app opens.

**Editing**
- Automatic zooms from your clicks, plus manual, follow-cursor and instant zooms, and a glass loupe zoom.
- Cursor smoothing with presets or custom springs, 27 cursor styles (gradient, metal, minimal, pixel, touch), click effects and click sounds, tilt and follow rotation, hide when idle or typing, shake removal.
- Wallpapers, gradients, colours, images and blur behind the recording, with padding, roundness, shadow, inset border, motion blur, crop and aspect ratios.
- Camera layouts (overlay, split screen, camera only, screen only, cutout with circle, rounded, square or hexagon shapes) with animated transitions, face tracking, background blur or removal, colour looks and grain.
- Timeline with trim, split, ripple delete, speed changes from 0.5× to 24×, per-clip volume, typing speed-up suggestions, blur/pixelate/highlight masks that can follow scrolling content, text overlays and keyboard shortcut overlays.
- Captions and edit-by-transcript: delete words to cut the video, remove filler words, tighten pauses, export SRT/VTT.
- Microphone clean-up presets, background music with fades, and voiceovers recorded or generated on-device.
- Presets, undo/redo, autosave and a project library.

**Export**
- MP4 in H.264, HEVC, AV1, or H.264 and HEVC side by side, from 720p to 4K at up to 60 fps. GIF, clipboard, current frame as PNG.
- Shareable links through a small server you host yourself (`share-server/`).

## Requirements

- macOS 15 or later on Apple Silicon. Apple's on-device transcription needs macOS 26; Whisper transcription works on macOS 15 and later.
- Xcode command line tools with Swift 6, to build the capture helper.
- Node.js 22 or later.

## Build and run

```bash
npm install
npm run dev        # builds the Swift capture helper, then starts the app with hot reload
npm run dist       # packages dist/Studio Clone-<version>-arm64.dmg
```

The packaged app is ad-hoc signed and not notarised. The first time, right-click it in Applications and choose Open.

On first launch a welcome screen walks through permissions: Screen Recording (required), Accessibility (click-aware zooms), Input Monitoring (keyboard shortcut overlays), and Camera and Microphone (optional). After a rebuild of the capture helper macOS may ask for these again.

## Using it

- **Record:** press ⌃⌘↩ or click the red button in the app to open the recording bar. Choose Display, Window, Area or a connected iPhone/iPad, then pick a camera, microphone and audio sources.
- **While recording:** a small pill shows the timer with pause, restart and discard. ⌥⌘P pauses, ⌃⌥⌘F drops a marker, ⌥⌘. opens speaker notes.
- **Edit:** the editor opens when you stop. The left dock holds Look, Cursor, Layout, Camera, Captions, Words, Audio, Keys, Motion, Device and Voice. ⌘K opens the command menu and ⌘/ lists every shortcut.
- **Export:** ⇧⌘E opens the export dialog.

## On-device AI

Two optional models run entirely on your Mac. They download the first time you use them and are never uploaded anywhere.

- **Natural voices (Kokoro, about 90 MB):** write a line and add it at the playhead, or re-voice a whole narration from its transcript, sentence by sentence, in sync with the video.
- **Whisper transcription (150 MB or 480 MB):** for Macs without the macOS 26 speech engine, or when you prefer it.

Settings → General shows how much model data is cached and lets you delete it.

## Shareable links

Links go to a small server you run yourself:

```bash
SHARE_TOKEN=$(openssl rand -hex 24) PUBLIC_URL=https://share.example.com node share-server/server.mjs
```

Put the address and token into Settings → Sharing. Links can be public or private, the watch page streams with range requests, and `/dashboard` lists videos with view counts.

## How it's built

- **`native/recorder`** is a Swift command-line helper. It records each source with ScreenCaptureKit or AVFoundation to its own file on one shared clock, logs mouse, click, key and cursor-shape events, and runs on-device transcription.
- **`src/main`** is the Electron main process: the window, tray, global shortcuts, the recorder process, project storage and presets.
- **`src/renderer/src/render`** is the compositor shared by preview and export: springs, cursor and camera tracks, layouts, backgrounds, captions and keystroke overlays.
- **`src/renderer/src/editor`** is the editor: preview, timeline, inspector panels, undo history and the export dialog.
- **`src/renderer/src/export`** decodes variable-frame-rate recordings frame-accurately, mixes audio offline and encodes MP4 with WebCodecs.
- **`share-server`** is the optional self-hosted link server.

A project is a folder named `*.studioclone` holding `project.json` and a `recording/` folder with the screen, camera, microphone and system audio tracks, plus `meta.json` and `events.json`.

## Contributing

Issues and pull requests are welcome. Run `npm run typecheck` and `npm test` before opening a pull request, and describe how you tested capture changes, since the helper needs real permissions to exercise.

## Third-party software

Studio Clone's own code is MIT licensed. It ships or downloads these components under their own licences:

- Electron, React, Tailwind CSS, zustand, immer and ONNX Runtime Web (MIT), Lucide icons (ISC).
- MediaPipe Tasks Vision (Apache-2.0), used for face tracking and camera background removal.
- Transformers.js and Kokoro (Apache-2.0); the Kokoro and Whisper model weights are downloaded at runtime under their own licences.
- Mediabunny (MPL-2.0), used for MP4 muxing and decoding.
- FFmpeg via `ffmpeg-static` (GPL-3.0-or-later build), used for GIF export. It runs as a separate program, and packaged builds include its binary and licence.

## License

[MIT](LICENSE) © 2026 Rupam Shil
