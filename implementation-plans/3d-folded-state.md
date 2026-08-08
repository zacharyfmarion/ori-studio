# 3D folded state from `G`

## Goal

Press `G` on a crease-pattern selection whose creases carry non-180° fold angles
and get a **computed** 3D folded state — placement plus, where it exists, a layer
ordering — rendered as a folded figure on the CP canvas, with the same
solution-cycling verb the 2D folded figure already has. This replaces the
"This pattern isn't flat-folded … Simulate?" punt at
`apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:1659`.

Computed, not simulated: a linear-time rigid walk over the dual-graph spanning
tree, not a mass-spring relaxation. The simulator stays where it is.

This plan continues [`non-180-fold-angles.md`](non-180-fold-angles.md), which
shipped the fold angles this reads, and rests on
[`research/2026-08-07-3d-fold-feasibility.md`](../research/2026-08-07-3d-fold-feasibility.md).
Section references below (§1c, §2b, §5.1 …) are to that research doc; read it
before this one. Nothing here restates it.

### Status — what has been measured since this plan was first written

Phase 0 spikes **A, B, C and D have been run**; E has not, and A's plane-patch
half was answered by Phase 9 rather than by a spike. **Phase 1 is
built** — four live bugs in shipped code, the fold-event vocabulary, and the
intercept dialog's strings; see its checklist for what each one turned out to be,
including the one that changes what a `known-good/` model reports. **Phase 2 is
built** apart from its authored adversarial cases: `tests/fixtures/fold-angle-3d/`
holds eight fixtures and one `.osf`, the external corpus is reachable through
`ORISTUDIO_NON_FLAT_CORPUS_DIR`, and the census, loop gap and plane-separation
spectrum are reproducible by one command (see "Reproducing the measurements").
Building it corrected two of this plan's own claims — the fixture write-out
precision, and §2 step 6's reading of the separation spectrum — and closed R21.
**Phase 4 is built**: plane clustering, the coplanar-overlap census, and the
cross-plane coupling detector — which refuted the plan's own "detect coupling and
refuse" v1 by measuring coupling on every admitted model above six faces.
**Phase 9 is built**: cell decomposition, the constraint generator, and the
per-component solver; it closed **R3**, **R6** and **R7**, answered Spike A's
plane-patch half with grouping rather than cut injection, and corrected the
plan's reading of Kabuto's `[81, 18, 18]`, which is not a component
decomposition.
**Phase 3 is built**: `crates/oristudio-cp/src/folding3d/`, kernel only, nothing
user-facing. It closed **R20** and **R22** — the latter by finding that the
comparison was wrong rather than the walk — and it corrected **R3b**, which had
Phase 7 ranking its verdict copy by a refusal the shipped gate reaches on nothing
at all.
**Phase 5 is built**: three entry points registered in all five places plus the
tracked `.wasm`, `Fold3dSnapshot` and `Folded3dRenderModel` with their TypeScript
mirrors, and the two mirrored routing guards. Its contract is written down once,
at [The engine contract](#the-engine-contract) — **that section is what the
frontend half builds against, and it should not have to read the kernel to find
any of it.**

**The kernel half of this feature is therefore complete: Phases 3, 4, 5 and 9.**
What remains is the frontend half — render (6), `G` dispatch and verdict UX (7),
persistence (8) — plus the two follow-ups (10, 11).

**Phases 4, 5 and 9 were then reviewed, and the review found one wrong answer and
one stale artifact.** The wrong answer: a constraint component was being
identified with a set of *faces*, and a face can belong to two components at once,
so one of them was handed no constraints, "solved" vacuously, and reported an
undecided stack under a `Folded` verdict. The stale artifact: the tracked `.wasm`
had been rebuilt one commit before a behaviour-changing kernel edit, and because
a body-only change leaves the `.js` and `.d.ts` byte-identical, every web check
passed over it. Both are fixed. The review also found that two of the phase's own
tests did not catch the mutation they were named for; those are tightened, and
what that says about mutation testing as a method is recorded under Phase 9.

**Phases 1-3 were then reviewed, and the review found six things worth having.**
Four were consumer-side: the pre-fold gate counted `CheckCamv`'s new
`warning`-severity entry as a violation and raised Oriedita's modal over nothing;
`fold_disconnected` and the folded-form import refusal both reached the user as
raw Rust `Debug` strings in eight locales, the latter on a shared code no case
could be written for; and `foldedExport.ts` and `creasePatternImport.ts`
disagreed about what a `foldedForm` frame is, so this branch's own refusal broke
a round trip nobody had pinned. Two were kernel-side: `InteriorCut` and
`LoopNotClosed` could each be deleted with the suite still green, and
`interior_border_segments` put a full arrangement trace on the 120 ms debounced
edit path — which turned out to be `FoldGraph::from_segments`'s quadratic vertex
dedup, a cost every arrangement in the app had always paid. All six are fixed;
see the Phase 1 and Phase 3 checklists. The corpus census is byte-identical
before and after.

Spike answers are in [Phase 0 findings](#phase-0-findings-spikes). Sections
rewritten because a spike or a code re-read contradicted them are marked
**[rewritten]** with the reason. Three spikes changed the design:

- **Spike C** moved Phase 9 (layer ordering) out of the follow-up and **into the
  merge set**. Its own headline conclusion was then refuted on audit — the
  corrected statement is a one-way bound, not a biconditional.
- **Spike A** turned the loop gap from a reported number into a **gate**, and
  found a live blind spot in the shipped `CheckCamv` (R19).
- **Spike B** settled the placement convention against `vertex_link_polygon`,
  and found that `FoldGraph`'s faces are wound the **opposite** way from the
  FOLD convention that convention was validated against (R20).

Two premises this plan was written on are obsolete for reasons that have nothing
to do with the spikes, and both make the work smaller:

- **Spherical simplicity is shipped, not open.** `vertex_link_verdict`
  (`checks_spatial.rs:332`) returns `LinkVerdict` (`:258`), `dispatched_camv`
  routes it, `spatial_closure_diagnostics` emits
  `kind: "SpatialSelfIntersection"` with `rule: Some("SelfIntersection")`
  (`lib.rs:3096-3111`), the literal is in the tracked `.wasm`, the copy is at
  `apps/web/src/cp-workspace/diagnostics/foldabilityMessages.ts:171-176` and it
  is translated in all eight locales (`apps/web/public/locales/*/panels.json`).
  `tests/spherical_simplicity.rs` (614 lines) covers it.
  [`non-180-fold-angles.md:853`](non-180-fold-angles.md#L853)'s Phase 8 item 1 is
  unchecked but **done**; only the loop-check item beside it is genuinely open,
  and Spike A now says that one gates. Phase 5's `Crossing` arm is consequently
  half-built and Phase 7's i18n budget is smaller — see both phases.
- **The 3D fixture problem is a *location* problem, not a supply problem.** See
  the precondition below and the rewritten Phase 2.

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

Three measured consequences to hold in view. **[rewritten — the first was stated
as one, and its premise was true of tracked files and false as a claim about
available inputs.]**

- **Inside git, the scarcity is exactly as stated.** Exactly **2 of 33 tracked
  `.fold` files** carry a non-classic angle, and both are 14-edge single-vertex
  fixtures written for the fold-angle feature itself
  (`tests/fixtures/fold-angle/valid-waterbomb-vertex.fold`,
  `self-intersecting-vertex.fold`). Re-verified: `git ls-files '*.fold'` returns
  33; scanning each for a non-0/non-±180 `edges_foldAngle` returns those two.
- **Outside git, admissible multi-face 3D-angled material exists and has been
  measured.** The repo owner's non-flat corpus holds **11 models he authored in
  Ori Studio** (nine `.osf` files carrying real `fold_magnitude` values plus
  `spikes_better.fold` and `test_export.fold`) and **10 curated third-party
  models** in `known-good/` regenerable by the committed
  `scripts/fetch-non-flat-corpus.sh` → `scripts/svg-to-fold.mjs`. Re-run this
  session, `cargo run -p oristudio-cp --release --example fold_corpus_scan --
  <known-good>` returns **0 flat / 0 closure / 0 self-int / 0 link-crossing on
  all ten**, 9 to 2,374 vertices, across 45°, 22.5°, 7.5° and free-form angle
  systems. Under the §2 admission gate, **8 of those 10** are admitted (Spike A)
  and **8 of the 11** owner-authored models (Spike C). So Phase 2 is no longer
  "author fifteen fixtures from nothing"; it is "adopt what exists, author the
  six adversarial cases nobody folds by accident, and commit a small curated
  subset." See the rewritten Phase 2.
- The population that *does* carry angles is the one non-180's own workflow
  creates: transcription — "the user folds a model by hand, then draws the
  crease pattern for it. They already know the angles"
  ([`non-180-fold-angles.md:264`](non-180-fold-angles.md#L264)). Every one of the
  11 owner-authored models above came through exactly that path, which validates
  the *workflow* hypothesis and says nothing about how many users take it. A
  corpus scan of downloaded files cannot bound a workflow whose primary path is
  typing, which is why Phase 1's analytics event still ships first and alone.

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
| f | non-classic, but an incident vertex is indeterminate | any | `Refused(VertexIndeterminate)` — a named, translated verdict; not a silent empty figure. **No fixture in the corpus produces an indeterminate vertex** (0 of 481), so this row's fixture has to be authored or the arm ships untested |

Row (b) is the one that matters most and is easiest to break. `is_classic_crease`
(`crates/oristudio-cp/src/model/mod.rs:543`) is per-segment;
`has_non_classic_creases` (`:551`) is document-wide and **must not** be the
routing predicate. A slice-taking sibling is needed.

Three doors reach the folder, not one. `foldOristudioCpDocument` is the obvious
one; `refoldOristudioCpFoldedFigure` (`creasePatternSlice.ts:2175`) reselects
lines and calls the runtime with **no** non-classic check, and
`foldAnotherOristudioCpFigure` (`:1795`) re-runs on an existing handle. A figure
folded flat, then given angles, then refolded — including an automatic stale
refold — reaches the flat kernel with non-classic creases in scope. All three
dispatch identically or the fix is not a fix.

There is also a kernel-side widening to close: `folded_figure_fold_selected`
(`crates/oristudio-cp/src/session.rs:579-583`) falls back to folding the **whole
document** when the selection resolves empty, and the store's empty guard at
`creasePatternSlice.ts:1640` is the only thing preventing it. In 3D the blast
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
| A face id past `faces_total` makes `possible_overlap_search_for_subfaces` report `found = true` with an **empty** ordering — `cell_index` returns `None` and `set_above`/`infer_above` treat that as a no-op | `folding.rs:4451-4455` |
| ~~A disconnected face graph leaves unreached faces at position 0 with `associated_line: None`, so `fold_movement` returns them **unfolded**; above ~200 faces the Euler gate stops catching it~~ — **fixed, Phase 1**: `FoldGraphError::DisconnectedFaces` | `fold_graph.rs`, `:200-202` |
| `HierarchyTable::from_initial` does `let _ = table.infer_above(...)`, so two contradictory seeds make the first win and the second vanish | `folding.rs:4446` |
| **An interior `Black0` loop makes `is_interior_vertex` decline every hub vertex, so `CheckCamv` reports CLEAN on geometry it never checked.** Measured on `known-good/byu solar driven.fold`: 0 flat, 0 closure, worst interior residual 2.6e-12°, placement loop gap **1.445 rad** on a 400 span. Shipped today, flat path included (Spike A, R19). **Named, Phase 1**: `interior_border_segments` + a `SpatialInteriorBorder` warning. The refusal is still Phase 5's | `checks_spatial.rs:647-653` |
| `subface_top_stack` drops a tied face into a hole and the caller falls back to an arbitrary `face_ids.first()` | `folding.rs:3996` |
| ~~Geometry the Euler gate rejects returns `Ok` at Step1 with `status: 'ready'` and no message, because `isDrawableFoldResult` is only called on the refold path~~ — **fixed, Phase 1**, and the draft figure is dropped rather than left errored | `creasePatternSlice.ts` |
| `bsp.ts` promotes the splitter to the front of its own coplanar list, and `sortCoplanar` sorts on `kind` alone, so coplanar faces emit in caller input order | `bsp.ts:253`, `:277` |

None of these is caught by looking, and the automated browser pane runs with
`visibilityState=hidden` and zero rAF, so canvas repaint cannot be
agent-verified at all. That is why the work is sequenced kernel-first: every
load-bearing claim is a number or an enum `cargo test -p oristudio-cp` can
assert.

**Phases 2–9 all land on one branch before it merges.** **[rewritten — was
2–8; Spike C moved Phase 9 in. Phase 9 is now built.]** No flag, no experimental label. The phases are
work order, not release order. Removing any one produces an inconsistent state:
without Phase 4's census the render invents a stacking three different ways;
without **Phase 9** the render has no opaque part to show on any real model
(measured: the undetermined fraction is 1.00 on 12 of 14); without Phase 7's
i18n `npm run i18n:check` fails CI outright; without Phase 8 a saved 3D figure
either never goes stale or reads back as a refoldable flat one.

**Phase 1 is built, and it went first.** **[rewritten — it said "ships alone, on
its own PR". The repo owner said everything on this branch lands in one pull
request, so it is the first work rather than a separate release. Nothing else
about it changed: it touches no 3D code and blocks nothing.]** It is pure
flat-path correctness plus instrumentation — four measured live bugs in shipped
code (R19 among them, found by Spike A: `CheckCamv` reports CLEAN on a document
with an interior border loop, on a model in the corpus's own `known-good/`) and
the analytics events that buy the one number nobody has. See the Phase 1
checklist for what each of them turned out to be.

**Phases 10–11 follow separately**, because their absence subtracts rather than
corrupts: without enumeration the cycling verb is correctly disabled; without
the FOLD `foldedForm` frame the figure still exports SVG/PNG. The old reason for
putting Phase 9 here — "a figure with coplanar overlap *says so*" — was measured
false: saying so leaves nothing drawn opaquely.

### What the merge set delivers, honestly

**[rewritten twice — Spike C retired this section's original premise, and the
audit of Spike C then retired the rule Spike C replaced it with.]**

The census is **not** zero on 3D models generally. Over the 18 models Spike C
admitted it is 0 on four, with a true median of **81.5**, a mean of 1,419 and a
max of 12,736. The four zeros have 2, 5, 6 and 6 faces; **no admitted model
above 8 faces measured zero.**

The one statement that is a theorem, and the only one to plan on:

> **census ≥ (number of creases at exactly ±180).**

A full fold lays two faces into one plane on the same side of their shared edge,
and two polygons sharing an edge segment on the same side always overlap in
positive area. It needs no placement to compute, held on 18 of 18 admitted
models, and was tight on `waterbombBase` (4 = 4). **Any full fold forces layer
ordering.**

**The converse is false, and it was briefly written into this plan as a decision
rule.** A 5-panel strip creased at +90° four times — a paper tube with a glue
flap, one of the most ordinary 3D forms there is — has zero full folds and
measures **census 1**, on a *non-adjacent* pair. Nine panels measure 6; seven
panels at +120° measure 5; the 4-panel control (an open box that does not wrap
onto itself) measures 0. So "no crease at ±180" guarantees nothing, and
`cubeunwrapping` should be described as *"measures 0 at 6 faces"*, never as
*"provably opaque"*. Nothing in the pipeline detects the wrap-onto-itself case
short of running the census.

The number that actually decided the phase order is not the pair count but the
**undetermined fraction** — the share of faces sitting in a plane with at least
one overlap. It is **exactly 1.00 on 12 of the 14** non-zero models, 0.991 on a
13th, and 0.64 only on `tooling__base_fixed`, an 11-face toy. So "render
translucent and name the pairs" leaves **no opaque part** on any real model:
that is not a smaller feature, it is a picture with no information in it.

**Phase 9 therefore moves into the merge set.** §7's open question about
constraint-component structure is no longer what decides it, and Phase 5's
verdict surface no longer needs a "drawn but undetermined" *mode* — at most a
narrow annotation.

### Three things that must not be split across the merge boundary

- **The parity-locked engine surface.** `CP_ENGINE_COMMANDS`
  (`session.rs:39-76`, **36** names today — counted), the wasm bridge, the
  worker, the native client, `NATIVE_CP_COMMAND_NAMES` and the Tauri
  registration, **and the committed `.wasm`** — one commit, or CI fails and
  desktop silently diverges.
- **The routing predicate and all three doors** (above). Splitting them leaves a
  live path into the flat kernel with non-classic creases in scope.
- **Every new inline-English string with its eight locales.** `i18n:check` is a CI
  gate.

## Approach

### 1. Placement: reuse the walk, replace the mirror

`FoldGraph::face_positions` (`fold_graph.rs:167`) already builds the dual-graph
spanning tree and `fold_movement` (`:381`) already walks it. The only flat line is
`find_line_symmetry_point` at `:389`, a 2D mirror. The 3D version composes a
signed rigid rotation about the crease axis in *unfolded paper* coordinates.

**[built — the shape below is what shipped, which differs from the proposal in
three ways, each noted in the Phase 3 checklist: one error enum rather than two,
`FacePositions` not leaked (it is `pub(crate)`, so the tree is re-exposed as
`parent` / `parent_line`), and `joins` carried rather than re-derived.]**

```rust
// crates/oristudio-cp/src/folding3d/placement.rs
pub(crate) fn place_faces(
    graph: &FoldGraph,
    starting_face_id: i32,
) -> Result<Placement3d, Fold3dRefusal>;

/// The same walk over a segment slice, applying no admission gate.
pub fn place_segments(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Placement3d, Fold3dRefusal>;

pub struct Placement3d {
    pub points: Vec<Point>,
    /// Counter-clockwise, reversed once from `FoldGraph`'s clockwise rings (R20).
    pub rings: Vec<Vec<usize>>,
    pub face_transforms: Vec<Rigid>,
    /// Per face, its own image of its own ring. Deliberately not a shared point
    /// array — see below.
    pub face_points: Vec<Vec<Vec3>>,
    pub face_normals: Vec<Vec3>,
    pub starting_face: usize,
    pub parent: Vec<Option<usize>>,
    pub parent_line: Vec<Option<usize>>,
    pub span: f64,
    /// Every pair of faces meeting across a crease, and whether the tree used it.
    pub joins: Vec<FaceJoin>,
    pub loop_gap: LoopGap,
}
```

Four things this signature encodes:

**Per-face point images, never a shared array.** `folded_points`
(`fold_graph.rs:140-161`) sums `fold_movement` over incident faces and divides.
In 2D a mirror maps the plane to itself so residual stays in-plane and is
re-absorbed; in 3D the same residual becomes out-of-plane displacement, and
averaging is exactly the operation that destroys the evidence (§1a). There must
be nowhere to average.

**The angle is `crease_fold_angle`, applied directly.** `crease_fold_angle`
(`model/mod.rs:527`) returns the FOLD angle — 0 unfolded, ±180 fully folded — and
the shipped `crease_quat` (`checks_spatial.rs:117-125`) applies ρ directly. `π − ρ`
is excluded: a classic crease would rotate by 0 or 360° and not fold at all. The
research doc's §1a writes `π − ρ` using ρ as the *dihedral* angle; the two
symbols are supplementary, and the kernel's is the one that matters. **Settled —
do not relitigate.**

The signed magnitude is recoverable during the walk because
`FoldGraph::from_segments` (`fold_graph.rs:81-92`) pushes one `GraphLine` per
input segment in order and keeps `segments: segments.to_vec()`, so
`associated_line[child]` indexes both.

**Reuse `checks_spatial`'s quaternion primitives verbatim** — `Quat`, `Vec3`,
`axis_quat`, `quat_mul`, `quat_rotate`, `quat_conj`, `quat_residual`, reachable
from a sibling module. Placement and the admission gate must share one
handedness, or the gate certifies states the renderer draws mirrored. **Built:**
the two type aliases were promoted from `pub(crate)` to `pub` rather than
re-typed in `folding3d`, because a second alias for one layout is a second
convention waiting to disagree.

One primitive is new rather than reused. `Rigid::rotation_angle_to` measures the
angle between two rotations as `2*atan2(|v|, w)` on the relative quaternion,
folded into `[0, pi]` — **not** `acos((trace-1)/2)`, whose square-root
conditioning floor at `sqrt(2*eps) = 1.5e-8` reports a uniform fake 4e-8..9e-8
rad gap on every closing model. The Spike A harness works around this with a
Frobenius form; the quaternion form needs no workaround.

**Disconnection is a typed error.** Landed on the **flat** path in Phase 1, where
it belonged: `face_positions` itself returns `FoldGraphError::DisconnectedFaces`,
so the `face_position[f] == 0` scan this section proposed is unreachable and
`place_faces` only has to map the error. Before Phase 1, `:164` broke out on an
empty frontier and the unreached faces came back unfolded, with
`initial_hierarchy_from_graph`'s parity abort — the check §3b requires deleting —
as the only backstop.

#### The convention, settled by Spike B

**[rewritten — this section used to say the axis direction and composition order
were "genuinely open". Spike B ran, and they are not.]**

> **M_child = M_parent ∘ Rot_paper(line, ρ)**
>
> Right-compose. The rotation is taken in **paper** coordinates about the crease
> line. The axis direction is the direction in which the **child** face's own
> winding traverses that edge. ρ is the signed FOLD angle (valley +, mountain
> −). Faces are globally wound so the largest has **positive signed (shoelace)
> area** in the xy paper plane.

This is `vertex_link_polygon`'s `frame = quat_mul(frame, crease_quat(theta, rho))`
(`checks_spatial.rs:244`) lifted from directions-at-a-vertex to rigid motions —
not a new convention, the shipped one. Evidence and the equivalent restatement
(`M_child = Rot_world(M_parent(line), ρ) ∘ M_parent`, agreeing to 1.2e-15) are in
"Spike B answer" below.

**One consequence that must not be lost, because the plan gets its faces from the
one code path Spike B never exercised.** `FoldGraph::faces` are guaranteed
**clockwise** in y-up paper coordinates, which is the exact mirror of the
convention above. `should_add_face` (`fold_graph.rs:334-348`) rejects any traced
face with `face_area(...) <= 0.0`, `face_area` (`:444-450`) calls
`Polygon::calculate_area` (`geometry/polygon.rs:207-221`), and that function
returns the **negated** shoelace — so a face is admitted exactly when its
standard shoelace area is negative. Measured on a unit square split by one
diagonal: faces come back `[0,2,1]` and `[0,3,2]`, shoelace −0.5, `calculate_area`
+0.5. Meanwhile the FOLD files Spike B validated against are 484 CCW / 0 CW.

So Phase 3 must **reverse every `FoldGraph` face** (equivalently negate ρ once,
globally). This is mandatory and its direction is known; it is not a bit to be
discovered by inspection. `align_face` (`:424-432`) only rotates the cyclic list
and never reverses, and `r_point` (`:250-283`) traces uniformly, which is what
makes one global reversal sufficient. Assert both halves: that `FoldGraph::faces`
come back clockwise, and that the placed root face's normal points the intended
way after reversal.

Three properties of any test that claims to pin this down:

- **Compare the whole placed face — every vertex plus the normal — never a probe
  point.** At (90, 90) a sign fault leaves the obvious free vertex fixed to
  6.7e-16 while moving the rest of the face by 1.414.
- **The tolerance must be tight.** On a degree-3 fan with ρ of 5 / −11 / 3
  degrees, a left-compose fault deviates by only 1.5e-2. Anything looser than
  ~1e-6 lets it through.
- **Path-independence is not the headline test.** Negating every ρ is
  path-independent everywhere (measured: vertex spread identical to correct on
  every fixture), and so is the loop-residual-vs-`vertex_closure_residual`
  comparison, because the residual depends only on the quaternion scalar part,
  which is invariant under negating every ρ. Only the dihedral round-trip and the
  `vertex_link_polygon` comparison can see a global sign flip.
- **[new, Phase 3] Neither is a fan, for composition order.** The dual graph of a
  degree-3 fan is a triangle, so the shipped BFS reaches every face in **one**
  step from any root and left- and right-composition are both `I ∘ step`. Spike
  B's fault injection ran on fans; the left-compose fault is invisible there
  (measured 2.5e-16), and only a chain — three faces in a path — catches it.
  Whatever else a convention test does, some face in it must be two steps from
  the root.
- **[new, Phase 3] And the dihedral round-trip must run on the NON-tree joins.**
  A tree join is exact by construction — the walk built the child by rotating it
  exactly that far — so a round-trip over the tree is a tautology. Measured: the
  tree-only form reads 2.8e-14 on `rabbit_unclosed`, a model whose worst error is
  70.5°; over the non-tree joins it reads that 70.5°.

### 2. Admission: reuse the check the flat path already makes

**[built. One argument, not two: a gate that took a document *and* a slice of it
could have the two disagree about what is being folded, which is the whole shape
of the row-(b) bug.]**

```rust
// crates/oristudio-cp/src/folding3d/admit.rs
pub fn admit(
    segments: &[LineSegment],
    starting_face_id: i32,
) -> Result<Admission, Fold3dRefusal>;

pub struct Admission {
    pub placement: Placement3d,
    pub diagnostics: Fold3dDiagnostics,
}

impl Admission {
    /// The first two arms of the three-way verdict. The third — no valid layer
    /// order — belongs to Phase 9.
    pub fn outcome(&self) -> Fold3dOutcome; // Folded | LocalCrossing
}
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

2. **`checks_spatial::dispatched_camv`** (`checks_spatial.rs:1163`) — **not**
   `spatial_vertex_reports` (`:864`). **[rewritten — the reason given here was
   wrong.]** Both filter the spatial branch to interior vertices
   (`:874` and `:1072`). The two real differences: `dispatched_camv` routes flat
   vertices to `checks::find_flat_foldability_violation` (`:1062-1066`), so a
   mixed pattern's flat vertices are actually checked; and
   `spatial_vertex_reports` early-returns empty on a document with no non-classic
   crease (`:865-867`). The recommendation stands.

   Note this step now also carries the **local crossing** verdict for free:
   `dispatched_camv` already consults `vertex_link_verdict` and
   `spatial_closure_diagnostics` (`lib.rs:3051-3085`) already emits
   `SpatialSelfIntersection`. Spherical simplicity is shipped; the 3D path
   consumes it rather than re-deriving it.

3. **No border segment with paper on both sides.** **[new — Spike A / R19;
   updated — the *detector* shipped in Phase 1, the refusal is still this
   phase's.]** An interior `Black0` segment is a **cut**, not a hinge, and
   `is_interior_vertex` (`checks_spatial.rs:647-653`) returns false for every
   vertex touching one — so `dispatched_camv` returns CLEAN on geometry it never
   examined. Phase 1 added `checks_spatial::interior_border_segments`, which
   answers this from the traced arrangement (a boundary segment belongs to one
   traced face, an interior one to two) and is already carried on
   `DispatchedCamv::interior_borders`, so this step **consumes** it rather than
   deriving it again. This is not
   hypothetical: `known-good/byu solar driven.fold` contains a closed hexagon of
   six `B` edges well inside the sheet, reports 0 flat / 0 closure / worst
   interior residual 2.6e-12°, and places with a loop gap of **1.445 rad**.
   Refuse it, with its own `Fold3dRefusal` arm. `import_fold_document` also maps
   FOLD `C` (cut) to `Black0` (`model/mod.rs:508`), indistinguishable from a
   paper boundary, so kirigami arrives through the same door — `cuts` and
   `honeycombKiri` in the corpus have 482 of 482 and 242 of 242 dual cycles the
   spatial check declines.

4. **`place_faces`**, propagating its typed errors.

5. **Loop gap — GATING.** **[rewritten — was "reported, not gating in v1". Spike
   A refuted the argument for that.]** The old argument had two halves. The first
   is true and I reproduced it: `calculate_faces` (`fold_graph.rs:229-253`) traces
   every positive-area bounded region, so a drawn ring **does** come back with its
   hole filled, and the object folded is simply connected. The second half — that
   on a disk the loop gap therefore follows from per-vertex closure (§2b T1) — is
   where it fails, because after the fill those hub vertices are genuinely
   interior and `is_interior_vertex` still declines them for touching `Black0`.
   **The defect is closure-check coverage, not paper topology.**

   Measured, with the annulus fixture the Spike A harness builds
   programmatically: a 200×200 ring with four radial creases at 90° yields 5
   faces, passes the Euler gate, and `dispatched_camv` reports **0 flat / 0
   closure / 0 spatial vertices examined at all** — while the placement loop gap
   is 1.571 rad with the hole filled and **2.094 rad** with the hole face deleted,
   the latter bit-for-bit the research doc's §2b T2 number for (90,90,90,90),
   reproduced independently in NumPy to 1e-15. Across 63 files the correlation is
   exact: `interior_borders > 0` **iff** `blind_cycles > 0`.

   Also note the plan's own supporting claim was wrong: `faces_vertices` **is**
   read on import — `frame_score` (`io/fold.rs:59-66`) uses
   `!frame.faces_vertices.is_empty()` to rank which embedded frame to import,
   even though `import_fold_document` (`:168-202`) then builds the model from
   `edges_vertices` alone.

   So: compute the loop gap over non-tree dual edges, **gate on it**, and report
   `worst_loop_edge`. The `#[cfg(test)]`-only assertion this plan used to propose
   is not enough — it is vacuous on a fixture set that happens to exclude holes,
   and the substantive requirement is the **elementary per-vertex cycle** form
   plus an explicit blind-cycle count, which the committed
   `crates/oristudio-cp/src/spike_fold3d.rs` harness already computes. This
   converts [`non-180-fold-angles.md:854`](non-180-fold-angles.md#L854)'s open
   item into a shipped gate rather than a monitored invariant.

   **[built, with the blind-cycle count dropped.]** The gate is on the offset
   relative to span, and `LoopGap` carries `worst_edge`, `worst_vertex`,
   `non_tree_edges`, the elementary per-vertex cycles and their worst residual.
   The blind-cycle count **cannot fire** and so was not built: the walk refuses
   `NonCreaseJoin` on any dual adjacency carrying no fold angle, tree edge or
   not, so a document that places has no interior border anywhere — and a blind
   cycle needs one at a vertex whose face ring closes, which means every edge
   there has two faces.
   `a_placement_that_succeeds_has_a_crease_on_every_dual_adjacency` asserts that
   equivalence. The R19 detector is Phase 1's `interior_border_segments`, and the
   gate consumes it at step 3, before the placement runs.

   One consequence for the loop-gap **fixtures**: `LoopNotClosed` is reached by
   nothing in the whole 65-file corpus, because the coverage hole that made the
   implication false is now refused a step earlier. It stays as defence in depth.

6. **Plane separation as a spectrum-gap test, not a minimum.** The naive metric
   cannot gate. Measured three ways now. Computed on the same perturbed state
   that produced the loop gap it returns ratios of 0.0066 / 0.0056 / 0.0020 — the
   window *inverted*, because the 4–6 decades in §2c take the numerator from the
   exact state and the denominator from the perturbed one. On a real flat base
   shaped in 3D it returns `+inf` with a perfect hinge (zero parallel distinct
   pairs, certifying nothing) or per-layer drawing blur below `Epsilon::POINT`
   (2.5e-4, `geometry/epsilon.rs:24`) with a realistic one — 122 of 153 pairwise
   gaps at 90°, 153 of 153 at 30°. And on the corpus (Spike A) it is **`+inf` on
   6 of 16** folding models, and on `airplane` it is 5.804e-6 on a 400 span
   (1.45e-8 relative) where it is measuring the file's 6-decimal coordinate
   rounding, not separation.

   Instead: **classify coplanarity by topology first** (faces joined through
   exactly-180° creases are coplanar by construction, ~~which on a flat base
   classifies most of the model for free~~), then sort the remaining parallel-plane
   separations and require a gap wide enough to seat `dist_tol`. Report the gap
   width. **[corrected in Phase 4 — the parenthesis is true only in the flat
   regime, and topology is not what builds the partition.]** On an all-180
   document ±180-connectivity is the whole answer (`box_90_unangled`, 1 class = 1
   plane). On a document with real 3D angles it **over-splits**: `box_90` 5
   classes over 4 planes, `spikes_large` 34 over 8, `origamisimulator` 68 over 29.
   Geometry does the merging; topology is a seed and an alarm. Phase 4 also builds
   the partition as the connected components of the coplanarity relation rather
   than by any sorted-and-merged pass, because a greedy one is order-dependent on
   a chain — see its checklist. Spike A supports this directly: the separation spectrum is cleanly
   bimodal on **15 of 16** folding models, with an empty band six decades wide —
   `spikes_better [203,0,0,0,8]`, `cross [454,0,0,0,1]`,
   `origamisimulator [2608,0,0,0,26]`. `airplane` is the lone exception in that
   pool, with one separation in the 1e-9..1e-6 band, and it is still admitted.

   **[corrected in Phase 2 — the sentence that used to follow, "the band only
   fills in on models that already fail closure (`polygami
   [1610,2,173,65,105]`)", is false, and it is the half a gate would have been
   built on.]** The committed `penguin_freeform` fixture is **clean and
   admitted** — 0 flat, 0 closure over 36 spatial vertices — and its spectrum is
   `[94, 12, 0, 0, 0]`: twelve separations in the 1e-12..1e-9 band and **none at
   all above 1e-3**. Its minimum is 6.6e-10 on a 400 span, 1.7e-12 relative,
   which is *below* the relative loop gap on the same model. So the bimodality
   is a property of 45°/90° lattice designs, not of admissibility: every model in
   Spike A's pool with an empty band is on a 45° or 22.5° system, and the one
   genuinely free-form clean model fills it. Reproduce with
   `cargo run -p oristudio-cp --release --example fold3d_census --
   tests/fixtures/fold-angle-3d`. The spectrum-gap test still stands as the
   replacement for a minimum-separation gate; what does not stand is any
   expectation that the gap is there to be found.

   **[Phase 3 reports the spectrum and gates on nothing.]**
   `Fold3dDiagnostics::separation_bins` and `min_plane_separation` carry it, and
   the normal grouping behind them is deliberately the crudest one that produces
   the number — a measurement of the placement, not a classification. **The
   topological-first classification is Phase 4's**, and it must not be half-built
   here: coplanarity under a tolerance is not transitive, so a grouping that
   nothing consults is harmless and one the census consults is R5.

**Dimensionally distinct tolerances**, carried in `Fold3dDiagnostics` and
inspectable: `ang_tol` in radians on normals (scale-free) and `dist_tol` relative
to paper span. One distance tolerance is wrong because within-CP crease-length
range on real CPs is p50 24× / p90 79× / max 221× (§4.4), implying a critical fold
angle varying two decades inside one document.

**[corrected in Phase 3: `len_tol` is not declared.]** It was to be the length
below which a crease has no direction worth rotating about, and there is no such
crease — `FoldGraph::from_segments` merges endpoints within `Epsilon::POINT`
(2.5e-4), so anything reaching the arrangement with two distinct endpoints is at
least that long, and anything that does not is an exact zero the walk already
refuses. A constant nothing consults is worse than no constant. **[Phase 4 declared a
fourth bar, and it is an *area* rather than a length.]** The census's question is
whether two coplanar faces share paper, and two faces meeting along a shared edge
share an exactly measure-zero sliver of it, so `overlap_area_relative = 1e-9` of
span² is what it needed. `len_tol` still has no referent.

**No user-facing tolerance control, ever.** None exists anywhere in the app today
(`settingsStore.ts` has no epsilon of any kind), and the right value depends on
computed plane separation — information the person being asked does not have.
Non-180 already rejected per-provenance thresholds because "provenance is not
durable"; a per-document dial is the same mistake. Report the number on the
verdict; never offer the dial. All thresholds live in **one const block** beside
`CLOSURE_RESIDUAL_BAR_DEGREES` (`lib.rs:2887`), not in TypeScript — splitting
policy across the wasm boundary breaks the "revising it is one constant" property
that motivated the rule.

**Make `CLOSURE_RESIDUAL_BAR_DEGREES` reachable while doing it.** The admission
classification steps 2–3 describe already exists as `spatial_closure_diagnostics`
(`lib.rs:3051-3085`) — skip indeterminate, apply the bar, then ask
`link.self_intersects()` — and because the constant is private it had been copied
into **five** files, each redeclaring it with a comment saying so:
`examples/fold_corpus_scan.rs`, `examples/fold3d_census.rs`,
`src/spike_fold3d.rs`, `tests/verify_fold_fixtures.rs` and
`tests/non_flat_corpus.rs`. Six copies of one policy number is exactly what the
"revising it is one constant" rule exists to prevent. **[done in Phase 3 — the
constant is `pub` and all five read it.]**

One thing the gate does **not** copy from `spatial_closure_diagnostics`, and the
difference is deliberate: that function reports nothing for an indeterminate
vertex, because a false positive is worse than silence on a diagnostic overlay. A
fold has to *place* the vertex and cannot, so `admit` refuses it.

#### What the gate can and cannot read

`CheckCamv` is an `OperationId` (`lib.rs:492`) routed through the generic
`execute_cp_command`, **not** a `CP_ENGINE_COMMANDS` entry — so reading its
diagnostics costs none of the five-site parity tax. Verified by execution: a
mixed document returns `CheckCamv` and `SpatialClosure` entries side by side in
one `diagnostic_entries` array, both kinds runtime-distinguishable, and both
literals are present in the tracked `.wasm`.

But a spatial entry is `{id, kind, message, point, rule, severity}` — `segments`
is dropped by `skip_serializing_if = "Vec::is_empty"` (`lib.rs:253`). **Membership
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
span every plane in the model.** ~~Measured on Kabuto (18 faces, flat): 117
ordering variables in components `[81, 18, 18]` — the largest is 69% — with
transitivity at 420 of 529 constraints (79%).~~ **[corrected — `[81, 18, 18]` is
not a component decomposition, and reading it as one made the graph look friendlier
than it is.]** `treemaker-flatfold`'s `variable_groups`
(`constraints.rs:613-685`) pushes the **assigned** variables as group 0 and then
the free groups; `solve_constraint_state` (`:167-174`) hard-codes group 0's
solution set to the single assigned vector and skips it, which is why the
solution counts read `[1, 3, 3]`. So Kabuto is 81 M/V-propagated variables plus
two free groups of 18, not three components. Its raw constraint graph is **one
component of 117**, and Phase 9 measured the same thing over the corpus: the raw
graph is a single dominant component on most admitted models, and on the 1×4
strip that motivates this whole section it is a single component of 2.
Transitivity at 420 of 529 (79%) is unaffected and is why.

Per-component solving stays, but the justification changes with it: the
decomposition comes from the **determinations** — full folds, walls, the
shared-slot rule — not from any structural property of the graph. Say it that
way, or the next reader plans capacity against a decomposition that is not there.

Two consequences the plan is built around:

- The **census** (Phase 4) counts variables, which is sound, and is therefore a
  *lower bound on where ordering matters* — never a claim that the planes are
  independent.
- The **solver** (Phase 9) must key on constraint-graph components. ~~Coupling is
  also not expressible as an `EquivalenceCondition`: `apply_quadruple_condition`
  (`folding.rs:4660-4704`) reads above/below cells in one frame, but "above" for a
  face in plane P is relative to `up_P` and in Q to `up_Q`, and P and Q share only
  a line. The real condition is non-interleaving of four half-planes in cyclic
  order around that line — a different constraint kind.~~ ~~**v1 detects coupling
  and refuses**, loudly, rather than answering definitely and being wrong.~~
  **[refuted in Phase 4 — refusing is not a scoped v1, it is declining the
  feature.]** Phase 4 built the detector (`folded_line_index`) and measured it:
  **every** admitted corpus model above six faces has at least one folded line
  whose creases carry faces in two or more planes — 15 of 15 — and so do four of
  the five committed 3D fixtures, `box_90` (the smallest real 3D fold) included.
  Coupling is the normal case, not the adversarial one. So Phase 4 emits it as
  data, no `Fold3dRefusal::CrossPlaneCoupling` arm exists, and the ordering solver
  has to carry the constraint rather than decline it. The classifier is not
  over-firing: it reads **0** on every flat fixture, which has one plane and so
  nothing to couple.
  **[corrected in Phase 9 — "a different constraint kind" is half right, and the
  wrong half is the one that costs.]** The *condition* is different and the
  *vocabulary* is not. `check_quad` is not about planes at all: given four faces
  with `a, c` known to be above `b, d`, its eight rules collapse to exactly
  `[a above c] != [b above d]`, which is a signed relation between two order
  variables and so is precisely the coupling. Two things make that usable, and
  both are the plan's own hazards in a new costume. The "known to be above" has to
  be supplied, because a cross-plane pair carries no layer meaning — so the slots
  around the line are given a fixed order, a *cut* of their cyclic order, keyed to
  the **planes** rather than to the angles, since a face can meet two collinear
  folded lines from opposite sides and an angle-keyed cut then contradicts itself
  (measured on `spikes_large`). And the sign has to be encoded in which of `b`,
  `d` takes which role, because two planes meeting at a line can disagree about
  which way their stacks wind. The four faces also get a merged `SubFace`, without
  which the condition is invisible to the per-subface pruning and reaches the
  search only at the final estimation — where the blame path resets the guilty
  generator instead of advancing it and reports "no valid order" on a satisfiable
  instance.

**No acyclicity assertion, anywhere, and no topological sort (§5.4).** A cyclic
panel order is legal: He & Guest name the classical square twist with
`a > b > c > d > a`, and all four panels are coplanar and overlap-connected so
they land in one cluster — "per cluster" does not save the assertion. What *is*
required is antisymmetry and **determinacy**: every intra-cell pair decided, and
undetermined pairs reported rather than tie-broken. Resolution is **per
arrangement cell**: on pinwheel geometry the largest simultaneously-overlapping
subset of the four bars is 2, so every cell has a well-defined winner even though
no linear order exists.

### 4. The census: where ordering matters, without a cell decomposition

The load-bearing reuse claim from the research — that per-plane splitting lets
the shipped `prepare_subface_segments` → `FoldGraph::from_segments` →
`configure_subfaces` chain run unchanged on projected coordinates — is
**measured false**. `calculate_faces`'s Euler gate
(`euler == 1 || (euler - 1).abs() <= 0.005 * faces.len()`, `fold_graph.rs:249-251`)
rejected **4 of the 6 multi-face plane patches** across six elementary 3D forms —
a one-step offset pleat, a two-step offset pleat, and a bridge/tuck. Per-plane
splitting makes the gate *stricter*, since the 0.005 tolerance needs ~200 faces in
one plane to open, and all 70 accepted patches yielded exactly one subface.
`face_request` also returns the moment `face.contains(&next_point)`
(`fold_graph.rs:287-290`), so it structurally cannot trace an annular cell; a
nested tongue landing back in its own base plane needs *two* injected cuts.

**[rewritten — this used to say "the merge set sidesteps this completely, and
that is the whole reason a smaller increment is honest here". Spike C moved Phase
9 into the merge set, so the arrangement is no longer avoidable; only the *census*
avoids it.]** What survives is the division of labour: the census answers
*"where does ordering matter"* without any cell decomposition, and Phase 9 does
the decomposition. What does not survive is the idea that stopping after the
census ships something honest — measured, it ships a fully translucent picture.
~~The consequence is that **R3 is escalated to merge-blocking**: Spike A's
plane-patch half must settle before merge.~~

**[corrected in Phase 9 — the diagnosis is right and the prescription was not.]**
Both failure modes are real and both reproduce, but neither needs a cut injected.
The Euler gate is `V - E + F = 1`, which holds for a **connected** planar
subdivision, and a per-*plane* split makes the arrangement disconnected far more
often than it makes it big — so the gate closes on the split rather than on the
geometry. Grouping instead by **connected overlap component** (and then by segment
connectivity) restores `euler == 1` by construction, and an annular cell cannot
arise inside a connected component at all, which is exactly the case
`face_request` cannot trace. The remaining trap is a *pinch*: two regions of one
component meeting at a single vertex, where the smallest-angle trace walks across
into the neighbour and returns the outer boundary. Overlap grouping separates
those too, because faces that merely touch do not overlap. Measured, every
admitted corpus model decomposes.

**The census is a direct polygon clip-and-area count on projected face polygons.**
It needs overlap detection, not cell decomposition, so it never calls
`calculate_faces`. Its output is:

```rust
// As built. `undetermined_patches` did not survive: nothing in Phase 4 can
// decide a patch, so the field would have been an empty vector claiming a
// verdict the census does not compute.
pub struct Fold3dCensus {
    pub pairs: Vec<CoplanarPair>,   // the ordering variables themselves
    pub plane_count: usize,
    pub patch_count: usize,
    pub face_count: usize,
    pub overlapping_pair_count: usize,
    pub non_adjacent_pair_count: usize,
    pub faces_in_overlap: usize,
    pub full_fold_creases: usize,   // the fixture README's +/-180 column
    pub full_fold_pairs: usize,     // the theorem's left-hand side
    pub min_accepted_area_relative: Option<f64>,
    pub max_rejected_area_relative: f64,
}
```

- `overlapping_pair_count == 0` → every face is trivially its own cell. No
  arrangement, no `SubFace`, no hierarchy is needed to draw a complete picture.
  Render opaque. **Measured on 4 of 18 admitted corpus models, all of them 2 to 6
  faces** — a real case, not the common one, and not predictable in advance:
  `census ≥ (creases at ±180)` bounds it from below with no placement, but
  nothing short of running the census tells you a wrap-free net like a paper tube
  is going to measure 1.
- `overlapping_pair_count > 0` → Phase 9 resolves it. It is **not** a render
  mode: the undetermined fraction is 1.00 on 12 of 14 non-zero corpus models, so
  "render translucent and name the pairs" leaves nothing opaque. Keep translucency
  as a **narrow per-face annotation** for pairs Phase 9 itself cannot decide, not
  as the answer for a non-zero census.

**Free cross-check, and it is already satisfied.** On an all-180 document the
census must agree with `treemaker-flatfold`'s own ordering-variable count.
`build_variables` (`crates/treemaker-flatfold/src/constraints.rs:202`) is a BFS
over the cell graph seeded at `cells_faces.first()`, so it is not literally *all*
overlapping pairs — the plan expected a gap and told the implementer to measure
it first. **There is no gap.** Spike C's independent census counts 117 pairs on
`tests/fixtures/flat-folder/kabuto.fold`, matching the solver's 117 ordering
variables exactly, and the audit extended it: `treemaker-triad-base` 15/15 and
`accordion-book-fold` 3/3 also agree (both under
`tests/fixtures/folding-sequence/fold/`). So treat a disagreement as a **defect**
rather than something to characterise. Two independent implementations of one
quantity is the strongest check available and it uses a crate already in the
workspace.

### 5. Rendering: projected primitives on the CP canvas

**Decision: the kernel emits a view-independent 3D payload; TypeScript projects
it into the existing 2D primitive stream; the CP canvas draws it unchanged.**

**[built in Phase 5, and the sketch below was wrong in two ways.]** The shipped
shape is struct-of-arrays rather than `Vec<Struct>`, and it carries **cells**
as well as faces — a per-face fill cannot express the ordering, because a cyclic
panel order is legal and no per-face scalar survives one.

```rust
// crates/oristudio-cp/src/folding3d/model.rs — view-independent, camera-free
pub struct Folded3dRenderModel {
    pub ring_points: Vec<f64>,   // 3 per vertex, face rings concatenated
    pub face_attr: Vec<i32>,     // 4 per face: plane, ring_start, ring_len, facing
    pub face_normals: Vec<f64>,  // 3 per face
    pub plane_frames: Vec<f64>,  // 12 per plane: up, origin, u, v
    pub cell_points: Vec<f64>,   // 3 per vertex, cell rings concatenated
    pub cell_attr: Vec<i32>,     // 7 per cell, incl. stack slice and determinacy
    pub cell_stack: Vec<u32>,    // face ids per cell, TOP first
    pub edge_points: Vec<f64>,   // 6 per edge
    pub edge_attr: Vec<i32>,     // 4 per edge
    pub edge_fold_degrees: Vec<f64>,
    // + counts, span, schema_version
}
```

Measured on the largest admitted corpus model (`origamisimulator`, 2,637 faces,
9,792 ring vertices): `ring_points` is **235,008 bytes**, against **609,322
bytes** of JSON and roughly 12,000 JS arrays for the nested
`Vec<Vec<[f64; 3]>>` shape the sketch implies. For calibration, the flat render
snapshot the app already tolerates measures 1,228 bytes per face on
`kabuto.fold` — about 3.2 MB extrapolated to 2,637 faces — and that object is
built on the **main thread and never crosses the worker boundary**. Only the
235 KB payload does.

```ts
// apps/web/src/cp-workspace/folded/foldedFigure3dProjection.ts
export function projectFolded3dModel(
  model: OristudioCpFolded3dRenderModel,
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

Four already-tested, DOM-free modules do the work: `camera.ts:125`
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
kernel display style — and as an annotation, not a mode.** **[rewritten — the
mechanism stands, its scope does not.]** The tempting answer is Oriedita's
`Transparent3`. It does not work: `needs_subfaces` (`folding.rs:2232-2235`)
includes `Transparent3`, so that style requires
`folded_subface_graph_and_config`, and the projector needs to be able to flag
individual faces rather than the whole figure. Draw translucent per-face fills
with the undetermined faces flagged, reusing the contradiction overlay's
translucent-red vocabulary (`cpFoldedToScene.ts:495`) generalised from a pair to a
list with a reason tag.

What changed is when it fires. This was the *degraded mode for a non-zero
census*, and measured that would make it the **default on every real model** —
undetermined fraction 1.00 on 12 of 14. With Phase 9 in the merge set it fires
only on pairs Phase 9 itself could not decide, which is what the vocabulary was
designed for.

Two smaller notes. `Development1` and `Development4` need **no** 3D reading:
measured, both emit zero primitives (`folding.rs:3155-3197` has arms only for
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
(`apps/web/src/cp-workspace/folded/foldedFigureActions.ts:185-227`) derives:

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
  "Case {n}" with no denominator (`CreasePatternPanel.tsx:601`).
- **The wrap must stay repeatable.** `restart` re-derives
  `find_another_overlap_valid` from the restarted search, so a 2-solution fixture
  cycles 1→2→1→2 indefinitely. No existing test presses **past** the wrap into a
  second lap; the 3D suite adds one.

#### What "next solution" means over constraint-graph components

The search unit is the constraint-graph connected component (§3 above), and a
model has several. Each component's enumerator is itself a forward-only stream
(`WorkerOverlapEnumerator::possible_overlapping_search`, `permutation.rs:437`)
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

**[built in Phase 9, with two things the sketch did not say.]** The shipped
enumerator's "another solution" flag is **optimistic** — it reports that the
permutation state moved, not that a solution is there — so a digit that says yes
and then finds nothing is exhausted rather than broken, and carries like any
other. And the invariant needs a fixture with more than one component or it is
vacuous: `penguin_freeform` has four and is what
`the_first_press_changes_the_largest_component` runs on. Note also that
`treemaker-flatfold` sorts its own groups **ascending** with the assigned set
prepended, so this ordering is an inversion of the shipped one — that is the
divergence PORTING.md should record.

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
(`crates/oristudio-cp/src/lib.rs:4749`) enforces both.

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

## The engine contract

**The kernel half (Phases 3, 4, 5 and 9) is built. This section is the whole of
what the frontend half needs, so it does not have to re-derive it from the
code.** Types, entry points, then guarantees. Everything below exists at
`origin/main..HEAD` and every guarantee names the test that holds it.

### The three entry points

One shape, registered in five places — the Rust session, the wasm bridge, the
browser worker, the Tauri command, the native client — plus the tracked `.wasm`.

| verb | Rust (`CpSession`) | wasm export | worker / native client | returns |
| --- | --- | --- | --- | --- |
| fold | `folded_figure_fold_3d(document, &line_ids, starting_face_id, model)` | `folded_figure_fold_3d` | `fold3d(handle, selectedLineIds, startingFaceId?, model?)` | `Fold3dFoldResult` |
| another solution | `folded_figure_3d_fold_another(handle)` | `folded_figure_3d_fold_another` | `fold3dAnother(handle)` | `Fold3dStepResult` |
| duplicate | `folded_figure_3d_duplicate(handle)` | `folded_figure_3d_duplicate` | `duplicateFolded3dFigure(handle)` | `Fold3dFoldResult` |

`free_folded_figure` is shared with the flat path, so handle retention needs no
change. There is deliberately **no** `fold_to_case`: `discovered_fold_cases` has
no denominator, so "case N" has no stable meaning to batch to, and a 3D handle
passed to the flat `folded_figure_fold_to_case` gets `folded_figure_kind_mismatch`.

**Routing is the caller's job, and both doors are guarded.** The frontend already
computes the predicate locally (`creasePatternSlice.ts:1659-1661`). Send a
non-classic selection to the flat `fold_segments` and it errors `fold_needs_3d`;
send an all-classic selection to `folded_figure_fold_3d` and it errors
`fold_is_flat`. Neither is a refusal — both are `EngineError`, because both mean
the caller routed wrong. An empty resolved selection is `invalid_input` on the 3D
door and is **not** widened to the whole document the way the flat door widens it.

### The two payloads

Per fold, two objects cross the boundary and they have different lifetimes.

| | `Fold3dSnapshot` / `OristudioCpFolded3dSnapshot` | `Folded3dRenderModel` / `OristudioCpFolded3dRenderModel` |
| --- | --- | --- |
| what | scalars, counts and stable codes | struct-of-arrays geometry: no camera, no projection, no colour |
| size | ~2 KB on the largest admitted corpus model | up to 235 KB (`origamisimulator`, 2,637 faces) |
| persist? | **yes** — this is what Phase 8 writes to `.osf` | **no** — `.osf` pretty-prints, so 29,376 numbers becomes ~590 KB per figure |
| emitted | once per fold, once per `fold_another` | same; there is no per-frame way to ask for it |

Rust source of truth: `crates/oristudio-cp/src/folding3d/snapshot.rs` and
`.../model.rs`. TypeScript mirrors, already written and typechecked:
`apps/web/src/engine/oristudioCpTypes.ts`.

`FoldedFigureEntry` carries **one** additive field, `folded3d?: … | null`, rather
than a union on `snapshot` — nine read sites would otherwise have to narrow for
no gain.

### The strides, which are the whole render-model decoder

Named constants in both languages; never inline the numbers.

| array | stride | fields |
| --- | --- | --- |
| `face_attr` | `FOLDED_3D_FACE_ATTR_STRIDE` = 4 | `plane, ring_start, ring_len, facing` |
| `cell_attr` | `FOLDED_3D_CELL_ATTR_STRIDE` = 7 | `plane, ring_start, ring_len, stack_start, stack_len, determinacy, draw_rank` |
| `plane_frames` | `FOLDED_3D_PLANE_FRAME_STRIDE` = 12 | `up(3), origin(3), u(3), v(3)` |
| `edge_attr` | `FOLDED_3D_EDGE_ATTR_STRIDE` = 4 | `face_a, face_b, line, kind` |
| `ring_points`, `cell_points`, `face_normals` | 3 | `x, y, z` |
| `edge_points` | 6 | `ax, ay, az, bx, by, bz` |

Every `*_start` counts **elements of its own unit** — a vertex, a face id — never
a byte or float offset. `determinacy` is `FOLDED_3D_CELL_DETERMINED` (0) or
`…_UNDETERMINED` (1); `kind` is `…_EDGE_BORDER` / `…_EDGE_CREASE` /
`…_EDGE_UNKNOWN`; `face_b` is `-1` on a border and `line` is `-1` when no input
segment matched the edge.

### The guarantees

Each is asserted somewhere, and the test is named.

- **`entry.folded3d !== null` is the 2D/3D test.** Exactly one of `snapshot` and
  `folded3d` is non-null; never both. Phase 8 adds the second witness
  (`sourceKind === 'generated-3d'`) and must assert the two agree in
  `validateFoldedFigure` rather than letting them drift.
- **Face indices are global and stable.** `Placement3d::rings`, `face_points`,
  `face_normals`, `PlaneIndex::plane_of` / `projected`,
  `Folded3dRenderModel::face_attr` and every `cell_stack` entry share one
  numbering. No local renumbering originates at the boundary. (Inside the solver
  each constraint component *is* renumbered — that is a correctness requirement,
  not an optimisation — and it never escapes.)
- **`Plane3d::up` is emitted, not recomputed** — the placed normal of the plane's
  lowest-indexed member face, and the only place a stack's orientation is chosen.
  `(u, v, up)` is right-handed. A consumer that re-derives either from its own
  seed gets a different chirality and emits reversed stacks that look entirely
  plausible. `plane_up_is_the_placed_normal_of_its_lowest_face`,
  `the_plane_frame_is_right_handed`.
- **Cells, not faces, are the drawable unit**, and `cell_stack` is **top-first**
  with respect to that cell's plane `up`. Every face is drawn by some cell —
  checked by `RenderModelError::FaceInNoCell` and by
  `corpus_boundary_reports_every_model` across the whole corpus, not hoped. A
  renderer that fills faces instead is drawing something nothing ordered.
- **The relation may be cyclic.** He and Guest's square twist orders four panels
  `a > b > c > d > a`, so no per-face scalar "layer" exists. Never topologically
  sort `relations`, never assert acyclicity. Resolution is per cell, which is why
  cells are the drawable unit. `a_cycle_across_stacks_survives_the_search`.
- **An undecided cell is annotated, never tie-broken.** `determinacy = 1` and
  `undetermined_cells` count it; the stack still draws, in a stable order.
  Deliberately not `subface_top_stack` (`folding.rs:3996`), which drops a tied
  face into a hole and leaves its caller to pick an arbitrary survivor.
- **Every ordering variable comes back decided when a verdict of `Folded` is
  reported.** `undetermined_pairs` is 0 on all 17 corpus models that order and on
  all five committed fixtures. This is a theorem, not luck: a variable's pair sits
  in some subface (the cell postcondition), every pair of a subface is joined into
  one constraint component, so that subface lands in the component that owns the
  variable and the search totally orders it. `two_stacks_sharing_one_face_are_both_decided`
  and `a_folded_verdict_leaves_no_stack_undetermined` are what hold it — see
  "The component is a set of variables" below for the bug that broke it.
- **Cells within a plane carry `draw_rank`**, assigned by descending area. They
  are normally area-disjoint, so it decides nothing; where a decomposition ever
  slips a containment through, it puts the contained cell on top rather than
  leaving the outcome to array order. `bsp.ts`'s `sortCoplanar` (`:277`) sorts
  coplanar faces by a constant key, so the renderer has no backstop of its own.
- **`verdict: 'folded'` means no crossing was *detected*.** The crossing predicate
  is sound but **not complete**, so the verdict stays three-way — crossing / no
  valid order / folded — and no UI copy and no FOLD `frame_attributes` may claim
  non-self-intersection.
- **A refusal is a result, not a thrown error.** `Fold3dFoldResult::Refused` must
  not reach the store's catch path, must not raise an error toast and must not
  destroy the draft figure. A refusal never carries a handle and a placement
  always does, so the impossible state is unrepresentable rather than guarded.
- **Refusal and verdict are different types on purpose.** `Fold3dRefusal` means
  *no figure*; `Fold3dVerdict` means *a figure, and here is what is true about
  it*. They have different UI consequences: a refusal offers the inline
  simulator, a verdict draws.
- **Every string is a stable code, never a sentence.** The eight-locale i18n gate
  cannot see a Rust literal, so all copy lives on the frontend and keys off these.
  Measured refusal distribution over the 55-model corpus: 21 `flat_foldability`,
  8 `vertex_closure`, 7 `interior_cut`, 1 `disconnected`. The other six arms are
  reachable in principle and reached by nothing — budget copy accordingly rather
  than in proportion to novelty.
- **The payload is byte-identical across refolds** of the same segments. Planes,
  cells and components are all ordered by lowest member face index and nothing in
  the search reaches a hash iteration. `a_refold_of_the_same_document_is_bit_identical`.
- **`discovered_fold_cases` is a forward-only high-water mark, never a total.**
  Per-component totals are not knowable in advance, so no "k of N" is expressible
  and none is offered. `current_fold_case` is where the stream *is* (1-based, and
  reset by a wrap); `Fold3dStepResult::advanced` is the wrap signal, carried
  explicitly rather than inferred. Deriving position from the discovered count
  gets lap 1 right and every later lap wrong — that was a real defect, found by a
  two-lap test.
- **`min_inter_separation_relative` is `None` on more than half the fixtures**,
  and `None` is a real answer — not an infinity.
- **`diagnostics.tolerances` crosses the bridge for exactly one reason**:
  `bsp.ts`'s hardcoded `EPS = 1e-7` (`:67`) must become the kernel's
  `angle_radians`, or the renderer and the kernel disagree about which faces share
  a plane. Nothing else about the tolerances is policy the frontend may read, and
  none of it is user-facing.
- **Persist the snapshot, not the render model.** `.osf` is written with
  `JSON.stringify(written, null, 2)` (`nativeProjectFile.ts:397`), which puts
  every array element on its own line — 29,376 numbers becomes roughly 590 KB per
  figure. Phase 8's "persist `folded3d`" means the snapshot (~2 KB) plus the
  derived `renderSnapshot`.

### The component is a set of variables, not a set of faces

The one thing a reader of the ordering code is most likely to get backwards, and
it shipped wrong once. Ordering **variables** are coplanar overlapping face pairs.
The constraint graph is built over those variables, and a *face* can appear in
more than one component: one panel with two flaps folded onto different parts of
it has two stacks that share that panel and touch nowhere else.

Assigning a subface or a condition to a component by looking one of its faces up
in a per-component face set therefore loses one of them — the shared face resolves
to whichever component is found first, every item of the other component fails to
match, that component is handed no subfaces at all, its search succeeds vacuously,
and its variable comes back undetermined under a `Folded` verdict. Ownership must
come from the variables an item constrains, which `join` has already put in one
component. Measured: the shipped flat folder decides both pairs on the smallest
instance; the 3D path reported one of them undetermined. No corpus model has the
shape — the ordering table is identical before and after the fix — so
`two_stacks_sharing_one_face_are_both_decided` is the only thing that catches it.

## Phase 0 findings (spikes)

> Each spike below states a **forcing result** — the outcome that changes this
> plan. Record the answer here, in the shape `non-180-fold-angles.md:382` uses,
> and amend the plan text in the same commit when a spike contradicts it. Two of
> non-180's four spikes changed that design; the rate here was three of three.
>
> **A, B and C have been run. D and E have not.** Every answer below was
> independently re-derived by a second implementation before being written here,
> and one of the three had its headline conclusion **refuted** on that audit —
> that correction is recorded in place rather than quietly folded in.

### F0 — the corpus exists, and it is the fixture supply

Not a spike. A survey, run because Phase 2 was written on the premise that no
admissible input existed anywhere.

The repo owner's non-flat design corpus — external to git, reached in Phase 2
through `ORISTUDIO_NON_FLAT_CORPUS_DIR` — is 11 MB: **56 `.fold`, 36 `.svg`, 9
`.osf`** and two READMEs, in three provenance classes:

| class | count | carries `faces_vertices`? | who owns it |
| --- | --- | --- | --- |
| Ori-Studio-native `.osf` + their `.fold` exports | 9 `.osf` + 4 `.fold` | yes | the repo owner |
| `known-good/` curated | 10 `.fold` | **no** | third-party (8 byte-identical to the Ghassaei set; `frogBase` is a repair of a Lang design; `ALL-combined` is a layout grid) |
| `origami-simulator-corpus/` | 38 `.fold` + 36 `.svg` | **no** | third-party (Ghassaei, MIT), regenerable by `scripts/fetch-non-flat-corpus.sh` |

The remaining 4 root `.fold` files are the two Mooser's Train foldedForm states
(third-party) and byte-identical copies of the two tracked fold-angle fixtures.
Spike A's "63 files" is a *scan* count over four directories — corpus root (8),
`known-good/` (10), `origami-simulator-corpus/fold/` (36) and the 9 `.osf`
projections extracted to `.fold` — not a count of what is on disk.

Measured with the shipped scanner
(`cargo run -p oristudio-cp --release --example fold_corpus_scan`), re-run this
session:

- `known-good/`: **0 flat / 0 closure / 0 self-int / 0 link-crossing on all ten.**
- `origami-simulator-corpus/fold/` (36): **2,114 flat / 10,108 closure / 0
  self-int / 357 link-crossing**; 8 report nothing. The 357 link-crossings are
  all masked by a prior closure failure, which is why `self-int` is 0.
- The nine owner `.osf` projections: **six report nothing** — `non-flat-test`
  (25 faces), `tooling/base_fixed` (11), `plant_penguin` (103),
  `non-flat-harder_fixed` (104), `non-flat-harder_final` (141),
  `plant/penguin_other_angles` (230). Three do not: `non-flat-harder` (6
  closure), `plant/rabbit` (1 closure), `tooling/base` (2 flat, and zero fold
  magnitudes — it is the pre-fix file).
- `spikes_better.fold` is the largest clean 3D-angled model available: 207 V /
  420 E / **214 F**, 144 non-classic creases at ±90, 114 spatial vertices all
  closing. It has **no `.osf` sibling in the corpus** — if it is not committed it
  is lost.

Four things this settles that the plan had open, and one it opens:

- **22% of published non-flat designs report nothing as converted** (8 of 36),
  and **19% are admitted** by the §2 gate (7 of 36, Spike A). That is the first
  measured admissible-input rate the plan's R1 lacked.
- **The `.osf` files all load through the shipped loader today.** v4/v5/v6/v7 all
  migrate to v8 with `fold_magnitude` values intact — `parseNativeProjectFile`'s
  accept list is a hardcoded enumeration of 1..7 plus v8
  (`apps/web/src/lib/nativeProjectFile.ts:444-456`). No loader change is needed
  to use them, and no schema bump may be introduced that would break them (R15).
- **`spikes.fold` ≡ `fold_export.fold`** (identical sha256) and both are
  geometrically identical to `non-flat-harder_final.osf`'s `foldProjection`.
  Commit one, named for its role.
- **`plant/penguin_other_angles.osf` is two disconnected designs on one canvas** —
  vertex components [120, 104], face components [127, 103] — and the kernel calls
  it CLEAN, because CAMV is per-vertex and never asks about connectivity. That is
  a free, naturally-authored fixture proving a clean CAMV verdict is **not**
  sufficient for placement.
- **Opened:** `origami-simulator-corpus/README.md:182-190`'s "the clean ones"
  table is stale. It lists `huffmanExtrudedBoxes`, which the repo's own scanner
  reports as 37 flat / 480 closure, and `honeycombKiri` at 11 flat. The README's
  headline totals reproduce exactly, so the table drifted, not the scanner. Fix
  it before Phase 2 quotes it.

### Spike A answer — "reports nothing" is not "would be admitted"

Harness: `crates/oristudio-cp/src/spike_fold3d.rs` — committed (75db6c80), three
`#[ignore]`d env-gated tests, **zero CI cost**. It lives in `src` rather than
`tests/` only because it needs `pub(crate)` `FoldGraph`. It runs the shipped
`dispatched_camv`, builds `FoldGraph::from_segments(&model.line_segments, true)`
— the same call `folded_subface_figure_from_segments` makes — walks the shipped
`face_positions` BFS tree composing one rigid rotation per crease, and measures
the loop gap over non-tree dual edges, the same gap localised to elementary
per-vertex cycles, and parallel-plane separations binned by decade. 63 `.fold`
files across four directories.

**A conditioning trap found and fixed before any number was trusted.**
`acos((trace−1)/2)` for the rotation gap and `acos(dot)` for normal angles both
have a `sqrt(2·eps) = 1.5e-8` floor, and *every closing model sits below it* —
the naive form reported a uniform fake 4e-8..9e-8 rad gap on states that agree to
1e-13. Replaced with `2·asin(‖ABᵀ − I‖_F / 2√2)` and `atan2(|a × b|, a·b)`.

**(1) The loop gap, and the §2c window.** On every model whose creases close the
gap is machine precision — research §2b T1 reproduced on real authored data,
through the kernel's own arrangement rather than NumPy:

| model | faces | non-tree dual edges | gap (rad) | gap (len) / span | min plane sep / span |
| --- | --- | --- | --- | --- | --- |
| origamisimulator | 2637 | 2146 | 8.23e-14 | 5.7e-15 | 1.51e-2 |
| helloworld | 1477 | 1183 | 5.09e-14 | 1.3e-15 | 2.78e-2 |
| cross | 458 | 400 | 9.80e-15 | 1.3e-15 | 0.667 |
| spikes_better | 214 | 121 | 4.60e-15 | 5.7e-16 | 0.125 |
| spikes / non-flat-harder_final | 141 | 68 | 6.84e-15 | 4.9e-16 | 0.125 |
| plant_penguin | 103 | 60 | 4.00e-12 | 8.1e-14 | 4.42e-2 |
| non-flat-harder_fixed | 104 | 51 | 4.56e-15 | 3.6e-16 | 0.125 |
| frogBase | 32 | 9 | 5.20e-13 | 2.4e-13 | inf |
| valid-waterbomb-vertex | 6 | 1 | 7.71e-10 | 3.4e-10 | inf |

`loop_gap < dist_tol < min plane separation` holds with **7.6 decades in the
worst case and 10.8 excluding the one hand-rounded toy fixture**. Better than
§2c's synthetic 4–6. But the upper bound cannot be `min plane separation` — see
§2 step 6.

**(2) How many would be admitted.** Read the right-hand column as *"the plan's §2
admission would admit"*, not *"folds"*: there is no global self-intersection test
anywhere in the harness, and the shipped crossing gate is local only.

| population | report nothing | admitted |
| --- | --- | --- |
| `known-good/` (the curated bar) | **10 of 10** | **8 of 10** |
| owner-authored `.osf` projections | 6 of 9 | 5 of 9 |
| published third-party (36) | 8 of 36 | 7 of 36 (19%) |
| corpus root (8) | 5 of 8 | 5 of 8 |

Two caveats on reading either column. On **5 of 63 files** the zero-closure
column is *vacuous* — zero spatial vertices were checked at all (`airplane` 0
checked / 3 skipped, `cubeunwrapping` 0/6, `test_export` 0/2, `cuts` 0/76,
`honeycombKiri` 0/286), and those files are also admitted with **zero dual
cycles**, so the known-good line is better read as "8 of 10 admitted, 2 of them
vacuously". And the dominant refusal cause on published material is not closure:
the **Euler gate at `fold_graph.rs:249-251` wipes the faces on 18 of 36**, which
is `Refused(FacesUnresolved)` and the verdict users will meet most often.
The local crossing gate fires **once** across the whole pool — on
`self-intersecting-vertex.fold`, the fixture built for it.

**(3) Multiply-connected paper — the plan's §2 step 4 argument, and where it
breaks.** The plan said a drawn ring comes back with its hole filled, so the loop
gap needs no gate. The **fill is real** and I reproduced it. What fails is the
next inference.

- The `spike_a_annulus` test draws a 200×200 ring (outer square, inner square of
  `Black0`, four radial creases at 90°). Result: **5 faces, hole filled, Euler
  gate passes, and `dispatched_camv` reports 0 flat / 0 closure / 0 spatial
  vertices examined at all.** Loop gap with the hole filled 1.571 rad (200 units
  on a 200-unit paper); with the hole face deleted **2.094 rad**, bit-for-bit
  §2b T2's (90,90,90,90).
- **The mechanism is `is_interior_vertex`** (`checks_spatial.rs:647-653`): it
  returns false whenever any incident line is `Black0`. Filling a hole converts
  an annulus into a disk whose hub vertices the spatial check then declines. The
  dual cycles still exist; the gate never looks. **This is a coverage defect, not
  a topology one** — say it that way, it is the sentence that tells an
  implementer where to look.
- **`known-good/byu solar driven.fold` already has it.** Verified independently
  of the harness by parsing the JSON: its 36 `B` edges form **two components,
  sizes 30 and 6**, and the 6 sit at (1398.7, 2243.6) … (1398.7, 2315.6),
  bbox x 1398.7–1523.4 / y 2207.6–2351.6, well inside the sheet's
  x 899.8–2022.2 / y 1775.6–2783.5. 96 elementary dual cycles, **6 blind**, and
  the 6 worst-gap cycles are exactly those 6, each at 1.445 rad. CAMV: 0 flat, 90
  spatial reports, worst closure residual 2.575e-12° against a 1e-6° bar.
- **Import is the other door.** FOLD `C` (cut) maps to `Black0`
  (`model/mod.rs:508`), indistinguishable from a paper boundary, and
  `is_folding_line()` includes `Black0` (`geometry/line_color.rs:75-77`), so it
  reaches the fold graph. `cuts` (482 of 482 cycles blind) and `honeycombKiri`
  (242 of 242) land here.
- Across all 63 files: **`interior_borders > 0` iff `blind_cycles > 0`**, 0
  violations, and every such model has an O(1)-radian loop gap.

**`Black0` between two faces has three incompatible meanings in the crate
today**, and for an imported cut the correct answer is a fourth — the faces are
not joined at all:

| reading | where |
| --- | --- |
| 0° (a flat crease) | `fold_angle_for_line_color`, `model/mod.rs:512-517` |
| absent from the fan, contributing no rotation | `vertex_fan`, `checks_spatial.rs:668-672` |
| a 180° mirror | `fold_movement` → `find_line_symmetry_point`, `fold_graph.rs:453` |

The third is genuinely reachable, not latent: `find_adjacent_line`
(`fold_graph.rs:377-394`) applies no colour filter, so the shipped 2D fold really
does mirror across an interior border.

**Three corrections made on audit, two of them to the spike's own
recommendations.**

- The proposed `byu solar driven` / angle-snapped-twin regression **pair does not
  work as written**. Measured: `byu` loop gap 1.45e0 / annulus gap 6.3e-4;
  `byu_snapped` loop gap 1.45e0 / annulus gap **7.9e-14**. CAMV is bit-identical
  on both, as claimed — but the ten-decade separation lives *only* in the
  hole-deleted annulus gap. On the loop gap the plan would actually compute, over
  the kernel's face set with the hole filled, the pair is indistinguishable. It
  is a valid regression test **only if the loop check first strips faces whose
  every ring edge is a border**. Either add that step explicitly, or keep
  `annulus_90.fold` alone, which is a clean two-sided negative on its own.
- The spike claimed the plan's `#[cfg(test)]` loop-gap assertion "would have
  passed on `byu solar driven`". It would **fail loudly** — the tree-based gap is
  1.445 rad. Dropped; the surviving ask (elementary per-vertex cycles plus an
  explicit blind-cycle count) stands on its own merits.
- `is_interior_vertex` is **not** shared with the flat path. `checks.rs` never
  calls it; the call sites are `checks_spatial.rs:879`/`:1072`,
  `solve_spatial.rs:505` and `solve_fold_angles.rs:762`/`:838`. So Oriedita
  parity is not the constraint on widening it — the **angle solvers** are. The
  conclusion (additive, not an edit to the shared predicate) is unchanged.

Denominator hygiene, since the numbers above mix two pools: the "63 files" pool
contains 8 files shared between `known-good/` and the 36, and `spikes` /
`fold_export` / `non-flat-harder_final` are one 141-face model under three names
— about **52 content-unique**. Per-directory tables are unaffected; "once in 63
files" and "5 of 63 files" are pooled counts, and "6 of 16 folding models" is
content-deduplicated.

**Forcing result: did NOT fire.** The stated condition was "very few corpus
models pass". 8 of 10 curated, 5 of 9 owner-authored `.osf`, 7 of 36 published
third-party — the addressable set is fine and verdict messaging is not the main
design problem. The plan changes anyway, for a sharper reason: **the loop gap
must gate**, and `CheckCamv` has a live blind spot (R19) that ships today.
**Phase 1 has since named that blind spot** — `interior_border_segments`, and it
fires on exactly one `known-good/` model, with exactly the six segments Spike A
described.

### Spike B answer — the placement convention, settled against the shipped check

The rule is stated in §1 above. This is the evidence.

**Method.** The walk implemented from scratch (own quaternion and rigid-motion
primitives, deliberately re-typed rather than imported because `checks_spatial`'s
are `pub(crate)`), then validated five ways, then **independently re-derived by a
second implementation** — NumPy, Rodrigues rotation matrices rather than
quaternions, SVD Kabsch rather than Horn's eigenvector, its own mesh and fan
construction.

**Agreement with the shipped `vertex_link_polygon`,** on four fans of degree 3–6,
three of them chosen by the auditor and never used by the spike. Max deviation,
correct convention versus each fault:

| fan | correct | negated ρ | left-compose | parent-traversal axis |
| --- | --- | --- | --- | --- |
| deg-5, ρ 63/−112/38/−155/84 | 4.44e-16 | 1.303 | 1.408 | 1.303 |
| deg-6, ρ −17/141/−73/29/−166/95 | 5.00e-16 | 1.795 | 1.182 | 1.795 |
| deg-3, ρ 5/−11/3 | 2.78e-17 | 3.54e-1 | **1.5e-2** | 3.54e-1 |
| deg-4 with one 180° crease | 4.44e-16 | 1.921 | 1.206 | 1.921 |

The deg-3 row is why §1 demands a tight tolerance: at small angles the
left-compose fault deviates by 1.5e-2, and a loose assertion passes it.

**Ground truth.** `MoosersTrainRigid-Gardner.fold` (484 faces) folded with delta
angles and compared vertex-for-vertex to its `_ 100PercentFolded` sibling under a
rotation-only alignment: rms **0.00160** (1.76e-3 × span), max 0.00413, over all
463 vertices. Faults: negated-ρ rms 6.68e-2 (7.3e-2 × span), left-compose rms
1.302 (1.43 × span) — so Mooser discriminates even at its noise floor. Both
implementations landed on the same digits.

**Path independence.** Miura 4×4 (a genuine rigid state — fold angles found by
root-finding on the kernel's own `vertex_closure_residual`, worst 3.145e-15°),
F=16, 24 interior edges, exactly 9 independent dual loops: all 16 roots agree to
1.47e-15. `spikes_better` (F=214, 155 loops) 72 roots → 1.95e-12.
`penguin_other_angles` is **disconnected into components [103, 127]**. `rabbit`
(worst closure 70.53°) disagrees by 0.172 × span with a 7.5%-of-span vertex tear.

**Five things the spike found that change how it must be used.**

1. **`FoldGraph` faces are wound the wrong way**, guaranteed and by construction.
   See §1's "one consequence that must not be lost". This is the finding, not the
   convention.
2. **The convention has never been tested on the production face source.** Every
   mesh Spike B walked came from a file's own `faces_vertices` or a generator.
   All 48 `.fold` files in `known-good/` (10) and `origami-simulator-corpus/`
   (36 + 2) carry **zero** `faces_vertices` — re-counted file by file this
   session. Combined
   with (1), the one code path that inverts the winding is the one path the spike
   never exercised. Phase 3 must land a test that runs the walk on
   `FoldGraph`-derived faces for at least one real model. **[done — `folding3d`
   never reads a file's `faces_vertices` at all, so every fixture test is one.]**
3. **The real-model sample is four models, not six.** `plant_penguin.fold`'s 103
   face tuples are a literal subset of `penguin_other_angles.fold`'s 230, which is
   why the two report identical closure (2.291e-10), loop count (60) and root
   disagreement (3.387e-11). Distinct positives: `spikes` (141), `spikes_better`
   (214), penguin component 0 (103), penguin component 1 (127). `test_export`
   contributes a vacuous line (0 interior vertices, printed as 0.000e0 for the
   correct mode and both faults alike); `rabbit` is a negative control.
4. **Two of the cited cross-checks are not independent.** The spike's `quat_mul`
   is character-for-character the kernel's (`checks_spatial.rs:143-151`), so the
   "loop residual matches `vertex_closure_residual` exactly" agreement is
   same-arithmetic *and* blind to a global sign flip (the residual depends only
   on the scalar part). And the "independent Rodrigues composition" hard-codes its
   axes, so it validates the quaternion algebra, not the axis or sign choice. The
   convention evidence is the `vertex_link_polygon` table and Mooser. Nothing
   else.
5. **Four fault modes are really two plus an algebraic identity.**
   `ParentAxis ≡ NegatedRho`, because `Rot(−d, ρ) = Rot(d, −ρ)` about the same
   line, and both implementations reproduce the collapse to the digit.

**Mooser must not become a tolerance.** Its floor is ~1.5e-3 × span and is set by
the reference data: both files declare `frame_classes: ["foldedForm"]`, the "0%"
file is a **near-flat folded form and not a `creasePattern` frame** (vertices up
to 0.0142 = 1.5e-2 × span off the best-fit plane, its own dihedrals reaching
1.288°), the two states are not isometric (edge lengths drift up to 1.15%), and
the 100% state's own declared-vs-measured dihedral error reaches 0.42°. The walk's
own internal tear on that input (4.64e-3) **exceeds** the deviation being
measured. Meanwhile the same code is exact to 1e-15 × span on admissible input.
Use it as a ≥0.5° smoke check and derive no constant from it. Its
`edges_foldAngle` also carries 127 nulls — here all on boundary (`B`) edges, so
harmless, but a production loader must refuse rather than flatten a null on an
interior edge.

**Residual-to-tear is an order-of-magnitude heuristic, not a scale.** Injecting
Gaussian fold-angle noise across 8 decades on three models gives tear/span per
degree of residual in the range **1.8e-3 to 1.0e-2** — ~5× spread within one
model, ~3× between models, under benign global noise rather than adversarial
perturbation. State it as "a residual of 1e-6° corresponds to a tear of order
1e-8 × span, measured over three models". Do not write it into the plan as a
bound.

**Forcing result: did NOT fire.** Placement agrees with `vertex_link_polygon` on
handedness (2.8e-17 to 5.0e-16 across four fans), so the admission gate and the
renderer will share one frame. Three fixtures are now free, though: `chain3_60`
and `chain3_120` exactly as built here — F0 (0,0)/(1,0)/(0,1), F1
(0,1)/(1,0)/(1,1), F2 (1,1)/(1,0)/(2,0), both creases at the same angle, with F2's
free vertex at (+0.844669914, −0.655330086, +0.739198920) at 60° and
(+0.344669914, −0.155330086, −0.739198920) at 120° — plus the Miura 4×4
generator, which gives exactly the 9 independent dual loops Phase 3 asks for.

**[Phase 3 used the chains and dropped the Miura.]** Both chains reproduce those
coordinates exactly, through the kernel's own arrangement, with the creases as
**valleys** (positive ρ) — worth stating, because the spike's record did not say
which sign it used and the mirror state is equally self-consistent. The Miura was
never built: its only role was to supply nine independent dual loops, and the
committed fixtures supply 3, 12, 71 and 155 on real authored data, which is
strictly better evidence than a generated mesh. What the chains turned out to be
*needed* for is composition order, which the spike's fans cannot see at all — see
§1's third bullet.

### Spike C answer — the coplanar-overlap census (headline corrected on audit)

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

**The result Spike C reported, and the correction.** Spike C stated a
biconditional — *census 0 ⟺ the document has no crease at exactly ±180*, exact
in both directions over 18 admitted models — and the plan briefly encoded it as a
decision rule. **The forward direction is a theorem. The reverse is false, and it
was refuted with the spike's own harness.**

- **Keep:** `census ≥ (number of creases at exactly ±180)`. A full fold lays two
  faces into one plane on the same side of their shared edge, and two polygons
  sharing an edge segment on the same side always overlap in positive area. Held
  on 18 of 18, tight on `waterbombBase` (4 = 4), and computable without any
  placement. **Any full fold forces layer ordering.**
- **Strike:** the converse. A 5-panel strip with 4 creases all at +90° — a paper
  tube with a glue flap — arranges cleanly, is admitted, has zero ±180 creases,
  and measures **census 1 on a non-adjacent pair**. Nine panels at +90° → 6.
  Seven at +120° → 5. The 4-panel control (an open box that does not wrap onto
  itself) → 0. Run through `fold3d_census` unmodified.
- The four census-0 models have **2, 5, 6 and 6 faces**, and two of them have
  tree dual graphs, whose placement has no self-consistency check at all (see
  the harness gaps below). No admitted model above 8 faces measured zero.

So the defensible statement is: *census-zero cases are small polyhedral nets that
happen not to wrap onto themselves, and nothing in the pipeline detects that
short of running the census.* `cubeunwrapping` "measures 0 at 6 faces"; it is not
"provably opaque".

Correlations, which are unaffected and were independently recomputed: Spearman of
the full-fold fraction against pairs-per-face **+0.93** (Pearson +0.87); of face
count against raw pairs **+0.98** (log-log Pearson +0.97). Direction system
(45° n=11 p50 1.72 pairs/face, 22.5° n=3 p50 4.35, free-form n=3 p50 3.00, 90°
n=1 → 0.00) explains nothing once the full-fold fraction is held — the 90°
singleton is `cubeunwrapping`, the only zero-full-fold model in that bucket.

The census is **not** a tuned number: swept over ten orders of magnitude of
plane-clustering tolerance (normal 1e-12→1e-2, offset 1e-9→1e-2 × span) it is
constant on every admitted model.

Three things the spike found that were not what it was looking for:

- **`import_fold_document` accepts a cut it cannot model.** A `Black0` border
  segment with paper on both sides is a slit, not a hinge, and
  `is_interior_vertex` (`checks_spatial.rs:647`) excuses every vertex touching
  one — so CAMV returns CLEAN on geometry it never checked. `byu solar driven`
  is the instance: 0 flat, 0 closure, worst interior residual 2.6e-12°, and a
  placement loop gap of **1.445 rad / 156 units** on a span of ~400. Admission
  must add "no border segment interior to the arrangement", and `Fold3dRefusal`
  needs the arm. Spike A then reproduced this from a different direction and
  localised it to six blind dual cycles — see R19.
- **The Euler gate refuses the whole crease pattern on 18 of 37 third-party
  models** — before any per-plane-patch question is reached. It refused 0 of 11
  owner-authored models. (Spike A counts the same failure as 18 of 36, over the
  Ghassaei set without the repaired `frogBase`.) This is a different and prior
  failure to the 4-of-6 plane-patch rejection Spike A's brief is scoped around,
  and the owner-authored zero is a real signal the stress set hides.
- **The census reproduces `treemaker-flatfold` exactly.** On
  `tests/fixtures/flat-folder/kabuto.fold` it counts **117** overlapping pairs,
  which is the same 117 ordering variables the research measured through the
  solver (`research/2026-08-07-3d-fold-feasibility.md:491`). Two independent
  implementations, one number — §4's "free cross-check" is already satisfied.

Placement validation, since every number above rests on it: on all-classic
documents a half-turn about an in-sheet axis is exactly Oriedita's 2D reflection,
so the placement must reproduce `estimate_wireframe_from_segments`. It does on
**19 of 21** flat-foldable tracked `.fold` fixtures, to ≤ 4.2e-13.

**Those two disagreements are unexplained, and the spike's explanation for them
was wrong.** It said they were "the only two carrying flat-foldability
violations". Of the 21 fixtures compared, **8 carry flat violations and 6 of them
agreed** to ≤ 2.9e-13 — `bird_base` (9 violations, 1.172e-13), `blintz` (4, 0.0),
`frog_base` (17, 2.898e-13), each in both the crate and the vendored Oriedita
copy. So violations do not account for `clean-smoke`
(`crates/oristudio-cp-detect/tests/fixtures/cp-detect-oracle/clean-smoke.fold`,
deviation 113.8) or `iguana-split-crease`
(`packages/origami-simulator/tests/fixtures/iguana-split-crease.fold`, 0.102).

**[resolved in Phase 3 — R22 is closed, and the walk was not the problem.]** The
comparison was against the wrong quantity. `estimate_wireframe_from_segments`
returns `folded_points`, which **averages** each vertex over the faces containing
it (`fold_graph.rs`); a per-face placement image is only equal to that average
where every face agrees, which is to say where the loop gap is zero. On a
document whose placement is genuinely path-dependent the average equals no single
face's image, and the deviation is bounded by the loop gap. Measured, it tracks
it exactly:

| fixture | flat-check deviation | its own loop gap |
| --- | --- | --- |
| `clean-smoke` | 113.8 | 178 |
| `iguana-split-crease` | 0.102 | 0.073 |
| `box_90_unangled` (a Phase 2 fixture, also disagreeing) | 282.8 | 400 |
| `bird_base` (9 flat violations) | 1.17e-13 | 6.4e-14 |
| `frog_base` (17) | 2.90e-13 | 1.4e-13 |
| `treemaker-triad-base` | 2.11e-13 | 1.8e-13 |

Which also explains the 6-of-8: a Maekawa or little-big-little violation is
combinatorial and moves no geometry, so those fixtures are path-independent and
agree. Only an *angular* violation opens the gap.

The right comparison is per face, against `FoldGraph::fold_movement` — the
kernel's own image of a point in one face's frame, before the averaging — and it
holds to ≤1e-9 with **no admissibility precondition at all**, including on
`iguana-split-crease` and `box_90_unangled`.
`the_walk_reproduces_the_flat_folder_face_by_face` is that test, and it is the
strongest cross-check the placement has: a half-turn about an in-sheet axis,
restricted to the sheet plane, *is* Oriedita's 2D reflection.

`clean-smoke` cannot participate, for a reason that is itself worth having:
it carries **six unassigned creases**, and the flat folder mirrors across an
unassigned segment as readily as across a mountain, because `find_adjacent_line`
applies no colour filter. Its flat fold is a state the file never described. The
3D walk refuses that join (`NonCreaseJoin`) rather than manufacturing an angle.

Also corrected: the worst admitted loop gap is **2.71e-7**
(`self-intersecting-vertex`), not the ≤3.5e-8 first reported — still consistent
with `FoldMagnitude`'s 1e-7° storage quantisation (`line_segment.rs:66`) and
nothing else, but the figure as printed was wrong.

**The census harness's admission gate was not the shipped gate.** `admissible`
was `flat.is_empty() && closure_failures == 0 && interior_cuts == 0` — it
**omitted spherical simplicity**, which has shipped. With
`LinkVerdict::self_intersects` included, `self-intersecting-vertex.fold` is
refused (and `fold_corpus_scan` on the same file reports self-int 1 /
link-crossing 1), leaving **17 admitted and census 0 on 3 (18%, not 22%)**.
**Closed** — `fold3d_census.rs:1167` now reads
`flat.is_empty() && closure_failures == 0 && self_intersections == 0 && interior_cuts == 0`,
with the reason in a comment beside it. What is still open for Phase 4 is the
*other* alignment: `Admission::outcome() == Folded`, not `admit(..).is_ok()`,
because Phase 3 made a local crossing an outcome rather than a refusal.

**The number that actually decides it is not the pair count.** The plan's
degraded mode is "census > 0 → render translucent and name the pairs", and that
is only a mode if some of the model stays opaque. Measured as the fraction of
faces sitting in a plane with at least one overlap: **1.00 on 12 of the 14**
models with a non-zero census, 0.991 on a 13th
(`plant__penguin_other_angles`, 228/230), and 0.64 only on
`tooling__base_fixed`, an 11-face toy. (Spike C reported "13 of 14"; the audit
recounted.) So on every real model the degraded mode renders the *whole figure*
translucent and lists hundreds to thousands of undetermined pairs. That is not a
smaller feature, it is a picture with no information in it.

**Two harness gaps to close before Phase 4 adopts `fold3d_census` as its
regression oracle** — both found on audit, both benign for the census itself:

- `--flatcheck` exercises **only half-turns**, which are sign-invariant and
  mod-sign angle-invariant. It validates the walk topology, pivot and axis, and
  never the general-angle rotation.
- The loop gap is **silently vacuous on a tree dual graph**, where it prints an
  exact `0.00e0`. `cubeunwrapping`, `airplane`, `test_export` and all four
  synthetic tubes report that. Two of the four census-0 data points therefore
  have no placement self-check at all.

**Forcing result: fired. Phase 9 moves into the merge set** — more firmly after
the correction than before it, since fixing the biconditional and the admission
gate both *shrink* the census-zero population. Since everything lands in one PR
this costs no release sequencing. What it costs is that the plan can no longer
treat layer ordering as optional, and Phase 5's verdict surface no longer needs a
"drawn but undetermined" state as its common case.

### Spike A brief — **run** (as an admission scan, not a plane-patch scan)

The brief as written was: build 8–12 hand-folded 3D states, cluster planes,
project, run the real
`prepare_subface_segments` → `FoldGraph::from_segments` → `configure_subfaces`
chain, and report the fraction of multi-face patches **accepted**; of the
rejected, how many are fixed by (a) connected-component grouping, (b) artificial
bridging cuts, (c) neither. Baseline already measured: 4 of 6 rejected, all 70
accepted patches yielded exactly 1 subface.

**What was run instead, and why.** The corpus made the *upstream* question
answerable first, on real files rather than 8–12 hand-built states: does the
admission gate admit anything, and does "reports nothing" mean "would be
admitted"? That is what `spike_fold3d.rs` measures, and the answer changed the
plan — see "Spike A answer" above. ~~**The plane-patch half is still open**~~
**[answered in Phase 9, and the answer is (a).]** Connected-component grouping
fixes it; artificial bridging cuts were not needed and neither was a new
arrangement builder. The gate is Euler's and `V - E + F = 1` needs a *connected*
subdivision, so grouping the plane's faces by the census's own overlap relation
— and then by segment connectivity — opens it. Every admitted corpus model
decomposes; the three that do not are refused by the admission gate first.

**Forcing result on the plane-patch half:** if (c) is non-empty, Phase 9 is a new
arrangement builder admitting non-simple cells, not a repair pass, and its
estimate roughly doubles. Its fixtures are Phase 2's fixtures, so the work is not
wasted. Note the corpus supplies a prior obstacle the brief did not anticipate:
the Euler gate refuses **the whole crease pattern** on 18 of 36 published models
before any per-patch question is reached, and on 0 of 11 owner-authored ones.

### Spike B brief — **run**

3-face **asymmetric** chain at **60°** and **120°** (never 90°, never 2 faces —
see §1 above). Assert against hand-computed coordinates, assert path-independence
across all BFS roots on a Miura with 9 independent dual loops, and assert
agreement with `vertex_link_polygon` on an interior fan. Verify the test is
**non-vacuous** by injecting a reversed composition order and watching it fail.

**Forcing result:** if placement and `vertex_link_polygon` disagree on
handedness, the admission gate and the renderer are in different frames and the
gate certifies states drawn mirrored — stop and reconcile before Phase 4.

**Run. It did not fire** — they agree to 2.8e-17..5.0e-16 across four fans of
degree 3–6. Every element of the brief held up and each earned its keep: the
90° degeneracy is real, one crease really does make every scheme agree, and the
non-vacuity injection caught that `ParentAxis ≡ NegatedRho`. See "Spike B answer"
above, including the one thing the brief did not ask about and should have — the
winding of `FoldGraph::faces`.

### Spike C brief — **run**

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
is gone. But the anchors are also what made the biconditional look true: every
one of them is a *strip*, and a strip that does not wrap onto itself is exactly
the family where "no full fold" and "census 0" happen to coincide. The 5-panel
tube counterexample is the same family bent one panel further.

### Spike D — cross-plane coupling frequency (**run, in Phase 4**)

On the same corpus, count folded-crease lines whose four incident faces are not
all coplanar (§5.1's 1×4 strip is the canonical instance). Run it on the F0
corpus, not on synthetics — the material now exists.

**Forcing result:** if coupling is common, "detect and refuse" is a permanent
refusal on the models users bring, not a scoped v1, and cross-component
resolution moves from Phase 11 into the merge set. **This now bears on the merge
set directly**, not on a follow-up, because Spike C moved Phase 9 in — so it must
be known before Phase 9 is designed, and Phase 9 is merge-blocking.

**Run. It fired.** `folded_line_index` is the detector and it reads non-zero on
**every** admitted corpus model above six faces (15 of 15) and on four of the
five committed 3D fixtures, `box_90` included. So there is no refusal and Phase 9
carries the constraint — see §3 for how, which is the part the spike's framing
got wrong: the *condition* has no flat analogue, but the *vocabulary* does, and
`check_quad` says exactly `[a above c] != [b above d]` once the four faces have a
cut to be read in. The classifier is not over-firing: it reads 0 on every flat
fixture, which has one plane and nothing to couple.

### Spike E — projection ownership and item count (**not run**)

Decide who projects to 2D and whether the camera is persisted, then measure
`buildBsp` at real decal counts. This fixes the `.osf` persisted shape, the file
size (measured range: 0 to +163% on `iguana_24.osf` depending on the answer), and
whether orbit is achievable at all.

**Forcing result:** if real item counts put `buildBsp` past ~1265, the merge set
ships an orthographic camera (which makes the face tree's split combinatorics
view-independent, so it builds once and only `traverseBsp` is per-frame) or fixed
views only. Real scale is now known and it is comfortable: the largest
owner-authored model is 214 faces and the largest admitted corpus model is 2,637.

### Still open after Phase 0, and not answered by any spike

**Open decision 2 (selection scoping for the 3D preconditions)** was assigned to
Phase 0 and none of A, B or C touched it. It is unchanged; see Open decisions.

## Affected Areas

**Rust kernel — new**
- `crates/oristudio-cp/src/folding3d.rs` — **built.** Module root:
  `Fold3dTolerances` (the one const block) and `Fold3dRefusal`. `Fold3dSession`,
  `Fold3dSnapshot` and `Fold3dVerdict` are Phase 5's
- `crates/oristudio-cp/src/folding3d/placement.rs` — **built.** `Rigid`,
  `place_faces` / `place_segments`, `Placement3d`, `FaceJoin`, `LoopGap`
- `crates/oristudio-cp/src/folding3d/admit.rs` — **built.** Flat snap, CAMV,
  `Admission`, `Fold3dOutcome`, `Fold3dDiagnostics`, the separation spectrum
- `crates/oristudio-cp/src/folding3d/planes.rs` — **built.** Clustering,
  footprint patches, the plane frame and the one place a stack's `up` is chosen
- `crates/oristudio-cp/src/folding3d/overlap.rs` — **built.** The exact polygon
  clip, graduated from the census harness so the two implementations of the count
  cannot disagree about the primitive
- `crates/oristudio-cp/src/folding3d/census.rs` — **built.** Coplanar-overlap
  census and `folded_line_index`
- `crates/oristudio-cp/src/folding3d/cells.rs` — **built.** Per-plane arrangement
  into the maximal covering sets the ordering search consumes
- `crates/oristudio-cp/src/folding3d/constraints.rs` — **built.** The slot-circle
  model: seeds, conditions, couplings, crossings, and the backward re-derivation
- `crates/oristudio-cp/src/folding3d/order.rs` — **built.** Constraint components,
  local renumbering, the per-component search and the odometer
- `crates/oristudio-cp/src/folding3d/model.rs` — **built.** `Folded3dRenderModel`:
  view-independent struct-of-arrays geometry, cells as the drawable unit, and
  the postcondition that no face is drawn by nothing
- `crates/oristudio-cp/src/folding3d/snapshot.rs` — **built.** `Fold3dSnapshot`,
  a sibling of `FoldedFigureSnapshot` rather than an extension
- `crates/oristudio-cp/src/folding3d/wire.rs` — **built.** One stable code per
  kernel enum, and `Fold3dVerdict`
- `crates/oristudio-cp/src/folding3d/session.rs` — **built.** `Fold3dSession`:
  the only place the stages compose, and what a handle holds

**Rust kernel — modified**
- `crates/oristudio-cp/src/lib.rs` — `pub mod folding3d;` (**done**);
  `CLOSURE_RESIDUAL_BAR_DEGREES` made `pub` (**done**); verdict-code diagnostics
  (Phase 5). The 3D tolerance block lives in `folding3d.rs`, not here — see the
  Phase 3 checklist for why
- `crates/oristudio-cp/src/session.rs` — **done (Phase 5)**, and differently
  from the proposal: not a *dispatch* inside `fold_segments` — that would force
  `folded_figure_fold_selected`'s return type to become a union — but a
  `fold_needs_3d` **guard** there, on the post-fallback slice, mirrored by a
  `fold_is_flat` guard on the new command. `FoldedFigure` becomes kind-tagged;
  three names join `CP_ENGINE_COMMANDS`
- `crates/oristudio-cp/src/fold_graph.rs` — typed `DisconnectedFaces` error
  (**done**, Phase 1, flat path too); `fold_movement` made `pub(crate)` so the 3D
  walk can be diffed against it face by face (**done**, Phase 3 — see R22)
- `crates/oristudio-cp/src/checks_spatial.rs` — `Quat` and `Vec3` promoted from
  `pub(crate)` to `pub` (**done**, Phase 3) so `folding3d` shares them rather
  than re-typing them. No behaviour change
- `crates/oristudio-cp/src/model/mod.rs` — slice-taking
  `has_non_classic_segments` beside `has_non_classic_creases` (`:551`) — Phase 5,
  not Phase 3: it is the routing predicate and belongs with the dispatch
- `crates/oristudio-cp/src/folding.rs` — **done (Phase 9)**, and smaller than
  proposed: `validate_initial_hierarchy` beside `HierarchyTable::from_initial`,
  additive and `pub`. The `pub(crate)` visibility changes to `configure_subfaces`
  and `folded_face_polygons` were **not** needed — `folding3d` builds its own
  arrangement from projected rings rather than borrowing the flat path's, which
  is what let it group by overlap component and open the Euler gate
- `crates/oristudio-cp-wasm/src/lib.rs` — **done (Phase 5)**: three new entry
  points, **plus the committed `.wasm` rebuild**

**Tauri**
- `apps/tauri/src-tauri/src/cp_engine.rs` — **done (Phase 5)**: three passthrough
  commands + `NATIVE_CP_COMMAND_NAMES` (`:446`)
- `apps/tauri/src-tauri/src/lib.rs` — **done (Phase 5)**: registration (`:120`)

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
  `'generated-3d'` on `OristudioCpFoldedFigureSourceKind` (`:387`); **and a
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
  keyed on the kernel code, with a **new** exhaustiveness gate — the existing
  one (`foldabilityMessages.test.ts:70-90`) iterates only `FOLDABILITY_RULES`
  and covers no spatial rule
- `apps/web/src/cp-workspace/foldAngle/CpFoldAngleLayer.tsx` — `:60` is the
  **fourth** `isClassicCrease` gate and the only render surface; decide whether
  angle badges stay visible over a 3D figure
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — **`:602` renders the
  raw `figure.status` identifier as the list subtitle**, untranslated, in all
  eight locales. (The shortcut comment that named the wrong chord was fixed in
  Phase 1.) No new id-kind branches

**Web — persistence, export, analytics**
- `apps/web/src/lib/nativeProjectFile.ts` — `validateFoldedFigure` (`:673-702`)
  constructs a fresh literal, so unnamed fields are dropped (`contradiction`
  already is); `foldedFigureSourceKind` (`:764-773`) falls an unknown kind back
  to `'generated-from-current-cp'`
- `apps/web/src/lib/supersetFeatures.ts` — a `foldedForm3d` entry; note `:136`'s
  existing `foldAngles` entry uses the **identical** predicate
- `apps/web/src/analytics/events.ts` — `ANALYTICS_EVENTS` (`:84`) and the derived
  `AnalyticsEventName` union; `COUNT_BUCKETS` (`:150`)
- `docs/analytics.md` — event rows
- `apps/web/public/locales/*/{errors,panels,dialogs}.json` — eight locales

**Tests and fixtures**
- `tests/fixtures/fold-angle-3d/` — **built** (Phase 2). Eight `.fold` fixtures
  plus `box_90.osf` and a README carrying every recorded verdict. The authored
  adversarial cases are still missing; see Phase 2's item (c)
- `crates/oristudio-cp/tests/non_flat_corpus.rs` — **built** (Phase 2); the
  external corpus behind `ORISTUDIO_NON_FLAT_CORPUS_DIR`, the Mooser's Train
  ground-truth asset, and the loud-skip discipline R9 asks for. Phase 3 added
  `corpus_admission_reports_every_verdict`, which is where the refusal
  distribution above comes from
- `crates/oristudio-cp/tests/folding3d.rs` — **new** (Phase 3); the public
  admission gate against the Phase 2 fixtures. Anything needing `pub(crate)`
  `FoldGraph` — the winding assertions, the `vertex_link_polygon` comparison, the
  convention fault injection, the `fold_movement` diff — is a unit test inside
  `folding3d/placement.rs` instead
- `scripts/osf-fold-projection.mjs` — **new**; the `.osf` → `.fold` extraction
  every committed fixture is derived by, tested for byte equality against the
  committed files by `non_flat_corpus.rs`
- `apps/web/src/store/workspaceStore/store.test.ts:2858` — `describe('folding a
  pattern that is not flat-folded')`, 3 tests, all currently green; all three
  break and all three breakage is signal (Phase 7)
- `apps/web/src/cp-workspace/share/foldedFigureGate.test.tsx:96` — asserts the
  share toggle is disabled with copy saying the pattern "has no flat-folded
  form", which becomes false once 3D CPs have a folded form
- `apps/web/src/lib/creaseExportFoldFlatness.test.ts:85` — `isFlatFoldableFold`
- `scripts/folded-grid-screenshot.mjs:44-60` — **a Playwright harness that
  hand-writes an `OristudioCpFoldedFigureEntry` literal** and is not in CI, so a
  required new field breaks it silently
- `crates/oristudio-cp/tests/verify_fold_fixtures.rs` — **extended** in Phase 2
  rather than a second file being added. It kept its two original claims about
  the `fold-angle` fixtures and gained three tests over `fold-angle-3d`: the
  angles each fixture claims, the CAMV verdict each reaches, and that the pinned
  list and the directory listing are the same set
- `crates/oristudio-cp/examples/fold_corpus_scan.rs` — the committed scanner that
  grades a corpus directory. It no longer redeclares the closure bar (Phase 3),
  but `:81-96` still re-implements `spatial_closure_diagnostics`'
  classification — as do `fold3d_census.rs` and `non_flat_corpus.rs`. The
  *number* is now shared; the ten lines around it are not, and collapsing those
  is a separate change
- `crates/oristudio-cp/tests/oriedita_folding_oracle.rs`,
  `oriedita_render_oracle.rs` — must stay green, and must be **actually run**
- `PORTING.md` — the Ori Studio native section

**Phase 0 harnesses, committed and kept** — these are measurement code, not
production, and they exist so a later change cannot quietly move a number this
plan rests on:
- `crates/oristudio-cp/src/spike_fold3d.rs` — Spike A. Three `#[ignore]`d
  env-gated tests (`ORISTUDIO_SPIKE_DIRS`, `ORISTUDIO_SPIKE_FILE`, plus
  `spike_a_annulus` which needs nothing). Zero CI cost. It lives in `src` only
  because it needs `pub(crate)` `FoldGraph`
- `crates/oristudio-cp/examples/fold3d_census.rs` — **the one command.** Started
  as Spike C's census; Phase 2 widened it to the whole Phase 0 measurement set
  and closed R21's three gaps with it. See "Reproducing the measurements" below

### Reproducing the measurements — one command

**[new in Phase 2. A measurement nobody can re-run is a measurement that rots,
and three of this plan's load-bearing numbers lived in two different harnesses
with no way to get them together.]**

The census, the placement loop gap and the parallel-plane separation spectrum now
come out of one invocation:

```bash
# the committed fixtures
cargo run -p oristudio-cp --release --example fold3d_census -- \
    tests/fixtures/fold-angle-3d
# the external corpus, wherever ORISTUDIO_NON_FLAT_CORPUS_DIR points
cargo run -p oristudio-cp --release --example fold3d_census -- --corpus
```

`--csv` for machine-readable rows, `--flatcheck` against the shipped flat folder,
`--sweep` for the census under a plane-tolerance sweep, `--selftest` for the
polygon-overlap primitive. `.osf` projects are read directly, so the nine
owner-authored designs need no extraction step. `--corpus` **exits 2** when the
variable is unset rather than printing an empty table.

**R21's three gaps are closed, and one of them found a bug.**

- *"`--flatcheck` exercises only half-turns."* There is now a **general-angle
  dihedral round-trip**: for every placed adjacent face pair, the dihedral
  measured from the two placed normals against the crease's declared angle,
  wrapped into (−180°, 180°] because `atan2` cannot tell +180 from −180 — which
  is itself the precise statement of why a document of half-turns validates
  nothing. It reads 1.3e-13° on `spikes_large` and 2.5e-14° on `spikes_small`,
  and on `rabbit_unclosed` it reads **70.5°, the same number as that model's
  worst vertex closure residual**, reached two independent ways.
- *"The loop gap prints an exact `0.00e0` on a tree dual graph."* It now prints
  `--`, with the non-tree edge count in the column beside it. `hinge_90` is the
  committed instance.
- *"`admissible` omits the shipped spherical-simplicity verdict."* Included.
  `self-intersecting-vertex.fold` is now **refused**, as it always should have
  been.
- **And the plane-spectrum port surfaced a real defect in it.** The first
  implementation canonicalised each face normal by a global rule ("flip if the
  first non-zero component is negative"), which splits two normals differing by
  1e-17 across an axis into *opposite* signs and turns their equal offsets into a
  separation of twice the offset. On `spikes_small` that invented a 50-unit gap
  on a 400-unit sheet. The sign is now resolved **against the class** it is being
  compared to, never globally.

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

### Phase 0 — De-risking spikes (A, B, C run; D, E and A's plane-patch half remain)
- [x] **F0: the corpus surveyed.** Three provenance classes; 10 of 10
      `known-good/` and 6 of 9 owner `.osf` report nothing; 7 of 36 published
      third-party are admitted. Phase 2 is rewritten around it
- [x] **Spike A: run** — as an admission scan.
      `crates/oristudio-cp/src/spike_fold3d.rs` (committed, `#[ignore]`d,
      env-gated). Did not fire on its own condition; changed the plan anyway —
      the loop gap now **gates**, and R19 is a live shipped bug
- [ ] **Spike A, plane-patch half: still open, and now merge-blocking.** Accepted
      fraction and the (a)/(b)/(c) split, on the Phase 2 fixtures
- [x] **Spike B: run.** Convention settled and agreeing with
      `vertex_link_polygon` to ≤5e-16 on four fans of degree 3–6. Did not fire.
      Found that `FoldGraph::faces` are wound the opposite way (R20) and that the
      convention has never been run on `FoldGraph`-derived faces
- [x] **Spike C: run; Phase 9 is not a follow-up.**
      `crates/oristudio-cp/examples/fold3d_census.rs`. Its headline was
      **refuted on audit** — the true statement is the one-way bound
      `census ≥ (creases at ±180)`, not a biconditional
- [ ] Spike D: cross-plane coupling frequency — **bears on the merge set now**
- [ ] Spike E: projection ownership decided; `buildBsp` measured at real item
      counts
- [ ] Open decision 2 (selection scoping) — assigned to Phase 0, untouched by any
      spike, still open
- [x] Every spike's answer written into "Phase 0 findings" above, including the
      ones that change the design, with the plan text amended in the same commit

### Phase 1 — Flat-path corrections and instrumentation (**built**)

**[The one thing that did not go as written: this phase no longer "ships alone,
first, on its own PR". The repo owner said everything lands in one pull request,
so it is the first work on the branch rather than a separate one. Nothing else
about it changed — it still touches no 3D code and blocks nothing.]**

- [x] `FoldGraphError::DisconnectedFaces { reached, unreached }` replacing the
      silent `break` at `fold_graph.rs:208`. Carried up by a new `FoldSetupError`
      that **replaces** the `InitialHierarchy` arm on `FoldingEstimateError`,
      `WorkerOverlapSearchError` and `AdditionalEstimationError`, so a parity
      abort and a disconnected graph stay distinguishable to the engine envelope:
      `fold_same_parity` vs `fold_disconnected`. The fixture is a 15x15 grid plus
      one square parked ten units away — 226 faces, `euler == 2`, admitted by the
      `0.005 * faces.len()` tolerance, which is why ~200 faces is the floor for
      reproducing this at all. **Upstream has no behaviour here to be faithful
      to**: `getFacePositions()` re-scans an empty frontier until the thread is
      interrupted, so the pre-existing `break` was already a divergence, and a
      worse one than the hang. Recorded in `PORTING.md`
- [x] `isDrawableFoldResult` applied to the **initial** fold, not only refold.
      The draft figure is *dropped* rather than left as a permanently errored
      entry, and the kernel handle is freed
- [x] Distinguish the zero-solutions fallback from the contradiction fallback on
      the wire. `FoldOutcome` on `FoldingEstimate` and `FoldedFigureSnapshot`,
      `#[serde(default)]`, mirrored as `OristudioCpFoldOutcome`. Three things
      landed on `Step3` / `Transparent3` with no solutions and nothing told them
      apart. **`NoSolutions` is the one arm with no fixture**: a scan of every
      tracked fixture and of the whole non-flat corpus at Order5 produced
      `Solved`, `NotAttempted` and `Contradiction`, and never it — consistent with
      AEA raising the contradiction first in every case we have
- [x] **(Spike A / R19) The interior-`Black0` blind spot is named.**
      `checks_spatial::interior_border_segments` answers from the traced
      arrangement rather than from geometry: `calculate_faces` never traces the
      unbounded outer face, so a boundary segment belongs to one traced face and
      an interior one belongs to two. Additive, and `is_interior_vertex` is
      untouched. `dispatched_camv` pays for it only where the document carries a
      non-classic crease — the same gate `ThroughLineIndex` already uses — so an
      all-classic document's `CheckCamv` output stays byte-identical to what the
      Oriedita oracle pins.

      **It discriminates, and it changes what one corpus file reports.** Of the
      ten curated models in `known-good/`, exactly one has interior borders:
      `byu solar driven.fold`, with **6** — the closed hexagon of `B` edges Spike
      A described. The other nine have 0. Across the 36-model published corpus the
      only others are `cuts` (395) and `honeycombKiri` (187), both kirigami. No
      tracked fixture has any. So `known-good/README.md`'s bar — "every model here
      reports nothing" — is now false for one file, and it was calibrated on a
      check that was blind there. The entry is a `warning` phrased as "not
      checked", not an error: a cut is a legitimate thing to draw
- [x] **`import_fold_document` refuses a folded form** rather than importing its
      shadow. Two independent signals, because a file can carry either without the
      other: a frame declaring `foldedForm` (which can still be flat in z, since a
      flat-folded state is a folded state), and any vertex off the plane (which a
      file can carry with no class at all). An explicit `z` of exactly zero is how
      plenty of writers spell a flat pattern and still imports; the tolerance is
      1e-9 and is not a modelling knob. `IoError::FoldedForm` is new and separate
      from `InvalidField`.
      **Corrected after review, in three places.** It first mapped to the shared
      `unsupported_operation`, which `treemaker-core`, `oristudio-bp-wasm` and
      `CommandError` also mint, with a `Debug` string as the message — so no
      frontend case could be written for it without being wrong for the other
      three. It now carries `fold_folded_form`, one code for both signals, with
      copy in `toastMessages.ts` and all eight locales. It had **no PORTING.md
      entry**, and now has one. And it broke a round trip nobody had checked:
      `foldedExport.ts` writes `frame_classes: ['foldedForm']` while
      `creasePatternImport.ts` scored `foldedForm` as a *crease* frame at 100
      points, tied with `creasePattern` and broken by frame index, so a file
      writing its folded state first handed that frame to an importer that keeps
      x and y and drops z. A folded frame now ranks below an unclassified one;
      pinned from both ends in `creasePatternImport.test.ts` and
      `foldedExport.test.ts`
- [x] **`fold_disconnected` has copy.** The code above is minted for exactly the
      case this phase's first item exists to stop, and `humanizeError` had no case
      for it, so the toast read
      `Setup(FoldGraph(DisconnectedFaces { reached: 225, unreached: 1 }))` in all
      eight locales. Found on review; the kernel test's own doc said "the frontend
      branches on `code`", which it did not
- [x] `ANALYTICS_EVENTS` extended rather than duplicated;
      `foldWarningShown`, `foldWarningAccepted`, `foldSimulationRun` and
      `foldabilityChecked` wired where they fit
- [x] `fold attempted { mode, crease_count_bucket, non_classic_count_bucket }`.
      **Verified**: `G` reaches neither chokepoint. `handleCpShortcutAction`
      recognises the fold chord and calls `folded.foldModel()` before
      `handleCpToolAction` runs, so no `cp tool used`; and the toolbar button
      calls the same `handleFoldModel`, so no `command invoked` either
- [x] `fold completed { mode, verdict, solution_count_bucket }` on every terminal
      branch, including both cancels and today's simulate punt, so it pairs
      one-to-one with `fold attempted`. `verdict` reads the kernel's `outcome`
      rather than re-deriving it from a stage with three meanings
- [x] `fold solution cycled { direction }` from `foldAnotherOristudioCpFigure`,
      using the same predicate `buildFoldedFigureActions` labels the verb from
      and `fold_another` branches on, so the event, the button and the search
      agree about which of the two a press was
- [x] Rows added to `docs/analytics.md`, plus a note on *why* folding is the
      documented exception to the chokepoint rule. The privacy test enumerates
      the permitted enum values rather than pattern-matching, because a raw crease
      count is the easy mistake: it is right there, it looks harmless, and on a
      distinctive design it identifies
- [x] Intercept dialog i18n'd, with proper singular and plural rather than one
      string with a count in it, across all eight locales
- [x] `CreasePatternPanel.tsx`'s comment now names `G`
- [x] **The pre-fold gate counts errors, not entries.** Found on review, and it is
      this branch's own doing: `CheckCamv` had never emitted anything but
      `severity: "error"`, so `diagnostic_entries.length > 0` and "something is
      wrong" were the same question — until `SpatialInteriorBorder` landed as a
      `warning` whose own copy says *not a violation*. A mixed document with an
      interior cut and an all-classic selection therefore raised Oriedita's
      "Detected errors in flat foldability. Continue to fold?" over nothing, and
      told `foldability checked` it had violations. One predicate,
      `cp-workspace/diagnostics/severity.ts`, now answers it for the gate and for
      `hudStatus`
- [x] `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
      `cargo test --workspace`, `npx tsc --noEmit`, `npx vitest run`,
      `npm run i18n:check`
- [x] **Committed wasm rebuilt.** `ca83d662` landed after `c069085e`'s rebuild, so
      the tracked bridge was stale by 3.7 KB. CI reads it (`ci.yml` runs typecheck
      and tests with `--ignore-scripts`); deploys regenerate it. Rebuilt, and
      deterministic here — two consecutive `wasm-pack build` runs give the same
      sha256
- [x] **`scripts/*.test.mjs` is actually run.** Five files and 48 assertions sat
      outside every vitest project with no npm script or workflow step naming
      them, including the only always-available cover for `osf-fold-projection`'s
      renumbering (its end-to-end guard needs the external corpus). Now
      `npm run test:scripts`, and a step in CI's web-client job
- [ ] **Let the data accumulate for a real window before committing to Phase 3**

### Phase 2 — The 3D fixture corpus (**built**; the authored adversarial cases remain)

**[rewritten twice: once around the F0 survey, and again on building it. The F0
rewrite was right that two thirds of the authoring burden was gone. It was wrong
about the precision the fixtures may be written at, and about how many of the
naturalistic candidates earn a place — see the two corrections below.]**

**The committed-fixture rule, stated as a rule so it does not become a
negotiation.** Commit a file **iff** (a) the repo owner authored it in Ori Studio,
so it is his to license under the repo's terms; **and** (b) it carries at least
one non-classic fold angle, or is the matched all-classic control for one that
does; **and** (c) it carries `faces_vertices`; **and** (d) its verdict is
recorded beside it. Anything failing (a) stays external, no exceptions, however
convenient. AGENTS.md's "real-world user corpus files are not committed" governs
third-party corpora; the precedent for the owner's own test designs is
`tests/fixtures/simulation/iguana_24.osf` — 3.53 MB, committed, "contributed for
this purpose, with its embedded reference images removed"
(`apps/web/src/lib/simulationCorpus.test.ts:14-17`).

**What was built.** `tests/fixtures/fold-angle-3d/` — **eight `.fold` fixtures
plus one `.osf`, 68.8 KB + 30.5 KB**, against 144.8 KB of `.fold` already
tracked. Every one is verified by
`crates/oristudio-cp/tests/verify_fold_fixtures.rs`, which pins V/E/F, the ±180
and non-classic crease counts, the number of distinct fold magnitudes, and the
full CAMV breakdown (flat / spatial examined / closure / self-intersection /
indeterminate) for each. The directory's README carries the same table plus each
fixture's source, source sha256 and licence, and the reason it exists.

| fixture | F | non-classic (distinct magnitudes) | verdict | census | what it is for |
| --- | --- | --- | --- | --- | --- |
| `hinge_90` | 2 | 1 (1) | admit | **0** | the degenerate control; the only census-0 fixture; CAMV clean **vacuously** (0 spatial vertices); tree dual graph, so the loop gap is `--` and not `0.0` |
| `box_90` | 11 | 6 (1) | admit | 17 | smallest real 3D fold: 4 planes, real overlap, 2 spatial vertices; source of the committed `.osf` |
| `box_90_unangled` | 11 | 0 | flat path | 27 | the matched **before** file — same box, all-classic, 2 flat violations. Truth-table rows (a) and (b) as a *pair* |
| `spikes_small` | 25 | 16 (1) | admit | 36 | small clean positive, 12 independent dual cycles |
| `spikes_large` | 214 | 144 (1) | admit | 543 | the scale case, 114 spatial vertices; **no `.osf` sibling exists** |
| `penguin_freeform` | 127 | 64 (**10**) | admit | 457 | the only clean free-form model in existence — every other positive is 90° only |
| `penguin_disconnected` | 230 | 90 (10) | **refuse** | 1001 | CLEAN yet unplaceable: 2 face components, 53 spatial vertices all closing |
| `rabbit_unclosed` | 87 | 62 (**16**) | **refuse** | 306 | the near-miss negative: exactly 1 closure failure of 32 |
| `box_90.osf` | — | 6 magnitudes | — | — | schemaVersion 5, 23 segments, no inline simulation: Phase 8's v5→v8 migration |

- [x] **(a) Adopt, do not author, the naturalistic set.** Done, and **pruned
      from twelve candidates to eight**. `spikes_mid` (104 F) and `spikes` (141 F)
      were dropped as a third and fourth size of one 90°-only family already
      covered by `spikes_small` and `spikes_large`; `penguin_90`
      (`plant_penguin`, 103 F) was dropped because its 103 face tuples are
      literally component 1 of `penguin_disconnected`, which is committed;
      `spikes_unclosed` (`non-flat-harder`, 6 closure failures) was dropped in
      favour of `rabbit_unclosed`, which is a *harder* negative — one failure out
      of 32 rather than six — and brings a 7.5° direction system and 16 distinct
      magnitudes with it. The set that remains has no two fixtures playing the
      same role
- [x] **Commit exactly one `.osf`**: `box_90.osf`, a byte-for-byte copy of
      `tooling/base_fixed.osf` (30,465 bytes, schemaVersion 5, 23 segments, 6
      `fold_magnitude` values of 900000000). It carries `images: []`,
      `textAnnotations: []` and `inlineSimulations: []`, so unlike `iguana_24.osf`
      nothing had to be stripped. `rabbit.osf` and `penguin_other_angles.osf`
      stay external in `.osf` form — they carry inline simulations (277 KB / 884
      KB); only their `foldProjection` is taken
- [x] `spikes.fold` and `fold_export.fold` are byte-identical (sha256
      `15ac8a5d…`) and geometrically identical to `non-flat-harder_final.osf`'s
      projection. None of the three is committed: the family is represented by
      `spikes_small` and `spikes_large`
- [x] **CORRECTION — do not round the coordinates, at any precision.** This plan
      said "minified at 6 decimal places", which on a 400-unit sheet is 2.5e-9
      relative and reads as obviously safe. It is not. Measured with
      `fold_corpus_scan`: at 6 dp `penguin_freeform` goes from **0
      flat-foldability violations to 12** and `rabbit_unclosed` from 0 to 5; at
      7 dp `rabbit_unclosed` still reports 1. Every verdict survives from **8 dp**
      up — but 8 dp still moves one of `penguin_disconnected`'s parallel-plane
      separations from 7.86 units into the 1e-12..1e-9 band that §2 step 6's
      spectrum test reads, which would make a fixture's most interesting property
      an artefact of how it was written out. So the fixtures carry what the
      author saved, float noise included (`box_90` has an x of 2.84e-14 where 0
      was meant). Minifying the JSON alone recovers most of the size —
      `spikes_large` 58.7 KB → 18.2 KB — and rounding on top buys under 7 KB
      across the whole set
- [x] **(b) External set, behind an env var.** `ORISTUDIO_NON_FLAT_CORPUS_DIR`,
      matching the `ORIEDITA_FOLDED_CORPUS_DIR` / `TREEMAKER_CORPUS_DIR` /
      `FOLD_FRAME_CORPUS_DIR` convention. `crates/oristudio-cp/tests/non_flat_corpus.rs`
      scans it recursively and reads `.osf` projects directly, so no extraction
      step is needed to measure them. **R9 is answered in four parts**, because
      "print a skip notice" alone is what the Oriedita harness already does:
      the load-bearing assertions are on committed fixtures and need no
      environment at all; each skip prints a greppable `SKIPPED:` block naming
      the test, the variable and *what was not checked*;
      `corpus_coverage_is_stated` **always runs** and prints the whole roster of
      what did not; and `ORISTUDIO_NON_FLAT_CORPUS_REQUIRED=1` turns every skip
      into a failure, which is the form a CI job or a release check can demand —
      and a failing test's output is never captured, so that message is visible
      without `--nocapture`. A variable pointing at a missing directory, or at
      one holding no `.fold` or `.osf`, **fails** rather than skipping: "the
      variable is set" and "the variable points at the corpus" are different
      claims and only the second buys coverage
- [x] **The harness is asserted to work when the variable *is* set.**
      `corpus_landmarks_are_where_the_harness_expects_them` pins three landmark
      files with measurements that could not arise by accident —
      `spikes_better.fold` (420 segments, 0 flat, 114 spatial, 0 closure),
      `known-good/byu solar driven.fold` (246, 0, **90**, 0 — the R19 instance,
      and the clean line is the point) and
      `origami-simulator-corpus/fold/polygami.fold` (4134, 0, 1166, **365**) —
      plus a floor of 60 measurable files. A scan over zero files reports zero
      problems, and that is the failure that looks like success
- [x] **The derived fixtures are re-derivable, and it is tested.**
      `committed_fixtures_are_reproducible_from_their_sources` runs the
      documented command — `node scripts/osf-fold-projection.mjs` — against each
      source in the external corpus and asserts **byte equality** with the
      committed file, plus a byte-for-byte check of `box_90.osf` against its
      source. That is what makes it safe for the committed files to be derived
      artefacts, and it tests the documented command rather than a paraphrase of
      it
- [x] **`.osf` → `.fold` extraction recorded as a reproducible command.**
      `scripts/osf-fold-projection.mjs` reads
      `workspace.documents[N].creasePattern.foldProjection`, with `--component N`
      (needed for `penguin_freeform`, which is one of two designs on one canvas),
      `--precision N|full` and `--document N`. The exact command for every
      fixture is in `tests/fixtures/fold-angle-3d/README.md`
- [ ] **(c) Author only what the corpus cannot supply. Still open — this is what
      remains of Phase 2.** Six, not fifteen: `strip_coupled.fold` (the
      (−90, +180, +90) cross-plane counterexample), `pinwheel_cyclic.fold`
      (square twist), `prism_60.fold`, `tube.fold`, `nested_tongue.fold`,
      `bridge_tuck.fold`. Plus `annulus_90.fold`, which the Spike A harness
      already builds programmatically and which is the two-sided negative for the
      loop gate. `chain3_60.fold` and `chain3_120.fold` are **free** — Spike B
      built them and recorded their expected coordinates — as is the Miura 4×4
      generator with its 9 independent dual loops. The corpus's own clean non-90
      angles are `penguin_freeform`'s free-form set, so **60°/120° on a 3-face
      asymmetric chain still has to be authored**; §1 explains why 90° cannot
      substitute
- [ ] Authoring method chosen and written down for the six. Hand-writing
      `edges_foldAngle` for a bridge/tuck is not realistic; a small Rust builder
      emitting `.fold` from a described fold sequence is
- [x] A test asserting every fixture parses, carries the angles it claims, and
      reaches its recorded verdict, **extending
      `crates/oristudio-cp/tests/verify_fold_fixtures.rs`** rather than adding a
      second file. It also asserts that the directory listing and the pinned list
      are the same set — an unpinned fixture is a file nobody checks — and that
      at least two fixtures stay genuinely free-form, so the corpus can never
      quietly become 90°-only
- [x] The fixture test asserts the **spatial-vertex breakdown**, not just totals:
      examined / closure-failing / link-crossing / indeterminate. Confirmed on
      the committed set: **0 of its 245 spatial vertices is indeterminate**, so
      truth-table row (f) `Refused(VertexIndeterminate)` still has **no fixture**
      and one must be authored, or that arm ships untested. The total is pinned
      too, because "none are indeterminate" is worth nothing without a
      denominator
- [ ] Correct `origami-simulator-corpus/README.md:182-190` — its "clean ones"
      table lists `huffmanExtrudedBoxes` (37 flat / 480 closure per the repo's own
      scanner) and `honeycombKiri` (11 flat). Still open, and it is a file in the
      **external** corpus, not in this repository
- [x] **The ground-truth placement oracle, kept and now pinned.**
      `moosers_train_pair_is_a_usable_placement_oracle` asserts the asset is
      usable *and* bounds what may be concluded from it, which is the part that
      is easy to lose. Confirmed this session: 463 V / 946 E / 484 F in both
      states, identical topology so the vertex correspondence is free, both
      declaring `frame_classes: ["foldedForm"]`, 127 null `edges_foldAngle` all
      on `B` edges. And three noise-floor facts, each asserted as a **lower**
      bound so that swapping in a cleaner file fails the test rather than
      silently turning a smoke check into a tolerance: the two states are not
      isometric (worst relative edge stretch **0.0115**); the 100% state's own
      coordinates disagree with its own declared angles by up to **0.419°** over
      819 interior creases, which is why the bar is ≥0.5° and nothing finer; and
      the "0%" state's own faces bend by up to **1.288°**, so it is a folded form
      and not a `creasePattern` frame. Read through `treemaker_fold` directly,
      because `import_fold_document` drops z; stays external, because it is
      third-party

### Phase 3 — Placement and admission (kernel only, no UI) (**built**)

Built as `crates/oristudio-cp/src/folding3d/` — `placement.rs` (the walk, the
loop gap) and `admit.rs` (the gate) under a module root carrying
`Fold3dTolerances` and `Fold3dRefusal`. Tests: `placement.rs`'s own module for
anything needing `pub(crate)` `FoldGraph`, `crates/oristudio-cp/tests/folding3d.rs`
for the public gate against the Phase 2 fixtures, and
`corpus_admission_reports_every_verdict` in `non_flat_corpus.rs` for breadth.
Nothing user-facing, no wasm surface, no `.wasm` rebuild — Phase 5 owns all
three.

- [x] `pub mod folding3d;` in `lib.rs`; `folding3d/placement.rs`
- [x] `place_faces` reusing `face_positions` unchanged; per-face point images;
      `crease_fold_angle` applied directly
- [x] The disconnected case — but **not** detected from `face_position[f] == 0`,
      which Phase 1 made unreachable: `face_positions` now returns
      `FoldGraphError::DisconnectedFaces` itself, and this maps it
- [x] Placement reproduces `vertex_link_polygon` on asymmetric interior fans of
      degree 3, 5 and 6, to ≤1e-12 (measured: ≤5e-16)
- [x] Path-independence across all BFS roots — on `box_90`, `spikes_small`,
      `spikes_large` and `penguin_freeform` (3, 12, 155 and 71 independent dual
      cycles) rather than on a generated Miura, because the fixtures give more
      cycles on real authored data and the Miura's only role was to supply nine.
      **The bar is the model's own loop gap, not a fixed epsilon**: measured, the
      root-to-root disagreement is 1.0x to 6.6x the gap, which on
      `penguin_freeform` is 1.8e-7 rather than machine precision because that
      file's own coordinates carry a 7.9e-8 gap. A fixed 1e-13 would have been a
      bar on the fixture, not on the walk
- [x] **NEW (Spike B / R20). Reverse every `FoldGraph` face.** Confirmed at the
      source: `Polygon::calculate_area` is the negated shoelace, so every traced
      ring is clockwise in y-up. Both halves asserted by
      `foldgraph_rings_are_clockwise_and_the_walk_reverses_them_once`
- [x] **NEW (Spike B). Run the walk on `FoldGraph`-derived faces for a real
      model.** Every fixture test does; nothing in `folding3d` ever reads a
      file's `faces_vertices`
- [x] Placement assertions compare **the whole placed face**, at ≤1e-9. The
      three-face chain is asserted against coordinates re-derived independently
      with Rodrigues matrices, at 60° and 120°, and the free vertex lands on
      Spike B's recorded `(+0.844669914, −0.655330086, +0.739198920)` exactly
- [x] The **dihedral round-trip** is paired with path-independence — but over the
      **non-tree** joins only. **[new finding: over the tree it is a tautology.]**
      A tree join is exact by construction, because the walk built the child by
      rotating it that far; the first version of this test read 2.8e-14 on
      `rabbit_unclosed`, a model with a 70.5° error. Over the non-tree joins it
      reads that 70.5° — the same figure as the model's worst vertex closure
      residual, reached two independent ways
- [x] **NEW (found while writing the non-vacuity tests): a fan cannot test
      composition order.** The dual graph of a degree-3 fan is a triangle, so the
      shipped BFS reaches every face in one step from any root and
      `M_parent ∘ step` and `step ∘ M_parent` are both `I ∘ step`. Spike B's
      fault injection was run on fans; the left-compose fault is **invisible**
      there (measured 2.5e-16) and only the three-face chain catches it. Both
      tests exist, and `a_shallow_fan_cannot_see_a_reversed_composition` pins the
      blindness so it is not rediscovered
- [x] Loop gap over non-tree dual edges **and** elementary per-vertex dual
      cycles, with `worst_edge` and `worst_vertex`, **gating** on the offset
      relative to span
- [ ] ~~An explicit **blind-cycle count** beside it~~ — **not built, and it
      cannot fire.** The walk refuses `NonCreaseJoin` on *any* dual adjacency
      carrying no fold angle, tree edge or not, so a document that places has no
      interior border anywhere; a blind cycle needs one at a vertex whose face
      ring closes, and a closed ring means every edge there has two faces.
      `a_placement_that_succeeds_has_a_crease_on_every_dual_adjacency` asserts
      the equivalence. Phase 1's `interior_border_segments` is the R19 detector
      and the gate consumes it directly
- [x] `folding3d/admit.rs`: flat snap into the gate's own segment copy;
      `dispatched_camv`; refusal on `DispatchedCamv::interior_borders`;
      `place_faces`; loop-gap gate; separation spectrum **reported**. The local
      crossing verdict comes from `dispatched_camv` and is **not** a refusal —
      see the note below
- [x] Tolerances in `Fold3dTolerances::DEFAULT`, and
      `CLOSURE_RESIDUAL_BAR_DEGREES` made `pub`. It was being redeclared in
      **five** places, not two — `fold_corpus_scan.rs`, `fold3d_census.rs`,
      `spike_fold3d.rs`, `verify_fold_fixtures.rs` and `non_flat_corpus.rs`. All
      five now read the one constant.
      **Two deviations, both stated rather than absorbed.** The const block lives
      in `folding3d.rs` rather than beside the bar in `lib.rs`: "beside" was
      about there being one block, and a 3D block buried at line 2,878 of a
      6,600-line file is not where a reader looks. And there are **two**
      tolerances plus the snap window, not three — the plan's absolute `len_tol`
      has no consumer, because `FoldGraph::from_segments` merges endpoints within
      `Epsilon::POINT` (2.5e-4) and so a crease with two distinct endpoints is
      already at least that long. A constant nothing reads is worse than no
      constant; Phase 4 declares it when it has a use. **[Phase 4 declared a
      fourth, and it is an area rather than a length: `overlap_area_relative`.
      `len_tol` still has no consumer.]**
- [x] `penguin_disconnected` returns `Disconnected { reached: 103, unreached: 127 }`
- [ ] ~~Two-sided loop-gap fixtures: `annulus_90.fold` … hole-deleted gap 2.094
      rad~~ — **superseded, and the reason matters.** The annulus is built
      programmatically in `a_drawn_ring_is_refused_at_the_join_the_closure_check_cannot_see`
      rather than committed, because a synthetic ring is code and the fixture
      directory's own rule admits only files the repo owner authored. And it does
      not measure a hole-deleted gap: the walk **refuses** the border join, which
      is a truer answer than a gap measured on the filled disk the drawing never
      described. Everything the fixture pair was for — CAMV silent, 0 spatial
      vertices examined, 4 interior borders, 5 faces past the Euler gate — is
      asserted; the 2.094 rad number is a property of the Spike A harness, which
      stepped over border joins with an identity
- [x] **R22 diagnosed and closed** before the phase shipped. See the corrected
      passage under "Spike C answer": the flat-check comparison was against
      `folded_points`, which averages, and the deviation tracks each document's
      own loop gap. The per-face comparison against `fold_movement` holds to
      ≤1e-9 on every all-classic fixture with no precondition
- [x] **Every refusal arm the gate can reach has a test that fails when it is
      deleted.** Found on review by mutation: `InteriorCut` and `LoopNotClosed`
      could each be removed and the whole suite stayed green, and they carried the
      two longest justifying comments in the module. `InteriorCut` is now asserted
      through `admit` on a drawn ring, *and* asserted to fire **before** the
      placement, which declines the same document for its own unrelated reason —
      it is the corpus's third most common verdict, 7 of 65, too common to leave
      to an external-corpus run. `LoopNotClosed` has no fixture and is not
      expected to get one, so its test drives the gate directly, moving the bar
      under a placement's own measured gap; what it pins is that the comparison
      happens, that it is relative to the span, and that the refusal carries the
      numbers the placement measured
- [x] **The gate traces the arrangement once.** It built it twice — once inside
      `dispatched_camv` for the interior-border question, once for the placement —
      putting the most expensive step in the function on the bill twice.
      `dispatched_camv_in` / `interior_border_segments_in` take the caller's
      arrangement, and `the_3d_gate_traces_the_arrangement_once` holds it
- [x] **The cost `interior_border_segments` added to the edit path is paid down,
      not just accepted.** `CheckCamv` runs on the 120 ms debounced post-edit path
      and, on a document carrying a non-classic crease, now traces a full
      arrangement: measured on the corpus's 9,162-segment `ALL-combined.fold`,
      42 ms of a 53 ms check against 5.5 ms for `check4` alone. Root cause was not
      the new work — it was `FoldGraph::from_segments` deduping points with a
      linear scan, `O(n^2)` in the vertex count, paid by *every* arrangement in
      the app including the flat fold's. A uniform grid over the same merge radius
      returns the same vertex in the same order (asserted against the scan itself,
      on points jittered across the radius) and takes the same file to 16.8 ms,
      and the 42,834-segment `ALL-36-combined.fold` from 762 ms to 79 ms. The
      whole corpus census is byte-identical afterwards. `spatial_check_cost.rs`
      could not see any of this — its only document was an all-classic grid, which
      short-circuits before both the through-line index and the arrangement — so
      it now carries a document that reaches the spatial branch
- [x] `cargo fmt --check`; `cargo clippy --workspace --all-targets -- -D warnings`;
      `cargo test --workspace`; `npx tsc --noEmit`;
      `ORISTUDIO_NON_FLAT_CORPUS_DIR=… cargo test -p oristudio-cp --test non_flat_corpus`

#### Four shapes that changed, and what they cost the phases after this one

**`Placement3dError` is not a separate type.** Every arm of it would have been
copied into `Fold3dRefusal` and the two would drift, so the walk's refusals *are*
refusals. `UnassignedCrease` is renamed `NonCreaseJoin` for the collision the
plan already flagged one level up: `checks_spatial::Indeterminate::UnassignedCrease`
is a public enum in the same crate meaning something else.

**The Phase 5 cause set was missing an arm, and a fixture proves it.** The list
at Phase 5 has no way to say "this vertex's creases do not close" — but
`rabbit_unclosed`'s recorded verdict is *refuse — closure*, and it is the corpus
refusal a user is second most likely to meet. `Fold3dRefusal` therefore carries
`VertexClosure { point, residual_degrees }` and `FlatFoldability { point, rule }`
as well as the eight the plan named. Phase 5's verdict copy has ten codes to
cover, not eight.

**`LocalCrossing` is not a refusal.** `admit` returns an `Admission` carrying
`local_crossings: Vec<Point>`, and `Admission::outcome()` is the three-way
verdict's first two arms (`Folded` | `LocalCrossing`); the third, no valid layer
order, belongs to Phase 9. The geometry of a locally self-intersecting vertex is
computed and drawable, and naming the vertices is more use than declining to
answer. **Consequence for Phase 4's checklist:** "align `fold3d_census`'s
`admissible` predicate with the shipped gate" means `outcome() == Folded`, not
`admit(..).is_ok()`.

**`non_tree_edges` is the dual graph's first Betti number**, `|E_dual| − F + 1`,
and it is **larger** than the `fold3d_census` column the fixture README records —
155 vs 137 on `spikes_large`, 46 vs 44 on `rabbit_unclosed`, identical on
everything else. The harness keys tree membership on the *face pair*, so when two
faces meet across two separate segments — exactly what a crease drawn as two
collinear pieces produces — it drops the second meeting along with the
consistency condition it carries. The kernel keys on the edge. The loop-gap
*values* are unchanged, because those extra joins read zero.

#### The refusal distribution, measured through the shipped gate

`corpus_admission_reports_every_verdict`, over the whole external corpus (65
files, `ORISTUDIO_NON_FLAT_CORPUS_DIR`):

| verdict | count |
| --- | --- |
| admitted | 25 |
| admitted with a local crossing | 1 |
| `FlatFoldability` | 21 |
| `VertexClosure` | 8 |
| `InteriorCut` | 7 |
| `Disconnected` | 1 |
| unreadable | 2 |
| `NoFaces`, `FacesUnresolved`, `NonCreaseJoin`, `VertexIndeterminate`, `LoopNotClosed` | **0** |

**This corrects R3b, and it changes Phase 7's copy budget.** The plan says
`Refused(FacesUnresolved)` "is the verdict users will meet most often" and tells
Phase 7 to rank its copy by it. It is reached by **nothing**. The Euler gate does
wipe the faces of 18 of the 36 published models — that number reproduces — but
every one of them refuses earlier, at a vertex check, because §2's order runs
`dispatched_camv` before the placement. The refusal users will meet most often is
**`FlatFoldability`**, and the second is `VertexClosure`. Both name a vertex,
which is a far better verdict to have to write copy for.

`LoopNotClosed` reaching nothing is the expected shape rather than a gap: on
simply connected paper it follows from per-vertex closure, and the coverage hole
that made the implication false is refused one step earlier by `InteriorCut`. It
stays as defence in depth, and its own test drives the gate directly rather than
through a fixture, because no fixture reaches it.

### Phase 4 — Plane clustering and the coplanar-overlap census (merge blocker)

**Done.** `folding3d/planes.rs`, `folding3d/overlap.rs`, `folding3d/census.rs`,
`tests/folding3d_census.rs`, and `corpus_census_reports_every_model` in
`tests/non_flat_corpus.rs`. Four items below changed shape on contact and say so.

- [x] `folding3d/planes.rs`. **[rewritten — the partition is not built from the
      topology, and it is not built greedily.]** Two changes to what this line
      used to ask for, both forced by measurement:
      **(i) Topology is a seed and an alarm, not the classification.** The plan
      said ±180-connectivity "on a flat base classifies most of the model for
      free". True on an all-180 document, where it is the whole answer
      (`box_90_unangled` 1 class = 1 plane). On a document with real 3D angles it
      **over-splits**: `box_90` 5 classes over 4 planes, `spikes_large` 34 over 8,
      `origamisimulator` 68 over 29. Geometry does the merging. Feeding the seed
      into the partition would also merge two genuinely distinct planes exactly
      when the placement is inconsistent, which is the case the alarm exists for.
      **(ii) The partition is the connected components of the coplanarity
      relation**, by union-find over every face pair — not a greedy first-match.
      Greedy is order-dependent on a chain (`[[0, 0.6·tol], [1.2·tol]]` ascending,
      `[[1.2, 0.6], [0]]` descending, one cluster of three from the middle), and
      the "check the clusters are separated" half of the uniqueness argument only
      rules that out if it compares every cross-cluster **pair** rather than the
      representatives. Components make that half a theorem instead: two clusters
      with a within-tolerance member pair would be one cluster. What is left to
      verify is that the relation is an equivalence at all, which is the
      intra-pair pass, and `ClusterNotTransitive` is what it says when it is not
- [x] A topology-vs-geometry disagreement is a first-class alarm. `ToleranceAlarm`
      has both arms and `plane_index` is **infallible** — every violation comes
      back as data, so the alarms are testable on models the gate refuses, which
      is where they fire. `census(&Admission)` is what turns one into
      `ToleranceWindowClosed`. Over the corpus the alarms fire on 4 of 55 models
      and 0 of the 18 admitted
- [x] Connected footprint patches within each plane, from `Placement3d::joins` in
      O(E) rather than from the harness's O(F²) shared-vertex test
- [x] `folding3d/census.rs`: direct polygon clip-and-area overlap count, and it
      calls no `calculate_faces`
- [x] Census equals `treemaker-flatfold`'s ordering-variable count on an all-180
      document. **No gap, as predicted**: 117 on Kabuto, 15 on
      `treemaker-triad-base`, 3 on `accordion-book-fold`, 28 on `squash-local`,
      each equal to `solve_flat_fold(..).constraints.variables` read in the same
      test. `treemaker-flatfold` is now a dev-dependency of `oristudio-cp`; it
      depends only on `treemaker-fold`, so there is no cycle
- [x] Census reproduces `fold3d_census`'s recorded per-model counts on the Phase 2
      fixtures — on every one **except `rabbit_unclosed`** (harness 26 planes /
      306 pairs, kernel 25 / 371). That is the fixture whose placement does not
      close, so which faces are coplanar is genuinely tolerance-dependent, and the
      harness's `dot > 1 − 1e-9` normal test is a *squared* quantity and so an
      effective 4.5e-5 rad bar, 450× looser than `angle_radians`. Recorded in the
      fixture README as a third column note beside `ntree` and `loop-gap`; do not
      "fix" either side. The harness's `signed_area` / `clip_convex` /
      `intersection_area` **graduated into `folding3d/overlap.rs`** and it now
      imports them — that one primitive must not exist twice, or the cross-check
      can fail for a reason unrelated to the geometry
- [x] Census is 0 on a wrap-free net and non-zero on a wrap. **[corrected — the
      fixtures this line named do not exist.]** There is no `flat_base_1shape.fold`
      and no committed deployed-Miura or open-accordion, so the anchors are built
      in the test instead: a four-panel open box measures 0, a five-panel tube
      measures 1, nine panels measure 6. Census 0 also holds on `hinge_90` and, in
      the corpus, on `cubeunwrapping`, `test_export` and `valid-waterbomb-vertex`
      — 3 of 18 admitted, all 6 faces or fewer
- [x] **`census ≥ (full-folded face pairs)` asserted on every fixture**, and the
      converse never. **[refined — the left-hand side is face pairs, not
      creases.]** Counting creases breaks the theorem on `bird_base.fold` (12 full
      folds, 4 traced faces, census 6): a ±180 crease bordering no traced face, or
      the same face twice, lays nothing on anything, and a crease drawn as two
      collinear pieces contributes two creases and one pair. `Fold3dCensus` carries
      both — `full_fold_creases` for the README's `±180` column and
      `full_fold_pairs` for the theorem. The hypothesis is that the placement is
      consistent, and the alarm is what says it is not: `reschBarbell.fold` has 90
      full-folded pairs, census 60, and 30 `TopologySpansPlanes` alarms
- [x] Cross-plane coupling detection: `folded_line_index` groups creases whose
      folded images land on one 3D line, again as connected components under the
      same tolerances, and reports which groups span two or more planes.
      **[refuted — it must not be a refusal.]** The line above asked for
      `strip_coupled.fold` to come back `CrossPlaneCoupling`. Measured, coupling
      is not exotic: **every** admitted corpus model above six faces has at least
      one coupled folded line (15 of 15), including four of the five committed 3D
      fixtures — `box_90` 1, `spikes_small` 4, `penguin_freeform` 23,
      `spikes_large` 40. A refusal keyed on it would decline the smallest real 3D
      fold in the fixture set. So Phase 4 ships the detector as **data** and no
      `Fold3dRefusal::CrossPlaneCoupling` arm exists; §3's "v1 detects coupling
      and refuses, loudly" is dead and the ordering solver has to carry the
      constraint. The classifier is not firing spuriously: it reads **0** on every
      flat fixture (Kabuto, `treemaker-triad-base`, `accordion-book-fold`,
      `squash-local`, `box_90_unangled`), which have only one plane to couple
- [x] The 1×4 strip at (−90, +180, +90) is built and measured rather than
      described: 4 faces, 2 planes, 2 ordering variables in **disjoint** face
      pairs one per plane, and 1 coupled folded line. Its mirror at
      (+90, +180, −90) reads identically
- [x] `Fold3dTolerances` gains `overlap_area_relative = 1e-9` of span², the fourth
      and last bar, in the one const block. **[corrected — the plan expected a
      *length* bar and there is no such crease.]** The census's question is whether
      two coplanar faces share paper, and two faces meeting along an edge share an
      exactly measure-zero sliver of it, so the bar is an area. Measured band over
      the admitted corpus: largest rejected 3.99e-14, smallest accepted 1.44e-5,
      both relative to span² — 4.4 decades below the bar and 4.2 above
- [x] `Fold3dDiagnostics::min_plane_separation` renamed `min_face_offset_gap`,
      because it is not plane separation. It is a consecutive difference between
      per-*face* offsets inside a normal class, so on a plane holding many faces
      it reports that plane's jitter: `penguin_disconnected` reads 4.048e-9 where
      the nearest genuinely distinct plane is 1.96e-2 of span away. The side
      condition's real upper bound is
      `PlaneIndex::min_inter_separation_relative`, and it is `None` on more than
      half the fixtures — `None` is a real answer, not an infinity
- [x] `cargo test -p oristudio-cp`, plus the corpus run behind
      `ORISTUDIO_NON_FLAT_CORPUS_DIR`

#### What Phase 4 measured about the tolerance window

Every number here comes from a **committed command** —
`corpus_census_reports_every_model` in `tests/non_flat_corpus.rs`, and the band
assertions in `tests/folding3d_census.rs`. The plan's earlier corpus figures came
from an instrumented harness that no longer exists and should not be carried
forward without being re-derived.

| quantity | worst over admitted corpus | bar | headroom |
| --- | --- | --- | --- |
| intra-plane normal diameter | 2.819e-8 rad (`airplane`) | 1e-7 | **3.5×** |
| intra-plane offset diameter | 2.139e-8 of span (`airplane`) | 1e-6 | 47× |
| inter-plane separation | 1.515e-2 of span (`origamisimulator`) | 1e-6 | 4.2 decades |
| largest rejected overlap | 3.99e-14 of span² | 1e-9 | 4.4 decades |
| smallest accepted overlap | 1.44e-5 of span² | 1e-9 | 4.2 decades |

**The angle bar has a factor of 3.5, not decades**, and `airplane.fold` eats both
its coordinates at once — where, as §2 already noted, the numbers are measuring
that file's 6-decimal coordinate rounding rather than any design angle. That
single row is why the verification pass has to exist rather than be assumed, and
why the corpus assertion on it is a band rather than a floor. On the committed
fixtures the same figures are 1.11e-9 and 8.67e-11, both decades clear.

Cost, for the record and not as a gate: on the largest admitted corpus model
(`origamisimulator`, 2,637 faces, 29 planes, largest plane 1,480, 12,736 pairs)
`plane_index` is ~30 ms and the census on top of it ~12 ms, in a release build.
The clustering is the O(F²) half. `spikes_large`, the committed scale fixture, is
0.2 ms and 1.0 ms. A spatial index is worth revisiting at ~10⁴ faces in one plane;
nothing in the corpus is within an order of magnitude of that.

### Phase 5 — Engine boundary (nothing user-facing)

**Done.** `folding3d/snapshot.rs`, `folding3d/model.rs`, `folding3d/wire.rs`,
`folding3d/session.rs`, `session.rs`, `crates/oristudio-cp-wasm`,
`apps/tauri/src-tauri/src/cp_engine.rs`, `apps/web/src/engine/oristudioCpTypes.ts`,
`apps/web/src/workers/oristudioCpWorker.ts`,
`apps/web/src/engine/oristudioCpNativeClient.ts`, and the tracked `.wasm`.
**What a frontend needs from it is [The engine contract](#the-engine-contract)**,
not this checklist — the checklist records how it got there and which four items
changed shape on contact.

- [x] `Fold3dSnapshot` as a **sibling** of `FoldedFigureSnapshot`
      (`folding.rs:319`), not an extension — the latter's `wireframe` is 2D and
      drives `FoldedFigurePlacement` as 2D primitives.
      `crates/oristudio-cp/src/folding3d/snapshot.rs`
- [x] Carries the cycling fields so the cycling UI binds with no new plumbing,
      plus the verdict, diagnostics, census and per-plane summaries (each with
      its own `up`, per §1d), `undetermined_pairs`, `undetermined_cells` and the
      crossings. **[amended — `text_result` and `estimation_step` are not
      carried.]** `text_result` is Oriedita's raw English status line, nothing
      in the frontend reads it (`grep` finds only two test literals), and this
      plan says twice that the eight-locale gate cannot see a Rust string
      literal — so carrying it would ship exactly the thing the rest of the
      phase is careful about. `estimation_step` is an Oriedita enum with no
      3D meaning. The four fields the cycling verb actually reads are
      `discovered_fold_cases`, `current_fold_case`, `find_another_overlap_valid`
      and `has_next_solution`, and all four are present
- [x] Stable **codes**, never sentences, in `folding3d/wire.rs` — one
      exhaustive `From` per kernel enum, no `_` arm, so a refusal added later
      fails to compile until it has a code. **[three amendments.]**
      **(i) `Fold3dOutcome` is not widened**, and the plan's
      `Fold3dVerdict { …, Refused(cause) }` is not what shipped.
      `Admission::outcome()` is a two-branch function and the only producer of
      `Fold3dOutcome`; the type is `Copy + Eq` and is compared with `assert_eq!`
      in the corpus harness, so widening it adds arms its producer cannot
      return and the *consumer* gets a compile error while the producer gets
      nothing. `Fold3dVerdict` is a separate type in `wire.rs` with four arms:
      `Folded | LocalCrossing { vertices } | TransversalCrossing { crossings } |
      NoLayerOrder { reason }`. `Refused` is **not** an arm — a verdict only
      exists when a figure does — and the refusal is the other arm of
      `Fold3dFoldResult` instead, which makes the impossible state
      unrepresentable rather than guarded.
      **(ii) The three non-`Folded` conditions can co-occur**, so the
      composition site applies one documented precedence — `NoLayerOrder` >
      `TransversalCrossing` > `LocalCrossing` — and the snapshot carries every
      count separately, so the choice hides nothing.
      **(iii) Codes are mirror enums, not `&'static str`.** The snapshot has to
      round-trip through `.osf` in Phase 8 and a borrowed literal cannot
      deserialize. `FlatFoldabilityRuleCode`, `IndeterminateCode` and
      `SeedKindCode` mirror the three port-owned enums; `checks.rs` is untouched
- [x] `folding3d/model.rs` — `Folded3dRenderModel`, struct-of-arrays, emitted
      once per fold and once per `fold_another`. Measured on the largest
      admitted corpus model (`origamisimulator`, 2,637 faces, 9,792 ring
      vertices): `ring_points` is **235,008 bytes**, against 609,322 bytes of
      JSON for the nested `Vec<Vec<[f64; 3]>>` shape. The layout is chosen so
      the later transferable-typed-array upgrade is a pure substitution of the
      `set_f64_array` / `set_i32_array` helpers `oristudio-cp-wasm` already has
- [x] **Cells, not faces, are the drawable unit**, and this is what makes
      Phase 6's `pinwheel_cyclic.fold` requirement expressible at all: a cyclic
      panel order is legal, so no per-face scalar "layer" exists, and what
      always exists is a winner per arrangement cell. Every face is drawn by
      some cell — a face inside an overlap group is covered by that group's
      arrangement, a face that overlaps nothing gets a single cell that is its
      own ring — checked by `RenderModelError::FaceInNoCell` and by
      `corpus_boundary_reports_every_model` over the whole corpus, not hoped
- [x] **Three** new entry points, not one, registered in **all five** places
      plus the tracked `.wasm` in **one** commit: `folded_figure_fold_3d`,
      `folded_figure_3d_fold_another`, `folded_figure_3d_duplicate`.
      **[amended — "one entry point" does not survive contact.]** `fold_another`
      is required by this phase's own cycling requirement, and Duplicate is a
      live UI verb (`useFoldedFigures.ts:297`, `:342`); a folded figure that
      sometimes cannot be duplicated is a worse product than one that always
      can. `folded_figure_3d_fold_to_case` is **deliberately not** in the merge
      set: nothing on the CP canvas calls `foldToCase` (it is reachable only
      from `creaseExportFold.ts:267`), and `discovered_fold_cases` is a
      forward-only high-water mark with no denominator, so "case N" has no
      stable meaning to batch to. A 3D handle passed to the flat
      `folded_figure_fold_to_case` gets `folded_figure_kind_mismatch`
- [x] **Routing is two mirrored guards, not a branch inside `fold_segments`'s
      return type.** **[amended — the plan's "3D dispatch in `fold_segments`"
      would force `folded_figure_fold_selected`'s return type to become a union
      and break the flat contract for the wasm bridge, the Tauri command, the
      worker, the native client and every store consumer at once.]** The
      frontend routes on the predicate it already computes locally at
      `creasePatternSlice.ts:1659-1661` — no round trip, and the document it
      reads is a decode of the kernel's own geometry, refreshed after every
      command, so it is exactly as informed as the kernel would be. The kernel
      then refuses `fold_needs_3d` (flat command, non-classic in scope) or
      `fold_is_flat` (3D command, none in scope). That covers all three fold
      doors — `foldOristudioCpDocument`, `refoldOristudioCpFoldedFigure`
      (`:2175`) and `foldAnotherOristudioCpFigure` (`:1795`) — without any of
      them having to agree with each other
- [x] The flat guard sits in `fold_segments`, **after** the empty-selection
      widening at `session.rs:579-583`. A non-empty id list that resolves to
      nothing silently folds the whole document, so a guard on the pre-fallback
      set lets a mixed document fold flat and draw a plausible picture with no
      error. `the_flat_guard_survives_the_empty_selection_widening` is the test,
      and moving the guard back to the pre-fallback set is the one mutation that
      fails it while leaving the obvious first test passing
- [x] `folded_figure_fold_3d` does **not** inherit that widening: an empty
      resolved selection is `EngineError::invalid_input`. In 3D the blast radius
      is an expensive whole-document fold that may refuse for reasons the user
      cannot connect to their selection
- [x] Slice-taking `has_non_classic_segments` beside `has_non_classic_creases`
      (`model/mod.rs:551`), with a test that the two **disagree** on a mixed
      document scoped to its classic half — that disagreement is row (b) of the
      truth table
- [x] One arena, kind-tagged: `FoldedFigure { Flat | Spatial }`. Every flat
      command on a spatial handle and every spatial command on a flat one is
      `folded_figure_kind_mismatch`, never a wrong answer; `free_folded_figure`
      is shared, so `foldedFigureHandles.ts` retention needs no change and
      handle ids stay unique across kinds
- [x] A refusal is an `Ok` **result** (`Fold3dFoldResult::Refused`), never an
      `EngineError`: it must not reach the store's catch path, must not raise an
      error toast and must not destroy the draft figure, and `EngineError`'s
      flat `code` + `message` cannot carry a `point` or a `residual_degrees`
      anyway
- [x] TS mirror types in `engine/oristudioCpTypes.ts`, and **one** additive
      field on the entry — `folded3d?: OristudioCpFolded3dSnapshot | null`. Not
      a union on `snapshot`: there are nine read sites that would have to narrow
      for no gain, plus two hand-written entry literals (`store.test.ts:1146`,
      `scripts/folded-grid-screenshot.mjs:44-60`, the latter not in CI) that
      would break far from anything this change is about
- [x] One place knows a folded figure has two kinds:
      `foldedFigureCycling` in `cp-workspace/folded/foldedFigureState.ts`.
      `buildFoldedFigureActions` derives `hasNextSolution` and `wrapsToFirst`
      from it, and `isFoldedFigureReady` asks for either snapshot rather than
      reporting every 3D figure as not ready
- [x] **Committed wasm rebuild** —
      `npm --workspace @treemaker/web run build:oristudio-cp-wasm`, then
      `git add -f apps/web/src/generated/oristudio-cp-wasm/` (the directory's own
      `.gitignore` is `*`, so a plain `add` skips newly-appearing files), then
      confirm with
      `strings apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm | grep fold_3d`.
      **The files are tracked** — `git ls-files apps/web/src/generated` lists 12.
      `AGENTS.md` said otherwise and named the wrong crate and target; it has
      been corrected on this branch rather than left contradicting the tree.
      **This item went stale once and was caught in review**: the artifact was
      rebuilt one commit before a behaviour-changing kernel edit, and because a
      body-only change leaves the `.js` and `.d.ts` byte-identical, lint,
      typecheck and vitest all passed over the stale binary. The rebuild has to
      be the **last** commit that touches `crates/oristudio-cp*`, or it is not a
      rebuild
- [x] Note the local-vs-CI trap: `pretest`/`pretypecheck`/`prebuild` all rebuild
      wasm, and CI passes `--ignore-scripts` after building explicitly, so **no
      workflow verifies the committed artifact** (`grep -rn "git diff\|--exit-code"
      .github/workflows/` returns nothing). Running `vitest` directly tests the
      committed wasm; `npm run test:web` tests a fresh one
- [x] `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`,
      `cargo test --workspace` (1,428 passed after the review fixes), the corpus
      suite under `ORISTUDIO_NON_FLAT_CORPUS_REQUIRED=1`, `npx tsc --noEmit` and
      `npx vitest run` (2,986 passed). `wasm-pack test --node` and
      `npm run check:desktop` are **not** run here — see the note below

#### What Phase 5 measured, and the two things it found

Every number below comes from a committed command:
`corpus_boundary_reports_every_model` in `tests/non_flat_corpus.rs`, and
`tests/folding3d_boundary.rs`.

| quantity | value |
| --- | --- |
| corpus models that place through `Fold3dSession` | 19 of 53 |
| of those, faces drawn by no cell | **0** |
| largest render model (`origamisimulator`, 2,637 faces) | 235,008 B of `ring_points`, 1,285 cells, 5,010 edges |
| models reporting a verdict other than `Folded` | 3 — `airplane` `NoLayerOrder`, `birdBase` `TransversalCrossing` (64), `self-intersecting-vertex` `LocalCrossing` (1) |
| committed 3D fixtures with more than one layer order | **1 of 5** (`penguin_freeform`, 8) |

**The last row is the one that matters for testing.** `hinge_90`, `box_90`,
`spikes_small` and `spikes_large` each have exactly **one** layer order, so any
cycling assertion written against them is vacuous — the first draft of the
boundary suite cycled `box_90` and survived a mutation that made Duplicate
restart its stream. The cycling tests now name `penguin_freeform` and assert up
front that it has more than one solution, with `box_90` keeping a separate test
for the one-solution stream, which is what most users will meet. The same trap
applies to Phase 10's "pressing Another Solution changes at least one face in the
largest component" — see that checklist.

**Two laps past the wrap found a real defect in Phase 9's enumerator**, which is
why the test takes two: `current_fold_case` was derived from the monotone
discovered count, so lap 1 read `1..8` and lap 2 read `1, 9, 10, … 15`. After a
wrap the stream is showing solution 1 again, so the next press is solution 2.
Fixed by splitting `position` from `discovered` in `Fold3dOrderEnumerator`. No
existing test in the repo presses a fold stream past its wrap, flat or 3D.

**Not run, and why.** `wasm-pack test --node crates/oristudio-cp-wasm` — the
crate has no `#[wasm_bindgen_test]`s and the three new entry points are
five-line `from_js` / delegate / `to_js_value` wrappers whose bodies are covered
by `folding3d_boundary.rs`; the marshalling itself is exercised by `vitest`
against the committed artifact. `npm run check:desktop` and `npm run build:web`
— neither is reachable from this phase's changes beyond what
`native_commands_match_the_shared_manifest` and `npx tsc --noEmit` already
cover, and both were skipped deliberately rather than forgotten.

#### The contract Phase 6/7/8 build against

**Moved.** It is now the top-level [The engine contract](#the-engine-contract)
section, with the types and entry points beside the guarantees, so the frontend
half has one place to read rather than a subsection of a kernel phase.

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
- [ ] Opaque per-face fills by default. **Per-face translucency only for pairs
      Phase 9 could not decide** — an annotation, not a mode (the census being
      non-zero is the common case and no longer implies undetermined). *Not*
      `Transparent3`: `needs_subfaces` (`folding.rs:2232-2235`) includes it, so
      that style needs the whole-document arrangement
- [ ] Per-plane flat shading from the plane normal (`svgRenderer.ts:515-552`)
- [ ] Piece-count guard with a tested refusal path
- [ ] `pinwheel_cyclic.fold` renders every overlap cell with the correct winner,
      asserted **per cell** — the regression test a future "just sort it"
      refactor must fail
- [ ] Regression test in `packages/origami-simulator/src/bsp.test.ts` that a
      straddling face cannot reorder a coplanar stack (`bsp.ts:253`)
- [ ] `npm run test:web`; `npm run test:simulator`

### Phase 7 — `G` dispatch, verdict UX, i18n
- [ ] Three-way dispatch replacing `creasePatternSlice.ts:1659-1672`:
      all-classic falls through with **no edit below `:1628`**; non-classic +
      admitted takes the 3D branch; non-classic + refused keeps today's simulate
      dialog
- [ ] `refoldOristudioCpFoldedFigure` (`:2041`) and
      `foldAnotherOristudioCpFigure` (`:1795`) routed through the same dispatch
- [ ] Signature changes mirrored in
      `store/workspaceStore/types.ts:798`/`:804`/`:821`
- [ ] The six-row truth table pinned in `store.test.ts`, decided on **scoped**
      ids only. The three existing tests at `store.test.ts:2858` are rewritten,
      not deleted — especially `:2924`, which folds the diagonal alone of a
      90° square, a selection that is non-classic **and** has no closed region:
      a ready-made `Refused(FacesUnresolved)` fixture
- [ ] CAMV gate copy split by regime (flat kinds vs
      `SpatialClosure`/`SpatialSelfIntersection`), reusing the **same**
      `runOristudioCpCheckCommand('CheckCamv')` call. Scope unchanged
- [ ] Verdict copy in an i18n table keyed on the kernel code, beside
      `foldabilityMessages.ts`. **[rewritten — "inheriting its exhaustiveness
      test" is not available.]** That test (`foldabilityMessages.test.ts:70-90`)
      iterates only `FOLDABILITY_RULES`, which is Oriedita's five flat rules
      (`foldabilityMessages.ts:44-61`), and nothing gates a spatial `rule` at all:
      `foldabilityEntryMessage` special-cases `entry.rule === 'SelfIntersection'`
      before the `isRule`/`isColor` guard (`:171-176`), and
      `cpDiagnosticEntryMessage` (`:190`) falls back to `entry.message` for
      everything else. So a **new spatial-rule table plus its own exhaustiveness
      gate** must be written, not inherited
- [ ] `LocalCrossing`, `TransversalCrossing` and `Refused` are **not** error
      toasts and do **not** destroy the figure — mirror
      `conclude_with_contradiction` and carry the verdict on the entry.
      `creasePatternSlice.ts:1828` already states the principle for the flat
      contradiction
- [ ] **Verdict copy budget ranked by measured frequency, not by novelty.**
      `FacesUnresolved` (the Euler gate — 18 of 36 published models) and closure
      failure dominate. `LocalCrossing` fires **once** across 63 corpus files, on
      the fixture built for it, and its string already exists in every locale. Do
      not spend the copy budget in inverse proportion to what users will see
- [ ] `CreasePatternPanel.tsx:604` no longer renders a raw status identifier as
      the list subtitle
- [ ] Decide `OristudioCpFoldedFigureStatus`'s unused `'unsupported'` arm
      (`oristudioCpTypes.ts:402`) — zero producers today; use it or delete it
- [ ] Cycling: `fold_another` reused verbatim, **one** solution verb, no
      `fold_to_case` on the canvas, no "k of N"
- [ ] Test: two full laps past the wrap on a 2-solution fixture (no existing test
      presses past the wrap)
- [ ] **i18n, as its own gated block:** new strings across `errors`, `panels`,
      `dialogs`; `npm run i18n:extract`; translate 8 locales; `npm run i18n:stamp`;
      `npm run i18n:check`. **[re-scoped — the estimate of ~12 was high.]** The
      self-intersection string already exists and is already translated
      (`foldabilityMessages.ts:171-176`, `locales/*/panels.json`), so
      `LocalCrossing` costs nothing. What is missing is the **gate**, not the
      copy — see the exhaustiveness item above. Two kernel strings do ship raw
      English in all eight locales and should be fixed while adjacent:
      `lib.rs:3123` (`"Creases do not close: {residual_degrees:.4} degrees off"`)
      and `:3063-3066` (`"Vertex cannot fold: degree {} is rigid …"`). `:3047` is
      a third but the frontend already overrides it. The plan previously cited
      `:3070`, which is an `id`, not a message
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
      `droppedByFormats`. Note `supersetFeatures.ts:136`'s existing `foldAngles`
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

### Phase 9 — Per-component layer ordering (**merge set** — Spike C said so)

**Done.** `folding3d/cells.rs`, `folding3d/constraints.rs`, `folding3d/order.rs`,
`folding::validate_initial_hierarchy`, `tests/folding3d_order.rs`, and
`corpus_ordering_reports_every_model` in `tests/non_flat_corpus.rs`. Both open
spikes are answered below, and five items changed shape on contact and say so.

> **Spike A's plane-patch half — answered, and the repair is one line of
> grouping.** The gate the brief was scoped around is Euler's, and
> `V - E + F = 1` holds for a **connected** planar subdivision. A plane's
> projected faces are frequently disconnected (two stacks in one plane, or a
> tongue nested strictly inside a face with no boundary contact), and they are
> frequently merely *touching* (a zigzag strip of triangles meeting at single
> vertices, where `r_point`'s smallest-angle rule walks across the pinch into the
> neighbouring region and returns the outer boundary instead of two cells). So
> the arrangement is built per **connected overlap group** — faces grouped by the
> census's own overlap relation, then split again by segment connectivity — and
> the gate opens. Measured: every admitted corpus model decomposes; the three
> that do not (`polygami`, `polygamiCross`, `langWedgeDoubleFaced`) are refused
> by the admission gate first. Neither cut injection nor a new arrangement
> builder was needed, so the estimate did not double.
>
> **Spike D — answered by Phase 4, and it fired.** Coupling is on every admitted
> model above six faces, so it is carried rather than refused. See §3.

- [x] `initial_hierarchy_3d`: seeds one relation per in-plane full fold exactly as
      `initial_hierarchy_from_graph` does, substituting **one boolean** —
      `dot(face_normal, up_P) > 0` for `first_position % 2 == 1` — and deleting the
      `SameParityAdjacentFaces` abort with the parity seed it belongs to
- [x] Free regression test, and it holds **bit-identically** on all four flat
      fixtures rather than up to a global inversion:
      `the_3d_seeder_reproduces_the_flat_seeder_on_a_flat_document`, with a
      non-vacuity assertion on the seed count. The flat function stays reachable
- [x] **[rewritten — the unit is the covering set, and the repair Spike A
      expected was not the one it needed.]** The line above asked for nesting
      detection and two injected cuts per nesting. What the solver actually needs
      is not a partition of the plane at all: a `SubFace` is a face-id set, so the
      output is the **maximal sets of faces covering a common point**, and two
      disconnected regions with the same covering set are the same constraint.
      That is what lets the decomposition skip a true arrangement overlay, and it
      is what makes the per-component grouping above sufficient — a face outside a
      component cannot cross its cells, so it either misses them, contains them, or
      nests inside them, and the nested case is its own component's business.
      Pairwise overlap is **not** enough and the difference is the pinwheel: three
      thin bars overlap pairwise with no common point, and a cyclic order over them
      is legal
- [x] Two postconditions against the census, in both directions, because the
      argument above is an argument: every ordering variable must have a subface,
      and every subface pair must be an ordering variable. A group whose Euler
      gate closes refuses outright rather than under-constraining — a lost *cell*
      is a lost subface, and a lost **triple** leaves all three of its pairs housed
      elsewhere while dropping the transitivity that forbids a cycle over them, so
      the pairwise check cannot see it
- [x] `LocalFaceMap` plus a hard `FaceIdOutOfRange` check before every search call,
      with `the_face_id_range_check_fires` breaking the guard and
      `an_out_of_range_face_id_makes_the_shipped_search_lie` demonstrating the
      hazard it guards
- [x] Shipped taco-tortilla and taco-taco generators reused on the projected
      coordinates, roles normalised against the seeds rather than by
      `normalized_pair`'s linear scan of the relation vector — which removes that
      function's own first-in-vector dependence
- [x] Wall rule on the crease **segment**'s interior. The direction is read off the
      placed geometry: the wall blocks the side it rises toward, so
      `dot(w, up_P) > 0` puts the crossed face **below** the crease's in-plane
      face. **[extended — the wall rule is one row of a table, not a special
      case.]** In the cross-section perpendicular to a folded line, every face is a
      ray, coplanar faces on one side share a slot, a face the line crosses is a
      diameter, and every crease is a chord; paper self-intersects exactly when two
      chords interleave. Taco-taco, taco-tortilla, the wall rule, the shared-slot
      determination and the cross-plane coupling are that one statement at five
      levels of freedom, and stating it that way is what produced the two cases the
      original list had no row for: two creases leaving one slot for two different
      slots (unary), and four slots all distinct (settled by geometry, so an
      interleaving there is a crossing no order repairs)
- [x] `validate_initial_hierarchy` propagating `infer_above`'s error, called before
      any table is built and so before role assignment can inherit the tie-break.
      **[extended]** The refusal names both rules and both creases, because a bare
      face pair is not actionable — and it is not an internal error but the
      **determinate form of "no valid layer order"**: two geometric rules that
      disagree mean no stacking exists, which is the third arm of the three-way
      verdict
- [x] `StackTooDeep` as its own arm, mapped from
      `SubFaceSearchError::CombinationGeneratorRequired`. Reached by nothing in the
      corpus
- [x] No acyclicity assertion and no sort. **[corrected — the fixture this line
      names does not exist, and building a crease pattern whose folded state is
      cyclic is a research problem rather than a fixture.]** The claim the design
      depends on is about the *reuse*, and it is tested directly:
      `a_cycle_across_stacks_survives_the_search` seeds `a > b > c > d > a` over
      four two-face subfaces and gets it back intact, while the same cycle inside
      **one** subface is refused. That is the real invariant — per arrangement
      cell, not globally
- [x] Kabuto through the 3D path reports 117 variables. **[corrected — `[81, 18,
      18]` is not a component decomposition; see §3.]** Its raw constraint graph is
      one component of 117, and the check that earns its keep is stronger than a
      count: the 3D path reproduces the flat path's own subfaces, its own seed
      relations and its own answer, relation for relation
- [x] A backward re-derivation, because the forward generator turns on two signs
      that are easy to get backwards. `constraints::interleavings` takes a finished
      ordering and asks the crossing question again from the placed normals and the
      relations alone, sharing neither the winding sign nor the condition roles. It
      runs on every shape in the suite and on every corpus model that produces an
      ordering, and it is empty on all of them
- [x] **The solving unit is the connected component of the constraint graph, and
      a component is a set of *variables*.** Both halves are load-bearing and the
      second was wrong in the first cut — see
      [The engine contract](#the-component-is-a-set-of-variables-not-a-set-of-faces).
      A face can carry variables in two components, and ownership derived from a
      face lookup silently drops one of them. Fixed, with the smallest instance —
      one panel, two flaps landing on opposite halves of it — as the regression
      test at both the solver and the engine boundary. No corpus model has the
      shape, so the table below is identical before and after
- [x] `cargo test -p oristudio-cp`, plus the corpus run behind
      `ORISTUDIO_NON_FLAT_CORPUS_DIR`

#### What Phase 9 measured

Every number here comes from a committed command:
`corpus_ordering_reports_every_model` in `tests/non_flat_corpus.rs`, and the
fixture table in `tests/folding3d_order.rs`.

| | |
| --- | --- |
| admitted corpus models | 18 |
| of which reach a layer order | **17** |
| of those, with an undetermined pair | **0** |
| with an ordering to actually do | 14 |
| of those, a single constraint component | 8 |
| chord pairs the backward re-derivation called crossing | **0**, on every model |

The one admitted model with no layer order is `airplane.fold`, and it is a
**determinate** one: its own creases and its own walls disagree about a pair, so
no stacking exists. Suppressing the shared-slot rule entirely does not rescue it —
the search still finds nothing — so this is the three-way verdict's third arm
rather than a rule misfiring, on the same file whose 6-decimal coordinate rounding
already eats both of the census's tolerance bands.

`birdBase.fold` is admitted, orders completely, and reports **64 crossings**:
one folded line runs through the interior of eight faces in each of two planes,
which is two sheets meeting along a line at an angle. That is a fact about the
file rather than about the ordering, and it is why the verdict and the ordering
are separate outputs.

Two shapes are worth keeping in view because they are the ones a reader can check
on paper. A five-panel paper tube has **one** ordering variable and **two** real
answers — the glue flap inside or outside — and is where the cycling verb is
pressed past its wrap into a second lap, which no existing test does. And a strip
folded in half and then bent has **no** valid layer order for half of the four
M/V combinations: the lower panel's neighbour rising through the slab between the
layers is not something a stacking repairs, and the sign of the middle fold picks
which half is legal.

**What no model exercises**, established by breaking each of these and watching
nothing fail, and said here rather than left for a reader to discover:

| guard | reached by | pinned by |
| --- | --- | --- |
| the segment-connectivity split inside an overlap group (a face nested strictly inside another, no boundary contact) | 0 of 55 corpus models | `a_nested_pair_only_traces_once_it_is_split`, on the mechanism |
| two chords with four **distinct** slots — the case where nothing is left to order and an interleaving is simply a crossing | nothing | `two_chords_cross_exactly_when_their_endpoints_alternate`, on angles |
| a cell at or below the census's area bar | nothing, which the census's own empty band predicts | nothing |
| a coincident-line group whose chain does not overlap end to end | nothing | nothing |

The backward re-derivation also has one thing it cannot answer: a chord pair whose
faces share a slot but overlap by **less** than the census bar has no ordering
variable between them and so no rank to read. That happens on exactly one corpus
model (`base.osf`, which the gate refuses) and comes back as
`Interleaving::Unordered` rather than being silently skipped or miscalled a
crossing.

Everything else in the phase was broken deliberately at least once. 24 mutations
across the four files — every sign, every determination, every condition, both
postconditions, the component split, the odometer's direction, and the plane's
orientation reference — and each one that a model can reach is caught by a named
test.

**Two of those 24 were not honestly caught, and review found both.** The wall
rule's rise sign was caught only by the boundary suite, not by
`a_wall_orders_the_face_its_crease_runs_through`, which counted refusals — and a
reversed rule swaps *which* two of the four shapes are refused while leaving the
count at two. That test now reads the seed's own orientation and names which two.
The other is the component-ownership defect above, which no mutation of the
existing code could have surfaced because it was in the code rather than in a
sign: the corpus has no model where two components share a face, so nothing in
the suite exercised the assumption at all. Worth stating as a limit of the
method — a mutation campaign tests the signs you thought to flip, not the
invariants you did not think to doubt.

Cost, for the record and not as a gate: `spikes_large` (214 faces, 543 variables,
64 couplings) orders in ~8 ms and the largest admitted corpus model
(`origamisimulator`, 2,637 faces, 12,736 variables) in ~0.7 s, both release.

### Merge-set validation (Phases 2–9)
- [x] `cargo fmt --check`; `cargo clippy --workspace --all-targets -- -D warnings`
      — run after Phase 9; re-run per phase
- [x] `cargo test --workspace` and `cargo test --workspace --doc` (CI's
      `--all-targets` excludes doctests, hence the separate step). 137 suites,
      **1,428 passed / 0 failed / 7 ignored**, doctests included
- [x] **Oracles actually run, not silently skipped.** `grep -rn ORIEDITA
      .github/workflows/` returns nothing, and 41 parity tests print
      `skipping … is not set` and pass when the env var is absent. Run with
      `tools/oriedita-oracle/build/oriedita-geometry-oracle`, the counts are:

      | suite | result |
      | --- | --- |
      | `oriedita_folding_oracle` | 28 / 28 — the gate on this branch's `fold_graph.rs` and `folding.rs` changes |
      | `oriedita_render_oracle` | 13 / 13 |
      | `oriedita_operations_oracle` | 59 pass, **3 fail** — `symmetric_draw`, `double_symmetric_draw`, `fishbone_draw`, the pre-existing reflect-over-line axis divergence, reproducible on pristine `origin/main` |
      | `oriedita_geometry_oracle` | 1 / 1 |
      | `oriedita_model_oracle` | 1 / 1 |
      | `oriedita_io_oracle` | 6 / 6 |

      **The render oracle needs `build_geometry_oracle.sh` re-run first.** The
      tracked `tools/oriedita-oracle/build/classes` predate the `paper-render-*`
      commands, so pointing `ORIEDITA_RENDER_ORACLE` at the committed shim gives
      13 "unknown command" failures that look like real parity failures. The
      rebuild is **not** committed: it rewrites an absolute path into the shim,
      and this worktree's path is not the primary checkout's
- [x] **The non-flat corpus actually ran.**
      `ORISTUDIO_NON_FLAT_CORPUS_DIR=<path> ORISTUDIO_NON_FLAT_CORPUS_REQUIRED=1
      cargo test -p oristudio-cp --test non_flat_corpus -- --nocapture`. The
      second variable is the point: it turns every skip into a failure, so this
      line cannot pass by having checked nothing. Green after Phase 9, with the
      ordering pass added to it; re-run per phase
- [ ] `tools/oracle/build_oracle.sh` + `TREEMAKER_CPP_ORACLE=… cargo test -p
      oracle-tests --test cpp_oracle` — **not run.** Nothing on this branch
      touches `treemaker-*` optimizer, parser or CP-generation code, which is
      what that oracle gates
- [ ] `wasm-pack test --node crates/oristudio-cp-wasm` — **not run.** The crate
      has no `#[wasm_bindgen_test]`s; the three 3D entry points are five-line
      `from_js` / delegate / `to_js_value` wrappers whose bodies are covered by
      `folding3d_boundary.rs`, and the marshalling is exercised by `vitest`
      against the committed artifact
- [x] Web: `npx eslint .`, `npx tsc --noEmit`, `npx vitest run` (287 files /
      **2,986 tests**, against the *committed* wasm), `npm run i18n:check`,
      `npm run test:scripts` (48/48, newly wired into CI by this branch). Run
      **directly**, not through the npm wrappers, because `pretest` /
      `pretypecheck` / `prebuild` regenerate tracked `generated/**` and so would
      test a wasm nobody committed. `npm run build:web` and
      `npm run check:desktop` are **not** run — neither is reachable from these
      changes beyond what `native_commands_match_the_shared_manifest` and `tsc`
      already cover. `npm run test:simulator` is **not** run and is unaffected;
      it IS in CI (`.github/workflows/ci.yml:83`), so Phase 6's BSP regressions
      will be CI-covered when they land. `typecheck:functions` is not in CI and
      nothing here touches `functions/`
- [x] `git diff --check origin/main..HEAD`; committed `.wasm` rebuilt as the
      **last** commit touching `crates/oristudio-cp*` and verified with
      `strings … | grep fold_3d`
- [x] `PORTING.md` updated: `folding3d` as Ori Studio native (not a divergence);
      the odometer unit ordering; the cross-plane cut's plane keying; the
      additive `validate_initial_hierarchy`; cells as the drawable unit; the
      separate 3D snapshot / commands / handle kind. **[corrected — there are no
      `pub(crate)` visibility changes.]** The plan predicted `configure_subfaces`
      and `folded_face_polygons` would need narrowing and they did not; the diff
      against `origin/main` adds only public items to `folding.rs`
- [ ] **Author browser checklist** (the automated pane runs
      `visibilityState=hidden` with zero rAF, so none of this is agent-verifiable):
      `G` on an all-classic selection; `G` on `hinge_90` / `box_90` (census 0
      and 17, both opaque once Phase 9 lands); `G` on `spikes_large` (214 faces,
      the scale case); `G` on `disconnected` and on `annulus_90` (both must
      refuse with a named verdict, and both look clean to `CheckCamv`); each
      verdict arm; the cycling verb's disabled state; refold
      after an angle edit; SVG and PNG export; `.osf` save, reload, and reopen on
      a `main` build; undo/redo across a fold; the simulate fallback on a
      non-closing pattern

**One flake, not reproduced, recorded so a soak happens before merge.** A review
pass saw four `folding3d_boundary` tests fail together twice early in a session —
`an_admitted_fixture_reports_a_verdict_code`, `the_snapshot_census_keeps_its_theorem`,
`a_duplicate_starts_where_the_original_was_and_then_diverges`,
`the_solution_stream_wraps_and_keeps_wrapping` — all consistent with the ordering
solver not answering on that run. It then ran ~400 more times without failing, and
a further 200-run soak here (4 test threads) also found nothing. No mechanism was
identified: the search's `HashMap`/`HashSet` uses are `contains`/`insert` only and
nothing downstream reads an iteration order. Not claimed as fixed, and not claimed
as understood.

### Phase 10 — Enumeration, real cycling, orbit (follow-up)
- [ ] Odometer over per-component enumerators, with the **tested invariant that
      the first press changes the largest component** (not an ordering
      convention — "advance the last digit" advances the smallest)
- [ ] **Pair that invariant with a non-vacuity assertion, or it tests nothing.**
      Measured in Phase 5: four of the five committed 3D fixtures — `hinge_90`,
      `box_90`, `spikes_small`, `spikes_large` — have exactly **one** layer
      order, so a cycling test written against any of them passes whatever the
      enumerator does. Phase 5's first draft cycled `box_90` and survived a
      mutation that made Duplicate restart its stream. `penguin_freeform` (8
      solutions) is the only committed multi-solution fixture; assert up front
      that the fixture under test has more than one, and assert `k > 1`
      components on at least one fixture before claiming the odometer is
      exercised
- [ ] `discovered_fold_cases` stays a discovered-so-far high-water mark, and
      `current_fold_case` is a **separate** counter. Phase 5 found and fixed the
      bug where it was derived from the first: after a wrap the stream is
      showing solution 1, so the next press is solution 2, not solution N+1. It
      takes two laps past the wrap to see, and nothing in the repo — flat or 3D
      — pressed a fold stream that far before
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
| R1a | ~~**Admissible test material does not exist.**~~ | **RETIRED** | Measured (F0). 11 owner-authored multi-face 3D-angled models exist, 8 admitted; `known-good/` is 10 of 10 clean and 8 of 10 admitted; 7 of 36 published third-party are admitted. All external to git, all regenerable or ownable. Phase 2 is rewritten around them |
| R1b | **The *users* do not exist.** No telemetry says whether anyone presses `G` on a non-classic selection. The 11 models above were all authored by one person — that validates the transcription workflow and bounds nothing about its population | High / high, **instrumented** | Phase 1 is built and shipped the events. `fold attempted { mode }` is the one that answers it, and it is decided from the selection before any dialog, so a user who cancels the intercept still counts. Nothing else about the risk has changed: the number does not exist until the data accumulates |
| R2 | ~~**The census is non-zero on essentially every realistic model**, so the merge set ships a figure that is honest and almost always undetermined~~ | **RETIRED (Phase 9)** | The premise held and the consequence went away with it. Spike C measured the census: median 81.5 over 18 admitted models, undetermined fraction 1.00 on 12 of 14 non-zero ones, so nothing would have stayed opaque. That is why Phase 9 is in the merge set — and with it built, **every admitted model that reaches a layer order reaches it with zero undetermined pairs** (17 of 18; the one exception has no layer order at all and says so). The translucent annotation is now a genuine edge case rather than the default. Plan on `census ≥ (creases at ±180)` and **never** on its converse |
| R3 | ~~**The plane-patch arrangement pipeline does not run unchanged**~~ | **CLOSED (Phase 9) — and the repair was grouping, not cutting** | Both halves of the diagnosis reproduce and neither needed the fix the plan expected. `V - E + F = 1` holds for a **connected** subdivision, so the Euler gate closes on a plane whose faces are disconnected or merely touching at a vertex — and arranging per **connected overlap group** rather than per plane opens it. `face_request` never meets an annular cell after that split, because an annulus needs a disconnected component. Nesting detection and two injected cuts per nesting were not needed. Measured: every admitted corpus model decomposes, and the three that do not are refused by the admission gate first |
| R3b | **The Euler gate refuses the whole crease pattern, before any per-patch question** — 18 of 36 published models, 0 of 11 owner-authored | **Confirmed / high, but it is not the verdict anyone meets** | The 18 reproduce. **`Refused(FacesUnresolved)` is reached by nothing**, measured through the shipped gate over all 65 corpus files (Phase 3): §2's order runs `dispatched_camv` first, and every one of those models refuses at a vertex check instead. The most common refusal is `FlatFoldability` (21 of 65), then `VertexClosure` (8) and `InteriorCut` (7). **Rank the Phase 7 copy budget by those**, all three of which name a point on the canvas. The owner-authored zero is still a real signal the third-party stress set hides |
| R4 | ~~Placement handedness disagrees with the admission gate~~ | **RETIRED** | Spike B: agreement with `vertex_link_polygon` at 2.8e-17..5.0e-16 across four fans of degree 3–6, against 1.5e-2..1.9 for each of three fault modes, plus end-to-end agreement on a 484-face ground-truth folded form. Superseded by R20, which is the same concern one layer down |
| R5 | Plane clustering silently merges two genuinely distinct planes (coplanarity under a tolerance is not transitive), poisoning every downstream claim | Medium / high | Topological classification first; verification pass over every intra-cluster pair; refuse rather than merge; **topology-vs-distance disagreement is a first-class alarm** |
| R6 | ~~Cross-plane coupling is common, making "detect and refuse" a permanent refusal on ordinary models~~ | **CLOSED (Phases 4 and 9) — it is common, and it is carried** | Phase 4 measured it: every admitted corpus model above six faces has a cross-plane coupled folded line, 15 of 15, and so do four of the five committed 3D fixtures. So there is no refusal. Phase 9 carries the constraint in the shipped vocabulary — `check_quad` with a plane-keyed cut, the sign encoded in the roles, and a merged subface so the search enumerates it rather than reaching it only at the final estimation. 64 couplings on `spikes_large`, 1,568 on `origamisimulator`, all solved |
| R7 | ~~An out-of-range face id makes the ordering search report success with an empty ordering, no error~~ | **CLOSED (Phase 9)** | Reproduced first — `an_out_of_range_face_id_makes_the_shipped_search_lie` shows the search returning `found = true` with the face absent from every stack — then guarded, with `the_face_id_range_check_fires` breaking the guard. Every component is renumbered into a dense local range, which the `set_guide_map` allocation needed anyway |
| R8 | The kernel change does not reach the app because the committed `.wasm` was not rebuilt — and **no workflow verifies it** | High / high | Explicit checklist item with the correct command, `git add -f`, and a `strings` verification. It has bitten before (R4 in non-180) |
| R9 | New oracle "green" is vacuous — 41 Oriedita parity tests skip silently without `ORIEDITA_GEOMETRY_ORACLE`, which no workflow sets | High / high | **Answered for the 3D corpus in Phase 2, in four parts, because printing a skip notice is what the Oriedita harness already does.** The load-bearing assertions are on committed fixtures and need no environment; every skip prints a greppable `SKIPPED:` block naming the test, the variable and what was not checked; `corpus_coverage_is_stated` always runs and prints the whole roster of what did not; and `ORISTUDIO_NON_FLAT_CORPUS_REQUIRED=1` turns every skip into a failure, whose output libtest never captures. A variable pointing at a missing or empty directory fails rather than skipping. For the Oriedita oracles themselves the mitigation is unchanged: both env vars named in the validation checklist, with reported counts |
| R10 | The verdict surface reads as "3D isn't implemented" rather than "this pattern cannot be folded that way" | Medium / high | Verdict copy is a merge blocker with a **new** exhaustiveness gate — the flat one covers only `FOLDABILITY_RULES` and cannot be inherited. `LocalCrossing`/`TransversalCrossing`/`Refused` keep the figure and are not error toasts; see Open decisions on the simulator hatch |
| R11 | An undetermined stack is rendered as if it were determined | High / high, **and the undetermined case is measured to be rare** | The census is the gate, it is a merge blocker, and Phase 9 now resolves rather than reports. Measured: every admitted model that reaches an ordering reaches it with **zero** undetermined pairs, so the translucent annotation is a genuine edge case rather than the default. Faces Phase 9 cannot decide still render distinctly. `bsp.ts:253`/`:277` are pinned by regression test |
| R12 | Row (b) regresses: an all-classic selection inside a mixed document takes the 3D path | Medium / high | Per-segment `is_classic_crease` on scoped ids only; `has_non_classic_creases` is explicitly forbidden as the router; six-row truth table pinned in `store.test.ts` |
| R13 | A figure folded flat, then given angles, then refolded reaches the flat kernel | High / high | All three doors dispatch identically, in one change |
| R14 | Orbit misses its frame budget | Deferred | Not in the merge set. `buildBsp` is 93.5% of the frame and eye-independent at `edgeInk = 0`, so it hoists; piece-count guard regardless |
| R15 | `.osf` schema bump breaks every file the 3D build writes | Medium / high | **No bump.** Measured: the raise is not conditional. Gate on the figure via a loud `sourceKind` |
| R16 | A 3D wasm handle retains far more than the flat one, and `MAX_CP_HISTORY` is 100 | Medium / high | Re-measure before assuming refcounting is free; `inline-simulations-in-undo.md` measured 243 KB–2.9 MB and reversed on it |
| R17 | Merge pain on hot files (`creasePatternSlice.ts`, `folding.rs`, `CreasePatternPanel.tsx`) with parallel agents active | Medium / medium | New behaviour goes in new modules; `creasePatternSlice.ts` gets one branch above `:1628` and no edit below it |
| R18 | The i18n gate fails late, after the feature is otherwise done | Medium / low | i18n is its own checklist block in Phase 7, not a bullet inside the UX work |
| R19 | **A `Black0` border segment interior to the arrangement is a cut, and the kernel excuses every vertex touching it** — `is_interior_vertex` (`checks_spatial.rs:647-653`) returns false, so `CheckCamv` reports CLEAN on geometry it never checked. Measured on `known-good/byu solar driven.fold` (0 flat, 0 closure, worst interior residual 2.6e-12°, loop gap 1.445 rad on a 400 span, 6 of 96 dual cycles blind) and on a drawn annulus (0 spatial vertices examined at all). `interior_borders > 0` iff `blind_cycles > 0` on 63 of 63 files | **Confirmed / high** | Escalated from medium: it ships **today**, on the flat path, so it belongs in Phase 1. Admission gains "no border segment with paper on both sides"; the loop gap becomes a gate; `Fold3dRefusal` gains `InteriorCut` and `LoopNotClosed`. Additive — never an edit to `is_interior_vertex`, which `solve_fold_angles.rs` and `solve_spatial.rs` share |
| R20 | ~~**`FoldGraph::faces` are wound clockwise — the exact mirror of the FOLD convention the placement was validated against.**~~ | **CLOSED (Phase 3)** | Confirmed at the source and reversed once, in `place_with`. `foldgraph_rings_are_clockwise_and_the_walk_reverses_them_once` asserts both halves — that the traced rings really do come back clockwise, and that the placed root face's normal is `+z` after the reversal — and every fixture test now runs the walk on `FoldGraph`-derived faces, which is the path Spike B never exercised |
| R21 | ~~**`fold3d_census` becomes Phase 4's oracle with two silent gaps.**~~ | **CLOSED (Phase 2)** | All three closed, and the work found a fourth. `--flatcheck` is joined by a general-angle **dihedral round-trip** (1.3e-13° on `spikes_large`; 70.5° on `rabbit_unclosed`, matching that model's worst closure residual reached independently). A tree dual graph now prints `--` with its non-tree edge count beside it rather than an exact `0.00e0`. `admissible` includes the shipped spherical-simplicity verdict, so `self-intersecting-vertex.fold` is refused. And the plane-spectrum port surfaced a real defect: a **global** normal-sign rule split normals differing by 1e-17 across an axis into opposite signs and invented a 50-unit separation on a 400-unit sheet, so the sign is now resolved against the class being compared to |
| R22 | ~~**The placement disagrees with the shipped flat folder on 2 of 21 tracked fixtures and the reason is unknown.**~~ | **CLOSED (Phase 3) — the comparison was wrong, not the walk** | `estimate_wireframe_from_segments` returns `folded_points`, which **averages** each vertex over the faces containing it; that average equals a per-face image only where the loop gap is zero. The deviation tracks each document's own gap: 113.8 against 178 on `clean-smoke`, 0.102 against 0.073 on `iguana-split-crease`, 282.8 against 400 on `box_90_unangled` (a third disagreement, found in Phase 3). It also explains the 6-of-8, because a Maekawa or little-big-little violation moves no geometry. The right comparison is per face against `FoldGraph::fold_movement`, and it holds to ≤1e-9 with no precondition — `the_walk_reproduces_the_flat_folder_face_by_face`. `clean-smoke` is excluded for a separate reason worth keeping: it carries six **unassigned** creases, which the flat folder mirrors across and the 3D walk refuses |

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
- **Offer it only for `Refused(VertexIndeterminate)` and the crossing arms, not
  for the refusals we chose** (`CrossPlaneCoupling`, `StackTooDeep`), on the
  grounds that the first two are facts about the pattern and the second two are
  facts about us.

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

**Still open.** This was assigned to Phase 0 and none of Spikes A, B or C touched
it. Note also that the `segments`-dropped premise is unchanged but the citation
moved: `skip_serializing_if = "Vec::is_empty"` is at `lib.rs:253`.

### Resolved while planning

- **Placement rotation is `ρ`, not `π − ρ`**, settled by `crease_fold_angle` plus
  `crease_quat`. The research doc's §1a uses ρ as the dihedral angle; the two are
  supplementary and the kernel's is the one that matters.
- **The whole placement convention** — right-compose, paper-coordinate axis,
  child-winding direction, signed FOLD angle. Settled by Spike B against
  `vertex_link_polygon`; see §1 and "Spike B answer". Not open.
- **The loop gap gates**, and `Fold3dRefusal` carries `LoopNotClosed` and
  `InteriorCut`. Settled by Spike A; the old "reported, not gating" argument
  rested on a premise Spike A refuted.
- **Phase 9 is in the merge set.** Settled by Spike C. The consequence for R3 —
  Spike A's plane-patch half becoming merge-blocking — follows from it and is not
  a separate decision.
- **Spherical simplicity is not this plan's work.** It shipped; the 3D path
  consumes `LinkVerdict` rather than re-deriving it.
- **Projection lives in TypeScript.** The kernel render snapshot exists to be
  diffed against the Oriedita render oracle (`folding.rs:2088` says so); 3D has no
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
