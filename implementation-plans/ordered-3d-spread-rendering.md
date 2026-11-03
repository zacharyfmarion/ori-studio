# Ordered rendering for 3D folded-figure spread

## Goal

Make a spread 3D folded figure obey its known layer order from the current
camera, with matching paper, crease lines, picking and exports. Keep all material
creases connected and retain geometric occlusion between unrelated surfaces.

This is the rendering implementation plan requested on 2026-11-03, following
the working numerical experiment in
[`connected-3d-layer-spread.md`](connected-3d-layer-spread.md). The user accepted
the opening aesthetic and requested the visibility correction that the flat
spread already provides. The prototype's maximum amount is now 200% of the
original displacement field. Production preserves that range, with 100% as
the initial amount; it is a drawing control, not a physical strain bound.

The prototype established the visibility policy. Production implementation is
delivered: a versioned material source and Rust/WASM vector solve feed
one mesh used by ordered GPU rendering, picking and settled capture. The
upstream fold and FOLD interchange geometry remain unchanged.

## Approach

### 1. Separate geometry from the intended drawing order

The initial prototype drew the deformed material mesh with an ordinary depth
buffer. Its QP has soft separation penalties, so a geometrically nearer layer
can still be the wrong visible layer. Changing the amount alone cannot correct
that drawing rule.

Flat spread already separates these concerns:

- `packages/layer-spread/src/visibility.ts` defines ranks/direct blockers,
  camera side and the CPU winner rule.
- `apps/web/src/cp-workspace/renderer/programs/spreadProgram.ts` implements
  rank bands or stencil masks, including the physical fallback for cycles.
- `packages/layer-spread/src/fragments.ts` supplies the vector/picking
  counterparts, with bounded clipping work.

For a spatial figure, use the known order only within its originating stack
plane. Applying one global rank across the model would bring unrelated rear
surfaces in front of nearer paper. Also keep three different concepts explicit:

| Fact | Authority |
| --- | --- |
| Which layer covers another within a stack | Determined kernel cell stacks and their source-plane orientation |
| Which unrelated spatial surface is nearer | Deformed triangle depth at this pixel |
| Which side/colour and shade a face shows | Deformed triangle winding and normal |

Visibility correction is allowed to override geometric depth for a witnessed
layer relation; it is not restricted to numerical depth ties. It does not
remove a geometric intersection. Continue reporting uncorrected geometric
diagnostics separately. Cross-plane contact constraints remain a separate
solver investigation, not a substitute for this rendering work.

### 2. Prototype delivered and its precise policy

The local viewer at `http://127.0.0.1:8743/` has **Enforce layer order**, on by
default, alongside the 0–200% slider. Turn it off to compare geometric depth.
Front/Back presets and orbit exercise the side reversal. Amount zero and the
no-stack control still use the original cell-skin buffers.

`scripts/layer-spread/spatial/solver.py::render_order` exports per-plane
lower/upper pairs with their source-cell witnesses, display-layer groups,
normals and origins. It only admits determined sources. `order.mjs` expands
zero-angle pieces into their display layer and constructs direct blockers.

For each pixel:

1. Determine each source plane's side with `normal · (eye - planeOrigin)`.
   This uses the actual perspective eye, not a global front/back flag or a
   triangle's warped normal. Use the deterministic front convention in a small edge-on band, shared by
   live views and cold captures. The reference also accepts an explicit previous
   side for future gesture hysteresis; production deliberately has no hidden
   camera history.
2. Reverse the local known pairs when viewing the opposite side.
3. Suppress a candidate wherever one of its known blockers on that plane is
   also projected there. A blocker counts by projected coverage even if another
   plane hides it. Never infer a relation through a blocker absent at the pixel.
4. Compare surviving candidates by their actual geometric depth.
5. Where a projected cycle suppresses every local candidate, retain that
   plane's physical baseline. Then compare it with survivors from other planes.

`renderer.mjs` implements this using a blocker stencil bit and a survivor-union
bit. The union records depth-failed survivors too: an unrelated foreground
plane must not make cycle fallback resurrect a buried layer in front of it.
All planes ultimately share geometric depth. Crease lines have material-face
owners and use the same blockers as fills. Arrangement and triangulation cuts
are never ink. Geometry, normals and solver results are unchanged by the toggle.

This deliberately reuses the *local-mask semantics*, rather than the flat
acyclic global ranks. Unrelated faces within one plane also retain geometric
depth; a transitive chain in separate cells does not invent a new direct pair.

**Prototype limit:** a witnessed pair currently applies to the whole source
display layer, including newly overlapping projected pieces. Cell witnesses
are retained but masks are not yet limited by cell-support polygons. Mutually
opposed cell-local relations therefore reach the cycle fallback. Decide and
test that support policy in phase A before promising general cyclic-model
compatibility. The prototype has no picking/vector export path, and its simple
line renderer does not yet implement the product's aux, hinge and pen policies.

### 3. Why the production 3D rendering boundary must change

`folded3dMesh.ts` builds `(cell, stack-slot)` geometry and two exposed skins per
plane. `foldedMeshSource.ts` chooses a skin and uploads static positions once;
camera changes are cheap redraws. This is a good unspread representation, but
a buried layer discarded by a skin cannot appear when the stack opens.

`folded3dScene.ts` already derives the vector picture from the same mesh. Its
all-layer slot ranges and ranks let `meshToPaperScene` order *coplanar* paper.
After deformation, those slots are no longer coplanar; a geometric BSP plus
the old coplanar rank cannot reproduce an intentional visibility override.
Replacing only the GPU renderer would make the screen disagree with export.

The needed foundation is an all-material mesh with stable provenance and one
visibility policy consumed by GPU, CPU picking and settled capture. Preserve
the existing shared worker/context, camera, paper style and mesh-to-scene work;
do not introduce a second independently built geometry for export.

### 4. Production delivery sequence

#### Phase A — Freeze the source and visibility contracts

Add a versioned, read-only spatial spread source at the CP session boundary:
material vertex IDs, face rings, unfolded/placed positions, crease/cut roles,
face and display-layer IDs, source planes and determined cell stacks. Reuse
the deterministic lowest-incident-face placement convention of
`folded_form_frame`; do not weld by folded coordinates or alter kernel closure
diagnostics. Provide equivalent WASM/native access.

Keep geometric, projected and semantic facts in separate records. Specify
`SpatialVisibility` with local pair witnesses, optional cell support, side
selection, survivor/cycle fallback and deterministic tie policy. Make one pure
CPU winner function the executable reference. Explicitly distinguish unknown
order from known cycles; unknown cells must not silently become an order.

**Chosen policy:** whole display-layer direct blockers, with cell witnesses
retained. Conflicting local witnesses use the documented per-plane cycle
fallback. Region-scoped masks are a future extension, not silently inferred.

Resolve the cell-support decision using synthetic woven stacks with opposite
relations in disjoint cells, zero-angle subdivisions and newly overlapping
regions. Start from the prototype's conservative direct-blocker rule. Retain
support provenance so an extension to region-scoped masks does not require
another mesh/schema rewrite. Do not borrow global ranks from another plane.

Exit: admitted source validation and CPU winner tests specify every pixel-level
decision, including cold captures near edge-on.

#### Phase B — Build one deformable material mesh and its ink

Add a material mesh representation beside the current optimized skins.
Triangulate whole material faces with every shared boundary subedge preserved.
Cell-derived render pieces must refer back to material triangles by IDs and
barycentric weights; duplicated render vertices must never become independent
solver variables. Carry face/plane/cell/slot provenance where applicable.

Evaluate `p = p_folded + amount * displacement` once per material vertex.
Interpolate render pieces from those positions and recompute deformed normals.
Map every crease and auxiliary-line segment to its owning material triangle(s),
splitting at triangle boundaries. Revisit the old skin-based hinge omission
rule: a newly uncovered layer can legitimately expose a formerly hidden bend.

Keep current source skins at spread off/zero until the replacement proves
pixel parity. Exercise the transition through small positive amounts. Keep
the rest frame fixed during a gesture; the first release preserves the existing
frame and camera zoom. Large openings can extend beyond it, so users can zoom
out rather than having each amount change recenter or resize the figure.

Exit: all buried layers can be revealed without cracks, invented cut edges,
arrangement ink, changed paper-side colours or divergent auxiliary lines.

#### Phase C — Add ordered visibility to the shared GPU worker

Extend `Folded3dMeshPayload` and `FoldedMeshSource` to hold rest geometry,
displacements, material ranges, provenance and local order. Add an amount
update without rebuilding/loading the mesh; orbit updates only projection and
per-plane side. The simulator's existing texture transport can carry posed
positions, but folded figures still do not need a running physical simulation.

Implement the shared winner policy through masks or an equivalent tested GPU
method. Preserve actual depth when compositing different planes. Keep all-mask
cycle fallback local to its plane, and apply the identical decision to ink.
Reuse stencil lanes/scissor/batching patterns where helpful, but do not import
the flat figure's global depth-band assumption. Explicitly own/reset GL state
so figures and simulator sessions sharing the worker cannot affect each other.

Bound face/mask work and memory; handle context loss, eviction, stale replies,
resize and cancellation. Keep the last correct settled image when preparation
is pending or a budget is exceeded, and report the unavailable state. Do not
silently switch an ordered figure to an incorrect geometric-depth drawing.

Exit: GPU colour/face-ID and crease coverage agree with the CPU reference over
camera/amount sweeps, and measured large-model costs fit the viewport budget.

#### Phase D — Make picking and export consume that same result

Project the same posed triangles and line pieces. Clip at the camera near plane
before perspective division. Keep perspective-correct barycentric material
coordinates for picks and annotations; interpolating screen weights directly
as material weights is insufficient.

Use the shared per-plane rule for picking. For vector capture, subtract known
blockers, resolve local cycle fallback and physical survivors, then resolve
geometric occlusion across planes. Adapt the bounded `visibleFragments` and
line-interval machinery rather than relying on BSP coplanar sorting after
deformation. Preserve hidden paper and source IDs for editable `PaperScene`
semantics; visible-fragment clipping alone must not erase that material.

Raster capture must use the live renderer's policy, style, camera and side
decision. Use the existing settled-capture lifecycle and bounded raster
fallback when vector complexity is too high. Check PNG, SVG/PDF and saved
Diagram pictures against the on-screen result, including crease widths and aux
lines. Picked material must be the material the user can see.

Exit: preview/pick/vector/raster parity, including cycles and unrelated
foreground surfaces. A geometry-only export is not a substitute for the
ordered drawing the user approved.

#### Phase E — Integrate the spatial solver and product lifecycle

Port the accepted coupled-vector solve under its own version, retaining the
existing flat solver and settings unchanged. Cache by material topology,
folded source, order solution and solver version. Amount/camera/style changes
must not solve again. Complete numerical acceptance and contact investigations
from the original plan; present limitations separately from visibility success.

Replace the unconditional `spatial` block in `foldedFigureSpreadBlock` only
after the complete render/capture path is ready. Add a distinct spatial recipe
to folded-figure storage and Diagram captures, preserving unknown versions and
the last saved picture through rehydration. Cover undo, refold, next ordering
solution, save/reopen and share. Keep actual FOLD interchange geometry intact.

Use existing action catalogs, concern hooks, controls/CSS modules and central
analytics conventions. Initially scope to opaque Paper. Define X-ray and
wireframe behavior explicitly before exposing spread there; neither can inherit
opaque masking blindly. Simulator meshes and fold animation remain separate.

### 5. Acceptance and validation

Synthetic gates: inverted geometric order; opposite-side and edge-on cameras;
offset planes under perspective; independent foreground/background; no blocker
present; zero-angle subdivisions; partial and all-masked cycles; a cycle whose
survivor is occluded by another plane; buried crease/aux lines; cuts; exact zero
and no-stack identity; near-plane clipping; stable material picking and ties.

External review: joined strip, waterbomb, three-plane stacks, spikes, penguin,
kirigami cylinder and separated rectangles, at 0, tiny positive, 25, 100 and
200%, across presets and continuous orbit. Unknown-order airplane and unclosed
source remain explicit refusals. Report geometric failures separately from
visibility failures. Keep private corpus files and generated results ignored.

Prototype validation: seven Python geometry/source tests, six Node policy tests
and eleven real WebGL pixel checks, plus interactive review of model selection,
amount, order toggle and front/back cameras. Production checks are phase gates:
focused Rust/source tests, rebuilt changed WASM bridges, web lint/typecheck/unit
tests, worker/bundle build coverage, renderer/export parity and browser/Tauri
checks. Run upstream oracles only if ported semantics actually change.

## Affected Areas

| Area | Responsibility |
| --- | --- |
| `crates/oristudio-cp/src/folding3d/`, CP session, WASM/native clients | Material source, stable identity, local stacks and diagnostics |
| `crates/oristudio-layer-spread*` | Separate spatial solve/version and numerical acceptance |
| `packages/layer-spread/src/` | Spatial visibility contract, CPU winner, projected clipping and material mapping |
| `apps/web/src/cp-workspace/folded/folded3dMesh.ts`, model reader/aux modules | Material mesh, per-piece provenance and owned ink |
| `apps/web/src/simulator/foldedMeshSource.ts`, `simulatorSession.ts` | Shared GPU rendering, amount updates, resources and visibility passes |
| `useFolded3dMeshRuntime.ts`, `folded3dWindow.ts`, `Folded3dWindowLayer.tsx` | Concern-scoped runtime wiring and frame delivery |
| `folded3dScene.ts`, Diagram pictures, settled captures | Shared geometry, picking and render/export parity |
| Figure settings/stores and project/share extensions | Availability, recipes, undo, rehydration and compatibility |
| `scripts/layer-spread/spatial/` | Reproducible prototype and independent reference/GPU checks |

## Checklist

- [x] Confirm the initial prototype lacks the flat spread's visibility correction.
- [x] Trace current flat masks and production 3D skin/scene/worker boundaries.
- [x] Export plane-scoped orders and cell witnesses into the prototype.
- [x] Add camera-conditioned fill and crease masks, cycle fallback and comparison toggle.
- [x] Keep 200% maximum and add a Back view preset.
- [x] Validate the pure policy, source adapter and real GPU pixel decisions.
- [x] Phase A: freeze spatial source/visibility contracts and the cell-support policy.
- [x] Phase B: implement the shared material mesh, provenance and ink mapping.
- [x] Phase C: integrate ordered GPU rendering in the existing worker with budgets.
- [x] Phase D: validate picking, editable scene, vector and raster against the shared policy.
- [x] Phase E: integrate versioned solve, availability, persistence and controls.
- [x] Record numerical/contact acceptance separately from drawing correctness.
- [x] Run production checks and the external camera/amount/performance sweeps.

### Delivery notes and limits

The replacement material renderer is used for positive spatial spread in Edit
and Diagram. Off and exact zero retain the optimized skin renderer for existing
pixel parity. The material source is additive and shares the FOLD export weld;
the fold solver, closure verdict and interchange positions are unchanged.
Spatial spread is available for determined, closed 3D folds in opaque Paper.
X-ray and wireframe retain their existing rendering and keep the recipe dormant.

The `spatial-vector-v1` Rust/WASM solve caches one vector per material vertex.
Amount changes only the GPU displacement uniform; camera changes only camera
and plane-side selection. Source/auxiliary changes rebuild the material mesh.
Separate cancellable capture workers produce settled scenes; stale camera and
mesh replies close their bitmaps without overwriting a newer frame. A store
subscription settles unwindowed figures too, and save waits for the current
recipe's picture. Versioned recipes survive reopen and unknown future recipes
remain preserved. A reopened figure retains its picture until refold.

Vector clipping and GPU masking share whole display-layer direct blockers.
Conflicting witnesses use per-plane physical fallback; there is no inferred
order across planes or through absent intermediate faces. Raster capture uses
the same GPU path. Diagram and exports can use a bounded PNG when vector work
exceeds budget. **Edit's native folded-picture schema currently stores only
faces and lines:** it explicitly refuses an over-budget changed picture and
retains the previous one, rather than persisting arbitrary markup or claiming
that an old picture represents the new recipe. All seven review examples fit
the vector budget. Typed persisted bitmap pictures are a separate follow-up.

The original numerical experiment documented intersections on penguin and
cylinder, and the renderer does not remove them. At 200%, the UI scales the
accepted unit displacement; it does not rerun the QP at doubled constraints.
The geometry is intended for illustrations, with no collision-free or rigid
paper guarantee. Contact-aware constraints and region-scoped masks remain
future numerical/visibility extensions.

Validation includes changed Rust crate tests and clippy, rebuilt WASM, the full
web suite, the visibility and simulator package suites, lint, typecheck, i18n,
production bundling and landing prerender. The standalone browser harness uses
the production shaders and workers: nine synthetic pixel cases and seven real
models across zero, tiny positive, 25%, 100% and 200%, front and back. Interior
face-ID comparisons separate near-contact physical depth ties from ordering
errors: four sampled cylinder pixels differed between CPU arithmetic and GPU
raster depth at independent near-coincident surfaces; none violated a known
blocker. This is not a claim of bit-exact depth at intersections. Save/reopen
was also exercised in the actual Edit app at 200%, preserving recipe and scene.
Private source files and reports remain under ignored `artifacts/`.

Upstream oracles were not rerun because ported folding semantics were not
changed; the material source is tested against the existing FOLD interchange.
Unrelated Rust workspace crates and the native desktop shell were not rebuilt:
the changed behavior runs in the shared frontend/worker, with no native command,
menu, filesystem or packaging changes. Browser graphics checks ran in Chromium;
Safari/WebKit and native desktop GPU behavior remain CI/manual review coverage.
