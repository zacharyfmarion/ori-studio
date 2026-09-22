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
- **D12. The paper style's inks reach References through the workspace root,
  not `:root`.** The four `--fold-*` tokens are global: the CP editor's own
  line colours map to them (`cpLineColor.ts`), and those are Oriedita parity
  that follow the theme. So the style re-sets the same token names on the
  References workspace element (`.references-workspace`) only; the Edit canvas
  keeps the theme values. Inside References that also restyles the document's
  creases in the big view, which is the consistent reading of "a step renders
  in the paper style". `useReferencesDiagramScene` reads its colours from an
  element inside the workspace rather than `document.documentElement`.
- **D13. References draws on the style's paper.** The step sheet (card and
  big view, and the flap during a fold) is filled with `paper.front`, or
  `paper.back` when the view is mirrored, not the theme ground — otherwise a
  black edge pen is invisible on a dark theme, and a step would not render
  "the same" as the simulator beside it. The `references` policy therefore
  applies `paper.front` and `paper.back`; the workspace ground stays the
  theme's.
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

### 5. Phase 1 contracts

Fixed here so six implementers build against one shape. Deviations are
recorded in the checklist, not improvised.

**Module** `apps/web/src/lib/paper/` — no React, no store, no CP-workspace
imports: `paperStyle.ts` (types, `DEFAULT_PAPER_STYLE`, `normalizePaperStyle`,
field paths, overrides, `effectivePaperStyle`), `paperStyleResolve.ts`
(`resolvePaperStyle`, `SurfaceStylePolicy`, `PAPER_STYLE_POLICIES`, pt → px,
light vector), `paperPresets.ts` (built-ins, `parsePaperStylePreset`,
`serializePaperStylePreset`).

**Units.** Pen widths are pt. On screen a pen draws at `pt × 4/3 × dpr` device
px (`ptToDevicePx`). Colours are `#rrggbb` lowercase; `normalizePaperStyle`
rejects anything else and falls back to the default for that field.

**Defaults** (`DEFAULT_PAPER_STYLE`, chosen so Phase 1 is behaviour-preserving
where a surface already had a value): paper front `#ffff32`, back `#e9e9e9`
(Oriedita's; the simulator's back moves from `#f2f0e7`); edges `{ width: 0.9,
color: '#000000', dash: null, cap: 'butt' }` (1.2 px, the folded figure's;
the simulator's border moves from the theme text colour to black);
mountainFolds `{ width: 0.825, color: '#db1f24', dash: null, cap: 'butt' }`
and valleyFolds the same at `#1c5cd9` (1.1 px, the simulator's);
auxCreases `{ visible: false, pen: { width: 0.5, color: '#9aa4ad', dash: null, cap: 'butt' } }`;
arrows `{ width: 1.05, color: '#000000', dash: null, cap: 'round' }`;
erode `0`; light `{ enabled: true, azimuth, elevation }` with the two angles
chosen so `lightVector(azimuth, elevation)` equals today's
`normalize([-0.45, 0.58, 0.68])` in view space (x right, y up, z toward the
eye) — `azimuth` is degrees clockwise from straight up in the screen plane,
`elevation` degrees out of the screen; a test pins the round trip.

**Field paths** (`PaperStyleField`): `'paper.front' | 'paper.back' | 'edges' |
'mountainFolds' | 'valleyFolds' | 'auxCreases.visible' | 'auxCreases.pen' |
'arrows' | 'erode' | 'light'`. A pen is overridden whole.
`PaperStyleOverrides = Partial<{ [F in PaperStyleField]: PaperStyleValue<F> }>`;
`effectivePaperStyle(base, overrides?)` applies them; `normalizePaperStyleOverrides`
drops unknown keys and malformed values.

**Policy** (`SurfaceStylePolicy`): `{ surface: PaperSurface; applies: PaperStyleField[]; forced?: PaperStyleOverrides }`
for `PaperSurface = 'simulator' | 'inline-simulation' | 'folded-3d' |
'folded-flat' | 'references'`. Phase 1 values: simulator and inline-simulation
apply paper, edges, mountainFolds, valleyFolds, light; folded-3d applies
paper, edges, light; folded-flat applies paper, edges; references applies
paper, edges, mountainFolds, valleyFolds, auxCreases.pen, arrows (D13). `auxCreases.*`
and `erode` join every surface in Phase 5, `arrows` stays References-only.
The Properties panel shows exactly `applies`.

**Resolver** `resolvePaperStyle(style, policy, options: { dpr; background: [r,g,b]; backgroundAlpha; faceAlpha; colorMode; strainClip; creaseWidthReferenceEdge?; creaseWidthShrinkExponent? }): RenderSettings`
— the one place pt becomes px and a pen's `dash` becomes device-px runs.
`RenderSettings` keeps its shape; `lightDir` is now data from the style.
`simulatorPalette.resolveRenderSettings` becomes a thin wrapper that only
resolves the theme ground (`--bg-canvas`) and delegates.

**Shading.** `packages/origami-simulator/src/shading.ts` exports the shade
band constants and `shadeFor(normal, lightDir)`; the GLSL builder, `svgRenderer`
and `canvas2dFrame` import it (canvas-2D drops its lift-toward-white and its
drop shadow, D7).

**Store.** `settingsStore.paperStyle: { display: PaperStyle; export: PaperStyle | null; presets: PaperStylePreset[] }`,
actions `setPaperStyleField(slot, field, value)`, `applyPaperPreset(slot, preset)`,
`setExportPaperStyleFollowsDisplay(follows)`, `savePaperPreset(name)`,
`removePaperPreset(name)`, `importPaperPreset(json)`; persisted under
`STORAGE_KEYS.paperStyle = 'paper-style'` as `{ version: 1, display, export, presets }`.
First read with no key seeds `display` from `simulator-settings` (paperFront,
paperBack, mountainColor, valleyColor, borderColor, creaseWidth, creaseStyle,
lighting) when present, then those keys leave `SimulatorSettings` and its
normaliser drops them. `SimulatorSettings` keeps renderMode, colorMode,
showFaces, showEdges, showViewCube, exportBackground, physics.

**Crease-style switch.** `creaseStyleOf(style): 'color' | 'mono' | 'mono-dashed' | 'custom'`
reads the M/V pens; `applyCreaseStyle(style, mode)` writes them: `color` =
`#db1f24`/`#1c5cd9` solid; `mono` = the edge pen's colour, solid;
`mono-dashed` = the edge pen's colour with Oriedita's runs in multiples of the
pen width (`[10,3,3,3] / 1.1` for mountain, `[8,8] / 1.1` for valley).

**Objects.** `appearance?: PaperStyleOverrides` on `OristudioCpFoldedFigureEntry`
and `InlineSimulation`; store actions `setFoldedFigureAppearance(id, field, value | undefined)`
and `setInlineSimulationAppearance(id, field, value | undefined)` (undefined
clears = reset), each an undo entry; continuous colour drags keep the
bracketed gesture protocol. `effectiveObjectPaperStyle(entry)` = display
style + `appearance`. For folded figures the store mirrors the effective
`paper.front`, `paper.back`, `edges.color` into the kernel model (D6) after
any change to the display style or the figure's overrides; the flat figure's
Oriedita `display_shadows` stays a model field edited as today.

**Migration on read (D1).** A figure without `appearance`: each of
`front_color`, `back_color`, `line_color` that differs from the Oriedita
default (`#ffff32`, `#e9e9e9`, `#000000`) becomes the override
`paper.front` / `paper.back` / `edges` (the edge pen with the default width
and that colour).

**Presets.** `PaperStylePreset = { version: 1; name: string; author?: string; style: PaperStyle }`
(a full style, normalised on import). Built-ins: `ori-default`, `oriedita`,
`black-and-white`, `origami-house` (values in §1). Files are `.json`.

**Analytics** (`analytics/events.ts`): `paper style changed { slot: 'display' | 'export', field }`,
`paper preset applied { slot, preset: builtin id | 'custom' }`,
`paper style overridden { surface, field, reset: boolean }`.

**UI.** Settings ▸ Paper (new `SettingsTab` `'paper'`): slot switch
(Display / Export, with "Export uses display style" toggle), preset list with
Apply / Save current as… / Import / Export / Delete, then field editors for
the slot: two paper swatches, one row per pen (colour swatch, width in pt,
dash as space-separated multiples, cap), aux toggle, light enabled +
azimuth/elevation. The Simulator View Controls panel keeps its rows but they
read and write `display` (colour/mono/mono-dashed through the switch above).
Properties sheets show the policy's fields with a per-row `reset` while
overridden.

### 6. Phase 2 contracts

**Scene types live in the simulator package** (`packages/origami-simulator/src/paperScene.ts`),
because the producers for the simulator and the 3D figure run in the worker
and the package cannot import `apps/web`; `lib/paper` re-exports the types and
holds the painter. Scene coordinates are **CSS px at the camera the surface
showed** — what every producer already has — and the painter is the one place
they become pt (`0.75 pt/px`, scaled further only by a sheet-size option).

```ts
type ScenePoint = [number, number];
type PaperLineRole = 'edge' | 'mountain' | 'valley' | 'aux';
interface PaperFaceItem { kind: 'face'; face: number; side: 'front' | 'back'; rings: ScenePoint[][]; shade: number /* 1 = unlit */; hidden: boolean }
interface PaperLineItem { kind: 'line'; role: PaperLineRole; a: ScenePoint; b: ScenePoint; onBoundary: [boolean, boolean]; face?: number; hidden: boolean }
type PaperItem = PaperFaceItem | PaperLineItem;   // arrows and symbols join in Phase 6
interface PaperScene { bounds: { minX; minY; maxX; maxY }; sheet: number /* unfolded sheet extent, scene px */; items: PaperItem[] /* draw order, back to front */ }
```

`meshToPaperScene(positions, topology, camera, options): PaperScene` is the
BSP half of today's `renderMeshToSvg` — `projectVertices`, `buildBsp`,
`traverseBsp`, `findVisiblePieces` (marking `hidden`, never dropping), the
consecutive coplanar merge with `outlineOf` extended to multi-loop rings —
with options `{ perspective; markHidden; lighting; lightDir; faceGroups?: Uint32Array /* source face per triangle */; sides?: Uint8Array /* 0 front, 1 back, per triangle; winding when absent */; order?: Float32Array /* coplanar order per triangle */; sheet: number /* unfolded extent, world units */ }`.
Face shade is `shadeFor(normal, lightDir)` or 1. Edge codes: `prepare.ts`
tags a source `F` edge as **aux** (code 3) and a triangulation diagonal as
**facet** (code 4, never drawn); `U`/`C`/`J` stay border. A line's
`onBoundary` flags are true at an endpoint that lies on the sheet boundary or
on a fold edge of the face it is drawn on (the BSP knows the face; the
producer computes it from the topology).

**Painter** `lib/paper/paperSvg.ts`:
`paperSceneToSvg(scene, style: PaperStyle, page: PaperPage): { svg: string; widthPt: number; heightPt: number }`
writes `<svg width="{w}pt" height="{h}pt" viewBox="0 0 w h">` with user
units = pt. `PaperPage = { sheet: 'as-shown' | { mm: number }; paddingMm: number; background: Hex | null; keepHiddenFaces: boolean }`
(`lib/paper/paperPage.ts`, `DEFAULT_PAPER_PAGE = { sheet: 'as-shown', paddingMm: 5, background: null, keepHiddenFaces: true }`,
normaliser). Faces fill `shadeColor(paper.front|back, shade)` with the seam
hairline in their own fill (`SEAM_STROKE_WIDTH_PT = 0.4`), multi-ring faces as
one `<path>` with `fill-rule="evenodd"`, hidden faces dropped only when
`keepHiddenFaces` is false. Lines take their role's pen: `stroke`,
`stroke-width` in pt, `stroke-dasharray` = multiples × width with
`stroke-dashoffset` chosen so the pattern is symmetric about the segment's
midpoint, `stroke-linecap` from the cap; aux lines only when
`auxCreases.visible`. Erode pulls each `onBoundary` endpoint toward the
segment midpoint by `erode × sheet` (scene px, then scaled), and drops a
segment that would invert. `lib/paper/paperPng.ts`:
`paperSvgToPng(result, dpi): Promise<Uint8Array>` rasterises at
`pt / 72 × dpi` px through the existing `svgToPng`; default 192 dpi (the PNG
stays 2× the CSS page).

**Export page settings** (`settingsStore.paperExport: PaperPage & { pngDpi: number }`,
persisted under `STORAGE_KEYS.paperExport = 'paper-export'`): edited in a
new "Export page" section of Settings ▸ Paper and mirrored by the simulator
View Controls' Export group (background, keep hidden faces, sheet size).
`SimulatorSettings.exportBackground` retires: `'white'` seeds `#ffffff`,
anything else `null`.

**Simulator path.** The main thread resolves the *export* style —
`effectivePaperStyle(paperStyle.export ?? paperStyle.display, object?.appearance)`
— and hands it, the page and the last camera to the worker:
`exportSvg({ token; camera; devicePixelRatio; style: PaperStyle; page: PaperPage })`
returns the painter's result. `saveSimulatorView` writes the SVG verbatim or
the PNG at `paperExport.pngDpi`. `renderMeshToSvg` and `SvgRenderResult` are
deleted once nothing calls them; the package's `svgRenderer.test.ts` is
re-pinned onto `meshToPaperScene` and the web's painter tests. Analytics:
`paper exported { surface: 'simulator' | 'inline-simulation' | …, format: 'svg' | 'png', hidden_faces: 'kept' | 'dropped' }`
fired from the export hook; `file exported` keeps firing from the file service.

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

- [x] `lib/paper/paperStyle.ts` schema + normaliser + defaults; unit tests.
- [x] `resolvePaperStyle` (pt → device px) + `SurfaceStylePolicy`;
      `RenderSettings` gains the aux/hidden pens, erode, light direction;
      `shading.ts` shared by GLSL / SVG / canvas-2D.
- [x] `settingsStore.paperStyle` + storage key + migration from
      `simulator-settings`; simulator settings lose their style keys.
      Deviations from §5: `savePaperPreset(name, slot = 'display')` takes the
      slot as a second argument, since the Paper tab saves the slot it is
      showing; `resetSimulatorStyle` is gone (the pane's reset writes the
      `simulator` policy's fields back to the Ori default as one
      `setPaperStyleFields` update, counted per field — not a preset, which
      would also wipe the fields the pane never shows);
      `simulatorPalette.resolveRenderSettings`
      takes the `PaperStyle` as a third argument and `SimulatorViewport` takes
      it as a `paperStyle` prop — the Simulate panel passes the display style,
      an inline window its effective style (`useObjectPaperStyle`).
- [x] Simulator reads `display`; inline windows read their effective style
      (behaviour-preserving; the colour / mono / mono-dashed switch writes the
      M/V pens). The View Controls "Weight" row is now "Fold line weight (pt)",
      the M/V pen width over 0.4–4.5 pt (`SIMULATOR_FOLD_WEIGHT_RANGE`); the
      inline window's sheet shows the `inline-simulation` policy's fields with
      effective values and a per-row reset while pinned. Deviation from §5: the
      sheet offers the fold pens' width, not the edge pen's, because
      `resolvePaperStyle` draws the simulator's one crease width from the
      mountain pen where the fold pens apply, so an edge-width row there would
      be inert. `canvas2dFrame` shades through `shadeFor` / `shadeColor` from
      `RenderSettings.lightDir` (no lift toward white) and casts no drop
      shadow; `PAPER_LIGHT_DIRECTION` is gone.
- [x] 3D window adapter reads the resolver; default light direction shared
      with the simulator; perspective camera with the frame radius scaled by
      the silhouette factor (F11); re-pin `folded3dWindow.test.ts` framing
      and the projector-parity cameras (or retire them in Phase 3).
      `folded3dWindowRenderSettings` takes the figure's effective `PaperStyle`
      (`useObjectPaperStyle`) through `PAPER_STYLE_POLICIES['folded-3d']`;
      the window's own `1.5 × dpr` crease width is gone (the edge pen's 0.9 pt
      is the figure's 1.2 CSS px) and the below-reference shrink stays the
      viewport's `creaseWidthReferenceEdge`. Deviation from the wording of
      F11: the persisted `frameRadius` stays the bounding-sphere radius — a
      rehydrate checks a refold against it to 1e-9 (`sameFolded3dFrame`), so
      the stored number cannot change meaning — and the *frame* derived from
      it grows by the factor (`folded3dFrameHalfSide`, a leaf module, in the
      figure's box and the window's fill zoom). The parity harness still
      projects orthographically (it compares the draw passes' layer choice,
      which is projection-independent) and cancels the factor in its own
      camera; its pins are unchanged. The projector's own lighting stays
      on-axis until it retires in Phase 3, so a 3D figure's export is shaded
      differently from its window until then.
- [x] Remove the canvas-2D drop shadow and `display_shadows` from the 3D
      figure's appearance options (D7). The canvas-2D shadow is gone
      (`canvas2dFrame.test.ts` pins it); `shadow` is `not-applicable` on a 3D
      figure (`foldedAppearanceSupport`), so neither the Style menu nor the
      sheet offers it there, and the light switch takes its slot.
- [x] `PaperStyleOverrides` + `effectivePaperStyle`; `appearance` on folded
      figures and inline simulations; `.osf` stays at schema 8 (§4) with
      validators, migration and round-trip tests. Deviation from §5: the
      store actions (`setOristudioCpFoldedFigureAppearance`,
      `setOristudioCpInlineSimulationAppearance`) are raw document edits with
      no history push, like placement and window edits; the one-entry-per-edit
      verbs are `setFoldedFigureAppearance` / `setInlineSimulationAppearance`
      in `cp-workspace/paper/objectPaperStyle.ts`, which run the layer's
      bracket, so a colour drag can keep the bracketed protocol without a
      per-tick entry. Refinement of "Migration on read": the writer always
      emits `appearance` (empty when nothing is pinned) and the reader
      migrates from the model colours only when the key is *absent* —
      otherwise a following figure whose mirrored colours are non-default
      would come back pinned after one save.
- [x] Properties panel: applicable-field rows per `SurfaceStylePolicy` with
      effective values and per-row reset, on the flat figure, 3D figure and
      inline simulation sheets; folded Style menu rows write overrides. The
      folded sheets' colour rows and the 3D light toggle pin the figure's
      `appearance` (`setFoldedFigureAppearances`, one entry; continuous drags
      through the pane's bracket), and the Style menu's colour rows do the
      same under their menu gesture (`FoldedFigureActionDeps.setAppearance`);
      `paper style overridden` fires once per field per adjustment.
- [x] Flat figure: the store mirrors effective colours into the kernel model
      for following figures; `foldedStrokeWidthPx` from the edge pen.
      `store/workspaceStore/foldedFigurePaperMirror.ts` subscribes to both
      stores and writes `front_color` / `back_color` / `line_color` through
      `updateOristudioCpFoldedFigureModel(id, patch, { mirror: true })` — a
      write that selects nothing and dirties nothing — via the kernel write
      queue, for both flat and 3D figures with a handle. `display_shadows` is
      **not** mirrored: it is the flat figure's own model option, not a style
      field (D7). A seeded fold (Oriedita metadata, duplicate) stamps
      `legacyPaperStyleOverrides` / the source's pins so the mirror keeps its
      colours. Width: `cpFoldedToScene` no longer emits the kernel's Java2D
      width as `widthMul` (it is 1 for every stroke) and multiplies each
      figure's effective edge pen width in pt in; the canvas passes
      `foldedStrokeWidthPx = ptToDevicePx(1, dpr)`, device px per pt, so a
      folded edge is its pen at every zoom. References keeps passing its
      crease pen with multipliers of 1.
- [x] References: `--fold-*` and `diagramColors.ts` derived from the resolved
      style; arrow pen bound. `cp-workspace/references/usePaperStyleTokens.ts`
      re-sets `--fold-mountain/valley/border/unassigned` and
      `--references-dim-alpha` (derived as `applyTheme` does, from the style's
      M/V inks over the theme's ground) as inline custom properties on
      `.references-workspace` only — `:root` keeps the theme's, so the Edit
      canvas is untouched (D12; a test pins it). The cards, the DOM symbol
      layer and the document's creases in the big view follow by inheritance;
      `useReferencesDiagramScene` reads the theme's tokens off the workspace
      root and takes the style's as values (`diagramInkColors(element, set)`),
      because the render that changes them runs before the DOM carries them.
      The arrow pen's width reaches the big view's symbol layer as
      `canvasDiagramPens(lineWidth, arrowCss)` on the overlay projector
      (`DiagramProjector.pens`); the card's table is untouched. Not bound: the
      arrow pen's *colour* — the arrow ink is still `--fold-border` in both
      the stylesheet and `diagramColors.ts` — and the crease alpha
      (`--references-crease-alpha`), which stays the theme's derivation from
      the fixed grey rather than the style's aux ink.
- [x] References draws on the style's paper (D13). The `references` policy
      applies `paper.front` and `paper.back`; `usePaperStyleTokens` sets
      `--references-paper-front` / `--references-paper-back` on the workspace
      root, and the card's `.step-diagram__sheet` (`--back` for a mirrored
      card), the big view's sheet fill and the fold surface's `up` / `other`
      faces (`ReferencesCpView.paperFaces`) take them, the back when the view
      is mirrored (`ReferencesPanel`'s `mirrored`, from the step's side). The
      canvas clear and the workspace ground stay `--bg-primary`. Both alphas
      are now derived against the paper rather than the ground, and in the
      style's inks: `referencesCreaseAlpha(surface, ink)` takes the aux pen,
      and `referencesDimAlpha` decides its dark lift from the surface's own
      lightness rather than the theme's type (the same answer on every
      built-in theme's ground, so `:root` is unchanged). The workspace sets
      `--references-crease-alpha` too, and `diagramInkColors` takes it as a
      value with the inks. Outside a workspace the tokens are unset: the card
      falls back to the theme's ground as before, the view to the style's
      default paper.
- [x] Presets: built-ins, import/export, Settings ▸ Paper tab; simulator View
      Controls + inline Properties + folded Style menu bound.
      `components/settings/PaperSettings.tsx` over `usePaperSettings.ts`: the
      Display / Export slot switch with the "Export uses display style"
      toggle (while on, the Export slot shows display's values with every
      editor and Apply disabled — turning it off is the one way to detach);
      the preset list, built-ins first (labelled by id through
      `paperPresetLabel`), with Apply, Export (a `.json` per row, built-ins
      too), Delete on the user's own; "Save current as…" and "Import…" under
      the list; then the slot's fields — two paper swatches, one line per pen
      (swatch, width in pt, dash as space- or comma-separated multiples
      through `lib/paper/paperDashText.ts`, cap), the aux toggle, light on/off
      and azimuth / elevation. Deviations from §5: "Save current as…" opens a
      name field in place rather than a command dialog, because the Settings
      modal takes Escape on `window` ahead of any dialog opened from inside
      it; Import both adds the file's preset and applies it to the slot, so
      the `paper preset applied` it fires is true.
- [x] Analytics events; i18n extract. Settings ▸ Paper fires `paper style
      changed` once per field per adjustment (the Simulate pane's counting)
      and `paper preset applied` on Apply and Import; the object sheets fire
      `paper style overridden`. English catalogs extracted; the eight
      target locales carry the new keys untranslated until the phase's
      translation pass.

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
