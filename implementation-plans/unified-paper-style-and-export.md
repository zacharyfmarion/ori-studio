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

### 7. Phase 3 contracts

**Producer** `cp-workspace/folded/folded3dScene.ts`:
`folded3dPaperScene(mesh: Folded3dMesh, model: OristudioCpFolded3dRenderModel, camera: CameraUniforms, options: { style: PaperStyle; markHidden: boolean }): PaperScene`
feeds the window's own mesh (`folded3dMesh(model)`, the same buffers
`FoldedMeshSource` uploads) to `meshToPaperScene`: the **translucent range**
(every layer, so buried faces exist to keep), `faceGroups` = the slot's kernel
face per triangle, `sides` = the side the window would paint that triangle
(derive it from the winding convention `folded3dMesh.ts` documents, so the
scene's front/back equals the GPU's), `order` = the slot's stack depth (the
kernel's `cell_stack`, which is what `BspItem.order` sorts a coplanar node
by), `lighting`/`lightDir` from the figure's effective style through the
`folded-3d` policy, `perspective: true` (D7), `sheet` = the unfolded paper's
extent in the render model's units, and creases **unbiased** — `lineWidth`
0 for the tree's ink allowance so a plane's creases stay inside its coplanar
node (F5, the projector's `edgeInk 0`); the painter draws them at the pen's
width regardless. Edge roles from the mesh's assignment codes (0 border →
`edge`, 1/2 → mountain/valley, 0° creases → aux via code 3 when
`folded3dEdgeAssignment` learns it; until Phase 5 they stay `edge`).

**Camera.** The figure's stored orbit (`figure.camera`) at the frame the
window shows: `cameraUniforms(view, mesh.center, mesh.radius × silhouette factor, w, h)`
with `w = h =` the figure's on-screen box in CSS px, read through the CP
camera registry (`renderer/cpCameraRegistry.ts`) at export time; when no
canvas is mounted, the box at zoom 1. Zoom-independent by construction: the
page is the artwork crop at that orientation (D3).

**Wiring.** `exportOristudioCpFoldedFigure(format, id)` for a figure with
`folded3d` and a live handle builds the scene from `folded3dRenderModel(handle)`
and paints it with `effectivePaperStyle(paperStyle.export ?? display, figure.appearance)`
and `settingsStore.paperExport` (`keepHiddenFaces` → `markHidden`); PNG at
`pngDpi`. A reopened figure without a handle keeps exporting its stored
`renderSnapshot` through `foldedFigureSvgBody` until rehydration (R7,
Phase 7). The flat figure is untouched (Phase 4). `paper exported { surface: 'folded-3d', … }`.
The CP export dialog's "Include folded figure" is the flat re-fold and is
not a 3D path; it moves in Phase 4.

**Parity.** A new test renders the six projector fixtures through
`folded3dPaperScene` at the parity harness's cameras and asserts, per
camera, that the set of visible `(face, side)` in the scene equals the
window's draw-pass skins (`folded3dDrawPasses`) — the same mesh, so this is
the invariant that replaces the projector-vs-window comparison once the
projector retires. The existing harness stays until Phase 7.

### 8. Phase 4 contracts

**Kernel accessor** (additive, beside the untouched drawer in
`crates/oristudio-cp/src/folding.rs`; `CpSession::folded_figure_paper_scene(handle)`
in `session.rs`; wasm export `folded_figure_paper_scene(handle)`; TS mirror in
`engine/oristudioCpTypes.ts` + runtime glue). Coordinates are the **render
snapshot's** coordinates — the same `OrieditaRenderCamera` transform for the
model's current `state` (scale, rotation, mirror, `fix_to_flat_bounds`
offset), so the scene overlays the picture the canvas draws today and the
parity test is a direct comparison.

```rust
pub struct FoldedPaperScene {
  pub schema_version: u32,                       // 1
  pub flipped: bool,                             // the pass is Back1
  pub sheet: f64,                                // unfolded paper extent, same units
  pub faces: Vec<FoldedPaperFace>,               // kernel face index order
  pub subfaces: Vec<FoldedPaperSubface>,         // the drawer's subface_graph.faces order
  pub aux_lines: Vec<FoldedPaperAuxLine>,
}
pub struct FoldedPaperFace { pub outline: Vec<Point>, pub front_up: bool /* as seen for this state */, pub edges: Vec<FoldedPaperFaceEdge> }
pub struct FoldedPaperFaceEdge { pub from: Point, pub to: Point, pub kind: FoldedPaperEdgeKind /* Border | Fold (±180°) | Flat (0°) */ }
pub struct FoldedPaperSubface { pub polygon: Vec<Point>, pub faces_top_to_bottom: Vec<usize> /* subface_top_stack for this state: index 0 is the face the drawer paints */ }
pub struct FoldedPaperAuxLine { pub from: Point, pub to: Point, pub face: usize /* split at face boundaries */ }
```

Rust test: for every fixture the drawer renders, `faces_top_to_bottom[0]`
of each subface equals `visible_subface_face(...)` and the subface polygon
equals the drawer's `fill_path` ring — the assurance that the scene shows the
faces the oracle-checked drawer shows. `PORTING.md`: the accessor is additive
and reads the same `HierarchyTable`; the drawer and its byte-for-byte oracle
are unchanged.

**Web producer** `cp-workspace/folded/foldedFlatScene.ts`:
`foldedFlatPaperScene(kernel: OristudioCpFoldedPaperScene, options: { markHidden; toScenePx: (p) => ScenePoint; scale }): PaperScene`
(no `style`: the flat producer is unlit and marks hidden by the stacks, so
nothing in it reads a pen or a colour — the painter does).
Build the face DAG from every subface stack (`face[i]` over `face[i+1]`);
topological order gives whole faces (one item per face, its outline as the
ring); faces in a non-trivial strongly-connected component are split into
their subface polygons, each placed by its position in that subface's stack;
emit back to front, each face followed by its lines: outline edges with role
`edge` for Border and Fold, `aux` for Flat; `aux_lines` as `aux` with
`onBoundary` true at an endpoint on the face's outline; `side` = `front_up`;
`shade` 1 (D7); `hidden` = a face that is on top of no subface (and its
lines). `sheet` = `kernel.sheet × scale`. Tests: acyclic → one polygon per
face, hidden layers present; a woven fixture → only the cycle's faces split;
visible face per subface equals the kernel's `[0]` after painting order
(rasterise the scene in a test the way the 3D parity gate does).

**Wiring.** `exportOristudioCpFoldedFigure` for a flat figure with a live
handle: `folded_figure_paper_scene(handle)` → producer → painter with the
export style and page at the figure's on-screen size (placement scale × the
overlay affine, as the 3D path reads it); PNG at `pngDpi`;
`paper exported { surface: 'folded-flat' }`. Handle-less figures keep the
`renderSnapshot` path (Phase 7). The CP export dialog's "Include folded
figure": `foldSegmentForExport` also returns the scene for its ephemeral
handle; `buildCreaseExportArtwork` composes `paperSceneSvgBody(scene, style, project)`
(a new body-only painter entry that takes the page's projection and writes
elements without the `<svg>` wrapper) in place of `foldedFigureSvgBody`,
with the dialog's side/front/back settings applied as overrides of the
export style. The share modal's card uses the same. Old snapshot-based
`foldedFigureSvgBody` stays for the handle-less fallback until Phase 7.

### 9. Phase 5 contracts

**What an aux crease is, per surface.** Simulator and inline windows: a
source `F` edge (code 3 since Phase 2). 3D figure: a fold whose angle is 0°
(`folded3dEdgeAssignment` maps it to code 3 now that the GPU draws code 3;
its comment about deleting linework retires with the pass). Flat figure: the
CP's aux (Cyan3) lines carried through the fold — new kernel work, additive:
`FoldedPaperScene.aux_lines` is populated by clipping each Cyan3 segment
against the fold's face polygons in CP space and mapping each piece by its
face's fold (the same reflections that place the face's own points), split
at face boundaries, with `face` set; a Rust test folds a fixture that
carries aux lines and asserts every piece lies inside its face's folded
outline. References: the step diagram's existing creases (`crease` ink).

**Policy.** `auxCreases.visible`, `auxCreases.pen` and `erode` join every
surface's `applies`; `mountainFolds` / `valleyFolds` join `folded-3d` (a 3D
figure draws its creases as the simulator does: M/V pens by fold sign, the
edge pen for borders, the aux pen for 0°); `folded-flat` stays edge + aux
(D6). The Properties sheets and Settings ▸ Paper show the fields the policy
applies, as in Phase 1.

**GPU and canvas-2D.** `RenderSettings` gains `auxColor`, `auxWidthPx`,
`auxDash`, `showAux` and `erodePx` (device px along the surface — the
resolver computes `erode × sheet` from a new `sheetPx` option, the sheet's
extent in device px at the current camera, which each surface already knows
for its frame). The edge pass draws code 3 in the aux ink when `showAux`;
codes ≥ 4 stay skipped. Erode: `edgeBoundaryFlags(topology)` in the package
computes, per edge endpoint, the producer's rule (another border/fold edge
meets that vertex) once per topology; `buildEdgeQuads` carries a per-vertex
shrink flag and the vertex shader pulls a flagged end toward the other end
by `min(erodePx, len/2 − ε)` along the screen-space edge, so the erosion is
the painter's to the pixel. The canvas-2D fallback applies the same shrink
per visible piece. Both use the shared `shading.ts`-style module for the
rule (`packages/origami-simulator/src/edgeBoundary.ts`), and the producer
imports it instead of its own copy.

**Flat figure display.** When a figure's effective `auxCreases.visible` is
true, the store fetches `folded_figure_paper_scene(handle)` after a fold /
refold / rehydrate (runtime map keyed by handle, like the 3D render models,
never persisted) and `cpFoldedToScene` appends the `aux_lines` as strokes in
the aux pen (pt → device px, the figure's `foldedStrokeWidthPx` base ×
multiplier) on the folded channel, right after that figure's fills; erode
shrinks an endpoint that lies on its face's outline by `erode × sheet` in
model units. Hidden pieces are covered by the layers above them in painter
order, as in the export.

**References.** The `crease` ink (existing creases) takes the aux pen
(colour, width, dash, cap) on the card and the big view, and erode retreats
an endpoint on the sheet boundary; the aux toggle hides them. The
`--references-crease-alpha` dim stays.

**Export.** Nothing new: the painter already draws aux and erodes from the
scene; the producers now carry the roles and flags on every surface.

### 10. Phase 6 contracts

**Scene addition.** `PaperItem` gains
`{ kind: 'markup'; svg: string; hidden: false }` — element markup in scene px,
drawn after every face and line of the item order (the painter wraps it in a
`<g>` scaled from scene px to the page). It exists so the step diagram's
symbols — fold arrows, turn-over glyph, regions, points, labels — are drawn
by the one implementation that draws them on screen (`diagramPrimitiveShape`
in `diagram/DiagramPrimitives.tsx`, through `renderToStaticMarkup`) rather
than a second copy in the painter; their colours and the arrow pen's width
are inlined as attributes from the style (no CSS classes in a file).

**Producer** `cp-workspace/references/diagramToPaperScene.ts`:
`diagramToPaperScene(model: StepDiagramModel, options: { style; mirrored; project: (p) => ScenePoint; sheetPx })`
— the sheet → one `face` (`side` = `back` when mirrored, `shade` 1) and its
four sides as `edge` lines, since a face carries only a seam hairline in its
own fill and a model-frame diagram has no `sheet` primitive; lines by
their `DiagramLineStyleName`: `valley` / `mountain` (and the pinch variants)
→ `mountain` / `valley` role, `edge` → `edge`, `crease` / `dotted` /
`unfolded` → `aux` with `onBoundary` true at an endpoint on the sheet
boundary (the same rule `erodeCreaseOnSheet` uses); arcs that carry a fold
style are flattened to line runs (the painter has no arc); everything else
(`fold-arrow`, `turn-over`, `region`, `point`, `label`, `highlight` lines) →
one `markup` item. `sheet` = the sheet's extent in scene px.

**Verbs.** `references.exportStepSvg` / `references.exportStepPng` in
`referencesActions.ts` (toolbar overflow + context menu), enabled when a
step or candidate diagram is shown; the export paints the current diagram
(Sequence: the current step; Find: the shown candidate) with
`exportPaperStyle(paperStyle)` through the `references` policy and
`settingsStore.paperExport`, at the big view's on-screen sheet size (D3,
as-shown), saved as `<workspace> step N.svg|png` through the file service;
`paper exported { surface: 'references', … }`. The fold animation's mid-fold
pose is not exported (the step at rest is the diagram); recorded as a later
option.

### 11. Phase 7 contracts

What the projector still does, and what replaces it:

| Use | Today | Phase 7 |
| --- | --- | --- |
| SVG/PNG export | already the scene (Phase 3) | — |
| The `.osf` picture and the fallback canvas | `renderSnapshot`, an Oriedita primitive stream from `projectFolded3dModel` | a stored **`PaperScene`** |
| Re-projection on a colour/orbit change for an unwindowed figure | `folded3dReproject.reproject3dFigureAt` | the same shape, producing a scene |
| `FoldedFigureCamera`, `DEFAULT_FOLDED_3D_CAMERA`, `folded3dCoplanarEpsilon` | exported from the projector file | moved to `folded3dCamera.ts` (types and constants only) |

**Stored picture.** `OristudioCpFoldedFigureEntry.renderSnapshot` keeps its
meaning for the **flat** figure (the kernel's own stream, unchanged). A 3D
figure stores `scene: PaperScene | null` instead, written by
`folded3dPaperScene` at the same moments the projector ran (fold, refold,
another solution, a style change, the once-per-gesture commit of a turn).

*Not* on a colour change, which is the one moment that drops out: the model's
colours are a derived mirror of the effective style (D6) and a scene carries
geometry and roles and no ink, so nothing a colour edit touches can move a
vertex. The canvas and the painter re-ink the scene that is already there.

A scene carries no *colour*; it does bake the **light**, as each face's
`shade`, and the widest pen, which is the ink allowance the hidden test
measures with. There is no normal left to re-light a stored scene from, so
those reach a figure through a rebuild and nothing else: `folded3dSceneStyleKey`
is the list, `setOristudioCpFoldedFigureAppearance` rebuilds on a figure's own
pin, and `refreshOristudioCpFolded3dScenes` — driven from the paper mirror's
settings subscription, the one place the app's display style is watched —
rebuilds every 3D figure when the app's changes. Derived state, so neither
selects nor dirties, and a figure with no kernel keeps the picture it was
saved with. Without this the window followed the light and the canvas and the
`.osf` kept the shading of the last rebuild.

Coordinates: a stored scene is in the figure's **local user space** — the
space `placement` transforms, which is where a flat figure's `renderSnapshot`
lands after `cpModelToSvg` — and not the CSS px of the camera a page scene
uses. It is built at the frame's side in user units *before* the placement and
shifted so the model centroid sits on the placement's pivot. It has to be: the
canvas scales the stored picture by `placement.scale` on every frame, so a
picture built at the placed size would draw at the square of the figure's
scale the moment it was turned. `folded3dStoredScene.ts` is the one producer,
and its `space` option is `'document'` for the store and the canvas or CSS px
per user unit for the export. `.osf`: `viewState.foldedFigures[i].scene`, validated field by field
in `nativeProjectFile.ts` beside the existing snapshot validator; a file
written before this carries `renderSnapshot` on a 3D figure and is read as
before — the fallback canvas can draw either, and the next write replaces it
with a scene. `NATIVE_PROJECT_SCHEMA_VERSION` stays 8 (additive, D1's rule);
`minimumReaderSchemaVersion` untouched. An older build opening a new file
sees a 3D figure with no `renderSnapshot` and shows it as not-yet-rehydrated,
which is the same state it shows for a figure it cannot draw — acceptable,
and stated in the release notes.

**Fallback canvas.** `cpFoldedToScene` gains a branch that turns a stored
`PaperScene` into the GPU's fills and strokes directly (faces → fills in the
scene's own colours through the effective style, lines → strokes in their
pens), replacing the primitive-stream path for 3D figures. The flat figure's
primitive path stays.

Buried pieces are dropped — a deep figure's hidden layers are thousands of
triangles per frame of a pan — *except* under `Transparent3`, where the display
style's `faceAlpha` goes into the fill and the hidden test is exactly what must
not be applied. The window draws X-ray translucent, so the canvas has to, or a
figure would change appearance the moment it lost its window; and X-ray is the
one style under which two solutions of a figure look different
(`foldedFigureCapabilities`), which is what "Show another solution" is for. The
*export* is unchanged: a painted page is opaque paper with every layer kept,
which is the reading above — a translucent style has no scene form.

A figure with **no kernel** paints its stored scene on the export page, and the
stored scene is in local user units while a page scene is in CSS px. It is
carried into that space first (`folded3dStoredSceneInCssPx`, the factor being
`placement.scale × cssPerUserUnit`): the page keeps its pens at their pt widths
whatever the artwork's scale, so painting the document scene where it lies is
not a smaller sheet but a heavier crease, and the same figure would export two
drawings depending only on whether it had been rehydrated.

**Deletions.** `foldedFigure3dProjection.ts` and its tests
(`foldedFigure3dProjection.test.ts`, `folded3dProjectorParity.test.ts`,
`projectorIsExportOnly.test.tsx`) go once nothing imports them; the parity
gate that remains is `folded3dSceneSkinParity.test.ts` (scene vs the window's
draw passes), which is the invariant the projector harness was standing in
for. `folded3dModelReader.ts`'s "lifted verbatim from the projector" note
becomes the statement that it is now the only reader.
`folded-figure-viewport.md` §5 gets a closing paragraph: R7 holds by
construction, one figure one drawing, and the measurement that once argued
against the mesh route no longer applies (F9).

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

- [x] `lib/paper/paperScene.ts`, `paperSvg.ts`, `paperPng.ts`; painter tests
      (pens, dash centring, pt page, sheet size, erode, seam, multi-loop,
      buried faces kept/dropped). `paperPage.ts` holds `PaperPage`; `svgToPng`
      moved to `lib/svgToPng.ts` (re-exported from `creaseExport`) so the
      painter carries no CP-workspace imports.
- [x] `meshToPaperScene` split out of `renderMeshToSvg` with the additive
      options (`packages/origami-simulator/src/paperScene.ts`); `prepare.ts`
      tags a source `F` edge aux and a triangulation diagonal facet
      (`edgeCodes.ts`). Deviations from §6, with reasons:
      - Option arrays are typed `ArrayLike<number>`, so a kernel can hand over
        a plain array or a typed one; `lineWidth` (the tree's ink allowance
        and the hidden test's stroke), `showFaces` and `showEdges` (framing)
        are options §6 did not list.
      - `sourceFaceGroups` joins triangles across facet edges only, never
        across an aux crease, so the crease keeps an edge to lie on.
      - A merged face is emitted where the run's *last* piece stood, so a
        buried piece of the same face still precedes what covered it; a run
        is cut where a buried piece of another face, or a buried line, sits
        between two of its pieces and overlaps what the run has gathered, so
        no piece moves past something it could hide (the keep-hidden-faces
        contract: deleting a cover reveals what the tree put beneath).
      - `onBoundary` reads a vertex's count of border and fold edges: an
        endpoint retreats when another such edge meets it there; a cut end
        never does, and a paper edge never retreats. Whether an end is the
        crease's own vertex is decided in the space the tree cut in, not on
        the page: under `layers` a vertex's page position (its float32 view
        position projected) and `projected.screen` (the float64 projection
        rounded) differ in their last bits at any real camera, and a page
        comparison reported every 3D-figure crease as `[false, false]`.
- [ ] Aux edge pass in the GPU renderer — with Phase 5's "simulator GPU aux
      pass", which is the same item.
- [x] Simulator `exportSvg` → scene → painter; `keepHiddenFaces` export
      option in the simulator export menu; page per D3. Export page settings
      (`settingsStore.paperExport`, `lib/paperExportSettings.ts`, seeded from
      the retired `exportBackground`) edited in Settings ▸ Paper's "Export
      page" section and the Simulate pane's Export group through one hook
      (`hooks/usePaperExportPage.ts`); `paper exported` fired from
      `useSimulatorViewExport`; `renderMeshToSvg` / `SvgRenderResult` /
      `svgRenderer.ts` deleted, its tests re-pinned onto `meshToPaperScene`
      (`paperScene.test.ts`, `bsp.test.ts`) and the painter (`paperSvg.test.ts`).
      Deviations from §6, with reasons:
      - The worker's `exportSvg` keeps the optional `camera` / `settings` it
        took before, beside the required `style` and `page`: on the canvas-2D
        path the worker was never sent a view, and `showFaces` / `showEdges`
        are framing, not style. Only those two reach the page from `settings`.
      - The worker applies the simulator policy (`applyPaperStylePolicy`) to
        the style it is handed before painting, so `erode` and the aux pen —
        not yet drawn on screen — cannot reach the export before Phase 5.
      - `sheet` is the longest axis of `OrigamiModel.originalPositions`, the
        normalised solver space the camera fits to, rather than
        `prepared.originalPositions`, which is the document scale.
      - An empty scene (faces and lines both off, or no model) answers `null`,
        as before, rather than a margin-only page — it is what the export hook
        reads as "nothing to export yet".
      - Strain colouring and x-ray translucency have no scene form (§6's own
        note on the serializer); an export in those modes is the opaque paper
        two-tone. The tests that pinned them went with the serializer.
      - An inline window's frame-shrunk creases (`creaseWidthReferenceEdge`)
        are not reproduced: the painter writes pens in pt (D3, D10), so a small
        window exports at the style's widths.
      - The export paints with `surfacePaperStyle` (beside `resolvePaperStyle`),
        the style as the screen draws it: `RenderSettings` has one crease
        width and the GPU and canvas-2D renderers draw border, mountain and
        valley at it, so the edge and valley pens take the mountain pen's
        width (the "Fold line weight") on the simulator surfaces, and a
        folded figure's fold pens are its edge pen. The painter's "lines take
        their role's pen" holds; the pen it is handed is the surface's. An
        edge-width row on a simulator surface stays inert, on screen and in
        the file alike (D10 per-role widths would lift both together).
      - The page margin is `max(paddingMm, half the widest pen)` — the crop is
        the geometry's extent and a pen is centred on it, so a zero margin
        would clip the outer half of every outline. Invisible at the 5 mm
        default; re-pinned from the serializer's "leaves room for the crease
        stroke" test.
      - The GPU edge shader centres each dash pattern on its edge (a per-edge
        phase from the ribbon length, `dashPhasePx`), the painter's
        `stroke-dashoffset` rule, so a dashed fold looks the same at both ends
        on screen and in the file. The canvas-2D fallback draws a visible
        edge as pieces and restarts the pattern at each, so it does not
        centre.
- [x] Inline windows on the same path: `useSimulatorViewExport` takes the
      surface and the window's `appearance`, resolves
      `effectivePaperStyle(export ?? display, appearance)` on the main thread.

### Phase 3 — 3D figure export through the shared path

- [x] `FoldedMeshSource` → `meshToPaperScene` with side, kernel order on
      `BspItem.order` and `folded3dDrawPasses` ranges (F9); creases unbiased.
      Landed as `cp-workspace/folded/folded3dScene.ts` (`folded3dPaperScene`,
      `folded3dSceneCamera`, `folded3dFigureBoxCssPx`) over the mesh's
      translucent + undetermined runs, with `folded3dScene.test.ts` as the
      §7 parity gate: paper agrees with the draw passes pixel-for-pixel at
      32 cameras on every fixture, and the scene never lacks ink the window
      draws. Deviations from §6 / §7, with reasons:
      - **`meshToPaperScene` cuts in view space under a new `layers` option**
        (`{ coplanarEps }`; also `edgeOrder` per crease, and
        `BuildBspOptions.orderBeforeKind`). §6's screen-space tree is the
        GPU's depth arithmetic, but the perspective is a central projection
        and it bends a *plane*: two triangles of one kernel plane are not
        coplanar in screen space at a tilt, so a plane's stack could not be
        one node and most of a tilted figure's creases came out under their
        own faces (measured on the fixtures before the change). In view space
        the kernel's planes are planes, `coplanarEps` is the kernel's own
        distance (`folded3dCoplanarEpsilon`, the projector's number), the
        eye is a real point at `camDist`, and a cut point projects onto the
        straight screen segment (to 1e-14 px; the header's "bends" note was
        about a different warp). The simulator's path is untouched.
      - Under `layers` a coplanar node sorts by `order` before kind, so a
        buried layer's creases draw over that layer and under the next and
        come out `hidden`; a layer's creases are ordered past every face of
        the layer, so paper still precedes ink within it. Orders are bands
        per rank (0 = the layer the skin shows), faces by kernel face id
        within a band so a face's cells sit adjacent for the merge; the
        kernel's `draw_rank` is not carried — cells of one plane are
        area-disjoint, and the containment defect it tie-breaks is one the
        window's single-skin pass cannot order either.
      - A crease on the line where two planes meet is coplanar with both and
        the tree files it under whichever it reaches first; under `layers` a
        crease is moved to follow the piece of its own triangle (by vertex
        identity, then the piece holding both endpoints) when the tree drew
        that piece after it, which is the GPU's "each plane's creases after
        its paper". Without it half of every hinge was painted over. The
        pass indexes face pieces by triangle once and is linear in the
        pieces; scanning forward per crease was quadratic and took seconds
        on a deep figure where the tree takes milliseconds.
      - `sides` is not passed: the mesh's winding *is* the GPU's side, and
        the scene reads it through the same projection; the test pins it to
        the payload's `facing × up` against the eye instead.
      - Hinge admission is applied per crease from a new
        `Folded3dMesh.hinges` table (partner plane and required side, `0` for
        a hinge buried on both sides), the window's `hingeGroups` rule
        restated per crease so the translucent run can carry it. It applies
        to buried layers too: the covering layer inks the same segment only
        as a hinge of its own under the same condition, so an unadmitted
        bend would show its outer half past the paper. Cost: uncovering a
        buried layer in an editor reveals it without those bends.
      - Options carry `tolerances` (the figure's `folded3d.diagnostics.tolerances`,
        which the coplanar distance needs) and `displayStyle` (Wire2 draws
        the skins' creases only; None0 nothing; Transparent3 exports as
        opaque paper, every layer kept — a translucent style has no scene
        form).
      - The camera is exactly the window layer's: `folded3dWindowView` (zoom
        clamped), zoom × `folded3dFrameFillZoom(side, side)`, the mesh's
        centre and radius, the box side in CSS px — not §7's
        `radius × silhouette factor`, which describes the same fit less
        precisely. The box comes from `foldedFigureBox` (the frame) times the
        crease-pattern camera's CSS px per user unit, read by the caller.
      - What the parity gate pins as the window's loss rather than the
        scene's: a concave crease seen obliquely from inside a fold (the far
        corner of `box_90`, a spike's base) — the paper beside the line is
        nearer than the line and the GPU's 1e-5 NDC bias cannot carry the
        ribbon over it, while the painter's order keeps the line at full
        width. Bounded per fixture in the test.
      - Found and fixed on the way: `hiddenPieces.polygonSpans` computed a
        shared edge's crossing from whichever endpoint the piece walked
        first, so two pieces sharing an edge in opposite directions could
        leave a crack of samples along it (a square's diagonal exactly on the
        sample grid, which a figure seen face-on produces) and a buried piece
        showed through. Crossings are now computed from the lower endpoint.
      - 0° creases stay role `edge` until Phase 5 (the mesh emits no aux code).
- [x] Tier A merge by `(plane, face)` within a node; parity harness green at
      the pinned cameras or re-pinned with a reason. The merge is in place
      through the band ordering above. `folded3dProjectorParity.test.ts` is
      untouched and still green: it compares the window with the *projector*,
      which this phase does not change, so its 3 + 22 pinned disagreements
      stand until Phase 7 retires it. The §7 parity gate that replaces it is
      `folded3dSceneSkinParity.test.ts`: on the harness's five fixtures over
      its 8 × 13 sweep, the `(face, side)` set the scene leaves unhidden is
      exactly the set of skins `folded3dDrawPasses` shows — forward against
      the skins the passes submit, reverse against a depth-buffer rasterisation
      of the passes (a submitted skin can still be behind a nearer plane, or
      under its own creases when seen nearly edge-on, which is the window's
      ink and not its paper).
- [x] Standalone export reads the scene ("Include folded figure" is the flat
      re-fold; Phase 4).
      Standalone: `exportOristudioCpFoldedFigure` for a figure with `folded3d`
      and a live render model paints `folded3dPaperScene` through
      `paperSceneToSvg` / `paperSvgToPng` (`cp-workspace/folded/folded3dFigureExport.ts`),
      on `exportPaperStyle(paperStyle, figure.appearance)` (a new helper in
      `lib/paperStyleSettings.ts`, which `useSimulatorViewExport` now shares)
      and `settingsStore.paperExport`; `paper exported { surface: 'folded-3d' }`
      fires on a save. Deviations from §7, with reasons:
      - The painter is handed the style through the `folded-3d` policy, as
        the simulator hands its own policy's view to the painter: the window
        draws every crease with the edge pen, so the file does too; the
        mountain/valley pens would otherwise dash creases the window draws
        solid. The scene producer applies the same policy for its light and
        pen width, and the policy is idempotent.
      - The on-screen box is read from `cpOverlayViewStore` (`user` affine,
        `overlayCssPerModel`), not `cpCameraRegistry`: the registry publishes
        camera *verbs* and has no zoom reader, while the overlay store is the
        live camera affine every folded-figure overlay already projects
        through. No canvas mounted → 1 CSS px per user unit, the box at zoom 1.
      - A figure the scene path answers null for — no handle (reopened, not
        yet rehydrated), a handle whose render model was released, a model
        past the mesh's vertex budget, or a `None0` figure — keeps the stored
        `renderSnapshot` path in `foldedFigureExport.ts` (R7, until Phase 7),
        which fires only the file service's `file exported`.
      - "Include folded figure" in the CP export dialog is the flat re-fold
        (§7), so it is untouched here and moves in Phase 4.
      Tests: `store/workspaceStore/exportFoldedFigure3d.test.ts` (style and
      page reach the painter, the figure's pins, PNG at `pngDpi`, the
      handle-less fallback, the event).

### Phase 4 — Flat figure: kernel accessor and whole-face export

- [x] `folded_figure_paper_scene` in `folding.rs` (additive) + `session.rs`
      + wasm export + native command + TS types + runtime getter; Rust tests:
      accessor top face per subface == drawer's `visible_subface_face`, and
      subface polygon == the drawer's `fill_path` ring, front and back.
      `aux_lines` is empty by construction — the fold takes only
      folding-colour creases, so the wireframe never carries a `Cyan3` line;
      Phase 5's overlay needs an accessor that folds the document's aux lines
      face by face. `Flat` never occurs on an outline for the same reason.
- [x] Web: face DAG from stacks, topological order, SCC split; scene with
      whole faces, per-edge roles, hidden layers (`foldedFlatScene.ts`). A
      split face's outline goes with the pieces it bounds, so a line the
      cycle buries is drawn under the piece that buries it; the tests fold
      the solution sample and the kabuto through the wasm kernel in Node and
      hand-build the weave.
- [x] Rebuild `build:oristudio-cp-wasm`; flat export through the painter.
      Standalone: `exportOristudioCpFoldedFigure` for a flat figure with a
      live handle reads `folded_figure_paper_scene(handle)` and paints
      `foldedFlatPaperScene` through `paperSceneToSvg` / `paperSvgToPng`
      (`cp-workspace/folded/foldedFlatFigureExport.ts`) on
      `exportPaperStyle(paperStyle, figure.appearance)` through the
      `folded-flat` policy and `settingsStore.paperExport`;
      `paper exported { surface: 'folded-flat' }` fires on a save. The CP
      export dialog and the share card: `foldSegmentForExport` also returns
      the accessor's scene for its ephemeral handle (`CreaseExportFoldResult.scene`,
      null when the kernel has no paper picture), `buildCreaseExportArtwork`
      composes `paperSceneSvgBody` — a new body-only painter entry in
      `lib/paper/paperSvg.ts` taking the caller's projection and the page's
      units per pt — in place of `foldedFigureSvgBody` whenever the content
      carries a scene, with the dialog's front/back colours pinned over the
      export style's paper (`creaseExportPaperStyle`; the side is the kernel
      state the fold was made with) and the export page's "Keep hidden faces".
      Both dialogs read the style and the option through
      `hooks/useCreaseExportPaper.ts`. Deviations from §8, with reasons:
      - The page is the figure's on-screen *size* only — kernel units through
        the paper affine, the placement's scale and the canvas's CSS px per
        user unit (`foldedFlatFigureScenePxPerUnit`) — not its placement
        offset or rotation. A standalone image has no canvas to be placed on,
        which is the rule the snapshot export and the 3D path already follow.
      - The scene path is the `Paper5` picture only. `Wire2`, `None0` and the
        development styles keep the stored `renderSnapshot` path, as the
        paper scene has no form for a wireframe or nothing; so does a fold
        with no layer ordering — `Transparent3` is where the kernel parks a
        search with no solutions or a contradiction (`FoldOutcome`), and its
        stored development, red faces and all, is the picture. The session
        accessor answers `None` for such a fold instead of searching again
        (`folded_figure_paper_scene_from_session` gates on a solved overlap;
        the render path searches only for a `Paper5` request), the standalone
        export gates on `snapshot.outcome === 'Solved'`, and the CP export
        dialog's `foldSegmentForExport` reads the scene only when the fold
        reached `Paper5`. A *solved* figure the user views as `Transparent3`
        does take the scene path, and exports as opaque paper with every
        layer kept, as the 3D figure's X-ray view does.
      - The scene is read by the store (the runtime call is asynchronous) and
        the module is the pure half, so its test folds the solution sample
        through the wasm kernel in Node and paints that.
      - `foldedFigureSvgBody` stays for the handle-less fallback and for a
        fold the kernel answers no scene for (Phase 7).
      - Re-pinned: `CommandDialogModal.test.tsx`'s resolved content now
        carries `foldedFigureScene` and `paper`; the `creaseExportFold` runtime
        fakes gained `paperScene`.
      Tests: `store/workspaceStore/exportFoldedFigureFlat.test.ts`,
      `cp-workspace/folded/foldedFlatFigureExport.test.ts`,
      `lib/paper/paperSvg.test.ts` (body entry), `lib/creaseExport.test.ts`
      (scene in place of the snapshot, hidden layers, the fallback, the
      pinned style), `lib/creaseExportFold.test.ts`;
      `session_paper_scene_declines_a_fold_with_no_layer_ordering` in
      `crates/oristudio-cp/tests/folding.rs`. The Oriedita render oracle was
      not run locally for this phase; CI's `native-oracle` job covers the
      `paper_hierarchy_table` extraction.
- [x] `PORTING.md` note.

### Phase 5 — Aux creases and erode on every surface

- [x] Kernel: `FoldedPaperScene.aux_lines` populated. `CpSession` captures
      the document's `Cyan3` lines with each flat fold
      (`FlatFoldedFigure::aux_segments`); `paper_scene_aux_lines` clips each
      to every face of the unfolded sheet (`Polygon::clip_segment`) and places
      each piece by `FoldGraph::fold_point`, the face's own reflection chain,
      through the pass's camera; `face` set, runs along a crease and pieces
      under `Epsilon::POINT` dropped. Both entry points take the aux slice
      (`folded_figure_paper_scene_from_segments(segments, aux_lines, …)`).
      Tests: in-crate `aux_lines_are_split_at_the_fold_and_carried_by_their_face`,
      `tests/folding.rs` `paper_scene_aux_lines_lie_inside_their_faces_one_piece_per_face_crossed`
      (every fixture, both sides: inside the face's folded outline, crossings + 1
      pieces) and `session_paper_scene_folds_the_documents_aux_lines`.
- [x] Flat figure display: aux overlay from the accessor on the folded channel.
      `cpFoldedToScene` takes a per-figure reader (`FoldedFigureAuxStrokes`:
      pieces in the snapshot's coordinates, the aux pen's colour, its width in
      pt as the multiplier over the frame's device px per pt) and strokes the
      pieces through the same paper affine and placement as the snapshot's own
      primitives, at a depth just above the figure's last fill and below the
      edges the drawer painted after it (`FoldedFigureLocalGeometry.auxDepth`).
      The scene lives in `folded/foldedFlatScenes.ts`, keyed by handle and
      released with it (`foldedFigureHandles.ts`), remembering the kernel
      snapshot it was fetched for so a refold, another solution, a side flip or
      a rehydrate is a new scene and a selection marker or display style is not.
      **Deviation from §9:** the fetch is driven by the canvas's
      `useFoldedFlatAux(figures)` rather than placed beside each of the store's
      fold completions. Whether a figure wants its scene is a function of the
      display style and its own pins, which the nine completion sites do not
      read, and the toggle turning on later — on a figure or app-wide — needs
      a fetch none of them would see; one hook that asks "does this figure
      want a scene it does not have" against the snapshot's identity covers
      every case in one place. `folded/foldedFlatAux.ts` cuts the pieces: erode
      first (an end on the face outline, by the shared `auxLineOnBoundary` /
      `erodeSegment`, by erode × `kernel.sheet`), then **clipped to the
      subfaces whose stack has the line's face on top** — the drawer's stream
      has no buried layer to cover a buried piece, so "covered by the layers
      above in painter order" is not available on the canvas and the pieces
      under other layers are left out instead; the picture is the export's.
      That clip is the `Paper5` picture's only: under `Transparent3` and
      `Wire2` the drawer shows every layer, so every eroded piece is drawn
      whole (`foldedFlatAuxCoverage`, read off the figure's display style in
      `useFoldedFlatAux`) — a buried face's creases show with the face.
      Not drawn: the aux pen's dash and cap (the folded channel has neither,
      for any pen). Tests: `foldedFlatAux.test.ts`, `foldedFlatScenes.test.ts`,
      `useFoldedFlatAux.test.tsx`, and `cpFoldedToScene.test.ts` ("a flat
      figure's aux creases").
- [x] 3D mesh aux code drawn when `auxCreases.visible` (effective, per
      object); simulator GPU aux pass. `folded3dEdgeAssignment` maps a 0°
      crease to `EDGE_CODE.aux`; `buildEdgeQuads` builds a ribbon for codes
      0..3 (facets still skipped) and the vertex shader clips an aux ribbon
      behind the far plane unless `u_showAux`, so the toggle is a uniform, not
      a buffer rebuild. `RenderSettings` gains `auxColor`, `auxWidthPx`,
      `showAux` and `creaseDash.aux` (`DASH_KINDS` = 4, `packCreaseDash`
      packs four); the aux pen keeps its own width through `rasterCreaseInk`.
      The canvas-2D fallback reads the same codes (`SimulatorModelInfo.edgeCodes`,
      from `meshTopologyFor`) and draws code 3 in the aux pen or leaves it
      out; it no longer draws facet diagonals (nothing else ever did) and no
      longer dims an `F` edge. Policy: `auxCreases.visible`, `auxCreases.pen`
      and `erode` apply on every surface; `mountainFolds` / `valleyFolds` on
      `folded-3d`, so the 3D window inks M/V pens at the fold line weight
      under `surfacePaperStyle`'s one-width rule, as the simulator does.
- [x] Erode in the painter and in the GPU edge builders (`onBoundary` flags
      from each producer); paper-relative distance. The rule lives once in
      `packages/origami-simulator/src/edgeBoundary.ts` (`edgeBoundaryFlags`:
      two bits per edge); the scene producer, `buildEdgeQuads` (a per-vertex
      `a_shrink` attribute) and the canvas-2D render model
      (`SimulatorRenderModel.edgeBoundary`) all read it. The shader pulls a
      flagged end toward the other by the erode distance, collapses the ribbon
      where the pull would pass the midpoint (the painter drops it), and
      centres the dash on the eroded segment, as the painter does.
      Two agreements found in review: `outlineVertexCounts` counts an edge
      once however many times a buffer lists it — the 3D figure's buffer
      carries a crease in every run that inks it (skin, hinge group,
      translucent) on the same vertices, and a crease's own copies were
      passing for other creases meeting its ends, so the window retreated
      ends the export (which reads one copy) left whole
      (`folded3dMesh.test.ts` "erodes the same crease ends on screen as the
      export does", every fixture); and a piece the tree cut from a crease
      carries the whole crease (`PaperLineItem.whole`: its ends and flags), so
      the painter erodes the crease and clips the piece to what is left
      (`erodeLine`), as the shader and canvas-2D measure on the whole edge —
      a piece cut near a flagged end keeps its stub rather than collapsing on
      its own length.
      **Deviation from §9 / the item contract:** `RenderSettings` carries
      `erode` as the style's own unit — a fraction of the sheet — rather than
      `erodePx`, and the resolver takes no `sheetPx` option. The camera's
      scale lives in the worker (`fitTo` → `cameraUniforms`) and moves with
      every zoom, while render settings are resolved on a style or theme
      change only, so a device-px figure resolved on the main thread would be
      right for exactly one zoom, and for the simulator could not be computed
      there at all (the fitted radius is worker state). Instead each renderer
      holds the sheet's world extent (`MeshRendererOptions.sheet`, from
      `sheetExtent(originalPositions)` in the solver and `Folded3dMesh.sheet`
      = `model.span` for the 3D window; `SimulatorRenderModel.sheet` for
      canvas-2D) and computes `erodePx(settings, sheet, camera)` =
      `erode × sheet × camera.scale` per draw — exactly the painter's
      `erode × scene.sheet`, since the scene's sheet is that same product.
      The item also asked for a headless-Chromium link check of the shader;
      the package has one in `bench/gpuParity.bench.ts` (its render check),
      which was run and passes; `tests/edgeShader.test.ts` pins the GLSL
      source's agreements with the JS (array sizes, attributes, aux clip,
      eroded dash phase) where a link would not catch them.
- [x] Properties sheets and Settings ▸ Paper rows for the fields Phase 5
      added to the policies. `cp-workspace/paper/paperStyleFields.ts` writes
      the rows once — `auxAndErodeFields` (toggle, aux colour, aux width in pt,
      erode as a percentage of the sheet, each with reset while pinned) and
      `foldPenFields` (the simulator's crease style, mountain, valley and fold
      line weight, moved out of the inline sheet) — and the folded-figure and
      inline-simulation catalogs compose them by their policy, so both sheets
      pin exactly their policy's `applies` again (the tests are re-pinned back
      from the subset). The 3D figure gains the fold-pen rows its policy took
      in this phase. The folded Style menu offers the existing-crease toggle
      on both kinds (the pen and erode are numbers a menu has no row for).
      Settings ▸ Paper gains the erode row (percent of the sheet). Six new
      strings, translated in the eight locales. Not done: the Simulate pane's
      View Controls (`SIMULATOR_PANE_FIELDS`) still has no aux or erode rows.
      The 3D figure's Line row and the Style menu's line colour write the
      inline sheet's edge-ink pins (`edgeInkEdits`, hoisted into
      `paperStyleFields.ts`): the edge pen whole, and under a mono style the
      fold pens with it, so the Style select does not fall to Custom on a
      recolour; the flat figure's policy has no fold pens and pins the edge
      pen alone. **A visible change on existing files:** a 3D figure whose
      legacy `line_color` was recoloured maps to an `edges` pin (D1, unchanged)
      and now draws its M/V creases in the app style's fold pens with only
      its borders in the pinned ink, where before this phase every crease
      took the pinned ink. Pinning the fold pens for legacy 3D figures alone
      would be a per-kind migration D1 does not define, so it is left as the
      D1 mapping says.
- [x] References: existing creases honour aux pen and erode. `diagramInk.ts`:
      `penInk` (a pen at a weight in ink), `cardDiagramPens(style)` (the
      crease at the aux pen's ratio to the edge pen over the table's edge
      weight, so the card stays sheet-relative), `canvasDiagramPens(…, aux)`
      (the crease at the aux pen in CSS px, as the arrow); the fourth dash
      slot is the crease's, filled from the pens in hand. `erodeCreaseOnSheet`
      in `stepDiagramGeometry.ts` (sheet units, the sheet's rectangle round its
      centre, the shared `erodeSegment`) is applied by the card's
      `diagramPrimitiveShape` and the big view's `diagramToScene`, which also
      leave `crease` lines out when the toggle is off. The card reads the
      display style itself (`useReferencesCardInks`); the big view's inks
      travel on `ReferencesPaperStyle.inks`. **Deviation:** no CSS
      custom-property set for the card — the card's crease pen is geometry
      (a width, dash runs and a cap in ink), and `diagramInk.ts`'s own rule
      keeps geometry in TypeScript where the drawing's size is known; the
      store reaches every card the way the tokens reach them through the
      root. Note the default `auxCreases.visible: false` now hides a step's
      existing creases on References until the toggle is on. The big view's
      sheet is the frame's image, which may be turned: `DiagramSheet.axes`
      carries the frame's unit axes (`diagramInModel` from the precrease
      frame, `sheetOf` from `modelFrame`'s mapped bottom and left edges), and
      `erodeCreaseOnSheet` reads the boundary in the paper's own frame, so a
      rotated CP erodes on its real edge and the card and the canvas agree.
      Tests: `diagramInk.test.ts`, `stepDiagramGeometry.test.ts`
      (`erodeCreaseOnSheet`, a turned sheet), `diagramToScene.test.ts`,
      `StepDiagram.test.tsx` ("the existing creases on a card"),
      `usePaperStyleTokens.test.tsx`.
- [x] Facet flags survive a second preparation: `prepareFoldModel` writes
      `oristudio:edges_facet` on the document it returns and reads it back,
      so the app's triangulate → re-orient → prepare-again simulation path no
      longer turns every diagonal into a drawable aux crease (found in the
      browser once aux creases were drawn).
- [x] `DEFAULT_PAPER_STYLE.auxCreases.visible` is `true` (diagrams draw the
      creases already made; the Oriedita preset keeps `false`).

### Phase 6 — Precrease step export

- [x] `diagramToPaperScene`; export verbs (SVG / PNG for the current step) in
      `referencesActions.ts`, toolbar + context menu; analytics.
      `cp-workspace/references/diagramToPaperScene.ts` is the producer of §10
      (the sheet as one face, lines by role, arcs with a fold style flattened,
      everything else through `diagramPrimitiveShape` into one `markup` item
      with its inks written in). **Deviation from §10's signature:** it takes
      the `DiagramProjector` (`project`) rather than a bare point map and a
      `sheetPx` — the scale, ink, pens and basis the symbols need are on it —
      and `mirrored` is optional, read off the projector when absent. It must
      be passed for the big view: a model-frame model's frame is left-handed
      (`frame.rs`: `y_axis` is screen "up"), so a projector onto the canvas
      reports `mirrored` *true* for the front; the panel knows which face the
      reader is on (`sideAt`) and says so, while the projector's flag keeps
      deciding the sweep of an arc in the markup. `referencesStepExport.ts`
      (`referencesStepExportPage`, `referencesSheetCssPx`,
      `referencesStepExportName`, `saveReferencesStep`) paints the diagram the
      big view shows — the panel's `highlights.diagram`, which is the
      Sequence's current step or turn-over, or the shown candidate's step in
      Find — at the view's on-screen sheet size (the model sheet's longer
      side through the camera's scale; a fixed 512 px before the first frame),
      with `exportPaperStyle(paperStyle)` through the `references` policy and
      `settingsStore.paperExport`; `useReferencesStepExport` is the panel's
      binding (settings, camera, title read at export time; toasts as the
      simulator's). A finished card has no diagram — the pattern itself is
      that picture — so export is disabled on it, as on an empty strip and on
      a finding. The verbs `references.exportStepSvg` /
      `references.exportStepPng` are registry shortcuts with no default chord,
      so the toolbar button, the context-menu row and a chord the user binds
      are one path through the panel's executor; the toolbar renders them as
      one Export button opening the two formats (the simulator's control),
      the context menu as two rows after the camera verbs. **File naming:**
      `<title> step N` for a sequence card, where N is the number the strip
      prints on it (`foldCardNumbers`, which `planFilmstrip` and
      `referencesSequenceSubject` share) and not its place in `viewSteps`,
      which counts the turn-overs too; a turn-over card is
      `<title> turn over after step N`, since it has no number of its own and
      borrowing a fold's would collide with that fold's file; a candidate's
      step is `<title> reference C step N` rather than `<title> reference C`,
      or a candidate's four steps would all be one file.
      **The page is the sheet as it stands.** The Sequence's canvas diagram is
      built `earlier: 'unpatterned'` — it omits every earlier crease the
      pattern holds, because the CP renderer draws those under the overlay in
      the document's own M/V ink — and a file has nothing under it. So
      `ReferencesPlanScene` carries a second model, `pageDiagram`, built with
      the card's rule (`earlier: 'all'`), and the export paints that: the page
      shows the build-up as a **card** does, in the aux pen, rather than as
      the big view does in the pattern's own ink. `diagramToPaperScene` also
      emits the paper's border as four `edge` lines, which nothing else on a
      page would draw (a face is closed with a hairline in its own fill, and a
      model-frame diagram carries no `sheet` primitive), and lays the letters
      out unbounded as `ReferencesDiagramLayer` does — the scene's bounds grow
      to whatever they took, rather than a card's box pushing a corner letter
      somewhere the view does not show it. `paper exported` gains
      `surface: 'references'` (`docs/analytics.md`). Tests:
      `diagramToPaperScene.test.ts`, `referencesStepExport.test.ts`,
      `useReferencesStepExport.test.tsx`, `referencesActions.test.ts`,
      `referencesContextMenu.test.ts`, `ReferencesViewportToolbar.test.tsx`,
      `referencesShortcuts.test.ts`. Not done: the References canvas draws
      every crease at the reader's line width, and the page writes the
      style's pen widths in pt, so a step's export is WYSIWYG in geometry and
      colour but not in stroke weight — the same gap the flat figure has.
- [ ] Mid-fold frame through `meshToPaperScene`. Not exported: the fold
      animation's mid-fold pose is not part of the step's export (the step at
      rest is the diagram), as §10 records.

### Phase 7 — Retire the projector

- [x] `.osf` picture stored as a scene; fallback canvas draws a scene;
      migration for stored projector snapshots. (Additive, D1: a file carrying
      `renderSnapshot` on a 3D figure still loads and draws, so the schema
      version does not move. `scene` is optional on the entry, like every other
      3D-only sibling field.)
- [x] Delete `foldedFigure3dProjection.ts` and its tests; update
      `folded-figure-viewport.md` §5 (R7 now holds by construction).
      `cp-workspace/folded/folded3dCamera.ts` takes the camera vocabulary the
      rest of the tree imported from the projector — §11 named
      `FoldedFigureCamera`, `DEFAULT_FOLDED_3D_CAMERA` and
      `folded3dCoplanarEpsilon`; `defaultFolded3dCamera`, `antipodalCamera`,
      `foldedFigureOtherSideCamera`, `folded3dFrameRadius` and
      `folded3dEyeDirection` had importers too and went with them, since each
      is about where the eye is rather than about a drawing.
      `folded3dReproject.ts` kept its shape and its name (item A had already
      moved it onto the scene).

      Tests. `foldedFigure3dProjection.test.ts` and
      `folded3dProjectorParity.test.ts` are deleted; `projectorIsExportOnly.test.tsx`
      is **renamed** `sceneIsExportOnly.test.tsx` — item A had already moved it
      onto the scene, so the rate statement it makes is unchanged. The camera
      invariants it held (the default camera pure in payload and side, "other
      side" an involution, the coplanarity tolerance a distance not an angle)
      move to a new `folded3dCamera.test.ts`, which also pins the frame radius
      as the model's bounding sphere. Two of the harness's assertions had no
      home, so they were written rather than dropped: the wiring test — that
      the scene hands the tree the *kernel's* epsilon, which no fixture's
      geometry would notice — is now in `folded3dScene.test.ts` over a partial
      mock of `meshToPaperScene`; and the serializer's "every primitive, in
      order" is re-pinned in `foldedFigureExport.test.ts` on a hand-built
      stored snapshot, which is the only kind of 3D picture that still reaches
      that path. Two mesh-vs-projector comparisons in `folded3dMesh.test.ts`
      are deleted (the layer a cell shows, and the R7 export end); both are
      the same claim `folded3dSceneSkinParity.test.ts` and
      `folded3dScene.test.ts` make from one mesh, which is stronger.
      `BSP_ITEM_BUDGET`'s two guard tests go with the budget.

      Deviations. (a) `exportFoldedFigure3d.test.ts`'s handle-less figure now
      carries a stored *scene*, so it re-paints through the painter and fires
      `paper exported` — it used to fall through to the snapshot serializer
      and fire nothing; a separate case covers a pre-Phase-7 file, which still
      does. (b) `folded3dStyle.ts` lost `Folded3dPaperStyle`,
      `folded3dPaperStyle()` and `StylePlan.annotateUndetermined`, which had no
      reader left once the projector went; the module is now the display-style
      plan and the two alphas. (c) `crates/oristudio-cp/examples/fold3d_render_model.rs`'s
      header named the projector as the consumer of its fixtures and was
      re-pointed; the fixtures themselves are unchanged and all seven are still
      read (`minimal_repro`, which the `--out` set does not produce, is now
      listed in their README with that provenance).

### Phase 8 — Auxiliary creases are the pattern's, live

Review after Phase 7 found the aux layer right only in the simulator. The
flat figure pinned its aux lines at fold time, so an aux crease drawn after
folding never appeared; the 3D fold never received the pattern's aux lines at
all; the precrease planner folded an aux line as the step's valley; and
References had no rule for aux lines. Decisions taken with the user:
aux lines follow the pattern live on both folded figures (no refold), the 3D
figure keeps drawing 0° creases in the aux pen, and References gets its own
"Show auxiliary creases" option beside "Auto-play folds".

- [x] Built-in presets are **Default** (`default`) and **Diagram**
      (`diagram`, the Origami House template, erode 0.5 % of the sheet);
      Oriedita and Black & white are gone. The ids never shipped, so a stored
      `builtin:ori-default` is not migrated — it reads as no preset, which
      the chip shows as the preset the style matches.
- [x] The copy says what the lines are: "Show auxiliary creases",
      "Auxiliary creases", "Aux crease color", "Aux crease width (pt)".
- [ ] Planner: aux-coloured segments are never targets. Excluded at the
      planner's entry with the caller's indices kept, so exactness, the grid
      and the merged lines never see them either.
- [ ] References: "Show auxiliary creases" view option — follows the style
      by default, resettable while overridden, stored per app. When on, the
      pattern's aux lines draw on every step in the aux pen, on the paper from
      the start, never planned, never tappable. The build-up of creases made
      in earlier steps no longer hides with the aux switch.
- [ ] Flat figure: the kernel maps the *document's* current aux lines at
      call time (the fold-time capture stays the fallback for a figure whose
      document is gone); the canvas refetches on an aux fingerprint of the
      pattern; export makes the same call.
- [ ] 3D figure: the pattern's aux lines mapped per face, so a buried layer
      hides its aux lines as it hides its 0° creases; live the same way.
- [ ] The flat aux fetch reports and retries instead of swallowing a
      failure.

### Validation per phase

Rust: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
`cargo test --workspace`, Oriedita oracle for Phase 4. Web: `npm run lint:web`,
`npm run typecheck:web`, `npm run test:web` (Node 22, from the web workspace),
`npm run build:web` when the wasm bridge or bundling changes. Rebuild the CP
wasm bridge after any kernel change before trusting the browser.
