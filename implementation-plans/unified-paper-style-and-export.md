# Unified paper style and export

## Goal

One controllable style for every surface that draws paper — the simulator
(Simulate workspace and inline windows), the 3D folded figure, the flat 2D
folded figure, and the References precrease step diagrams — with:

- named, shareable presets (a JSON file), and a **display** style that may
  differ from the **export** style;
- uniform SVG/PNG export from every surface, where what is on screen is what
  is exported by default: every face is an SVG object, ordered for the current
  view; hidden layers are kept so deleting a face reveals the one beneath; no
  sub-face slivers; export stroke widths equal display stroke widths;
- two new cross-surface options: show/hide aux creases, and *erode* (creases
  pulled back from the edge of the face they lie on, step-folder's `clip`);
- per-object overrides of any applicable style field, edited in the Properties
  panel and saved in `.osf`.

Out of scope, deliberately: an Origami House preset (the dash vocabulary will
exist so it can be authored by hand later), and a multi-step diagram document
(single-view exports that match are the deliverable; the page comes later).

## Findings

Recorded so they are not investigated twice. All anchors are to the state of
`main` at 1e5f7480a.

**F1. The exported stroke is the display stroke read in a different unit.**
The kernel stamps Oriedita's Java2D `BasicStroke` width `1.200000048` on every
folded edge (`crates/oristudio-cp/src/folding.rs:4360-4367`; the 3D projector
copies it, `foldedFigure3dProjection.ts:290-298`). Upstream that is a screen
pixel. The CP canvas honours that reading — it passes no `foldedStrokeWidthPx`,
so the base is `viewport.dpr` (`reglRenderer.ts:437-441`) and the shader draws
`max(1, dpr × 1.2)` device px (`strokeProgram.ts:76`), 1.2 CSS px at every zoom.
The export reads the same number as a **model length**:
`stroke-width = max(0.4, width × scale)` with `scale = 1024 / longestExtent`
(`lib/foldedFigureSvg.ts:186`, `folded/foldedFigureExport.ts:78`), so a
100-unit figure exports 12 px lines on a 1024 px page. The CP export dialog
multiplies by a further `fit` (`lib/creaseExport.ts:1145-1160`). The 3D window
uses a third number, `1.5 × dpr` (`folded3dWindow.ts:150,210-213`). The
simulator is the only surface where display and export agree, because its SVG
page unit *is* the device pixel (`svgRenderer.ts:274-275`), which also makes a
Retina export twice the frame size and the PNG 2× again.

**F2. Slivers are sub-faces, plus three things stacked on top.** The flat
kernel emits one `fill_path` per Oriedita subface (planar overlap region) and
never unions same-face subfaces (`folding.rs:3965-3993`, oracle-gated). The 3D
projector merges under the key `cell × (face_count+1) + slot` so two cells of
one visible face never join (`foldedFigure3dProjection.ts:930`). Then: no
minimum-area filter on earcut output (dust); the consecutive-run merge breaks
at the first non-adjacent piece and earcut's fan is not adjacency-ordered
(`coplanarRuns.ts:119-140`); `outlineOf` refuses anything but one simple loop
(`:148-190`). The most *visible* cause is simpler: fills are written
`stroke="none"` (`foldedFigureSvg.ts:185`), so every boundary is an
antialiasing crack — the simulator strokes each opaque face in its own fill
(`svgRenderer.ts:44-51, 473-476`) precisely to hide those.

**F3. Inside a 3D figure, stacked layers have no thickness to show.** The
kernel places faces at true fold angles, so the ±180° layers *within* a 3D
figure are exactly coplanar. Layer order chooses which skin to submit per
plane; the depth buffer resolves only plane-vs-plane (`folded3dMesh.ts:11-38`,
`foldedMeshSource.ts:235-260`). Displacement was tried and rejected (creases
sit on cell boundaries). The window then removes the remaining cues by choice:
orthographic camera, light on the view axis `[0,0,1]`
(`folded3dStyle.ts:77-78`), and `display_shadows` accepted but drawn as nothing
(`foldedFigureAppearance.ts:123-128`). So a 3D figure's stacks read as a
layer-order drawing, and any depth for them has to come from lighting and
shadow rather than geometry — see D7. (Terminology, for later readers: a
*flat-folded* figure is one that folds completely flat — the 2D figure. A 3D
figure is not flat-folded, however many of its layers stack.)

**F4. The simulator export drops fully hidden faces.** `renderMeshToSvg` runs
`findVisiblePieces` unless `cullHidden === false` (`svgRenderer.ts:246-252`,
`hiddenPieces.ts`), by design so buried polygons do not take clicks in a vector
editor. Partially covered faces are written whole, which is why deleting a top
face *usually* reveals what is under it. The flat figure is worse: hidden
layers do not exist in its stream at all — `visible_subface_face` picks one
winner per subface before drawing (`folding.rs:4261-4302`).

**F5. Painter's order has a measured ceiling.** On a 126-face model the
simulator emits 369 polygons; reordering with a SAT test reached 360 of a
theoretical 243 and was reverted (`simulator-view-svg-export.md:375-405`). A
crease lies on the face it separates and must draw over it, so the BSP scatters
that face to both sides. One object per visible-face region under painter's
order is not reachable for the simulator or for non-coplanar 3D geometry. It
*is* reachable for the flat figure and for the coplanar layers of a 3D figure:
there the kernel has already resolved visibility, faces of one plane sit
faces-first in one BSP node, and skins are area-disjoint.

**F6. Five surfaces, five owners.** Paper colours: simulator app setting
(`simulator-settings`) with `--sim-paper-*` `:root` constants; folded figures
per-figure Oriedita model in `.osf`; References theme ground. Three red/blue
pairs for M/V (`simulatorPalette.ts:52-53`, `--fold-mountain/valley`, CP line
colours). Dashes: Oriedita fixed-px `[10,3,3,3]/[8,8]` in the simulator vs
width-relative Origami House ratios in References (`diagramInk.ts:66-69`).
Aux: the simulator cannot express one — source `F` edges and triangulation
diagonals are both `'F'` (`prepare.ts:791`) and code 3 is never drawn. Light:
simulator direction hardcoded `[-0.45,0.58,0.68]` (`simulatorPalette.ts:86`),
3D on-axis, the others unlit. The shade formula is copied three times
(`meshRenderer.ts:473`, `svgRenderer.ts:551`, `canvas2dFrame.ts:666`).
References has no export at all. `RenderSettings`
(`packages/origami-simulator/src/webgl/meshRenderer.ts:78-184`) is already the
contract for the simulator GPU, the simulator SVG, the inline windows and the
3D window (adapter `folded3dWindow.ts:187-220`); `simulatorPalette.resolveRenderSettings`
(`:176-214`) is its single resolver.

**F7. Standing WYSIWYG bug, independent of this plan.** The canvas-2D
simulator path (no WebGL2, or any fold profile / sequence-step simulation)
never forwards camera or settings to the worker (`SimulatorViewport.tsx:392,
425-430`; `useSimulatorRuntime.ts:680-693`), so its export is
`DEFAULT_RENDER_SETTINGS` at the opening camera.

*Residual after Phase 0 (follow-up, not a blocker).* Camera and settings now
travel with the request, but the two sides still measure the framing radius
at different moments: the screen holds `surface.framingRadius` from the first
draw after setModel/resize/theme (`canvas2dFrame.ts`), while the worker on
the CPU path is never `fitted` before export (`refitOnce` is reached only
from the GPU branch of the tick) and fits from the positions being exported.
For a model that has folded since its first frame the worker's radius is
smaller, so the export draws the model larger against its CSS-px crease
width than the screen does — the crease-to-model ratio reads thinner; the
orientation, zoom and palette match. Fix is either to carry the held
centre/radius with the camera payload, or to give the CPU path the same
first-settled-frame refit the GPU path has, invalidated where the viewport
invalidates its surface. Phase 2 moves this export onto `PaperScene`, which
is the natural place to close it.

**F8. Front/back conventions agree; a comment says otherwise.** The header
of `folded3dMesh.ts:73-80` states that a 3D figure's two tones are opposite an
inline simulation's because "the simulator lifts FOLD faces with `[x, 0, y]`".
PR #325 changed that lift to `[x, 0, −y]` (`geometry.ts:56`), after which both
surfaces cancel `MeshRenderer`'s determinant −1 view in their own way and paint
the same physical side the same colour — verified on screen 2026-09-21. The
comment is stale, not the behaviour.

**F9. Why the 3D figure's export does not come from the window's mesh.**
Recorded in `folded-figure-viewport.md` §5. The projector predates the GPU
window and was kept as the vector path for three reasons: (a) routing through
`renderMeshToSvg` drew 1.0–1.7× the polygons because the epsilon that
separated layers for the depth buffer stopped `coplanarRuns` merging them; (b)
a vector drawing wants the kernel's exact `cell_stack` order, not an order
re-derived from perturbed geometry; (c) R7 — the CP export dialog draws the
stored snapshot, so a second vector drawing would disagree with it. (a) no
longer applies: the window stopped displacing layers (`folded3dMesh.ts:11-38`,
F3), so the mesh is exactly coplanar. (b) is satisfied by carrying the kernel
order on `BspItem.order`, which the projector already does through the same
simulator BSP the mesh route would use. (c) still holds and is why the
projector retires only in Phase 7. The real defect is that the projector is a
*second builder* of the same geometry as `folded3dMesh.ts`, which is where the
3 + 22 pinned camera disagreements come from.

**F10. "Hidden lines" is inert on the GPU path.** `showHiddenLines` is read
only by the canvas-2D fallback (`canvas2dFrame.ts:215, 288`); `meshRenderer.ts`
never sees it, so on any WebGL2 machine the checkbox, the context-menu item
and the `H` shortcut do nothing. Removed rather than implemented (D11).

**F11. The 3D window is orthographic by choice, for a frame-sizing reason.**
`withoutPerspective` (`foldedMeshSource.ts:185-200`) pushes the eye to
`depthRange × 5000` because the window's frame is sized from the model's
bounding *sphere*, and "under perspective a point near the eye grows by up to
45%". That figure is the scale of the nearest point, which sits at the frame's
centre; the sphere's *silhouette* under the simulator's `camDist = 3.2r` is
`r·d/√(d²−r²) = 1.053r`, a 5.3% growth. So perspective needs the frame radius
scaled by that factor, not a resizing frame. The other stated reason — the 3D
figure projecting like the flat figure beside it — is dropped by D7.

## Decisions

Taken in the design discussion on 2026-09-21.

- **D1. Style is app-wide, two slots, with per-object overrides.** `display`
  and `export`; `export` is `null` = same as display until the user changes
  it. Presets are JSON files. Every document object that draws paper — flat
  figure, 3D figure, inline simulation — carries a sparse `appearance` record
  of the fields the user overrode, edited from the Properties panel, persisted
  in `.osf`; everything not overridden follows the app style. Existing files:
  a figure whose Oriedita colours equal the defaults is treated as following;
  any other colour becomes an override (so a user adopting a style sees their
  old figures follow it, and their deliberately recoloured ones stay put).
  The style is **self-contained**: every colour is an explicit hex, there is
  no "follow the theme" value anywhere, and no background — surfaces render
  transparent and the app paints its theme ground beneath them.
- **D2. Slivers, tier A.** Dust floor, seam hairline, merge by visible face
  wherever painter's order allows — one object per face for the flat figure
  and for coplanar 3D layers, the simulator's measured ceiling elsewhere. No
  polygon-boolean visibility arrangement.
- **D3. Export page.** Physical units — the SVG carries `width`/`height` in
  mm with a matching `viewBox`, so Illustrator, Affinity and Inkscape read a
  0.75 pt stroke as 0.75 pt. Artwork crop at the current camera *orientation*
  plus padding; zoom-independent by default, with a **sheet size** option
  (mm) that scales the artwork and leaves the pens alone, as those editors do.
  Default sheet size = the sheet's on-screen size (1 CSS px = 0.75 pt), which
  is exact WYSIWYG. PNG takes a dpi. "Frame" (the viewport as seen, with clip)
  is a later option. The simulator's page unit changes from device px; its
  pinned page-size tests are re-pinned deliberately.
- **D4. Buried faces are kept by default** (`keepHiddenFaces: boolean`, an
  export option, not a style field — distinct from *hidden lines* below), on
  every surface. For the flat figure that means emitting every layer in
  stack order, which needs a new kernel accessor (D6).
- **D5. The 3D projector is retired, in two steps.** Export moves to the mesh
  → simulator BSP → scene path first (WYSIWYG by construction, one ordering
  implementation). The `.osf` picture and the fallback canvas keep coming from
  the projector until the scene can be stored and drawn in its place; then the
  projector goes. The parity harness (`folded3dProjectorParity.test.ts`) is
  the gate for the first step.
- **D6. Flat figure: display stays on the oracle-checked stream.** Colours
  reach it by model rewrite (existing path); width by `foldedStrokeWidthPx`;
  aux creases as a web-drawn overlay. Export uses a new read-only kernel
  accessor beside the untouched drawer (per-subface face stack, per-face
  folded outline with per-edge role, folded aux segments), and a Rust test
  asserts the accessor's top face per subface equals the drawer's — the
  "right faces" assurance carries over. No M/V dash rendering on the flat
  figure (it has no visible M/V).
- **D7. The 3D figure renders exactly as the simulator does.** One-point
  perspective through the unmodified `cameraUniforms` (drop
  `withoutPerspective`; the frame radius grows by the perspective silhouette
  factor, F11), the same directional light from the style's azimuth/elevation,
  and no shadow — the simulator's GPU path has none, and its canvas-2D drop
  shadow (`canvas2dFrame.ts:450-482`) goes too so the fallback path matches
  the export. The style has a `light` field and no `shadow` field. The flat
  figure is drawn in flat colour with no light; its Oriedita shadow band stays
  as that figure's own parity option, off by default, not in the style;
  `display_shadows` leaves the 3D figure's appearance options, where it was
  accepted and drawn as nothing.
- **D8. Erode = step-folder `clip`** (`src/defox/segment.js:9-28` upstream):
  for a crease drawn on a face, each endpoint that lies on that face's
  boundary is pulled toward the segment midpoint by a fixed distance; interior
  endpoints stay; a segment that would invert collapses and is dropped. The
  distance is paper-relative (a fraction of the sheet), not px.
- **D9. No front/back flip.** Retracted after F8: the surfaces already
  agree. Phase 0 fixes the stale header comment in `folded3dMesh.ts`.
- **D10. Widths are in points, and the style is a set of role pens.** People
  diagram in Illustrator/Affinity, and the Origami House template
  (`~/Documents/art/origami/misc/origami_house_template.svg`, A4 in mm) states
  every line in pt. A pen is `{ width: pt, color, dash: multiples of width | null, cap }`;
  the template's dashes are already written that way (mountain 8:2:1:2,
  valley 4:2, hidden 1:2). One pen per role: edge, mountain, valley, aux,
  hidden fold, hidden edge, arrow. The simulator's "colour / mono /
  mono-dashed" switch becomes a quick way to write the mountain and valley
  pens. On screen a pen is drawn at `width × 4/3` CSS px, non-scaling with
  zoom, as every surface draws today.
- **D11. Hidden lines are removed, not unified.** The simulator setting, its
  checkbox, context-menu item, shortcut, palette field and canvas-2D branch
  all go (F10). The style has no hidden-line pens; the Origami House preset's
  hidden fold/edge pens have nothing to drive and are not transcribed.

## Approach

Three pieces, in plain terms: one **style sheet** every surface reads, one
**picture format** every surface produces on export, one **painter** that turns
picture + style into SVG (and PNG). Live views stay on the GPU but read the same
style and the same unit rules, so they match by construction.

### 1. `PaperStyle` — the style sheet

New module `apps/web/src/lib/paper/` (no CP-workspace or store dependency, so
the simulator worker and every surface can import it):

```ts
interface Pen {
  width: number;                 // pt
  color: Hex;
  dash: number[] | null;         // on/off run lengths in multiples of width; null = solid
  cap: 'butt' | 'round';
}
interface PaperStyle {
  version: 1;
  paper: { front: Hex; back: Hex };
  edges: Pen;                    // raw and folded edges
  mountainFolds: Pen;
  valleyFolds: Pen;
  auxCreases: { visible: boolean; pen: Pen };     // existing / auxiliary creases on the surface
  arrows: Pen;                   // References steps
  erode: number;                 // fraction of the sheet, 0 = off
  light: { enabled: boolean; azimuth: number; elevation: number };   // simulator + 3D figure only
}
```

Dashes: SVG's `stroke-dasharray` is a list of alternating on/off run lengths
that repeats, and every dashed line the app draws today is one of those —
Oriedita's CP line styles `[10,3,3,3]` / `[8,8]` in device px, References'
`[12.8,6.4]` / `[6.4,3.2,1.6,3.2]` (8:4 and 4:2:1:2 × its 1.6 width), its
`dotted [1.2,3.6]`. So `dash: [8,2,1,2]` at width *w* is `8w 2w 1w 2w` — long
dash, gap, dot, gap, the dash-dot mountain; `[4,2]` is the dashed valley;
`[1,2]` is dotted (square dots with `butt`, round with `round`); `null` is
solid. Multiples of width rather than absolute lengths because the template
writes them that way and because a 0.4 pt and a 0.75 pt line should both read
as "dotted" — the resolver multiplies by the device-px width once. The painter
and the GPU dash both centre the pattern on each segment (phase =
half the remainder) so both ends of a fold line look the same, which is what
References' per-primitive `dashPhase` does by hand today.



- `resolvePaperStyle(style, policy, dpr)` replaces `simulatorPalette.resolveRenderSettings`
  as the one resolver; it turns pt into device px once, and `RenderSettings`
  gains the aux and hidden pens, `erode`, and a light direction derived from
  azimuth/elevation. The shade band moves to one
  `shading.ts` imported by the GLSL builder, the SVG path and canvas-2D.
- `SurfaceStylePolicy` — one table declaring, per surface, which fields
  apply and which are forced: flat figure unlit, no arrows outside
  References, no light on References. The Properties panel shows exactly the
  applicable fields.
- Store: `settingsStore` gains `paperStyle: { display: PaperStyle; export: PaperStyle | null; presets: PaperStylePreset[] }`,
  persisted under a new `STORAGE_KEYS.paperStyle` with a normaliser (the
  `normalizeSimulatorSettings` pattern). First load seeds `display` from the
  existing `simulator-settings` values; the simulator keeps only its non-style
  keys (render mode, faces/edges, view cube, physics).
- Presets: `PaperStylePreset = { version: 1; name; author?; style: Partial<PaperStyle> }`.
  Built-ins under `lib/paper/presets/` (Ori default, Oriedita, Black & white,
  Origami House). Import/export as `.json` through `fileService`. The Origami
  House values, transcribed from the template's own labels and dash arrays
  (the file is not committed): paper white / colour side 30% grey (`#b3b3b3`);
  edge 0.5 pt solid; mountain 0.75 pt dash 8:2:1:2 butt; valley 0.75 pt dash
  4:2 butt; aux ("Crease lines") 0.25 pt solid; arrow 0.75 pt; ink
  `#231f20`; no light. (Its hidden fold/edge pens are not transcribed, D11.)
  The template disagrees with itself: its labelled 0.75 pt swatches carry
  mountain 8:2:1:2 and valley 4:2, while its magnified demo (7.56 wide) carries
  4:2:1:2 and 8:4 — the ratios `diagramInk.ts:47-69` transcribed. The preset
  takes the labelled swatches; the maintainer dials it in by eye.
- Per-object overrides: `appearance?: PaperStyleOverrides` on each folded
  figure entry and each inline simulation, where `PaperStyleOverrides` is a
  sparse record keyed by field path (`'paper.front'`, `'edges'`,
  `'auxCreases.visible'`, `'erode'`, …) holding only what the user overrode.
  `effectivePaperStyle(appStyle, overrides, policy)` is the one merge. For
  folded figures the kernel's `FoldedFigureModel` colours and `display_shadows`
  are a *derived mirror* of the effective values — the store writes them
  through the existing `updateOristudioCpFoldedFigureModel` protocol whenever
  the effective value changes (a wasm `folded_figure_set_model` + re-snapshot,
  the same round trip a colour drag makes today), so `.ori` round-trip and
  the oracle-checked stream are unchanged and the model never has to be
  inspected to know what is overridden. See "Per-object overrides and `.osf`"
  below.
- UI: a **Paper** tab in Settings (display / export selectors, preset list,
  import/export, "Export uses display style"); the Simulator View Controls
  panel binds its rows to `display`; the Properties panel of every paper
  object shows the applicable fields with their effective values, and a
  per-row `reset` offered only while that row is overridden — the affordance
  `inlineSimulationProperties.ts:44-47` already uses for paper colours. The
  folded-figure Style menu keeps its colour rows, now writing overrides.

### 2. `PaperScene` — the picture format

```ts
interface PaperScene {
  bounds: Rect;                       // page units (pt) after projection
  sheet: number;                      // sheet extent in page units, for erode
  items: PaperItem[];                 // draw order, back to front
}
type PaperItem =
  | { kind: 'face'; face: number; side: 'front' | 'back'; rings: Point[][]; shade?: number; hidden?: boolean }
  | { kind: 'line'; role: 'edge' | 'mountain' | 'valley' | 'aux'; a: Point; b: Point; onBoundary: [boolean, boolean]; face?: number }
  | { kind: 'arrow' | 'symbol'; ... }  // References primitives
```

Faces and lines interleave: a face's own creases follow it, before nearer
faces cover them — that is what makes hidden layers deletable and what makes
`should_draw_paper_edge` semantics fall out of painter order. Each producer:

- **Simulator and 3D figure**: `meshToPaperScene(positions, topology, camera, options)`
  in `packages/origami-simulator` — the BSP half of today's `renderMeshToSvg`
  with additive options: per-triangle source-face group, explicit side (the
  kernel knows it; the simulator guesses by winding), coplanar order, and
  edge kinds with an `aux` code. Tier A merge: within a coplanar node, group
  by `(plane, face)`; `outlineOf` extended to multi-loop evenodd rings; area
  floor; cull kept *before* merge as documented, and skipped entirely when
  `hiddenFaces: 'keep'`. `prepare.ts` tags source `F` edges as aux, distinct
  from triangulation diagonals. The 3D figure's creases stay unbiased
  (`edgeInk 0`) so they remain in their plane's node.
- **Flat figure**: new `CpSession::folded_figure_paper_scene(handle)` beside
  the drawer, returning per subface `{ polygon, faces_top_to_bottom }`, per
  face `{ outline, front_up, edges: [{ a, b, role }] }`, and folded aux
  segments with their face. The web builds the face DAG from the stacks; if
  acyclic, a topological order gives whole faces; a strongly-connected
  component (woven flaps) is split at its subface boundaries, and only that.
- **Precrease step**: `diagramToPaperScene(primitives, frame)` from the
  existing `StepDiagramModel`; sheet → face, styled lines → lines with roles,
  arrows/turn-over/labels → `arrow`/`symbol`. Mid-fold frames (real z) go
  through `meshToPaperScene` with the flap as a one-face mesh.

### 3. `paperSceneToSvg` — the painter

`paperSceneToSvg(scene, style, page: { sheetMm | 'as-shown'; paddingMm; background: Hex | null; keepHiddenFaces })`
writes the SVG with physical `width`/`height`; `paperSceneToPng(..., dpi)`
rasterises it through `svgToPng` at that density. Applies: role → colour/width/dash; erode (D8) using
`onBoundary`; seam hairline in each opaque face's own fill; multi-loop paths;
buried faces dropped only when `keepHiddenFaces` is off. Stroke widths are
the pens' pt, unscaled by the sheet size.

### 4. Per-object overrides and `.osf`

The file is at `schemaVersion: 8` with an enumerated version list, so an
older build refuses any *newer number* outright (`project_file_too_new`), while
its validators are lenient per field and drop what they do not know. Two ways
to add `appearance`, and the house style chooses the first:

- **Additive, same schema version (chosen).** `appearance` is an optional
  field with a read-side fallback, exactly like `sourceScopedLineIds` and
  `contradiction` were added. An older build opens the file, draws every
  figure with its saved colours (they are in the kernel model), and ignores
  the overrides; only if that older build *saves the file back* are the
  overrides gone — the effective colours survive that too, so what is lost is
  which fields were pinned and any non-colour override (aux visibility,
  erode). Not a breaking change.
- **Bump to 9.** Older builds refuse the file with a message that says why.
  Trades a rare, self-healing loss for a hard wall in front of every older
  desktop build, including for files that carry no overrides at all. Kept in
  reserve for Phase 7 if the stored 3D picture changes shape.

So `NATIVE_PROJECT_SCHEMA_VERSION` stays 8 and `minimumReaderSchemaVersion`
is untouched.

Fields and rules:

- `document.viewState.foldedFigures[i].appearance?: PaperStyleOverrides` —
  both flat and 3D figures; validated field by field (unknown keys dropped,
  values type-checked) and covered by the round-trip test.
- `document.creasePattern.inlineSimulations[i].appearance?: PaperStyleOverrides`
  — validated in `inlineSimulationFile.ts` in the same house style.
- Read-side migration for a figure with no `appearance`: each of
  `front_color`, `back_color`, `line_color`, `display_shadows` that differs
  from the Oriedita default becomes an override (D1); a 3D figure reads them
  from `folded3d.model`. Nothing is written back until the user edits.
- Not stored: the app style itself. A file opened elsewhere shows overridden
  fields as saved and everything else in that machine's style; folded figures
  additionally carry their effective colours in the kernel model, so their
  saved picture is stable until the local style is pushed into following
  figures on load (which is the intended "follows" behaviour).
- `.ori` round-trip is unchanged: the kernel model keeps the effective colours.
- Undo: an override edit is a document edit with an undo entry; continuous
  colour drags keep the bracketed gesture protocol.
- Later, Phase 7 may replace `renderSnapshot` with a role-tagged scene for the
  3D picture; that is a separate bump if the stored shape changes.

Who has overrides: flat figures, 3D figures, inline simulations. The Simulate
workspace and the References workspace are not document objects and use the
app style directly.

## Affected Areas

- `apps/web/src/lib/paper/` (new): style, scene, painter, presets, tests.
- `packages/origami-simulator/src/`: `svgRenderer.ts` → `meshToPaperScene`,
  `bsp.ts`, `coplanarRuns.ts`, `hiddenPieces.ts`, `prepare.ts` (aux tag),
  `webgl/meshRenderer.ts` (`RenderSettings` fields, aux edge pass, shading
  import), `types.ts`.
- `apps/web/src/simulator/`: `simulatorPalette.ts` (resolver → `lib/paper`),
  `simulatorSession.ts` (`exportSvg` via the painter; camera at dpr 1),
  `simulatorViewExport.ts` (PNG scale), `SimulatorViewport.tsx` +
  `useSimulatorRuntime.ts` (push camera/settings unconditionally, F7),
  `canvas2dFrame.ts` (shading import, drop shadow and hidden-lines branch
  removed), `foldedMeshSource.ts` (scene producer, perspective),
  `useSimulatorShortcuts.ts` + `simulatorContextMenu.ts` (hidden lines
  removed), `lib/simulatorSettings.ts` (style keys and `showHiddenLines`
  removed).
- `apps/web/src/cp-workspace/folded/`: `folded3dWindow.ts` (adapter → resolver),
  `folded3dStyle.ts`, `foldedFigureExport.ts` (scene path), `foldedFigure3dProjection.ts`
  (bypassed for export, then retired), `foldedFigureActions.ts` /
  `foldedFigureProperties.ts` / `foldedFigureAppearance.ts` (follow-style
  row), `useFoldedFigures.ts`, `folded3dMesh.ts` (aux code).
- `apps/web/src/lib/foldedFigureSvg.ts`, `creaseExport.ts` (`svgToPng` scale;
  "Include folded figure" reads the scene path), `CreaseExportDialog.tsx`.
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` (pass
  `foldedStrokeWidthPx`; aux overlay on the folded channel),
  `adapters/cpFoldedToScene.ts`, `renderer/reglRenderer.ts`.
- `crates/oristudio-cp/src/folding.rs` (additive accessor only; drawer
  untouched), `session.rs`, `crates/oristudio-cp-wasm/src/lib.rs`,
  `apps/web/src/engine/oristudioCpTypes.ts`, `engine/` wasm glue.
- `apps/web/src/cp-workspace/references/`: `diagram/diagramColors.ts` +
  `styles/theme.css` `--fold-*` set from the resolved style,
  `diagram/diagramToScene.ts`, `StepDiagram.tsx`, `referencesActions.ts` (export
  verbs), `ReferencesCpView.tsx` (arrow width).
- `apps/web/src/store/settingsStore.ts`, `lib/storage.ts`, `lib/nativeProjectFile.ts`
  + `inlineSimulation/inlineSimulationFile.ts` (schema 9, `appearance`,
  migration, round-trip tests; later the scene picture), `components/properties/`,
  `components/SettingsModal.tsx`
  + `components/settings/`, `components/panels/SimulatorViewControlsPanel.tsx`,
  `inlineSimulation/inlineSimulationProperties.ts`.
- `apps/web/src/analytics/events.ts`: `paper style changed { field }`,
  `paper preset applied { preset }`, `paper exported { surface, format, hidden_faces }`.
- `PORTING.md` (accessor is additive; drawer parity unchanged), `RELEASE.md`
  notes for D3.

## Checklist

### Phase 0 — WYSIWYG quick fixes (each its own PR, no new abstractions)

- [x] `foldedFigureSvgBody` writes the kernel width × `strokeScale` (default
      1) instead of `width × scale`; the CP export dialog passes
      `strokeScale: VIEW_SCALE`; re-pin `foldedFigureSvg.test.ts`. Display
      path unchanged: `reglRenderer.ts` already draws 1.2 CSS px (the kernel's
      1.2 rides the per-segment multiplier over a `dpr` base, so passing
      `1.2 × dpr` would double-apply it). The edge pen comes with Phase 1.
- [x] Fix the stale winding comment in `folded3dMesh.ts:73-80` (F8).
- [x] Remove hidden lines (D11): setting, normaliser, View Controls row,
      context-menu item, shortcut, palette field, canvas-2D branch, i18n
      keys, tests. (No `MENU_ACTION_ID`, Tauri menu, analytics allowlist or
      capability entry ever existed for it.)
- [x] Seam hairline in each opaque fill and an area floor in
      `foldedFigureSvg` and the 3D projector; re-pin
      `foldedFigure3dProjection.test.ts` (box_90 cell 2 sliver).
      `foldedFigureExport.test.ts:181` and `folded3dMesh.test.ts:797-802`
      need no re-pin: both compare the `<path` count against the same
      projection's `primitives.length`, so the floor moves both sides.
- [x] Simulator export in CSS px: the worker builds the export camera at
      `width / dpr` and divides `creaseWidthPx`, `creaseWidthReferenceEdge`
      and `creaseDash` by dpr (`cssPixelInk`); `PNG_SCALE` stays 2 × the CSS
      page and `svgToPng` is unchanged; new `simulatorViewExport.test.ts`.
- [x] Canvas-2D path pushes camera and settings unconditionally (F7). The
      framing-radius residual noted under F7 is deferred to Phase 2.
- [ ] Browser-verify each on the dev server (Zach owns the browser pass).
      Expected, not a bug: the standalone Export Folded Figure command
      (`foldedFigureExportDocument`, no `strokeScale`) now writes
      `stroke-width="1.20"` on its 1024 px page where a 100-unit figure used
      to get 12 px, so its edges read roughly half as heavy against the paper
      as the canvas shows until D3's default sheet size (= on-screen size)
      restores the proportion. The seam hairline is likewise a fixed 0.5 page
      units, as in the simulator. The CP export dialog is unaffected (it
      passes `VIEW_SCALE`).

### Phase 1 — `PaperStyle`, resolver, settings, presets

- [ ] `lib/paper/paperStyle.ts` schema + normaliser + defaults; unit tests.
- [ ] `resolvePaperStyle` (pt → device px) + `SurfaceStylePolicy`;
      `RenderSettings` gains the aux/hidden pens, erode, light direction;
      `shading.ts` shared by GLSL / SVG / canvas-2D.
- [ ] `settingsStore.paperStyle` + storage key + migration from
      `simulator-settings`; simulator settings lose their style keys.
- [ ] Simulator reads `display`; inline windows read their effective style
      (behaviour-preserving; the colour / mono / mono-dashed switch writes the
      M/V pens).
- [ ] 3D window adapter reads the resolver; default light direction shared
      with the simulator; perspective camera with the frame radius scaled by
      the silhouette factor (F11); re-pin `folded3dWindow.test.ts` framing
      and the projector-parity cameras (or retire them in Phase 3).
- [ ] Remove the canvas-2D drop shadow and `display_shadows` from the 3D
      figure's appearance options (D7).
- [ ] `PaperStyleOverrides` + `effectivePaperStyle`; `appearance` on folded
      figures and inline simulations; `.osf` schema 9 with validators,
      migration and round-trip tests.
- [ ] Properties panel: applicable-field rows per `SurfaceStylePolicy` with
      effective values and per-row reset, on the flat figure, 3D figure and
      inline simulation sheets; folded Style menu rows write overrides.
- [ ] Flat figure: the store mirrors effective colours/shadow into the kernel
      model for following figures; `foldedStrokeWidthPx` from the edge pen.
- [ ] References: `--fold-*` and `diagramColors.ts` derived from the resolved
      style; arrow pen bound.
- [ ] Presets: built-ins, import/export, Settings ▸ Paper tab; simulator View
      Controls + inline Properties + folded Style menu bound.
- [ ] Analytics events; i18n extract.

### Phase 2 — `PaperScene` + painter; simulator export moves

- [ ] `lib/paper/paperScene.ts`, `paperSvg.ts`, `paperPng.ts`; painter tests
      (pens, dash centring, pt page, sheet size, erode, seam, multi-loop,
      buried faces kept/dropped).
- [ ] `meshToPaperScene` split out of `renderMeshToSvg` with the additive
      options; `prepare.ts` aux tag; aux edge pass in the GPU renderer.
- [ ] Simulator `exportSvg` → scene → painter; `keepHiddenFaces` export
      option in the simulator export menu; page per D3.
- [ ] Inline windows on the same path.

### Phase 3 — 3D figure export through the shared path

- [ ] `FoldedMeshSource` → `meshToPaperScene` with side, kernel order on
      `BspItem.order` and `folded3dDrawPasses` ranges (F9); creases unbiased.
- [ ] Tier A merge by `(plane, face)` within a node; parity harness green at
      the pinned cameras or re-pinned with a reason.
- [ ] Standalone export and "Include folded figure" read the scene.

### Phase 4 — Flat figure: kernel accessor and whole-face export

- [ ] `folded_figure_paper_scene` in `folding.rs` (additive) + `session.rs`
      + wasm export + TS types; Rust test: accessor top face per subface ==
      drawer's `visible_subface_face`.
- [ ] Web: face DAG from stacks, topological order, SCC split; scene with
      whole faces, per-edge roles, hidden layers.
- [ ] Rebuild `build:oristudio-cp-wasm`; flat export through the painter.
- [ ] `PORTING.md` note.

### Phase 5 — Aux creases and erode on every surface

- [ ] Flat figure display: aux overlay from the accessor on the folded channel.
- [ ] 3D mesh aux code drawn when `auxCreases.visible` (effective, per
      object); simulator GPU aux pass.
- [ ] Erode in the painter and in the GPU edge builders (`onBoundary` flags
      from each producer); paper-relative distance.
- [ ] References: existing creases honour aux pen and erode.

### Phase 6 — Precrease step export

- [ ] `diagramToPaperScene`; export verbs (SVG / PNG for the current step) in
      `referencesActions.ts`, toolbar + context menu; analytics.
- [ ] Mid-fold frame through `meshToPaperScene`.

### Phase 7 — Retire the projector

- [ ] `.osf` picture stored as a scene; fallback canvas draws a scene;
      migration for stored projector snapshots.
- [ ] Delete `foldedFigure3dProjection.ts` and its tests; update
      `folded-figure-viewport.md` §5 (R7 now holds by construction).

### Validation per phase

Rust: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
`cargo test --workspace`, Oriedita oracle for Phase 4. Web: `npm run lint:web`,
`npm run typecheck:web`, `npm run test:web` (Node 22, from the web workspace),
`npm run build:web` when the wasm bridge or bundling changes. Rebuild the CP
wasm bridge after any kernel change before trusting the browser.
