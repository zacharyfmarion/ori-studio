# CP solve: the lattice's answer for box-pleated designs

## Goal

A box-pleated design is drawn on a square grid, and a solve of one that
has converged sits within a fraction of a pixel of that grid and no closer:
Kawasaki holds along a continuum of nearby geometries (the free slide) and
the priors decide where on it the answer stops. A pattern a fraction of a
pixel off its lattice is not exact — creases that should coincide when
folded do not, to the folder's precision — and the curated turtle solved
0.46 px off its 16-grid. And the designs that need the lattice most cannot
be solved at all: over the harness's crease cap the LM step alone outlasts
any budget, so four giants the grid prior brought to an exact decode
(diamond-sword, earwig, origami-by-xiao-dai, skeleton-shrimp) stayed
`not_accepted`.

Read the lattice from the geometry, snap every vertex to it, and judge the
snapped pattern like any answer. Run it after the polish rounds, on the
converged answer; and for a pattern the LM step cannot fit in any budget,
on the input alone, where a design detected on its grid is solved by the
grid with no optimisation at all.

## Approach

- `crates/oristudio-cp-compiler/src/lattice.rs`: read the coarsest square
  lattice (4 cells up to a 6 px cell) that the pattern's coordinates sit
  within a tolerance (1.5 px) of. Believed only when random coordinates
  would not have landed in its bands (counted over distinct values: a
  design's vertices share lines), and only when its bands cover less than
  half the edge. A finer lattice than the coarsest most of the pattern sits
  on has to earn its extra points on the vertices the coarser one left
  unexplained — a design mostly on 56 cells with a few dozen vertices on
  its half-grid earns 112; one stray vertex that some fine lattice passes
  near does not. Strays (`Outliers::Few`: at most 0.5% of the coordinates
  and never fewer than two, each within 2.5 tolerances and a third of a
  cell) are forgiven only where nothing else can answer, over the crease
  cap; a converged solve, and an input the solve could still be run on,
  must sit on the lattice entirely (`Outliers::None`).
- `exact_solve.rs`: a **lattice round**, judged like the pinned, symmetry
  and pleat rounds — the acceptance gate, no Kawasaki or checker
  regression, no loss of a `Solved` verdict — and exact by everything but
  the carrier residual (topology and checker clean, Kawasaki at the bar):
  on a lattice an answer is exact or it is wrong. Over the vertices that
  carry a span (a candidate the selection left without one sits wherever
  the head fired). The snap sets the vertex parameters; the carriers are refit
  through their spans' snapped endpoints. Before the LM, an adopted round
  is the answer (`termination: lattice_exact`); after the pleat round it
  finishes a converged answer. `ExactSolveOptions::lattice_snap` (Auto/Off)
  and `lattice_snap_tolerance_px`; the movement report's
  `polish.lattice_round` says what it read and why it adopted or refused.
- `solve_exact_on_lattice`: the lattice's answer alone, for patterns over
  the crease cap. `DecodeConfig::exact_solve_lattice_only`,
  `SolveBudget::lattice_only`; the harness's pipeline and solver gate try it
  over the cap, and `decode_bounded` does the same.
- Tools: `fold_check` (oristudio-cp example: the editor's Fold on a FOLD
  file) and `lattice_probe` (compiler example: the lattice's verdict on a
  FOLD answer).

## What the port found (2026-09-10)

- The curated turtle: the solve landed 0.46 px off the 16-grid at its
  worst vertex; with the round it is exact (0.0000 px), still `recovered`,
  and folds in the editor. With the input-stage round it is solved in
  3 ms, the LM never runs.
- The harness's parity golden `right_small_cleaver` moved onto its
  8-lattice (0.7 px at most, same status and verdict); regenerated.
- Detected giants sit within 1.1–1.6 px of their lattice at the worst
  vertex (earwig 1.60 on 48 cells, skeleton-shrimp 1.14 on 64), diamond
  sword has one vertex 3.0 px off its 112-grid and the next at 1.5 — the
  outlier allowance; origami has four vertices 8–11 px off and reads no
  lattice, rightly.
- A candidate graph carries vertices the selection left without a span;
  reading the lattice over them found none on any giant. Only the pattern's
  vertices count.
- Skeleton-shrimp's snapped answer is `ambiguous` at carrier residual
  5.3e-4 (the bar is 5e-4): a carrier group the join built from creases
  not quite on one lattice line, every vertex on its 64-grid. Accepted:
  the carrier residual is the one bar the lattice's exactness does not ask.
- The second full run lost hatsune-miku (converged → accepted wrong, 8
  creases): two of its 402 vertices sit a third of a cell off its 40-grid,
  the detector placed them within 2 px of points of a 120-cell lattice, and
  the input-stage round — then still run under the cap when every vertex
  was within tolerance — read 120 and snapped them there. Two rules from
  it: the input's geometry stands in for the solve only where the solve
  cannot run (over the cap; under it the solve is the evidence that the
  geometry is on its lattice, and the polish-stage round finishes it), and
  the coarse lattice a pattern mostly sits on is recorded whatever the
  outlier policy makes of the rest, so a finer lattice has to earn its
  points on the vertices the coarser one left — four readings do not earn
  120 cells.
- The first full run gave the three conversions back three times over:
  ant, ladybug and swan (Bodo Haag's and Ikuno's hybrids, whose truths sit
  1.0–2.5% off the lattice read, by up to 2.7 px) were snapped at the input
  stage under a 2% outlier allowance to a wrong exact configuration —
  Solved, on the lattice, 16–39 creases from the truth — where the LM had
  converged on the right one. Designs on their grid have 0.1–0.4% of their
  detected coordinates beyond 1.5 px; the hybrids 1.3–1.8%. Hence the
  0.5% allowance, and none at all where the solve can still be run.
- Five near-decoded giants (batmobile, carp, crane, sun-wukong, tank-girl)
  were accepted `ambiguous` on the lattice with 2–27 Maekawa failures:
  wrong topologies the cap had kept unanswered. The exactness requirement
  refuses them; they stay `not_accepted`.

## Affected Areas

- `crates/oristudio-cp-compiler/src/{lattice.rs,exact_solve.rs,lib.rs}`,
  `tests/fixtures/exact_solve/right_small_cleaver.golden.json`,
  `examples/lattice_probe.rs`
- `crates/oristudio-cp-detect/src/{decode.rs,legacy_decode.rs,native_inference.rs,bin/curated_benchmark.rs}`
- `crates/oristudio-cp/examples/fold_check.rs`
- `tests/corpus/cp-detect-curated-baseline.json`, `tests/corpus/README.md`

## Checklist

- [x] `lattice.rs` with its significance rules, unit-tested
- [x] Lattice round in the solve (input stage and after the polish),
      unit-tested on a synthetic 8-grid pleat pattern
- [x] `solve_exact_on_lattice` through the decode config, the harness
      pipeline and gate, and `decode_bounded`
- [x] Turtle exact on its lattice and folding; three of the four capped
      giants recovered on the lattice
- [x] Full curated benchmark (`2026-09-10-lattice-solve`): strict
      `recovered` 337 → 340, gate 441 → 451, nothing the other way;
      scorecard and README updated
- [ ] Later: fit carriers through all their endpoints (skeleton-shrimp's
      5.3e-4), and a partial snap for a pattern with a few far vertices
      (origami)
