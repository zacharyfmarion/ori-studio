# Connected layer spread for 3D folded figures

## Goal

Assess whether Ori Studio's connected spread can extend to genuinely non-flat
folded figures, and define an implementation that reveals stacked paper while
preserving the overall 3D shape and keeping material creases joined.

**Assessment: feasible as a display deformation, with a numerical and rendering
prototype required before product integration.** The existing architecture
provides most of the supporting infrastructure. The height solve and visibility
policy need a spatial counterpart; enabling the existing control is insufficient.
Exact rigid faces, exact fold angles, finite paper thickness and collision-free
geometry are not guarantees of the existing spread, nor proposed guarantees here.

Investigation date: 2026-11-02. Code inspected at `e95baa25b`. A standalone
prototype was subsequently built at the user's request; its results are below.
No production product behavior has been changed.

Follow-up, 2026-11-03: the user accepted the prototype's opening and requested
camera-dependent layer-order correction. That is now in the prototype. The
production rendering sequence is specified in
[`ordered-3d-spread-rendering.md`](ordered-3d-spread-rendering.md), which
supersedes the initial tie-only visibility recommendation.

Scope assumption: the target is the **computed 3D folded figure** produced by
the CP fold command, including its Diagram captures. Simulator meshes and moving
fold sequences are separate follow-up work. Start with opening touching,
coplanar stacks within the existing 3D form; increasing the gaps between already
separated surfaces is a different objective.

## Approach

### 1. What the current spread actually does

There are three existing methods:

| Method | Current behavior | Suitability for this extension |
| --- | --- | --- |
| Depth | Derives display-layer levels, averages them at shared material vertices and shifts the picture in a screen direction. | Cheap illustration heuristic, but does not supply a consistent spatial separation direction. |
| Affine | Moves paper toward its unfolded sheet coordinates, with an optional directional skew. | Could inspire a separate 3D illustration effect, but tends to change the whole form rather than selectively open stacks. |
| Connected, the current default | Solves one height per material vertex, then displays those heights with a reveal shear or a perspective camera. | Best foundation for connected 3D spread. |

The relevant implementation is:

- `apps/web/src/cp-workspace/folded/connectedSpreadSource.ts`: material topology,
  normalization, triangulation, local stacks and display-layer grouping.
- `crates/oristudio-layer-spread/src/{lib,prepare,qp,reference}.rs`: a sparse
  Clarabel quadratic program. Adjacent stack layers prefer a positive gap;
  ordered overlaps penalize negative gaps. Face planarity, slope and height
  bounds keep deformation modest. Crossing penalties are soft.
- `packages/layer-spread/src/projection.ts`: one shared height field becomes
  `(x, y, amount * height)`; the diagram presentation also shears XY relative to
  a fitted visible-surface plane.
- `packages/layer-spread/src/visibility.ts`: known order can override geometric
  depth, with global depth bands for acyclic relations and masks for cycles.
- `apps/web/src/layer-spread/`: worker preparation/solve, cancellation, bounded
  caching, projection, ink, picking and settled capture.

The existing **Perspective 3D** option still starts from a flat-folded figure
and one height field. It is not support for a non-flat source. The distinction
is explicit in `implementation-plans/connected-layer-spread.md`.

### 2. What the 3D path already provides, and what is missing

`crates/oristudio-cp/src/folding3d/` already supplies rigidly placed faces,
coplanar plane groups, a coordinate frame for each plane, arrangement cells,
local top-to-bottom stacks, fold edges and ordering diagnostics. These are the
right inputs for opening stacks on multiple differently oriented surfaces.
This is Ori Studio native behavior, not a missing Oriedita port.

Four boundaries need work:

1. **Material topology.** `Folded3dRenderModel` has separate face/cell coordinate
   arrays and face adjacency, but no face-ring material vertex IDs. The kernel's
   `Placement3d.points` and `rings` already have those IDs. Recovering them by
   welding equal folded coordinates would wrongly join distinct paper layers.
2. **One direction versus many.** The flat solver assumes every displacement is
   along the same Z axis. Spatial stacks have different normals. Solving each
   plane independently makes a shared crease acquire different endpoints on its
   two sides. Averaging those answers afterward would discard the solved gaps.
3. **Hidden material.** `folded3dMesh.ts` and `foldedMeshSource.ts` deliberately
   render only each coplanar cell's exposed skin in opaque mode. Those skins
   cannot reveal buried layers. The translucent/all-layer geometry is useful
   evidence and plumbing, but its duplicated cell vertices are not solver DOFs.
4. **Visibility.** A spatial figure has no single front/back direction. Copying
   flat spread's global rank bands can place a distant surface in front of an
   unrelated nearer one. Geometry must decide occlusion between spatially
   separated surfaces.

There are explicit product gates as well:
`foldedFigureSpreadBlock()` returns `spatial`; the Diagram `folded-3d` render
recipe has camera and side but no spread. Both need deliberate schema and
lifecycle changes after the geometry is proven.

### 3. Evidence from the supplied examples

External corpus root:
`/Users/zacharymarion/Documents/open source/origami-designer/test_files/non-flat/`.
It contains 78 `.fold` and 46 `.osf` files, including related versions and
combined examples; these are file counts, not independent-model counts.

Twelve representative files were run through the current release-build
`fold3d_render_model` example at solution 1. For `.osf`, the existing
`scripts/osf-fold-projection.mjs` extracted the saved FOLD projection at full
precision. This tests that projection as a whole, not a selected region or every
saved figure inside the project. No corpus geometry was copied into git.

| Example | Faces | Planes | Planes with stacks | Maximum local stack | Observation |
| --- | ---: | ---: | ---: | ---: | --- |
| `non-flat-test.osf` | 25 | 3 | 3 | 4 | Small positive case: opening must work across multiple planes. |
| `non-flat-harder_fixed.osf` | 104 | 6 | 6 | 4 | Repeated multi-plane stacks. |
| `personal/non-flat-harder_final.osf` | 141 | 7 | 7 | 4 | Larger related regression case. |
| `fold-angle-3d/penguin_freeform.fold` | 127 | 21 | 19 | 12 | Deep stacks and free-form angles; key visual acceptance case. |
| `known-good/waterbombBase.fold` | 8 | 2 | 2 | 2 | Smallest sampled positive case. |
| `kirigami/kirigami-cylinder.fold` | 197 | 36 | 1 | 2 | Mostly unstacked shape; preserve cuts and avoid globally inflating it. |
| `personal/stacked_rectangles.fold` | 16 | 7 | 0 | 1 | No coplanar overlaps: stack-driven spread should be a no-op. |
| `known-good/airplane.fold` | 16 | 2 | 2 | 7 | All 33 overlapping cells are undetermined; their listed stacks must not be treated as solved orders. |

The other four whole-file inputs were refused before render-model production:
`simple_example.osf` and `non-flat-harder.osf` reported approximately 120°
closure residuals; `plant/rabbit.osf` reported approximately 70.53°;
`3d-playground.osf` reported an unassigned crease. These are useful negative
cases, not evidence that spreading failed. File names such as “simple” and
“known-good” are not admission guarantees.

Reproduction for an OSF example, using temporary output:

```sh
cargo build -p oristudio-cp --release --example fold3d_render_model
node scripts/osf-fold-projection.mjs \
  "$ORISTUDIO_NON_FLAT_CORPUS_DIR/non-flat-test.osf" > /tmp/ori-spread-input.fold
target/release/examples/fold3d_render_model \
  --source /tmp/ori-spread-input.fold --solution 1 > /tmp/ori-spread-model.json
```

Read the resulting `cell_attr` in strides of seven:
`[plane, ring_start, ring_len, stack_start, stack_len, determinacy, draw_rank]`.
Count `stack_len > 1` for stacked cells, distinct associated planes for stacked
planes, and check determinacy independently. A produced model alone does not
certify a fully ordered or intersection-free fold.

### 4. Recommended numerical prototype: one coupled vector solve

Introduce a separate, versioned spatial input/output contract in the existing
spread subsystem. Preserve `normalized-50-v1` and all existing saved flat spread
behavior. Reuse the sparse backend and worker architecture rather than replacing
the flat solver with an unproven generalization.

**Input adapter.** Add an on-demand, read-only source accessor on the 3D session
that exports material vertex IDs, face rings, unfolded coordinates, placed
coordinates, edge roles, plane frames, determined local stacks and source IDs.
Transport the same contract through the WASM and native CP clients. Do not
recompute placement or ordering in JavaScript.

`folded_form_frame()` already demonstrates deterministic material welding:
choose the placed image from the lowest-indexed incident face, rather than
averaging. Reuse that convention in the display adapter, and retain the measured
placement disagreement. Do not alter `Placement3d.face_points` or erase its
closure diagnostics. Cut boundaries must retain their actual material topology.
Triangulate whole material faces in their local frames, with the same
interpolation used by geometry, ink and picking.

**Unknowns.** Give every material vertex a displacement vector `d[v]` in 3D.
At amount `a`, display:

```text
p_display[v] = p_folded[v] + a * d[v]
```

Incident faces use exactly the same variable at their shared vertex. Separate
material vertices remain separate even when their folded positions coincide.

For each adjacent upper/lower pair in a determined overlap cell, interpolate
each face's displacement at the cell sample. If `n` is that plane's emitted
`up`, the additional local gap is:

```text
gap = dot(n, displacement_upper(sample) - displacement_lower(sample))
```

Penalize deviation from a small positive target, weighted by overlap area.
Evaluate negative-gap penalties for all ordered overlapping pairs at overlap
corners, following the current solver's distinction between spacing targets and
crossing penalties. All planes participate in **one** system.

For the first experiment, fit each display layer's displacement to a small rigid
motion, `t + omega × (p - center)`, with bounded residuals. Since the base points,
normals and interpolation weights are fixed, these are linear expressions and
their squared residuals fit the existing QP backend. Penalize strain, warp and
unnecessary movement; constrain global drift and rotation. Group only material
faces connected by zero-angle creases into one display layer, never all faces
that happen to occupy the same plane.

This is a proposed small-deformation objective, **not** a port of the flat
objective or a proof of physical foldability. Benchmark its tradeoffs against a
face-affine displacement objective if rigid-motion fitting prevents useful
opening. Use a camera-independent model scale and calibrate a new gap/amount
policy; do not inherit the flat slider's 0–2 range or 7% default without evidence.

**Acceptance and limits.** Measure separation, residual order violations,
crease continuity, face warp, edge-length change, triangle degeneration, shape
drift and newly introduced cross-plane intersections. The latter require a
spatial broad phase and triangle checks, not just the existing coplanar penalty.
Start with a conservative amount range. Compute a supported range or reject the
candidate when checks fail; report the limit rather than silently shrinking a
user's chosen amount. Scaling cannot fix an order violation whose sign is wrong
at every positive amount. Do not add a nonlinear physical solver unless this
prototype demonstrates it is necessary.

For the initial product scope, require usable topology and determined overlap
orders, and decline models with known crossing verdicts. A model with no stacks
returns a successful zero deformation. An unavailable spread preserves the
requested setting and the existing figure, with an explicit reason. Admission
and ordering failures remain the fold pipeline's responsibility.

### 5. Prove rendering alongside the solver

Build a mesh containing **all material faces**, with source-face IDs and shared
material interpolation. Reuse the static mesh transport, camera, lighting,
paper style and export infrastructure. Recompute normals for the deformed
triangles. Auxiliary lines and creases must follow their face's interpolation;
arrangement cuts and triangulation edges must never become visible ink.

Use geometric depth across unrelated spatial surfaces. Within a source plane,
known layer order may override geometric depth wherever the pieces overlap on
screen, with the order reversed from the opposite side. This is an intentional
presentation rule, not just a coplanar tie-break or evidence of collision-free
geometry. Do not apply one global rank across planes. The follow-up rendering
plan defines the prototype's local-mask policy, cycle fallback and the remaining
cell-support decision. The old exposed skins and hinge-visibility rules cannot
simply be reused after layers move apart.

Live preview, picking, settled `PaperScene`, SVG/PDF and raster output must
consume the same deformed triangles and agree on visibility. Keep the exact
existing render path at amount zero, and test the transition from zero to a
small positive value for popping and missing layers. Freeze the camera/frame
while adjusting amount, with a bounded allowance for the spread extent, so
auto-fitting does not cancel the visible opening or make the figure swim.

The initial controls should be **Spread Layers + Amount**, using the existing
orbit to reveal the openings. The flat reveal pad depends on one reference
plane and one front/back sign, neither of which generalizes directly. A camera
relative reveal deformation can follow if the prototype shows it is needed;
it should not be faked by shearing the entire non-flat model.

### 6. Integrate only after the visual acceptance gate

Recommended delivery sequence:

1. **Geometry and rendering experiment.** Synthetic joined stacks plus the
   external waterbomb, non-flat-test, penguin, cylinder and no-stack case. Produce
   orbitable before/after comparisons, amount sweeps and diagnostics. Confirm
   useful opening without cracks or distracting distortion before UI work.
2. **Shared engine/runtime.** Versioned source and solution contracts, additive
   CP accessors, WASM solve, cancellation, budgets and tests. Cache by geometry,
   material topology, solution/order and solver version. Amount, camera, color
   and viewport size must not trigger another solve. Invalidate correctly on
   refold, solution change, undo and document replacement.
3. **CP figures and Diagram.** Kind-aware availability and controls, transient
   buffer updates during gestures, one committed undo entry per gesture, and
   settled capture afterward. Extend 3D render recipes, project/share round
   trips and export. Reuse the existing 3D rehydration rules: preserve the saved
   picture until the correct source and layer-order solution are available.
   Persist a versioned recipe and appropriate settled picture, not raw QP state.
4. **Broader regression and release validation.** External corpus evaluation,
   camera sweeps, large-model performance, cancellation and browser/Tauri parity.
   Add Fold-sequence and simulated-pose support only as separately scoped work.

Use a distinct spatial recipe/version so an older reader cannot interpret 3D
parameters as the existing flat connected spread. Preserve unknown settings in
the established extension mechanisms. FOLD interchange continues to describe
the actual folded geometry; presentation spread belongs to project/image
output unless a separately named deformed-mesh export is introduced.

Keep bindings in concern hooks and verbs in the existing action catalogs, not
panel effects. Reuse shared controls with their CSS modules; follow the styling
migration rules for any changed block. Instrument adoption through the central
analytics layer, using enum/bucket properties and avoiding duplicate events
where menu dispatch already captures the action.

### 7. Prototype delivered, 2026-11-02

The reproducible experiment is in `scripts/layer-spread/spatial/`; its README
documents setup, objective weights, bounds, diagnostics and the measured sweep.
`crates/oristudio-cp/examples/fold3d_spread_source.rs` reads existing session
geometry and material topology through public Rust APIs. This is an example
accessor, not the proposed production WASM/native contract.

The local viewer compares original cell skins with the full deformed material
mesh, with linked orbit/zoom, amount, three shape-preservation profiles, edge
visibility and animation. It includes seven drawable cases (one synthetic,
six external) and two explicit source refusals. Generated inputs and results
stay in ignored `artifacts/spatial-spread-prototype/`.

All 21 profile/model combinations converged or returned the exact no-stack
answer. The synthetic joined strip, waterbomb, three-plane stack and spikes
have no new detected transverse intersections at 25%, 50% and 100%. The
penguin and cylinder do: Balanced at 100% detects 49 and 240 new intersecting
face pairs respectively. The penguin also retains negative local gaps. The
cylinder's coplanar gap checks alone report no problem, demonstrating why
cross-plane contact constraints are necessary. Counts are finite-tolerance
diagnostics, not a complete intersection proof.

Material connectivity is preserved through triangulation as well as shared
unknowns: a first pass exposed omitted/ill-conditioned collinear ears, which
were repaired using the existing flat spread triangulator's boundary-restoring
and diagonal-flipping approach. No reversed triangles remain in the sweep.

The initial experiment deliberately rendered geometric depth without a masking
correction. On 2026-11-03, the user accepted the opening aesthetic and requested
the drawing-order correction. The viewer now has a default-on **Enforce layer
order** toggle, camera-relative per-plane masks and equally masked crease lines.
It keeps the same geometry and measurements. Seven Python tests, six Node policy
tests and eleven WebGL pixel checks cover the updated experiment.

The next implementation work is the shared material mesh and visibility path
in the follow-up rendering plan. Cross-plane contact constraints remain a
separate numerical investigation: shape preservation alone does not solve the
penguin/cylinder intersections, and a smaller amount is not necessarily enough.

## Affected Areas

| Area | Planned responsibility |
| --- | --- |
| `crates/oristudio-cp/src/folding3d/`, CP session boundary | Read-only spatial spread source with stable material identity and existing order diagnostics. |
| `crates/oristudio-cp-wasm/`, native CP command/client boundary | Equivalent source access for browser and desktop. |
| `crates/oristudio-layer-spread/`, `crates/oristudio-layer-spread-wasm/` | Separate spatial QP, diagnostics and bounded acceptance. |
| `packages/layer-spread/` | Spatial contracts, interpolation and shared visibility policy without changing flat semantics. |
| `apps/web/src/layer-spread/` | Worker lifecycle, cache, preparation and settled captures. |
| `apps/web/src/cp-workspace/folded/`, `Folded3dWindowLayer.tsx`, `apps/web/src/simulator/` | All-material display mesh, normals, ink, render/pick/export agreement and gesture lifecycle. |
| Figure stores, project extensions, Diagram document/capture/pose modules | Availability, recipe persistence, undo, rehydration and sharing. |
| `scripts/layer-spread/`, synthetic fixtures/tests | Reproducible external corpus evaluation and camera/amount comparisons. |

## Checklist

Investigation:

- [x] Trace depth, affine and connected flat spread implementations.
- [x] Trace spatial topology, local stacks, opaque skins, scene export and persistence boundaries.
- [x] Build the existing release-mode 3D measurement examples.
- [x] Run twelve representative external files and record successes, undetermined orders and refusals.
- [x] Write the feasibility assessment and staged plan.

Prototype work:

- [x] Build a synthetic two-plane stack joined by a hinge, including a coupled-order case.
- [x] Extract material topology through an example without changing placement or fold semantics.
- [x] Prototype the vector QP and quantify useful gap versus shape distortion on seven cases and three profiles.
- [x] Preserve every material boundary subedge during triangulation.
- [x] Provide an interactive before/after viewer and inspect representative amounts and cameras.
- [x] Measure local order errors, edge strain, face warp, triangle reversal and detected transverse intersections.
- [x] Add six synthetic tests, including exact no-stack identity, refusal of unknown orders and rigid-frame covariance.
- [x] Add plane-local camera-dependent visibility correction and face-owned ink, with CPU/GPU checks.
- [x] Write the foundational renderer/picking/export implementation plan.

Product implementation, delivered 2026-11-03 under
[`ordered-3d-spread-rendering.md`](ordered-3d-spread-rendering.md):

- [x] Add the production material-topology source contract on the shared Rust/WASM boundary.
- [x] Review the example aesthetics with the user and expand the experimental amount range to 200%.
- [x] Test no-stack no-op, material boundary preservation, display-layer subdivisions and per-plane cycle fallback.
- [x] Define numerical acceptance limits and explicit unavailable/limited states.
- [x] Validate visibility and ink across preview, picking and vector/raster capture, documenting physical-depth precision ties.
- [x] Verify spread-off behavior and the transition through a tiny positive amount.
- [x] Integrate worker budgets, cancellation and stale-response protection.
- [x] Integrate controls, undo, schemas, save/reopen, project sharing, Diagram capture and analytics.
- [x] Run flat connected/depth/affine regression tests with the full web suite.
- [x] Run changed Rust crate tests and clippy, source/interchange tests and rebuilt WASM bridges.
- [x] Run web lint, typecheck, unit tests, production bundle and prerender checks.
- [x] Sweep seven examples across five amounts and front/back cameras, retaining ignored reports.

Follow-up research and platform coverage, outside the accepted visual-opening release:

- [ ] Add cross-plane contact constraints and re-evaluate the penguin/cylinder intersections.
- [ ] Quantify solver invariance under arbitrary material refinements beyond zero-angle display grouping.
- [ ] Extend the corpus beyond these review models and exercise native desktop/WebKit graphics.

Initial assessment validation: release builds and the twelve source-fold sample
runs above. Prototype validation adds the 21-case/profile solve sweep, six
passing synthetic tests, Rust example build/Clippy/format checks, JavaScript
syntax and browser interaction/visual checks. Full app tests, WASM rebuilds and
upstream parity were deferred during the prototype because it changed no
production behavior. Production validation is recorded in the renderer plan;
no upstream folding algorithm was changed. The prototype made the remaining
geometric issue concrete: local stack gaps alone do not protect spatial contacts.
