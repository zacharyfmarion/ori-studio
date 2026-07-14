# WebGL Canvas Workspace Migration

## Goal

Make the crease-pattern edit surface feel instant — no perceived latency — even
with dense crease patterns and, ultimately, a Figma-class workspace holding on
the order of **100 crease patterns plus 100 folded figures** on one infinite
surface. Concretely:

1. Replace the paint-bound **SVG** editable canvas with a single **WebGL2**
   canvas driven by a small owned 2D camera, with a thin **DOM overlay** for
   low-count interactive chrome and text.
2. Preserve every current render layer and interaction at full parity.
3. Use the migration as the forcing function to **decompose** the ~7,000-line
   `CreasePatternPanel.tsx` into cohesive, framework-agnostic modules — without
   over-abstracting.

The endpoint is one unified renderer where a single editable CP is just the
one-frame case of the multi-CP workspace.

## Why (grounded diagnosis)

The editable canvas is SVG under `react-zoom-pan-pinch`. Each crease renders a
`<g>` wrapping **two** `<line>` elements (invisible fat hit-target + visible
stroke) — see [`CreaseLines`](../apps/web/src/components/panels/CreasePatternPanel.tsx:4675).
A dense box-pleating CP with ~4k segments is ~12k crease nodes alone, before
points, circles, grid, diagnostics, and folded figures. Prior profiling
concluded the jank is **paint/compositing-bound, not JS** — the SVG-tier
mitigations (grid `will-change` layer, grid-freeze-during-pan) are already
applied and exhausted. SVG couples element count to paint cost; that coupling is
the ceiling. Canvas breaks it: one composited surface regardless of primitive
count, plus viewport culling so a dense CP costs the same as a sparse one.

Canvas-2D is **not** the endpoint: a single 2D context re-stroking hundreds of
thousands of line paths per frame is CPU-bound with no instancing and will choke
on 100 dense CPs. The target requires a **GPU** geometry layer.

### What the folded figure actually is

The Fold button runs the WASM fold engine and stores an
`OristudioCpFoldedFigureEntry` carrying a **`renderSnapshot`** — an ordered list
(`sequence`) of 2D vector primitives (`fill_polygon` / `stroke_polygon` /
`fill_path` / `stroke_segment` / etc.) with paint (solid color, gradient) and
stroke styles. Rendered today as one SVG node per primitive in
[`GeneratedFoldedFigurePrimitiveLayer`](../apps/web/src/components/panels/CreasePatternPanel.tsx:5438).
It is a **flattened 2D vector drawing** of the folded paper (overlapping facets
painted back-to-front, front/back fill colors, edge strokes, optional gradients
and xray transparency) living in the **same 2D world plane** as the CP. It is
*not* a 3D mesh and needs no depth buffer.

There is **no folded-figure text** in practice: `display_numbers` is only a type
field and is never enabled, so the engine emits no `text` primitives. The only
text in the workspace is **user-placed CP annotations** (`crease_pattern.texts`,
[`CreaseTexts`](../apps/web/src/components/panels/CreasePatternPanel.tsx:4855)) —
low-count, and handled by the DOM overlay. No GPU text atlas is needed.

Because both the CP and the folded figure are 2D vector in one plane, **one
renderer with two primitive types (strokes + fills) covers everything.**

### Workspace model (Oriedita-parity)

The workspace is **one Oriedita-style infinite canvas**, not a container of many
documents. There is a single crease-pattern geometry set (lines / points /
circles) drawn freely on an unbounded plane; a "crease pattern" is a **closed-
shape segment** derived from that geometry by the existing segmentation
([`creasePatternSegmentation.ts`](../apps/web/src/lib/creasePatternSegmentation.ts)),
not a separate document. Folded figures and imported folded forms are additional
**placed objects** on the same canvas (each carrying a `displayOffset`).

Consequences:

- The single-CP editor and the "100-CP workspace" are the *same surface* — the
  latter is just more geometry plus more placed folded objects. There is **no
  multi-document / frame-container layout system** to build.
- Segmentation is a **logical partition** used for fold / simulate / select
  operations, **not** a rendering or data container. Rendering sees one geometry
  buffer, not 100 sub-scenes.
- "100 CPs × ~5k segments" is really **one geometry set of ~500k segments** plus
  ~100 placed folded objects. The spike and culling are framed accordingly.
- **Where Oriedita's behavior is the reference, match it.** In any ambiguity
  about interaction or appearance, Oriedita is the source of truth (the
  `third_party/oriedita` tree is available for reference).

## Current-state census

| File | Lines |
| --- | --- |
| `apps/web/src/components/panels/CreasePatternPanel.tsx` | ~7,002 |
| `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` | ~1,115 |
| `apps/web/src/lib/creasePatternViewport.ts` | ~968 |
| `apps/web/src/lib/oristudioCpCommands.ts` | ~836 |
| `apps/web/src/engine/oristudioCpTypes.ts` | ~407 |

## Complete inventory: everything that appears in the canvas → target mapping

This table is also the **per-phase parity checklist**. "Program" = GPU;
"Overlay" = DOM.

| Layer (current SVG) | Source component | Target | Notes |
| --- | --- | --- | --- |
| Infinite grid | `OrieditaInfiniteGrid` (:4531) | Program (fills/strokes) or grid shader | Redraw on pan/zoom; own its layer |
| Crease lines (hit + visible + selected) | `CreaseLines` (:4675) | Stroke program | Selection = per-instance color/width attr; hit via spatial index |
| Selection-transform live preview | inline (:5008) | Stroke program | Per-frame during transform drag |
| Points | `CreasePoints` (:4746) | Point/quad program | Hit via index |
| Circles (geometry) | `CreaseCircles` (:4792) | Stroke program (tessellated) | Radius maps model→screen |
| Command-preview circles | inline (:5040) | Stroke program | Live tool preview |
| Command-preview boxes | `SelectionBoxPreview` (:6063) | Stroke program | Marquee/box preview |
| Diagnostics segments (CAMV) | inline (:5060) | Stroke program | Hit via index/overlay |
| Diagnostics point markers | `DiagnosticPointMarker` (:5191) | Overlay (initially) | Composite shapes, bounded count |
| CP text annotations | `CreaseTexts` (:4855) | Overlay | Low count, world-positioned |
| Generated folded figures | `GeneratedFoldedFigure*` (:5359/:5438) | Fill + stroke programs | Ordered by `sequence`; alpha blend; bezier flatten; gradient |
| Imported folded forms | `ImportedFoldedFormsLayer` (:5693) | Fill + stroke programs | Same as above |
| Vertices | `CreaseVertices` | Point program | Hit via index |
| Operation frame | inline (:5121) | Stroke program | Single polygon |
| Command-preview segments/polyline/candidate points | inline (:5130–5167) | Stroke/point programs | Live drawing feedback |
| Selection transform box (move/resize/rotate handles) | `SelectionTransformBox` (:5878) | **Overlay** | Screen-space UI, needs pointer events, constant handle size |
| Snap-target indicator | inline (:5179) | Overlay or program | Single element |

### Interaction inventory (must be preserved)

From the panel's handlers:

- **Tool dispatch / draw start** — `handleEditableToolPointerDown` (:2745)
- **Live drawing preview on move** — `handleEditablePointerMove` (:3095),
  `localDragLinePreviewSegments`, `liveCommandPreviewPoints` (the "line that
  updates in real time as you draw")
- **Commit / cancel drag path** — `finishEditableDragPath` (:3202),
  `cancelEditableDragPath` (:3436)
- **Click-select per type** — line/vertex/point/circle/text (:3480–3784),
  additive with shift/meta; currently DOM delegation via
  `closest('[data-cp-*-id]')` → must become spatial-index hit-testing
- **Marquee / background clear** — `clearSelectionOnBackgroundPointerDown` (:3784)
- **Selection transform** — move/resize/rotate pointer-down + `onSelectionTransform`
  (:2494–2615)
- **Folded-figure drag** — `handleFoldedFigurePointerDown` (:2615)
- **Pan** — space-drag (currently `react-zoom-pan-pinch`)

## Target architecture

- **One WebGL2 context**, one owned **2D world camera** (pan / zoom-to-cursor),
  per-frame **culling** by frame/primitive bounds.
- **Two core GPU programs**:
  - **Stroke program** — instanced/expanded line geometry (crease lines, facet
    edges, previews, grid, diagnostics). Width/caps in shader; per-instance color.
  - **Fill program** — triangulated polygons (folded facets), per-vertex color,
    gradient via vertex interpolation. **No depth buffer**: folded figures draw
    in `sequence` order with **alpha blending** (xray/transparency).
- **DOM overlay (React)** for low-count, pointer-interactive, or text chrome:
  selection transform box, CP text annotations, diagnostics markers, snap
  indicator, HUD/toolbars. Positioned by the same camera matrix.
- **`CpRenderer` seam** — a framework-agnostic interface (`resize`, `setScene`,
  `setCamera`, `draw`, `hitTest`) with a **regl** backend. The seam keeps regl
  swappable (drop to raw WebGL per-program if ever needed). The single-CP editor
  and the full workspace are the *same surface* (one geometry buffer + placed
  folded objects), so no separate multi-document composition exists.
- **Scene shape** — the scene is **one master geometry set** (strokes / points /
  circles for the whole canvas) plus a **collection of placed folded objects**
  (folded figures, imported forms). Culling reuses the hit-testing spatial index
  for the master geometry, with per-object bbox culling for folded objects.
  Segmentation is a logical partition layered on top for fold/select — not a
  render container.
- **Renderer base decision: regl, spike-validated.** The workload is homogeneous
  (strokes + fills), so a scene-graph framework (PixiJS) adds bundle weight
  (~400KB vs ~30KB — relevant to web load) and an abstraction that fights
  instanced line rendering. regl abstracts WebGL *boilerplate*, not our *domain*,
  so there's near-zero "the library won't let me" risk.

### Camera & coordinates

Replace the `modelToSvg` + `react-zoom-pan-pinch` CSS-transform pair with a
single owned camera producing a `world → clip` matrix for the GPU and an
inverse `screen → world` for pointer mapping. The DOM overlay container is
transformed by the same camera each frame (in one rAF) so overlay and scene
never desync. Interactive handles use screen-space sizing (constant on zoom) via
the existing `uiScale` concept. `react-zoom-pan-pinch` is retired from the
editable path (kept only if the generated/read-only view still needs it).

### Hit-testing

Replace DOM event delegation with:

1. **Spatial index** (uniform grid keyed by model coords) over lines, points,
   circles, vertices, rebuilt (memoized) on document change. Pointer → world →
   candidate cells → precise distance test, honoring the current fat hit-target
   tolerance. Primary path; no GPU readback stall.
2. **GPU id-buffer picking** (render ids-as-color to an offscreen FBO, read the
   pixel under the cursor) as a fallback for pixel-ambiguous dense overlap.
3. **Folded figures** — bounding-box hit (matches today's hit-target rect).

## Decomposition (engineering organization)

Principles, tuned to "reasonably lengthened components, not over-abstracted":

- **Cohesion by feature, not by type.** A controller that owns one feature's
  full control flow at ~400–600 lines is good; a constellation of 50-line files
  is not. Do not introduce a generic abstraction until there is a second real
  consumer. No god `utils`.
- **Framework-agnostic core.** The renderer, geometry, camera, and picking are
  pure TS with no React and no direct DOM — unit-testable by asserting on
  buffers/matrices/hit results (mock GL calls).
- **Decompose only what you touch, per phase.** Do not pre-refactor the whole
  7,000-line panel up front; carve each module out as its phase extracts it.

Proposed layout:

```
apps/web/src/cp-workspace/
  renderer/                    (framework-agnostic, no React)
    CpRenderer.ts              interface + scene/camera types (the seam)
    reglRenderer.ts            regl backend
    camera.ts                  2D world camera: pan/zoom, matrices, inverse
    scene.ts                   Scene model (master geometry + placed objects) + culling
    programs/
      strokeProgram.ts         instanced stroke shader + draw
      fillProgram.ts           triangulated fill shader + draw
    geometry/
      strokeGeometry.ts        lines/edges/previews → stroke buffers
      fillGeometry.ts          folded facets → triangulated fills (earcut,
                               bezier flatten, gradient params)
    picking/
      spatialIndex.ts          uniform grid over primitives
      hitTest.ts               pointer → world → id, tolerance-aware
  adapters/                    store snapshot → renderer scene (pure fns)
    cpSnapshotToScene.ts
    foldedSnapshotToScene.ts
  interaction/                 pointer gesture controllers (hooks)
    useCamera.ts               pan/zoom gestures
    useCpSelection.ts          click + marquee select
    useCpDrawTool.ts           draw-path + live preview
    useCpSelectionTransform.ts move/resize/rotate
    useFoldedFigureDrag.ts
  overlay/                     DOM overlay React components (chrome)
    SelectionTransformBox.tsx
    CpTextAnnotations.tsx
    DiagnosticMarkers.tsx
    SnapIndicator.tsx
    ViewportHud.tsx
  CreasePatternCanvas.tsx      thin shell: canvas + overlay + camera + interaction
  CreasePatternPanel.tsx       slimmed: toolbars, menus, store wiring
```

Style constants currently living in CSS (MV colors, line widths, selection
styling, folded front/back tints) get extracted into a shared theme object the
renderer reads, so SVG and WebGL share one source of truth during the parity
period.

## Migration structure (incremental, flag-gated, parity-first)

> **Order update (2026-07-14):** Phases 0–6 are complete and WebGL parity is high,
> so **Phase 8 (delete the SVG surface) now runs before Phase 7 (full-canvas
> scale)**. Deleting SVG first removes the dual-render cost and the flag branching,
> and makes the culling work in Phase 7 far easier to reason about against a single
> renderer. The phase numbers below are kept for reference; the execution order is
> now 6 → 8 → 7 → 9.

Constraints: no integration tests, **no users**, bugs fixed together before
committing to launch. Therefore build the WebGL renderer **alongside** SVG behind
a runtime flag (`cpRenderer: 'svg' | 'webgl'`), reach parity **layer by layer**,
and keep SVG as an instant fallback until the very end. Every step is
independently A/B-verifiable on the same document.

**Verification is owned by the author (Zach), not automated or self-certified.**
Each phase ends at a gate; the author does the hands-on testing against that
phase's parity checklist and the perf budget, and **explicitly signs off before
the next phase begins**. Claude's job at each gate is to make the phase testable
(flag toggle, representative docs, a clear checklist of what changed) and to fix
bugs the author surfaces — not to declare a phase "done." No phase proceeds on an
unverified gate.

- **Phase 0 — Spike (throwaway).** regl prototype: **one geometry set of ~500k
  segments** (the whole-canvas soup) **plus ~100 placed folded objects**
  (triangulated fills + strokes, alpha-blended in `sequence` order), one 2D
  camera, spatial-bin culling. Measure pan/zoom FPS and hover latency at DPR 2.
  **Go/no-go gate** on the perf budget (below). Throwaway code; validates the
  architecture before any real build.

- **Phase 1 — Renderer core + static parity.** Build `CpRenderer` + regl
  backend, camera, stroke + fill programs, `adapters/`, culling. Render **one
  editable CP read-only** into the WebGL canvas behind the flag, toggleable
  against SVG. No interaction. Manually verify visual parity across
  representative docs: MV colors, line widths, points, circles, grid, and folded
  figures (fills + strokes + `sequence` order + gradients + xray). De-risks the
  entire rendering half before touching interaction.

- **Phase 2 — Camera + pan/zoom.** Owned 2D camera replaces RZPP on the WebGL
  canvas; pan, zoom-to-cursor; DOM overlay synced to the camera each rAF. Verify
  smooth pan/zoom on a dense doc; capture the perf delta vs SVG.

  > **Parity-period cost (confirmed step 2):** while both renderers coexist, the
  > SVG is still in the DOM under the WebGL canvas, so the browser keeps painting
  > it (and RZPP repaints it on pan), and the step-1/2 camera bridge forces an
  > `svg.getBoundingClientRect()` layout each frame. So WebGL mode is currently
  > *slower* than SVG-only on dense docs — it pays both costs. This is expected
  > and is eliminated here in Phase 2 (own the camera, stop depending on / painting
  > the live SVG). Cheap stopgap if a real perf demo is needed sooner: stop the
  > SVG geometry from painting while WebGL is active (`content-visibility` / hide
  > crease layers), keeping just enough of the element for the bridge.

- **Phase 3 — Hit-testing + selection.** Spatial index + pointer→world; port
  click-select (line/point/circle/vertex/text), additive select, marquee, and
  background-clear. Selection highlight via GPU instance attribute. Verify
  against SVG selection behavior, including dense/close-pair picking.

- **Phase 4 — Selection drag (move).** Move a selected line-set by dragging,
  with live GPU preview and snapping; folded-figure drag. **Resize + rotate
  handles are punted to the end** (Phase 9) — they are polish, not on the
  critical path, so the migration proceeds to draw tools / scale first.
  - **Landed (Phase 4 core done):** folded-figure cmd-drag move; selection move-drag
    (drag a selected line to translate the whole line-selection, real strokes
    shifted in place via `CpRenderer.setStrokes` + `cpSnapshotToScene(move)`,
    derived vertices following via `setPoints`, committed with
    `transformOristudioCpSelection`); move-drag **snapping** to
    grid/vertices/lines (panel's `resolveEditableMoveSnap` reusing
    `nearestCpSnapTarget`, tolerance from the WebGL camera).
  - **Representation note:** lines, circles, and standalone points are *real*
    stored geometry; **vertices are derived** (line endpoints, `getCpVertices`).
    So vertices are not selectable, and a move translates real geometry with the
    derived vertices following. (They only share a renderer path — `cpPointsToScene`
    discs — which is what made them look interchangeable.)
  - **Deferred / TODO in this phase:**
    - **Move only translates lines for now.** The kernel's selection move is
      line-only (`move_selected_lines` = Oriedita `CREASE_MOVE_21`); there is no
      exposed op to translate selected circles/points (`translate_model` is
      whole-model only). Moving circles+points with the selection needs new
      kernel ops → wasm export → store action. Deferred. Until then the move-drag
      grabs only on a selected **line**; derived vertices follow.
    - **Snap target indicator** not yet drawn on the WebGL surface. The delta
      snaps correctly, but SVG also shows the snapped target/label
      (`setSnapTarget` + HUD); port that visual feedback.
    - SVG-mode + store still carry vertex selection (`selection.vertices`,
      `toggleOristudioCpVertexSelection`); remove app-wide once the SVG path is
      retired.

- **Phase 5 — Draw tools + live previews (WebGL-native, layered).** The real-time
  "line updates as you draw" surface. Committed to WebGL: the SVG interaction path
  is treated as a **read-only spec** to port from and deleted per-tool as it
  migrates (kept in-tree until then; never rewired). Commands are already
  declarative (`OristudioCpCommandDefinition`: `operationId` + `toolSteps` +
  `inputMode` ∈ {point-sequence, drag-path, drag-line, drag-box}); geometry lives
  in the kernel (`executeOristudioCpCommand` / `previewOristudioCpCommand`), so the
  frontend "tool logic" is mostly **input collection**. Architecture — four layers,
  each testable in isolation:
  - **L1 Tool engines (pure, unit-tested)** in `cp-workspace/tools/`: reducers
    `(state, input) => { state, preview?, commit? }` keyed by `inputMode`, where
    `input = { kind: down|move|up|cancel, point: ModelPoint, hit, modifiers }`.
    No DOM/React/GPU → tested by feeding input sequences and asserting the emitted
    payload + preview. Special ops (variable-length sequences, tangent-point, text,
    circle-from-selection) are explicit tested overrides, not engine branches. This
    is where "each tool independently unit-tested" lives.
  - **L2 Controller (thin):** runs the active engine over the pointer stream
    (engine state in a ref), exposes preview geometry, routes commits.
  - **L3 Surface adapter (`CreasePatternWebglCanvas`):** native pointer events →
    `ToolInput` (client→model via the owned camera; `hit` via the spatial index;
    draw-point snapping via a panel-provided resolver); renders preview through a
    re-introduced additive GPU preview channel (`CpRenderer.setPreview`); calls
    `onToolCommit` on commit. **Zero tool logic.**
  - **L4 Store/kernel commands (unchanged):** payload enrichment (colours/options)
    + `executeOristudioCpCommand`. Geometry stays in Rust.
  - Separation: geometry = kernel · input-collection = pure engines · glue = L2 ·
    I/O + rendering = adapter. **Risks:** losing the SVG spec (port deliberately,
    capture behaviour in tests, delete SVG per-tool only after migration);
    special-case sprawl (cover the 4 inputModes first, specials as discrete
    overrides); preview source-of-truth split (prefer kernel preview). Verify each
    tool. **First vertical slice: the `drag-line` crease tool** end-to-end (types +
    engine + unit tests + controller + WebGL adapter + preview channel + commit).
  - **Landed (Phase 5 essentially complete):** the full tool sweep is tracked
    per-tool with Zach's verbatim asks in
    [webgl-cp-tool-input-spec.md](webgl-cp-tool-input-spec.md). All in-scope draw /
    construction / measure / transform tools are built + validated (Line, grid-
    restricted, perpendicular, parallel, angle-restricted/converging, mirror
    (dual-mode), square/angle bisector, divided lines, voronoi, measure length/angle,
    Extend Line drag-to-select, …); out-of-Oriedita-UI tools are hidden per Zach.
    **Deferred to the end** (Zach's "revisit at end" pile): Text annotation (DOM
    overlay), Reflect Over Line (needs a fresh divergence diagnosis), Square Bisector
    mode C (parallel), Circle tangent-line fix + the rest of Circle-apply.

- **Phase 6 — Diagnostics, snap, operation frame, imported forms.** CAMV
  segment lines on GPU; markers via overlay (revisit if counts get high); snap
  target; operation frame; imported folded forms. Verify.
  - **Landed (most of Phase 6, 2026-07-14):**
    - **Diagnostics overlay (WebGL-native).** The panel builds GPU geometry from the
      live CAMV result + any check/fix `diagnostic_entries` — shape markers
      (`markerProgram`: disc/ring/triangle/square/pentagon/cross SDFs), segment
      highlights (stroke channel), and **little-big-little sector wedges** (a
      dedicated `wedgeProgram`: instanced filled triangles + a hairline outline pass,
      fanning from the vertex along consecutive crease rays). All diagnostic markers
      **scale with zoom** via `markerScalePx` — a deliberate divergence from
      Oriedita's screen-constant markers (Zach's call), applied consistently across
      markers and wedges. Tone colours read the theme's CSS vars.
    - **Check / fix tools unblocked.** `Check1–4` / `CheckCamv` render through the
      overlay and auto-frame the selected issue; `Fix*` mutate through the kernel.
    - **Click-a-marker-to-select.** In select mode, pressing a diagnostic marker
      selects that diagnostic (frames + highlights it), via `{id, model point}`
      anchors hit-tested on the canvas.
    - **Diagnostic focus framing.** Selecting a diagnostic pans/zooms the owned camera
      to the issue (capped), replacing the SVG-era focus.
    - **Operation frame.** Overlay render (dashed screen-constant loop) + a `drag-box`
      create interaction — then **hidden** in the UI (export is different here). Move/
      resize of an existing frame not ported.
    - **Imported folded forms.** The folded-state frames embedded in an imported
      `.fold` (`sourceFold.file_frames`) now render on the WebGL surface — faces →
      fills, edges → strokes in user coords, drawn through `userView` with the folded
      figures (adapter `foldedGeometryFromShapes` + a `setImportedForms` channel).
  - **Deferred (Zach):**
    - The **snap-target indicator**. A drag-line snap ring already draws; generalising
      it across tools + porting the SVG's snapped-target/label HUD is end-of-migration
      polish.
    - **Draggable imported forms.** Imported forms render but stay static reference
      figures (parity with the SVG, where they are `pointer-events: none`). Promoting
      them to move/select like generated figures — a scoped feature needing a new
      per-form offset state slot — is punted (Zach: "good enough as is"). Unlike
      generated figures they are foreign file snapshots with no engine/CP behind them,
      so fold-another / restyle / front-back / restale don't apply.
  - **Phase 6 is otherwise complete.**

- **Phase 7 — Full-canvas scale (runs after Phase 8).** Scale the single editable
  surface to the whole-canvas geometry set plus many placed folded objects (no new
  container model — it's the same scene, larger). The work is **culling**, not
  generation:
  - **Viewport culling of the master geometry** — a dense box-pleated CP has
    thousands of segments/points, all uploaded + drawn every frame today. Draw only
    what intersects the visible bounds, reusing the hit-test spatial index.
  - **Per-object culling for placed folded figures** — skip folded objects outside
    the viewport.
  - **(Secondary) folded-scene rebuild cost** — `cpFoldedToScene` re-triangulates
    *all* folded figures (earcut) whenever the array changes; with many figures,
    only re-triangulate what changed. On-change only, not per frame.
  - Verify the ~500k-segment / ~100-folded-object target meets budget.
  - **Dropped: "lazy + cached folded generation."** Investigated 2026-07-14 — folded
    figures are point-in-time, user-triggered: Fold runs the WASM solve + render
    snapshot **once** and caches both on the store entry; editing creases only marks
    the figure `stale` (dimmed), never auto-refolds (you must explicitly refold). So
    generation is never a per-frame or scaling cost, and the caching already exists.
    "Lazy generation" would only matter for a future workspace that *auto-folds* many
    CPs without the user folding each — which doesn't exist. Parked until it does.

- **Phase 8 — Decompose + delete SVG (runs next, before Phase 7).** With WebGL at
  full parity and signed off, remove the SVG render layers and RZPP from the
  editable path, finalize the module structure, slim `CreasePatternPanel`, and
  rebuild tests around the pure modules (geometry, camera, picking, adapters) plus a
  few pixel-diff smoke tests. Flip the default to `webgl`. **A detailed scope +
  cleanup plan for this phase lives in
  [webgl-phase8-delete-svg.md](webgl-phase8-delete-svg.md)** — the intent is for the
  migration to land as a net maintainability/architecture win, not just a renderer
  swap.

- **Phase 9 — Selection resize + flip handles (pulled into Phase 8, Step 1; rotate
  dropped).** Resize + flip are now built as Step 1 of the Phase 8 execution plan while
  the SVG reference exists. **Rotation is out of scope (Zach, 2026-07-14)** — no
  free-drag rotate handles, no rotate-90° buttons. Historical description below.
  The `SelectionTransformBox` proper: a DOM overlay with constant-size
  resize/rotate handles (and the flip/reflect menu) positioned by projecting the
  model-space frame (`cpLineSelectionFrame`) through the owned camera, driving a
  live GPU preview via a generalized selection transform (the move preview's
  `{ids, delta}` extended to arbitrary per-point transforms), committed with
  `transformOristudioCpSelection` (`resizeTransformForPoint` / rotate). Explicitly
  deprioritized below draw tools, diagnostics, and full-canvas scale — it is
  polish, and move already covers the common case.

The flag lets you fall back instantly at any point during manual testing.

### Phase 0 result (measured 2026-07-09 — pending author sign-off)

Throwaway regl spike lives in `apps/web/spike/` (run: preview `webgl-spike`
config, or `npx vite apps/web/spike`, at `localhost:5175`). Headless throughput
via `window.__bench(frames, deviceW, deviceH, perFrameFinish)` — draws
synchronously with `readPixels`+`finish()` forcing real GPU work, so it is
immune to background-tab rAF throttling. A `nonBgPixels` sanity field confirms
the scene actually rendered. Measured on the dev Mac at 2560×1440 / DPR 2, full
scene visible (no culling — the worst case):

| Segments (CPs) | Fill tris | ms/frame | fps |
| --- | --- | --- | --- |
| 536k (target: 100 CPs × 5k + 100 folded) | 18k | ~2.6 | ~380 |
| 1.07M | 36k | ~4.0 | ~249 |
| 2.14M | 72k | ~6.8 | ~148 |
| 4.29M | 144k | ~12.1 | ~83 |

The target workload runs at **~6× the 58 fps gate**, and the 58 fps crossover is
only ~6M segments — i.e. ~11× the target — all *before* viewport culling, which
only helps the zoomed-in case. Hover hit-test via the uniform-grid spatial index
was sub-millisecond. This validates the architecture (regl, two primitives,
instanced strokes + alpha-blended fills).

**Gate met — author signed off 2026-07-09.** The spike in `apps/web/spike/` is
**throwaway reference only**: production phases are written fresh against the
`cp-workspace/` structure (proper typing — no `regl as any`, real error
handling, tests on the pure modules) and must **not** import from `spike/`.

## Risks & mitigations

1. **Visual parity drift** (colors, widths, dashes, MV mapping, folded
   order/transparency, grid). → Side-by-side flag toggle + a small pixel-diff
   harness on representative docs; extract CSS style values into a shared theme
   the renderer reads.
2. **Hit-testing correctness** on dense overlap / close pairs / fat-target
   tolerance. → Spatial index tuned to current tolerance; id-buffer fallback for
   ambiguity; isolated tests with synthetic dense cases.
3. **Zoom crispness & DPR.** → Render at `devicePixelRatio`, real resize
   handling, never CSS-scale the canvas; owned camera avoids RZPP CSS-blur.
4. **Overlay/scene desync during pan.** → Drive GL draw and overlay transform
   from one camera matrix in the same rAF; transform overlay container, avoid
   layout thrash.
5. **Folded fill correctness** — bezier flattening, gradients, alpha ordering,
   self-intersecting facets (fill rule). → earcut for simple polygons, a robust
   tessellator for paths; verify gradient + xray docs explicitly.
6. **WASM snapshot round-trip on selection** (known: selection round-trips a full
   doc snapshot). → **This migration does not fix it**; a fast renderer will
   still stutter if selection re-serializes the whole doc. Scope a parallel task
   to read geometry via typed-array views / diffed snapshots. Called out so it
   isn't mistaken for a rendering bug.
7. **Big-bang risk** from rewriting a 7,000-line surface. → Phased, flag-gated,
   parity-first; SVG stays as fallback until Phase 8; each phase independently
   verifiable.
8. **Loss of DOM-based tests.** → Acceptable now (no users); rebuild higher-value
   tests around pure modules post-decomposition.
9. **regl edges / maintenance.** → The seam allows dropping to raw WebGL
   per-program; regl is stable and feature-complete.
10. **Accessibility regression** (per-line aria disappears). → Accepted for a
    CAD-like editor with no users; keep aria on the canvas element and overlay
    controls.
11. **Decomposition scope creep.** → Decompose only what each phase touches; no
    up-front whole-panel refactor.

## Acceptance gates

- **Phase 0 perf budget (to confirm):** e.g. ≥58 fps sustained pan at 100 CPs ×
  ~5k segments + 100 folded figures at DPR 2, with hover/selection latency
  <16 ms. Numbers to be finalized before the spike.
- **Per-phase:** the render + interaction inventory above serves as the parity
  checklist. A phase is done only when **the author has personally verified** its
  rows match SVG under the toggle (and the perf budget where relevant) and has
  signed off. Claude does not mark a gate met.
- **Final:** default flips to `webgl`, SVG path removed, module structure landed —
  after author sign-off on the full workspace.

## Decisions

Resolved (2026-07-09):

1. **Perf budget:** ≥58 fps sustained pan at 100 CPs × ~5k segments + 100 folded
   figures at DPR 2, hover/selection <16 ms. Confirmed as the Phase 0 gate.
2. **Diagnostics markers & snap indicator:** start as **DOM overlay**, move to
   GPU only if counts make the overlay a bottleneck.
3. **WASM snapshot round-trip:** **out of scope** for this migration — tracked as
   a separate, parallel task (orthogonal to rendering).

4. **Workspace model:** one Oriedita-style infinite canvas — a single geometry
   set where a "CP" is a closed-shape **segment** (via existing segmentation),
   and folded figures are placed objects on the same surface. **No multi-document
   / frame container.** Oriedita is the reference for ambiguous behavior.
   - **Folded generation policy:** **lazy + cached** — generate a folded figure
     on demand (or when its object first becomes visible), cache the
     `renderSnapshot`, mark `stale` via `sourceCpRevision` on edit, and
     regenerate stale objects only when visible, throttled through the WASM
     worker. Never eagerly solve all; never solve offscreen.
