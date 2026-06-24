# Oriedita Folded Grid Rendering Parity

## Goal

Render Oriedita-compatible folded figures directly in the crease-pattern grid
area, with exact folded-state parity against Oriedita as the hard requirement.

This is not a generic "show some flat-folded approximation" feature. The
compatibility target is Oriedita's folded-figure behavior: the same starting
face rules, estimation stages, solution enumeration, overlap hierarchy,
front/back display state, folded geometry, and preserved document data.

The eventual file goal is to import and export arbitrary Oriedita-oriented
documents without discarding embedded folded forms. That means preserving
multi-frame FOLD files, including `foldedForm` frames, even when the editable
crease-pattern view operates on one active CP frame.

## Approach

Use a staged port that separates three concerns:

- Preserve Oriedita/FOLD document structure exactly enough to round-trip.
- Expose Oriedita folded-figure state from `oristudio-cp` through WASM.
- Render folded figures as first-class grid-canvas overlays using Oriedita
  camera/display semantics.

Do not route this through the existing `treemaker-flatfold` folded-base preview
as a replacement. `treemaker-flatfold` can remain useful for the current Folded
Base pane and sequence planner, but the grid-area folded figure must come from
the Oriedita parity surface in `oristudio-cp::folding`.

### Migration Discipline

This plan is an extension of `implementation-plans/oriedita-port.md`, not a
separate shortcut. Follow that roadmap's migration rules:

- Oriedita behavior is the canonical reference.
- Every upstream behavior must be visible in the source map before product UI
  work depends on it.
- Unported behavior must return typed `UnsupportedOperation` or
  `NotImplemented` results.
- Staging is allowed; scope reduction is not.
- Do not replace Oriedita behavior with simpler approximations.
- Promote behavior only after focused Rust tests and Oriedita oracle coverage.
- Keep the kernel UI-agnostic; React should render and dispatch, not own
  folding semantics.

Map this feature onto the original stages:

- Stage 0: extend `implementation-plans/oriedita-source-map.md` with
  folded-figure drawing, cameras, folded-form frames, save metadata, and UI
  service/list behavior.
- Stage 1: add typed status/error entries for every folded-figure command and
  render mode, including explicit unsupported placeholders.
- Stage 4: finish preserving import/export for Oriedita `.fold`, `.ori`, and
  `.orh`, with multi-frame FOLD and embedded `foldedForm` coverage.
- Stage 10: complete folded-figure snapshot parity on top of the existing
  Oriedita folding-estimation port.
- Stage 11: expose only oracle-backed folded-figure APIs through WASM before
  wiring toolbar buttons.
- Stage 12: run external corpus checks and report unsupported or mismatched
  folded-document cases before claiming arbitrary Oriedita compatibility.

The rough migration order should therefore be: source-map and status inventory,
preserving document model, kernel folded snapshots, oracle comparison, WASM
bindings, grid renderer, then interactive UI affordances.

### Current Checkpoint

The first implementation pass has established the data path, but not exact
visual parity:

- multi-frame FOLD documents and embedded `foldedForm` frames are preserved in
  Rust, web import, and native `.osf` project persistence,
- Oriedita folding sessions can be created, advanced, snapshotted, and released
  through `oristudio-cp-wasm`,
- generated folded figures are tracked in workspace state with revision-based
  stale marking,
- imported folded-form frames and generated folded wireframe snapshots render in
  the CP grid area,
- compact Fold and Another controls exist for the active generated folded
  figure.

That renderer is intentionally only a checkpoint. It fits folded geometry into a
small SVG view and draws a wireframe-style preview. It does not yet reproduce
Oriedita's exact `FoldedFigure_Drawer` / `FoldedFigure_Worker_Drawer` Java2D
output for paper, transparent, wire, front/back, shadow, constraint, and marker
modes. Do not promote the current overlay as exact folded rendering.

### Remaining Lift

Exact folded-grid parity is a medium-large follow-up, roughly 8-15 focused
development days. The work is bounded because folding, subface setup, hierarchy
search, and solution enumeration are already partially ported. The remaining
hard part is making Oriedita's drawing decisions observable, porting those
decisions into Rust render primitives, and replacing the temporary SVG overlay
with a primitive-driven renderer.

Do not slice this by accepting approximate visuals. If a smaller milestone is
needed, slice by Oriedita display mode while keeping oracle parity for that
mode:

- paper front view,
- paper back and both views,
- transparent grayscale and colored-alpha views,
- wire view,
- shadows, constraints, crosshair, selected markers, and point-id overlays,
- multi-figure list interactions and camera manipulation.

Each slice must have oracle render-primitive fixtures before UI wiring is
treated as complete.

### Parity Baseline

The first implementation step should reconcile the Oriedita source baseline.
Existing repo notes cite Oriedita commit
`9d39135ae232cc03be4ffaf74baa7ae2df970507`; the local pinned checkout inspected
for this plan is `17434b90ff8bea1ad9acf7ce147893025f47e95b`. Pick one explicit
baseline before adding oracle fixtures, record it in `implementation-plans` and
the Oriedita oracle README, and treat all later behavior differences as either
intentional baseline updates or bugs.

Relevant upstream source areas:

- `origami/folding/FoldedFigure.java`
- `origami/crease_pattern/worker/WireFrame_Worker.java`
- `origami/crease_pattern/worker/FoldedFigure_Configurator.java`
- `origami/crease_pattern/worker/FoldedFigure_Worker.java`
- `oriedita-data/src/main/java/oriedita/editor/folded_figure/FoldedFigure_01.java`
- `oriedita-data/src/main/java/oriedita/editor/databinding/FoldedFigureModel.java`
- `oriedita-ui/src/main/java/oriedita/editor/drawing/FoldedFigure_Drawer.java`
- `oriedita-ui/src/main/java/oriedita/editor/drawing/FoldedFigure_Worker_Drawer.java`
- `oriedita-ui/src/main/java/oriedita/editor/drawing/WireFrame_Worker_Drawer.java`
- `oriedita-ui/src/main/java/oriedita/editor/CanvasUI.java`
- `oriedita-data/src/main/java/oriedita/editor/export/FoldImporter.java`
- `oriedita-data/src/main/java/oriedita/editor/export/FoldExporter.java`
- `oriedita-data/src/main/java/oriedita/editor/export/OriImporter.java`
- `oriedita-data/src/main/java/oriedita/editor/export/OriExporter.java`
- `oriedita-data/src/main/java/oriedita/editor/export/OrhImporter.java`
- `oriedita-data/src/main/java/oriedita/editor/export/OrhExporter.java`

### Document Model

Add a preserving FOLD file model instead of flattening import to one selected
frame.

Current `apps/web/src/lib/creasePatternImport.ts` chooses a single useful frame
and normalizes it to `FoldDocument`. That is fine for today's lightweight import,
but it destroys context needed for arbitrary FOLD round-trip:

- root-level file metadata,
- `file_frames`,
- `frame_parent`,
- `frame_inherit`,
- all non-active frame classes,
- `foldedForm` frames,
- unrecognized frame fields,
- Oriedita custom keys.

Introduce a richer Rust and TypeScript model:

- `FoldFileDocument`: root metadata plus ordered frames.
- `FoldFrameDocument`: one frame, inherited/effective geometry, raw extras, and
  frame relationship metadata.
- `FoldFrameClass`: at least `creasePattern`, `foldedForm`, and unknown class
  preservation.
- `ImportedFoldFrameInventory`: active CP frame, folded-form frames associated
  with it, unsupported/unknown frames, and warnings.

`treemaker-fold::FoldDocument` can remain the single-frame geometry type, but it
should sit inside a multi-frame wrapper. Export should write back untouched
frames when possible, update only the active edited CP frame, and preserve
folded-form frames unless the edit explicitly invalidates them.

For `.ori` and `.orh`, preserve Oriedita's save metadata exactly where currently
ported: line segments, circles, texts, grid, camera, application model, and
`FoldedFigureModel` colors/display preferences. Oriedita's native `.ori`/`.orh`
save model appears to store folded-figure preferences rather than a full list of
solved folded geometries, so do not invent saved geometry fields there.

### Folded Figure Kernel

Extend `oristudio-cp::folding` from parity algorithms into a serializable
folded-figure runtime state.

The crate already ports much of Oriedita's stage-10 folding pipeline:
wireframe folding, subface preparation, hierarchy setup, overlap search,
another-solution enumeration, save-100 loops, two-color estimate support, and
duplicate-estimation order mapping. The missing product-facing object is an
Oriedita folded figure snapshot that can be stored, compared, and rendered.

Add types shaped around Oriedita names rather than generic simulator names:

- `OrieditaFoldedFigure`
- `OrieditaFoldedFigureModel`
- `OrieditaFoldedFigureCameraSet`
- `OrieditaFoldedEstimateState`
- `OrieditaWireframeSnapshot`
- `OrieditaSubfaceSnapshot`
- `OrieditaHierarchySnapshot`
- `OrieditaVisibleFace`
- `OrieditaVisibleEdge`
- `OrieditaFoldedFigureRenderSnapshot`

The snapshot must include:

- estimation order and step,
- display style: none, development, wire, transparent, paper,
- state: front, back, both, transparent,
- starting face id and Oriedita's fallback behavior,
- discovered fold cases,
- find-another-overlap flag,
- text result,
- folded wireframe points/lines/faces,
- subdivided subfaces,
- face-position parity,
- subface face stacks from top to bottom,
- hierarchy relations and custom constraints,
- selected/moved folded points for calculated-shape editing,
- front/back/line colors,
- anti-alias and shadow settings,
- transparent-view color/transparency settings,
- Oriedita camera set: folded, front, rear, transparent front, transparent rear.

Fold commands should mirror Oriedita service intent:

- `Fold`: create or replace folded figure from current CP or selected fold set.
- `FoldAnother`: advance the same worker state to the next solution.
- `FoldToCase`: enumerate to a specific discovered case.
- `FoldSaveBatch`: keep the pure batch semantics already ported, without UI
  image writing in the kernel.
- `DuplicateFoldedModel`: duplicate estimate order/display state.
- `CreateTwoColoredCp`: keep as a folded-estimate command but expose its result
  separately from normal CP editing.
- `SetFoldedFigureState`, `SetFoldedFigureDisplayStyle`, `SetFoldedFigureModel`,
  `SetFoldedFigureStartingFace`, and `MoveFoldedFigureCamera`.

Any Oriedita folded operation not yet ported should return typed unsupported
results. Do not silently fall back to `treemaker-flatfold`.

### Render Primitive Model

Exact rendering should be expressed as data in `oristudio-cp`, not as React
logic that reinterprets folded-state internals. Add a render primitive surface
that can be produced by both the Oriedita oracle and the Rust port:

- `FoldedFigureRenderPrimitive`
- `FoldedFigureRenderPrimitiveKind`
- `FoldedFigureRenderPass`
- `FoldedFigureRenderCamera`
- `FoldedFigureRenderStyle`
- `FoldedFigureRenderSnapshot`

The primitive list should be stable and explicit:

- `fill_polygon`: ordered display-space points, source subface id, visible face
  id, front/back decision, fill color, alpha,
- `stroke_path` or `stroke_segment`: display-space geometry, source line id,
  line color, stroke width, antialias setting,
- `fill_ellipse` and `stroke_ellipse`: crosshair, selected marker, constraint,
  and point-id marker geometry,
- `gradient_fill_polygon`: shadow rectangle/path, gradient endpoints, colors,
  alpha,
- `text`: folded figure index labels or point-id labels when Oriedita display
  settings request them,
- `camera`: named camera state for folded, front, rear, transparent front, and
  transparent rear views.

Primitive ordering is part of the contract. A renderer may choose SVG or Canvas,
but it must draw the primitives in oracle order. React should not recompute
visibility, top faces, shadow target subfaces, mirrored parity, or transparency
density.

Coordinate space should be named per primitive. The oracle should emit the same
display-space coordinates Oriedita passes to Java2D after camera transforms. The
Rust renderer should also keep enough object-space metadata for debugging and
future hit testing, but comparisons should primarily use display-space
primitives because that is the actual Oriedita drawing surface.

### Grid-Area Rendering

Render folded figures inside `CreasePatternPanel`'s existing SVG viewport,
because Oriedita draws them in the same canvas pass as the grid and CP.

Layer order should follow Oriedita's `CanvasUI.paintComponent`:

1. background/grid,
2. self-intersecting subface highlights,
3. starting-face marker,
4. CP lines unless "CP on top" is active,
5. tool previews and diagnostics,
6. folded-figure drawings,
7. CP lines again when "CP on top" is active,
8. interaction overlays.

Create a new renderer component:

- `OrieditaFoldedFigureLayer`
- `OrieditaFoldedFigurePaperView`
- `OrieditaFoldedFigureTransparentView`
- `OrieditaFoldedFigureWireView`
- `OrieditaFoldedFigureCrosshair`
- `OrieditaFoldedFigureConstraintMarkers`

The renderer should use the same coordinate conversion as the CP grid but keep
the folded figure's own Oriedita cameras. Oriedita initializes folded cameras at
offsets `(20, 20)`, `(40, 20)`, `(20, 0)`, and `(40, 0)` relative to the CP
camera, then adjusts them to align folded and flat minimum bounds. Port that
logic directly instead of fitting the folded figure independently.

For the first UI milestone, SVG is acceptable if the snapshot geometry is exact.
The renderer should reproduce Oriedita drawing semantics:

- paper view fills visible subfaces according to top face and face-position
  parity,
- front/back color flips when the camera is mirrored,
- edge drawing only occurs where adjacent visible top faces differ, or where
  holes/boundaries require it,
- optional shadows follow Oriedita's line-to-subface shadow test,
- transparent view supports both grayscale layer-density mode and colored alpha
  mode,
- wire view draws the folded-not-subdivided wireframe,
- custom constraints appear on the correct mirrored side,
- crosshair and selected folded-figure markers match Oriedita selection state.

Pixel-perfect Java2D parity is a later hardening pass. The first acceptance gate
is exact geometry/state parity plus stable visual regression screenshots for the
SVG renderer.

When render primitives land, replace the current generated wireframe mini-view
with an `OrieditaFoldedFigurePrimitiveLayer`. That layer should:

- consume the active folded figure's primitive snapshot from workspace state,
- draw primitive passes in emitted order,
- preserve Oriedita camera offsets instead of independently fitting the figure,
- mark stale generated figures without changing their stored camera or solution
  case,
- render imported `foldedForm` frames separately until they can be converted
  into equivalent primitive snapshots,
- keep pointer interaction routing separate from drawing so later folded-model
  edit tools can reuse the same camera hit testing.

### UX Shape

Keep the existing Folded Base pane, but make the grid-area folded figure the
Oriedita-compatible surface.

Add compact controls in the CP toolbar or contextual panel:

- Fold,
- Next Solution,
- solution case selector,
- display style segmented control,
- front/back/both/transparent state toggle,
- starting face control,
- folded-figure visibility toggle,
- duplicate/delete folded figure,
- shadow and transparent-color toggles.

The first rendering milestone can support one active folded figure. The data
model should allow multiple folded figures because Oriedita maintains a
`FoldedFiguresList`, and duplicate/delete workflows depend on that list.

### Import and Export

For FOLD:

- parse root plus all `file_frames`,
- preserve inherited frames,
- identify crease-pattern frames separately from folded-form frames,
- preserve folded-form frames even if not editable,
- expose active CP frame selection,
- render imported `foldedForm` frames directly when present,
- export all preserved frames, with active edited CP updates applied,
- generate a new `foldedForm` frame only when the user explicitly exports a
  solved Oriedita folded figure as FOLD.

For Oriedita `.fold` custom fields:

- keep `oriedita:edges_colors`,
- keep circle/text/grid fields,
- keep unknown `oriedita:*` fields,
- keep unknown non-Oriedita fields.

For `.ori`:

- continue using the Oriedita save model, but extend it to cover
  `FoldedFigureModel` fields not yet represented in the Ori Studio project
  model.
- Do not claim full folded-geometry persistence unless Oriedita actually stores
  that data in the baseline save format.

For `.orh`:

- preserve the legacy `<oriagarizu>` color fields and any currently parsed
  folded display preferences.
- Keep existing legacy quirks documented in `implementation-plans/oriedita-port.md`.

For native `.osf`:

- store active CP document,
- store preserved original FOLD file graph if imported from FOLD,
- store folded-figure list and snapshots,
- store invalidation state linking folded figures to the CP revision that
  produced them.

### Invalidation

Folded figures derived from the editable CP become stale after CP geometry or
assignment edits. They should not be silently recomputed unless the user asks
for Fold/Refold, because exact Oriedita parity includes the user's chosen
solution case and folded-figure camera placement.

Use revision tracking:

- `cpRevision`
- `foldedFigure.sourceCpRevision`
- `foldedFigure.status`: ready, stale, loading, error, unsupported
- `foldedFigure.sourceKind`: generated-from-current-cp, imported-folded-form,
  imported-preserved-frame

Imported folded-form frames should remain visible/preserved even when the active
CP is edited, but the UI should mark them as detached from the current CP if
their parent frame no longer matches.

### Oracle Strategy

Extend `tools/oriedita-oracle` instead of creating a second oracle.

Add oracle commands for:

- full folded-figure snapshot after `Fold`,
- repeated `FoldAnother` sequence snapshots,
- display-state/camera snapshot,
- paper-view render primitive list,
- transparent-view render primitive list,
- wire-view render primitive list,
- FOLD multi-frame import summary,
- FOLD multi-frame export round-trip summary,
- `.ori` folded model metadata summary,
- `.orh` folded model metadata summary.

The render primitive commands should run Oriedita's real drawer path rather than
copying drawer logic inside the oracle harness. Implement a small
`RecordingGraphics2D`/recording Java2D adapter that captures the subset used by
the drawer classes:

- `setColor`, `setPaint`, `setStroke`, `setRenderingHint`, and `setFont`,
- `drawLine`,
- `draw(Path2D)`,
- `fill(Path2D)`,
- `fillOval` / `drawOval` / `fill(Ellipse2D)`,
- `drawString`,
- `GradientPaint` endpoints and colors.

The oracle should instantiate the real folded-figure objects, apply the same
model/camera/display settings as Oriedita, call `foldUp_draw`, and emit the
recorded primitives in a deterministic text or JSONL form. This avoids creating
a second hand-written Java implementation that could drift from Oriedita.

Add explicit commands for scoped render fixtures:

- `folded-render-paper-front <fixture>`,
- `folded-render-paper-back <fixture>`,
- `folded-render-paper-both <fixture>`,
- `folded-render-paper-transparent-state <fixture>`,
- `folded-render-transparent-grayscale <fixture>`,
- `folded-render-transparent-color <fixture>`,
- `folded-render-wire <fixture>`,
- `folded-render-shadow <fixture>`,
- `folded-render-constraints <fixture>`,
- `folded-render-cameras <fixture>`.

Prefer structured primitive comparisons over raw pixels for kernel parity:

- points, lines, faces, subfaces,
- face stacks in top-to-bottom order,
- visible fill polygons with front/back color decision,
- visible boundary/crease lines,
- shadow rectangles and gradient endpoints,
- transparent density/color decisions,
- custom constraint marker positions,
- camera transforms.

Add screenshot or PNG pixel regression only after render primitives match. Pixel
tests should be tolerant only for antialiasing/rasterization, not geometry or
ordering.

Normal tests should not require Java:

- Rust unit tests: `cargo test -p oristudio-cp --test folding`
- WASM tests: `wasm-pack test --node crates/oristudio-cp-wasm`
- Oracle tests when enabled:
  `ORIEDITA_GEOMETRY_ORACLE=tools/oriedita-oracle/build/oriedita-geometry-oracle cargo test -p oristudio-cp --test oriedita_folding_oracle`
- Web tests: `npm run test:web -- CreasePatternPanel`

Oracle-enabled render tests should live next to the existing folding oracle
coverage and should skip cleanly when `ORIEDITA_GEOMETRY_ORACLE` or a future
`ORIEDITA_RENDER_ORACLE` is unset:

- `cargo test -p oristudio-cp --test oriedita_folding_oracle`
- `cargo test -p oristudio-cp --test oriedita_render_oracle`

### Exact Renderer Checkpoints

Use these checkpoints for the remaining exact-parity work. Commit after each
checkpoint and keep the checklist current.

1. Oracle recorder and schema.
   Add recording Java2D support, primitive DTOs, command-line fixture routing,
   README documentation, and one simple paper-front fixture. Acceptance: the
   oracle builds, emits deterministic primitive output, and existing oracle
   tests still pass.

2. Rust primitive types and canonical comparison.
   Add serializable primitive types in `oristudio-cp`, canonicalization helpers,
   and failing oracle tests for paper-front output. Acceptance: tests compare
   the same schema and fail only on unported primitive generation, not parser or
   fixture plumbing.

3. Paper-view primitive generation.
   Port visible subface fill order, front/back color choice, mirrored camera
   parity, edge visibility, and optional shadow target selection from
   `FoldedFigure_Worker_Drawer`. Acceptance: paper front/back/both fixtures
   match oracle primitives without UI changes.

4. Transparent and wire primitives.
   Port grayscale density, colored alpha transparency, transparent-front/rear
   cameras, and folded-not-subdivided wire drawing. Acceptance: transparent and
   wire fixtures match oracle primitives.

5. Markers, constraints, and camera state.
   Port crosshair, selection marker, custom constraint markers, display-number
   labels, selected point markers, and all folded camera initialization/update
   rules. Acceptance: marker/constraint/camera fixtures match oracle output.

6. WASM and workspace integration.
   Expose primitive render snapshots through `oristudio-cp-wasm`, worker
   methods, TypeScript types, and workspace folded-figure state. Acceptance:
   Node WASM tests and web store tests verify primitive snapshot creation,
   stale preservation, and handle cleanup.

7. Grid primitive renderer.
   Replace the temporary generated wireframe overlay with primitive-driven SVG
   drawing in `CreasePatternPanel`. Acceptance: web tests confirm paper,
   transparent, wire, stale, and imported-frame coexistence cases.

8. Complete folded controls.
   Add display style, front/back/both/transparent state, starting face, solution
   case selector, shadow toggle, transparent color/alpha controls, duplicate,
   delete, and active folded figure selection. Acceptance: controls dispatch
   Oriedita-shaped commands and unsupported actions surface typed status.

9. Persistence and import/export hardening.
   Persist folded figure models, cameras, display states, generated snapshots,
   invalidation metadata, and preserved source FOLD frame graphs in `.osf`.
   Extend `.ori`/`.orh` metadata parity only for fields Oriedita actually
   stores. Acceptance: save/load tests round-trip folded state without
   inventing unsupported geometry persistence.

10. Screenshot and corpus validation.
    Add Playwright screenshots for representative display modes, then run the
    external corpus harness for folded-document cases. Acceptance: screenshot
    diffs are stable, corpus results are documented, and unsupported cases are
    reported before claiming arbitrary Oriedita document compatibility.

### Risk Register

- `RecordingGraphics2D` is mechanical but broad. Keep its first version limited
  to methods exercised by folded drawing, and fail loudly when an unrecorded
  method is called.
- Camera parity is subtle because Oriedita aligns folded and flat minimum bounds
  using parent camera transforms and screen-space offsets. Treat camera
  primitive tests as a prerequisite for UI placement changes.
- Shadow parity depends on subface adjacency, top visible faces, hierarchy
  relations, and mirrored camera state. Do not port shadows directly in the UI.
- Imported FOLD `foldedForm` frames may not contain enough Oriedita-specific
  state to reproduce paper/transparent views. Preserve and render them as
  imported detached geometry unless they can be mapped to a full render
  snapshot.
- Pixel tests are useful only after primitive parity. A pixel-only acceptance
  gate would hide ordering or geometry mismatches behind raster tolerance.

## Affected Areas

- `crates/treemaker-fold`: multi-frame FOLD file wrapper and preserving
  serialization.
- `crates/oristudio-cp`: folded-figure snapshot/runtime APIs, command surface,
  render primitive generation, import/export preservation hooks, oracle
  canonicalization.
- `crates/oristudio-cp-wasm`: exported folded-figure commands and snapshots.
- `tools/oriedita-oracle`: folded snapshot, render primitive, and multi-frame
  import/export oracle commands, including the recording Java2D adapter.
- `apps/web/src/engine`: TypeScript folded-figure and multi-frame FOLD types.
- `apps/web/src/store/workspaceStore`: folded-figure list, revision/invalidation,
  OSF persistence, command dispatch.
- `apps/web/src/lib/creasePatternImport.ts`: replace single-frame flattening
  with preserving multi-frame import.
- `apps/web/src/components/panels/CreasePatternPanel.tsx`: folded-figure layer,
  controls, and interaction routing.
- `apps/web/src/styles/theme.css`: SVG styles for folded paper, wire,
  transparent, shadow, markers, and stale state.
- `apps/web/src/lib/nativeProjectFile.ts`: native project persistence for
  preserved FOLD graphs and folded figures.
- `apps/web/src/platform/fileService.ts` and Tauri open/save routing if `.ori`
  support is promoted to first-class UI.

## Checklist

- [x] Reconcile and record the exact Oriedita source baseline.
- [x] Extend the original Oriedita source map and parity matrix for folded-grid
      rendering instead of starting an untracked feature inventory.
- [x] Add explicit unsupported/status entries for each folded-figure command,
      display mode, save/import path, and render primitive.
- [x] Source-map remaining folded-figure drawing, camera, and save-model fields.
- [x] Add preserving multi-frame FOLD model in Rust.
- [x] Add preserving multi-frame FOLD import/export tests, including
      `foldedForm` frames.
- [x] Replace web FOLD import flattening with frame inventory plus active-frame
      selection.
- [x] Extend `.osf` to preserve imported FOLD frame graphs.
- [x] Add serializable Oriedita folded-figure snapshot types in `oristudio-cp`.
- [x] Expose Fold/FoldAnother/FoldToCase folded-figure commands from
      `oristudio-cp-wasm`.
- [x] Add folded-figure list/revision state to the workspace store.
- [x] Render one active folded figure in the CP grid area.
- [ ] Add display style, front/back state, starting face, and next-solution UI.
- [ ] Add multi-figure duplicate/delete support.
- [x] Preserve imported folded-form frames and render them as detached imported
      folded figures.
- [ ] Add Oriedita oracle commands for folded snapshot parity.
- [ ] Add Oriedita oracle commands for render primitive parity.
- [x] Add focused web tests for rendering, stale state, and controls.
- [x] Implement Oriedita recording Java2D adapter in `tools/oriedita-oracle`.
- [x] Define stable folded render primitive schema in Rust.
- [x] Add paper-front render oracle fixture.
- [x] Add paper-front render oracle smoke test.
- [x] Add paper-front render oracle comparison test.
- [x] Port paper-view subface fill, front/back parity, edge visibility, and
      shadow primitive generation.
- [x] Add paper back/both render oracle fixtures.
- [x] Add paper shadow render oracle fixtures.
- [x] Resolve kabuto paper face-side parity before enabling exact Rust shadow
      primitive comparison.
- [ ] Port transparent grayscale, transparent color, and wire-view primitive
      generation.
- [ ] Add transparent and wire oracle fixtures.
- [ ] Port folded camera initialization, minimum-bound alignment, and camera
      mutation snapshot parity.
- [ ] Port crosshair, selected marker, display number, selected point, and
      custom constraint primitives.
- [ ] Expose primitive render snapshots through WASM, worker APIs, and
      TypeScript types.
- [ ] Replace generated folded wireframe mini-view with primitive-driven grid
      renderer.
- [ ] Add display style, front/back state, starting face, case selector, shadow,
      transparency, duplicate, delete, and active folded-figure UI.
- [ ] Persist folded figure cameras, model state, primitive snapshots, and
      invalidation metadata in `.osf`.
- [ ] Add Playwright screenshot coverage for the grid-area folded figure.
- [ ] Run folded-document corpus validation and document unsupported cases.
- [ ] Run Rust, WASM, oracle, and web validation appropriate to each stage.
