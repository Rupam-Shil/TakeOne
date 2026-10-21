# Landing page handover

Build a single-page marketing site for **Take One**, an open-source macOS screen recorder, inside this `website/` folder. Do not change anything outside `website/`.

The product is called **Take One**. Put the name in one constant (for example `site.config.ts` → `name`) and use that everywhere, including the page title and meta tags, so any future rename is a one-line change.

## What the product is

Take One records your Mac's screen and turns the raw take into a polished demo automatically. Zooms follow your clicks, the cursor is re-rendered smooth and sharp, and the recording sits on a wallpaper with padding, rounded corners and a shadow. It is free, MIT licensed, runs entirely on-device, and needs no account.

- Repository: https://github.com/Rupam-Shil/TakeOne
- Downloads: https://github.com/Rupam-Shil/TakeOne/releases/latest (no release is published yet; link there anyway)
- Requirements: macOS 15 or later on Apple Silicon
- Audience: developers, founders and designers who record product demos, tutorials and bug reports

## Look and feel

Apple product-page style: light grey and black, calm, lots of space, typography doing the work.

| Token | Value | Use |
|---|---|---|
| Page background | `#f5f5f7` | Body, alternating sections |
| Surface | `#ffffff` | Cards, video frame, nav when scrolled |
| Ink | `#1d1d1f` | Headlines, body text, primary buttons |
| Secondary text | `#6e6e73` | Subheads, captions, footer |
| Hairline | `#d2d2d7` | Dividers, card borders |
| Accent | `#ff3b30` | One small recording dot only, never for buttons or links |

- **Type:** the system stack (`-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif`). Do not load web fonts. Hero headline 64–80px desktop and 40px mobile, weight 700, letter-spacing −0.02em, tight line-height. Body 17–19px.
- **Buttons:** pills. Primary is black with white text; secondary is white with a 1px hairline border and black text. Height 44px, padding 0 22px, weight 600.
- **Cards:** white, 20–24px radius, a very soft shadow (`0 1px 2px rgba(0,0,0,.04), 0 12px 32px -12px rgba(0,0,0,.12)`), no visible border on grey.
- **Layout:** content max width 1120px; sections 120px vertical padding on desktop, 72px on mobile.
- **Motion:** subtle fade-and-rise as sections enter (200–400ms, ease-out). Nothing bounces, nothing loops except the video. Respect `prefers-reduced-motion`: no entrance animation and no video autoplay.
- **No** gradients on UI chrome, no glassmorphism or blur panels, no purple, no emoji, no stock illustrations.
- Light theme only; do not add a dark mode.

## Assets (already in `website/assets/`)

| File | What it is |
|---|---|
| `northwind-tour.mp4` | Hero video, 1920×1080, 60 fps, H.264, 25.6 s, 6.5 MB, no audio track. It is a real export from the app: a recording of a fictional analytics app ("Northwind") with automatic zooms, the re-rendered cursor and a wallpaper background. No webcam. |
| `northwind-tour-poster.jpg` | First frame of the video, 1920×1080. Use as the video `poster`. |
| `editor-cursor-styles.jpg` | Screenshot of the app's editor (2400×1500): cursor styles panel, a zoomed preview and the timeline with zoom segments. |
| `../../build/icon.png` | App icon, 1024×1024 PNG with transparency. Copy it into the site's public folder at build time or reference a copy; generate a 32px favicon and a 180px apple-touch-icon from it. |

Northwind is a made-up app. Never present it as a customer or a real product.

## Page structure and copy

Use this copy as a starting point; tighten it if a line wraps badly, but keep the claims accurate.

1. **Nav** (sticky; transparent over grey, white with a hairline when scrolled): icon + name on the left; on the right "Features", "Open source", a GitHub link with an icon, and a small black "Download" pill.
2. **Hero**
   - Eyebrow: "Open source · macOS" with a small red dot.
   - Headline: "Screen recordings that look edited, on the first take."
   - Subhead: "Record your Mac. Take One zooms in where you click, smooths your cursor and frames it all on a beautiful background. Free, private and open source."
   - Buttons: "Download for Mac" (primary, releases link) and "View on GitHub" (secondary, repo link).
   - Small note under the buttons: "macOS 15+ · Apple Silicon · MIT licensed".
3. **Hero video**, directly under the hero text, full content width, inside a white card with 24px radius and the soft shadow. `<video autoplay muted loop playsinline preload="metadata" poster="assets/northwind-tour-poster.jpg">`. Add a small pause/play toggle in a corner for accessibility. Do not autoplay under reduced motion; show the poster with a play button instead.
4. **How it works**, three columns: "Record" (display, window or area, with camera and mic on their own tracks); "It edits itself" (zooms follow your clicks, the cursor glides, long pauses can be tightened and typing sped up); "Export" (MP4 up to 4K 60 fps, GIF, or a link to your own server).
5. **Feature grid**, two or three columns of cards, each with a simple line icon (Lucide, stroke 1.75) and two sentences:
   - Automatic zoom: follows your clicks; add, move or remove zooms on the timeline.
   - Smooth cursor: re-rendered at any size with spring smoothing and 27 styles.
   - Backgrounds: wallpapers, gradients, padding, rounded corners and shadows.
   - Camera layouts: overlay, split screen and cutout shapes, with face tracking.
   - Captions: on-device transcription, and editing the video by deleting words.
   - On-device AI voices: generate a voiceover without uploading anything.
   - Fast export: MP4 in H.264, HEVC or AV1, GIF, or the current frame as an image.
   - Private by default: no account, no telemetry, everything stays on your Mac.
6. **Editor showcase**: `editor-cursor-styles.jpg` in a large white card with the caption "Every setting is live. Change the background, cursor or zoom and the preview updates as it plays."
7. **Open source**: short paragraph ("MIT licensed and built in the open. Read the code, file an issue or send a pull request."), a GitHub button, and a copyable code block:
   ```
   git clone https://github.com/Rupam-Shil/TakeOne.git
   cd TakeOne
   npm install
   npm run dev
   ```
8. **FAQ** (native `<details>` elements):
   - Is it free? Yes. MIT licensed, no paid tier, no watermark.
   - Does anything get uploaded? No. Recording, editing, transcription and voices all run on your Mac. Shareable links only go to a server you host yourself.
   - Why does macOS warn me when I open it? Builds are not notarised yet. Open the app once, then go to System Settings → Privacy & Security and click Open Anyway. You only do this once.
   - Windows or Linux? Not yet. It is built on macOS capture APIs.
9. **Footer**: name, "MIT License", GitHub link, and the line "Not affiliated with Screen Studio."

## Technical requirements

- Static site with no backend. Astro or plain HTML/CSS with a little vanilla JS are both fine; keep JS minimal. Give `website/` its own `package.json` if you use a build step, and do not add dependencies to the app's root `package.json`.
- Responsive at 375, 768, 1024, 1280 and 1440px wide with no horizontal scroll. On mobile, stack columns and keep the video full width.
- Semantic HTML, one `h1`, visible keyboard focus, AA contrast, `alt` text on images, `aria-label` on icon-only links.
- Performance: Lighthouse 95+ for performance, accessibility, best practices and SEO on desktop. Lazy-load the editor screenshot, serve it as AVIF/WebP with the JPEG as fallback, and add `width`/`height` to avoid layout shift.
- Meta: title "Take One — screen recordings that look edited", a description, Open Graph and Twitter tags using the poster as the image, and the favicons above.
- No analytics, cookies, trackers or third-party embeds.

## Do not

- Use Screen Studio's name, logo, screenshots, wording or design, except the single footer line above.
- Invent testimonials, user counts, star counts, logos of companies or press quotes.
- Present Northwind as real.
- Deploy anything, create releases, or push to GitHub. Build it locally and let Rupam review it first.

## Done when

- `website/` builds and serves locally with one documented command, written in `website/README.md`.
- The hero video autoplays muted and loops in Safari and Chrome, and shows the poster under reduced motion.
- Every section above is present with the copy, links and assets listed.
- Lighthouse scores and the five viewport widths are checked, with results noted in `website/README.md`.
