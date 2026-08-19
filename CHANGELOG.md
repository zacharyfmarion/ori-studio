# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-08-19

### Changed

- Move Startup, Updates and Privacy into their own **General** tab in Settings, first in the list. They are not workspace settings, and Updates in particular had ended up between Privacy and the crease-pattern canvas — on the seam between how the app behaves and how it edits. The Workspace tab keeps Folding, the crease-pattern canvas, and Layout.

### Fixed

- Say what checking for updates found. "Check now" reported nothing at all when a check failed, leaving the row reading "Not checked yet" however many times it was pressed, and the Help menu's "Check for Updates" was silent on every outcome. Both now report an up-to-date app, an available version, and a failure. A failed check is also no longer retried on every window focus.
- Offer Windows the update payload it can actually install. The manifest looked for an artifact name Tauri no longer produces, so Windows installs were offered nothing.
- Stop charging every simulation frame for the largest window ever opened. With inline simulations open, zooming the crease pattern in and back out left orbiting slow for the rest of the session — the shared drawing buffer was grow-only, so one deep zoom pinned it at 2048×2048 and the browser cleared all of it every frame. Visible in Safari and the desktop shell; Chromium never showed it.

## [0.2.0] - 2026-08-18

First release for Windows and Linux, and the first that can update itself.

### Added

- Add Windows and Linux desktop builds, alongside macOS on both Apple Silicon and Intel. Every platform is built and signed by CI from one source revision; macOS is notarized.
- Add in-app updates. Ori Studio checks quietly in the background, downloads in full, and offers to relaunch only once the update is on disk and verified. Automatic, notify-only and off are all available under Settings ▸ Workspace ▸ Updates.
- Add the Box Pleating workspace: a full box-pleating design surface with flap and river editing, symmetry, a layout optimizer, and `.bps` interchange.
- Add 3D folding on the canvas, inline simulation windows saved with the project, and SVG export of the simulator view.
- Add crease-pattern sharing by link, with a preview card.
- Add images to the Edit workspace, so a reference photo can sit beside the crease pattern it describes.
- Add rich text and circle annotations to the crease-pattern canvas.
- Add ExplOri, Brandon Wong's 22.5° archive, searchable from a Design tab.
- Add localization in eight languages: German, Spanish, French, Japanese, Korean, Brazilian Portuguese, Russian and Simplified Chinese.
- Add non-180° fold angles throughout — representation, editing, file I/O, and vertex checks.

### Improved

- Rebuild the crease-pattern canvas on WebGL, and bring the editing tools much closer to Oriedita: line styles, the eraser, symmetry, snapping, measurement in real units, and the selection toolbar.
- Cut folding time on a large crease pattern from roughly 18 seconds to under two, and reduce peak memory when opening large `.osf` files.
- Give the app per-surface routing and deep links, so a workspace can be linked to directly.
- Report errors properly: error boundaries with copyable reports, plus optional analytics and crash reporting that can be turned off in Settings.

### Fixed

- Fix a long list of crease-pattern editing defects, including selection ownership, eraser precedence, delete behaviour, tool snapping, and canvas panning jank.
- Stop a dropped `.ori` file being read as a camera raw image.
- Keep FOLD per-edge data aligned when edges are rebuilt, and fix n-gon triangulation winding and slivers.

### Note on file compatibility

Projects saved by this version use a newer `.osf` schema and may not open in 0.1.2. Older projects continue to open normally.

## [0.1.2] - 2026-05-26

### Added

- Add native `.osf` Ori Studio project files for TreeMaker documents and editable crease-pattern documents.
- Register `.osf` as a macOS document type with Finder open support and a dedicated document icon.
- Add the editable Oriedita crease-pattern workspace, including CP tools, diagnostics, import/export flows, and viewport controls.
- Add first-run/start-screen flows and richer help for crease-pattern editing.

### Improved

- Polish crease-pattern tool selection, snapping, infinite-canvas behavior, and Oriedita angle-bisector parity.
- Add export options for crease-pattern images and keep TreeMaker 5 export explicit from the file menu.
- Improve folded-base and sequence preview behavior for crease-pattern workflows.

## [0.1.1] - 2026-05-20

Initial signed and notarized Ori Studio macOS app release.

- Publish an Apple Silicon DMG for Ori Studio.
- Keep Cloudflare Pages as the hosted browser app at oristudio.pages.dev.
