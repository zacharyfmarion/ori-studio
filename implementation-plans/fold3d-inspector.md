# A 3D fold inspector, for understanding the algorithm

## Goal

Make the six stages of `crates/oristudio-cp/src/folding3d/` **visible as they
run**, on a real crease pattern, so someone can learn the algorithm by watching
it rather than by reading it.

The precedent is `apps/cp-detect-architecture-inspector`: a per-stage inspector
for the detection pipeline, a workspace member, one command to run. This is the
same shape for a different pipeline.

### The thing that makes this different from a debug inspector

A debug inspector answers *"what did stage 4 produce for this input?"*. That is
useful and it is not the ask. The ask is *"why does stage 4 exist, and what
breaks without it?"* — which is a different tool, because the answer is never in
the output. It is in the **difference between the real algorithm and the obvious
one**.

Every stage of this pipeline exists because an obvious approach is wrong, and in
every case the counterexample is already in the codebase, written down in the
module doc and pinned by a test:

| Stage | The obvious approach | Why it fails | Where it is already written |
| --- | --- | --- | --- |
| Planes | cluster coplanar faces greedily | coplanarity-under-tolerance is not transitive, so the partition depends on visit order | `planes.rs` — three planes at `0`, `0.6·tol`, `1.2·tol` |
| Cells | a stack is a set of pairwise-overlapping faces | three bars can overlap pairwise with no common point | `cells.rs` — the pinwheel |
| Order | solve each plane's variables separately | two creases can fold onto one 3D line from different planes, coupling them | `order.rs` — the 1×4 strip at (−90, +180, +90), wrong half the time |
| Order | sort the faces into layers | a cyclic order is legal | the square twist, `a > b > c > d > a` |
| Overlap | clip convex polygons | 52 of 26,030 corpus faces are non-convex | `overlap.rs` |

So the tool's core interaction is a **toggle per stage: naive vs actual**, run on
the counterexample that separates them. That is what turns a state dump into an
explanation, and it costs little — the naive version of each is a few lines, and
it is *only* ever used here.

## Shape

**Browser-only. No backend** — and this is the one place it departs from the
detect inspector.

That inspector needs a Rust API server because it needs ONNX models and
multi-gigabyte dense caches. This pipeline needs neither: the input is a crease
pattern, the whole run is milliseconds, and the kernel is already compiled to
wasm for the app. So the inspector loads the same wasm, runs the pipeline in the
page, and has no ports, no server lifecycle, and no way for the two halves to
disagree about which build they are.

```
apps/fold3d-inspector/          # vite app, workspace member
  npm run dev:fold3d-inspector
```

Input is a file drop — `.cp`, `.fold`, or `.osf` — plus a built-in list of the
committed fixtures, so it opens onto something interesting rather than a blank
page. `tests/fixtures/fold-angle-3d/` and the render-model fixtures are already
exactly the teaching set: `box_90` (trivial), `spikes_small` (stacks),
`strip_coupled` (the coupling counterexample), `pinwheel_cyclic` (the cyclic
order), `plant_penguin` from the external corpus (14 layers, the real thing).

## What the kernel has to expose

Today `session.rs` composes the stages and only the final artifacts escape. The
inspector needs the intermediates, so:

```rust
// crates/oristudio-cp/src/folding3d/explain.rs
pub struct Fold3dExplanation {
    pub placement: PlacementTrace,   // per-face transform + the tree edge it came from
    pub admission: AdmissionTrace,   // per-vertex closure residual, per-loop gap
    pub planes: PlanesTrace,         // the union-find partition, and the pairwise relation
    pub cells: CellsTrace,           // per plane: cells, covering sets, stacks
    pub constraints: ConstraintTrace,// per folded line: slots, chords, what each forces
    pub order: OrderTrace,           // components, determinations, search steps, solutions
}
pub fn explain(segments: &[LineSegment], starting_face_id: i32) -> Fold3dExplanation;
```

Two rules for it, and they matter more than the type:

- **It re-runs the shipped stages; it does not reimplement them.** Anything that
  computes a second time is a second thing to keep correct, and a teaching tool
  that teaches a slightly different algorithm than the one that ships is worse
  than no tool. The stages grow a recording hook; they do not grow a twin.
- **It is `#[cfg(feature = "explain")]`**, off in the app's wasm build, on in the
  inspector's. The bridge is already size-sensitive and this carries per-face and
  per-line detail.

## The six views

### 1. Placement — the walk

The dual graph drawn over the crease pattern, with the spanning tree highlighted,
and a **scrubber that places one face at a time** in the order the walk visits
them. The 3D view builds up as you scrub.

- Shows: the tree is the algorithm. Every face's position is its parent's
  position times one rotation.
- Toggle: flip the composition order (`M_parent ∘ R` vs `R ∘ M_parent`) or the
  axis direction, and watch the model come out mirrored or scrambled. This is the
  fastest way to understand why the convention is written down so carefully.

### 2. Admission — the two questions

Per-vertex closure residual as a heat map on the crease pattern, and the loop gap
on each **non-tree** edge drawn as a ghost: the face placed by the tree, and the
same face placed by walking the other way.

- Shows: what "path-independent" means, physically. When they coincide the fold
  is consistent; when they do not, the gap *is* the inconsistency.
- Counterexample: the paper annulus, where per-vertex closure passes **vacuously**
  (there are no interior vertices) while the loop gap is 166°.

### 3. Planes — the partition

Faces coloured by plane, with a slider on the coplanarity tolerance.

- Toggle: **greedy clusterer vs union-find**, on the three-planes-at-`0.6·tol`
  case, with a control for visit order. The greedy answer changes as you reorder;
  the union-find answer does not. That is the whole argument, in one interaction.

### 4. Cells — where the stacks are

One plane at a time, flattened into its own 2D frame: the arrangement drawn,
each cell shaded by stack depth, and hovering a cell listing its covering set.

- Counterexample: the pinwheel. Show the three pairwise overlaps, then show that
  no point is covered by all three — so "pairwise" and "at a point" are different
  sets, and only the second can be ordered.

### 5. Constraints — the cross-section *(the centrepiece)*

This is the view worth building the tool for. Everything else can be read from
the module docs; this one cannot be understood from prose.

Pick a folded line. Draw the plane perpendicular to it as a **circle**:

- each incident face is a **ray** from the origin — a *slot*;
- coplanar faces on the same side share a slot, separated only by layer order;
- a face whose interior the line crosses is a **diameter**;
- each crease is a **chord** joining the two slots of its faces.

Then: **drag a layer order and watch two chords interleave.** The moment they
cross, the paper self-intersects, and the constraint that forbids it lights up —
labelled with which of the shipped kinds it is (quadruple / triple / unary).

The claim in the module doc is that taco-taco, taco-tortilla and the unary
determinations are *one rule at different degrees of freedom*. In this view that
stops being a claim and becomes something you can see by dragging.

### 6. Order — the solve

The constraint graph, with variables as nodes and constraints as edges, coloured
by decided / undecided. Step through: the unary determinations first, then
propagation, then the search over what is left. Components highlighted.

- Shows: why the solving unit is the component and not the plane — on
  `strip_coupled`, watch the two planes' variables land in one component.
- Shows: multiple solutions, and the stream's stability — solution *N* is the
  same solution on every run.
- Counterexample: `pinwheel_cyclic`, where the emitted relations contain a cycle
  and there is no total order to be had. Offer a "sort these into layers" button
  that visibly fails.

## Affected Areas

- `apps/fold3d-inspector/` (new) — vite app, workspace member, `dev:` and
  `build:` scripts in the root `package.json`
- `crates/oristudio-cp/src/folding3d/explain.rs` (new) + recording hooks in the
  six stage modules, all behind `#[cfg(feature = "explain")]`
- `crates/oristudio-cp-wasm/` — an `explain` entry, feature-gated
- A `naive/` module inside the inspector holding the deliberately-wrong variants
  (greedy clustering, pairwise cells, per-plane ordering, topological sort). These
  live in the **inspector**, never in the kernel

## Non-goals

- **Not a debugger for production issues.** If it becomes one, that is a bonus,
  but the design target is comprehension and the two want different affordances.
- **Not shipped in the app.** Feature-gated out of the app's wasm; a separate dev
  surface, like the detect inspector.
- **Not a second implementation.** The stages record; they do not get a twin.
- **Not the flat folder.** Oriedita's path has its own oracle and is not what is
  hard to understand here.
- Not an editor — it reads a crease pattern, it does not author one.

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | The recording hooks change the shipped behaviour | Feature-gated, and a test asserts the pipeline's output is identical with the feature on and off |
| R2 | The naive variants rot, or worse, get mistaken for the real ones | They live in the inspector, are named `naive*`, and each is paired with the fixture that separates it from the real one |
| R3 | The explanation drifts from the code as the algorithm changes | Each stage view cites the module and the counterexample fixture it uses; the fixtures are the committed ones, so a change that invalidates the lesson breaks a test first |
| R4 | It is built, used once, and left to rot | See the open decision — decide up front whether this is a keeper |
| R5 | Trace payload is large on a real model (`plant_penguin`: 103 faces, 86 cells, 14 layers) | Per-stage, on demand, rather than one payload; the run is milliseconds so a stage can be re-run rather than cached |

## Open decision

**Is this a keeper or a learning aid?** It changes how much is justified.

- *Keeper* — it earns tests, CI, and a place in the contributor docs, and it is
  the natural place to debug the next ordering bug. Costs ongoing maintenance.
- *Learning aid* — build it, use it, let it bit-rot honestly, and do not pretend
  otherwise in the README.

**Recommendation: keeper, but only stages 5 and 6.** The cross-section and the
order solve are where every real bug in this feature has been, and they are also
the two that cannot be understood from the docs. Stages 1–4 are genuinely well
served by their module comments; build their views, but do not test them beyond
"it renders".

## Checklist

### Phase 1 — The trace
- [ ] `explain.rs` behind `#[cfg(feature = "explain")]`, recording hooks in the
      six stage modules
- [ ] Test: pipeline output byte-identical with the feature on and off
- [ ] Feature-gated wasm entry; app bundle size unchanged (measure it)

### Phase 2 — The shell
- [ ] `apps/fold3d-inspector`, workspace member, `npm run dev:fold3d-inspector`
- [ ] Fixture picker + file drop for `.cp` / `.fold` / `.osf`
- [ ] Stage navigation; each stage cites its module and its counterexample

### Phase 3 — The centrepiece
- [ ] The cross-section view: slots, chords, draggable layer order
- [ ] Interleaving lights up the constraint that forbids it, labelled by kind
- [ ] Works on `strip_coupled`, where the two chords come from different planes

### Phase 4 — The solve
- [ ] Constraint graph, components, determinations, propagation, search steps
- [ ] Solution stepping, matching the stream contract
- [ ] `pinwheel_cyclic`: the "sort into layers" button that visibly fails

### Phase 5 — The other four
- [ ] Placement scrubber + convention toggle
- [ ] Admission heat map + non-tree ghost + the annulus
- [ ] Planes partition + greedy/union-find toggle + visit-order control
- [ ] Cells per plane + covering sets + the pinwheel

### Validation
- [ ] `cargo test --workspace` with and without `--features explain`
- [ ] `npx tsc --noEmit`, `npx vitest run`, `npx eslint .` for the new app
- [ ] App wasm size unchanged
- [ ] A short README: what each stage is, and what its counterexample teaches
