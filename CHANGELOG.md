# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-10-30

A Layer order dialog that chooses how a flat folded figure's layers stack, in Edit, the Diagram, Pose and Fold, and empty Diagram steps that offer a pattern and an Import menu straight away.

### Added

- Choose how a flat folded figure's layers stack in the new **Layer order** dialog. Pick faces on the crease pattern or on the folded figure, and build constraints as sentences, such as "D in front of H, K" or "A behind B". The dialog previews each constraint before you add it, says which constraints clash and why, counts the layer orders that fit, and steps through them with ‹ ›. ⌘Z and ⇧⌘Z undo and redo every change in it. View the figure from the front, the back or the side, with X-ray and Rotate Left and Right. A large figure can take up to a minute to open, with Cancel while it works.
- Open Layer order wherever a flat fold appears. In Edit, open it from a folded figure's toolbar, context menu or Properties, or fold a selected sheet straight into it with **Fold with layer order…** (Shift+G). In the Diagram, a step's Layer order row edits its order, and ‹ › steps through the solutions that fit its constraints. Pose has **Edit order…** and ‹ › on its toolbar, and Fold's **Import CP** chooses its order in the dialog. A project keeps the constraints and the order they chose; a figure without constraints folds and saves exactly as before.

### Improved

- Fill an empty Diagram step in fewer clicks. Its Step pane shows the pattern picker at once, two patterns to a row, starting on **Folded**. The empty diagram and an empty step's card both have an **Import** menu (From File, From References, From Fold), and an import into an empty step fills that step instead of adding a new one after it.

### Fixed

- In Fold, **Send to Edit** sends the step you have selected. It sent the last step's crease pattern, and a broken step after the selected one turned the button off.
- Draw arrowheads in the Fold workspace at a readable size. They were about 5 pixels across with the Diagram's pens.
- Undo a fold made from the selection toolbar. Undo did nothing, or undid the step before it and took the new figure with it.
- Undo a Delete or a Refold of a folded figure and get back a figure that still folds. It came back as "invalid folded figure handle", or drew another figure's fold.
- Keep File ▸ New, Open and Import from replacing the document while a dialog is open. A file opened from the Finder while a dialog is up now asks you to close the dialog first.
- On Linux, pick a `.oriconfig` file in **Import Oriedita Shortcuts**: the file chooser listed only folders. Image and import choosers also show files with upper-case extensions, such as `IMG_0412.JPG`.

## [0.7.1] - 2026-10-25

Drawing on the Diagram's Annotate canvas lands under the pointer in the Mac app and Safari.

### Fixed

- In the Mac app and Safari, draw on the Diagram's Annotate canvas where you press. A line started away from the pointer: above and to the left at the usual fit zoom, below and to the right when zoomed in, and off the picture at high zoom. How far a press reached to pick or snap to a mark also grew and shrank with the zoom. Chrome and the Windows app were not affected.

## [0.7.0] - 2026-10-25

A new Fold workspace that folds a sheet step by step and sends the steps to the Diagram, rotations by any angle in the Diagram, and large crease patterns that delete, select, undo and simulate without stalls.

### Added

- Fold a sheet step by step in the new **Fold** workspace, the way you would by hand. Locate a line with the Huzita–Justin axioms, a free line or an existing crease, or mark equal parts or a ratio with **Divide line**. Then fold through the layers you pick (the top flap by default): valley, mountain, precrease (the whole line, a segment or a pinch), inside and outside reverse, crimp, pleat, squash, petal, rabbit ear, swivel, open and closed sink and unsink; turn the paper over or rotate it. Every step keeps its flat folded form, crease pattern and layer order. The step strip branches, with undo and redo; unfold the last step or go back to any step; **Repeat on the other side** replays a run of steps across the sheet's symmetry axis. **Import CP** starts from a crease pattern file, a sample, or Edit's sheet or folded figure. A project that holds Fold steps needs Ori Studio 0.7.0 or later; earlier versions ask for an update instead of opening it.
- Send Fold steps to the Diagram as illustrated steps, or pick them in the Diagram's **From Fold** browser. Send a step to Edit, export it as FOLD with a frame per step, or export step pictures.
- Rotate by any angle in the Diagram. A turn between steps and a rotate mark offer **Custom** beside 1/8, 1/4 and 1/2 of a turn, with an angle from 0.1° to 359.9°, such as 135°.

### Improved

- Delete creases from a very large crease pattern in under a second. On a project of 489,093 creases in 204 sheets (measured in the web app), deleting 20 selected sheets took 30 seconds and Select All then Delete nearly three minutes, and nothing else on the canvas responded until it finished.
- Select, undo and redo in very large crease patterns faster, with less memory. On the same project, selecting a sheet takes about a third of a second where it took two thirds, and Undo or Redo of an edit about half a second where it took two and a half. Each edit kept a full copy of the pattern for undo; the browser tab ran out of memory after 39 edits, and now holds the full 100 steps of history.
- Play and scrub a simulation of a very large crease pattern smoothly. On the same project, Play ran at 3–4 frames a second and reached about 30% folded in 10 seconds; it now runs at full frame rate and folds completely in that time. Opening Simulate from the selection toolbar is ready in under 4 seconds, where it kept the app busy for minutes after it appeared.

### Fixed

- Open the paper export dialog and select large parts of a large crease pattern without a crash. The dialog could crash while drawing the page, and a large selection could crash the selection toolbar and take the canvas down with it, most often in the Windows app.
- Reflect a selection over a line without creating broken creases when both points of the axis are the same point. Two angle-restricted crease tools had the same problem with a one-point pick. References now skips broken creases already in a pattern, instead of refusing to open.
- Say "The search timed out." when an ExplOri search runs out of time while its results download, instead of reporting an unknown error.
- Stop showing "Something went wrong in the background" for harmless browser notices, which caused most of these messages.
- On the web, keep a tab opened before an update working. A feature first used after the update, such as **Export all steps**, could fail to load until the page was reloaded.

## [0.6.2] - 2026-10-20

Diagram steps imported from Defox projects and from batches of crease patterns and pictures, an example crane to start from, a redesigned Layers pane, very large crease patterns that open, select and simulate in seconds instead of minutes, and external links that open from the desktop app.

### Added

- Import steps into a diagram with **File ▸ Import Diagram Steps…**, the empty Diagram's **Import…** button, or by dropping files or a folder on the Diagram. Bring in a batch of crease patterns and pictures (SVG, PNG, JPEG or WebP), or a **Defox** project. Each crease pattern is folded into a step and added to Edit beside what is already there, in a grid whose columns and gap you choose; one that doesn't fold keeps its crease pattern as the step's picture. A Defox project keeps each saved view as Defox drew it, symbols included, linked to its crease pattern. **Finish import now** stops folding and keeps the remaining crease patterns as previews, and one Undo takes the whole import back out of both Edit and the Diagram.
- Open an example from an empty Diagram: under **New to diagrams?**, **Open the example crane** opens a 28-step crane diagram with its crease pattern and title block, and **Watch the walkthrough** links to a video tour.

### Improved

- Open and work in very large crease patterns in seconds instead of minutes. On a project of 489,093 creases in 204 sheets (measured in the web app), opening takes under 6 seconds where it took 29; selecting a sheet brings up its toolbar in under a second where it took 68; Simulate opens on the sheet in under 3 seconds where it took 85; and the toolbar's Save to image and inline simulation take under a second where they took 13 and 15. Export PNG… and Export SVG… of the whole canvas run about four times faster, with identical results.
- Move through large diagrams without stalls. The Steps and Pages views draw only what is near the view, and the Pages view pans and zooms a cached picture of each page, sharpened once the zoom settles; exports are still drawn from the vectors. Scrolling a 205-step, 23-page diagram no longer stalls for seconds at a time.
- Read a crease pattern's sheets the same way in Edit, Diagram, Simulate and References: a sheet is the area inside a closed outer border, and a border line drawn inside it belongs to the sheet instead of splitting it. A sheet with such a wall now gets the selection toolbar and is planned in References instead of refused. Simulate and References list only closed sheets, and Simulate's list counts each sheet's creases, as References does. A Diagram step linked to one half of a walled sheet now reads as missing; relink it to the whole sheet.
- Lay out the Diagram's **Layers** pane, in the Pages view and in Annotate, as one-line rows with Delete at the end of each, under a header that says what the list holds ("Page 1 · 7 steps"). The inspector sits below in its own scrolling region; drag the divider to resize it, or double-click it to reset. In the Pages view a step's inspector also sets its picture and its instruction. A mark drawn more than once is numbered ("Circle 2"), and a hand-placed step is marked with a dot instead of a MOVED badge.
- Join an auxiliary line left in pieces with **Delete Extra Vertices**. A vertex where two collinear auxiliary lines meet and nothing else does is now removed, while one that a crease ends on stays. Creases are treated exactly as before.

### Fixed

- In the desktop app, open external links in your web browser: the toolbar's Discord button, the About dialog's links, Open in ExplOri, Visit DEFOX, the design attribution bars, the error screen's Report an issue, and the Linux update card's download link. They did nothing, and the start screen's Discord and GitHub buttons replaced the app's own window with the website. On the web, those two buttons now open a new tab instead of leaving the app.
- Fold a sheet in Simulate and in inline simulations when a crease ends part-way along a border side that isn't split there. The sheet was read as one bare face and stayed flat. Exporting, saving to an image or sharing such a sheet from the selection toolbar now also keeps auxiliary lines that end the same way; they were left out.
- Draw auxiliary lines under a flat folded figure's edges in exports and Diagram pictures. Their grey ends were painted over the black outline.
- Save a project without a second copy of its crease pattern. A project that wasn't imported from a FOLD file gained a duplicate of its pattern the first time it was saved after reopening. A file already saved with the copy keeps it.
- Keep memory in check over a long editing session. Crease edits, selections and grid changes each kept a full copy of the pattern in the undo history with no limit; the history now keeps the last 100, as it already did for annotations and folded figures.

## [0.6.1] - 2026-10-20

Not released. In the tagged build, a step added in the Diagram's Steps view
stretched to the full height of the pane in Safari and the desktop app, so it
was withdrawn before it was offered as an update. Everything intended for it
shipped in 0.6.2.

## [0.6.0] - 2026-10-16

A new Diagram workspace for printed folding instructions, Pin and Pull tools in Simulate, OBJ export of a simulated fold, and References that reopen as they were saved.

### Added

- Make printed folding instructions in the new **Diagram** workspace. Each step's picture is a pattern from the Edit canvas — shown as its crease pattern, folded (flat, with any of its layer orders, or 3D) or simulated at any fold percentage — a step pulled from References, its marks editable, or a picture of your own (SVG, PNG or JPEG). Turn, rotate or orbit it, spread a flat fold's layers apart so the hidden edges show, and draw the standard symbols: valley, mountain, fold-and-unfold, pleat, push, white and solid arrows — shaped node by node if you like — fold lines, angle bisectors, equal divisions, right angles, circles, stars, eyes, ovals, rectangles, labels, callouts, close-ups, and X-ray windows that show what lies under the top layers; put a mark behind a flap to draw it dotted there; copy, paste and flip marks. Enlarge an area of one step and show the next steps as a window of it. Turn-overs and rotations go between steps, unnumbered. Lay the steps out on A4, A5, B5 or Letter pages, as a grid or a winding flow, the paper kept one size from step to step and zoomed in where the model stays much smaller; give any page its own number of steps and move steps on the page by hand. Open page 1 with a title block — the title, the credits and a description beside the crease pattern, with the finished model in front of it — and export a PDF with the text embedded, or a ZIP of the step pictures. A step linked to a pattern says when the pattern has changed and refreshes on request; moving the pattern on the canvas is not a change.
- Pin faces in the **Simulate** workspace and fold the rest of the paper around them. A tool rail beside the canvas holds Orbit (O) and Pin (P).
- Pull the paper open in Simulate with the **Pull** tool (U): pin what should hold still, drag any other part, and it turns about its creases and stays where you let go.
- Export a simulated fold as **OBJ**, from Simulate and from inline simulations, with texture coordinates taken from the unfolded sheet, so it imports into Blender ready for a texture.
- Export a paper style from Settings ▸ Paper with an **Export…** button beside Import…; the two slots are now named Display style and Export style.

### Improved

- Reopen a project with the **References** workspace as it was saved — the plan, its settings, the mode, the sheet, the open card and the chosen ways — without planning again.
- Export each face of a flat folded figure as one editable path, woven flaps included, so reshaping a face in Inkscape moves its fill and outline together.
- Draw a number field as one joined control, with its unit inside the field.
- Choose Simulate's render Style (Paper or X-ray) and Color (Paper or Strain) with segmented controls instead of dropdowns.
- Give the crease-angle popover the same look as the other tool windows.
- Leave a hidden layer's row blank in the Layers menus, instead of showing its icon as if it were a third state.

### Fixed

- Save and Save As from every workspace when a crease pattern is open on its own. They were greyed out everywhere but Edit.
- Import SVG reference images on the Edit canvas. Insert ▸ Image and drops offered `.svg` but every SVG failed to load.
- Fit the View pane's grid scale rows to the pane instead of running past its edge.
- Fold the same way every time Simulate opens. Whether the opening material push landed before or after the first settle could flip a bistable fold, such as the crane at 60%.

## [0.5.2] - 2026-10-01

One paper style and one export dialog for every folded surface, other ways to fold a precreasing step, and update checks that work behind a proxy.

### Added

- Fold a precreasing step another way. Beside the planner's pick, each card in the References workspace offers the best construction of each other kind the paper allows at that step — corner to corner, a corner bisected, through two marks, a swing onto a crease — up to four in all. Dots along the card's foot show how many there are; "Way 2 of 3" under the sentence, ↑/↓, the context menu, or a vertical swipe on a phone switches between them, and the card, the diagram and the fold animation all follow the choice. Switching a way never re-plans the rest of the sequence.
- Add one **paper style** for every surface that draws paper — the simulator, the 3D and flat folded figures, and the References steps — under Settings ▸ Paper: paper colours, lighting, and a pen each for edges, folds, diagram creases, auxiliary creases and arrows. It has a Display slot and an Export slot, Default and Diagram presets alongside saved and imported ones, and per-object overrides in the Properties pane that are saved with the `.osf` file.
- Export every paper surface through one dialog, with a live preview of the exact file: SVG or PNG, the style, a size in millimetres, margin, background, PNG resolution and whether to keep hidden faces. SVG exports keep each face as a whole object in view order, with buried layers kept and marked. In References, **Export all steps…** saves the whole sequence as one ZIP.

### Improved

- Draw a folded figure's **Shadow** as a soft contact shadow cast by each layer onto the paper beneath it: continuous along an edge, rounded at corners, kept on the paper it falls on, and deeper where the ledge is more sheets tall. The old per-edge bands spilled over flap tips, notched at corners and darkened where they overlapped. SVG and PNG exports draw the same shadow.
- Draw ExplOri result trees as their mirror image: pairs of flaps as exact reflections on either side of a dashed mirror line, turned to agree with the crease pattern beside them. A pattern with no mirror is drawn without a line.
- Give every menu one row style — inset, rounded, filled solid under the pointer or the keyboard — with a check mark on the current value and a red fill on destructive rows. Highlighted text now meets WCAG AA contrast in every theme; the old white-on-accent text fell short in 22 of 23.
- Round every control, card and floating surface to one radius, so a number field and its stepper buttons match the select beside them. Design's tab strip is the same height as the References and Simulate headers, and the Edit workspace's tool card animates its height instead of jumping.
- Leave the References fold animation off until asked. **Auto-play folds** now defaults to off, so a fold plays on Play, Space or the menu; turn the setting on to have each fold play on arrival. A choice already made either way is kept.

### Fixed

- Check for updates behind a proxy. The desktop app's update check ignored the operating system's proxy settings, so on a machine with one configured every check failed while the rest of the app worked. A check now also gives up after 30 seconds instead of hanging, and a failure is reported by its cause.
- Close an open menu-bar menu when clicking on the crease pattern canvas. The click landed but the menu stayed open.

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
