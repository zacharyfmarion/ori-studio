# Solve converges to ground truth

## Goal

The exact solve should land on the crease pattern the paper actually has, and a
pattern it calls `Solved` should have **zero CAMV violations** — angle *and*
Big-Little-Big.

Today it clears the angle condition by breaking the ordering one. Measured over
the ten saved `.osf` states in `test_files/detect-cp/` (via
`cargo run --release -p oristudio-cp-compiler --example blb_anatomy`, rebuilding
the input from the document exactly as the product does):

| file | verdict | angle before → after | BLB before → after |
| --- | --- | --- | --- |
| `close_but_not_good_enough` | Solved | 167 → **0** | 0 → **28** |
| `pegasus-attempt` | Solved | 167 → **0** | 3 → **32** |
| `mid-solve_4_breaks_foldability_condition` | Solved | 48 → 2 | 1 → **9** |
| `mid-solve` | Ambiguous | 46 → 2 | 4 → **10** |
| `mid-solve_5` | Solved | 14 → **0** | 5 → **7** |
| `solution_does_not_line_up` | Solved | 2 → **0** | 0 → **1** |
| `mid_solve_3` | Ambiguous | 68 → 37 | 2 → 2 |
| `mostly-successful` | Solved | 0 → 0 | 3 → 3 |
| `mid-solve_2` | Ambiguous | 70 → 67 | 1 → 0 |
| `worked_but_has_errors` | Solved | 0 → 0 | 0 → 0 |

It is dose-response: the more angle error the solve removes, the more BLB it
creates, and the one file with nothing to fix creates nothing. This is not a
detector problem and not an assignment problem — the solve is doing it.

### Why it happens

Kawasaki constrains the **alternating sum** of the sectors at a vertex. At
degree 4 that is one equation on four angles, leaving three degrees of freedom.
The rest of the objective — movement priors, carrier angle/rho priors, carrier
incidence — has no opinion about sector *ordering*, so the optimizer is free to
spend those degrees of freedom on a fan where the smallest sector is bounded by
two same-assignment creases.

That is precisely what CAMV forbids. `big_little_big_single_step`
(`crates/oristudio-cp/src/checks.rs:1202`) is the crimp reduction: take the
**globally smallest** sector; if its two bounding creases differ, crimp it away
and recurse; if they match, report a violation. So the invariant is *"the
smallest sector must be bounded by opposite assignments"* — a property of the
ordering, not of any single angle.

The corrections needed are small. On `close_but_not_good_enough`, the deficit
(how far the offending sector is from no longer being the smallest) is **median
0.55°, p90 1.44°, max 2.79°** — 22 of 28 under a degree.

### The lever: pass-through creases are not held straight

`carrier_bin_id` (`fold_exactize.rs:749`) **bins** rather than clusters:
`round(θ / 0.01)` is a hard 0.573° bucket, and `round(ρ / 0.0025)` likewise. Two
halves of one physical crease passing through a vertex therefore land in
different carrier groups whenever they straddle a bucket edge — and then nothing
constrains them to stay collinear, so each half rotates independently and the
sectors nest.

Measured across all ten files — a "pair" is two rays at one vertex within 3° of
opposite, i.e. one crease passing through:

| file | pass-through pairs | split across bins | |
| --- | --- | --- | --- |
| `close_but_not_good_enough` | 184 | 164 | 89% |
| `pegasus-attempt` | 149 | 133 | 89% |
| `mid-solve_5` | 62 | 52 | 84% |
| `mid_solve_3` | 32 | 27 | 84% |
| `mid-solve_2` | 62 | 50 | 81% |
| `mostly-successful` | 20 | 14 | 70% |
| `mid-solve` | 31 | 20 | 65% |
| `mid-solve_4` | 32 | 20 | 62% |
| `worked_but_has_errors` | 66 | 30 | 45% |
| `solution_does_not_line_up` | 3 | 1 | 33% |
| **total** | **641** | **511** | **80%** |

**80% of pass-through creases are unconstrained.** When two halves *are* held
collinear, the opposite sectors at that vertex are forced equal — and BLB needs a
*strictly* smaller sector, so a fan of ties cannot violate it at all. This is why
the ground truth (four 90° sectors at a crossing) is BLB-clean and the solve's
answer is not.

## Approach

Four phases, ordered so each is measured against the one before. Phase 1 is the
mechanism; Phase 2 is the guarantee; Phase 3 is honesty; Phase 4 is the actual
goal statement.

### Phase 0 — a scorecard, before changing anything

Promote `blb_anatomy` into a committed scorecard that runs over a directory of
`.osf` states **and** eval-pack samples that carry `gt.fold`, emitting one table:
verdict, angle before/after, BLB before/after, and — where ground truth exists —
median/p90 vertex error against it. Record the baseline in this file.

Without this the goal ("converges to GT, no BLB") is not checkable, and every
later phase is guesswork.

### Phase 1 — hold pass-through creases collinear

Replace the bin with an explicit relation: at each vertex, pair rays that are
within tolerance of opposite and union their carrier groups (union-find over
spans, in `build_input`). `CarrierGroupKey::from_span` already prefers
`source_carrier_ids.first()`, so this is a change to what `build_input` writes
there, not to the solver.

- **Tolerance is a measurement, not a guess.** Plot the distribution of
  near-opposite angles across the corpus and choose from the gap between "one
  crease passing through" and "two creases that genuinely meet at a shallow
  angle". `merge_collinear_degree_two_spans` already uses 5° for the degree-2
  case and is the precedent; degree-2 pass-throughs are dissolved there already,
  so this phase is about degree ≥ 4.
- **Risk: over-constraining.** Collinearity plus Kawasaki may be infeasible at
  some vertices, which would show up as more `Ambiguous`. The scorecard catches
  it; if it happens, the tolerance is too loose or the constraint needs to be a
  soft prior rather than a shared parameter.
- Expected: this alone removes a large share of BLB violations, because it turns
  free sectors into tied ones.

### Phase 2 — Big-Little-Big as a solver residual

For whatever Phase 1 leaves. Per vertex, with `A` = smallest same-bounded sector
and `B` = smallest differently-bounded sector:

```
r_v = max(0, B − A + margin) / σ_blb
```

- **Identically zero when satisfied**, so it cannot perturb a vertex that is
  already clean — it is a feasibility barrier, not a new objective.
- `margin` must clear `Epsilon::FLAT` (1e-6°) so the swap is decisive rather than
  a knife-edge tie; ~1e-3° is far above the epsilon and far below the ~0.5°
  deficits.
- **Affordable**: a 0.5° correction on a ~100-unit crease is ~0.002 in
  unit-square terms against a 0.010 movement budget.
- The kink is tolerable — this LM uses finite differences
  (`finite_difference_epsilon: 1e-6`) and the residual is flat-zero across most
  of the space. Soft-min if it misbehaves.
- **Known limit**: this mirrors the *first* reduction step. Deficits measured
  negative on `mid_solve_3` and `solution_does_not_line_up` mean their violation
  only appears after some crimps have happened, so a first-step barrier will not
  catch those. Build it, measure, and only simulate deeper reduction if
  violations survive.

### Phase 3 — the verdict must count BLB

`Solved` is currently declared on Kawasaki + topology alone, so the completion
toast says *"the pattern now meets the foldability check"* over a canvas showing
28 markers. That is the same false claim we already fixed once for angle markers
(`solveCompletion.ts`).

Land this **after** Phases 1–2 actually clear the violations, otherwise we ship a
build that reports failure on patterns it used to call solved. Flag to Zach when
we get there: it is a product decision, not just a code change.

### Phase 4 — prove convergence to ground truth

Point the scorecard at eval-pack samples that carry `gt.fold` (e.g.
`artifacts/cp-detect-correctness/packs/clean-1024-s15`) and measure vertex error
against ground truth, before and after the solve. This is where "converges to
GT" is actually verified rather than inferred from CAMV being quiet.

If error against GT is still material after Phases 1–2, the remaining gap is that
nothing in the objective prefers the *particular* angles the pattern is built
from. That would be the point to consider an angle-quantization prior — and
that is a genuine fork worth stopping on, because a wrong quantization would pull
solves away from GT rather than toward it.

## Affected Areas

- `crates/oristudio-cp-compiler/src/fold_exactize.rs` — `carrier_bin_id` and
  `build_input`; the pass-through union (Phase 1).
- `crates/oristudio-cp-compiler/src/exact_solve.rs` — the BLB residual and its
  sigma in `ExactSolveOptions`; `SolveModel` residual assembly (Phase 2); the
  `solved_*` acceptance criteria (Phase 3).
- `crates/oristudio-cp/src/checks.rs` — read-only reference for the reduction the
  residual has to mirror. **Ported behaviour; do not change it.**
- `crates/oristudio-cp-compiler/examples/` — `blb_anatomy` grows into the
  scorecard (Phase 0).
- `apps/web/src/cp-workspace/regions/solveCompletion.ts` and
  `engine/cpExactSolveTypes.ts` — the verdict sentence (Phase 3).
- Rebuild `build:oristudio-cp-detect-wasm` after any compiler change before
  trusting the browser.

## Checklist

- [ ] **Phase 0** — scorecard binary over `.osf` states + GT-carrying eval-pack
      samples; baseline table committed here.
- [ ] **Phase 1** — measure the near-opposite angle distribution and pick the
      pass-through tolerance from it.
- [ ] **Phase 1** — union carrier groups across pass-through pairs in
      `build_input`; unit tests for a crossing, a genuine shallow corner, and a
      degree-2 case already handled by dissolution.
- [ ] **Phase 1** — scorecard: BLB counts and GT error vs baseline; check
      `Ambiguous` did not increase.
- [ ] **Phase 2** — BLB hinge residual + `blb_sigma`; test that it is exactly
      zero on a satisfied fan and drives a violating one to a tie.
- [ ] **Phase 2** — scorecard; if violations survive, extend to simulate the
      reduction beyond the first step.
- [ ] **Phase 3** — BLB in the `Solved` criteria and in the completion sentence.
      **Stop and confirm with Zach before landing.**
- [ ] **Phase 4** — GT error report across the eval pack; decide whether an
      angle-quantization prior is needed. **Fork — stop here.**
- [ ] Update `PORTING.md` if the acceptance criteria diverge from Oriedita's.

## Open questions

- **Four files start with BLB violations** the solve did not create
  (`mostly-successful` 3, `mid-solve_5` 5, `mid-solve` 4, `pegasus-attempt` 3).
  Those are either genuine defects in the detected pattern or vertices whose
  ground truth really does have a strict-minimum sector. Phases 1–2 may or may
  not clear them; they need a per-case look before the goal can be called met.
- **Two files cannot reach zero angle violations** (`mid-solve_2`, `mid_solve_3`
  end `Ambiguous`) because their topology still blocks. That is a repair
  problem, not a solver problem, and those files should be scored conditionally.
- `worked_but_has_errors` is 0/0 both before and after — the regression anchor.
  Nothing in this plan may disturb it.
