# Precrease: fold the lines that have no exact construction, and say so

## Goal

A line the classifier calls off the lattice is today reported and never folded
(plan decision D8): the closure runs, the driver stops, and the sidebar lists
"Lines with no exact fold — closest: 5 folds, off by 5.6e-4". Markhor leaves 35
of 117 lines that way. The reasoning — an approximation becomes a reference for
every later step — is right about the cost and wrong about the remedy: the
folder still has to make those creases, and a plan that stops short leaves them
to guess. So: every line is folded; the ones with no exact construction are
folded by the closest one ReferenceFinder finds, **after** every exact fold that
can be made has been, and every step that is not exact — its own construction,
or a reference it sights from — says so on the card.

## Approach

**Rules (`drive.rs`).** An off-lattice component no longer stops after the
first closure. It goes round the same loop as any other: close, search for an
exact auxiliary, ask ReferenceFinder for an exact construction — and, when
none of that folds anything, a new action `Approximate`: ask ReferenceFinder for
the *closest* construction of each remaining line and fold the best one. One
line per event, then close again: whatever became exactly constructible
relative to the new crease is folded exactly (it inherits one error rather than
adding its own). `DriverState.approximate` says whether a driver can do this;
approximation events do not count against `max_rf_events` (each folds one
target, so they are bounded by the targets left) but do stop on `out_of_time`.
`StopReason::OffLattice` and `PlanState::off_lattice` go: the class is a
property of the exactness report, not of how far the plan gets.

**Folding an approximation (`closure.rs`).** ReferenceFinder's solution is a
sequence of exact folds from the sheet ending in a line L′ within `err` of the
target L. The driver folds the intermediate lines as `RfAux` exactly as the
exact fallback does; then `Closure::fold_approximation(target, L′, err)`
certifies L′ against the state (its exact witnesses), adds **L** — the
pattern's own line — to the state, and records the fold with `witnesses` of
L′, `approximation: Some(err)` and `folded_as: Some(L′)`. L in the state, not
L′: later lines the pattern derives from L then close exactly relative to it,
which is what a folder does. The ordering pass sights such a fold's witness
against L′ (`folded_as`), since that is the line its construction makes.

**Exactness of every step (`planner.rs`).** `Step.approximation` carries the
fold's own error; `Step.exact` is false for a fold with one, and for any fold
whose presented witness names an approximate line, or a mark that fewer than
two exact creases pass through. `Totals.approximate` counts the inexact steps.
A component with approximations that folds every line is `Complete`; the
exactness badge still says the design is off the lattice.

**Browser (`precreasePlan.ts`).** The `approximate` client (0.005, count 1) is
promoted from the post-loop report to the loop: on `Approximate`, query it for
the remaining lines, take the solution with the smallest error (ties: fewest
folds), fold its steps, then `planner.foldApproximation`. The post-loop
findings pass stays for whatever even that cannot reach. The rules double and
the 224-combination agreement test grow the new flag and steps.

**Cards.** An inexact step carries a badge and a sentence: its own error
("Approximate: the closest construction is off by 0.4 % of the sheet") or its
inheritance ("Sighted from an approximate crease"). The summary strip counts
them.

## Affected Areas

- `crates/oristudio-precrease/src/drive.rs`, `planner.rs`, `closure.rs`,
  `order.rs`, `sequence.rs`; `crates/oristudio-precrease-wasm/src/lib.rs`
- `apps/web/src/cp-workspace/references/precreasePlan.ts`,
  `driveRulesDouble.ts`, `precreaseSequence.ts`, `workers/precreaseWorker.ts`,
  `referencesStepSentences.ts`, `ReferencesSummaryStrip.tsx`, the card badge
- Tests: `drive.rs` unit tests, a closure test for `fold_approximation`, the
  exactness propagation, `precreasePlan.test.ts` with a fake approximate
  client, `precreasePlan.wasm.test.ts`, sentence and summary tests; locales.

## Checklist

- [x] Rules: `Approximate` action, `DriverState.approximate`,
      `LastStep::Approximated`, off-lattice no longer a stop.
- [x] `Closure::fold_approximation`; `FoldedLine.approximation`, `folded_as`.
- [x] Ordering sights an approximate fold against `folded_as`.
- [x] `Step.approximation`, `Step.exact`, `Totals.approximate`; propagation.
- [x] Wasm: `fold_approximation`; TS types, worker, loop, rules double (the
      agreement test now runs 576 combinations).
- [x] Cards: badge, sentences, summary count; locales.
- [x] Measured on markhor: 117 of 117 lines folded, **0 approximate** — the
      off-lattice stop had been blocking the stuck search, and one depth-1
      auxiliary unlocks every "off-lattice" line exactly; 591 ms in the
      browser. `approximate.fold` (a hand-drawn line): 10 folds, 1 approximate
      step, off by 0.11 % of the sheet, the card and the strip say so.
- [x] Along the way: an auxiliary fold is made toward the folder like any
      other, and its card draws it that way rather than in no direction; a
      press that runs from a crease's end to an end that was findable when the
      crease was made joins the making step instead (`Step.pressed_on`) —
      "crease the top third; later, crease the rest" was two steps for one
      fold.
- [x] `measure_ends` plans on the product's budgets: unbounded, the stuck
      search on an off-lattice design can run for an hour.
