# Simulator: Collinear Split Creases

## Goal

A crease drawn as two collinear segments must simulate as one crease. Today it
silently becomes no crease at all, and the diagonal that replaces it is pinned
flat — so the fold is not merely incomplete, it is wrong.

`test_files/simulation/inline_simulate_issue.osf` is the reported case: a square
with four creases to the centre, where the crease to the top-right corner is two
collinear mountains (`1-5`, `5-4`, with v1=(200,200), v5=(150,150), v4=(0,0))
and the two adjacent faces are quads whose rings contain that T-vertex —
`[0,1,5,4]` and `[1,2,4,5]`. That is legitimate kernel output: Oriedita keeps the
two strokes as separate line segments, and the face finder correctly walks
through the vertex between them.

What `prepareFoldModel` does with it:

1. `triangulateQuad` picks the shorter diagonal — |1-4|² = 80 000 < |0-5|²
   = 125 000 — inventing edge `1-4` as **`F`, fold angle 0**, and emitting
   triangles `(0,1,4)` + `(1,5,4)`. 1, 5 and 4 are collinear, so `(1,5,4)` has
   zero area. The other quad produces the mirror sliver.
2. `removeDegenerateGeometry` drops both slivers (*"dropped 2 degenerate
   triangle(s)"*) — correctly, in isolation: a zero-area triangle NaNs the
   solver's face normals.
3. `1-5` and `4-5` survive as `M`/−180° with `edges_faces: []`. `buildCreaseParams`
   requires exactly two incident faces, so neither gets a crease: they never
   fold, and because the paper render draws edges per triangle (`drawTriangleEdges`)
   a face-less edge is never drawn either. That is the crease the user cannot see.
4. The invented `1-4` **does** get a crease param, target angle 0 — actively held
   flat.

At the centre vertex that leaves M(`0-4`), M(`3-4`), V(`2-4`), F(`1-4`): 2M/1V,
Maekawa violated, not flat-foldable, and the solver settles into a deformed
shape. The saved file is its own receipt — `artifacts.simulation_model.fold`
carries edge 9 = `[1,4]` `"F"`, edges 5 and 6 with `"edges_faces": []`, and four
triangles that omit vertex 5.

Not inline-specific: the Simulate panel and inline simulation both consume
`artifacts.simulation_model.fold`, so full-sheet simulate fails identically.

## Approach

Upstream already solves this with `removeRedundantVertices`
(`third_party/origami-simulator/js/pattern.js:865`, with `mergeEdge` at `:918`),
called at `:551` before faces and triangulation. Port it faithfully.

**Parity is the rule here, and it decides the open questions.** Upstream's
tolerance (`|dot + 1| < 0.01`), its refusal to merge halves with different
assignments, its fold-angle averaging, and its chain-collapse behaviour are all
adopted as-is rather than tuned. Where this plan adds anything, it is only for a
state upstream cannot reach — never a different answer for input upstream
handles. Each such spot is called out below.

**One deliberate divergence, settled by testing rather than argument.** Upstream
merges any matching collinear pair, borders included. That collapses crease-free
border subdivisions, and `delaunayFlipRing` needs exactly those: it can only
choose diagonals among vertices that already exist, so a face's ring points are
its only mesh resolution. A 20x1 strip whose long sides carry 21 crease-free
points goes from 40 triangles at 45 degrees to 2 at 2.86 degrees once they merge.

Parity was tried first: `delaunayFlipRing` was deleted (654116b2) so earcut's
output stood as upstream's does. That made real simulations measurably worse in
testing, so it was reverted (8b8fd166) and the merge narrowed instead
(59be0098) to the assignments the solver folds -- M, V, F. A border subdivision
has no crease to lose, so leaving it costs nothing; merging it costs quality the
solver depends on.

Note the repo's fixtures cannot see any of this: across 14 real `.fold` files
(`lamprey-segment`, `kabuto`, `bad_twist`, the five default molecules, the
folding-sequence set, `clean-smoke`) there are **zero** collinear degree-2
vertices of either kind, and `lamprey-segment` has zero faces with more than four
vertices, so it never reaches the n-gon path either. Hand-drawn `.osf` files are
the only coverage this behaviour has.

**1. Port `removeRedundantVertices` into `normalizeFold`, ahead of
`triangulateFold`** ([prepare.ts](../packages/origami-simulator/src/prepare.ts)).
That is the closest available position to upstream's: upstream runs it before
faces exist at all, which we cannot do because faces arrive from the kernel.

Faithful behaviour, all of it upstream's:

- **Tolerance:** `epsilon` is a parameter, called with `0.01` like both upstream
  call sites. The test is upstream's — the dot product of the two unit
  neighbour directions within `epsilon` of −1. Already scale-invariant, since
  upstream normalises by both magnitudes.
- **Degree-2 only**, and only when both edges carry the **same assignment**;
  upstream refuses the merge otherwise and so do we, which leaves a collinear
  `M`/`V` pair unmerged exactly as upstream leaves it.
- **Merged fold angle** is the mean of the non-zero angles of the two halves,
  else `null`, and mismatched angles warn without blocking — upstream's
  `"incompatible angles"` path.
- **Sequential, mutating as it goes.** Upstream walks vertices in index order
  and updates `vertices_vertices` inside `mergeEdge`, so a chain of collinear
  degree-2 vertices collapses progressively into one edge. Keep a live
  neighbour map and do the same, then compact indices once at the end. A batch
  implementation that resolves against the original neighbour set would *not*
  reproduce this, and chain collapse is the correct answer for a straight chain.
- **Diagnostics:** report the merged count through `diagnostics.warnings`,
  which is our channel for upstream's `console.warn`.

Two additions, both for states upstream never reaches, neither changing the
answer for input upstream handles:

- **Drop faces that fall below three vertices** after the vertex is spliced out
  of their ring, and count them. Upstream removes redundant vertices *before*
  faces are computed, so a 2-ring cannot arise there; our faces are already
  built, and a zero-area source triangle through the T-vertex would produce one.
  `validateFold` runs before normalisation, so nothing else catches it, and
  `facePairs` on a 2-ring produces nonsense.
- **Skip the merge when an edge between the two neighbours already exists**, so
  the pass cannot introduce a duplicate edge (which would itself be a face-less
  edge — the exact bug class being fixed). Reachable only by re-preparing an
  already-triangulated mesh; defensive, one condition, no effect on clean input.

Upstream's neighbouring `removeStrayVertices` needs no port: compacting after
the merge already drops the vertex, and stray vertices are not implicated here.

**2. Regression coverage at both levels.** A unit test in
`packages/origami-simulator/tests/prepare.test.ts` built from the reported fold
(inline, not read from the external `.osf`), asserting: no degenerate-geometry
warning, a single `1-4` edge assigned `M` at −180° with two incident faces, four
crease params, and no `M`/`V` edge left with fewer than two faces. Then a test at
`foldArtifactsFromFold` in `apps/web`, which is the path the app actually takes —
it runs `prepareFoldModel` twice around `orientFacesConsistently` and a fold-angle
sign flip, so it is where an interaction between the merge and that round trip
would show up.

Already measured on the prototype, with upstream's `0.01` and upstream's
same-assignment refusal, so these are the expected numbers rather than a hope:
the diagonal comes back as one `M` edge at −180° with faces `[0,1]`, the crease
count goes 3-real-plus-1-flat → 4 real, the orphan halves are gone, and the
degenerate-triangle warning disappears.

**3. Mirror it in the Rust twin (lower priority).** `prepare_simulation_model` in
[treemaker-fold](../crates/treemaker-fold/src/lib.rs) has the same
shorter-diagonal `triangulate_quad` and no degenerate filter, so on this input it
fails loudly with `BadCreaseTopology` instead of silently — a worse error message
rather than a wrong fold. Worth the same pass for behavioural agreement between
the engines, but it fixes no reported bug and can be dropped from scope without
affecting phases 1–2.

### Known limits of the faithful port

Both are upstream's behaviour, recorded so they are diagnosable later rather than
rediscovered. Neither blocks the reported fix, and `epsilon` is a parameter, so
the first is a knob rather than a rewrite if it ever bites:

- **8.1° is merged.** `|dot + 1| < 0.01` means a kink up to 8.11° off straight
  reads as collinear. Combined with chain collapse, a polyline approximating a
  curved crease — degree-2 vertices, same assignment, small turns — can collapse
  toward a single segment in the simulation mesh (the document is untouched).
  Upstream appears to have hit this: the same call is **commented out** in its
  curved-folding path (`curvedFolding.js:1405`).
- **A collinear `M`/`V` pair still breaks.** Upstream's `mergeEdge` refuses when
  the two halves disagree, leaving the sliver, the dropped triangle, and the
  face-less halves — today's bug, for that input. Phase 5 is the optional fix.

**Dropped from scope: a `triangulateQuad` degenerate-diagonal guard.** It would
cover the collinear `M`/`V` pair, but only by diverging — upstream keeps whatever
the shorter diagonal gives. Parity wins; that input stays as upstream leaves it.

**`removeDegenerateGeometry` stays, for now.** It is also an addition, but it does
not conflict with the merge — it is a post-triangulation safety net, and upstream
avoids needing one through the input-cleanup chain we never ported
(`collapseNearbyVertices` → `removeLoopEdges` → `removeDuplicateEdges`,
pattern.js:538-547). Deleting it without that chain re-opens a shipped bug: a
coincident vertex NaNs the solver and the simulator renders blank. Porting the
chain is the parity-correct way to retire it, and is its own piece of work.

### What the merge reaches

Fold prep is not simulation-only, so the blast radius was traced:

- **The simulator**, and `artifacts.simulation_model` that feeds it.
- **File → Export Folded FOLD** (`projectSlice.ts:2276`) pairs the simulated
  geometry with `simulationFoldOf(artifacts)` as its source document, so its
  output changes: one merged `M` edge, no T-vertex. Correct — the file now
  describes what was simulated — but it is a changed export.
- **Idempotence is load-bearing for that export.** `foldedFoldDocument` keeps
  `edges_assignment` only while the source's vertex count matches the simulated
  mesh, and silently emits *no edges at all* otherwise
  (`foldedExport.ts:62`). The merge is the first prep step that can change
  vertex count, and the whole-sheet simulator re-prepares the already-merged
  `simulation_model.fold`, so a second pass that merged anything further would
  quietly strip every assignment from that export. Assert it, don't assume it.
- **Segmentation** reads the same fold (`resolveCpSegments`, and
  `treemakerWorker.ts:76`), but region identity is unaffected: a collinear merge
  removes neither a border wall nor face connectivity, so components, bounds and
  rim eligibility are unchanged — a boundary ring simply carries one fewer point
  along a straight run.

Deliberately *not* reached: crease-pattern export in every form (FOLD/SVG/PNG/CP,
whole sheet or per region) uses the untriangulated `foldArtifacts.fold`
(`projectSlice.ts:613`, `creaseSegmentExport.ts:49`), and folded STL/OBJ consume
only the simulated positions and triangles.

### Verified during investigation, so *not* in scope

- **No golden-trace re-bless.** All 12 bench fixtures have zero merge candidates
  (measured), so `goldenTraces` and the benches are untouched. A trace that does
  move under this change is a bug in the change.
- **No file migration.** The `.osf` open path recomputes artifacts from the
  stored FOLD projection (`parseImportedCreasePatternFromFold` →
  `foldArtifactsFromFold`, `projectSlice.ts:973`); the persisted `artifacts`
  block is validated but not adopted as the live simulation model. Opening the
  reported file after the fix is enough — no invalidation, no schema bump.
- **No index-coupling fallout.** After the merge, `simulation_model.fold` no
  longer shares vertex indices with `artifacts.fold`. Every consumer checked:
  `renderModel`, `canvas2dFrame` and `simulatorSession` read the prepared
  model's own arrays, and segmentation plus `segmentContainment` are
  coordinate-based (crease midpoints against segment bounds and boundary rings).

## Affected Areas

- `packages/origami-simulator/src/prepare.ts` — the ported pass, and (optional
  phase 5) the `triangulateQuad` diagonal guard
- `packages/origami-simulator/tests/prepare.test.ts` — unit coverage
- `apps/web/src/lib/creasePatternImport.test.ts` — app-path coverage through
  `foldArtifactsFromFold`
- `crates/treemaker-fold/src/lib.rs` — optional Rust mirror (phase 4)
- No tracked wasm bridge is involved: `apps/web/src/generated/**` holds only the
  `oristudio-cp` and `oristudio-bp` bridges, and neither this package nor
  `treemaker-fold` ships through them

## Checklist

- [x] Port `removeRedundantVertices` + `mergeEdge` into `normalizeFold`, ahead of
      triangulation, with `epsilon` a parameter called at upstream's `0.01`
- [x] Keep it sequential over a live neighbour map so collinear chains collapse
      as upstream's does
- [x] Keep upstream's same-assignment refusal, non-zero fold-angle averaging, and
      incompatible-angle warning
- [x] Report merged vertices through `diagnostics.warnings`
- [x] Add the two upstream-unreachable guards: drop sub-3-vertex faces (counted),
      skip a merge whose replacement edge already exists
- [x] Cite the upstream file and line numbers in the port's doc comment, and
      record the 8.1°/chain-collapse limit there
- [x] Unit test from the reported fold: one `M` diagonal, two faces, four creases,
      no orphaned `M`/`V` edge, no degenerate warning
- [x] App-path test through `foldArtifactsFromFold` (double prepare + angle-sign flip)
- [x] Test that a second `prepareFoldModel` pass merges nothing, so the vertex
      count stays put — Export Folded FOLD silently drops every edge otherwise
- [x] Confirm the golden traces and `invariants` suite are unchanged
- [x] Validate: `vitest run` in `packages/origami-simulator`, `npx tsc --noEmit`,
      web vitest, `npm run lint:web`
- [ ] Browser check: open the reported `.osf`, inline-simulate the region, confirm
      four creases render and the model folds to a flat point
- [ ] Browser check: Export Folded FOLD still carries `edges_assignment`
- [x] Phase 4: mirror the pass in `treemaker-fold` with Rust tests
      (`cargo fmt`/`clippy`/`test --workspace`)
- [x] Note that `apps/web` consumes the simulator package's built `dist/`, so a
      source change needs `npm run build --workspace @treemaker/origami-simulator`
      before the app, its tests, or the dev server see it
- [x] Phase 2: remove `delaunayFlipRing` so earcut's output stands as upstream's
      does, and drop the assertions that only described that divergence
- [x] Phase 5: revert that removal after testing showed real simulations got
      worse, and narrow the merge to driven creases so both passes work
- [ ] Open draft PR against `main` and drive it to green CI

## Outcome

Four commits, one per phase, so a regression can be bisected to the decision that
caused it:

1. `fd1f601a` — the port itself, in `packages/origami-simulator`.
2. `654116b2` — `delaunayFlipRing` removed, earcut's output kept as upstream keeps
   it. Separate on purpose: it is the one change here that touches every pattern
   with a face of five or more vertices, and it reverts independently.
3. `c90564e8` — coverage on the app's own path.
4. `833d7781` — the Rust mirror in `treemaker-fold`.

Validated: 140 simulator tests (golden traces included), 1431 web tests, 115 Rust
test binaries, `npx tsc --noEmit` on both, `npm run lint:web`, `cargo fmt --check`,
`cargo clippy --workspace --all-targets -D warnings`. Browser verification is
outstanding and is the author's.

### Phase 5, after testing

Parity-by-deletion did not survive contact with real files. `654116b2` was
reverted in `8b8fd166`, and `59be0098` narrowed the merge to driven creases so
the two passes stop fighting over the same vertices. Final shape: upstream's
algorithm, upstream's `0.01` tolerance, upstream's refusals, plus one stated
divergence (crease-free border subdivisions are left alone) and one addition kept
(`removeDegenerateGeometry`).

If a pattern still simulates worse than before this branch, the next suspect is
the merge's own tolerance: `0.01` admits an 8.11 degree kink and merges cascade
along a chain, so a polyline approximating a curve can collapse. That is one
constant, `REDUNDANT_VERTEX_EPSILON`, in both engines.
