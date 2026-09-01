# Solve converges to ground truth

## Goal

The exact solve should land on the crease pattern the paper actually has, and a
pattern it calls `Solved` should have **zero CAMV violations** — angle *and*
Big-Little-Big.

## What the solve does today

It clears the angle condition by breaking the ordering one. Measured over the
ten saved `.osf` states in `test_files/detect-cp/`, rebuilding the input from the
document exactly as the product does
(`--example blb_anatomy`):

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

Dose-response: the more angle error the solve removes, the more BLB it creates,
and the one file with nothing to fix creates nothing.

**Why.** Kawasaki constrains the *alternating sum* of sectors. At degree 4 that
is one equation on four angles, leaving three degrees of freedom, and nothing
else in the objective has an opinion about sector *ordering*. So the optimizer
spends them freely and lands on fans where the smallest sector is bounded by two
same-assignment creases — exactly what `big_little_big_single_step`
(`crates/oristudio-cp/src/checks.rs:1202`) forbids. That routine is the crimp
reduction: take the **globally smallest** sector, crimp it away if its bounding
creases differ, report a violation if they match. The invariant is *"the smallest
sector must be bounded by opposite assignments"* — a property of the ordering.

The corrections are small: deficits on `close_but_not_good_enough` are **median
0.55°, p90 1.44°, max 2.79°**, 22 of 28 under a degree.

**The lever.** `carrier_bin_id` (`fold_exactize.rs:749`) *bins* rather than
clusters — `round(θ / 0.01)` is a hard 0.573° bucket. Two halves of one crease
passing through a vertex land in different carrier groups whenever they straddle
an edge, and then nothing holds them collinear. Measured across all ten files, a
"pair" being two rays at one vertex within 3° of opposite:

**511 of 641 pass-through creases (80%) have their halves in different carrier
bins.** Per file it ranges from 33% to 89%. When two halves *are* held collinear
the opposite sectors are forced equal — and BLB needs a *strictly* smaller
sector, so a fan of ties cannot violate it at all. That is why ground truth (four
90° sectors at a crossing) is BLB-clean and the solve's answer is not.

## Blocker found: there is no ground truth that passes our own checker

The goal says "converge to GT with no foldability errors". Surveying every
GT-carrying pack (`--example gt_camv_survey`):

| pack | samples with `gt.fold` | GT CAMV-clean | why not |
| --- | --- | --- | --- |
| `box-pleat-native-v1-baseline-v3` | 179 | **0** | all 9396 non-boundary edges are assigned `U` — no M/V at all |
| `box-pleat-native-v1-renderings` | 179 | **0** | same |
| `clean-1024-s15` | 15 | **0** | GT's own Kawasaki residual is 2.5e-4 – 2.0e-3° |
| `clean-source-1536-global-1024-s15` | 15 | **0** | same |
| `clean-source-2048-global-1024-s15` | 15 | **0** | same |
| `native-cp-v1` and siblings | 0 | — | no `gt.fold` |

**0 of 194.** Three separate reasons, and none is fixable by picking a different
pack:

1. **The generators are not exact.** `clean-1024-s15`'s ground truth misses
   Kawasaki by 2.5e-4 to 2.0e-3°, against CAMV's 1e-6° bar — 250× to 2000× over.
   This is not storage precision (coordinates carry 17 significant decimals); the
   **source** FOLD in the dataset is equally imprecise (2.8e-3° on
   `treemaker_tree_v1-5gjmj-000148`). It is TreeMaker's own optimizer tolerance,
   which `PORTING.md` already documents and which `fold_exactize` exists to
   repair.
2. **Because GT is noisy at 1e-3°, GT has BLB violations of its own** — 9 of the
   15 `clean-1024-s15` samples. Ordering is exactly what 1e-3° of noise flips.
3. **Box-pleat GT carries no assignments.** BLB is a statement about assignment
   *differences*, so it is undefined on an all-`U` pattern, whatever the geometry
   does.

So "the solve should converge to GT" and "the result should be CAMV-clean" are
**two different targets**, and no existing corpus supplies the second. GT gives
the right combinatorics and the right shape to about a pixel — measured end to
end on `rabbit_ear_fold_program_v1-5wk0b-000080`, detected-and-solved sits
**1.03 px median** from GT — but it cannot certify exactness, because it is
less exact than the bar.

## Approach

### Phase 0 — build a corpus where the goal is checkable

Two sources, in this order:

- **Constructed exact patterns.** Miura, box pleating on a lattice, bird and
  frog bases at exact 45°/22.5°: patterns whose coordinates are closed-form and
  whose flat-foldability is true by construction, with real M/V. Small (10–20)
  but airtight — the only corpus where "GT has no foldability errors" is a fact
  rather than an assertion. Render them through the existing pipeline to get
  detected inputs.
- **Exactized `clean-1024-s15`.** Run `fold_exactize::exactize_fold` over the 15
  GT folds and keep only results that come out **0 angle and 0 BLB**. This
  reuses machinery that already exists for exactly this problem. Caveat to state
  plainly in the report: exactize runs the same solver we are studying, so the
  result is a legitimate *target* but a partly circular *measurement* — it is
  there to scale the corpus, not to prove the solver correct.

Then a scorecard binary over both, emitting: verdict, angle before/after, BLB
before/after, and vertex error against GT. Baseline recorded here.

Detected geometry comes from `decode_dense_manifest` against the caches in the
**shared main checkout** — no ONNX needed natively. Note the caches for the
GT-carrying packs were built with the v3 model while
`scripts/cp-detect/current-model.json` names v5; for a solver study any realistic
detector output serves, but the report must say which.

### Phase 1 — hold pass-through creases collinear

Replace the bin with an explicit relation: at each vertex, pair rays within
tolerance of opposite and union their carrier groups (union-find over spans, in
`build_input`). `CarrierGroupKey::from_span` already prefers
`source_carrier_ids.first()`, so this changes what `build_input` writes there,
not the solver.

- **Tolerance is a measurement.** Plot the near-opposite angle distribution
  across the corpus and choose from the gap between "one crease passing through"
  and "two creases meeting at a shallow angle".
  `merge_collinear_degree_two_spans` already uses 5° for the degree-2 case and is
  the precedent; degree-2 pass-throughs are dissolved there, so this is about
  degree ≥ 4.
- **Risk: over-constraining.** Collinearity plus Kawasaki may be infeasible at
  some vertices, showing up as more `Ambiguous`. If so the tolerance is too loose
  or the constraint wants to be a soft prior rather than a shared parameter.

### Phase 2 — Big-Little-Big as a solver residual

For whatever Phase 1 leaves. Per vertex, `A` = smallest same-bounded sector,
`B` = smallest differently-bounded sector:

```
r_v = max(0, B − A + margin) / σ_blb
```

- **Identically zero when satisfied**, so it cannot perturb a clean vertex — a
  feasibility barrier, not a new objective.
- `margin` must clear `Epsilon::FLAT` (1e-6°) so the swap is decisive rather than
  a knife-edge tie; ~1e-3° is far above the epsilon and far below the deficits.
- **Affordable**: 0.5° on a ~100-unit crease is ~0.002 unit-square against a
  0.010 movement budget.
- The kink is tolerable — this LM uses finite differences and the residual is
  flat-zero across most of the space. Soft-min if it misbehaves.
- **Known limit**: this mirrors the *first* reduction step. Deficits measured
  negative on `mid_solve_3` and `solution_does_not_line_up` mean their violation
  only appears after crimps, so a first-step barrier will not catch those. Build,
  measure, and only simulate deeper reduction if violations survive.

### Phase 3 — the verdict must count BLB

`Solved` is declared on Kawasaki + topology alone, so the completion toast says
*"the pattern now meets the foldability check"* over a canvas showing 28 markers.
Same false claim we already fixed once for angle markers.

Land **after** Phases 1–2 clear the violations, or we ship a build that reports
failure on patterns it used to call solved. **Stop and confirm before landing** —
a product decision, not just a code change.

### Phase 4 — prove convergence

Scorecard over the Phase 0 corpus: vertex error against GT plus CAMV on both
rules. If error against GT is still material after Phases 1–2, the remaining gap
is that nothing prefers the *particular* angles the pattern is built from, which
is the point to consider an angle-quantization prior. **Fork — stop there**, as a
wrong quantization pulls solves away from GT rather than toward it.

## Affected Areas

- `crates/oristudio-cp-compiler/src/fold_exactize.rs` — `carrier_bin_id`,
  `build_input`, the pass-through union (Phase 1); `exactize_fold` reused in
  Phase 0.
- `crates/oristudio-cp-compiler/src/exact_solve.rs` — the BLB residual and its
  sigma in `ExactSolveOptions`; `SolveModel` residual assembly (Phase 2); the
  `solved_*` acceptance criteria (Phase 3).
- `crates/oristudio-cp/src/checks.rs` — read-only reference for the reduction the
  residual must mirror. **Ported behaviour; do not change it.**
- `crates/oristudio-cp-compiler/examples/` — `blb_anatomy`, `gt_camv_survey`
  become the scorecard (Phase 0).
- `apps/web/src/cp-workspace/regions/solveCompletion.ts`,
  `engine/cpExactSolveTypes.ts` — the verdict sentence (Phase 3).
- Rebuild `build:oristudio-cp-detect-wasm` after any compiler change before
  trusting the browser.

## Checklist

- [ ] **Phase 0** — constructed exact patterns (Miura, lattice box pleat, bird /
      frog base) with closed-form coordinates and real M/V; assert each is 0
      angle / 0 BLB before use.
- [ ] **Phase 0** — exactize `clean-1024-s15` GT, keep only 0/0 results, report
      how many of 15 survive.
- [ ] **Phase 0** — scorecard binary over both; baseline table committed here.
- [ ] **Phase 1** — measure the near-opposite angle distribution; pick the
      pass-through tolerance from it.
- [ ] **Phase 1** — union carrier groups across pass-through pairs; unit tests
      for a crossing, a genuine shallow corner, and a degree-2 case.
- [ ] **Phase 1** — scorecard vs baseline; check `Ambiguous` did not increase.
- [ ] **Phase 2** — BLB hinge residual + `blb_sigma`; test it is exactly zero on
      a satisfied fan and drives a violating one to a tie.
- [ ] **Phase 2** — scorecard; extend beyond the first reduction step if needed.
- [ ] **Phase 3** — BLB in the `Solved` criteria and the completion sentence.
      **Stop and confirm with Zach.**
- [ ] **Phase 4** — GT error across the corpus; decide on an angle-quantization
      prior. **Fork — stop.**
- [ ] Update `PORTING.md` if the acceptance criteria diverge from Oriedita's.

## Open questions

- **Phase 0 is now the real risk.** Everything downstream is measured against a
  corpus that does not yet exist. If constructing exact patterns turns out to be
  more work than expected, the fallback is exactized GT alone — with the
  circularity stated in every report that uses it.
- The `.osf` states stay useful as *regression* material even though several are
  genuinely damaged, because the BLB counts above are reproducible.
  `worked_but_has_errors` is 0/0 before and after and is the anchor nothing may
  disturb.
- Two `.osf` files cannot reach zero angle violations (`mid-solve_2`,
  `mid_solve_3` end `Ambiguous` on topology). That is a repair problem, not a
  solver problem; score them conditionally.
