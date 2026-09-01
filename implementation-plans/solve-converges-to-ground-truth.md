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

## The corpus: hand-authored patterns, not generated ones

**No *generated* corpus has a usable ground truth.** Surveying every GT-carrying
pack (`--example gt_camv_survey`): **0 of 194 samples are CAMV-clean**, for three
separate reasons, none fixable by picking a different pack.

- `clean-1024-s15` and its two variants (15 each): ground truth misses Kawasaki
  by **2.5e-4 to 2.0e-3°** against a 1e-6° bar. Not storage precision —
  coordinates carry 17 significant decimals, and the **source** FOLD in the
  dataset is equally imprecise (2.8e-3°). It is TreeMaker's own optimizer
  tolerance, which `PORTING.md` documents and `fold_exactize` exists to repair.
  Because 1e-3° is enough to flip sector ordering, 9 of those 15 also carry BLB
  violations of their own.
- `box-pleat-native-v1` (179 each, two packs): every non-boundary edge is
  assigned `U`. BLB is a statement about assignment *differences*, so it is
  undefined there whatever the geometry does.
- `native-cp-*` (563): no `gt.fold` at all.

**Hand-authored patterns are exact by construction, and Zach already has them.**
`scripts/cp-detect/extract-exact-cp-corpus.py` splits a `.ori`/`.osf` document
into its connected components — traditional bases are tiled in one canvas, and
diagram files hold one pattern per step. From three files:

| source | components | CAMV-clean GT |
| --- | --- | --- |
| `traditional_bases.ori` | 8 | **8** |
| `lamprey-draft-v0.6.ori` | 23 | (mostly clean; all refuse below) |
| `iguana_50.osf` | 63 | — |
| **total** | **88** | **69 clean, 15 BLB-only, 4 both** |

**69 of 88 with an exactly-foldable ground truth**, against 0 of 194 generated.
This is the Phase 0 corpus, and it already exists.

### What it shows

`--example solve_gt_scorecard` takes each clean-GT sample, solves it as-is (a
no-op — all 41 solvable samples come back `Solved 0a 0b`), then perturbs every
movable vertex by a seeded Gaussian and solves again. Sweeping the noise:

| noise (of paper edge) | solved + clean | **solved but BLB** | did not converge |
| --- | --- | --- | --- |
| 0.0005 | 39 | **1** | 1 |
| 0.001 | 40 | **1** | 0 |
| 0.002 | 39 | **1** | 1 |
| 0.003 | 33 | **1** | 7 |
| 0.004 | 19 | **1** | 21 |

The same sample every time — `iguana50-41`, 35 vertices — and **always exactly 2
BLB violations, even at 0.0005 noise where it converges to 0.26 px of ground
truth**. The count does not scale with the noise, which rules out "the solve did
not converge far enough".

### Why: exact patterns are full of exact ties

The mechanism, read straight off that sample's ground truth: **7 of its 15
interior vertices have their smallest sector *exactly* tied.**

```
v20  deg 4   116.6(V/V)  63.4(V/M)  63.4(M/V)  116.6(V/V)
v11  deg 8   45.0 45.0 45.0 45.0  71.6(V/M) 18.4(M/V) 18.4(V/M) 71.6(M/V)
```

BigLittleBig needs a *strictly* smaller sector, so **it is vacuous at a tie** —
and the moment a tie breaks, a legal vertex becomes a violation. This is not
incidental to one pattern: flat-foldable crease patterns are built from repeated
exact angles, so ties are the normal case, and a solver that treats angles as
free continuous variables under a single Kawasaki equation will generically break
them.

That reframes the fix. A BLB barrier treats the vertices where a broken tie
happens to matter; **preserving the coincidences the pattern actually has** treats
the cause — which is also why holding pass-through creases collinear is so
powerful, since that *is* preserving a tie (opposite sectors equal).

### Limits of this corpus, stated plainly

- **28 of the 69 refuse** with "paper is not a square" —
  `exact_solve_input_from_fold` is square-only, and diagram steps are often
  partial shapes. That costs every large `lamprey` pattern, which would be the
  best stress cases.
- **Only 1 of 41 reproduces the failure.** These patterns are small and their
  sectors are far apart; the dense `.osf` states (28 and 32 violations) remain the
  volume reproduction. Use both.

## Approach

### Phase 0 — done, in outline

The corpus and the two harnesses exist: `extract-exact-cp-corpus.py`,
`gt_camv_survey`, `solve_gt_scorecard`. Baseline is the table above. What is left
is to widen it:

- **Lift the square-paper restriction** so the 28 refusals become samples. The
  `ENABLE_POLYGON_EXACTIZE` path already exists and is documented as needing a
  boundary-precision fix; this is the reason to do it.
- Add more hand-authored sources as Zach has them — the extractor takes any
  `.ori` or `.osf`.
- Optionally, detected geometry via `decode_dense_manifest` against the caches in
  the **shared main checkout** (no ONNX needed natively), for realism alongside
  the synthetic perturbation. Those caches are v3 while
  `scripts/cp-detect/current-model.json` names v5; say which in any report.

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

- [x] **Phase 0** — exact corpus from hand-authored sources: 69 clean-GT patterns
      from three files, vs 0 of 194 generated.
- [x] **Phase 0** — `gt_camv_survey` and `solve_gt_scorecard`; baseline above.
- [ ] **Phase 0** — lift the square-paper restriction so the 28 refusals (all the
      large `lamprey` patterns) become usable stress cases.
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

- **Tie preservation may be the whole story.** If the solve simply kept the exact
  angular coincidences its input already has, both the BLB violations and much of
  the drift from GT would go with them. Phase 1 (shared carriers) is one instance
  of that idea; whether a general "preserve near-exact ties" prior is better than
  a BLB barrier is worth settling with the scorecard before building Phase 2.
- **Only one sample in the exact corpus reproduces the failure.** The dense
  `.osf` states carry it at volume (28 and 32 violations). Neither corpus alone
  is sufficient — the exact one proves blame, the dense one gives statistics.
- The `.osf` states stay useful as *regression* material even though several are
  genuinely damaged, because the BLB counts above are reproducible.
  `worked_but_has_errors` is 0/0 before and after and is the anchor nothing may
  disturb.
- Two `.osf` files cannot reach zero angle violations (`mid-solve_2`,
  `mid_solve_3` end `Ambiguous` on topology). That is a repair problem, not a
  solver problem; score them conditionally.
