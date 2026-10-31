# Connected layer spread in Fold and Diagram

## Goal

Ship the accepted layer-spread prototype as the default presentation of new
flat-folded pictures in **Fold** and **Diagram**, replacing the affine default.
The accepted behavior is **Normalized 50 heights, a reference plane fitted to
the whole visible surface, and layer-order correction**. It is not the earlier
single-face anchor or the rejected experiment that pinned all visible faces.

Requested and approved on 2026-10-30. Implemented on
`codex/connected-layer-spread` in draft PR #563. Defaults and accepted follow-up
controls are integrated; the production self-review below records further fixes
and remaining validation limits.

| Surface | Presentation | Interaction |
| --- | --- | --- |
| Fold workspace | Diagram only | Head-on paper; adjust amount and drag to reveal layers. Existing fold tools still pick the paper where it is drawn. |
| Diagram workspace, Pose | Diagram by default; optional Perspective 3D | Diagram uses the accepted head-on reveal. Perspective 3D orbits freely with the existing Pose/Simulate interaction semantics. |
| Diagram cards, Annotate, Pages, print and export | Captured chosen presentation | A stable picture of the pose, not an independently interactive viewport. |

Both presentations use the **same solved heights**. Perspective 3D changes the
projection and camera, not the fold or the spread solver. Simulated poses and
actual non-flat folded forms remain their existing, distinct ways of making a
picture. A separated flat fold must not masquerade as either one in saved data.

Paper remains joined at creases, with no additional crease faces. Faces stay
mostly planar. Crossings are penalized, not forbidden; the display correction
hides ordering violations where the known relations permit it. This is a
diagram presentation, not a collision-free physical model.

## Approach

### 1. Preserve the accepted behavior precisely

The external prototype lives at
`/Users/zacharymarion/.codex/visualizations/2026/10/26/01a17a70-e1e0-7311-8abd-1c622f7d5e39/layer-study`.
Its implementation references are:

- `height_solver.py` and `sweep/bottlenecks/audit.py`: the height objective,
  constraints, all-pair penalties and weight normalization.
- `sweep/bottlenecks/diagram_anchors.py`: the visible-surface reference fit.
- `sweep/report/diagrams/diagram-projection.mjs`, `diagram.js` and `README.md`:
  projection, controls and accepted defaults.
- `layer-occlusion.mjs`, `layer-ranks.mjs`, and
  `sweep/report/bottlenecks/local-order-renderer.js`: ordering correction.

These are behavioral references, not runtime assets or application dependencies.
Keep corpus inputs and generated corpus geometry outside git. Commit small
synthetic examples and a reproducible external-corpus harness instead. Copying
the standalone Three.js viewer into the product is not the integration.

**Height solve.** Normalize the longest folded XY extent to 2 and preserve
material vertex identity. Variables are one height per material vertex, an
affine plane per face, and nonnegative crossing slacks. Adjacent faces share
the same height variable at a shared crease endpoint. Coincident vertices from
different parts of the sheet must remain distinct.

The versioned `normalized-50-v1` objective preserves:

1. Area-weighted squared error from a preferred gap between adjacent faces in
   each local stack, sampled at its overlap-cell centroid. The preferred gap is
   `0.3 / max(1, maximum_stack_depth - 1)` in normalized coordinates.
2. Squared negative gaps at triangle-overlap corners for all overlapping,
   ordered face pairs. The coefficient is
   `50 * valid_spacing_weight_mass / valid_crossing_weight_mass`.
3. Face-plane residuals weighted by `30 * face_area / vertex_count`, small
   slope regularization, and the prototype's numerical regularization.
4. Hard warp, triangle-slope, height-range and mean-height constraints from
   the prototype. There is **no hard crossing constraint** and no subsequent
   shrink-to-remove-crossings operation.

Preserve area weighting and duplicate-row aggregation; do not replace local
stacks with a global face rank. Preserve the prototype's acceptance checks
independently of the numerical solver's status. A time-limited candidate may
be usable only when those checks pass, and its status must remain observable.
Missing substantial overlap orders are an input error, not permission to
invent a global order. Numerical sliver tie-breaking is separately versioned
and bounded by the prototype tolerance.

**Whole-visible-surface reference.** For each front/back side, take the face
visible in every positive-area cell of the original flat arrangement. Sample
its solved height at the cell centroid using the rendered triangulation. Fit
`r(x,y) = a*x + b*y + c` with cell area as weight, and choose the intercept
through the weighted 3D center. This is the accepted centroid-sampled fit,
not a new exact area integral. Freeze the reference during all gestures.
Use the minimum-norm fallback for a rank-deficient sample set.

In the prototype's frame, for amount `m`, drag vector `(dx,dy)` with screen Y
down, and side `s = +1` front / `-1` back:

```text
h  = m * (z - r(x,y))
x' = x + dx*h
y' = y - s*dy*h
z' = m*z
```

The diagram camera stays head-on. Front/back, the picture's in-plane rotation,
and Fold's Y-up / Diagram's Y-down frames are applied through explicit frame
adapters. Keep drag direction in screen coordinates after the picture's turn.
Do not embed coordinate-sign corrections independently in each host.

This is one affine map of the solved 3D geometry: it preserves shared creases
and existing planar faces. It does not guarantee every projected triangle
retains its original shape or orientation at large amounts. The reference
center stays fixed; fitting the viewport must not continuously recenter the
changing silhouette while dragging.

The solver's geometric limits describe the nominal pose. The maximum Amount
(now labeled 100%) deliberately doubles that pose, including its warp and slopes; do not
describe those nominal bounds as guarantees at every slider value or clamp the
slider back down through an unannounced second solve.

**Product scale is an explicit gate.** The comparison prototype uses
`shared_scale = min(opening_scale across five candidate settings)`, then applies
that to Normalized 50's raw solution. Arbitrary new product models cannot get
that number from a single Normalized 50 solve. Do not accidentally ship the
five-solve experiment or silently claim the standalone scale is identical.

Start the integration comparison with Normalized 50's own deterministic
post-solve scale (span, relative warp, triangle slope and height caps), bounded
as in `height_solver.py`. Compare it to the accepted common-scale pictures of
Smile, lotus, horse, Elsa, Captain America and Dali's elephant, then across the
study set. Freeze a model-independent scale policy/version and default amount
only after this visual check. If standalone scaling overopens models, calibrate
a documented conservative policy from the one solution's measurements; no
model-name lookup or additional candidate solves. This is an implementation
review gate, not an unresolved choice of spread algorithm.

### 2. Separate solving, projection, visibility and host behavior

Current integration points in this checkout:

- `cp-workspace/folded/foldedLayerSpread.ts` and `layerSpreadSettings.ts` own
  the existing depth/affine algorithms and shared settings.
- `foldedFlatScene.ts` produces `PaperScene` using whole-face painter order
  and patches for cyclic regions. Its existing patches describe the original
  flat overlap, so they are not sufficient for newly revealed overlaps.
- `fold/canvas/foldPaneScenes.ts` draws Fold; `foldPaneSpreadMap.ts` separately
  implements drawing-to-sheet mapping and picking. These must share the new
  projected geometry rather than become two implementations of the formula.
- `components/fold/canvas/FoldPane.tsx` draws through `useCpSurface` and the CP
  renderer's folded channel, not `SimulatorViewport`. `useFoldCanvasPaint.ts`
  currently suppresses spread after a tool takes its first pick or locates a
  fold. Preserve that existing tool-time flattening in this integration.
- `fold/document/foldStepSpread.ts` currently defaults to **off**, inheriting
  settings along a branch. Diagram currently defaults to **affine**. Changing
  only `DEFAULT_LAYER_SPREAD` would not change both surfaces correctly.
- Diagram's `captureSession.ts` holds a fold for repeated pose changes.
  `poseController.ts` previews and commits spread edits, and captures an orbit
  after `ORBIT_SETTLE_MS = 450`. Fold-derived Diagram steps have another capture
  adapter in `diagram/fold/`; both source kinds need the feature.
- `DiagramPose3dView.tsx`, `SimulatorViewport`, `simulatorOrbit.ts` and
  `useFolded3dMeshRuntime.ts` already provide free orbit, view cube, upright,
  camera persistence and static-mesh worker rendering without a simulation.

Use these boundaries:

| Owner | Responsibility | Must not own |
| --- | --- | --- |
| New `crates/oristudio-layer-spread` | Pure preparation, sparse QP assembly/solve, acceptance metrics and versioned normalization | Fold operations, layer-order search, UI, rendering or project state |
| Thin `crates/oristudio-layer-spread-wasm` | Typed solver bridge for the same browser/Tauri renderer runtime | Desktop-only algorithms or app-specific state |
| New `packages/layer-spread` | Plain data contracts; shared projection, face interpolation and visibility policy, usable by app and render worker | React, Zustand, document mutation or physics simulation |
| `apps/web/src/layer-spread/` | Cancellable worker service, bounded cache, lifecycle and host-independent runtime bindings | Product document ownership or a second renderer |
| CP/Fold adapters beside their existing concern modules | Produce canonical material topology, local stacks and source identities; map source frames | Numerical solver implementation |
| Fold and Diagram hooks/controllers | Actions, preview/commit, inheritance, undo, capture and tool arbitration | QP assembly or duplicated projection math |
| Existing paper renderer / simulator mesh renderer | Draw a supplied spread mesh or projected scene using shared visibility data | Changing document state or deciding defaults |

The shared package is small and specifically about this feature. Do not move
unrelated folded-form code into it to justify a new abstraction. Keep the
existing legacy depth/affine code as the compatibility path until old files
can be rendered faithfully without it.

**Numerical backend.** First prove the QP in the target runtime. Preferred
spike: a pure Rust sparse QP backend behind the new crate, testing Clarabel
against Python/OSQP on identical assembled problems. Clarabel supports QPs and
has documented WASM support, but compile, bundle size, cancellation and corpus
performance still need verification. See its [upstream repository](https://github.com/oxfordcontrol/Clarabel.rs)
and [WASM changelog entries](https://github.com/oxfordcontrol/Clarabel.rs/blob/main/CHANGELOG.md).
Use pinned dependencies and compare objective, constraint residuals and visible
results; changing numerical backend must not become a different aesthetic.

If that fails the parity/performance gate, evaluate the full dynamic OSQP WASM
build behind the same runtime contract. Do not use a code-generated solver for
one model: [OSQP code generation](https://osqp.org/docs/codegen/index.html)
assumes fixed problem dimensions and, for matrix updates, fixed sparsity.
The fallback is a backend decision, not two production implementations. Ship
one backend to web and Tauri; no Python server and no hand-written approximate
optimizer. Record the chosen build in this plan before integrating controls.

### 3. Canonical input and a solve once per folded state

The adapter supplies named material vertices, folded positions, original face
rings and deterministic triangulation, paper-side orientation, edge roles,
local overlap polygons/stacks, aux lines, and stable source-face mapping.
`OristudioCpFoldedPaperScene` already supplies rings, vertex IDs, sheet points,
subface polygons and stacks. `FoldScene` extends it with exact transforms.
Build a canonical front/model frame rather than solving separately for a rear
pass or in-plane turn. Verify mirrored/reversed-stack handling exactly once.

Preserve the product's display-layer semantics across flat creases:
`foldedDisplayLayers.ts` treats a precrease as a subdivision of one physical
layer. It must not create extra stack spacing or a new bending hinge. Prepare
planarity groups from those display layers while retaining original faces for
ink, anchors and picking; test subdivision invariance and compare any resulting
change to the prototype separately from the backend port. Do not merge stacked
faces by coincident coordinates.

The result holds heights, front/back references, interpolation/topology maps,
known local ordering, scale/version and diagnostics. Its cache key includes
canonical material geometry, triangulation/preparation version, layer-order
solution and solver configuration. It excludes amount, reveal, camera, zoom,
side, colors and viewport size. Order changes or actual folds invalidate the
solve; changing the view does not.

Use a dedicated lazy worker, so preparing or solving a large model cannot block
the main thread or the existing fold engine's interaction queue. Deduplicate
requests for the same key, prioritize the open pose over thumbnails, and retain
results in a byte-bounded LRU across the two hosts. Never solve every card on
mount. Release temporary arrays and GPU resources when no longer retained.

All responses carry a source key and generation. A model/step switch, undo or
new order invalidates an old request's right to publish. Cancellation must stop
work, not just ignore its answer: use backend interruption where available or
terminate/recreate the dedicated solve worker when an unneeded synchronous
WASM solve is running. A cache client must not cancel another client's retained
request. Respect bounded model/overlap counts and a time budget.

While waiting, show the current stored picture or the flat picture belonging to
the new state, with a quiet preparing status. Do not apply the previous model's
heights or secretly substitute affine spread. Invalid/missing topology, missing
orders and numerical failures produce a typed unavailable result; keep the fold
usable and preserve the requested setting for a retry. A single-layer input is
a successful zero-displacement result.

Amount/reveal changes update existing position buffers and interpolation data;
camera changes update uniforms. None launches a solve. Full vector clipping and
scene serialization happen after the gesture or on explicit capture/export,
not on every pointer event.

### 4. One visibility policy for preview, picking and export

Keep layer-order correction enabled for the new spread. It operates on
**projected overlap**, including the ink; it does not modify the height result.

- For an acyclic relation graph, the prototype uses rank depth bands; reverse
  them from the back, retaining physical depth within a rank. Preserve this
  initially as a compatibility path, including its behavior for tied ranks.
- For cyclic relations, mask a face where a known higher face projects over it
  (lower from the back). Resolve remaining pieces with physical depth. When a
  projected cycle excludes every candidate, retain the base physical-depth
  result rather than creating a hole. Do not replace local orders with an
  arbitrary global sort or take a transitive closure through a cycle.
- Decide front/back from the eye direction relative to the original fold
  normal. Retain the previous side in a small edge-on band. Do not fade the
  correction out at shallow viewing angles. Define a deterministic edge-on
  tie for a cold capture so live and reopened/exported poses agree.

This is the accepted visual correction at every camera angle, not a proof that
arbitrary projected cycles can all be satisfied. Preserve that limitation in
developer documentation; no user-facing promise of collision-free geometry.

Build the spread mesh from **all original material faces**. The current
`folded3dMesh.ts` selects top/bottom skins of exactly coplanar stacks; reusing
those skins would permanently remove the hidden layers we want to reveal.
Reuse the static-mesh worker transport, camera and paper style, with an explicit
spread-mesh input and optional visibility policy. Do not load this as a
simulation or bend the genuine 3D-fold model schema to fit it.

Live GPU rendering can use the prototype's mask semantics in the existing
renderer. The CPU scene builder must resolve the same visible regions for SVG,
PDF, bitmap capture and picking. Its input is the same projected triangles,
source face IDs and ordering policy. Existing BSP/hidden-piece utilities can
help with physical depth and splitting, but `meshToPaperScene`'s coplanar
`order` option alone cannot force the order of separated/intersecting faces.
Prototype the CPU clipping path early, before polishing controls.

Fold needs a distinct rendering adapter, not an orbit canvas placed over its
tools. Add an optional spread draw input to its existing folded channel; reuse
the layer-mask draw pass and paper-ink construction used by the static-mesh
path. The host supplies Fold's existing 2D viewport transform, style and clip
rectangle. Keep `useCpSurface` responsible for camera, pan/zoom and pointer
dispatch. The spread pass must restore framebuffer, stencil and depth state
before normal hover/tool overlays draw. During a reveal drag it updates buffers;
at rest the corresponding resolved `PaperScene` is available to capture. This
avoids main-thread polygon clipping on every drag without duplicating the Fold
canvas or replacing its coordinate system. Include this adapter in the early
GPU/vector equivalence gate, not as a late Fold-specific patch.

Retain source-face IDs on every visibility fragment. Fragments and triangle
cuts are drawing primitives, not additional paper/crease faces. Do not stroke
triangulation diagonals or clipping boundaries. Fold edges, flat/precrease ink,
aux lines, paper front/back colors, line widths and erosion come from the
existing document paper style. Match GPU and vector visibility with explicit
image comparisons, including cyclic examples and edge ink.

### 5. Settings, defaults and compatibility

Separate the spread recipe from its presentation. An illustrative shape is:

```ts
type ConnectedSpread = {
  kind: 'connected';
  version: 1; // pins solver, preparation, reference and scale policy
  amount: number; // 0..2; 1 = the versioned nominal opening
  reveal: readonly [number, number]; // screen drag vector, length <= 2
};

type SpreadPresentation =
  | { kind: 'diagram' }
  | { kind: 'perspective'; camera: FoldedFigureCamera; orderSide: 'front' | 'back' };
```

`orderSide` only supplies the deterministic near-edge-on choice; away from that
band the eye direction wins. Keep this metadata on the spread presentation,
not on the camera type shared with unrelated simulators.

Fold's settings accept only the diagram presentation. Diagram stores the
presentation alongside its flat-fold source recipe, retaining the existing
fold case, source fingerprint and side/turn. Prefer an additive presentation
field on the flat-fold render over repurposing `mode: 'folded-3d'`, which already
means the non-flat fold engine. Extend the Fold-derived Diagram render reader,
which currently only admits crease-pattern and flat-folded render modes.
Switching presentations keeps amount and remembers each presentation's view.
It does not refold, lose the selected order, or overwrite Simulated's pose.

Starting product values, revised 2026-10-31: amount **25%**, range **0–100%**,
reveal vector **(0.8, 0.6)**, whole-visible-surface reference and layer correction
on. The display maps to the unchanged stored multiplier range **0–2**: 25% is
0.5 and 100% is 2, retaining the prototype's maximum opening. Saved amounts
are not rescaled. Amount multiplies the nominal solved opening; it is not a
guaranteed equal physical gap everywhere. Keep the simple
label **Spread amount**; do not expose “Normalized 50”, reference-face selection
or optimizer weights in the product UI.

Compatibility must distinguish absent legacy fields from new defaults:

- New Fold sequences explicitly store the connected default, so branch
  inheritance and explicit off continue to work. An old sequence without that
  default retains its historical off behavior. Snapshot the document default
  so a future application default cannot alter a saved sequence.
- New Diagram flat poses start connected. Existing affine/depth pictures and
  existing unspread pictures keep their saved recipe and appearance. No silent
  conversion on open, refresh or style changes. Offer **Default / Affine / Depth** as normal undoable choices, with the saved
  kind selected (accepted follow-up replaces the original upgrade button). The presentation
  chooser offers Diagram / Perspective 3D, not the research alternatives.
- Fold-to-Diagram capture takes the effective Fold spread and initially uses
  Diagram presentation. The Diagram can then choose Perspective 3D without
  changing its source Fold sequence. Preserve before/after moment semantics.
- Preserve unknown future fields with the existing newer-step rules. Test
  remembered poses, malformed numbers, out-of-range values, and old-reader
  round trips instead of silently dropping the new presentation.

Persist recipe/version and the existing frozen scene/picture assets, not worker
handles, matrices or GPU buffers. Derived solves may be cached but are not
canonical document state. Opening or printing a saved picture does not require
a new solve. Explicit re-posing uses its recorded recipe version; a future
unsupported version keeps its saved picture and requires an explicit upgrade
rather than redrawing it differently.

### 6. Interaction and document edits

**Diagram presentation:** expose the amount and a compact direction/reveal
control, with direct dragging on the model while the reveal tool is active.
The drag moves the reveal vector; it never tilts the camera. Retain ordinary
2D in-plane rotation, front/back, fit and viewport zoom. Fit changes framing,
not reveal or amount. The draggable reveal pad excludes a 5% center dead zone on new edits;
its reset restores the default direction. Existing saved zero reveals remain
unchanged. Zero amount gives the exact flat drawing. Escape restores the gesture's initial value. Provide
keyboard/numeric alternatives through the shortcut registry and shared controls.

**Fold tool arbitration:** do not replace the Fold workspace's normal pointer
action with reveal. An explicit **Adjust spread** action enters that gesture;
choosing a folding tool exits it. Route it through the Fold action/keyboard
system, with the same verbs in toolbar/context menu/inspector. This avoids
making the default spread interfere with crease placement, layer selection,
cross-section picking or existing pan/zoom gestures. No free-orbit control is
offered in Fold.

Preserve `restingSpread`: the first pick is resolved against the visible spread
and converted to its sheet point, then the existing active-tool flow may show
flat paper. Finishing/cancelling restores the spread from the cache. This
presentation change must neither alter the pick nor dirty the stored amount.
Keeping spread visible throughout every folding operation would be a separate
interaction change, not a prerequisite for making it the default at rest.

**Perspective 3D in Diagram Pose:** use `SimulatorViewport` and its existing
orbit helpers: drag to orbit, Shift-drag roll, wheel zoom, named views/view cube,
Set Upright and reset behavior. Use perspective projection of `(x,y,m*z)`;
do not also apply the diagram shear. Keep diagram reveal/side/turn saved for the
return trip. Camera changes follow the existing settle/capture lifecycle,
including flushing the last pose before leaving, undo/redo, and stale-answer
rejection. Only the pose surface rotates; cards and pages use its capture.

Use one action catalog and settings reducer, with capability filtering:
Fold exposes `diagram`; Diagram exposes `diagram` and `perspective`. Hooks bind
those actions to each host's document edits. Panels remain composition sites;
do not accumulate effects, event handlers or solver state in them. Reuse
`LayerSpreadRows` or focused child controls and CSS modules; inspect any touched
global styling block under the repository's migration rules.

One amount/reveal gesture is one undoable edit, as current spread gestures are.
An orbit is captured once it rests, using the current Pose semantics rather than
one undo entry per frame. Switching mode is one edit. Read-only documents
cannot start gestures. Reset Pose and Reset Spread remain separate concerns:
camera/turn reset does not discard the user's amount; restoring spread defaults
is explicit.

### 7. Picking, annotations and output are part of the feature

Fold's current spread inverse assumes a face can be read as one polygon with
mean-value coordinates. Solved faces may be slightly warped, and projected
faces can overlap or invert. Replace the new path with triangle-based picking:
select the visible triangle using the renderer's order policy, interpolate its
original material point barycentrically, and return through the existing
face-to-sheet transform. Use the same projection for hover, snap targets,
letters, fold previews and cross-section overlays. Lines carried across
triangle boundaries must be split where interpolation changes; transforming
only their endpoints can put their interior off the paper.

Apply that mapping wherever spread is actually shown; during the existing
tool-time flat display, keep the identity mapping and current engine overlays.
Painting and picking must switch together rather than mix spread and flat
frames for one event.

Keep original face/material identities when capturing scenes. Extend existing
face-attached annotation carry to the same triangle mapping for diagram spread
changes. Generated Fold instruction marks follow those maps too. Free-standing
page annotations retain the current frame behavior. Camera/mode changes follow
the existing 3D Pose contract: ghost marks at their saved camera, and mark the
picture changed on capture; do not pretend all 2D annotations automatically
have meaningful 3D anchors. Preserve the newer/edited-card-mark rules.

Complete both CP-linked and Fold-derived Diagram paths: initial capture,
Refresh, Turn Over, Rotate, solution navigation, remembered Show As, generated
Fold cards, step strip, title-block model pictures, enlarged crops, Annotate,
Pages and SVG/PDF/PNG export. Use existing scene budgets and capture fallbacks;
if a scene exceeds the vector budget, retain the established bitmap fallback
explicitly rather than dropping faces. The artifact produced on capture must
be what Pages and export actually consume.

### 8. Validation and delivery gates

Implement in vertical stages with a working comparison at each gate. Do not
flip the default until both sources, picking and exports are correct.

**Numerical and geometry tests:** synthetic book fold, accordion, shared
multi-crease vertex, disconnected stacks, coincident but distinct material
vertices, a genuine cyclic weave, flat-crease subdivisions and degenerate input.
Check normalization/area-weight accounting, solver acceptance, boundary
continuity, visible-only reference fitting, rank-deficient fit, fixed center,
zero-amount identity, front/back, rotation and unit-scale invariance. Compare
the new backend against the Python objective and residuals before making any
grouping or normalization changes.

**Corpus validation:** external cpoogle Truth inputs; first the 48 study models,
then the broader available corpus. Include Smile, lotus, horse, Elsa, Captain
America and Dali's elephant as visual review cases. Test both sides, zero,
nominal and maximum amount, multiple reveal vectors, shallow/edge-on 3D views
and cyclic orders. Record preparation/solve time, status, memory, crossings,
opening, warp and source/adapter differences. Rendering correction must not
turn a crossing metric into zero: measure underlying geometry separately from
the displayed result. Store reports under ignored artifacts, not private CPs.

**Runtime tests:** deduplication, cancellation, eviction/reload, undo during
solve, quick model/order switches, returning to a cached step, missing GPU and
worker failures. Instrument solve count: amount, reveal, side, camera and style
changes must add **zero solves**. Report cold/warm p50/p95 and worst case on a
named desktop and representative mobile device. Initial targets: cached
interaction within a 16.7 ms frame on the study set, no main-thread solve tasks,
and a bounded 12 s cold-solve ceiling matching the prototype. Use the spike to
set a measured typical-model target; those numbers are goals, not claims of
current performance. Keep UI usable while any cold solve runs.

**Product tests:** default on in new Fold and Diagram documents, legacy default
preservation, explicit off/inheritance, one undo per gesture, saved/reopened
presentation, switching Diagram/3D without losing either view, both Diagram
source kinds, mapped Fold picks/tool marks, annotations, read-only/unknown
formats, and export equivalence. Browser validation covers desktop and touch,
light/dark, front/back, no camera tilt in Diagram, full orbit only in Diagram
Pose's 3D option, and the existing Simulate/non-flat 3D behaviors unchanged.

Use existing `fold spread changed` / `diagram picture posed` analytics where
they fit. Extend enums for the new kind, presentation and reveal action; record
one event per committed gesture, never per move. Solver outcome/performance
events, if added, contain status enums and bucketed counts/times only. No model
names, paths, raw coordinates or measured geometry. Follow shared consent and
monitoring conventions.

Implementation checks: Rust format/clippy/tests and new bridge WASM tests;
rebuild generated bindings; package tests; web lint, typecheck, i18n and unit
tests; normal production build with hooks; real browser export checks. Run
upstream parity suites only if an adapter change reaches the ported engine's
observable surface, reading its upstream first. The spread itself must not
change CP, fold-operation or layer-search results. Desktop uses the same
renderer/worker path; verify its packaged worker/assets, with desktop checks
if packaging changes. Use the persistent `scripts/dev-server.sh` workflow.

## Affected Areas

| Area | Expected files / modules |
| --- | --- |
| New original solver and bridge | `crates/oristudio-layer-spread`, `crates/oristudio-layer-spread-wasm`, workspace manifests and WASM build scripts |
| Shared geometry and runtime | `packages/layer-spread`, `apps/web/src/layer-spread/`, workspace package wiring |
| Flat scene adapter and legacy compatibility | `apps/web/src/cp-workspace/folded/foldedLayerSpread.ts`, `layerSpreadSettings.ts`, `layerSpreadControls.ts`, `foldedDisplayLayers.ts`, `foldedFlatScene.ts`; focused new source adapter beside them |
| Fold defaults and persisted settings | `apps/web/src/fold/document/foldSequenceDocument.ts`, `foldSequenceFile.ts`, `foldStepSpread.ts` |
| Fold drawing, picking and tools | `apps/web/src/fold/canvas/foldPaneScenes.ts`, `foldPaneSpreadMap.ts`, `useFoldPaneSpread.ts`, `foldPicking.ts`, `useFoldCanvasPaint.ts`; `components/fold/canvas/FoldPane.tsx` and the CP renderer's optional spread channel; `fold/sequence/useFoldStepSpread.ts`, spread controls, action/keyboard modules and card capture |
| Diagram schema and linked CP poses | `apps/web/src/diagram/document/diagramDocument.ts`, `diagramFile.ts`; `diagram/capture/captureFolded.ts`, `captureSession.ts`, `poseController.ts`, `linkedPose.ts`, `useDiagramLinkedPose.ts`; pose action catalogs |
| Fold-derived Diagram poses | `apps/web/src/diagram/fold/foldStepCapture.ts`, `foldStepPicture.ts`, `foldStepActions.ts`, `useDiagramFoldStepPose.ts`, Fold-to-Diagram store bindings |
| Pose UI | `apps/web/src/components/paper/LayerSpreadRows.tsx`, Diagram pose/step controls and a focused spread viewport component; CSS modules; registry shortcuts |
| Mesh render and vector visibility | `packages/origami-simulator/src/webgl/meshRenderer.ts`, camera/worker payloads, `paperScene.ts`, `bsp.ts`, `hiddenPieces.ts`; optional spread policy adapter, existing behavior unchanged by default |
| Capture metadata and annotations | `apps/web/src/diagram/annotate/annotationCarry.ts`, face metadata/readers, generated Fold marks, existing scene storage/export consumers |
| Cross-cutting | Analytics enum catalogs/docs, locale catalogs, synthetic tests, external-corpus harness and this plan |

No product changes in Tauri's business logic, no changes to vendored upstream
algorithms, and no corpus files added to the repository are expected.

## As built

The product uses `normalized-50-v1`. The new Rust crate solves the original
shared-vertex height QP with Clarabel 0.11.1; `packages/layer-spread` owns the
projection, triangle interpolation, visibility and vector clipping contracts.
The host adapter removes view transforms and retains material vertex IDs.
No ported folding engine or source crease coordinates are changed.

The final pose uses its **own** admissible enlargement, bounded by the opening,
warp, slope and displacement limits, then the user's 0–200% amount. The research
comparison's common multiplier is deliberately not a product dependency: it
required other candidate solves. Version 1 needs one solve and uses no model
names or per-model tuning. Its reference planes are fitted to the whole visible
surface independently for front and back. A 200% amount intentionally exceeds
the solver's nominal display limits; it is an illustration control.

Preparation, solving, live Diagram drawing, vector capture and raster fallback
have distinct worker lifetimes. Preparation is limited to two workers; the
solver is serialized, deduplicated and cached in a 32 MiB LRU. A foreground
request can preempt a thumbnail. Last-consumer release terminates work;
generation/load guards discard stale answers. Prepare/solve/capture time limits
are 12/15/12 seconds. The live renderer retains one in-flight frame and only the
latest pending frame. Ink interpolation is prepared once, canvas dimensions
change only on resize, and GPU buffers update in place. The mask buffer budget
is 64 MiB; above it, the same masks draw from existing per-face buffers instead
of duplicating geometry.

Fold uses its existing renderer and picking surfaces. Diagram uses the same
paper drawing contract in an OffscreenCanvas worker. Both CP-linked and
Fold-derived captures use the bounded vector clipper; complexity or time limits
switch to the same GPU visibility pass at 300 dpi. Saved scenes/assets feed
cards, Annotate, Pages and export without running the height solver again.
Original material face IDs, drawn corner positions and triangulation are stored
for annotation carry and first-pick mapping. Perspective camera changes retain
the existing out-of-step annotation semantics.

New Fold sequences store an explicit connected default; new Diagram flat
captures start connected. Legacy off, affine and depth settings retain their
readers and frozen pictures, with an explicit conversion control. Fold offers
only the diagram presentation, plus an armed Adjust spread tool. Diagram adds
full perspective orbit, view cube, upright, other side and camera reset. The
last camera is flushed on leaving Pose; switching presentation preserves it.
Amount/reveal resets are individual field resets; Clear reveal zeros both axes
in one edit. Camera reset preserves spread. Reveal is offered through the
viewport toolbar/overflow and shortcut registry, with numeric alternatives in
the inspector; this does not add a new Fold canvas context menu.

### Measurements and comparison

- All 48 external study inputs solved in Node 26/WASM: median 70.7 ms,
  p95 1,466 ms, worst 2,039 ms. Uncompressed solver WASM: 376,024 bytes.
  `scripts/layer-spread/evaluate.mjs` takes an external input directory and
  writes its report outside the repository. No study or cpoogle data is tracked.
- Raw heights differ from saved Python/OSQP results by RMS <0.001565 over that
  set, before enlargement. This is an end-to-end comparison, **not** an isolated
  identical-matrix backend proof: preparation uses unique overlap corners with
  equal area mass, drops unordered slivers below 2e-8, and groups flat creases.
  Python duplicated closing corners and ordered those slivers. Synthetic tests
  cover the QP independently, including connected creases, reversal and flat
  subdivision. Flat subdivision changes sampling quadrature slightly; it does
  not introduce another layer target.
- The six representative models (Captain America, Dali's elephant, Elsa, horse,
  lotus and Smile), on both sides at 200%, had zero GPU/vector/picking winner
  mismatches at approximately 25,000 interior sample points. Boundary
  antialiasing is outside that comparison. Contradictory projected cycles retain
  the documented physical-depth fallback.
- Desktop browser, 800×800 worker frame, 30 warm frames per study model,
  including geometry, ink, draw and bitmap return: median 2.8–10.5 ms;
  per-model p95 8.0–19.2 ms. Horse is the heaviest. Cold first frames were
  164–397 ms including worker/shader startup, excluding the separately cached
  solve. The synthetic study scene adapter supplies all crease outlines; it is
  not a measurement of React event-to-display latency. All six also produced
  300 dpi transparent raster captures. These measurements are not mobile or
  cross-browser performance guarantees.
- Live product checks: horse Truth capture, reveal, full orbit, saved camera on
  immediate Done/reopen, return to Diagram; a constructed Fold step with default
  spread, reveal and single undo; Fold-to-Diagram capture and its independent
  3D camera. Testing used the in-app Chromium browser. No external browser was
  necessary; Chrome Canary is the requested external-browser target. The built
  production app also passed the Fold, Fold-to-Diagram and perspective smoke test.

### Validation and remaining limits

The shared package tests (11), full web suite (16,184 passing, one expected
failure, 21 skipped), Rust workspace tests (2,989 passing, 19 ignored),
solver/bridge Clippy and formatting checks passed. Web lint, typecheck and
locale validation passed. Locale extraction, translations and hashes cover all
nine supported locales. The production build passed with the normal npm hooks,
including lazy worker chunks, rebuilt solver artifact and landing prerender.

No native shell behavior or upstream folding/parser algorithms changed, so an
interactive Tauri launch and separately configured upstream oracle runs are not
required for this presentation feature. Physical mobile/touch devices and other
browser engines have not been performance-tested. The 48-model study is not the
entire 484-model cpoogle corpus. Worker/geometry failures retain the existing
flat or captured view; this does not claim a valid connected solution for every
possible model. Local order correction is a rendering policy, not a physical
intersection guarantee.

## Checklist

- [x] Record the accepted algorithm and surface split.
- [x] Implement the versioned Rust/WASM QP and compare the external study.
- [x] Canonicalize CP/Fold input and preserve material identities and flat groups.
- [x] Freeze one-solve enlargement and whole-visible-surface references.
- [x] Add bounded workers, cancellation, prioritization and result caching.
- [x] Share projection, ink interpolation, visibility, picking and vector capture.
- [x] Compare GPU/vector winners and measure cold solves and warm frames.
- [x] Add compatible document readers, explicit defaults and legacy conversion.
- [x] Wire Fold's diagram-only display, reveal gesture, picking and thumbnails.
- [x] Integrate CP-linked and Fold-derived Diagram poses and full 3D controls.
- [x] Flush camera edits on close and preserve remembered presentation state.
- [x] Carry annotations using rendered triangles; retain spatial ghost semantics.
- [x] Add bounded vector capture and matching raster fallback.
- [x] Add keyboard/inspector alternatives, translations and analytics.
- [x] Validate package, Rust workspace and web behavior.
- [x] Complete final production build and source cleanup.
- [x] Open [draft PR #563](https://github.com/zacharyfmarion/ori-studio/pull/563)
  and hand off the persistent local app at `http://localhost:5267/`.

## Pose final rendering on idle

Pose keeps the GPU preview during interaction, then displays the step's already
captured final picture after 450 ms of rest. Reuse the Pages picture pipeline
(including vector clipping, stroke styles and raster fallback), without another
solve or capture. Keep the viewport mounted for immediate dragging and named
views. Only show a loaded picture matching the current spread and camera;
new input invalidates older captures before they can commit.

- [x] Add idle/final presentation for connected Diagram poses.
- [x] Guard camera capture commits against newer gestures.
- [x] Verify interaction, stale results, final picture parity and browser behavior.

The resting vector view uses `stepPictureUrl`, the same scene/pens used by Pages,
positioned in the live viewport using cached bounds and print margins. Camera
zoom and position therefore survive the transition; annotations remain ghosted
on the existing overlay. Newly captured bitmaps also retain the scene frame
(added during the production audit below); older bitmaps without it retain the
normal image-fit fallback until recaptured. Image decoding is asynchronous, and an unavailable image
leaves the live view visible. No additional solver or clipping worker is started.

Both CP-linked and Fold-derived camera captures carry an ephemeral validity
guard through the final commit, including asynchronous rasterization. New input
invalidates a running capture and postpones the next until it rests; leaving
Pose still explicitly flushes the newest camera. Duplicate camera notifications
from resize/settings are ignored. Conversion from a legacy spread waits for its
capture before preparing the live connected view.

The follow-up changes shared frontend presentation/capture scheduling only.
Rust/oracle/Tauri checks and a new production build are not repeated: no engine,
native shell, worker entry point, routing or build configuration changed. The
previous normal production build remains the baseline for those surfaces.

Follow-up validation: full web suite passed with four workers (16,195 passing,
one expected failure, 21 skipped), with 49 focused regression checks also
passing after the final queue change. The initial default-concurrency run hit
two 5-second WASM timeouts; both passed in isolation and in the full four-worker
run. Web lint, TypeScript and diff checks passed. In-app Chromium verified
legacy-to-connected conversion, head-on reveal, perspective orbit, reopening
Pose, Pages parity and retained wheel zoom (the final image stayed enlarged
from 306 to 628 CSS px across). The idle image marker was absent immediately
after input and present after capture/rest, with the same viewport mounted.

## Spread selector and reveal pad

Keep each saved spread selected and offer Default, Affine and Depth on every
spread. Replace the reveal axis sliders with a themed circular pointer/keyboard
control. Preview the vector atomically and commit once per gesture. Clamp user
reveal edits to a 5% radial minimum (preserve direction at the center), while
reading saved values unchanged. Show capture work explicitly and investigate
legacy conversion on the external Bodo document.

- [x] Restore all spread choices and preserve saved selection.
- [x] Add shared radial control, vector preview and consistent center exclusion.
- [x] Check Bodo conversion and live responsiveness.
- [x] Validate gestures, saved compatibility, locales and browser appearance.

Default is a normal selectable kind, not a conversion button, and Affine/Depth
remain available afterward. File readers still preserve the saved kind and
values. Reveal edits share one radial clamp across the inspector and both
canvases; the center retains the previous direction at a 5% radius. Both
coordinates preview together and commit in one capture/undo operation. The
pad supports pointer capture, touch, arrow keys, Shift steps and reset. It
replaces the zero-reveal action and the two axis sliders. Legacy snapshot reads
are skipped for Default drags in Fold-derived Diagram poses.

Chrome Canary opened the original external 433 MB Bodo OSF and selected step
204 (the largest solve in the prior benchmark). Affine remained selected on
open. Default completed successfully and mounted the live renderer without
reopening Pose; the initial operation still takes seconds for the solve and
final capture (the vector worker has a 12-second ceiling). This change adds an
explicit Updating spread status rather than claiming to remove that upfront
cost. Center click, keyboard edits and radial dragging continued to work during
pending final captures. No changes were saved to the original OSF. The in-app
browser separately verified the final Default label, switching back to Affine,
switching back to Default and dragging the pad. Screenshot:
`/tmp/ori-default-spread-control.png` (local validation artifact only).

Validation: lint, TypeScript, all nine locale checks and diff checks passed.
The full web run passed 16,201 tests and found one old two-option selector
expectation. That expectation was updated for Default/Affine/Depth, with all
94 tests in the five affected suites passing on rerun. After the final snapshot
read optimization, 15 targeted control, linked-Pose and Fold/WASM integration
checks passed. The full run also had one expected failure and 21 skips. No
solver, worker entry points, file readers, bundling or native shell behavior
changed, so Rust/oracle/Tauri and production-build checks were not repeated.


## Production self-review (2026-10-30)

The earlier checklist covered the original integration, not every interaction
with a slow in-flight capture. This audit follows the reported disabled
Presentation control and checks both linked source types.

- [x] Presentation can be selected during capture, with pending feedback; newest choice wins.
- [x] Canvas and inspector reveal edits queue without dropping values; one gesture, one undo.
- [x] Queued edits cannot survive Undo, document replacement, read-only changes or step removal.
- [x] Review preview/final picture alignment, worker failures and bounded resource lifetimes.
- [x] Reconcile the plan with accepted follow-ups and review persistence/default/camera coverage.
- [x] Run focused regressions, full web checks, package tests and production build.
- [ ] Verify Diagram/Perspective switching, orbit, idle render and Pages in Chrome Canary.

### Findings and fixes

The Perspective implementation existed, but both source types disabled its
selector while a final capture ran. Large captures made it appear unavailable.
The selector now stays enabled and displays the requested mode immediately;
a shared per-step queue waits for capture ownership, keeps the newest pending
value for each field, and prevents superseded captures from committing. Fold
camera captures use that queue too; presentation changes invalidate old orbits.
Canvas reveal gestures now use the same preview/commit path as their inspector.

Undo and document replacement cancel queued requests and held reveal gestures.
The queue also checks document identity, step existence and read-only status
before work and commit, removes its subscriptions after draining, and recovers
from rejected requests. Fold previews clear on history changes, so releasing a
pointer after Undo cannot restore an abandoned gesture.

Raster fallback was missing the geometry frame required to align its final
image with the live camera. New connected raster pictures save a small optional
scene-frame tuple, including the capture margin and rounded pixel extent.
Pose uses it to preserve framing and ghost-annotation placement. The reader
validates this metadata; existing files without it still load unchanged. A
graphics worker that stops replying now terminates after ten seconds, exposes
the existing fallback, and closes late bitmaps rather than painting them.

The bounded solve cache, request leases, worker cancellation, saved spread
compatibility and camera persistence remain shared between Fold and Diagram.
No additional solver or duplicate final capture was introduced for idle display.

### Audit validation

- Full web suite: 1,274 passing files, 16,219 passing tests, one expected failure
  and 21 skips. Final targeted regressions cover queue cancellation/coalescing,
  busy selectors, held gestures across Undo, real Fold/WASM presentation and
  history, raster framing/file round-trips and stalled workers. The final three
  UI/WASM suites passed all 45 tests. The first Fold integration test's cold
  module loading was moved to fixture setup after intermittent five-second
  timeouts; its capture behavior and timeout are unchanged.
- Lint, TypeScript, all nine locale checks and diff checks passed. Shared
  package tests (11) and solver/bridge Rust tests (5) passed. The normal
  production build rebuilt the WASM outputs and completed landing prerender;
  the final frontend bundle and explicit prerender passed again after the last
  hook change.
- In-app Chromium: saved Affine selection; conversion to Default; both
  presentation choices; Perspective camera toolbar; camera retained after
  Done/reopen; return to Diagram; idle final image; matching saved artwork in
  Pages. Local screenshot: `/tmp/ori-spread-review-perspective.png`.
- Chrome Canary was unavailable at this audit checkpoint. The follow-up below
  records the later exact-file Canary verification and remaining input-tool
  limitations. No private source file was saved or committed.

This audit changes shared frontend scheduling, presentation, and optional
capture metadata. It does not change the native shell or upstream folding
semantics; interactive Tauri and upstream oracle runs were not repeated.

## Live and settled ink parity (2026-10-31)

Investigate the reported Bodo fish regression at rest and line flicker during
parameter changes. Compare actual vector/raster capture against live geometry,
including line visibility at shared boundaries, pen treatment, depth precision,
and asynchronous frame/picture handoff. Keep expensive clipping off interaction.

- [x] Reproduce on the external Bodo document and identify the differing paths.
- [x] Correct verified rendering/visibility or handoff defects with focused regressions.
- [x] Check settled Pages output, parameter gestures, zoom and both presentations.
- [x] Run relevant validation and record actual performance/coverage limits.

The supplied external document's step 168 has 820 faces and 1,326 triangles,
with an acyclic layer order. Its saved pose and computed framing agree. Three
precision defects explained the discrepancy:

- Line clipping rediscovered ownership by testing a midpoint against face
  triangles. A midpoint on an outline could round outside its owner, making a
  lower face win and removing a valid 123-unit outline. Ink now includes its
  known material owner and interpolated depth in the canonical winner rule;
  genuinely higher covering faces still hide it, including cyclic-order cases.
- Clipping at large page coordinates produced essentially zero-area polygons.
  The SVG seam-closing fill stroke made these visible as white cuts. Relative
  half-planes, analytic depth planes, stable polygon area, and coordinate-ULP
  cleanup remove these artifacts without dropping real thin layers. Step 168
  went from 980 fragments (68 numerical slivers) to 710 (zero such slivers).
- Float32 GPU positions could miss every double-precision triangle and receive
  an arbitrary 0.5 depth. Nearest material-edge interpolation replaces that
  discontinuity. There were 447 affected fill vertices and 1,430 stroke
  endpoints on step 168; none remain. Ink bias now accounts for depth-buffer
  precision instead of vanishing when divided across hundreds of layer bands.
  It stays within a band's reserved margin so it cannot jump an ordered layer.

Prepared triangle planes/bounds are reused across all lines in one capture,
then released. There is no new persistent cache, solve, or interaction-time
clipping. A local diagnostic measured 146 ms polygon clipping and 3,741 ms ink
clipping for step 168; final capture remains expensive worker work. Isolated
GPU-geometry preparation measured 16.3 ms median / 17.0 ms p95 (before: 15.8 /
30.8 ms). These are local stage timings, not end-to-end interaction latency or
a new corpus benchmark.

Validation for this follow-up:

- Shared geometry: 15 passing tests. Focused web suites: 45 files / 349 tests,
  covering spread geometry, capture, picture metadata/framing, idle handoff,
  layer ordering, context loss, and quantized 16/24/32-bit depth. Lint,
  TypeScript, package build and diff checks passed.
- The normal production build passed with WASM hooks and landing prerender.
  The frontend bundle and explicit prerender passed again after the ink-bias
  change. Rust, upstream oracles, full web suite, and interactive Tauri were
  not repeated: this follow-up changes shared TS rendering only; the current
  targeted suites cover it. The earlier full-suite results above are historical.
- Chrome Canary opened the supplied 433 MB document, selected step 168, captured
  the corrected pose, and displayed that artwork in Pages. Native scroll/drag
  automation later returned `noWindowsAvailable`; this limits the final Canary
  pointer verification, not file loading or settled rendering.
- In-app Chromium additionally verified final-code wheel zoom and idle handoff,
  amount/reveal changes, Perspective 3D orbit (yaw/pitch changed), and return to
  Diagram. Corrected screenshot: `/tmp/ori-spread-ink-review/final-recaptured.png`.
- Existing saved pictures remain snapshots until recaptured. Opening the old
  regression file alone can therefore still show its old white cuts at rest;
  nudging Amount and restoring 103% regenerated the picture for these tests.
  The original file was never saved, uploaded, or committed.

This closes the reproduced precision defects, not an all-model/all-device
certification. Physical touch devices and other browser engines remain untested.

## Amount control follow-up (2026-10-31)

- [x] Display Default spread as 0–100% in the shared Fold/Diagram controls,
  preserving the internal 0–2 range and existing saved poses.
- [x] Use 25% (multiplier 0.5) for new defaults and Amount reset. Affine and
  Depth retain their original percentage semantics.
- [x] Verify range endpoints, reset, and unchanged saved values. All 228 tests
  across eight affected suites passed; web lint and TypeScript passed.
- [x] Check Chrome Canary on Bodo step 168: the existing multiplier 1.03
  displayed as 51.5%; reset displayed 25%; Undo restored 51.5%. The original
  file was not saved. Screenshot: `/tmp/ori-spread-perf-20261031/amount-25-canary.png`.

No solver, renderer, serializer, CSS or native-shell changes in this follow-up.
The prior production build and corpus benchmark were not repeated for a shared
control conversion and default-value change.

## Inspector cleanup (2026-10-31)

- [x] Remove the inline “Updating spread…” note so busy state does not add a
  row or shift controls. Keep the accessible busy state and existing global
  folding progress toast; do not add a toast on every reveal edit.
- [x] Remove the visible direction caption beneath the reveal pad, retaining
  direction in its accessible value and the keyboard/drag hint.
- [x] Center text-row values beside reset buttons in the shared FieldRow CSS
  module. Chrome Canary visually confirms the percentage and reset alignment
  on Bodo step 168. No saved file was changed.

Validation: 99 focused tests passed across reveal, Fold/Diagram controls,
shared field rows, global progress toasts and live CSS selectors. Web lint and TypeScript passed.
No geometry, file format, worker or native changes: no new corpus run, build,
Rust/oracle run or Tauri check was needed for this presentation-only cleanup.
