# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-09-21

Two desktop fixes — a folded figure's colour picker, and ExplOri search — with faster precreasing sequences and a detector solve that reads the image's own ink.

### Added

- Offer **Review & Fix** beside Add after a clean Detect CP solve, not only after something went wrong. It opens the recognised pattern in the Edit workspace with the image behind it and the solver attached, which is the one place a vertex can be pinned or moved before the solve is run again.
- Warn, once per plan, when a precreasing sequence contains approximated folds. If the pattern came from Detect CP from Image, the detection may have converged on an inaccurate solution, and the reference points are worth checking.

### Improved

- Recover a detected pattern's construction from the image's own ink. A solve that passed the folding checks could still carry dimensions a little off the reference; the solver now measures the original strokes, proposes nearby constructions, and adopts one only when it fits the image better and passes every check. Exact recoveries on the clean benchmark rise from 287 to 319 of 421.
- Plan a precreasing sequence in a fraction of the time. The presentation pass stops scanning at its own caps, so a 3,600-crease pattern's sequence takes 34 seconds where it took 125; and ReferenceFinder's line search scores each reference once, so a round of line queries on a 330-line pattern takes seconds rather than a minute.
- Let a precreasing sequence run as long as the pattern needs. The 30-second ceiling is gone, Stop now reaches the plan (it never had), and the last card says how the run ended — finished, stopped with N of M creases made, or incomplete with the rest listed under the cards. The progress counter counts what is left, rather than reading "Folded 0 of 332" a minute in.
- Give the Simulate workspace's Patterns rail the References look: crease-coloured thumbnails at a constant stroke width, with an index chip and a face count under each card. On a phone the list comes first, and a card opens the simulator with a Back button.

### Fixed

- Keep a folded figure's colour picker open. On the desktop app and in Safari, choosing Front or Back colour from the figure's Style menu showed the picker only until the mouse moved, and a pick that did land left the next click on the page dead.
- Reach ExplOri search from the desktop app. Every search from the desktop had failed since the feature shipped: the app asked its own origin, which has no search proxy, and reported the answer as a timeout.
- Restore Undo on older WebKit. On a WebKit from before Safari 15.4, every ⌘Z was refused; a similar gap on macOS 10.15 failed an ExplOri search before the request left the app.
- Refuse a Copy or Move whose points would place creases nowhere. Clicking the same source vertex twice in a four-point Copy scaled every endpoint to infinity and appended invisible creases that poisoned point snapping and stopped the file opening again. The transform is now refused, the snap ignores such points, and a file already carrying them opens with them dropped.
- Stop a precreasing sequence on a very dense pattern failing outright. Passing the planner's point cap now ends the plan cleanly and says so.
- Show the context-lost notice, and recover when the context returns, when WebGL is lost before the first frame — instead of telling the user to update their graphics drivers.
- Tell a browser without module workers that it cannot run Ori Studio, instead of failing every engine with a "worker stopped" toast.
- Stop a page Chrome has translated raising an error toast for the browser's own cross-origin placeholder error.

## [0.5.0] - 2026-09-17

A References workspace that works out how to fold a pattern, a Properties pane, and a new crease-pattern detector.

### Added

- Add the **References** workspace, beside Edit, Design and Simulate. It shows the open crease pattern read-only and answers two questions about it. **Find a reference**: tap a vertex or a crease and get ranked folding constructions for it from Robert J. Lang's ReferenceFinder, each step drawn as a card and on the pattern itself; approximate solutions are opt-in. **Precreasing sequence**: an ordered sequence of folds that creases every line of the design from a blank sheet, with pinches wherever a mark is all that is needed, mountain and valley, and the turn-overs a folder would make. The phone layout is a first-class case throughout.
- Play each step's fold. A Play button, Space, and an auto-play setting run the paper from flat to folded and back on both tabs of the References workspace: the flap lands exactly where a sharp fold would put it, pinches are pressed around the marks the fold passes through, and a turn-over rolls across the table.
- Add a **Properties** pane to the Edit workspace, beside View. It shows the editable properties of whatever canvas object is selected — reference image, text box, folded figure, inline simulation window, suppression region — with one undo entry per change.
- Add **Pin Vertex**, beside Move Vertex and on the solve chip. Pin the junctions whose position you already know and the exact solver, Move Vertex, Move and Lengthen all hold them while everything else re-equilibrates. Pinned vertices draw amber.
- Give a folded figure its own **Style** menu, on the figure's floating toolbar and its right-click menu: render as paper, wireframe or X-ray, front or back, the three paper colours, and shadow. It acts on the figure you clicked, not on whichever figure happens to be active, and the viewport bar's Folded models dropdown retires.
- Offer to detect a crease pattern dropped on the Edit canvas. When an image that looks like one lands there, a pill offers **Detect creases** and opens the Detect dialog with the image already loaded. The check runs on the device and downloads nothing; Settings ▸ General turns the suggestion off.
- Ask, before detecting, that the crease pattern in the image was obtained legally and that you have the right to use it.
- Add **Pair with mirror** and **Pair all mirrored** to box-pleating symmetry, and make Unpair mean unpaired: a vertex now mirrors only its explicit pair, so an unpaired vertex no longer follows whatever sits at its reflection. A `.bps` import, or a design whose two halves were drawn without mirror draw, mirrors nothing until it is paired; Pair all mirrored does it in one step.
- Offer the desktop app on the website. The start screen, the landing page, the workspace toolbar and the About dialog link to the installer for each platform.
- Add a Discord link to the workspace toolbar. New, Open and Save leave the toolbar and stay in the File menu.

### Improved

- Recognise crease patterns with a new detector. Dense patterns keep the nearby junctions the previous model lost, and cyan construction lines come through as auxiliary lines rather than valley folds. On patterns the model never trained against, exact recognitions rise from 74 to 92 of 112. The model is downloaded once, as before, and is 1.5 MB where the old one was 45.
- Find the paper in a photo that is rotated or a few degrees off square, and crop to the paper rather than to a box one edge wider — a title, legend or page rule beside the pattern no longer stretches the crop. A tall image now fits the crop pane instead of running off the bottom of the dialog.
- Solve a box-pleated design onto its grid. The exact solver reads the lattice from the geometry and snaps every vertex to it, so the answer lands exactly on the grid rather than a fraction of a pixel off, and the grid completes the creases that leave the paper edge in the last cell.
- Straighten a crease that runs through several vertices. Detection bends such a line a degree or so at each vertex, and the solver held the halves as separate lines; it now reads which creases are one line and solves them as one. A 22.5° design's 11.25° subdivisions are held on their half step.
- Put a crease's contact with the paper edge on the crease's centreline. A shallow crease met the border a few pixels along the edge from where it was drawn, and two shallow creases meeting at one point decoded as two.
- Recover the construction behind a recognised pattern. A solve that passed the folding checks could still carry the image's noise or pick the wrong construction; it now proposes nearby construction coordinates and propagates them through the folding constraints, and a large clean pattern finishes within a 25-second budget instead of stopping after the lattice pass.
- Give the simulator one **Restart** control (`R`) in place of Refresh and Reset. It rewinds the fold and puts the view back to its opening transform; Cmd/Ctrl+← and Cmd/Ctrl+→ jump to the flat and folded ends and leave the camera alone.
- Recolour a folded figure without refolding it. A flat figure keeps its fold graph after the fold, so a colour tick no longer rebuilds it.
- Let an open menu own the keys aimed at it. Escape on a context menu now closes the menu and keeps the selection, and Delete with a menu open no longer deletes the object the menu is about.

### Fixed

- Stop the simulator's rebuild changing the camera and paper colour. Refresh dropped the only session it had and reopened on the default view and the default blue.
- Make Cmd+drag pan wherever it starts. Over a canvas object's body, its resize or rotate handle, or a focused folded figure, it moved, resized, rotated or orbited instead; the middle button and the hand tool were wrong in the same places.
- Resize a text box around its text instead of sliding the text out of the frame.
- Stop the Windows build opening a console window beside the app, which quit the app when closed. Contributed by @amatouhake.
- Stop "Unpair from mirror" leaving the two vertices mirroring each other.

## [0.4.0] - 2026-09-04

Crease patterns read from images, and a tool for moving a vertex.

### Added

- Add **Detect CP from Image**, in beta. Point Ori Studio at a photo, scan or screenshot of a crease pattern and get an editable pattern back. The model is downloaded once per device, verified, and kept; the desktop app runs it natively on Apple Silicon and Windows, and everywhere else it runs in the browser engine, on the GPU where there is one. Two limits worth knowing: it works best on small and medium crease patterns, and a solve guarantees a pattern that folds flat, not necessarily the one the designer drew.
- Add **Move Vertex**: grab a junction, drag it, and every crease that ends there follows. Creases that merely pass nearby are left alone, the destination snaps like any other draw point, and the whole drag is a single undo.
- Repair a detected pattern before solving it. The pattern lands under a region that quiets the angle checks while its topology is fixed; Solve then runs the exact solver over the creases as drawn and offers Accept or Try again with a sentence saying what remains. A slow solve can be stopped, and a refused answer names what it would have broken.
- Add Settings ▸ Models, which lists the detector versions on this device and can download, update or remove them.

### Improved

- Let the desktop app bind the chords only a browser reserves. `Mod+R`, `Mod+W`, `Mod+T`, `Mod+L`, `F5` and others were refused on every surface because the web cannot have them — the desktop app can. `Mod+R` in particular is a shipped default twice over, as Optimize Scale and as Reflect Through Lines, and the browser was eating both. An imported Oriedita configuration now keeps the chords only a browser objects to, instead of discarding them.
- Hold a pleated design to one pitch. A detected box-pleated or 22.5° design came back foldable with every pleat crease wherever pixel noise had put it; equal spacings are now found and held, taking a 30-crease run from 1.1% spread to none.
- Pin a designed pattern to its angle family, so a solved 22.5° or hex pattern keeps the angles it was drawn on rather than settling near them. 30° and 15° join the families.
- Solve a hard pattern in a fraction of the time. Ordering the system by reverse Cuthill–McKee and reusing its symbolic factor takes a 7.7-second solve to 0.09 seconds.
- Say when Big-Little-Big is what stands between a pattern and folding flat, rather than reporting a clean solve for a pattern that still will not fold.

### Fixed

- Stop the flat-foldability check answering differently depending on which way up the pattern is. The same pattern, rotated, reported between two and five violations that were not there, and no reported site survived every orientation.
- Stop counting auxiliary lines as folds. A guide line through a vertex made its four folds read as degree five — "cannot fold flat wherever the vertices sit" — about a vertex that folds perfectly well.
- Keep the app working on a page the browser has translated. Google Translate rewrites the text nodes React is holding, which took out whatever was on screen; the box-pleating optimizer dialog vanished every time it was run on a translated page.
- Stop a `$` in a share title corrupting the link's preview card. The title was expanded as a replacement pattern, splicing the rest of the document into a meta tag.
- Stop the share dialog reopening empty after a dismiss that lands while the link is still being created.
- Stop an armed shortcut capture eating the whole keyboard.
- Ask the renderer's own question when probing WebGL support, so a browser that matches extension names case-sensitively no longer yields a probe that says "supported" and a renderer that throws.
- Stop File ▸ New advertising a `Mod+N` no browser will ever deliver.

## [0.3.1] - 2026-09-01

The first release you can use on a tablet or a phone.

### Added

- Add touch support throughout: a tablet workspace, a phone layout, and an installable PWA. Gestures are arbitrated across the whole crease-pattern surface, so a pinch no longer fights a drag, and the phone toolbar and tool sheet can be given your own favourites.
- Add context menus to every canvas surface, so the verbs a thing offers are reachable where the thing is.
- Add a view cube to the Simulate workspace for orienting the folded model.
- Fold paper that has a hole in it. A sheet with an interior boundary is no longer refused as unfoldable.
- Add an Insert menu, and let creases be drawn at an active fold angle rather than only assigned one afterwards.
- Solve fold angles for undecided creases, and stop a silent solve reading as success.
- Bisect parallel creases between two crossing destinations, which Angle Bisector previously had no way to express.
- Let a click select creases with the lasso tools, not only a dragged loop.

### Improved

- Draw the document grid and non-180° fold angles into exported and shared images, so an export looks like what was on the canvas.
- Default non-180° creases to the opacity display, making a partially folded crease legible at a glance.
- Take the stroke-sizing reference off the render path and bound the orbit-camera queue, removing zoom and orbit stalls that grew with the session.

### Fixed

- Stop the simulator mirroring every crease pattern. The simulated model was a reflection of the sheet it came from.
- Fix a crease pattern that simulated as two torn halves, and close the 3D layer-order hierarchy before searching it.
- Stop a selected mountain crease reading as a valley.
- Read ORIPA's line-type codes the way Oriedita does, so `.cp` files round-trip with the right assignments.
- Fix Angle Bisector on parallel lines, and the rendering blow-up it caused.
- Let Make Auxiliary reach an unassigned crease.
- Let creases take a press from the image or text sitting under them.
- Ask the worker before committing a simulator canvas, fixing a blank render on some Linux systems.
- Stop the welcome screen's figure taking the page down with it.
- Draw folded figures above crease points and vertices, and stop a live transform stranding the fold-angle badges.
- Let a design be authored beside an imported crease pattern, and balance the design tab's two ends.
- Correct several Japanese translations.

## [0.3.0] - 2026-09-01

Not released. The tagged build lost its Intel macOS leg to a toolchain
configuration error, so no artifact was ever published under this version.
Everything intended for it shipped in 0.3.1.

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
