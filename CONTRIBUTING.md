# Contributing to Take One

Thanks for helping make Take One better. Bug reports, feature ideas, documentation fixes and code are all welcome, whether it's your first open-source contribution or your hundredth.

This guide covers how to report problems, set up a development build, find your way around the code, and get a pull request merged.

## Ways to contribute

- **Report a bug.** Open a [bug report](https://github.com/Rupam-Shil/TakeOne/issues/new?template=bug_report.yml) with your macOS version, Mac model and steps to reproduce.
- **Suggest a feature.** Open a [feature request](https://github.com/Rupam-Shil/TakeOne/issues/new?template=feature_request.yml) that describes the problem you're trying to solve, not only the solution.
- **Improve the docs.** Typos, clearer steps and better screenshots are all valuable.
- **Write code.** Look for issues labelled `good first issue` or `help wanted`, or pick something you'd like to see. For anything larger than a small fix, please open an issue first so we can agree on the approach before you invest time.

Security problems should not go in public issues. See [SECURITY.md](SECURITY.md).

## Development setup

### Requirements

- macOS 15 or later on Apple Silicon
- Xcode 26 or its Command Line Tools (`xcode-select --install`), for the macOS 26 SDK and Swift 6.2+
- Node.js 22 or later (see `.nvmrc`)

### Run it

```bash
git clone https://github.com/Rupam-Shil/TakeOne.git
cd TakeOne
npm install
npm run dev
```

`npm run dev` builds the Swift capture helper into `resources/bin/Take One Helper.app`, then starts Electron with hot reload. Renderer changes reload instantly. Changes under `src/main` restart the app, which ends any recording in progress.

### Permissions during development

The capture helper asks macOS for Screen Recording, Accessibility, Input Monitoring, Camera and Microphone. It is ad-hoc signed, so **rebuilding it can make macOS forget those permissions**. If recording fails or the cursor and keystrokes stop being captured after a rebuild, open System Settings → Privacy & Security and switch **Take One Helper** off and on again in the relevant lists.

When the event tap is silent, the helper falls back to polling the pointer, so cursor movement and clicks still record; only keystroke overlays need Input Monitoring.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Build the helper and run the app with hot reload |
| `npm run build:native` | Rebuild only the Swift helper |
| `npm run typecheck` | Type-check everything |
| `npm test` | Run the unit tests (Vitest) |
| `npm run build` | Production build of the helper and the app |
| `npm run dist` | Package a `.dmg` into `dist/` |
| `npm run share-server` | Run the self-hosted share server locally |

## Project layout

```
native/recorder/        Swift capture helper (ScreenCaptureKit, AVFoundation, event tap, speech)
src/main/               Electron main process: window, tray, shortcuts, recorder process, storage
src/preload/            The bridge that exposes the typed API to the renderer
src/shared/             Types and pure helpers used by both processes
src/renderer/src/
  routes/               Library, settings, welcome, recording bar, overlays, controls
  editor/               Editor UI: preview, timeline, inspector panels, export dialog, undo
  render/               Compositor shared by preview and export
  export/               Frame-accurate decoding, audio mixing, encoding
  ui/                   Shared controls (buttons, sliders, segmented controls, popovers)
share-server/           Optional self-hosted link server, no dependencies
website/                Landing page brief and marketing assets
```

### How a recording flows through the app

1. The main process spawns the helper with a JSON config. The helper streams NDJSON events over stdout and takes `go`, `pause`, `resume`, `stop` and `cancel` commands on stdin.
2. The helper writes each source to its own file in the project's `recording/` folder on one shared clock, plus `events.json` with pointer, click, key and cursor-shape events, and `meta.json` with track offsets.
3. The editor loads the project, builds a scene from the recording and the project's config, and draws it with the compositor.
4. Export runs the same compositor frame by frame, so preview and export always match.

The architecture overview in the [README](README.md#how-it-works) has a diagram.

## Coding guidelines

- **TypeScript everywhere**, strict mode. Shared types live in `src/shared`. The renderer talks to the main process only through the typed API in `src/shared/ipc.ts`.
- **Keep rendering in the compositor.** Anything that changes how a frame looks belongs in `src/renderer/src/render`, so preview and export stay identical.
- **Edits go through the store.** Project changes go through `update` on the editor store (`src/renderer/src/editor/store.ts`), which records immer patches for undo and redo. Don't mutate project state directly.
- **Match the existing style**: two-space indentation, single quotes, no semicolons, small focused functions, and React function components. `.editorconfig` covers the basics.
- **Comments explain why**, not what the next line does.
- **Design language**: the interface is monochrome and tactile, with soft pills, keycap-style buttons and a single main window. Colour is reserved for timeline tracks and the red recording state. Please don't add new windows for pages; add a route to the main window instead.
- **Dependencies**: avoid adding new ones for small things. Large or native dependencies need a discussion in an issue first.
- **Privacy**: no telemetry, analytics or network calls beyond downloading the optional on-device models. Anything that uploads must be opt-in and go only to a server the user configures.

## Testing

- Run `npm run typecheck` and `npm test` before you push. CI runs both, plus a production build and a build of the Swift helper.
- Add unit tests next to the code they cover (`*.test.ts`) for pure logic such as timing, layout and path helpers.
- Capture changes can't be fully tested in CI because they need real permissions. In your pull request, describe how you tested: which source (display, window, area, device), with or without camera and microphone, and what you checked in the result.
- For UI changes, include a screenshot or a short recording. Take One can make the recording for you.

## Pull requests

1. Fork the repository and create a branch from `main` with a short descriptive name, such as `fix-camera-offset` or `gif-export-loop`.
2. Keep each pull request focused on one change. Separate refactors from behaviour changes.
3. Write commit messages that say what changed and why, in plain sentences.
4. Make sure typecheck, tests and the build pass.
5. Fill in the pull request template, link the issue it closes, and describe your testing.

A maintainer will review it, possibly ask for changes, and merge it when it's ready. Please be patient; this is a small project.

## Reporting a bug well

The most useful bug reports include:

- macOS version and Mac model (for example, macOS 26.1 on a MacBook Air M3)
- Take One version or commit, and whether you built it yourself
- What you recorded (display, window, area or device) and which camera and microphone
- Exact steps, what you expected, and what happened instead
- Screenshots or a short recording, and any errors from the terminal if you run `npm run dev`

Please don't attach recordings that contain private information. A short reproduction on a test window is ideal.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE), the same license that covers the project.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
