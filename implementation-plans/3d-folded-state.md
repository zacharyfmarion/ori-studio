# 3D folded state from `G`

## Goal

Press `G` on a crease-pattern selection whose creases carry non-180° fold angles
and get a **computed** 3D folded state — placement plus, where it exists, a layer
ordering — rendered as a folded figure on the CP canvas, with the same
solution-cycling verb the 2D folded figure already has. This replaces the
"This pattern isn't flat-folded … Simulate?" punt at
`apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:1615`.

Computed, not simulated: a linear-time rigid walk over the dual-graph spanning
tree, not a mass-spring relaxation. The simulator stays where it is.

This plan continues [`non-180-fold-angles.md`](non-180-fold-angles.md), which
shipped the fold angles this reads, and rests on
[`research/2026-08-07-3d-fold-feasibility.md`](../research/2026-08-07-3d-fold-feasibility.md).
Section references below (§1c, §2b, §5.1 …) are to that research doc; read it
before this one. Nothing here restates it.

### The precondition, stated first because it bounds everything

**This works only on crease patterns that already carry fold angles, and fold
angles cannot be recovered from a pattern that lacks them.**

Not "hard" — **ill-posed** (§1c). Of nine ingress paths, six carry no angle at
all: `.cp` is five tokens per line with four assignment codes, `.ori`/`.orh`/
`.dxf`/`.obj` write seven fields with no magnitude, TreeMaker manufactures ±180
from assignment, Box Pleating Studio has no magnitude concept, and CP detection
emits an assignment head only. Three carry angles — FOLD import, `.osf`, and
share links — and all three are ours. And for representational origami the
folded form is not a function of the crease pattern at all; Lang says so
directly. No algorithm recovers what the input does not contain.

Two measured consequences to hold in view:

- Exactly **2 of 33 tracked `.fold` files** carry a non-classic angle, and both
  are 14-edge single-vertex fixtures written for the fold-angle feature itself
  (`tests/fixtures/fold-angle/valid-waterbomb-vertex.fold`,
  `self-intersecting-vertex.fold`). **There is no multi-face 3D-angled model
  anywhere in this repo.** Phase 2 exists because of this.
- The population that *does* carry angles is the one non-180's own workflow
  creates: transcription — "the user folds a model by hand, then draws the
  crease pattern for it. They already know the angles"
  ([`non-180-fold-angles.md:264`](non-180-fold-angles.md#L264)). A corpus scan of
  downloaded files cannot bound a workflow whose primary path is typing, which is
  why Phase 1's analytics event ships first and alone.

For a pattern without angles, `G` keeps doing exactly what it does today. The
flat fold is the only computable answer, and it is already correct.

## What `G` does after this lands

Decided on the **scoped foldable line ids** — never on the document. `G` folds a
selection; a document-wide predicate silently gets row (b) wrong.

| # | Selection | Rest of document | Behaviour |
| --- | --- | --- | --- |
| a | all classic | all classic | Flat fold, byte-identical to today |
| b | all classic | contains non-classic creases | **Flat fold, byte-identical to today.** The arrangement is built only from the scoped segments, so the non-classic creases elsewhere are not in it |
| c | all non-classic | any | 3D fold |
| d | mixed classic + non-classic | any | **3D fold.** The classic creases are ±180 within it, which the placement handles by construction. A box with flat-folded flaps is the expected shape of a real design, not an edge case |
| e | no foldable lines at all | any | Today's message: "Select one or more foldable crease-pattern lines first" |
| f | non-classic, but an incident vertex is indeterminate | any | `Indeterminate(VertexIndeterminate)` — a named, translated verdict; not a silent empty figure |

Row (b) is the one that matters most and is easiest to break. `is_classic_crease`
(`crates/oristudio-cp/src/model/mod.rs:543`) is per-segment;
`has_non_classic_creases` (`:551`) is document-wide and **must not** be the
routing predicate. A slice-taking sibling is needed.

Three doors reach the folder, not one. `foldOristudioCpDocument` is the obvious
one; `refoldOristudioCpFoldedFigure` (`creasePatternSlice.ts:2041`) reselects
lines and calls the runtime with **no** non-classic check, and
`foldAnotherOristudioCpFigure` (`:1795`) re-runs on an existing handle. A figure
folded flat, then given angles, then refolded — including an automatic stale
refold — reaches the flat kernel with non-classic creases in scope. All three
dispatch identically or the fix is not a fix.

There is also a kernel-side widening to close: `folded_figure_fold_selected`
(`crates/oristudio-cp/src/session.rs:552-558`) falls back to folding the **whole
document** when the selection resolves empty, and the store's empty guard at
`creasePatternSlice.ts:1596` is the only thing preventing it. In 3D the blast
radius is larger — an expensive whole-document fold that may refuse for reasons
the user cannot connect to their selection. Make it an explicit error on the 3D
path.

## Merge criteria

The governing rule is [`non-180-fold-angles.md:33`](non-180-fold-angles.md#L33):
*an end user must never be able to reach an inconsistent state.*

Here the inconsistent state is not "the feature is incomplete." It is **`G`
produces a 3D figure that is wrong, or that shows a stacking it never computed,
and says nothing.** Every failure mode measured for this feature has that
signature — a plausible-looking picture with no error:

| Measured silent failure | Where |
| --- | --- |
| The flat pipeline returns Step5 / 1 solution / no contradiction on a (−90, +180, +90) strip, because nothing in `folding.rs` or `fold_graph.rs` reads `fold_magnitude` | §5.1's counterexample |
| A face id past `faces_total` makes `possible_overlap_search_for_subfaces` report `found = true` with an **empty** ordering — `cell_index` returns `None` and `set_above`/`infer_above` treat that as a no-op | `folding.rs:4331` |
| A disconnected face graph leaves unreached faces at position 0 with `associated_line: None`, so `fold_movement` returns them **unfolded**; above ~200 faces the Euler gate stops catching it | `fold_graph.rs:164`, `:200-202` |
| `HierarchyTable::from_initial` does `let _ = table.infer_above(...)`, so two contradictory seeds make the first win and the second vanish | `folding.rs:4326` |
| `subface_top_stack` drops a tied face into a hole and the caller falls back to an arbitrary `face_ids.first()` | `folding.rs:3875` |
| Geometry the Euler gate rejects returns `Ok` at Step1 with `status: 'ready'` and no message, because `isDrawableFoldResult` is only called on the refold path | `creasePatternSlice.ts:688` vs `:2093` |
| `bsp.ts` promotes the splitter to the front of its own coplanar list, and `sortCoplanar` sorts on `kind` alone, so coplanar faces emit in caller input order | `bsp.ts:253`, `:277` |

None of these is caught by looking, and the automated browser pane runs with
`visibilityState=hidden` and zero rAF, so canvas repaint cannot be
agent-verified at all. That is why the work is sequenced kernel-first: every
load-bearing claim is a number or an enum `cargo test -p oristudio-cp` can
assert.

**Phases 2–8 all land on one branch before it merges.** No flag, no experimental
label. The phases are work order, not release order. Removing any one produces an
inconsistent state: without Phase 4's census the render invents a stacking three
different ways; without Phase 7's i18n `npm run i18n:check` fails CI outright;
without Phase 8 a saved 3D figure either never goes stale or reads back as a
refoldable flat one.

**Phase 1 ships alone and first**, on its own PR, ahead of everything. It is pure
flat-path correctness plus instrumentation — two measured live bugs in shipped
code and the analytics event that buys the one number nobody has.

**Phases 9–11 follow separately**, because their absence subtracts rather than
corrupts: without layer ordering a figure with coplanar overlap *says so*;
without enumeration the cycling verb is correctly disabled; without the FOLD
`foldedForm` frame the figure still exports SVG/PNG.

### What the merge set delivers, honestly

**Spike C has been run, and it retires this section's premise.** The census is
**not** zero on 3D models generally. It is zero exactly when the document
contains **no crease at ±180 at all** — 18 of 18 admitted models, no exceptions
either way. Every full fold lays two faces into one plane on the same side of
their shared edge, so it contributes at least one overlapping pair by
construction; the count of full folds is a lower bound on the census that needs
no placement to compute, and it held on 18 of 18. See "Phase 0 findings".

So the honest split is not 3D-versus-flat, it is **no full fold** versus
**any full fold**:

- A pure polyhedral net — `cubeunwrapping`, 6 faces, 5 creases all at ±90, zero
  full folds — measures **0**. Complete, provably, opaque.
- A box **with flat-folded flaps** — the repo owner's own `tooling/base_fixed`,
  11 faces, 6 creases at 90° and 7 at ±180 — measures **17**. This is the case
  the plan called census-0 and it is not.

The largest admitted model measuring 0 has **6 faces**. Every model above 8 faces
in the corpus measures non-zero. Phase 9 therefore moves **into the merge set**;
§7's open question about constraint-component structure is no longer what decides
it.

### Three things that must not be split across the merge boundary

- **The parity-locked engine surface.** `CP_ENGINE_COMMANDS`
  (`session.rs:37-74`, 39 names today), the wasm bridge, the worker, the native
  client, `NATIVE_CP_COMMAND_NAMES` and the Tauri registration, **and the
  committed `.wasm`** — one commit, or CI fails and desktop silently diverges.
- **The routing predicate and all three doors** (above). Splitting them leaves a
  live path into the flat kernel with non-classic creases in scope.
- **Every new inline-English string with its eight locales.** `i18n:check` is a CI
  gate.

## Approach

### 1. Placement: reuse the walk, replace the mirror

`FoldGraph::face_positions` (`fold_graph.rs:126`) already builds the dual-graph
spanning tree and `fold_movement` (`:381`) already walks it. The only flat line is
`find_line_symmetry_point` at `:389`, a 2D mirror. The 3D version composes a
signed rigid rotation about the crease axis in *unfolded paper* coordinates.

```rust
// crates/oristudio-cp/src/folding3d/placement.rs
pub(crate) fn place_faces(
    graph: &FoldGraph,
    starting_face_id: i32,
) -> Result<Placement3d, Placement3dError>;

pub(crate) struct Placement3d {
    pub face_transforms: Vec<Rigid>,
    /// Per face, its own image of its own vertices. Deliberately not a shared
    /// point array — see below.
    pub face_points: Vec<Vec<Vec3>>,
    pub face_normals: Vec<Vec3>,
    pub positions: FacePositions,
    pub loop_gap_radians: f64,
    pub loop_offset: f64,
    pub worst_loop_edge: Option<usize>,
}

pub(crate) enum Placement3dError {
    NoFaces,
    DisconnectedFaceGraph { reached: usize, unreached: usize },
    UnassignedCrease { line: usize },
}
```

Four things this signature encodes:

**Per-face point images, never a shared array.** `folded_points`
(`fold_graph.rs:104-124`) sums `fold_movement` over incident faces and divides.
In 2D a mirror maps the plane to itself so residual stays in-plane and is
re-absorbed; in 3D the same residual becomes out-of-plane displacement, and
averaging is exactly the operation that destroys the evidence (§1a). There must
be nowhere to average.

**The angle is `crease_fold_angle`, applied directly.** `crease_fold_angle`
(`model/mod.rs:527`) returns the FOLD angle — 0 unfolded, ±180 fully folded — and
the shipped `crease_quat` (`checks_spatial.rs:112-120`) applies ρ directly. `π − ρ`
is excluded: a classic crease would rotate by 0 or 360° and not fold at all. The
research doc's §1a writes `π − ρ` using ρ as the *dihedral* angle; the two
symbols are supplementary, and the kernel's is the one that matters. **Settled —
do not relitigate.**

The signed magnitude is recoverable during the walk because
`FoldGraph::from_segments` (`fold_graph.rs:45-56`) pushes one `GraphLine` per
input segment in order and keeps `segments: segments.to_vec()`, so
`associated_line[child]` indexes both.

**Reuse `checks_spatial`'s quaternion primitives verbatim** — `Quat` (`:110`),
`Vec3` (`:180`), `axis_quat` (`:128`), `quat_mul` (`:138`), `quat_rotate`
(`:182`), all `pub(crate)` and reachable from a sibling module. Placement and the
admission gate must share one handedness, or the gate certifies states the
renderer draws mirrored.

**Disconnection is a typed error**, detected as `face_position[f] == 0` for
`f != starting_face` immediately after the BFS returns. Today `:164` breaks out on
an empty frontier and the unreached faces come back unfolded, and the only
backstop is `initial_hierarchy_from_graph`'s parity abort — the check §3b requires
deleting. Land this on the **flat** path too, in Phase 1: it is a latent
silent-wrong-answer in shipped code.

#### Pinning the convention

What is genuinely open is the **axis direction** and the **composition order**,
and the fixture that settles them is not the obvious one:

- At exactly ±90°, `R(ρ)` and `R(π − ρ)` are the same rotation (measured
  0.000e+00 and 3.331e-16), so a 90° test cannot discriminate. Use **60° or 120°**.
- With **one** crease, every composition scheme agrees exactly. With two at
  (90, 90), a left-multiply scheme mirrors the model. Use a **3-face asymmetric
  chain**.
- `vertex_link_polygon`'s doc comment (`checks_spatial.rs:222-231`) is a written
  post-mortem of exactly this error: right-multiply vs left-multiply agree to
  1e-14 on a *symmetric* fan and diverge by up to 74° on an asymmetric one, and
  `tests/spherical_simplicity.rs:80-88` opens by saying its fans are deliberately
  asymmetric for that reason.

The strongest available check is not a new test at all: **assert the new
placement reproduces the already-tested `vertex_link_polygon` on one
interior-vertex fan**, reusing a tested authority rather than minting a second
convention that can drift from the gate.

### 2. Admission: reuse the check the flat path already makes

```rust
// crates/oristudio-cp/src/folding3d/admit.rs
pub fn admit(
    model: &CreasePatternModel,
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Admission, Fold3dRefusal>;
```

In order:

1. **Flat snap.** Any |ρ| within the snap window of 180° becomes exactly ±180 —
   **in the session's own copy of the segments, never written back**. Snapping
   179.9 to 180 in the document would silently destroy a user's angle. This is not
   an optimisation: the constraint *type* is discontinuous at 180° (unary
   wall-forcing below, binary taco-tortilla at, §4.3), so an unsnapped near-flat
   crease makes the 3D command disagree with the shipped 2D `Fold` on a nominally
   flat document. It is sound because a 180° rotation about a line in a plane maps
   that plane to itself exactly.

2. **`checks_spatial::dispatched_camv`** (`checks_spatial.rs:1048`) — **not**
   `spatial_vertex_reports` (`:864`), which filters to
   `vertex_regime == Spatial && is_interior_vertex` and would silently ignore every
   flat vertex of a mixed pattern.

3. **`place_faces`**, propagating its typed errors.

4. **Loop gap — reported, not gating in v1.** Multiply-connected paper is
   unreachable through every ingress: `calculate_faces` (`fold_graph.rs:180-204`)
   traces every positive-area bounded region, so a drawn ring comes back with its
   hole *filled*; and `import_fold_document` (`io/fold.rs:174`) reads only
   `edges_vertices` — `faces_vertices` is written on export and never read on
   import. On a disk the loop gap is an algebraic consequence of per-vertex
   closure (§2b T1). Compute it, display it, and assert under `#[cfg(test)]` that
   it stays below the closure bar on every fixture. That converts
   `non-180-fold-angles.md:854`'s open item into a monitored invariant.

5. **Plane separation as a spectrum-gap test, not a minimum.** The naive metric
   cannot gate. Measured two ways: computed on the same perturbed state that
   produced the loop gap it returns ratios of 0.0066 / 0.0056 / 0.0020 — the
   window *inverted*, because the 4–6 decades in §2c take the numerator from the
   exact state and the denominator from the perturbed one. And on a real flat base
   shaped in 3D it returns `+inf` with a perfect hinge (zero parallel distinct
   pairs, certifying nothing) or per-layer drawing blur below `Epsilon::POINT`
   (2.5e-4, `geometry/epsilon.rs:24`) with a realistic one — 122 of 153 pairwise
   gaps at 90°, 153 of 153 at 30°. Instead: **classify coplanarity by topology
   first** (faces joined through exactly-180° creases are coplanar by
   construction, which on a flat base classifies most of the model for free),
   then sort the remaining parallel-plane separations and require a gap wide
   enough to seat `dist_tol`. Report the gap width.

**Three dimensionally distinct tolerances**, carried in `Fold3dDiagnostics` and
inspectable: `ang_tol` in radians on normals (scale-free), `dist_tol` relative to
paper span, `len_tol` in length. One distance tolerance is wrong because
within-CP crease-length range on real CPs is p50 24× / p90 79× / max 221× (§4.4),
implying a critical fold angle varying two decades inside one document.

**No user-facing tolerance control, ever.** None exists anywhere in the app today
(`settingsStore.ts` has no epsilon of any kind), and the right value depends on
computed plane separation — information the person being asked does not have.
Non-180 already rejected per-provenance thresholds because "provenance is not
durable"; a per-document dial is the same mistake. Report the number on the
verdict; never offer the dial. All thresholds live in **one const block** beside
`CLOSURE_RESIDUAL_BAR_DEGREES` (`lib.rs:2867`), not in TypeScript — splitting
policy across the wasm boundary breaks the "revising it is one constant" property
that motivated the rule.

#### What the gate can and cannot read

`CheckCamv` is an `OperationId` (`lib.rs:483`) routed through the generic
`execute_cp_command`, **not** a `CP_ENGINE_COMMANDS` entry — so reading its
diagnostics costs none of the five-site parity tax. Verified by execution: a
mixed document returns `CheckCamv` and `SpatialClosure` entries side by side in
one `diagnostic_entries` array, both kinds runtime-distinguishable, and both
literals are present in the tracked `.wasm`.

But a spatial entry is `{id, kind, message, point, rule, severity}` — `segments`
is dropped by `skip_serializing_if = "Vec::is_empty"` (`lib.rs:245`). **Membership
in the selection cannot be recovered from an entry.** So a selection-scoped 3D
gate needs either a new selection-taking kernel check or frontend geometric
re-derivation from a bare point. Phase 0 decides which; see Open decisions.

**Do not re-scope the existing pre-fold CAMV gate.** Its document-wide scope is
verbatim Oriedita: `FoldAction.java:36` runs
`Check4.apply(mainCreasePatternWorker.getFoldLineSet())` with no selection filter
while `FoldingServiceImpl` dispatches `FOR_SELECTED_LINES_2`. The divergence
budget allocates **none** to `checks.rs` and every Oriedita operation. Narrowing
it would also make the modal say "no errors" while the always-on overlay, which
runs the identical unscoped call, draws violation glyphs beside it. The 3D
preconditions are a **new, additive** surface.

### 3. Where layer ordering lives, and why constraints do not decompose

Layer order is defined only where paper coincides with paper, so the ordering
**variables** are exactly the coplanar-overlap pairs and they do partition by
plane. This is why 3D is smaller than flat per instance: a flat folding is the
degenerate case where one cluster holds every face.

**But the variables partitioning does not make the problem partition (§5.1).**
Taco/tortilla constraints are generated by pairs of overlapping *edges*, and
nothing in that derivation requires the four faces to be mutually coplanar. Two
creases can have coincident folded images while their faces occupy different
planes. The measured counterexample is a 1×4 strip at (−90, +180, +90) — "fold in
half, then bend the doubled stack" — where creases c1 and c3 land on the identical
3D line, so A/D (coplanar, z=0) and B/C (coplanar, x=1) are two tacos wrapping one
line and their order variables couple across planes. Per-cluster solving returns a
definite answer and is wrong half the time, silently. Union-find on the resulting
equalities does not restore decomposition; it renames the coupling.

**The solving unit is the connected component of the constraint graph, and it can
span every plane in the model.** Measured on Kabuto (18 faces, flat): 117
ordering variables in components `[81, 18, 18]` — the largest is 69% — with
transitivity at 420 of 529 constraints (79%).

Two consequences the plan is built around:

- The **census** (Phase 4) counts variables, which is sound, and is therefore a
  *lower bound on where ordering matters* — never a claim that the planes are
  independent.
- The **solver** (Phase 9) must key on constraint-graph components. Coupling is
  also not expressible as an `EquivalenceCondition`: `apply_quadruple_condition`
  (`folding.rs:4539-4583`) reads above/below cells in one frame, but "above" for a
  face in plane P is relative to `up_P` and in Q to `up_Q`, and P and Q share only
  a line. The real condition is non-interleaving of four half-planes in cyclic
  order around that line — a different constraint kind. **v1 detects coupling and
  refuses**, loudly, rather than answering definitely and being wrong.

**No acyclicity assertion, anywhere, and no topological sort (§5.4).** A cyclic
panel order is legal: He & Guest name the classical square twist with
`a > b > c > d > a`, and all four panels are coplanar and overlap-connected so
they land in one cluster — "per cluster" does not save the assertion. What *is*
required is antisymmetry and **determinacy**: every intra-cell pair decided, and
undetermined pairs reported rather than tie-broken. Resolution is **per
arrangement cell**: on pinwheel geometry the largest simultaneously-overlapping
subset of the four bars is 2, so every cell has a well-defined winner even though
no linear order exists.

### 4. The census, and why the merge set avoids the arrangement entirely

The load-bearing reuse claim from the research — that per-plane splitting lets
the shipped `prepare_subface_segments` → `FoldGraph::from_segments` →
`configure_subfaces` chain run unchanged on projected coordinates — is
**measured false**. `calculate_faces`'s Euler gate
(`euler == 1 || (euler - 1).abs() <= 0.005 * faces.len()`, `fold_graph.rs:200-202`)
rejected **4 of the 6 multi-face plane patches** across six elementary 3D forms —
a one-step offset pleat, a two-step offset pleat, and a bridge/tuck. Per-plane
splitting makes the gate *stricter*, since the 0.005 tolerance needs ~200 faces in
one plane to open, and all 70 accepted patches yielded exactly one subface.
`face_request` also returns the moment `face.contains(&next_point)`
(`fold_graph.rs:238-241`), so it structurally cannot trace an annular cell; a
nested tongue landing back in its own base plane needs *two* injected cuts.

The merge set sidesteps this completely, and that is the whole reason a smaller
increment is honest here:

**The census is a direct polygon clip-and-area count on projected face polygons.**
It needs overlap detection, not cell decomposition, so it never calls
`calculate_faces`. Its output is:

```rust
pub struct Fold3dCensus {
    pub plane_count: usize,
    pub patch_count: usize,
    pub overlapping_pair_count: usize,
    pub undetermined_patches: Vec<PatchId>,
}
```

- `overlapping_pair_count == 0` → every face is trivially its own cell. No
  arrangement, no `SubFace`, no hierarchy is needed to draw a **provably complete**
  picture. Render opaque.
- `overlapping_pair_count > 0` → the stacking is undetermined until Phase 9. Say
  so, render translucent, and name the pairs.

**Free cross-check:** on an all-180 document the census must agree with
`treemaker-flatfold`'s own ordering-variable count. `build_variables`
(`crates/treemaker-flatfold/src/constraints.rs:202`) is a BFS over the cell graph
seeded at `cells_faces.first()`, so it is not literally *all* overlapping pairs —
assert agreement on the component reachable from cell 0, or measure the gap
first. Two independent implementations of one quantity is the strongest check
available and it uses a crate already in the workspace.

### 5. Rendering: projected primitives on the CP canvas

**Decision: the kernel emits a view-independent 3D payload; TypeScript projects
it into the existing 2D primitive stream; the CP canvas draws it unchanged.**

```rust
// crates/oristudio-cp/src/folding3d/model.rs — view-independent, camera-free
pub struct Folded3dRenderModel {
    pub faces: Vec<Folded3dFace>,   // 3D ring + fill colour + plane id
    pub edges: Vec<Folded3dEdge>,   // 3D endpoints + colour + kind
    pub planes: Vec<Folded3dPlane>, // normal, origin, up, face ids
}
```

```ts
// apps/web/src/cp-workspace/folded/foldedFigure3dProjection.ts
export function projectFolded3dModel(
  model: OristudioCpFolded3dModel,
  camera: FoldedFigureCamera
): OristudioCpFoldedRenderSnapshot;
```

Why the canvas needs **no renderer change**: `fillProgram.ts:91` runs
`depth: { enable: false }` with source-over blending and `cpFoldedToScene.ts:335`
sorts primitives by `sequence`, so painter's order already travels entirely
inside the primitive stream, and `fill_path` + `stroke_path` cover every
primitive a projected mesh needs. Placement, hit-testing, the floating toolbar,
auto-placement, staleness, `.osf`, the share-modal gate and SVG/PNG export are
all inherited unchanged.

Four already-tested, DOM-free modules do the work: `camera.ts:112`
`projectVertices` (the CPU mirror of the mesh vertex shader), `bsp.ts`
`buildBsp`/`traverseBsp`, `hiddenPieces.ts:65` `findVisiblePieces`, and
`coplanarRuns.ts`. All four run under bare node today.

A BSP is still required even with no coplanar overlap: three faces can cycle in
*depth* (A over B over C over A) with no pair interpenetrating, and no sort
expresses that (`bsp.ts:1-9`). Division of labour: the census/ordering resolves
intra-plane, the BSP resolves inter-plane.

**Do not feed a whole plane as one `BspItem`.** `fan()` (`bsp.ts:140-148`)
fan-triangulates split pieces as convex and `planeOf` takes the first three
points, so a non-convex multi-face decal fed as one item is mis-split. Feed
faces. And pass the coplanarity tolerance to `buildBsp` rather than relying on its
hardcoded `EPS = 1e-7` (`bsp.ts:67`) — two planes the kernel splits at 1e-8 land
in one `coplanar` list where the splitter-promotion at `:253` then applies.

Per-frame budget, measured on an M1 Max under node: at 484 items (Mooser's-Train
scale) project 0.06 ms, `buildBsp` 4.71 ms, traverse 0.04 ms, earcut 0.19 ms,
total 5.04 ms; 12.1 ms at 1024 items; crossing 16 ms near ~1265. `buildBsp` is
93.5% of the frame and is **eye-independent at `edgeInk = 0`** — its `eye`
argument reaches only `nearIsFront`, consulted solely in `partition`'s
`eps > EPS` branch — so it hoists out of any future orbit loop. Do **not** inherit
`svgRenderer.ts:187`'s screen-space ink tolerance on the canvas path; it
reintroduces view-dependence and voids the hoist. Carry a piece-count guard with
a tested refusal path.

**Rendering an undetermined stack: per-face translucency in the projector, not a
kernel display style.** The tempting answer is Oriedita's `Transparent3`. It does
not work: `needs_subfaces` (`folding.rs:2112-2115`) includes `Transparent3`, so
that style requires `folded_subface_graph_and_config` — the arrangement the merge
set is specifically avoiding. Draw translucent per-face fills with the
undetermined faces flagged, reusing the contradiction overlay's translucent-red
vocabulary (`cpFoldedToScene.ts:495`) generalised from a pair to a list with a
reason tag.

Two smaller notes. `Development1` and `Development4` need **no** 3D reading:
measured, both emit zero primitives (`folding.rs:3034-3076` has arms only for
`Transparent3` and `Paper5`), matching upstream `FoldedFigure_Drawer.java`, and no
Oriedita file can carry a display style — `FoldedFigureModel.java` has no such
field. The 3D dispatch inherits the same no-op arm. And per-plane flat shading
from the plane normal (reusing `lightIntensity`, `svgRenderer.ts:515-552`) is
needed, or two parallel planes at different depths render as one flat silhouette;
keep Oriedita's shadow bands only for intra-plane edges, where they remain a real
stacking cue.

#### Rejected: an inline 3D canvas-object window

Adapting `addOristudioCpInlineSimulation` into a fourth canvas-object kind was
the alternative. It is rejected on four counts:

1. **It re-implements solution cycling**, which is exactly what the user asked not
   to happen. `buildFoldedFigureActions` would not apply.
2. **Its existing analogue costs 814 lines** (`InlineSimulationLayer.tsx` 608 +
   `InlineSimulationInspector.tsx` 206), plus 14 id-kind dispatch sites in
   `CreasePatternPanel.tsx`, which already sits under a raised `max-lines` cap.
3. **It adds a capability gate.** `InlineSimulationLayer.tsx:588` renders
   "Needs WebGL2 — open in the Simulate workspace"; a folded figure that sometimes
   cannot be shown is a worse product than one that always can.
4. **A folded figure would become two different object kinds depending on its
   angles**, so the flat figure's toolbar, context menu, staleness and export
   would not apply to half of them.

The camera is fixed and kernel-chosen in the merge set. Orbit is Phase 10.

### 6. Solution cycling — behaviourally identical to 2D

The 2D canvas surfaces **exactly one** solution verb. `buildFoldedFigureActions`
(`apps/web/src/cp-workspace/folded/foldedFigureActions.ts:216-229`) derives:

```
hasNextSolution = snapshot.find_another_overlap_valid === true
wrapsToFirst    = !hasNextSolution && (snapshot.discovered_fold_cases ?? 0) > 1
disabled        = !ready || (!hasNextSolution && !wrapsToFirst)
label           = wrapsToFirst ? 'Back to first solution' : 'Another solution'
```

Three things follow, and the 3D path matches all three:

- **No `fold_to_case` on the canvas.** Correcting a common misreading: it is not
  part of the CP canvas's cycling UI at all. `foldToCase` is reachable only from
  the crease-export/share dialog (`lib/creaseExportFold.ts:267` via
  `projectSlice.ts:527`). Adding it would give the 3D figure an affordance the
  flat one lacks.
- **No "k of N".** `discovered_fold_cases` is a forward-only high-water mark that
  resets to 1 after a wrap (`restart` zeroes the whole `FoldingEstimate`), and the
  kernel does not know N until the enumeration is exhausted. The flat UI renders
  "Case {n}" with no denominator (`CreasePatternPanel.tsx:598`).
- **The wrap must stay repeatable.** `restart` re-derives
  `find_another_overlap_valid` from the restarted search, so a 2-solution fixture
  cycles 1→2→1→2 indefinitely. No existing test presses **past** the wrap into a
  second lap; the 3D suite adds one.

#### What "next solution" means over constraint-graph components

The search unit is the constraint-graph connected component (§3 above), and a
model has several. Each component's enumerator is itself a forward-only stream
(`WorkerOverlapEnumerator::possible_overlapping_search`, `permutation.rs:425`)
with **no count method** — per-component totals are not knowable in advance.

So "next solution" is an **odometer over per-component enumerators**: advance one
component; when it exhausts, restart it and carry into the next. With k components
of n_i solutions each, the total is the product, and `discovered_fold_cases`
remains a discovered-so-far high-water mark, never an eager product.

**The invariant that matters, and it is easy to get backwards:** *the first press
must change the largest component.* Advancing the smallest component first leaves
the silhouette identical and reads as a broken button. State it as a tested
invariant — "pressing Another Solution changes at least one face in the largest
component" — not as an ordering convention, because "order descending and advance
the last digit" advances the *smallest*, which is precisely the bug. This ordering
has no upstream analogue and belongs in `PORTING.md` under Ori Studio native.

The contract the UI depends on is unchanged: a deterministic forward-only stream,
restartable from the beginning, with a monotone discovered count. Nothing in it
requires a single global instance.

### 7. Provenance: this is Ori Studio native, not a divergence

`folding3d` has **no Oriedita counterpart** — upstream creases are always ±180,
so there is nothing to be faithful to. Per
[`PORTING.md:82`](../PORTING.md#L82), originals are *"not divergences from
Oriedita and must not be read as ones."*

Concretely: any new `OperationId` carries `OperationOrigin::OriStudio` written as
`descriptor!(native Foo, …)`, and new original operations live in
`crates/oristudio-cp/src/operations/native/`. The unit test
`native_operations_are_tagged_and_stay_out_of_ported_modules`
(`crates/oristudio-cp/src/lib.rs:4690`) enforces both.

### 8. Divergence budget

Stated so review can hold us to it. Everything in the left column that reads
**none** must come out of this branch byte-identical.

| Surface | Divergence |
| --- | --- |
| `checks.rs`, every Oriedita operation, the pre-fold CAMV gate's scope | **none** |
| `folding.rs` ordering pipeline, `initial_hierarchy_from_graph` | **none** — the 3D seeder is a sibling, the flat one stays reachable |
| `LineColor`, its wire codes, `.cp`/`.ori`/`.orh` codecs | **none** |
| `fold_graph.rs` | one typed error replacing a silent `break` (a bug fix, applied to both paths) |
| `folding.rs` visibility | `configure_subfaces`, `folded_face_polygons` → `pub(crate)`; no behaviour change |
| `folding3d/` | **new, additive, Ori Studio native** |
| `FoldedFigureSnapshot` | untouched; `Fold3dSnapshot` is a sibling type |
| Odometer unit ordering | new, no upstream analogue — record under PORTING.md's native section |

## Phase 0 findings (spikes)

> Each spike below states a **forcing result** — the outcome that changes this
> plan. Record the answer here, in the shape `non-180-fold-angles.md:382` uses,
> and amend the plan text in the same commit when a spike contradicts it. Two of
> non-180's four spikes changed that design; assume the same rate here.
>
> **Spike C: run, and it fired.** A, B, D, E: not yet run.

### Spike C answer — the census is non-zero on everything with a full fold in it

Harness: `crates/oristudio-cp/examples/fold3d_census.rs`. Faces come from the
shipped kernel — `export_fold_document` runs the same
`FoldGraph::from_segments(segments, true)` the fold command reaches through
`FoldingEstimateSession` — then faces are placed in 3D by a BFS over the dual
tree composing one rotation per crease, clustered into planes, and every
coplanar pair is clipped for positive-area overlap.

Population, deduplicated: **11** models the repo owner authored in Ori Studio
(nine `.osf` `foldProjection` exports plus `spikes_better.fold` and
`test_export.fold`), **37** third-party (the Ghassaei corpus plus the repaired
`frogBase`), **2** tracked single-vertex fixtures. Admission is the plan's §2
gate plus one addition below: 0 flat violations, 0 closure failures, a face
arrangement, no interior cut.

| | owner (11) | third-party (37) | fixtures (2) |
| --- | --- | --- | --- |
| arrangement refused by the Euler gate | 0 | **18** | 0 |
| admitted | 8 | 8 | 2 |
| census 0 | **1** | **1** | 2 |
| census median / max | 252 / 1001 | 112 / 12736 | 0 / 0 |

**The result, stated as the mechanism rather than the count: census 0 ⟺ the
document has no crease at exactly ±180.** Over the 18 admitted models the
correspondence is exact in both directions — 4 of 4 with no full fold measure 0,
14 of 14 with at least one measure non-zero. `census ≥ (number of full folds)`
held on 18 of 18, and with equality on `waterbombBase` (4 = 4). Spearman
correlation of the full-fold fraction against pairs-per-face is **+0.93**; of
face count against raw pairs, **+0.98**. Direction system (45° / 22.5° / 7.5° /
free-form) explains nothing once the full-fold fraction is held.

The census is **not** a tuned number: swept over ten orders of magnitude of
plane-clustering tolerance (normal 1e-12→1e-2, offset 1e-9→1e-2 × span) it is
constant on every admitted model.

Three things the spike found that were not what it was looking for:

- **`import_fold_document` accepts a cut it cannot model.** A `Black0` border
  segment with paper on both sides is a slit, not a hinge, and
  `is_interior_vertex` (`checks_spatial.rs:642`) excuses every vertex touching
  one — so CAMV returns CLEAN on geometry it never checked. `byu solar driven`
  is the instance: 0 flat, 0 closure, worst interior residual 2.6e-12°, and a
  placement loop gap of **156** on a span of ~400. Admission must add "no border
  segment interior to the arrangement", and `Fold3dRefusal` needs the arm.
- **The Euler gate refuses the whole crease pattern on 18 of 37 third-party
  models** — before any per-plane-patch question is reached. It refused 0 of 11
  owner-authored models. This is a different and prior failure to the 4-of-6
  plane-patch rejection Spike A is scoped around.
- **The census reproduces `treemaker-flatfold` exactly.** On
  `tests/fixtures/flat-folder/kabuto.fold` it counts **117** overlapping pairs,
  which is the same 117 ordering variables the research measured through the
  solver (`research/2026-08-07-3d-fold-feasibility.md:491`). Two independent
  implementations, one number — §4's "free cross-check" is already satisfied.

Placement validation, since every number above rests on it: on all-classic
documents a half-turn about an in-sheet axis is exactly Oriedita's 2D reflection,
so the placement must reproduce `estimate_wireframe_from_segments`. It does, on
**19 of 19** flat-foldable tracked `.fold` fixtures, to ≤ 4.2e-13. The only two
that disagree are the only two carrying flat-foldability violations (49 and 7),
where the shipped folder averages disagreeing positions instead of placing
rigidly. Separately, on every admitted 3D model the placement's loop gap is ≤
3.5e-8 — consistent with `FoldMagnitude`'s 1e-7° storage quantisation
(`line_segment.rs:66`) and nothing else.

**Forcing result: fired. Phase 9 moves into the merge set.**

### Spike A — plane-patch arrangement admissibility (highest value)

Build 8–12 hand-folded 3D states (one- and two-step offset pleats, box with flat
flaps, bridge/tuck, tent, nested tongue, flat base + 1–3 shaping creases),
cluster planes, project, run the real
`prepare_subface_segments` → `FoldGraph::from_segments` → `configure_subfaces`
chain. Report: fraction of multi-face patches **accepted**; of the rejected, how
many are fixed by (a) connected-component grouping, (b) artificial bridging cuts,
(c) neither. Baseline already measured: 4 of 6 rejected, all 70 accepted patches
yielded exactly 1 subface.

**Forcing result:** if (c) is non-empty, Phase 9 is a new arrangement builder
admitting non-simple cells, not a repair pass, and its estimate roughly doubles.
This does not touch the merge set — the census avoids `calculate_faces` — but it
decides what the follow-up costs. Its fixtures are Phase 2's fixtures, so the
work is not wasted.

### Spike B — placement convention

3-face **asymmetric** chain at **60°** and **120°** (never 90°, never 2 faces —
see §1 above). Assert against hand-computed coordinates, assert path-independence
across all BFS roots on a Miura with 9 independent dual loops, and assert
agreement with `vertex_link_polygon` on an interior fan. Verify the test is
**non-vacuous** by injecting a reversed composition order and watching it fail.

**Forcing result:** if placement and `vertex_link_polygon` disagree on
handedness, the admission gate and the renderer are in different frames and the
gate certifies states drawn mirrored — stop and reconcile before Phase 4.

### Spike C — census density on the target population

Run the census on the Phase 2 corpus. Report `overlapping_pair_count` per model
and per plane patch. Anchors: a fully-deployed Miura and an open accordion
measure **0**; an accordion with k of 23 creases opened measures 276 / 133 / 91 /
49 / 0 at k = 0 / 1 / 2 / 4 / 23, i.e. **one shaping crease retains 48% of the
flat pair count**; `iguana_24.osf`'s own stored flat figures measure 58.0
pairs/face over 3,224 faces.

**Forcing result:** if the census is non-zero on essentially every realistic
model, "renders honestly undetermined" is not a feature and **Phase 9 moves into
the merge set**. This is the single most important number in the plan.

**Run. It fired — see "Spike C answer" above.** The synthetic anchors quoted here
all held up: they are the same effect the corpus shows, which is that a full fold
is itself an overlapping pair. Read the accordion row as the mechanism rather
than the anchor — the census only reaches 0 at k = 23, when the last ±180 crease
is gone.

### Spike D — cross-plane coupling frequency

On the same corpus, count folded-crease lines whose four incident faces are not
all coplanar (§5.1's 1×4 strip is the canonical instance).

**Forcing result:** if coupling is common, "detect and refuse" is a permanent
refusal on the models users bring, not a scoped v1, and cross-component
resolution moves from Phase 11 into the merge set — a large scope change that
must be known before Phase 9 is designed.

### Spike E — projection ownership and item count

Decide who projects to 2D and whether the camera is persisted, then measure
`buildBsp` at real decal counts. This fixes the `.osf` persisted shape, the file
size (measured range: 0 to +163% on `iguana_24.osf` depending on the answer), and
whether orbit is achievable at all.

**Forcing result:** if real item counts put `buildBsp` past ~1265, the merge set
ships an orthographic camera (which makes the face tree's split combinatorics
view-independent, so it builds once and only `traverseBsp` is per-frame) or fixed
views only.

## Affected Areas

**Rust kernel — new**
- `crates/oristudio-cp/src/folding3d.rs` — module root; `Fold3dSession`,
  `Fold3dSnapshot`, `Fold3dVerdict`, `Fold3dRefusal`, `Fold3dDiagnostics`
- `crates/oristudio-cp/src/folding3d/placement.rs` — `place_faces`, loop gap
- `crates/oristudio-cp/src/folding3d/admit.rs` — flat snap, CAMV, tolerances
- `crates/oristudio-cp/src/folding3d/planes.rs` — clustering, footprint patches
- `crates/oristudio-cp/src/folding3d/census.rs` — coplanar-overlap census
- `crates/oristudio-cp/src/folding3d/model.rs` — `Folded3dRenderModel`
- `crates/oristudio-cp/src/folding3d/instance.rs`, `constraints.rs`,
  `session.rs` — **Phase 9/10 only**

**Rust kernel — modified**
- `crates/oristudio-cp/src/lib.rs` — `pub mod folding3d;`; verdict-code
  diagnostics; the 3D tolerance const block beside `CLOSURE_RESIDUAL_BAR_DEGREES`
  (`:2867`)
- `crates/oristudio-cp/src/session.rs` — 3D dispatch inside `fold_segments`
  (`:561`, the single chokepoint both fold entry points pass through); the
  empty-selection widening at `:552-558`; `CP_ENGINE_COMMANDS` (`:37`)
- `crates/oristudio-cp/src/fold_graph.rs` — typed `DisconnectedFaces` error at
  `:164` (**flat path too**, Phase 1)
- `crates/oristudio-cp/src/model/mod.rs` — slice-taking
  `has_non_classic_segments` beside `has_non_classic_creases` (`:551`)
- `crates/oristudio-cp/src/folding.rs` — `pub(crate)` on `configure_subfaces`
  (`:4204`) and `folded_face_polygons` (`:4235`); checked
  `hierarchy_table_from_initial_checked` beside `:4317` (Phase 9)
- `crates/oristudio-cp-wasm/src/lib.rs` — one new entry point, **plus the
  committed `.wasm` rebuild**

**Tauri**
- `apps/tauri/src-tauri/src/cp_engine.rs` — passthrough command +
  `NATIVE_CP_COMMAND_NAMES` (`:446`)
- `apps/tauri/src-tauri/src/lib.rs` — registration (`:120`)

**Web — store and engine**
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` — the
  three-way dispatch replacing `:1615-1628`; the CAMV gate copy split at
  `:1636-1660`; `isDrawableFoldResult` (`:688`) extended to the **initial** fold;
  `refoldOristudioCpFoldedFigure` (`:2041`) and `foldAnotherOristudioCpFigure`
  (`:1795`) routed through the same dispatch; `track` call sites
- `apps/web/src/store/workspaceStore/types.ts` — **`foldOristudioCpDocument`
  (`:798`), `foldAnotherOristudioCpFigure` (`:804`) and
  `refoldOristudioCpFoldedFigure` (`:821`) are declared here, not in the slice.**
  Any signature change is a two-file edit
- `apps/web/src/store/workspaceStore/oristudioCpRuntime.ts` — 3D fold call
- `apps/web/src/workers/oristudioCpWorker.ts`,
  `apps/web/src/engine/oristudioCpNativeClient.ts` — structurally locked by
  `OristudioCpWorkerApi`; both or neither
- `apps/web/src/engine/oristudioCpTypes.ts` — `OristudioCpFolded3dModel`;
  `'generated-3d'` on `OristudioCpFoldedFigureSourceKind` (`:447`); **and a
  decision on `OristudioCpFoldedFigureStatus` (`:385`), whose `'unsupported'` arm
  has zero producers anywhere today** — use it or delete it, but do not add a
  sixth arm beside an unused fifth

**Web — CP workspace**
- `apps/web/src/cp-workspace/folded/foldedFigure3dProjection.ts` — **new**
- `apps/web/src/cp-workspace/folded/foldedFigureActions.ts` — verdict-aware
  labels; **no new solution verb**
- `apps/web/src/cp-workspace/folded/foldedFigureActionIcons.tsx` — `:28-43`, the
  icon switch, if any new verb icon lands. `foldedFigureMenuItems.tsx` is a pure
  adapter and needs **no** change
- `apps/web/src/cp-workspace/folded/foldedFigureStaleness.ts` — `:286`
  short-circuits on `sourceKind`, so a new kind silently disables staleness
  forever. `segmentKey` (`:205`) already covers `fold_magnitude`
- `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` — generalised
  undetermined-face overlay (`:495`)
- `apps/web/src/cp-workspace/diagnostics/foldabilityMessages.ts` — verdict copy
  keyed on the kernel code, with the existing exhaustiveness test
- `apps/web/src/cp-workspace/foldAngle/CpFoldAngleLayer.tsx` — `:60` is the
  **fourth** `isClassicCrease` gate and the only render surface; decide whether
  angle badges stay visible over a 3D figure
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — **`:602` renders the
  raw `figure.status` identifier as the list subtitle**, untranslated, in all
  eight locales; and `:1516-1519`'s comment says "the `foldAction` (F) chord"
  when the chord is `G` (`keyboard/shortcuts.ts:164`; F is `colCyanAction`,
  `:113`). No new id-kind branches

**Web — persistence, export, analytics**
- `apps/web/src/lib/nativeProjectFile.ts` — `validateFoldedFigure` (`:673-702`)
  constructs a fresh literal, so unnamed fields are dropped (`contradiction`
  already is); `foldedFigureSourceKind` (`:764-773`) falls an unknown kind back
  to `'generated-from-current-cp'`
- `apps/web/src/lib/supersetFeatures.ts` — a `foldedForm3d` entry; note `:140`'s
  existing `foldAngles` entry uses the **identical** predicate
- `apps/web/src/analytics/events.ts` — `ANALYTICS_EVENTS` (`:84`) and the derived
  `AnalyticsEventName` union; `COUNT_BUCKETS` (`:150`)
- `docs/analytics.md` — event rows
- `apps/web/public/locales/*/{errors,panels,dialogs}.json` — eight locales

**Tests and fixtures**
- `tests/fixtures/fold-angle-3d/` — **new, and it does not exist in any form**
  (Phase 2)
- `apps/web/src/store/workspaceStore/store.test.ts:2847` — `describe('folding a
  pattern that is not flat-folded')`, 3 tests, all currently green; all three
  break and all three breakage is signal (Phase 7)
- `apps/web/src/cp-workspace/share/foldedFigureGate.test.tsx:96` — asserts the
  share toggle is disabled with copy saying the pattern "has no flat-folded
  form", which becomes false once 3D CPs have a folded form
- `apps/web/src/lib/creaseExportFoldFlatness.test.ts:85` — `isFlatFoldableFold`
- `scripts/folded-grid-screenshot.mjs:44-60` — **a Playwright harness that
  hand-writes an `OristudioCpFoldedFigureEntry` literal** and is not in CI, so a
  required new field breaks it silently
- `crates/oristudio-cp/tests/oriedita_folding_oracle.rs`,
  `oriedita_render_oracle.rs` — must stay green, and must be **actually run**
- `PORTING.md` — the Ori Studio native section

## Non-goals

Named so they do not creep in.

- **A 3D fold on angle-free crease patterns.** Ill-posed, not hard (§1c). The
  flat `Fold` already gives the only computable answer, and the simulate dialog
  survives as the escape hatch.
- **Reading fold angles back from the physics simulator.** Mass-spring with
  finite `faceStiffness`, so no two faces are ever exactly coplanar — it would
  destroy the very condition the ordering decomposition needs in order to exist.
- **Any acyclicity assertion, or a topological sort of `faceOrders`** (§5.4).
  Antisymmetry and determinacy are required; acyclicity is not.
- **Any silent tie-break, and any silent write-back of the flat snap.**
  Undetermined pairs are named. Snapping happens in the session's own copy.
- **Any user-facing tolerance, epsilon or coplanarity control.** None exists
  today; the user cannot supply the information the choice needs.
- **Gating on min plane separation as §2c writes it.** Measured uncomputable at
  runtime — always-pass or always-fail depending on an unjustified constant.
  Replaced by the spectrum-gap test, reported not gated.
- **Cross-plane / cross-component ordering parity in v1.** Detect and refuse.
  No reference implementation exists anywhere.
- **Orbit and a user-controlled camera in the merge set.** A fixed camera is a
  consistent state. Phase 10.
- **Re-scoping the pre-fold CAMV gate.** Upstream parity constraint; the 3D
  preconditions are additive.
- **A separate 3D viewport or a fourth `TransformableCanvasObject` kind.**
  See §5's rejected alternative.
- **Coplanar layer ordering for the simulator's SVG exporter.** Genuinely
  valuable — it is the research doc's own cheapest-useful-increment recommendation
  (§6 item 2), it repairs a self-documented limitation, and decisively **it needs
  no fold angles at all**, since every simulator session already produces a folded
  form. It is a different feature with a different consumer and deserves its own
  plan. Phase 10's `BspItem.order` change is the seam it will use.
- **OBJ/STL/Folded-FOLD from a CP folded figure, and share transport of any
  folded figure.** Those exports read the *simulator session*
  (`readFoldedGeometry`, `projectSlice.ts:638`); the share codec carries no
  folded figures at all.
- **Copying Rabbit Ear's `layer3D`.** Right architecture, and useful as a scale
  reference (224 ms / 1721 `faceOrders` on Mooser's Train), but GPL-3.0 against
  deliberately MIT/Apache crates — and its wall constraint class is measurably
  unreachable in the shipped source.

## Checklist

### Phase 0 — De-risking spikes (run all five before committing to the architecture)
- [ ] Spike A: plane-patch arrangement admissibility; record accepted fraction
      and the (a)/(b)/(c) split
- [ ] Spike B: placement convention on a 3-face asymmetric chain at 60° and 120°,
      with a non-vacuity assertion and agreement with `vertex_link_polygon`
- [x] Spike C: census density across the Phase 2 corpus — **run; Phase 9 is not
      a follow-up.** Census 0 ⟺ no crease at ±180, 18 of 18 admitted models both
      ways; `crates/oristudio-cp/examples/fold3d_census.rs`
- [ ] Spike D: cross-plane coupling frequency
- [ ] Spike E: projection ownership decided; `buildBsp` measured at real item
      counts
- [ ] Every spike's answer written into "Phase 0 findings" above, including the
      ones that change the design, with the plan text amended in the same commit

### Phase 1 — Flat-path corrections and instrumentation (ships alone, first, does not block)
- [ ] `FoldGraphError::DisconnectedFaces { reached, unreached }` replacing the
      silent `break` at `fold_graph.rs:164`, with a test that unreached faces no
      longer come back unfolded
- [ ] `isDrawableFoldResult` (`creasePatternSlice.ts:688`) applied to the
      **initial** fold, not only refold (`:2093`) — a rejected-Euler selection
      must not produce a `status: 'ready'` figure that draws nothing
- [ ] Distinguish the zero-solutions fallback (`folding.rs:1652-1657`) from the
      contradiction fallback (`:1681-1690`) on the wire
- [ ] Extend `ANALYTICS_EVENTS` (`analytics/events.ts:84`) rather than minting a
      parallel vocabulary — **`foldWarningShown`, `foldWarningAccepted`,
      `foldSimulationRun` and `foldabilityChecked` are already reserved there
      with zero call sites.** Use them where they fit
- [ ] `fold attempted { mode, crease_count_bucket, non_classic_count_bucket }` at
      the top of `foldOristudioCpDocument` after scoping, using `COUNT_BUCKETS`
      (`:150`). `G` reaches **neither** chokepoint — `handleCpShortcutAction`
      short-circuits at `CreasePatternPanel.tsx:1522` before `handleCpToolAction`
- [ ] `fold completed { mode, verdict, solution_count_bucket }` on every terminal
      branch, including today's simulate punt
- [ ] `fold solution cycled { direction: 'next' | 'wrap' }` from
      `foldAnotherOristudioCpFigure`
- [ ] Rows added to `docs/analytics.md`. Enums and bucketed numbers only — never
      residuals, gaps, separations, face indices or angles
- [ ] i18n the intercept dialog while it is still the only thing there:
      `creasePatternSlice.ts:1620-1625` is hard-coded English while the CAMV
      dialog three lines below uses `i18n.t` and the slice imports i18n at `:60`
- [ ] Fix `CreasePatternPanel.tsx:1516-1519`'s comment (says F, the chord is G)
- [ ] `cargo test --workspace`, `npx tsc --noEmit`, `npx vitest run`,
      `npm run i18n:check`
- [ ] **Let the data accumulate for a real window before committing to Phase 3**

### Phase 2 — The 3D fixture corpus (nothing downstream is checkable without it)
- [ ] `tests/fixtures/fold-angle-3d/` created. **There is no multi-face 3D-angled
      model anywhere in the repo today** — the two existing fold-angle fixtures
      are 14-edge single-vertex fans — and angles are not derivable, so every one
      must be authored
- [ ] Authoring method chosen and written down. Hand-writing `edges_foldAngle`
      for a bridge/tuck is not realistic; a small Rust builder emitting `.fold`
      from a described fold sequence is
- [ ] Fixtures, each with its expected verdict recorded: `box_90.fold`,
      `prism_60.fold`, `tube.fold`, `pleat_1step.fold`, `pleat_2step.fold`,
      `bridge_tuck.fold`, `tent.fold`, `nested_tongue.fold`,
      `flat_base_1shape.fold`, `flat_base_3shape.fold`,
      `strip_coupled.fold` (the (−90, +180, +90) counterexample),
      `pinwheel_cyclic.fold` (square twist), `chain3_60.fold`,
      `chain3_120.fold`, `disconnected.fold`
- [ ] A test asserting every fixture parses, carries the angles it claims, and
      reaches its recorded verdict

### Phase 3 — Placement and admission (kernel only, no UI)
- [ ] `pub mod folding3d;` in `lib.rs`; `folding3d/placement.rs`
- [ ] `place_faces` reusing `face_positions` unchanged; per-face point images;
      `crease_fold_angle` applied directly through `crease_quat`
- [ ] `Placement3dError` with the disconnected case detected from
      `face_position[f] == 0`
- [ ] Placement reproduces `vertex_link_polygon` on an asymmetric interior fan to
      ≤1e-12
- [ ] Path-independence across all BFS roots on a Miura with 9 independent dual
      loops, ≤1e-13
- [ ] Loop gap computed over non-tree dual edges, reported with
      `worst_loop_edge`, **not gating**; `#[cfg(test)]` assertion that it stays
      under the closure bar on every fixture
- [ ] `folding3d/admit.rs`: flat snap into the session's own segment copy;
      `dispatched_camv` (**not** `spatial_vertex_reports`); `place_faces`; loop
      gap; spectrum gap
- [ ] Three tolerances in `Fold3dTolerances`, all in one const block beside
      `CLOSURE_RESIDUAL_BAR_DEGREES` (`lib.rs:2867`)
- [ ] `cargo fmt --check`; `cargo clippy --workspace --all-targets -- -D warnings`;
      `cargo test -p oristudio-cp`

### Phase 4 — Plane clustering and the coplanar-overlap census (merge blocker)
- [ ] `folding3d/planes.rs`: **topological classification first** (faces joined
      through exactly-180° creases are coplanar by construction), geometric
      union-find second, then a verification pass re-checking every intra-cluster
      pair; refuse with `ToleranceWindowClosed` rather than silently merging —
      coplanarity under a tolerance is not transitive
- [ ] **A topology-vs-distance disagreement on any face pair is a first-class
      alarm**, not a tie-break. It is the runtime signal that the tolerance window
      is closed for this model, and it is computable without knowing the right
      tolerance
- [ ] Connected footprint patches within each plane
- [ ] `folding3d/census.rs`: direct polygon clip-and-area overlap count.
      **Must not call `FoldGraph::calculate_faces`** — that gate rejected 4 of 6
      multi-face plane patches on elementary forms, and avoiding it is what makes
      the merge set possible
- [ ] Census equals `treemaker-flatfold`'s ordering-variable count on an all-180
      document, on Kabuto and two other flat fixtures — scoped to the component
      `build_variables` (`constraints.rs:202`) actually reaches from
      `cells_faces.first()`, or the gap measured first. **Spike C already got
      117 on Kabuto through the spike's own counter, matching the solver's 117
      exactly, so expect no gap and treat one as a defect** — see "Spike C
      answer"
- [ ] Census reproduces `fold3d_census`'s recorded per-model counts on the Phase
      2 fixtures. Two independent implementations of one quantity is the check
      worth having, and the second one already exists
- [ ] Census is 0 on the deployed-Miura and open-accordion fixtures, non-zero on
      `flat_base_1shape.fold`
- [ ] Cross-plane coupling detection via a quantised folded-edge index;
      `strip_coupled.fold` returns `CrossPlaneCoupling`, not a definite answer
- [ ] `cargo test -p oristudio-cp`

### Phase 5 — Engine boundary (nothing user-facing)
- [ ] `Fold3dSnapshot` as a **sibling** of `FoldedFigureSnapshot`
      (`folding.rs:276`), not an extension — the latter's `wireframe` is 2D and
      drives `FoldedFigurePlacement` as 2D primitives
- [ ] Carries `estimation_step` / `discovered_fold_cases` / `current_fold_case` /
      `find_another_overlap_valid` / `text_result` so the cycling UI binds with no
      new plumbing, plus `verdict`, `diagnostics`, `census`, `planes` (each with
      its own `up`, per §1d), `undetermined_pairs`, `contradiction`
- [ ] `Fold3dVerdict { Folded, Crossing, NoLayerOrder, Indeterminate(cause) }`
      where `cause` is a stable **code** — `Disconnected` | `FacesUnresolved` |
      `PlanesTooClose` | `VertexIndeterminate` | `CrossPlaneCoupling` |
      `StackTooDeep`. Never a sentence: `lib.rs:2986-3016` states twice that the
      eight-locale CI gate cannot see a Rust literal
- [ ] 3D dispatch in `fold_segments` (`session.rs:561`), branching on a new
      slice-taking `has_non_classic_segments`; the empty-selection widening at
      `:552-558` becomes an explicit error on the 3D path
- [ ] **One** new entry point registered in **all five** places in **one**
      commit: `CP_ENGINE_COMMANDS` (`session.rs:37`), `oristudio-cp-wasm`,
      `workers/oristudioCpWorker.ts`, `engine/oristudioCpNativeClient.ts`,
      `cp_engine.rs` + `NATIVE_CP_COMMAND_NAMES` (`:446`) + `lib.rs:120`
- [ ] TS mirror types with `#[serde(default)]` on every new kernel field so
      existing `.osf` files still deserialize
- [ ] **Committed wasm rebuild** —
      `npm --workspace @treemaker/web run build:oristudio-cp-wasm`, then
      `git add -f apps/web/src/generated/oristudio-cp-wasm/` (the directory's own
      `.gitignore` is `*`, so a plain `add` skips newly-appearing files), then
      confirm with
      `strings apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm | grep fold3d`.
      **The files are tracked** — `git ls-files apps/web/src/generated` lists 12 —
      despite `AGENTS.md:404` saying otherwise, and `AGENTS.md`'s
      `wasm-pack build crates/treemaker-wasm --target bundler` is the wrong crate
      and target for this feature
- [ ] Note the local-vs-CI trap: `pretest`/`pretypecheck`/`prebuild` all rebuild
      wasm, and CI passes `--ignore-scripts` after building explicitly, so **no
      workflow verifies the committed artifact** (`grep -rn "git diff\|--exit-code"
      .github/workflows/` returns nothing). Running `vitest` directly tests the
      committed wasm; `npm run test:web` tests a fresh one
- [ ] `wasm-pack test --node crates/oristudio-cp-wasm`; native command-parity test
      green; `npx tsc --noEmit`; `npm run build:web`; `npm run check:desktop`

### Phase 6 — Render
- [ ] `Folded3dRenderModel` emitted once per fold (never per frame)
- [ ] `projectFolded3dModel` in
      `cp-workspace/folded/foldedFigure3dProjection.ts`, reusing
      `projectVertices`, `buildBsp`/`traverseBsp`, `findVisiblePieces`,
      `coplanarRuns`; emits `fill_path`/`stroke_path` in traversal order as
      `sequence`
- [ ] Faces, not planes, are `BspItem`s — `fan()` (`bsp.ts:140-148`) assumes
      convex and `planeOf` takes the first three points
- [ ] The kernel's coplanarity tolerance passed to `buildBsp` instead of its
      hardcoded `EPS = 1e-7` (`bsp.ts:67`)
- [ ] `edgeInk` stays 0 on the canvas path, so the BSP build remains
      eye-independent and hoistable
- [ ] Census 0 → opaque per-face fills. Census > 0 → **per-face translucency in
      the projector with undetermined faces flagged**, *not* `Transparent3`:
      `needs_subfaces` (`folding.rs:2112-2115`) includes it, so that style needs
      the arrangement this plan avoids
- [ ] Per-plane flat shading from the plane normal (`svgRenderer.ts:515-552`)
- [ ] Piece-count guard with a tested refusal path
- [ ] `pinwheel_cyclic.fold` renders every overlap cell with the correct winner,
      asserted **per cell** — the regression test a future "just sort it"
      refactor must fail
- [ ] Regression test in `packages/origami-simulator/src/bsp.test.ts` that a
      straddling face cannot reorder a coplanar stack (`bsp.ts:253`)
- [ ] `npm run test:web`; `npm run test:simulator`

### Phase 7 — `G` dispatch, verdict UX, i18n
- [ ] Three-way dispatch replacing `creasePatternSlice.ts:1615-1628`:
      all-classic falls through with **no edit below `:1628`**; non-classic +
      admitted takes the 3D branch; non-classic + refused keeps today's simulate
      dialog
- [ ] `refoldOristudioCpFoldedFigure` (`:2041`) and
      `foldAnotherOristudioCpFigure` (`:1795`) routed through the same dispatch
- [ ] Signature changes mirrored in
      `store/workspaceStore/types.ts:798`/`:804`/`:821`
- [ ] The six-row truth table pinned in `store.test.ts`, decided on **scoped**
      ids only. The three existing tests at `store.test.ts:2847` are rewritten,
      not deleted — especially `:2924`, which folds the diagonal alone of a
      90° square, a selection that is non-classic **and** has no closed region:
      a ready-made `Indeterminate(FacesUnresolved)` fixture
- [ ] CAMV gate copy split by regime (flat kinds vs
      `SpatialClosure`/`SpatialSelfIntersection`), reusing the **same**
      `runOristudioCpCheckCommand('CheckCamv')` call. Scope unchanged
- [ ] Verdict copy in an i18n table keyed on the kernel code, beside
      `foldabilityMessages.ts`, inheriting its exhaustiveness test so a new kernel
      arm fails CI rather than rendering `undefined`
- [ ] `Crossing` and `Indeterminate` are **not** error toasts and do **not**
      destroy the figure — mirror `conclude_with_contradiction` and carry the
      verdict on the entry. `creasePatternSlice.ts:1713` already states the
      principle for the flat contradiction
- [ ] `CreasePatternPanel.tsx:602` no longer renders a raw status identifier as
      the list subtitle
- [ ] Decide `OristudioCpFoldedFigureStatus`'s unused `'unsupported'` arm
      (`oristudioCpTypes.ts:385`) — zero producers today; use it or delete it
- [ ] Cycling: `fold_another` reused verbatim, **one** solution verb, no
      `fold_to_case` on the canvas, no "k of N"
- [ ] Test: two full laps past the wrap on a 2-solution fixture (no existing test
      presses past the wrap)
- [ ] **i18n, as its own gated block:** ~12 new strings across `errors`,
      `panels`, `dialogs`; `npm run i18n:extract`; translate 8 locales;
      `npm run i18n:stamp`; `npm run i18n:check`. Note `lib.rs:3066`/`:3070`
      already emit raw English with an embedded float in all eight locales — fix
      while adjacent
- [ ] `mode: 'spatial'` and the verdict arms wired into Phase 1's events
- [ ] `npm run lint:web`; `npx tsc --noEmit`; `npm run test:web`;
      `npm run i18n:check`

### Phase 8 — Persistence, staleness, export gating
- [ ] `'generated-3d'` on `OristudioCpFoldedFigureSourceKind`
- [ ] Added to the sourceKind predicate at `foldedFigureStaleness.ts:286` — it
      short-circuits `return false` for any other kind, silently disabling
      staleness forever
- [ ] `foldedFigureSourceKind` (`nativeProjectFile.ts:764-773`) accepts the new
      kind and is **loud** on an unknown one, instead of falling back to
      `'generated-from-current-cp'` and making a 3D figure look refoldable-as-flat
- [ ] The 3D fields named in `validateFoldedFigure`'s returned literal
      (`:673-702`); fix the pre-existing `contradiction` drop while there
- [ ] **No `NATIVE_PROJECT_SCHEMA_VERSION` bump.** Measured: a v8 reader rejects
      `schemaVersion: 9` regardless of `minimumReaderSchemaVersion`, because
      `createNativeProjectFile` writes it unconditionally and the accept list is a
      hardcoded enumeration — so a "conditional raise" buys zero conditionality
      and breaks every file the 3D build writes. `snapshot`/`renderSnapshot` are
      opaque `isRecord` casts (`:677-695`), so the fields ride through. Gate on
      the **figure** (loud sourceKind), not the file. Precedent:
      `current_fold_case` changed which *solution* displays and shipped with no
      bump
- [ ] Persist `folded3d` **and** the derived `renderSnapshot`, so a reopened
      `.osf` draws with `handle: null` exactly as flat figures do
- [ ] Do **not** persist `faceOrders` in the merge set. `.osf` is uncompressed
      (`JSON.stringify(written, null, 2)`, `:397`) and real density on
      `iguana_24.osf` is 58 pairs/face over 3,224 faces — +163% file size as the
      shipped writer emits
- [ ] State explicitly that a reloaded 3D figure **draws but cannot cycle**
      (`handle: null` makes `isFoldedFigureReady` false). Intentional for 2D;
      worth naming given the cycling-parity requirement
- [ ] `foldedForm3d` superset entry, `blocking: false`, `fold` **excluded** from
      `droppedByFormats`. Note `supersetFeatures.ts:140`'s existing `foldAngles`
      entry uses the identical predicate, so both will fire on the same documents
- [ ] `scripts/folded-grid-screenshot.mjs:44-60` updated — it hand-writes an
      entry literal and is not in CI
- [ ] `foldedFigureGate.test.tsx` asserts the share/export toggle's behaviour
      **explicitly**; its copy "has no flat-folded form" becomes false
- [ ] Retained wasm-handle size **re-measured** against `MAX_CP_HISTORY = 100`;
      `foldedFigureHandles.ts:11-19`'s "~0.6 KiB per segment" was measured for the
      flat handle, and `inline-simulations-in-undo.md:138-166` measured
      243 KB–2.9 MB per retained fold and reversed on refcounting for it
- [ ] Round-trip test in `nativeProjectFile.test.ts`; an older-shaped file without
      the new fields still loads

### Merge-set validation (Phases 2–8)
- [ ] `cargo fmt --check`; `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] `cargo test --workspace` and `cargo test --workspace --doc` (CI's
      `--all-targets` excludes doctests, hence the separate step)
- [ ] **Oracles actually run, not silently skipped.** `grep -rn ORIEDITA
      .github/workflows/` returns nothing, and 41 parity tests print
      `skipping … is not set` and pass when the env var is absent. Run
      `ORIEDITA_GEOMETRY_ORACLE=<path> cargo test -p oristudio-cp --test
      oriedita_folding_oracle` and
      `ORIEDITA_RENDER_ORACLE=<path> cargo test -p oristudio-cp --test
      oriedita_render_oracle`, and report the counts
- [ ] `tools/oracle/build_oracle.sh` + `TREEMAKER_CPP_ORACLE=… cargo test -p
      oracle-tests --test cpp_oracle`
- [ ] `wasm-pack test --node crates/oristudio-cp-wasm`
- [ ] `npm run lint:web`; `npx tsc --noEmit`; `npx vitest run`;
      `npm run test:simulator`; `npm run build:web`; `npm run check:desktop`;
      `npm run i18n:check`; `npm run typecheck:functions`
- [ ] `git diff --check`; committed `.wasm` staged and verified
- [ ] `PORTING.md` updated: `folding3d` as Ori Studio native (not a divergence);
      the odometer unit ordering; the `pub(crate)` visibility changes
- [ ] **Author browser checklist** (the automated pane runs
      `visibilityState=hidden` with zero rAF, so none of this is agent-verifiable):
      `G` on an all-classic selection; `G` on a 3D selection with census 0;
      `G` on a flat base with one shaping crease (census > 0, translucent,
      verdict shown); each verdict arm; the cycling verb's disabled state; refold
      after an angle edit; SVG and PNG export; `.osf` save, reload, and reopen on
      a `main` build; undo/redo across a fold; the simulate fallback on a
      non-closing pattern

### Phase 9 — Per-component layer ordering (**merge set** — Spike C said so)
- [ ] `initial_hierarchy_3d`: seed per in-plane 180° crease exactly as
      `folding.rs:4009-4025` does, substituting **one boolean** —
      `dot(face_normal, up_patch) > 0` for `first_position % 2 == 1` — and
      deleting the `SameParityAdjacentFaces` abort (§3b, §5.7)
- [ ] Free regression test: `initial_hierarchy_3d` is **bit-identical** to
      `initial_hierarchy_from_graph` on every tracked flat fixture (on one plane
      with `up = +z` the two agree by construction), **with a non-vacuity
      assertion**. Leave the flat function reachable —
      `equivalence_condition_candidates_from_parts` also builds an
      `InitialHierarchy`
- [ ] Cell-decomposition repair scoped by Spike A: detect components, detect
      nesting, inject cuts (two per nesting), and keep faces from **different**
      components in the **same** ordering instance
- [ ] `LocalFaceMap` plus a hard `FaceIdOutOfRange` check before **every**
      `possible_overlap_search_for_subfaces` call, **with a test that the check
      fires** — an out-of-range id returns `found = true` with an empty ordering
      and no error. Local renumbering is also required for performance:
      `set_guide_map` (`permutation.rs:806`) allocates `faces_total²` bytes per
      subface (`folding.rs:4322`)
- [ ] Shipped taco-tortilla / same-plane taco-taco generators reused verbatim on
      projected coordinates, roles preserved through `normalized_pair`
      (`folding.rs:4269`)
- [ ] Wall rule on the crease **segment**'s interior, not its supporting line
      (the line reading is unsound *and* incomplete, and on a non-convex face
      yields `upper == lower`, which `infer_above` rejects and `from_initial`
      silently discards). Direction: rise toward `+up_P` orders the crossed face
      **below** — confirmed 36/36 across deflections 1–175° and six decades of
      epsilon, both sides. The antecedent is read off the **placed geometry**,
      never off M/V: one upstream 180° flip reverses the rise with the bit
      unchanged
- [ ] `hierarchy_table_from_initial_checked` propagating `infer_above`'s error
      (`folding.rs:4326` discards it, so two opposed wall seeds make the first win)
- [ ] `StackTooDeep` as its own verdict — `SubFacePermutationSearch` hard-errors
      above 2000 permutations (`permutation.rs:766`) rather than degrading
- [ ] No acyclicity assertion; `pinwheel_cyclic.fold` accepted with its cyclic
      order intact
- [ ] Kabuto through the 3D path as an all-180 document reports 117 variables,
      components `[81, 18, 18]`, and 9 states

### Phase 10 — Enumeration, real cycling, orbit (follow-up)
- [ ] Odometer over per-component enumerators, with the **tested invariant that
      the first press changes the largest component** (not an ordering
      convention — "advance the last digit" advances the smallest)
- [ ] `discovered_fold_cases` stays a discovered-so-far high-water mark
- [ ] Layer order fed into the projection so `bsp.ts`'s coplanar tie-break is
      never consulted; optional `order?: number` on `BspItem` with `sortCoplanar`
      keyed on it — this also fixes the SVG exporter's documented limitation
- [ ] `FoldedFigureCamera { yaw, pitch, zoom }` beside `placement`;
      `useFoldedFigureOrbit` reusing `lib/simulatorOrbit.ts`, one undo checkpoint
      per gesture. `inlineSimulation.ts:46-56` is a written post-mortem of the
      camera never being written back
- [ ] `useFoldedFigurePreview.ts:73`'s cache key extended with the camera, or an
      orbited figure serves its pre-orbit picture in the export and share dialogs

### Phase 11 — FOLD interchange and remaining export (follow-up)
- [ ] `foldedForm` frame: a second `FoldDocument` in `file_frames` with
      `frame_classes: ["foldedForm"]`, `frame_parent`, `frame_inherit: true`,
      three-component `vertices_coords`, `face_orders`
- [ ] Appended through the existing `export_folded_frames` seam
      (`io/fold.rs:35`), **not** from inside `export_fold_document` —
      `merge_fold_file_document` (`:292`) assigns rather than merges
      `file_frames`, which is harmless today only because `export_fold_document`
      never writes it
- [ ] Decide replace-vs-append against an imported file's stale `foldedForm`
      frame, which is currently preserved verbatim across CP edits
      (`tests/io.rs:191-232`)
- [ ] `faceOrders` sign `s = sign(n_g · up_patch)` on the **lower** face's
      transported normal in the CP frame's winding; `s = 0` (spec-legal) for
      undetermined pairs
- [ ] `frame_attributes: ["3D"]` via `FoldDocument.extra`. **Not**
      `nonSelfIntersecting` — the crossing predicate is sound but not complete
      (§5.2)
- [ ] Fix `apps/web/src/lib/foldedExport.ts:75`, which does
      `delete folded.face_orders` on the only existing folded-FOLD export path
- [ ] File-size growth bounded by a stated, tested cap

## Risks and mitigations

| # | Risk | Likelihood / impact | Mitigation |
| --- | --- | --- | --- |
| R1 | **The inputs do not exist.** Only 2 tracked `.fold` files carry angles, both single-vertex fixtures, and no telemetry says whether users press `G` on non-classic selections | High / high | Phase 1 ships alone and first and buys the number. It is an afternoon and it gates nothing, so the cost of being wrong is one PR |
| R2 | **The census is non-zero on essentially every realistic model**, so the merge set ships a figure that is honest and almost always undetermined | **Confirmed / high** | Spike C measured it: census 0 ⟺ the document has no crease at ±180, exactly, on 18 of 18 admitted models. The largest model measuring 0 has 6 faces. Retired as a risk and taken as a premise — Phase 9 is in the merge set |
| R3 | **The plane-patch arrangement pipeline does not run unchanged** — measured, 4 of 6 multi-face patches rejected by the Euler gate, and `face_request` cannot trace an annular cell | **Confirmed / high** | The merge set avoids `calculate_faces` entirely (the census is a direct clip-and-area count). Spike A scopes the Phase 9 repair; if it needs a new arrangement builder the follow-up roughly doubles |
| R4 | Placement handedness disagrees with the admission gate, so the gate certifies states drawn mirrored | Medium / high | Assert against `vertex_link_polygon` rather than minting a second convention; 3-face **asymmetric** fixture at 60°/120°, never 2-face at 90° where the formulas are degenerate |
| R5 | Plane clustering silently merges two genuinely distinct planes (coplanarity under a tolerance is not transitive), poisoning every downstream claim | Medium / high | Topological classification first; verification pass over every intra-cluster pair; refuse rather than merge; **topology-vs-distance disagreement is a first-class alarm** |
| R6 | Cross-plane coupling is common, making "detect and refuse" a permanent refusal on ordinary models | Medium / high | Spike D measures frequency. Refusing beats answering definitely and being wrong half the time silently (§4.2) |
| R7 | An out-of-range face id makes the ordering search report success with an empty ordering, no error | High / high | Hard `FaceIdOutOfRange` check before every call **plus a test that the check fires**. Local renumbering is required for performance anyway |
| R8 | The kernel change does not reach the app because the committed `.wasm` was not rebuilt — and **no workflow verifies it** | High / high | Explicit checklist item with the correct command, `git add -f`, and a `strings` verification. It has bitten before (R4 in non-180) |
| R9 | New oracle "green" is vacuous — 41 Oriedita parity tests skip silently without `ORIEDITA_GEOMETRY_ORACLE`, which no workflow sets | High / high | Both env vars named in the validation checklist, with reported counts |
| R10 | The verdict surface reads as "3D isn't implemented" rather than "this pattern cannot be folded that way" | Medium / high | Verdict copy is a merge blocker with an exhaustiveness test; `Crossing`/`Indeterminate` keep the figure and are not error toasts; see Open decisions on the simulator hatch |
| R11 | An undetermined stack is rendered as if it were determined | High / high | The census is the gate, and it is a merge blocker. Undetermined faces render distinctly. `bsp.ts:253`/`:277` are pinned by regression test |
| R12 | Row (b) regresses: an all-classic selection inside a mixed document takes the 3D path | Medium / high | Per-segment `is_classic_crease` on scoped ids only; `has_non_classic_creases` is explicitly forbidden as the router; six-row truth table pinned in `store.test.ts` |
| R13 | A figure folded flat, then given angles, then refolded reaches the flat kernel | High / high | All three doors dispatch identically, in one change |
| R14 | Orbit misses its frame budget | Deferred | Not in the merge set. `buildBsp` is 93.5% of the frame and eye-independent at `edgeInk = 0`, so it hoists; piece-count guard regardless |
| R15 | `.osf` schema bump breaks every file the 3D build writes | Medium / high | **No bump.** Measured: the raise is not conditional. Gate on the figure via a loud `sourceKind` |
| R16 | A 3D wasm handle retains far more than the flat one, and `MAX_CP_HISTORY` is 100 | Medium / high | Re-measure before assuming refcounting is free; `inline-simulations-in-undo.md` measured 243 KB–2.9 MB and reversed on it |
| R17 | Merge pain on hot files (`creasePatternSlice.ts`, `folding.rs`, `CreasePatternPanel.tsx`) with parallel agents active | Medium / medium | New behaviour goes in new modules; `creasePatternSlice.ts` gets one branch above `:1628` and no edit below it |
| R18 | The i18n gate fails late, after the feature is otherwise done | Medium / low | i18n is its own checklist block in Phase 7, not a bullet inside the UX work |
| R19 | **A `Black0` border segment interior to the arrangement is a cut, and the kernel excuses every vertex touching it** — `is_interior_vertex` (`checks_spatial.rs:642`) returns false, so CAMV reports CLEAN on geometry it never checked. Measured on `byu solar driven`: 0 flat, 0 closure, worst interior residual 2.6e-12°, placement loop gap 156 on a span of 400 | **Confirmed / medium** | Admission gains "no border segment with paper on both sides", with its own `Fold3dRefusal` arm. Detected in `fold3d_census` today as `interior_cuts` |

## Open decisions

Two, and the first is a product call this plan should not make unilaterally.

### 1. Does a **refused** 3D fold still offer the simulator?

The user's ask says "assuming no foldability errors" and is silent on the errors
case. Once `G` folds in 3D, the simulator remains the only answer for a pattern
that fails closure, that is refused for cross-plane coupling, or that carries no
angles at all — and it works today.

- **Offer it on a failed 3D fold.** Keeps a working path; risks reading as "the
  3D fold isn't implemented yet."
- **Do not offer it.** The verdict stands on its own and reads as a fact about
  the pattern; removes a path that works.
- **Offer it only for `Indeterminate` and `Crossing`, not for the refusals we
  chose** (`CrossPlaneCoupling`, `StackTooDeep`), on the grounds that the first
  two are facts about the pattern and the second two are facts about us.

This plan assumes the third and keeps `simulateNonFlatRegion` reachable, but the
call is the repo owner's. Whatever is chosen, the simulate dialog itself survives
for the angle-free case, where it is the only correct answer.

### 2. Selection scoping for the 3D preconditions

The existing CAMV gate is document-wide and must stay so (upstream parity). The
3D preconditions are new and additive, so they *can* be selection-scoped — but a
`SpatialClosure` diagnostic carries only a bare `point`, with `segments` dropped
by `skip_serializing_if`, so membership in the selection cannot be recovered from
an entry. Three options: a new selection-taking kernel check; frontend geometric
re-derivation from the point; or inherit the document-wide scope knowingly and
say so in the PR. Phase 0 decides; the third is acceptable if named.

### Resolved while planning

- **Placement rotation is `ρ`, not `π − ρ`**, settled by `crease_fold_angle` plus
  `crease_quat`. The research doc's §1a uses ρ as the dihedral angle; the two are
  supplementary and the kernel's is the one that matters.
- **Projection lives in TypeScript.** The kernel render snapshot exists to be
  diffed against the Oriedita render oracle (`folding.rs:1968` says so); 3D has no
  oracle, and any future orbit needs pointer rate an async wasm round-trip cannot
  deliver.
- **Undetermined stacks render as per-face translucency in the projector**, not
  as `Transparent3` — that style needs the arrangement the merge set avoids.
- **No `fold_to_case` on the canvas and no "k of N."** Neither exists for the 2D
  figure, and the ask is parity.
- **No `.osf` schema bump.** The conditional raise buys nothing; gate on the
  figure.
- **`folding3d` is Ori Studio native**, not an Oriedita divergence
  ([`PORTING.md:82`](../PORTING.md#L82)).
