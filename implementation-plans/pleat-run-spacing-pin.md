# Pleat-run spacing pin

## Goal

A detected box-pleated or pleated 22.5° design comes back from the exact solve
foldable but with its pleats unevenly spaced: every crease sits where the
detector's pixel noise put it, and nothing in the solve knows that the design
drew them at one pitch. Measured on the frog: 30 vertical creases at 32 px,
off by up to 1.4%. The solve should find the pleats and hold their designed
spacings equal, exactly, without touching anything that is not a pleat.

## Approach

**Criterion** (validated by eye on the real set, see the pleat-runs gallery):
a *pleat run* is three or more creases that are parallel, stacked along their
length, and separated by strips with nothing inside them.

- Walk from a crease to the nearest parallel crease overlapping it along its
  length; the two must share at least 60% of the shorter one's length.
- The strip between them must be at least 4 pitches long; a run of exactly
  three creases must be at least 8 pitches long.
- No crease may lie inside the strip over the shared length. A crease crossing
  the whole strip (in at one neighbour, out at the other) is a transversal and
  allowed — a box-pleated grid is pleats crossed by pleats. A crease starting
  or ending inside the strip breaks the pair.
- Collinear creases are chained by contact, not merged by line.
- Spacing plays no part in membership. Inside a run, consecutive spacings that
  agree within max(4%, 0.75 px) form a *spacing group*; a group of two or more
  is the evidence the pin acts on. Pleats of alternating width therefore get
  two groups, not a lattice assumption.

**Mechanism**: a third judged round in `exact_solve.rs`, after the angle-family
pin and the symmetry round, mirroring `symmetry_round`:

- Detect runs on the current solved state (`SolveModel` carrier groups, chains
  of fold spans, `placed_points`).
- Each spacing group becomes *ties*: residuals `(gap_j − gap_i) / σ` with the
  polish incidence sigma, linear in the carrier `rho` parameters, plus
  `angle_delta(θ_a, θ_b)` ties for members whose directions are not frozen to
  the same lattice angle. Held as residuals rather than frozen values so they
  compose with the symmetry residuals (a symmetric pleat has one pitch and a
  mirrored first offset; both constraints are then satisfiable together).
- Re-anchor, solve, re-anchor while Kawasaki improves, and judge with the same
  gate as the other rounds (`exact_solution_rejection_reasons` +
  `pinned_round_regressions`). Adopt only if nothing regresses; otherwise the
  answer is what it was.
- Report under `movement_report.polish.pleat_runs`: each run's family,
  crease count, spacing groups with spread before/after, the tie count, and the
  round's outcome; `termination` gains `,pleats`.

The mechanism cannot be pinned to the wrong geometry by the foldability gate
alone — a wrong spacing is still foldable — so the criterion is the safety,
which is why it was validated by eye first.

## Affected Areas

- `crates/oristudio-cp-compiler/src/pleat_runs.rs` — detection (new).
- `crates/oristudio-cp-compiler/src/exact_solve.rs` — ties in the model
  (residuals, Jacobian, row count), the round, the report.
- `apps/web/src/engine/cpExactSolveTypes.ts` — report type and accessor.
- `apps/web/src/cp-workspace/regions/solveCompletion.ts` — the sentence.
- `crates/oristudio-cp-detect/examples/detect_folder.rs` — batch summary.
- Locales for the new sentence.

## Checklist

- [x] Criterion validated on the real set (gallery, this session)
- [x] `pleat_runs.rs` detection over a solve model, with unit tests
- [x] Ties as residuals in `SolveModel`; Jacobian and row count
- [x] The judged round and its report
- [x] Unit test: noisy pleats come out equally spaced; a non-pleat is untouched
- [x] Frog through `product_path_solve`: 29 gaps at exactly 32.00 px, spread 1.1% → 5e-9; the
      Markhor file fails preflight (degenerate edges, boundary failures) before any round
- [x] TS report type, accessor, completion sentence, locales
- [x] wasm rebuilt, verified in the browser
- [x] `detect_folder` summary carries the pleat outcome
