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

| source | components | CAMV-clean GT | square paper |
| --- | --- | --- | --- |
| `traditional_bases.ori` | 8 | **8** | all |
| `lamprey-draft-v0.6.ori` | 23 | — | none |
| `iguana_50.osf` | 63 | — | some |
| subtotal | 88 | **69** | 41 of 69 |
| **`22-5/` (7 files)** | **14** | **11** | **all 11** |

**80 patterns with an exactly-foldable ground truth**, against 0 of 194
generated. The `22-5/` set is the better half: every one is square paper, so
nothing refuses, and being 22.5°/45° designs they carry the dense tie structure
the failure needs.

### What it shows

`--example solve_gt_scorecard` takes each clean-GT sample, solves it as-is, then
perturbs every movable vertex by a seeded Gaussian and solves again. **Every
sample is `Solved 0a 0b` as-is** — the solve preserves an exact pattern when
nothing disturbs it. After perturbation, on the `22-5/` set:

| sample | verts | noise 0.001 | noise 0.002 | GT err |
| --- | --- | --- | --- | --- |
| `cat_progress-00` | 43 | **Solved 0a 3b** | **Solved 0a 3b** | 2.2 – 4.5 px |
| `cat_progress_2-01` | 43 | **Solved 0a 4b** | **Solved 0a 5b** | 1.5 – 3.0 px |
| `tiger_wip_3-00` | 110 | **Solved 0a 3b** | **Solved 0a 3b** | 3.3 – 4.1 px |
| the other 8 | — | Solved 0a 0b | Solved 0a 0b | 0.4 – 4.6 px |

Three of eleven come back **`Solved` with a pattern that cannot fold flat** — the
solver reporting success on its own damage. On the larger corpus the same thing
happens to `iguana50-41` at every noise level from 0.0005 to 0.004, always
exactly 2 violations, and at 0.0005 it is **0.26 px from ground truth**. The
count does not scale with the noise, which rules out "it did not converge far
enough".

### Why: designed patterns are quantized, so ties are everywhere

Read straight off the ground truth — how often the *smallest* sector at an
interior vertex is exactly tied with another, and what angles the pattern is
built from:

| pattern | interior vertices | smallest sector tied | distinct sector angles |
| --- | --- | --- | --- |
| `tiger_wip_3-00` | 47 | **47 (100%)** | {45, 90, 135} |
| `cat_progress-00` | 13 | 7 (53%) | {22.5, 45, 67.5, 90, 112.5, 135, 157.5} |
| `cat_progress_2-01` | 13 | 7 (53%) | same 22.5° family |
| `cat_progress-01` | 16 | 6 (37%) | same 22.5° family |
| `iguana50-41` | 15 | 7 (47%) | 45 / 63.4 / 116.6 / 18.4 / 71.6 |

**A designed crease pattern is quantized to an angle family, so tied sectors are
the norm — 37% to 100% of interior vertices.** BigLittleBig needs a *strictly*
smaller sector, so **it is vacuous at a tie** and fires the moment one breaks.

The solver treats angles as free continuous variables under a single Kawasaki
equation per vertex. It has no reason to preserve a tie, so it generically breaks
them — converting legal vertices into violations while reporting success.

That reorders the fix. A BLB barrier treats the vertices where a broken tie
happens to matter; **preserving the coincidences the pattern has** treats the
cause. Holding pass-through creases collinear is one instance of it (opposite
sectors equal). An angle-family prior is the general one — and the table above
makes it far less speculative than it looked: these patterns live on {22.5°} or
{45°} grids, and the family is *measurable from the input* rather than assumed.

### Limits of this corpus, stated plainly

- **28 of the first 69 refuse** with "paper is not a square" —
  `exact_solve_input_from_fold` is square-only, and diagram steps are often
  partial shapes. That costs every large `lamprey` pattern. The `22-5/` set does
  not have this problem: 11 of 11 are square.
- **4 of 52 solvable samples reproduce the failure.** Enough to prove blame and
  to regression-test a fix, not enough for statistics; the dense `.osf` states
  (28 and 32 violations) remain the volume reproduction. Use both.

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

### Phase 1 — hold pass-through creases collinear — **TRIED, REVERTED**

Implemented as the plan specified (union the carrier groups of ray pairs within
5° of opposite, tolerance measured from a sharply bimodal histogram: 1,282 of
2,819 rays under 3°, 1,418 past 12°, 34 in the valley between) and **it made the
solve infeasible**:

| file | spans in multi-span carriers | before | after |
| --- | --- | --- | --- |
| `close_but_not_good_enough` | 128 → **272** | Solved, 0 angle / 28 BLB | **Ambiguous, 167 angle** |
| `pegasus-attempt` | 110 → **234** | Solved, 0 angle / 32 BLB | **Ambiguous, 167 angle** |
| `mid-solve_5` | 52 → **91** | Solved, 0 angle / 7 BLB | **Ambiguous, 67 angle** |

Roughly doubling the spans held on shared lines leaves too few degrees of freedom
to satisfy Kawasaki at all. The BLB counts fell only because the solve stopped
moving anything.

**A carrier group is a hard constraint — shared θ and ρ parameters — and what is
wanted here is a preference.** If this is revisited it should be a *soft*
straightness residual: for each pass-through pair, penalise the turn's deviation
from 180° with its own sigma. That cannot make the system infeasible, and it is
the same "preserve the coincidence" idea the tie finding points at. Deriving the
pairs inside `SolveModel::new` rather than writing them into `ExactSolveInput`
would also make it apply to the detector's attachment, not just rebuilt inputs.

Left undone deliberately: Phase 2 is the more targeted intervention and is
inactive-by-construction, so it goes first now.

### Phase 1 (original text, for reference) — hold pass-through creases collinear

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

### Phase 2 — Big-Little-Big as a solver residual — **TRIED, REVERTED**

Built exactly as specified: `max(0, smallest_differing - smallest_same + margin)`
per fan, one row beside each Kawasaki row, with hand-written analytic Jacobian
entries (four `add_angle_derivative` calls — a hinge on the difference of two
sectors, and each sector is a difference of two ray bearings). The existing
analytic-vs-finite-difference tests passed against it.

**Two things were learned, and the second one kills the approach.**

*The activation test must ignore ties.* The obvious reading — active while
`differing + margin <= same` is false — fires on every tie, and ties are the
normal case in a quantized pattern. That version pushed exact patterns off their
own geometry: `tiger_wip_3-00` went from 0 violations to 6 with no solving
needed. Activating only on a strict violation (`same < differing`) fixes it.

*A weighted least-squares penalty cannot express this.* Sweeping the barrier's
sigma on the exact corpus, against a baseline of **8 clean / 3 violating**:

| barrier sigma | clean | BLB > 0 | angle > 0 |
| --- | --- | --- | --- |
| 0.1° | 6 | 2 | **4** |
| 0.5° | 6 | 3 | **4** |
| 1° | 8 | 3 | 1 |
| 2° | 8 | 3 | 0 |
| 5° | 8 | 3 | 0 |
| 10° | 8 | 3 | 0 |

At weights strong enough to move anything the barrier breaks Kawasaki; at weights
weak enough to preserve Kawasaki it does nothing. Tightening Kawasaki instead, to
buy scale separation, is worse still (2 clean at 0.001°, **0 clean** at 0.0001°,
because that also unbalances it against the movement priors).

**The requirement is lexicographic** — satisfy Kawasaki *exactly*, then use the
remaining freedom for ordering — and the two live five orders of magnitude apart
(1e-6° versus ~0.5°). A single weighted sum cannot rank them.

### Phase 2 — what to try instead (**decided: a pinned lattice round — see Outcome**)

Three candidates, in increasing cost:

1. **Preserve ties rather than repair violations.** The corpus says GT satisfies
   Kawasaki *and* holds its ties, so the two do not conflict — the tie-preserving
   solution *is* ground truth. Add a symmetric equality residual between sectors
   whose input values are already within ~ε, instead of a hinge on the ones that
   have gone wrong. Well-conditioned, acts from the start, and it is the same
   idea as the soft straightness prior from Phase 1. **Risk:** picking ε. With
   detection noise near 0.5° and quantization steps of 22.5°, the separation
   looks comfortable, but false ties would pin sectors that GT has apart.
2. **Correct inside the Kawasaki null space.** After the solve converges, move
   only along directions that leave the alternating sum unchanged — at degree 4
   that is a 3-dimensional space, so there is room. Proper lexicographic
   treatment; needs a null-space basis per vertex and a second solver stage.
3. **Constrained optimisation** — Kawasaki as an equality constraint rather than
   a residual. The largest change, and it would touch every existing tuning.

My recommendation is (1): it is the cheapest, it follows directly from what the
corpus showed, and unlike a hinge it cannot fight Kawasaki because the geometry
it prefers is the geometry Kawasaki already accepts.

### Phase 2 (original text, for reference) — Big-Little-Big as a solver residual

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
rules. If error against GT is still material after Phases 1–2, the remaining gap is that
nothing prefers the *particular* angles the pattern is built from. The tie table
above says that gap is real and structured: infer the angle family from the input
(a histogram of sector angles is strongly peaked — {45, 90, 135} or the 22.5°
set) and prefer it, rather than hardcoding one. **Fork — stop there**, since a
wrongly-inferred family pulls solves away from GT rather than toward it.

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

- [x] **Phase 0** — exact corpus from hand-authored sources: 80 clean-GT patterns
      (69 from three files, 11 from `22-5/`), vs 0 of 194 generated. Four
      reproduce the failure; all 11 of the `22-5/` set are square paper.
- [x] **Phase 0** — `gt_camv_survey` and `solve_gt_scorecard`; baseline above.
- [ ] **Phase 0** — lift the square-paper restriction so the 28 refusals (all the
      large `lamprey` patterns) become usable stress cases.
- [x] **Phase 1** — hard carrier sharing measured; over-constrains. Reverted.
- [x] **Phase 2** — BLB hinge residual built and measured; a least-squares
      penalty cannot rank Kawasaki above ordering. Reverted.
- [x] **Phase 2 replacement** — a *soft* lattice prior measured at every sigma
      and tolerance: GT error improves, BLB does not move (see Outcome). Replaced
      by the **pinned angle-family round**, which does.
- [x] **Phase 3** — the verdict counts Maekawa and Big-Little-Big through the
      editor's own checker (`camv_violation_counts`), `Solved` sits at 1e-6°,
      and the completion sentence names the Big-Little-Big cause. (31c45191,
      b334fffb)
- [x] **Phase 4** — GT error across the corpus, with and without the pin; the
      benchmark gained `solve_foldable` / `solve_recovered_and_foldable`.
- [x] Detector-split junctions: a stub the lattice collapses is adopted as a
      vertex merge (`ExactSolvedGraph::merged_vertices`).
- [ ] Update `PORTING.md` if the acceptance criteria diverge from Oriedita's.
- [x] Re-anchored rounds inside a pinned attempt, the round on its own clock,
      and a lattice pre-check that lets provably inconsistent pins go before
      optimising (see Outcome, "second pass").
- [x] The chip says what the grid snap did when Big-Little-Big remains: no grid,
      snapped, refused (broke N vertices / moved too far), or out of time.
- [x] Hexagonal families: 30° (hex pleating) and 15° join 45° and 22.5°; the
      family is the one most carriers sit on, ties to the coarser. Measured on
      naoki_terao_okapi_hp_failure.osf (a 15° design, 202 of 208 creases on the
      lattice): 21 Big-Little-Big → `Solved`, 0/0, in 1.5 s.
- [ ] Peel by optimizer result: when a pinned attempt is still refused, unpin
      the carriers through the vertices it left over the bar and retry.
- [ ] A merged pair in the solve summary ("2 vertices merged"), once the i18n
      pass is due.

## Outcome — the pinned angle-family round (2026-09-01)

**What was measured before choosing.** The soft prior — a residual
`lattice_offset(θ)/σ` on every carrier within a tolerance of the 22.5°/45°
lattice — was swept over σ ∈ {0.1°, 0.5°, 2°} × tolerance ∈ {0.5°, 1.5°, 3°},
stage-1-and-polish and polish-only, on the 11-sample `22-5/` corpus at 4 px
noise plus the three user files:

| setting | clean | BLB>0 | GT err px | pegasus angle viol. |
| --- | --- | --- | --- | --- |
| off (baseline) | 8 | 3 | 1.78 | 0 |
| σ 0.1°, tol 0.5° | 7 | 4 | 1.45 | 0 |
| σ 0.1°, tol ≥ 1.5° | 7 | 4 | 1.45 | **167** |
| σ 0.5°, tol 0.5° | 7 | 4 | 1.53 | 0 |
| σ 2°, any tol | 8 | 3 | 1.74 | 0 |

GT error improves and Big-Little-Big does not move — because BLB at a near-tie
is decided by the *sign* of the tie-break, not its size. Shrinking the break
from 0.02° to 0.002° re-flips coins. The tie has to be exact within the
checker's 1e-6°, and only a pinned direction gives that.

**What ships.** After the polish rounds, one more: infer the family (≥ 50% of
carriers within 1.5° of the 22.5° lattice; a 45° design fits it too), set every
on-lattice carrier's θ to its exact lattice angle and freeze it (a masked
Jacobian column), re-solve, and keep the result only if the acceptance gate,
the Kawasaki bar and the checker's own angle and BLB counts all hold or improve.
A refused round retries at half the tolerance, twice. With directions pinned,
incidence is linear and vertices land on their lines to machine precision, so
every sector is an exact lattice difference: Kawasaki exact, every designed tie
exact. `movement_report.polish.pinned_family` records each attempt.

A detector-split junction — two vertices a few pixels apart on a pass-through
crease — collapses under the pin, because the pinned lines through both are
concurrent. That is adopted as a **merge**: the pair is one fan for the
optimizer and the analysis (a coincidence residual holds them together, the
stub leaves the fans and its carrier), the answer places both at one exact
point, the FOLD export drops the stub, and the web placement removes the
crease. A first pinned pass alone stops ~4e-6 short of the intersection —
the stub's direction, read from two points a hair apart, couples Kawasaki at
both ends to their separation — hence the second, merged pass.

**Measured after.** `solve_gt_scorecard`, pinned vs off:

| corpus | noise | off | pinned |
| --- | --- | --- | --- |
| `22-5/` (11) | 1 px | 8 clean | **11 clean** |
| `22-5/` (11) | 2 px | 8 clean | **11 clean** |
| `22-5/` (11) | 4 px | 7 clean | 8 clean (one refused on the movement budget; two stage-1 Kawasaki failures unrelated to the pin) |
| `bases` (41 square) | 2 px | 39 clean, 2 broken | **40 clean**, 1 broken (iguana50-23: 96 → 6 angle violations, the pin adopted as an improvement) |

**Second pass (2026-09-02).** A pinned attempt's first solve stops with
Kawasaki a few millionths of a degree over the bar (pegasus at 0.75°: 8e-6°
at 33 vertices, `sparse_ftol`): the vertices it moved onto the pinned lines
charge movement energy, next to which those residuals are invisible to the
stopping test. Re-anchoring the priors to the attempt's own result and solving
again — the polish rounds' trick — takes it to 4e-10°. With that, plus a
lattice pre-check (a fully-pinned vertex whose snapped directions fail Kawasaki
is arithmetic, not optimisation) and the round on its own clock (a round that
runs out of its allowance is refused, never a timed-out solve):

| file | before | after |
| --- | --- | --- |
| pegasus | refused at every tolerance; 32 BLB | adopted at 0.75°, 2 merges; **9 BLB**, 0 angle |
| close_but | refused at every tolerance; 28 BLB | adopted at 1.5°; **8 BLB**, 0 angle |
| `bases` (41 square) at 2 px | 40 clean | **41 clean** |
| `22-5/` (11) at 2 px | 11 clean | 11 clean |

In the product flow (two stages on one 25 s budget) pegasus's stage 2 lands
in 16.3 s of the 24.2 s it has, adopted. The remaining violations on pegasus
and close_but are at creases the detection left more than 0.75°/1.5° off the
lattice; the optimizer-result peel above is the next lever for those.

**Hexagonal families (2026-09-02).** The candidate steps are 45°, 30°, 22.5°
and 15°, and the family is the one most carriers sit within tolerance of —
ties to the coarser, so a 45° design reads as 45° and a hex design that also
uses 15° creases reads as 15°. A 22.5° design fits the 15° lattice only at
its multiples of 45° (its odd multiples are 7.5° from it), so the fraction
test keeps the square and hexagonal families apart: the 22.5° corpora are
unchanged at 11/11 and 41/41. Okapi (Naoki Terao, hex pleating with 15°
creases): no family before, so no snap and 21 violations; now 15°, 113 of
115 carriers pinned, `Solved` with 0 angle and 0 Big-Little-Big in 1.5 s.

Three fully-lattice samples come back at **0.00 px** from ground truth. User
files: `mid-solve_4` and `mostly-successful` go to `Solved` with 0 angle and 0
BLB, each with one ~7 px stub merged; `close_but` (27% of spans > 1.5° off the
lattice) and `pegasus` (18%) are refused at every tolerance and keep their
unpinned answer, unchanged. The pinned round costs 2–200 ms at these sizes;
close_but's three refused attempts cost 6–14 s each, inside the deadline.

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
