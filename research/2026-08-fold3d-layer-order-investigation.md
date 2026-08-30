# 3D layer ordering: investigation log

**Status: open.** Started 2026-08-28, branch `claude/layer-ordering-debug-plan-b85168`.

This is the running record for the `Fold3dOrderError::NoLayerOrder` false-verdict
investigation. It is a lab notebook, not a plan — append to it, do not tidy it.
The plan-shaped companion is
[`implementation-plans/fold3d-layer-order-debuggability.md`](../implementation-plans/fold3d-layer-order-debuggability.md),
which is now partly superseded; this file is the live record.

## How to use this doc

- **Before proposing anything, read "Refuted".** Several natural-sounding ideas
  are measurably wrong, and two of them look like fixes.
- Every claim here is labelled *measured* or *read-from-code*. Do not promote one
  to the other.
- When you run an experiment, add it to the log with its numbers, whatever they
  showed. Negative results are the point.

---

## The bug in one paragraph

The native 3D solver reports `NoLayerOrder` — documented as "a component admits no
stacking at all", a claim about the user's crease pattern — on patterns that have
a valid layer ordering. The search is not a decision procedure: it prunes, and
when it runs out of unpruned branches it reports that as coverage. The tell is
that the verdict depends on `starting_face_id`, an internal bookkeeping choice
that cannot change whether paper folds.

---

## Current state

| file | folds at N of 21 starting faces | worst | note |
| --- | --- | --- | --- |
| `failed_layer_ordering.fold` | **21 / 21** | 20 ms | was 2/21 at 14.6 s; 626 ms before Round 19 |
| `successful_layer_ordering.fold` | **21 / 21** | 16 ms | control, unchanged throughout |
| `cant_fold.fold` | **21 / 21** | 30 ms | fixed in Round 11; 2,230 ms before Round 19 |
| `full_iguana.fold` | **20 / 20** | 570 ms | was 0/20 at ~80 s — fixed in Round 19 |
| `full_iguana_non_flat_failing.fold` | **21 / 21** | 593 ms | was 0/20 at 71–113 s — fixed in Round 19 |
| `stick on a floor - failure.osf` | **21 / 21** | 254 ms | fixed; see Round 31 |

Gate as of the last run: 975 crate tests, Oriedita folding oracle 29/29, render
oracle 13/13 (with `ORIEDITA_GEOMETRY_ORACLE` actually set — it skips green
without it). Working tree carries ~540 uncommitted lines across five files.

### Fixed

1. **Swapper re-seats odometer digits without resetting their generators.**
   `SubFaceSwapper` reorders `self.order` mid-search; upstream's `onSwapOver` calls
   `clearTempGuide()` and nothing else. The search terminates when position 0's
   generator wraps — sound only if position 0 held one subface, enumerated from
   the start, for the whole search. Measured: 58 order mutations per solve, 40 at
   position 0. Behind `WorkerOverlapEnumerator::resetting_generators_on_swap()`.
2. **`CombinationGenerator` backjumps past the conflict set.**
   `conflicting_depth` ends `if result == 0 { backup } else { result }`, a
   term-for-term port of Java `Constraint.findConflict`. `backup` is a member of
   the conflict set and deeper than `result`, so returning `result` declines to
   advance every depth in `result+1..=backup`, none of which were refuted. Fixed
   to `result.max(backup)` behind `::with_sound_backjump()`.
3. **`ChainPermutationGenerator::reset()` resumes from a stale checkpoint instead
   of restarting.** See Round 11. Behind
   `WorkerOverlapEnumerator::restarting_generators_on_reset()`, wired as the
   fourth `Completeness` attempt.
4. **The lookahead probe cost more than the fold.**
   `Fold3dOrderEnumerator::lookahead` clones each component and runs a *complete
   second search* to decide whether "Another solution" is enabled, then
   `.unwrap_or(false)` discards the result. On an unreachable next solution it ran
   to `FOLD_3D_ITERATION_BUDGET` — **14.4 s of a 14.6 s fold**. Bounded by
   `FOLD_3D_LOOKAHEAD_BUDGET = 10_000`; largest probe that ever *terminated* across
   every sweep was 157 outer iterations. Worst face 14,630 → 617 ms, `has_next`
   byte-identical everywhere.

Both search fixes are faithful ports of Oriedita, so both are deliberate
divergences, gated 3D-only, following the `promoting_on_condition_contradiction`
precedent. Zero lines changed in the shared flat path's behaviour.

### Still broken

Nothing. Every file folds at 21 of 21 starting faces as of Round 23. What remains
is not a failing file but a latent hazard: the condition derivation is still not
equivariant under the starting face (see Round 23's closing note), so a model that
trips a different consequence of that would present exactly as these did.

---

## Log

### Round 1 — is the verdict even true? (2026-08-28)

**Starting-face sweep**, shipped `Fold3dSession::new`, no instrumentation.
`failed_layer_ordering.fold` folded at 2 of 20 starting faces (sf=2 in 231 ms,
sf=3 in 25.5 s); the control folded at 20 of 20. Census pinned at 2,324 variables
throughout — same problem, different entry point. **`NoLayerOrder` is a false
negative.** *Measured, by hand, reproducible in 3 s.*

**Subface-order shuffle**: identical subfaces, hierarchy and conditions with a
permuted subface order found an order in ~3 ms in 29 of 32 trials.

**Relation-drop probe**: over 3,971 random instances in the 3D configuration,
dropping one hierarchy relation — which strictly *enlarges* the feasible set —
flipped `found=true` → `false` in **697 of 15,096 (4.62%) with quadruple
conditions present, and 0 of 18,506 (0.00%) without**. Witnessed incompleteness,
localised to the condition-handling path. **Also kills ddmin/MUS as a technique
here: the predicate is non-monotone.**

### Round 2 — where does the search lose it? (2026-08-28)

Bisection: either the generator never emits the winning permutation, or the table
wrongly rejects it. **Answer: generator side.** The table accepts the witness in
every configuration tested. Ablation matrix on the starting-face sweep (folded/20):

| configuration | folded |
| --- | --- |
| shipped | 2 |
| accelerator disabled | 4 |
| swapper reordering suppressed | 0 |
| **both disabled** | **20** |

Control stayed 20/20 throughout. Led to fixes 1 and 2.

### Round 3 — why is it slow? (2026-08-28)

Not the solve. See fix 3. Also measured: applying the completeness options
unconditionally taxed the happy path 84 → 396 ms, which is why they became an
escalation rather than a mode.

### Round 4 — is `cant_fold`'s verdict false too? (2026-08-29)

**Cross-instance witness replay.** Face ids are identical across starting faces —
only the placement transform changes — so a solution from a folding face maps into
a failing face's instance by the identity.

All 8 solutions from sf=1 and all 8 from sf=5 replayed into sf=0, sf=2 and sf=3:
**128 of 128 are complete solutions of the failing instance.** Zero contradicted
hierarchy relations (including coupling cut relations), zero triple violations,
zero quadruple violations, clean AEA fixpoint, zero undetermined pairs.

Transport verified as the identity first: same plane partition, 0 planes with
inverted `up`, worst up-cosine 1.000000000000, all 326 FullFold and 333 Wall seed
pairs agreeing in direction.

**The shipped search itself accepts the witness** when the instance is seeded with
it — `found=true` at all three attempts on sf=0/2/3 — with a falsification control
of 13 of 15 perturbations rejected.

**Conclusion: the constraint instances are satisfiable, the encoding is correct,
and the enumeration fails to reach a solution that exists.**

Structural difference worth keeping: failing faces produce one 213-face / 3,776-var
component; folding faces split into 209+4 faces / 3,770+6 variables. The failing
faces carry ~70 more quadruple conditions, and `plan()` unions variables through
every quadruple condition, merging the small group into the main one. Same
satisfiability, bigger single component.


### Round 5 — (a) can each subface individually emit the witness? (2026-08-29)

**Answer: yes — every one of them. Emission is not the discriminator; the loss is
in the traversal.** *Measured.*

Method: witness = the solved component hierarchies at a folding starting face
(sf=1, 3,831 decided global face pairs across its 209+4 components; cross-checked
with sf=5, 3,820 pairs). Projected onto each subface of a failing face's
component to get that subface's induced stacking, then each subface's own
`SubFacePermutationSearch` was driven to exhaustion against the component's
initial hierarchy — reset, `set_guide_map`, then
`possible_overlapping_search` / `next` until the stream ended.

`cant_fold` at sf=0: one component, 213 faces, 3,776 variables, 52 subfaces,
`valid_count` 32, 3,403 triple / 1,335 quadruple conditions, 750 relations.
sf=2 and sf=3 are identical row for row.

| | sf=0 (fails) | sf=2 | sf=3 | sf=1 (folds) | sf=5 (folds) |
| --- | --- | --- | --- | --- | --- |
| subfaces | 52 | 52 | 52 | 50 | 48 |
| never emit the witness permutation, **shipped** | 4 | 4 | 4 | **3** | **4** |
| never emit it, **accelerator suppressed** | **0** | **0** | **0** | **0** | **0** |

The failing set is the same four large subfaces at every face — prioritised
positions 0/1/7/8, subface indices 21/2/3/15, 43/38/30/34 faces — and **all four
pass every admissibility test the search applies to the witness permutation**:
0 guide-map violations (`set_guide_map`'s `upper_face_ids` /
`upper_face_enabled` reduction), 0 contradicted hierarchy relations, 0 triple
penetration violations, 0 quadruple penetration violations.

What excludes them is the **excess-permutation accelerator**. All four exhaust
via `next()` returning 0 with `SubFace.cg` live, having engaged it at emission
1 / 34 / 85 / 221 and emitted only 24 / 55 / 195 / 255 permutations in total.
Suppress the handover at `COMBINATION_GENERATOR_THRESHOLD` and the same four
emit the witness permutation at emission **55 / 212 / 719 / 239**. The shipped
stream is a fixed cycle, not a prefix: applying the traversal's own recovery for
a wrapped digit (`reset_permutation_generator`, what
`advance_subface_permutations` does) 64 times gives exactly 65x24 = 1,560 and
65x55 = 3,575 emissions and still no witness.

**But the folding faces fail the same test**, which is what settles (a) vs (b).
At sf=1 the witness *is* the sf=1 solution; subface 21 is inside sf=1's valid
prefix for the whole search (`swap_order` permutes the prefix, it never changes
its membership) and `enter_stacking_into` writes every pair of a prefix subface
into the solution table — so the sf=1 search demonstrably *did* present subface
21's witness permutation, while the isolated drive of that same subface, with the
same guide map and the same initial hierarchy, cannot reach it in 1,560
emissions. The isolated drive is strictly weaker than the traversal, and the only
difference is the table: prefix position 0 is searched against the bare initial
hierarchy, every later position against one already carrying the earlier
subfaces' stacking, and `CombinationGenerator::new` is built from *that* table.
So which permutations a subface can offer is a function of where the odometer has
put it.

Two details worth keeping:

- Subfaces **outside** the valid prefix are not a drop site. All 20 of them at
  sf=0 emit their witness permutation at emission 1 once given the guide map they
  would get on promotion (without one the generator is never `initialize()`d and
  emits nothing at all, which is why the real search never touches them).
- Three 4-face subfaces outside the prefix get **no induced permutation** at all
  — sf=0 position 49 under the sf=1 witness, positions 37/46/49 under the sf=5
  witness — because the witness leaves a pair of them undecided. These are the
  synthetic coupling subfaces. That is a hole in the witness, not a drop site.

Instrumentation: a `SubFacePermutationSearch` drive plus an accelerator-suppress
switch, both default-off and now **removed**; `git diff` carries none of it. A
copy of the harness is at
`<scratchpad>/fold3d_witness_generator.rs` and needs
`folding3d::order::debug_plan_components` (already present as another agent's
`DebugComponentInput` accessor) plus a `debug_solved_components` accessor on
`Fold3dOrderEnumerator` to rebuild.

### Round 6 — the priority prefix, and the terminating step (2026-08-29)

**Answer: the prefix is not the drop site, and the search never gets near its
end.** *Measured.* Run in parallel with Round 5 from a separate harness; where
the two overlap they agree exactly (subface 21: 24 emissions, accelerator
engaged at emission 1, witness never emitted).

Method: `folding3d::order::plan` transcribed outside the crate against
`admit_with` / `census_placement` / `cell_index` / `build_constraints`, so the
component inputs are reachable without touching `src/`. It reproduces the
documented split exactly — sf=0/2/3 give one 213-face / 3,776-variable
component, sf=1/5 give 209+4 faces and 3,770+6 variables — and it reproduces
the incomparability of the attempts: sf=1 folds on `Upstream` (153 ms), sf=5
only on `SwapReset` (1,936 ms).

**Prefix census.** `valid_count` barely moves between failing and folding faces,
and the synthetic coupling subfaces are outside the prefix at *every* face,
folding ones included:

| | sf=0 | sf=2 | sf=3 | sf=1 (folds) | sf=5 (folds) |
| --- | --- | --- | --- | --- | --- |
| subfaces | 52 | 52 | 52 | 50 | 48 |
| `valid_count` | 32 | 32 | 32 | 32 | 34 |
| synthetic (coupling) subfaces | 15 | 15 | 15 | 14 | 12 |
| …of those inside the prefix | **0** | **0** | **0** | **0** | **0** |
| their priority ranks | 37–51 | 37–51 | 37–51 | 36–49 | 36–47 |

**No pair is decided outside the enumerated space.** At sf=0 the 52 subfaces
span 3,830 face pairs: 3,748 are owned by a prefix subface, the other 82 are
fixed by the initial hierarchy (the coupling cuts), and **0 are decided by
nothing**. The greedy makes this structural — a subface leaves the prefix only
once every pair it owns is already covered — so it holds at every face.

**The witness is fully inside the prefix.** Replaying sf=1's solution into
sf=0/2/3: it decides 3,776 of the 3,830 pairs, leaves **0 undecided inside the
prefix**, the 54 it leaves undecided are all outside it (cross-plane cut pairs
that are not ordering variables), and it contradicts the initial hierarchy on
**0**. So there is nothing about the prefix that makes the witness
inexpressible.

**Enlarging the prefix changes nothing.** Two experiments, each run through all
three `Completeness` attempts on sf=0/2/3:

| prefix | sf=0 | sf=2 | sf=3 |
| --- | --- | --- | --- |
| shipped, 32 of 52 | false / false / false | false / false / false | false / false / false |
| upstream `hasCustomConstraint` rule, 47 of 52 | false / false / false | false / false / false | false / false / false |
| every subface valid, 52 of 52 | false / false / false | false / false / false | false / false / false |

**Promotions: 0.** `promote_on_condition_contradiction` never fires — on any
face, at any prefix size, in any attempt. `valid_count` is the same number
before and after every search. The mechanism that exists to pull a
condition-carrying subface into the prefix is inert on this model.

**Where the loop actually stops.** With the default-off `set_search_probe` hook,
sf=0, `Completeness::Upstream`: **15 outer iterations**, 14 of them ending
inconsistent, **0 consistent prefixes ever reached**, 0 final-estimation
rejections, and the **deepest prefix position ever placed is 4 of 32**. Failure
positions: 1x at position 1, 5x at 2, 6x at 3, 2x at 4. Iteration 1 emits no
event — it is the realtime-AEA retry.

The terminating step is exact and is visible in the event log: at iteration 15
the subface at prefix position 1 (subface index 21, the 43-face one) reports
`false`, so `inconsistent_subface_request` returns `subface_id = 1`,
`self.next(subface_id - 1)` is `next(0)`, `advance_subface_permutations` runs
`for index in (0..0).rev()` — nothing — returns 0, and `while changed_subface != 0`
ends. **A `false` at prefix position 1 is an immediate global `found = false`.**
sf=1 is the same shape and stops one iteration earlier for the opposite reason:
13 iterations, deepest position also 4 of 32, and iteration 13 tests consistent.

So the verdict on this model is decided inside ~15 outer iterations over the
first four of thirty-two prefix positions, not by exhausting a large space. Note
the swapper moves subface 21 between positions 0/1/2 throughout (`changed_subface`
= 1 at iterations 7, 8, 10, 11, 12, 13, 14) — under `Upstream` its generator is
not reset when re-seated, which is fix 1's subject, but `SwapReset` also ends
`false` here.

**Condition-class ablation** (sf=0, component 0, all else shipped):

| conditions kept | found |
| --- | --- |
| none | true, 0 ms |
| 3,403 triples only | true, 2 ms |
| 1,335 quadruples only | true, 12 ms |
| 1,320 geometric quadruples only | true, 3 ms |
| 15 coupling quadruples only | true, 153 ms |
| everything except the 15 coupling quadruples | **false**, 373 ms |

No single class is the wall. The pairwise traversal completes a prefix instantly
once conditions are dropped, so the whole difficulty is conditions, and it is
their conjunction rather than any one group.

**One real divergence from upstream, and it is not the fix.**
`SubFacePriority.addSubFace` in
`third_party/oriedita/origami/src/main/java/origami/folding/algorithm/SubFacePriority.java`
opens with `if (s.hasCustomConstraint()) newInfoCount[index]++;`. That unit of
"new information" is never decremented by `processSubFace`, so upstream
guarantees every constraint-carrying subface lands inside `SubFace_valid_number`.
Our `prioritize_subfaces` has no such term, and the 3D path's synthetic coupling
subface is precisely the port's analogue of a custom constraint — which is why
all 15 sit outside the prefix. Restoring the term moves `valid_count` 32 -> 47
and puts all 15 inside; measured above, the verdict does not change. Worth
landing as a parity fix on its own merits, not as the verdict fix.

`subface_priority_matches_oriedita_oracle` would not have caught it: its two
cases are hand-built 3-subface sets, and the oracle CLI is handed only
`faces_total`, subface face lists and relations — no conditions and no custom
constraints — so `hasCustomConstraint()` is false on both sides of the
comparison in every case it runs.

**Refuted here, do not re-run:**

- *The witness is decided partly outside the valid prefix.* No: 0 pairs decided
  by nothing, 0 witness pairs undecided inside the prefix, 0 contradictions with
  the initial hierarchy.
- *`valid_count` discriminates failing from folding faces.* No: 32 / 32 / 32 vs
  32 / 34.
- *Getting the coupling subfaces into the prefix is the fix.* No — measured at
  47 and at 52, all three attempts, all three failing faces.
- *Promotion is doing work on this model.* No: exactly zero promotions
  everywhere.

Instrumentation: none added to `src/`. The harness transcribed `plan` into
`crates/oristudio-cp/examples/fold3d_prefix_probe.rs`, was built in a throwaway
`git worktree` (the shared tree did not compile at the time — a parallel
session's in-flight probe), and **both are now removed**; `git diff` carries none
of it. A copy is at `<scratchpad>/fold3d_prefix_probe.rs.saved`. Rebuilding it is
easier now than it was: `folding3d::order::debug_plan_components` makes the
transcription unnecessary, and the trace needs only the default-off
`set_search_probe` hook.

### Round 6 — the witness-prefix depth, and why position 1 lies (2026-08-29)

Task (b): if every subface *can* emit its witness permutation, why are they never
aligned at once? Subject `cant_fold.fold`, starting face 0, component 0 — 213
faces, 3,776 variables, 52 subfaces, `valid_count` 32, 3,403 triple and 1,335
quadruple conditions. Witness = sf=1 solution 1, transported by the identity; it
totally orders 37 of the 52 subfaces, the 15 it does not being the synthetic
coupling subfaces (60 pairs), which sit outside the prefix. Every event below is
one outer iteration of the shipped `possible_overlapping_search`, read through a
default-off probe.

**The answer to (b) is that the premise fails.** The witness prefix is never
deep, but the reason is not the odometer's alignment — it is that a subface's own
search reports "no stacking" where a *freshly built* search on the same subface
and the **same table** reports one.

| attempt (sf=0) | outer iters | deepest prefix ever *placed* | deepest prefix *matching the witness* | depth histogram |
| --- | --- | --- | --- | --- |
| `Upstream` | 14 | 3 of 32 | **1 of 32** | k=1 once, k=0 13x |
| `SwapReset` | 16 | 3 of 32 | **2 of 32** | k=2 3x, k=1 5x, k=0 8x |
| `SwapResetAndBackjump` | 16 | 3 of 32 | **2 of 32** | k=2 3x, k=1 5x, k=0 8x |

Question 4's answer is in that histogram: the search is not wandering away from
the witness and failing to return, it never gets near it — 3 of 16 iterations at
the maximum, and the maximum is 2.

**No subface is individually unsatisfiable.** Fresh `SubFacePermutationSearch` +
`set_guide_map`, run against the bare initial hierarchy: **0 of 52 return
false**. (This corrects the reading of R4 in the Refuted table for this measure —
"individually unsatisfiable" does not reproduce as a solo subface solve.)

**The named event, questions 2 and 3.** The probe re-ran each rejection with a
freshly constructed search against the very table the live entry was handed, and
counted which of `ChainPermutationGenerator::next`'s two `return 0` paths fired.
The terminating iteration at sf=0 / `Upstream`:

```text
it=15 failed_at=1 valid=32 fresh=Some(true) subface=21
      state=[accel=false count=1801 saved=false restored=false looped=false
             looped_zero=3 (+1) plain_zero=3 (+0) temp_guides=false]
```

So the step is: at iteration 14 `advance_subface_permutations(subface_count = 1)`
calls `reset_permutation_generator()` on subface 21 (it sat at position 2), which
drops its accelerator and restarts its digits — but `ChainPermutationGenerator::reset`
never clears `looped`, `saved` or `save_history`. The swapper then re-seats
subface 21 at **position 0**. At iteration 15 its restarted stream runs 1,801
permutations and then the `looped` guard —
`if swap_history[i] > save_history[2][i] { looped = false; return 0 }` — declares
the cycle complete against a checkpoint captured during a *previous* enumeration
at a different position under different temp guides. `Ok(0)` with no accelerator
becomes `Ok(false)` from `possible_overlapping_search_with_table`, becomes
`Inconsistent { subface_id: 1 }`, becomes `next(0)`, becomes the global
`found = false` the previous round already traced.

The same guard ends the deepest witness prefix, not only the search. At sf=0 /
`SwapReset`, subface 21 is rejected 8 times: **6 via the `looped` guard and 2 via
plain exhaustion**, and 5 of the 6 have `fresh = true`. Iteration 8 — the
`k = 2` event, positions 0 and 1 both presenting the witness — is one of them.
So the answer to question 3 is *`inconsistent_subface_request` rejecting position
k+1*, and the reason that rejection is wrong is the stale loop checkpoint.

**Counterfactual, env-gated, not proposed as the fix.** Clearing
`looped`/`saved`/`restored`/`save_history` inside `reset_permutation_generator`:

| starting face | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 19 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| shipped | false | **true** | false | false | false | **true** | **true** | false | **true** |
| checkpoint cleared | true | true | true | true | true | true | true | true | true |

9 of 9 faces, all three attempts, 170–573 ms each (component 0 only, budget
20,000; the shipped path's own final estimation is the acceptance test).
`successful_layer_ordering.fold` faces 0/1/2 are unchanged at 2–3 ms both ways.

**This is a faithful port, not a Rust bug.** `ChainPermutationGenerator.java`
lines 57–102 have the same `reset()` (no `looped` clear) and the same `looped`
guard, and `SubFace.resetPermutationGenerator` calls `permutationGenerator.reset()`.
Upstream gets away with it because a flat search reaches
`resetPermutationGenerator` far less often and without a swapper re-seating the
reset digit at position 0. Any fix is therefore a deliberate 3D-gated divergence
like the other two, and it needs the Oriedita folding oracle with
`ORIEDITA_GEOMETRY_ORACLE` actually set before it can be trusted. It also is not
free: with the checkpoint cleared, sf=0 does not terminate within 200,000 outer
iterations when it *cannot* find a solution — the guard is load-bearing for
termination, so removing it needs a replacement bound, not just deletion.

Also measured in passing: the realtime AEA is disabled on **outer iteration 1**
of every `cant_fold` run (iteration 1 is always the
`RetryWithoutRealtimeAdditionalEstimation` arm), so the whole search runs with
`realtime_additional_estimation = false`.

Instrumentation: `set_search_probe` / `SearchProbeEvent` in
`folding/permutation.rs`, `debug_plan_components` / `DebugComponentInput` in
`folding3d/order.rs`, the generator's zero-path counters, the env-gated
checkpoint clear, and `examples/fold3d_witness_traversal.rs` were all added
default-off and **all removed again** — including the two hooks Round 5's closing
paragraph points at, which no longer exist. `git diff` carries none of it. A
parallel session's `accel_probe` blocks in `permutation.rs`, `combination.rs` and
`order.rs` are not from this round.

### Round 7 — the accelerator census, and the ablation (2026-08-29)

**Answer: on `cant_fold` the excess-permutation accelerator is the lever, and
suppressing it takes the sweep 4/21 → 21/21. But the loss is *not* in its
"no stacking" verdict, which is correct wherever it fires.** *Measured.* Run in
parallel with Rounds 5 and 6 from a third harness; agrees with Round 5 that the
accelerator is what excludes the witness permutation.

Method: a starting-face sweep against the public `Fold3dSession::new` with
default-off counters inside `SubFacePermutationSearch` /
`CombinationGenerator::process` / `ComponentSolver::new`, plus an env ablation
switch on the `COMBINATION_GENERATOR_THRESHOLD` handover.

**Census, `cant_fold`, per starting face** (summed over all `Completeness`
attempts). The 17 failing faces are identical row for row except sf=17:

| | failing (0/2/3, and 13 more) | sf=17 | sf=1 folds | sf=5 folds | sf=19 folds |
| --- | --- | --- | --- | --- | --- |
| accelerator constructions | 21 | 22 | 4 | 46 | 4 |
| distinct subfaces constructing one | 1 | 2 | 1 | 3 | 2 |
| `process()` calls | 23 | 24 | 6 | 92 | 6 |
| `process()` returned false | 2 | 3 | 0 | 3 | 1 |
| Ok(false) **via the accelerator** | 2 | 3 | 1 | 3 | 1 |
| Ok(false) **via brute-force exhaustion** | 46 | 46 | 13 | 699 | 11 |
| distinct subfaces, false via accelerator | 1 | 2 | 1 | 2 | 1 |
| distinct subfaces, false via brute force | 4 | 4 | 6 | 18 | 7 |
| outer iterations | 49 | 49 | 18 | 704 | 14 |
| attempts run (1/2/3) | 1/1/1 | 1/1/1 | 2/0/0 | 2/1/0 | 1/0/0 |

So the accelerator does construct on **21 of 21** starting faces here — the
earlier file's "never constructed on 12 of 18" does **not** carry over — but it
is a small minority of the Ok(false) traffic (2 of 48 at a failing face).

**The ablation.** `cant_fold` with the handover suppressed entirely:

| | shipped | accelerator suppressed |
| --- | --- | --- |
| folds | **4 / 21** | **21 / 21** |
| worst face | 7,973 ms | 657 ms |
| winning attempt | 1 or 2 | **1 at every face** (plain `Upstream`) |
| outer iterations, sf=0 | 49 over 3 attempts | 17 |

Controls: `successful_layer_ordering` 21/21 → 21/21, `failed_layer_ordering`
21/21 → 21/21 (both slower — the accelerator earns its keep: sf=3 goes 490 ms →
9,340 ms). `full_iguana` is the counter-case — 0/20 either way, and with the
accelerator suppressed one starting face did **not finish in 25 minutes** versus
96 s with it on. So "delete the accelerator" is not a shippable fix.

**Where the loss is not.** Three ablations, all negative:

- *Its Ok(false) verdict is correct.* At each `FALSE_AT_BUILD` a clone of the
  same subface, with the same `HierarchyTable`, temp guides cleared and the
  handover suppressed, was re-enumerated brute force. It agreed every time:
  **0 of 2** at sf=0/2/3, 0 of 3 at sf=17 and sf=5, and **0 of 49** on
  `full_iguana` sf=0/1. No valid stacking is lost at that site.
- *Its suppression of the penetration checks is not it.* Removing the
  `if self.combination.is_some() { return Ok(min); }` early return in
  `inconsistent_digits_request` (upstream's `if (cg == null)` gate) leaves the
  sweep at **4/21**.
- *The landed `result.max(backup)` backjump is not it, and it is active.* All
  three attempts run at every failing face, so attempt 3 is reached. Forcing
  `sound_backjump` on for **every** attempt also leaves the sweep at **4/21**
  (same four faces).

**What is left, and the number that names it.** The accelerator's only remaining
channel is the guides `add_guide_and_check` writes into the subface's
`ChainPermutationGenerator`, which confine it to one combination for the whole
accelerator lifetime. Those lifetimes are ended from *outside* before a second
combination is ever reached — at a failing face, of 21 constructions:

- **19** retired by `clear_temp_guide()` (the swapper's `onSwapOver`),
- **2** by `reset_permutation_generator()`,
- **1** ever advanced to a next combination (`NEXT_RESCUED_BY_ACCEL`),
- **0** ever reported exhaustion through `next()` (`NEXT_ZERO_VIA_ACCEL`); all
  48 terminating zeros came from subfaces with no accelerator.

At a folding face the accelerator behaves completely differently: sf=5 has 46
constructions and **45** advances to a next combination. So the failing-face
signature is an accelerator that is built, commits the subface to combination #1,
and is torn down and rebuilt before it can offer anything else.

**Port audit (step 4), no further divergence found.** `combination.rs` was read
term for term against `CombinationGenerator.java`, `Constraint.java`,
`TernaryConstraint.java`, `QuaternaryConstraint.java` and
`SwappingAlgorithm.java`: `process` (including the `count == 0` swap gate,
`ia.restore`/`setDepth`, the `deepest` reset range, and the `deadEnd` branch),
`backtrack`, `findConflict`/`conflicting_depth`, `next`, `nextIfReset`,
`optionRemain`, `isDeadEnd`, `write`, `rules`, `getChecks` and
`addGuideAndCheck` all match. Two intentional, harmless representation
differences: the swapper's `history` stores the exact position prefix where Java
stores `Arrays.hashCode` of *identity* hash codes (Java can therefore collide and
is not reproducible run to run; ours cannot and is), and `visited` is keyed by
storage index rather than object identity. `addGuideAndCheck`'s
`locate(...).unwrap_or(0)` is unreachable — the reduction only ever names local
ids `1..=face_id_count`, and `map` is sized `num_digits + 1`.

Instrumentation: counters in `permutation.rs` / `combination.rs` / `order.rs`, a
`FOLD3D_ACCEL_OFF` / `FOLD3D_ACCEL_NO_SUPPRESS` / `FOLD3D_FORCE_BACKJUMP` env
gate and `examples/accel_sweep.rs`, all default-off and **all removed again**;
`git diff` carries none of it.

### Round 8 — adversarial check: is `next(0)` at prefix position 1 the drop site? (2026-08-29)

**Answer: no. The step is real — it is the *only* way a failed search on this
model ever ends — and that is exactly why it cannot be the drop site. It fires
17 times on a file that folds at 21 of 21, and at 2 of `cant_fold`'s own 4
folding faces, with a byte-identical signature.** *Measured.* The candidate under
test was "a `false` from prefix position 1 is an unconditional global verdict
with no backtrack, and the `false` comes from `run_combination_generator`
returning 0 with `SubFace.cg` live".

Method: a per-event probe (`zverify`) recording, for every
`possible_overlapping_search_with_table` that returns false, its prefix position,
subface index, which of the four `Ok(false)` exits it took, and which of
`ChainPermutationGenerator::next`'s two zero paths last fired; plus, for every
outer search, the last `subface_count` handed to `self.next(..)` and what it
returned. Driven through the public `Fold3dSession::new`. Run in a throwaway
`git worktree` carrying a snapshot of the three in-flight files, because a
parallel session was editing `permutation.rs` continuously.

**Anchors, verified both ways.** At `HEAD` (`d5319549`)
`crates/oristudio-cp/src/folding/permutation.rs:747-753` is the
`WorkerSearchStep::Inconsistent { subface_id, table }` arm calling
`self.next(subface_id - 1)`, and `:1526-1551` is `advance_subface_permutations`,
whose advance loop `for index in (0..subface_count).rev()` is line 1541. In the
uncommitted tree the same two sit at `:866-872` and `:1612`. The candidate's
reading of both is correct.

**Baseline reproduced**: `cant_fold` 4 of 21 (faces 1, 5, 6, 19), 137-2,789 ms;
`failed_layer_ordering` 21 of 21; `successful_layer_ordering` 21 of 21.

**The step is universal, not diagnostic.** Over the whole 21-face `cant_fold`
sweep there are **53** searches returning `found = false`, and **all 53** end the
same way — `next(..)` last called with `subface_count = 0` and returning 0:

| | terminating `next` arg 0 | deeper | total failed searches |
| --- | --- | --- | --- |
| `cant_fold`, 17 failing faces | 51 | **0** | 51 |
| `cant_fold`, sf=5 and sf=6 (**both fold**) | **2** | 0 | 2 |
| `failed_layer_ordering` (folds 21/21) | **17** | 22 | 39 |

The two `cant_fold` folding-face events are not a near miss. sf=6 is the same
single 213-face / 3,776-variable component the failing faces produce; its
`Completeness::Upstream` attempt dies at
`iters=15 last_next_arg=0 last_changed=0 falses=14 falses_at_pos0=1`, last false
at prefix position 0 on subface index 21 (43 faces) with `gen_count=1801` —
identical to sf=0's terminating event in every field except `valid` (34 vs 32).
Then attempt 2 succeeds. So the split is decided *after* this step, not by it.

**The causal attribution is wrong, in all 53 cases.** Every terminating false is
the `while changed != 0` loop exit with `self.combination.is_none()` — `cg`
**dead**, not live — and the zero came from `ChainPermutationGenerator::next`'s
`looped` guard (`HEAD:1743-1745`), not from `run_combination_generator`. The
accelerator handover exit (`HEAD:1131`, the `run_combination_generator()? == 0`
return) accounts for **0 of 53**. On `failed_layer_ordering` all 39 are the same
loop exit but via plain exhaustion rather than the `looped` guard. This is the
third independent measurement of that fact (Round 6b's `accel=false count=1801`
with the `looped` counter moving; Round 7's `NEXT_ZERO_VIA_ACCEL = 0`).

**The arm is also sound as written, so there is no missing backtrack.** Prefix
position 0 is always searched against `HierarchyTable::from_initial(&hierarchy)`,
a table nothing else in the prefix can change. A subface with no stacking
admissible against the base hierarchy alone makes the component unsatisfiable
outright, so `next(0)` having nothing to advance is the right answer *given* the
exhaustion. Everything wrong is in the claim of exhaustion, upstream of this arm.

**Both rival mechanisms, re-measured on the same binary, erase the step
entirely:**

| `cant_fold` | folds | worst ms | failed searches over the sweep |
| --- | --- | --- | --- |
| shipped | 4 / 21 | 2,789 | 53 |
| `COMBINATION_GENERATOR_THRESHOLD` handover suppressed | **21 / 21** | 247 | **0** |
| generator loop checkpoint cleared in `reset_permutation_generator` | **21 / 21** | 388 | **0** |

**The proposed fixes.** The parity half (restoring `hasCustomConstraint` in
`prioritize_subfaces`) was not re-run — Round 6 already measured prefixes of 47
and 52 leaving all three failing faces false in all three attempts, and the
proposal concedes it. The "honest verdict" half — report `SearchExhausted` when
the exhaustion happened with `SubFace.cg` live — has a predicate that is
**measured never to hold**: 0 of 53. It would leave `NoLayerOrder` on all 17
failing faces exactly as today. Read loosely (any exhaustion), it relabels all 53
and is a pure rename that leaves the sweep at 4 of 21; that is open question 3,
which does not need a drop site.

Not run, and why: no behaviour-changing fix was applied, so `cargo test` and the
Oriedita oracle would have gated a probe rather than a change. The two control
sweeps above are what validate the snapshot baseline.

Instrumentation: `zverify` (a thread-local event log plus a `z_false_kind` /
`z_zero_kind` tag on `SubFacePermutationSearch` / `ChainPermutationGenerator`),
`examples/zverify.rs`, and one `mod permutation` -> `pub mod permutation` in
`folding.rs`. All of it lived only in the throwaway worktree, which is
**removed**; the shared tree never saw any of it and `git diff` carries none of
it. Copies are at `<scratchpad>/zverify_probe.patch` and
`<scratchpad>/zverify.rs.saved`. The `ADV_ACCEL_OFF` / `ADV_CLEAR_LOOP` gates the
two ablations used are a parallel session's, not mine.

### Round 9 — adversarial check: is the `CombinationGenerator` hand-over the drop site? (2026-08-29)

**Answer: no. The accelerator is causally load-bearing — suppressing it does take
the sweep 4/21 → 21/21 — but the mechanism Round 5 named for it never executes
inside the shipped search, and every accelerator signature that was offered as
the failing-face fingerprint also fires on faces that fold.** *Measured.*

Candidate under test: the `self.generator.count() > COMBINATION_GENERATOR_THRESHOLD
&& self.combination.is_none()` hand-over in
`SubFacePermutationSearch::possible_overlapping_search_with_table`, "whose
`run_combination_generator` -> `SubFacePermutationSearch::next` -> `Ok(0)` ends a
subface's stream".

**Anchors.** The function and call names are right; the line number is not. The
hand-over is `permutation.rs:1208` in the working tree and `:1123` at
`git show HEAD` — the candidate's "~line 1534" is 326 lines off its own tree and
matches neither. `run_combination_generator` is tree `:1250` / HEAD `:1165`,
`SubFacePermutationSearch::next` tree `:1156` / HEAD `:1071`. The upstream audit
the candidate cites is Round 7's; not re-verified here.

**Baseline reproduced.** Fresh `--release` build, default-off counters, sweep
against the public `Fold3dSession::new`: `cant_fold` folds at **4 of 21**, faces
1 / 5 / 6 / 19, 136–2,289 ms. Bit-for-bit the documented baseline.

**Killer question — the mechanism fires on folding faces, and the named path
fires nowhere.** Counters, per starting face, summed over all attempts:

| | failing (17 faces) | sf=1 folds | sf=5 folds | sf=6 folds | sf=19 folds |
| --- | --- | --- | --- | --- | --- |
| accelerator constructions | 21 | 4 | 46 | 46 | 4 |
| **`next` -> `run_combination_generator` -> `Ok(0)`** | **0** | **0** | **0** | **0** | **0** |
| Ok(false) with a live accelerator, loop exit | 0 | 0 | 0 | 0 | 0 |
| Ok(false) from the accelerator at construction | 2 | 0 | **3** | **3** | **1** |
| advanced to a second combination | 1 | 1 | 45 | 44 | 1 |
| retired by `clear_temp_guide` | 19 | 4 | 43 | 43 | 3 |
| retired by `reset_permutation_generator` | 2 | 0 | 3 | 3 | 1 |

Three independent failures of the discriminative test:

1. **The named stream-ending path is taken 0 times, on all 21 faces.** Also 0 on
   `full_iguana` sf=0/1, which build 330 accelerators each. It cannot be a drop
   site anywhere, because it never runs.
2. **The accelerator's only actual `Ok(false)` route fires *more* on folding
   faces**: 2 per failing face, but 3 at sf=5, 3 at sf=6, 1 at sf=19.
3. **The claimed failing-face fingerprint — built, committed to combination #1,
   torn down before offering another — is the sf=1 and sf=19 shape exactly**: 4
   built / 1 advanced, against the failing faces' 21 / 1. Round 7's contrast used
   sf=5 (46 / 45), which is the outlier among folding faces, not their norm.

**Why Round 5 saw an exhausting cycle and the search never does.** All 21
accelerator lifetimes at a failing face are ended from outside — 19 by
`clear_temp_guide`, 2 by `reset_permutation_generator` — so none is ever run to
its end. The "fixed cycle of 24 / 55 / 195 / 255 permutations" is a property of
an *isolated* `SubFacePermutationSearch` drive, where nothing calls
`clear_temp_guide`. It is not a thing the shipped traversal does.

**The ablation does not uniquely implicate the hand-over.** Two disjoint
single-point changes each take `cant_fold` to 21/21:

| | folds | ms | accel built | accel Ok(false) | checkpoint saves |
| --- | --- | --- | --- | --- | --- |
| shipped | **4 / 21** | 136–2,289 | 21 | 2 | 18 |
| hand-over suppressed | 21 / 21 | 206–256 | 0 | 0 | 3 |
| loop checkpoint cleared on reset (Round 6's) | 21 / 21 | 200–397 | **11–12** | **3–4** | 6 |

The second row is Round 7's result, independently reproduced. The third is the
adversarial control: with the accelerator **fully active** — still built 11–12
times per face, still returning its own `Ok(false)` 3–4 times per face — every
face folds. So neither change is individually necessary for the failure, and
"the hand-over is *the* drop site" is not what the ablation shows.

**Shippability, independently reproduced.** `full_iguana` shipped: sf=0 34.3 s,
sf=1 34.0 s, both `NoLayerOrder`. With the hand-over suppressed, sf=0 was killed
at **480 s** with no result — a ≥14x regression, matching Round 7's 25-minute
observation. Controls: `failed_layer_ordering` 21/21 and
`successful_layer_ordering` 21/21, both shipped and suppressed.

**Gate.** 975 crate tests green, Oriedita folding oracle **29/29** with
`ORIEDITA_GEOMETRY_ORACLE` actually set. That gates the *probe* (it is inert —
the sweep reproduces 4/21 at the same four faces), not a fix: no behaviour-
changing change was applied, and the ablations are env-gated and default-off.

**What this leaves.** The accelerator is upstream of the failure but is not where
a valid ordering is discarded. Any 3D-only "suppress the hand-over" escalation is
dead on `full_iguana` regardless. Both this candidate and Round 6's live in
`folding/permutation.rs`, which is Oriedita-ported and shared, so any fix there
must be a `Completeness` opt-in like `resetting_generators_on_swap` /
`with_sound_backjump` — never an unconditional edit.

Instrumentation: 14 default-off atomic counters plus `ADV_ACCEL_OFF` /
`ADV_CLEAR_LOOP` env gates in `permutation.rs`, one re-export line in
`folding.rs`, and `examples/advverify_sweep.rs`. **All removed**; the tree is
byte-identical to the baseline it started from (same md5, same 251-line
diffstat), and `grep -rn ADVVERIFY crates/` is 0. A copy of the harness is at
`<scratchpad>/advverify_sweep.rs.saved`. These are the `ADV_*` gates Round 8
borrowed; they no longer exist in the tree.


### Round 10 — adversarial verification of the `looped`-guard drop site (2026-08-29)

**Verdict: the site is real, the rejection it produces is provably wrong, and the
fix takes `cant_fold` 4/21 -> 21/21 with every gate green — but the mechanism is
*not* what separates a folding starting face from a failing one. It fires
identically at faces 5 and 6, which fold.** *Measured.*

Method: an isolated `git worktree` at `/private/tmp/claude-501/verify-h2`,
seeded from a snapshot of the shared tree (a parallel session was mid-edit in
`permutation.rs`). Baseline = the two landed fixes plus that session's
default-off `ADV_*` probes with none of their env vars set. It reproduces the
documented baseline exactly: `cant_fold` **4 / 21**, folding at 1 / 5 / 6 / 19,
worst 2,388 ms.

**Anchors.** The candidate's site is HEAD code, untouched by the 251 uncommitted
lines (`git diff` contains the string `looped` zero times). At
`git show HEAD:crates/oristudio-cp/src/folding/permutation.rs`: the guard is
lines 1738-1746 (`self.looped = false;` at 1744), `reset_permutation_generator`
1082-1090, `advance_subface_permutations` 1526, `inconsistent_subface_request`
1446, `WorkerOverlapEnumerator::next` 645, the `Inconsistent` arm 747. In the
working tree as it stood at the start of this round the same five were 1831,
1167, 1612, 1532 and 870; the shared tree has moved again since.

**The chain is exactly as claimed, and every link was measured, not inferred.**
`possible_overlapping_search_with_table` -> `Ok(false)` -> `Inconsistent
{ subface_id: 1 }` -> `next(0)` -> `advance_subface_permutations` with
`subface_count = 0`, whose `for index in (0..0).rev()` never executes -> `Ok(0)`
-> loop exit -> `found = false`. At sf=0 / sf=2 / sf=3 the terminating event is
byte-identical in all nine runs (3 faces x 3 attempts):

```text
position 1   entry 0   false via the `looped` guard   generator count 1801
fresh search on the identical table: found = true
```

**The rejection is wrong.** A clone of the entry, accelerator dropped and
generator restarted, run against the very `HierarchyTable` the live entry was
handed, returns `true` every time. Two controls — checkpoint cleared and
checkpoint intact — agree in every case, which is itself explained by the code:
the guard sets `looped = false` and `saved` was already cleared when `looped` was
set, so a `reset()` after the guard fires is a true restart either way.

**The killer question: no, it does not fire on failing faces only.**

| | sf=0 / 2 / 3 (fail) | sf=1 (folds) | sf=5 (folds) | sf=6 (folds) | sf=19 (folds) |
| --- | --- | --- | --- | --- | --- |
| `looped_zero`, whole sweep | 18 | 2 | **41** | **41** | 1 |
| attempt 1 verdict | false | true | **false** | **false** | true |
| attempt-1 terminal event | `(pos 1, entry 0, looped, count 1801, fresh=true)` | — | **identical** | **identical** | — |
| wrong `looped` rejections inside the *winning* attempt | — | 0 | **28 of 36** | **28 of 36** | 0 |

Faces 5 and 6 hit the candidate's terminating step, with the same subface at the
same unbacktrackable prefix position at the same generator count, and fold
anyway on attempt 2. Attempt 2 at sf=5 rejects 36 subfaces via the `looped`
guard, 28 of them demonstrably wrongly, and still finds a layer order. So the
mechanism is **necessary but not sufficient**: it is what ends every failing run,
and it is survivable.

**The fix, and the four measurements.** Implemented as the candidate proposes —
`reset_permutation_generator` clears `looped` / `saved` / `restored` /
`save_history` before `generator.reset()` — behind a new
`WorkerOverlapEnumerator::clearing_loop_checkpoint_on_reset()`, set only from
`folding3d/order.rs::build_enumerator`, so the shared flat path is untouched.

| | shipped | fix on |
| --- | --- | --- |
| `cant_fold.fold` | **4 / 21**, worst 2,388 ms | **21 / 21**, worst 379 ms |
| `failed_layer_ordering.fold` | 21 / 21, worst 686 ms | 21 / 21, worst 644 ms |
| `successful_layer_ordering.fold` | 21 / 21, worst 91 ms | 21 / 21, worst 89 ms |
| `cargo test -p oristudio-cp --release` | — | **975 passed, 0 failed** |
| folding oracle (`ORIEDITA_GEOMETRY_ORACLE` set) | — | **29 / 29** in 17.30 s |
| render oracle (same) | — | **13 / 13** in 31.44 s |

The oracle env var was live: the same folding-oracle target finishes in **0.00 s**
without it and 17.30 s with it.

With the fix on, sf=0 folds on attempt 1 in 18 outer iterations, and the one
`looped`-guard rejection that remains has **no external reset since its
checkpoint was armed** and is **not** wrong — i.e. the fix removes exactly the
class of `looped` zeros that follow a `reset_permutation_generator`, and leaves
upstream's legitimate cycle completion alone.

**Independent confirmation of the mechanism.** Never arming the checkpoint at all
(`count == 800` no longer sets `saved`, globally, at every reset site) also takes
`cant_fold` to **21 / 21**, worst 1,341 ms. Two different ways of disabling the
save/restore economy give the same answer, which is what a real mechanism looks
like and what a lucky perturbation does not.

**One correction to the candidate's narrative.** It describes `reset()` as
restarting the stream and the checkpoint as cutting the restart short. That is
not what the code does. With `saved` true, `reset()` seeds `swap_history` from
`save_history[1]` and calls `next_core(1)`, so it **resumes at the stored save
point** — upstream says so itself: *"we use another array to store the progress
so after reset, it can continue the searching from a recent saving point"*
(`ChainPermutationGenerator.java`, the `saveHistory` comment). The prefix
`[start, save point)` is therefore never re-enumerated, and the `looped` guard
reports that suffix-only cycle as global exhaustion. The fix is right for that
reading — clearing `saved` / `save_history` makes `reset()` a true restart — but
any landed doc comment should say the accurate thing.

**Attribution measured, not assumed.** Counters on the generator record how many
`reset_permutation_generator` calls (`ext`) and how many internal `next()`
exhaustion resets (`int`) have happened since the checkpoint was armed. At the
terminal event: sf=0 attempt 1 `(ext 1, int 1)`, attempts 2 and 3 `(ext 3,
int 2)`. So an external reset really is in the chain, as the candidate claims.
sf=0 attempt 1 also has one `looped` zero with `ext = 0` — upstream's legitimate
cycle — so the two classes are distinguishable and only the `ext > 0` class is
wrong.

**The cost, and why this is not shippable as written.** `full_iguana.fold`,
faces 0 and 1, one starting face at a time:

| | shipped | fix on |
| --- | --- | --- |
| sf=0 | `NoLayerOrder`, 29,775 ms | `SearchExhausted`, **917,794 ms** |
| sf=1 | `NoLayerOrder`, 30,146 ms | not reached |

A 30.8x blowup, and the verdict changes class: the fixed run does not terminate on its own, it hits `FOLD_3D_ITERATION_BUDGET`. Part of that window overlapped my gate runs, so treat 917 s as an upper bound and 30x as approximate — the first uncontended 2.5 minutes were already 5x the whole shipped solve. This is the log's own warning from the previous round, now with a number: **the `looped` guard is load-bearing for termination**, and clearing the checkpoint removes it without a replacement bound.

**The pinning test has no committed subject yet.** The right assertion is the
invariant the bug violates — *the layer-order verdict may not depend on
`starting_face_id`* — but every committed 3D fixture is already uniform under
the shipped search: `box_90` 21/21, `hinge_90` 21/21, `spikes_small` 21/21,
`spikes_large` 21/21, `box_90_unangled` 0/21 (refused at admission, not a
layer-order verdict). So an invariant test over `tests/fixtures/fold-angle-3d`
passes today and would not have caught this. Landing it means either committing
a reduced `cant_fold`, or hanging the sweep off `tests/non_flat_corpus.rs`,
which is already env-gated on an external corpus. A second, cheaper test does
have a subject: assert that with the 3D option on,
`reset_permutation_generator` leaves `count == 0` and the generator's first
permutation equal to a fresh generator's — i.e. that a reset really restarts —
which fails on the shipped path and pins the divergence rather than the symptom.

**Not run:** `stick on a floor - failure.osf` (needs the schema-8 JSON-pointer
loader this harness does not have). The fix was not tried as a fourth
`Completeness` attempt rather than as an option on all three, which is the shape
the cost above argues for.

Instrumentation: generator zero-path counters, a `h2_false_kind` on
`SubFacePermutationSearch`, the `ext`/`int` reset attribution, a default-off
`H2_PROBE` fresh-search control in `inconsistent_subface_request`, an
`H2_NOSAVE` switch, and `examples/h2_verify.rs`. All of it lived in the
throwaway worktree and **none of it is in the shared tree**; `git diff` there
carries none of my identifiers. The worktree and its copy of the harness are at
`/private/tmp/claude-501/verify-h2` until removed.

---

### Round 11 — the fix, landed and measured (2026-08-29)

**Root cause: `ChainPermutationGenerator::reset()` is not a restart.** With
`saved` set it seeds `swap_history[i]` from `save_history[2][i] - 1` and flags
`restored` — upstream's checkpoint *resume*. That is right for a generator
continuing its own enumeration, and wrong for every caller that means "begin
again": `advance_subface_permutations` resets every generator at or past the
backtrack point, and `resetting_generators_on_swap` resets every re-seated digit.
Both get a resume from a checkpoint captured under a different table, at a
different odometer position, under different temp guides. The `looped` guard then
cuts the restarted stream short against it and returns 0 while permutations
remain, which the outer loop reads as global exhaustion.

This also explains the non-monotonicity recorded under Corrections: the swap-reset
fix *increases* the number of `reset()` calls, so it increases exposure to the
stale resume. That is why `SwapReset` is incomparable with `Upstream` rather than
strictly stronger.

**Fix.** `ChainPermutationGenerator::clear_loop_checkpoint()` clears
`looped`/`saved`/`restored`/`save_history` so the next `reset()` takes the
restart branch. Opt-in at two levels
(`SubFacePermutationSearch::clear_loop_checkpoint_on_reset`,
`WorkerOverlapEnumerator::restarting_generators_on_reset()`), and wired as a
fourth `Completeness` attempt, `RestartOnReset`, under its own
`FOLD_3D_RESTART_BUDGET`.

| file | before | after |
| --- | --- | --- |
| `cant_fold.fold` | 4 / 21, worst 2,388 ms | **21 / 21**, worst 2,368 ms |
| `failed_layer_ordering.fold` | 21 / 21, worst 623 ms | 21 / 21, worst 644 ms |
| `successful_layer_ordering.fold` | 21 / 21, worst 85 ms | 21 / 21, worst 88 ms |
| `full_iguana.fold` | 0 / 3, median 29.8 s | 0 / 3, **median 79.7 s** |
| `stick on a floor - failure.osf` | 0 / 3, ~270 ms | 0 / 3, 629 ms |

975 crate tests, folding oracle 29/29, render oracle 13/13 — with
`ORIEDITA_GEOMETRY_ORACLE` set, verified live by the same target finishing in
0.00 s without it.

**The cost is real and unresolved.** `full_iguana` pays ~50 s more to reach the
same verdict. `FOLD_3D_RESTART_BUDGET` does not bite — `exhausted 0` at 2,000 and
at 50,000, and the verdict and time barely moved between them — so the cost is
per-iteration on a 1,213-face component, not iteration count. A budget cannot fix
it; gating the fourth attempt on component size could, but no threshold is
justified by data yet. Open.

**Honest weakness of the mechanism.** It fires on folding faces too:
`looped_zero` is 18 at every failing face but 41 at sf=5 and sf=6, which fold, and
sf=5's *winning* attempt contains 36 `looped`-guard rejections of which 28 are
demonstrably wrong. So it is necessary-not-sufficient — what ends every failing
run, and survivable. The counterfactual (fix it, 4/21 → 21/21) is the evidence,
not the firing count.

**Two rival candidates, both refuted on measurement, see R11 and R12.**

### Round 14 — what does the FLAT path build for the same model? (2026-08-29)

**Answer: the same subfaces, and a completely different hierarchy. Max subface
is 103 on *both* sides, so subface size explains nothing. What the flat path has
and the 3D path does not is Oriedita's setup-time additional-estimation pass:
it decides 99.69% of the ordering variables before the search starts, against
the 3D path's 13.66%.** *Measured.* Subject: the controlled pair
`full_iguana_flat_working.fold` (flat path) and `full_iguana_non_flat_failing.fold`
(3D path), starting face 1.

| | FLAT (1,132 faces, 1.5 s, folds) | 3D (1,213 faces, ~113 s, gives up) |
| --- | --- | --- |
| subfaces handed to the search | 632 arrangement cells → **200** reduced | **292** (192 cell + 100 coupling), `reduced = all` |
| **MAX SUBFACE** | **103** | **103** |
| subface size p50 / p90 (search set) | 49 / 69 | 4 / 64 |
| components | **1** | **1** |
| ordering variables | 54,656 | 50,713 |
| relations in the hierarchy the search starts from | **54,484** | **7,506** (7,106 seed + 400 cut) |
| …as a fraction of the variables | **99.69%** | **13.66%** |
| conditions the search carries | triples **142**, quads **75** | triples **50,980**, quads **16,640** |
| `valid_count` (prefix the odometer permutes) | **11** | **138** |
| pairs inside the valid prefix | 20,303 | 158,012 |
| **outer iterations** | **1** | **10,494** over four attempts, attempt 4 cut at `FOLD_3D_RESTART_BUDGET` |

**The single number that explains it.** The 103-face subface exists in both
instances and has 5,253 internal pairs. `set_guide_map` turns every pair the
hierarchy decides into a chain guide, so this is the direct link from hierarchy
coverage to that subface's permutation space:

| | pairs of the 103-face subface the hierarchy decides |
| --- | --- |
| FLAT, as shipped (AEA-closed) | **5,229 of 5,253 — 99.54%** |
| FLAT, before its AEA pass | 143 of 5,253 — 2.72% |
| 3D, as shipped | **307 of 5,253 — 5.84%** |

So the flat path's 103-face subface is not a search problem at all: its generator
is pinned to within 24 undecided pairs. The 3D path's identical subface is
essentially unconstrained. **Before AEA the flat model is *worse* constrained
than the 3D one (2.72% vs 5.84%)** — the whole gap is the pass, not the geometry.

**Where the flat path's closure comes from.** `overlap_enumerator_from_segments`
runs `run_additional_estimation_remove` (Oriedita's `removeMode` AEA round)
between building the subfaces and building the enumerator: it closes the table
and writes it back through `into_initial_hierarchy`, taking relations **2,042 →
54,484**, and prunes conditions **57,351/16,080 → 142/75**. `folding3d/order.rs`
has no such call — `plan` → `Builder::localise` → `build_enumerator` →
`from_subfaces` hands the raw seeds straight to the search
(`grep -rn additional_estimation crates/oristudio-cp/src/folding3d/` finds only
error types). *Read from code, and confirmed by the relation counts above.*

**The mechanism from coverage to prefix, measured on the public API.**
`prioritize_subfaces` counts a subface pair as "new information" only when
`PairStateTable::from_hierarchy` reports it `Empty`, and neither that table nor
`HierarchyTable::from_initial` closes anything — the *listed* relations are all
the search knows. Same flat subfaces, three hierarchies:

| hierarchy handed to `prioritize_subfaces` (flat model) | `valid_count` |
| --- | --- |
| raw seeds, 2,042 relations (**the 3D path's shape**) | **188** |
| transitive closure of those seeds, 47,506 relations | 115 |
| AEA closure, 54,484 relations (**what the flat path ships**) | **11** |

The 3D component answers the same way: 138 with its seeds, **105** with a sound
transitive closure of them (44,634 relations, 0 cycles). Transitivity alone gets
both models to ~87–88% coverage and is worth ~25% of the prefix; the last
~12 points, and the collapse to 11, come from AEA propagating the *equivalence
conditions*.

**The counterfactual, and it is a witnessed false negative on the FLAT path.**
Run the flat model's own subfaces through the shipped `WorkerOverlapEnumerator`
with the raw hierarchy and unpruned conditions — the 3D path's shape, nothing
else changed:

| flat model, same 632 subfaces, same 57,351/16,080 conditions | valid_count | outer iters | result |
| --- | --- | --- | --- |
| AEA-closed hierarchy | 11 | **1** | `found = true`, 293 ms |
| raw hierarchy | 188 | 6 | **`found = false`**, 5,899 ms |

The raw relation set is a verified subset of the closed one (0 missing, 0
orientation-flipped), so the raw instance is a strict *relaxation* of an instance
that was just solved. Its `found = false` is therefore a **proven false
negative**, reproduced on the flat path, purely by withholding the AEA pass. The
condition pruning is not the mechanism: the closed run above still carried all
57,351 + 16,080 conditions and still finished in one iteration.

**The subface construction is not the lever — refuted, do not re-run.** The two
constructions already agree where it matters. `cells.rs` emits maximal covering
sets per plane, `configure_subfaces` emits per-cell covering sets over the whole
folded silhouette and then reduces by containment, and both top out at 103.
Applying the flat path's `reduce_subface_set` to the 3D set keeps **292 of 292**
— it is already irredundant, so there is nothing to shrink. The 3D set is also
*smaller* (192 cell subfaces vs 632 raw / 200 reduced). The per-plane trap does
not even arise: cells.rs already builds per plane and `plan`'s union-find and the
coupling quadruples put every plane back into one component, which is why both
instances have exactly one component.

**Instrumentation:** none in `src/`. Two examples, `q4ab.rs` (instance shape,
both paths, `plan()` transcribed) and `q4ab2.rs` (the coverage/closure
ablations), built once with `--features fold-profiling` — whose existing
`fold_profiling` counters and `[fold-phase]` lines supply `outer_iters`,
`valid_count`, `initial_relations`, `max_subface_faces` and the post-`removeMode`
condition counts with no new code. Both **removed**; copies are at
`<scratchpad>/q4ab.rs.saved` and `<scratchpad>/q4ab2.rs.saved`. Timings under the
profiling feature and with a parallel solve running are inflated (the 3D
`order_placement` measured 301,277 ms here against the documented 113,030 ms);
the *iteration* and *structure* counts are deterministic and are the ones to
quote. `full_iguana_flat_working.fold` reproduces valid_count 11 / 1 outer
iteration at starting faces 1, 2, 5 and 9.

**What this leaves.** The next experiment is one call, not a new algorithm: run
the same AEA pass over each `ComponentInput` in `folding3d/order.rs::plan`
before `build_enumerator`, and re-measure `valid_count`, guide density on the
103-face subface, and the verdict. It is 3D-only by construction (the flat path
already does it), so it needs no `Completeness` gate. Two things must be checked
rather than assumed: (1) the 3D conditions are not upstream's — the coupling
quadruples are synthetic — so AEA may contradict where the search would not, and
that error class has to be routed, not swallowed; (2) `run_additional_estimation`
is `O(k³)` in the largest subface with `k = 103`, over 50,980 + 16,540
conditions, and it cost 67 ms on the flat model — cheap, but it should be
measured on the 3D instance rather than assumed to transfer.

### Round 15 — why one component of 50,713 variables, and must it be? (2026-08-29)

**Answer: the giant component is built by the *subfaces*, before any condition
or coupling is looked at; the union is coarser than it needs to be but not
consequentially so; there is no articulation structure to split on; and the
whole question is moot, because the FLAT twin is also one component — a bigger
one — and solves it 70x faster. Component size is measured dead as an
explanation of the 70x.** *Measured.* Subject: the controlled pair, starting
face 0 for the 3D file, 1 for the flat file. Independent of Round 14 and
agreeing with it on every shared number (max subface 103 both sides, 292 of 292
irredundant, one component each).

**Transcription validated first.** `plan()`'s union-find was transcribed outside
the crate and reproduces Round 4's documented `cant_fold` split bit for bit:
sf=0/2 give one 213-face / 3,776-variable component, sf=1/5 give 3,770 + 6
variables over 209 + 4 faces.

**Q1 — the union sources, ablated.** `full_iguana_non_flat_failing.fold` sf=0:
1,213 faces, 4 planes, 50,713 census pairs, 192 cell subfaces, 50,980 triples,
16,540 quadruples, 100 of 209 couplings kept, 7,228 seeds.

| cumulative union source | components | effective merges added | largest |
| --- | --- | --- | --- |
| (nothing) | 50,713 | — | 1v / 2f |
| subfaces | **28** | 50,685 | 50,416v / 1,051f |
| + triples | 28 | **0** | 50,416v / 1,051f |
| + quadruples | 28 | **0** | 50,416v / 1,051f |
| + couplings — **shipped** | **1** | **27** | 50,713v / 1,213f |

Leave-one-out says the same thing: dropping triples, quadruples or subfaces
still gives 1 component; only dropping couplings gives 28. The 27 small
components are 11 variables / 6 faces each.

**So "which source collapses it" has two answers and the second is the real
one.** Couplings collapse 28 → 1 in **27 merges** — but the collapse that
matters already happened: 50,416 of 50,713 variables (99.41%) are in one
component from the subfaces alone. Deleting every coupling would shrink the
giant component by **0.59%**.

The same shape holds on every file and face checked — `cant_fold` (7 → 1 or 2),
`failed_layer_ordering` (4 → 1), `successful_layer_ordering` (4 → 1), at sf =
0/1/2/5 — with triples and quadruples contributing **0 effective merges every
time**. That corrects Round 4, which attributed `cant_fold`'s failing-face
merge to quadruple conditions: measured, quadruples merge nothing at either
face, and the sf=0 vs sf=1 difference is 6 coupling merges against 5.

**Q2 — the union is coarser than needed, and it does not matter.** `join()`
unions the whole clique over the named faces, but `apply_triple_condition` only
ever reads or writes `(a,b)` and `(a,d)`, and `apply_quadruple_condition` only
the four cross pairs `(a,c) (a,d) (b,c) (b,d)`. So the clique join unions
**50,980 triple pairs and 33,080 quadruple pairs that no condition constrains**,
every one of them a real census variable. Redoing the whole ablation with exact
scopes gives an **identical partition at every stage** — 28 → 28 → 28 → 1. The
over-merge is entirely absorbed by the subface cliques. Worth tidying for
honesty; worth nothing for speed.

**Q3 — there is no articulation structure.** Block-cut decomposition of the
bipartite incidence graph (variables, plus one node per subface / condition /
coupling scope):

| scope set | blocks | ≥2-variable blocks | articulation variables | largest block |
| --- | --- | --- | --- | --- |
| subfaces only | 14,983 | 3 | 27 | 35,754 |
| shipped clique scopes | **2** | 2 | **1** | **50,708 of 50,713** |
| exact scopes | 168 | 163 | **1** | **49,277 (97.2%)** |

One cut variable. The best sound split available anywhere between "per plane"
and "everything" leaves 97.2% of the variables in one block. And the trap does
not need invoking to kill the per-plane idea, because per-plane is *also*
worthless here: plane 0 holds **50,416 of 50,713 variables and 1,051 of 1,213
faces**; planes 1/2/3 hold 99 variables and 54 faces each, and all **100 of 100
couplings are cross-plane**, which is exactly the trap's mechanism. Even the
unsound split buys 0.59%.

**Q4 — the payoff, estimated, and the model that refutes itself.** Measured on
one `--release` build, one machine, `order_placement` end to end (load average
105 from parallel agents; the twin pair reproduces the documented 1.6 s / 113 s
at a uniform 2.1x inflation, so treat ratios as sound and absolute times as
inflated):

| instance | faces | variables | max subface | ms | outcome |
| --- | --- | --- | --- | --- | --- |
| `spikes_large` | 214 | 543 | 7 | 8 | found |
| `successful_layer_ordering` | 124 | 2,289 | 38 | 323 | found |
| `failed_layer_ordering` | 125 | 2,324 | 38 | 3,149 | found |
| `cant_fold` | 213 | 3,776 | 43 | 7,279 | found |
| iguana non-flat | 1,213 | 50,713 | 103 | 236,703 | `SearchExhausted{0, 10001}` |
| iguana **flat twin** | 1,132 | **54,656** | **103** | **3,351** | **Solved** |

A least-squares power law over the four "found" 3D points gives cost ∝
variables^3.5, but the fit is not usable and saying so is the finding: the two
`*_layer_ordering` files differ by 35 variables (1.5%) and by **10x in time**,
and pairwise exponents range from 1.7 to 165. *Estimate, wide.* Taking k = 3.5
anyway, the best sound split (49,277 of 50,713) buys **1.11x** and the unsound
per-plane split buys **1.02x**; reaching the owner's "well under 10 s" from
113 s needs ≥12x, which would need k ≥ 87. An exponential model is not a way
out either — it is falsified outright by the last row, which has **3,943 more
variables and runs 70.6x faster**.

**Q5 — the flat path produces one component too, and it is the bigger one.**
The flat path does no decomposition at all: `from_subfaces` is called once over
the whole model, and `folding3d`'s `build_enumerator` is the only caller of
`plan`. Running the same union rule over the flat twin as a counterfactual:
**1 component at every stage**, 54,656 variables, 1,132 faces, **0 articulation
variables, 1 block**. Its subface set reduces 632 → 200 by containment; the 3D
set is already irredundant (0 duplicates, 0 containments, 292 of 292 kept),
confirming Round 14 from a second harness. `successful_layer_ordering` and
`failed_layer_ordering`, which fold at 21 of 21, are also **one component
each** — so "one component" is not a failing-instance signature in the first
place.

**Refuted here, do not re-run:** *the 50,713-variable single component is why
the 3D path is slow.* An instance with 54,656 variables, the same 103-face
subface, one component and zero articulation points folds in 3.4 s on the same
binary and machine. *Decomposing the component is a lever.* The best sound
decomposition available leaves 97.2% of the variables together, and the
per-plane one (unsound, see the trap) leaves 99.4%. *Quadruple conditions merge
the components.* Zero effective merges, on every file and face measured.

Nothing above contradicts Round 14; it removes the only remaining structural
rival to it. The instance difference is not size or shape, it is the
setup-time additional-estimation pass Round 14 names.

Instrumentation: none in `src/`. One example,
`crates/oristudio-cp/examples/qq_components.rs` (`plan()` transcribed, union
ablation, exact-scope ablation, block-cut decomposition, plane census, flat-twin
counterfactual, solve timings), **removed**; a copy is at
`<scratchpad>/qq_components.rs.saved`. No background process was left running.
The ~640 uncommitted lines in the shared tree are other sessions' and were not
touched.

### Round 16 — where the 113 seconds actually go (2026-08-29)

**Answer: 98% of it is one function — the per-subface permutation search
`SubFacePermutationSearch::possible_overlapping_search_with_table` — and 52% of
all CPU is std SipHash inside its penetration checks. Three of the four cost
candidates in the brief are dead on measurement, and the 103-face subface is
1.6–3% of the solve.** *Measured.* Run in parallel with Rounds 14 and 15; where
it overlaps Round 14 on instance shape it agrees to the digit, independently
(54,484 vs 7,506 relations, 142+75 vs thousands of conditions, `valid_count`
11 vs 138, 1 vs 10,494 outer iterations). This round adds the *time* split, which
none of them had.

Subject: the controlled pair at starting face 1. Instrumentation: the default-off
`zperf` probe already in the tree, extended with three per-entry counters (the
subface's triple and quadruple totals, and how many of its searches ended with
`SubFace.cg` live), plus `examples/zsplit.rs`. **All removed** —
`permutation.rs` is md5-identical to how this round found it and `git diff` is
back to its 643-insertion baseline. No background process left running.

**Absolute times here are inflated, and the round says so.** The least-contended
run carried 70 s of 1 ms `sample` on a 170 s solve; two later runs ran at load
130–233 against parallel agents in other worktrees and came out at 216 s and
259 s. The owner's 113,030 ms is the clean reference. Every *count* below is
deterministic and was byte-identical across all three runs.

**The split by attempt.** Verdict
`NoLayerOrder { reason: SearchExhausted { component: 0, iterations: 10001 } }` —
`RestartOnReset` ends on `FOLD_3D_RESTART_BUDGET`, not on a finished search.

| attempt | outer iters | permutations | subface searches | ms (least-contended run) | share |
| --- | --- | --- | --- | --- | --- |
| `Upstream` | 30 | 63,526 | 114 | 5,276 | 3.1% |
| `SwapReset` | 232 | 315,356 | 619 | 18,689 | 11.1% |
| `SwapResetAndBackjump` | **232** | **315,356** | **619** | 18,460 | 10.9% |
| `RestartOnReset` | 10,001 (budget) | 642,723 | 20,282 | 125,732 | **74.4%** |
| enumerator builds (4×) | — | — | — | 857 | 0.5% |
| everything before the order solve | — | — | — | ~677 | 0.4% |

**Attempts 2 and 3 are the same run.** Identical iteration count, permutation
count, per-entry permutation and accelerator counts, and an identical failure
histogram `[(3,108),(2,99),(4,20),(5,3),(1,1)]`. The backjump option changes
nothing on this model — consistent with R7, where forcing `sound_backjump` on
every attempt left `cant_fold` at 4/21 — so **10.9% of the solve is a
byte-identical repeat of the attempt before it**.

`RestartOnReset`'s 10,001 iterations are not uniform: **9,810 of them fail at
prefix position 2** at `p50 = 0.0 ms`, `p90 = 0.2 ms`. The wall time is in ~190
expensive iterations, max 1,961.8 ms.

**Attribution inside an outer iteration** (`RestartOnReset`, least-contended run;
same shape in all four attempts and all three runs — `subface_search` 94.9–99.7%):

| | ms | share |
| --- | --- | --- |
| `inconsistent_subface_request` | 123,803.0 | 98.47% |
| …of which the **per-subface permutation search** | 123,279.9 / 20,282 calls | **98.05%** |
| …`HierarchyTable::from_initial` | 437.3 / 10,000 rebuilds | 0.35% |
| …`enter_stacking_into` | 79.9 / 10,283 calls / 21,624,633 pairs | 0.06% |
| …realtime AEA | 1.7 / **1 call** | 0.001% |
| `advance_subface_permutations` | 1,819.6 / 9,999 | 1.45% |
| `process_swapper` | 104.5 | 0.08% |
| `run_final_additional_estimation` | **0.0 / 0 calls** | **0%** |

Three of the four named candidates are dead:

- *The 1,213² dense matrix rebuilt every outer iteration.* Real, and it costs
  **0.04 ms per rebuild** — 0.35%.
- *`enter_stacking_into` writing O(n²) pairs per subface.* 21.6M pairs for
  **0.06%**.
- *`run_final_additional_estimation` over ~51k triples and ~17k quads.* **Never
  called, in any attempt** — no prefix is ever consistent, so it never runs. Same
  for the realtime AEA: iteration 1 is always the
  `RetryWithoutRealtimeAdditionalEstimation` arm, so the whole solve runs with
  `realtime_additional_estimation = false` (as R6 found on `cant_fold`).

**The flamegraph.** `sample` for 30 s over attempts 1–2, 24,053 samples, self
time:

| frame | samples | share |
| --- | --- | --- |
| `possible_overlapping_search_with_table` (inlined scan loops) | 10,352 | 43.0% |
| `core::hash::BuildHasher::hash_one` | 7,239 | 30.1% |
| std `DefaultHasher::write` (SipHash) | 5,302 | 22.0% |
| everything else | ~1,160 | 4.8% |

**52.1% of CPU is std SipHash on `HashMap<usize, _>` lookups**, at seven inlined
call sites, all in the penetration checks: `face_id_to_permutation_digit` →
`face_id_map.get` (a `HashMap<usize, usize>`), called **4× per quadruple
condition** by `u_penetration_condition_digit` and 2× per triple by
`penetration_condition_digit`, plus `triple_conditions.get` once per digit.
`u_penetration_inconsistent_digits_request` folds a min over **every** quadruple
condition of the subface with no early exit, once per permutation tested.

Confirmed independently by the per-entry data: cost per permutation is linear in
the subface's quadruple count at **~0.169 µs per quadruple condition** (276 q →
85.7 µs; 350 q → 90.1; 449 q → 134.0; 650 q → 141.9; 1,130 q → 249.2; 1,218 q →
245.3) — ~42 ns per hashed probe × 4, which is what a SipHash
`HashMap<usize, usize>` costs.

**The 103-face subface is not the cost.**

| entry | faces | triples | quads | searches | perms | µs/perm | searches ending with `cg` live |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 (`Upstream`) | **103** | 4,325 | 1,218 | 12 | 5,579 | 245 | **1 of 12** |
| 0 (`RestartOnReset`) | 103 | 4,325 | 1,218 | 22 | 9,704 | 229 | 0 of 22 |
| 51 (`RestartOnReset`) | 85 | 2,632 | 1,014 | 146 | 146,472 | 408 | 73 of 146 |
| 11 (`RestartOnReset`) | 97 | 3,771 | 1,091 | 67 | 70,210 | 478 | 35 of 67 |
| 29 (`RestartOnReset`) | 69 | 1,559 | 611 | 120 | 120,507 | 241 | 60 of 120 |
| 36 (`SwapReset`) | 52 | 1,068 | 276 | 130 | 130,765 | 86 | 64 of 130 |
| 86 (`RestartOnReset`) | 65 | 1,310 | 463 | 9,778 | 12,087 | 80 | **9,558 of 9,778** |

Entry 0 is **1.6–3% of the whole solve** (~2–5 s of ~170 s). The
`CombinationGenerator` does take over on it, but rarely — 1 of 12 searches in
`Upstream`, 0 in the three later attempts — while it is live in 9,558 of 9,778
searches on the 65-face entry 86 that the 9,810 cheap iterations re-test. Entries
51 + 11 + 29 + 10 are **80% of the `RestartOnReset` attempt**, and what they share
is not size but a high quadruple count *and* a high call count. **Subface size is
a weak predictor of cost; conditions per subface is a strong one** — which is the
same conclusion Round 14 reached from guide density, by a different route.

**Top three cost centres, and what each costs to fix.**

1. **The unpruned, unclosed instance — Round 14's missing `removeMode` call.**
   It sets both factors of the product: 1,336,961 permutations instead of ~1, at
   80–478 µs each instead of microseconds. Fix and its risks are Round 14's; the
   number this round adds is that the pass costs 223.9 ms on the flat model,
   ~0.2% of the current budget.
2. **SipHash in the penetration checks — 52.1% of CPU.** Fix:
   `face_id_map: HashMap<usize, usize>` becomes a dense `Vec` over the subface's
   local face range (or each condition's four faces are resolved to digits once,
   when `set_guide_map` runs), and `triple_conditions: HashMap<usize, Vec<_>>`
   becomes a `Vec<Vec<_>>` indexed by local face index. ~40–60 lines in
   `permutation.rs`, purely representational, **no semantic change** — the only
   one of the three that cannot move a verdict, so the folding oracle staying
   29/29 is the whole gate. Expect ~2× on the search with every answer unchanged.
   Worth landing on its own merits whatever happens to (1): it is shared with the
   flat path and needs no `Completeness` opt-in.
3. **`Completeness::RestartOnReset` — 74.4% of the wall clock**, 10,001 of 10,495
   outer iterations, terminating on its budget rather than on a search. The
   cheapest adjacent win is attempt 3, a byte-identical repeat of attempt 2 here
   costing 10.9% for zero information. Gating attempt 4 on component size or
   condition count is one line plus a threshold nothing in the data yet justifies.
   Neither is free: `RestartOnReset` is what took `cant_fold` 4/21 → 21/21 (R11).

**Ordering note for whoever lands these.** (1) and (3) interact — if the AEA pass
collapses `valid_count` the way it does on the flat model, `RestartOnReset` may
never be reached, and any threshold chosen now would be fitted to an instance
that no longer exists. (2) is independent of both.

**Gate.** None run: nothing behaviour-changing was applied, the probe additions
were default-off and are gone, and the tree is byte-identical to the baseline this
round started from.


### Round 17 — is the verdict true, and where is the 3D structure? (2026-08-29)

**Answer: the 3D structure is not the problem, and the shipped 3D path returns a
false negative on a model with zero non-flat creases. Our 3D order path, run on
`full_iguana_flat_working.fold` — the all-±180 twin that the shipped flat path
folds in 779 ms — takes 242,596 ms and returns
`SearchExhausted { component: 0, iterations: 10001 }`.** *Measured.* Same
`Fold3dOrderEnumerator::with_cells` the product uses, on a real file, through
`admit_with` → `census_placement` → `cell_index`. Run independently of Rounds 14
and 15 and agreeing with them on the root cause; the numbers below are the ones
those rounds do not carry.

**The 70x is not "7% more faces". It is ~310x of path overhead on zero 3D
features.**

| same design, 1,132 faces | shipped FLAT path | our 3D order path |
| --- | --- | --- |
| result | **folds, 779 ms** | **`SearchExhausted`, 242,596 ms** |
| faces / ordering variables | 1,132 / 54,656 | 1,132 / 54,656 |
| initial hierarchy | 2,042 relations | **2,042, pair for pair identical** |
| …direction disagreements | — | **0 of 2,042** |
| subfaces the search prioritises | 632 cells → 200 reduced | 632 cells → **200** maximal |
| …set-for-set overlap | — | **200 of 200, both directions** |
| max subface | 103 | 103 |
| conditions | 57,351 / 16,080 | 59,391 / 17,020 |

`initial_hierarchy_3d` and `initial_hierarchy_from_graph` therefore agree exactly
on an all-flat model, and `cells.rs`'s maximal covering sets are *literally the
same 200 sets* as `configure_subfaces`'s reduced ones. The instances are the same
instance — until the hierarchy handed over is closed, which Round 14 names.

**The 2x2 that isolates it, one search function, same 632 subfaces, same file.**
`possible_overlap_search_for_subfaces_with_swap`, varying only the hierarchy and
whose conditions:

| hierarchy | conditions | relations the search starts from | result |
| --- | --- | --- | --- |
| AEA-closed | flat's 57,351/16,080 | 54,484 | **`found = true`, 67 ms** |
| AEA-closed | **3D's** 59,391/17,020 | 54,484 | **`found = true`, 69 ms** |
| raw seeds | flat's | 2,042 | **`found = false`, 1,653 ms** |
| raw seeds | **3D's** | 2,042 | **`found = false`, 1,085 ms** |

The condition set moves the answer by 2 ms. The closure is the whole difference.
Independent confirmation of Round 14's counterfactual from the public API only
(`additional_estimation_from_segments` vs `initial_hierarchy_from_segments`).

**Seed coverage, both files.** Distinct ordering variables the hierarchy decides
before the search: **7,049 of 50,713 (13.9%)** on the non-flat file, **2,042 of
54,656 (3.7%)** on the flat file, against the flat path's **54,484 of 54,656
(99.7%)**.

**Q1 — where the 3D structure is. It is 27 copies of one tiny feature on 8% of
the sheet.** `full_iguana_non_flat_failing.fold`, starting face 1: 2,264 segments
= 1,988 at ±180, **162 non-flat** (108 at −90, 54 at +90), 114 non-creases.
4 planes: **1,051 faces in plane 0, exactly 54 in each of planes 1/2/3**, and
every non-flat crease joins plane 0 to one of the other three, 54 each. Union-find
over shared endpoints gives **27 clusters of exactly 6 creases**, each touching
exactly 12 faces, each inside a 12.5 × 12.5 box on a 400 × 400 sheet; their
common bounding box is 62.5 × 212.5 = **8.3% of the sheet area**. Dual-graph
distance from a non-flat-incident face: d0 **306**, ≤1 450, ≤2 504 (41.5%), and
**587 faces (48%) are at distance > 4**.

**Q2 — the constraint mass is flat work.** Of 50,713 census pairs, **42,594
(84.0%) have neither face incident to a non-flat crease** (7,538 one, 581 both).
Of 50,980 triples, **78.9% are pure flat**; only 204 have all four faces touched.
Of 16,540 quads, **84.6% are pure flat**; 49 all-touched.

**Q3 — wall seeds are proportionate, and they are load-*lightening*.**
`pierce_constraint`'s `(true,false)|(false,true)` arm pushes exactly one seed per
(crease, plane-of-one-of-its-faces, pierced face), so the unit is the
**(crease, pierced face) pair** — as the ratio suggested. Measured: 4,958 wall
seeds from **162 of 162** non-flat creases, **0 from a flat crease**, min 1,
median 26, mean 30.6, max 96. They collapse to **4,951 distinct relations**, and
**4,951 of 4,951 are census ordering variables** — so the wall rule *determines*
9.8% of the variable set outright. 4,958 is not disproportionate and is not cost.

**Q4 — shrinking finds no small failing sub-model; it finds the opposite.** A
sub-CP was emitted from whole arrangement faces (interior ring edges keep their
colour and fold magnitude, cut edges become `Black0`), verified faithful: the
all-faces emission reproduces 1,213 faces / 2,264 segments / 50,713 pairs / 192
subfaces / max subface 103 and the same
`SearchExhausted { component: 0, iterations: 10001 }` at 126,828 ms. Every row
below keeps **all 162 non-flat creases**:

| region | faces | pairs | max subface | result |
| --- | --- | --- | --- | --- |
| box −40,−140 .. 40,100 | 451 | 1,448 | 7 | **folds, 223 ms**, 0 undetermined |
| dual ball r=2 | 504 | 2,693 | 12 | **folds, 195 ms** |
| r=3 | 562 | 4,021 | 16 | **folds, 500 ms** |
| r=4 | 626 | 6,819 | 24 | **folds, 332 ms** |
| r=7 | 833 | 18,933 | 45 | **folds, 23,976 ms** |
| r=8 | 905 | 24,685 | 57 | not settled in 45 s |
| r=12 | 1,151 | 46,393 | 98 | not settled in 45 s |
| all | 1,213 | 50,713 | 103 | fails, 126,828 ms |

So the entire 3D feature set — all 27 clusters, all 162 creases — is layer-ordered
in **195 ms** once the surrounding flat paper is cut away, and cost rises
monotonically with the amount of *flat* paper added back. There is no small
failing sub-model to find. (r=5, 6, 10 refuse at `InteriorCut` — a cut leaves a
T-vertex the admission gate rejects. Harness limitation, not a result.)

**Refuted here, do not re-run:**

- *Max subface 103 is the outlier that explains the cost.* No: the flat twin has
  **max subface 103 as well** and folds in 779 ms. Round 14 says the same from the
  other direction.
- *The 3D structure — the 162 non-flat creases, the 4 planes, the couplings — is
  what defeats the search.* No: the search fails on the same design with **zero**
  non-flat creases, one plane and zero couplings.
- *Wall seeds are a disproportionate cost from a small feature.* No: one per
  (crease, pierced face), and all 4,951 distinct ones are determinations of real
  ordering variables.
- *A minimal failing sub-pattern will localise the defect.* No: every sub-pattern
  containing the whole 3D feature and less than ~70% of the sheet folds, most of
  them in well under a second.

**Q5 — is the verdict true?** The shipped verdict on this file is already
`SearchExhausted`, not `NoLayerOrder`, so nothing is currently *claiming* the
pattern has no layer order. And the false-negative claim no longer needs a
witness on the non-flat file: the same code path returns the same
`SearchExhausted` on a model whose layer order the flat path exhibits in 779 ms.
**The 3D order path is demonstrably incomplete at iguana scale, on flat input.**
Whether the non-flat file has a layer order is still open, but it is no longer the
question that has to be answered first.

**What this leaves.** Exactly Round 14's next step, now with an
independently-measured payoff and one addition: the AEA pass belongs in
`build_enumerator`, and the *regression test that would have caught this* is
cheap and has a committed-file subject — run any all-classic document through
`Fold3dOrderEnumerator` and assert it agrees with `FoldingEstimateSession`. The
3D path accepts all-±180 input (it is what `full_iguana_flat_working.fold` is),
so a flat model is a legitimate, and now known-discriminating, 3D fixture.

**Instrumentation:** none in `src/`. One example,
`crates/oristudio-cp/examples/y3dstruct.rs` (structure census, sub-pattern
emitter, the 2x2, deadline-cancellation via a `CancelSource` that fires on wall
clock), built once with `--release`. **Removed and not preserved**; `git diff`
carries none of it and the tree is byte-identical to the 643-line baseline this
round started from. The two reusable pieces are each ~40 lines and worth
rebuilding rather than hunting for:

- **Wall-clock cancellation.** `impl CancelSource for Deadline { fn
  cancelled_run(&self) -> u32 { if Instant::now() >= self.until { self.run } else
  { 0 } } }`, installed with `cancel::bind`. Gives an in-process timeout that
  comes back as `Cancelled` through the normal error path, so a whole ladder of
  candidates runs in one process. Caveat: it lands only at a `cancel::check`
  site, and one outer iteration of the 3D search on a 1,213-face component can
  run for minutes without reaching one — a 90 s deadline overran to 12 min once.
- **The sub-pattern emitter.** Take a face subset of `placement.rings`, count how
  many chosen faces use each undirected ring edge `(u, v)`, emit count-2 edges
  with the colour and `fold_magnitude` of the input segment whose
  `line_vertex_ends` is that pair and count-1 edges as `Black0`, points from
  `placement.points`. Verified faithful: the all-faces emission reproduces the
  instance and the verdict exactly. Keep the largest dual-connected component of
  the selection or `admit_with` refuses `Disconnected`.

**Timing caveat.** A parallel session was solving during part of this window. The
126,828 ms non-flat run sits close to the documented 113,030 ms, so contention was
mild there; treat 242,596 ms as an upper bound. The verdict, the iteration count
(10,001 = `FOLD_3D_RESTART_BUDGET`) and every structural count above are
contention-independent.

**Gate.** None run: nothing behaviour-changing was applied and the probe is gone.

### Round 19 — the AEA lever, landed and gated (2026-08-29)

**Numbered 19 because Rounds 14–17 were written by four parallel sessions and 18
was likely to collide.** A fifth session landed the setup-time
additional-estimation call in `folding3d/order.rs` while this one was writing its
own copy of it; that call is the subject here, not this session's work. **The
lever holds. It is a bigger win than Round 14 projected, no regression survives
the gate, and a second implementation agrees the answers are real.** *Measured.*

**The change**, ~74 lines over two files, all of it a call site:
`folding.rs::close_hierarchy_with_removal` (`pub(crate)`, 29 lines) runs the same
`AdditionalEstimation::run_with_removal` the flat path already runs in
`overlap_enumerator_from_segments`, over a caller-supplied face-id list instead of
a `SubFaceConfiguration`; `folding3d/order.rs::close_component_hierarchy` (45
lines) calls it from `Builder::localise`, so the closure happens **once per
component in `plan`** and `ComponentSolver::restart`'s rebuild replays the same
stream. On `AdditionalEstimationError::Contradiction` the pass is **discarded**
and the raw seeds go to the search exactly as today — the cut relations that
scaffold a coupling subface are a tie-break, not geometry, so a contradiction
among them is not a claim about the user's paper. Only a cancel escapes.

**Before / after**, same machine, same session, load 5–8 (`zzz_verify`, built
`--release`, now deleted):

| file | before | after |
| --- | --- | --- |
| `full_iguana_non_flat_failing.fold` sf=1 | 71,252 ms, `SearchExhausted{component:0, iterations:10001}` | **577 ms, `Folded`** |
| …all 21 starting faces | 0 / 20 | **21 / 21**, worst **593 ms** |
| `full_iguana.fold` (the original) | 0 / 20, ~80 s | **20 / 20**, worst **570 ms** |
| `cant_fold.fold` | 21 / 21, worst 2,230 ms | **21 / 21**, worst **30 ms** |
| `failed_layer_ordering.fold` | 21 / 21, worst 626 ms | **21 / 21**, worst **20 ms** |
| `successful_layer_ordering.fold` | 21 / 21, worst 86 ms | **21 / 21**, worst **16 ms** |
| `stick on a floor - failure.osf` | 0 / 2, 620 ms | **0 / 2**, 332 ms — *unchanged verdict* |

123× on the subject file and ~12× inside the owner's 10 s target, with every
starting face landing in the same 546–593 ms band — the starting-face spread that
started this investigation is gone on this model. The three regression sweeps
each got 2–74× faster and none lost a face. `stick on a floor` is untouched:
same `NoLayerOrder { component: 0, faces: 523, variables: 29911 }` at both faces,
so it is a different disease, as Round 14 suspected.

**Baseline provenance.** The "before" column was measured in this session on the
same binary path, and reproduces the documented shape exactly (`SearchExhausted`
at 10,001 iterations; 21/21 at 86 / 626 / 2,230 ms against the log's 85 / 623 /
2,368 ms). The absolute 71,252 ms is below the documented 113,030 ms because this
machine was quieter, not because the instance changed — the flat twin ran 637 ms
here against its documented 1,599 ms, the same direction.

**The answer is not just faster, it is checked.** `interleavings` — the backward
re-derivation that ranks each slot's faces from the finished relations alone and
shares neither the winding sign nor the condition roles the forward generator is
built on, and shares *nothing* with the closure under test — reports **0
crossings** on every ordering produced:

| file | relations | undetermined | forward crossings | **backward crossings** |
| --- | --- | --- | --- | --- |
| `full_iguana_non_flat_failing` sf=1–4 | 50,713 | 0 | 0 | **0** |
| `full_iguana` sf=1–3 | 50,713 | 0 | 0 | **0** |
| `cant_fold` sf=1–4 | 3,776 | 0 | 0 | **0** |
| `failed_layer_ordering` sf=1–4 | 2,324 | 0 | 0 | **0** |
| `successful_layer_ordering` sf=1–4 | 2,289 | 0 | 0 | **0** |

The checker's `Unordered` count is 0–1,791 and swings with the starting face on
files that folded before the change too (`cant_fold` sf=1 105, sf=2 3), so it is
the checker's four-endpoint ranking rule declining on non-census pairs, not a
signal about the closure.

**The closure does not over-determine.** The obvious way an eager closure buys
speed dishonestly is by deciding pairs the paper leaves free, collapsing a real
multi-state model to one answer. It does not: `Fold3dOrderEnumerator::advance`
still returns `Next` with a *different* relation set on `full_iguana_non_flat_failing`
(sf=1 and sf=2) and on `cant_fold`, and still returns `WrappedToFirst` on
`successful_layer_ordering`, which has one state and always did.
`a_paper_tube_has_two_states_and_cycles_between_them` — two real answers, flap
tucked in or left out — passes unchanged.

**The per-plane trap does not bite.** The 1×4 strip at (−90, +180, +90) is pinned
by `the_coupled_strip_is_solved_across_its_two_planes` (both mirror images: one
component of 2, unique solution, `advance` wraps to the identical relations) and
`the_coupled_strips_second_plane_is_decided_only_by_the_coupling`. Both pass. And
the mechanism is intact by construction: transitivity inside a coupling's
synthetic 4-face subface can never carry an inference across the two planes,
because the four cut relations put *both* faces of the first pair above *both*
faces of the second, so no chain ever links `(a,b)` to `(c,d)`. The coupling still
does its work through its quadruple condition, which `check_quad` reads with the
same role assignment the search's `apply_quadruple_condition` does.

**Gate — six numbers, all run:**

| check | result |
| --- | --- |
| `cant_fold.fold` sweep | **21 / 21** |
| `failed_layer_ordering.fold` sweep | **21 / 21** |
| `successful_layer_ordering.fold` sweep | **21 / 21** |
| `cargo test -p oristudio-cp --release` | **975 passed, 0 failed** |
| Oriedita **folding** oracle, `ORIEDITA_GEOMETRY_ORACLE` set | **29 / 29** (11.0 s — it ran, it did not skip green) |
| Oriedita **render** oracle, same env | **13 / 13** (25.8 s) |

`rustfmt --check` is clean on both changed files, and `cargo clippy -p
oristudio-cp --lib` reports nothing against them. (The workspace-wide `cargo fmt
--check` and `--all-targets` clippy both fail, but only inside other sessions'
throwaway `examples/` — `flat93.rs` formatting and a `fold3d_components.rs` logic
lint. Neither is in `src/`.)

**Why this is safe to land in the shared file.** `close_hierarchy_with_removal` is
`pub(crate)` and additive: the flat path keeps calling
`run_additional_estimation_remove` and reaches the same algorithm by the same
arguments, which is why the folding oracle is still 29/29. Unlike
`resetting_generators_on_swap` / `with_sound_backjump` /
`restarting_generators_on_reset`, it needs **no 3D-only opt-in flag**, because it
changes no shared behaviour — it is a second *caller*, not a second mode.

**What is still not measured.**

- **Whether the contradiction fallback ever fires.** If it does, that model
  silently keeps today's behaviour and today's cost. Nothing observable from
  outside distinguishes "closed" from "fell back"; `stick on a floor` got 1.9×
  faster and kept its verdict, which is consistent with either. A counter on the
  fallback arm is the cheap fix and it should ship with the change.
- **Whether the *chosen* ordering changed on files that already folded.** All
  three keep their relation counts and `undetermined = 0`, and both orderings pass
  `interleavings`, but no pre/post relation-set diff was run — that needed a
  pre-change binary, and building one meant editing a file another session was
  actively holding.
- **The AEA's own cost, isolated.** It is inside a 570 ms total that was 71 s, so
  Round 14's `O(k³)`-at-`k=103` worry is answered in aggregate, but the pass was
  not timed on its own.
- **`stick on a floor` is untouched and still unexplained.** 0/2 before, 0/2
  after.
- **The wasm bridge was not rebuilt**, so nothing here has been seen in a browser.
  `npm --workspace @treemaker/web run build:oristudio-cp-wasm` before trusting the
  app.

**Contamination note.** Four other sessions were editing `src/` and running solves
in this worktree throughout. `folding/permutation.rs` gained and lost an
env-gated `ZPERF` probe twice during the window; every binary here was built with
`FOLD3D_ZPERF` unset and copied out of `target/` before use, and `permutation.rs`
carries **no** representational change (the SipHash lever Round 16 proposes is not
in the tree), so the speed-up is attributable to the AEA call and nothing else.
Load averages are recorded beside each timing run: 5–8 throughout, against the
105–233 that inflated Rounds 14–17.

**Instrumentation:** none in `src/`. One example, `examples/zzz_verify.rs`
(starting-face sweeps, the flat control, and the `interleavings` re-derivation),
**deleted**; a copy is at `<scratchpad>/zzz_verify.rs.saved`.


### Round 20 — the SipHash lever, adversarially A/B'd after Round 19 (2026-08-29)

**Answer: it is sound and it is now nearly worthless. Round 16's fix is real,
semantically neutral over 86 solves, and passes the whole gate — but Round 19
removed the work it was going to speed up. The only file it still moves is
`stick on a floor - failure.osf`, 2.0×, verdict unchanged.** *Measured.* The
lever is Round 16 item 2: `SubFacePermutationSearch`'s `face_id_map` and
`triple_conditions` hash lookups in the penetration checks, replaced by local
indices resolved once in `set_guide_map`.

**Read this round for the method, not the win.** The first A/B I ran said **44×**
on `cant_fold`. It was wrong: Round 19's AEA call landed in `folding3d/order.rs`
*between* my baseline build (11:38) and my lever build (11:47), so the "lever"
binary carried someone else's fix. Every number below comes from two binaries
built minutes apart from the same tree with `folding.rs`, `folding3d/order.rs`
and `folding/combination.rs` md5-pinned across the whole measurement window, the
baseline being a **textual reversal** of my own edit (`git diff` on
`permutation.rs` back to its 417-insertion baseline). In a worktree with four
live sessions, a saved binary is a claim about a tree that no longer exists.

**The A/B, current tree, load 5–14, three to six repeats per cell.** Worst
starting face, `--features fold-profiling` on both sides:

| subject | baseline (no lever) | with lever | effect |
| --- | --- | --- | --- |
| `stick on a floor - failure.osf` (2 faces) | 627, 630, 635, 648, 652, 699 ms | **317, 318, 320, 325, 327, 328 ms** | **2.0×** |
| `cant_fold.fold` (21 faces) | 30, 30, 33 ms | 30, 33, 36 ms | none |
| `failed_layer_ordering.fold` (21) | 17, 17, 17 ms | 17, 18, 24 ms | none |
| `successful_layer_ordering.fold` (21) | 17, 17, 17 ms | 17, 17, 28 ms | none |
| `full_iguana_non_flat_failing.fold` sf=1 | 554, 556, 560 ms | 558, 560, 571 ms | none |
| `full_iguana.fold` sf=1–3 | 550–574 ms | 562–567 ms | none |
| flat twin via `FoldingEstimateSession` sf=1 | 641, 646, 648 ms | 641, 643, 647 ms | none — **no flat regression** |

**Why it collapsed to one file, from the counters.** After Round 19 the AEA pass
leaves the search almost nothing to do, and the penetration checks are linear in
conditions-per-subface (R16), so there is nothing to remove:

| file | subfaces | max subface | triples | quads | outer iters | perm advances |
| --- | --- | --- | --- | --- | --- | --- |
| `cant_fold` sf=1 | 50 | 8 | **10** | **177** | 6 | 6 |
| `full_iguana_non_flat_failing` sf=1 | 292 | 103 | **193** | **3,706** | **2** | **2** |
| `stick on a floor` sf=1 | **2,269** | **123** | **25,670** | **12,028** | **24** | **20** |

`stick on a floor` is the one instance the closure does *not* collapse — which is
the same reason it is still 0/2. **The lever's remaining value is a bet on the
open file, not a win on the closed ones.**

**Soundness: 86 solves, byte-identical.** Every one of `cant_fold`,
`failed_layer_ordering`, `successful_layer_ordering` and `full_iguana` at all 21
starting faces, plus `stick on a floor` at both, compared field for field with
timings stripped: verdict, an FNV-1a hash of `render_model().cell_stack` (the
solved layer order itself), `undetermined_pairs`, `discovered_fold_cases`,
`has_next_solution`, the component list, and all nine `fold_profiling` counters
(`outer_iters`, `inconsistent_requests`, `table_from_initial`, `perm_advances`,
`realtime`, `fast_realtime`, `add_est_passes`, `triple_cond`, `quad_cond`).
**Zero differences.** The search visits the same states in the same order and
returns the same stack; only the clock moves.

That is the argument the code makes too. `to_local` is `fast_contains` and the
resolution in one pass — it returns `None` for exactly the conditions
`fast_contains` rejected. The bucket index is the local index of the same `a`
face upstream keys by. `equivalence_conditions()` still emits in `face_ids` order
and `u_equivalence_conditions()` still sorts on **global** ids, so the
`CombinationGenerator` sees byte-identical input. The one assumption is that a
subface's `face_ids` holds no duplicate id; all three construction sites give
that — `configure_subfaces` enumerates `face_polygons` positions, the coupling
subfaces `sort_unstable().dedup()`, and `Builder::localise` maps injectively.

**Gate — six numbers, all run, with the lever installed:**

| check | result |
| --- | --- |
| `cant_fold.fold` | **21 / 21** |
| `failed_layer_ordering.fold` | **21 / 21** |
| `successful_layer_ordering.fold` | **21 / 21** |
| `cargo test -p oristudio-cp --release` | **975 passed, 0 failed** |
| Oriedita folding oracle, `ORIEDITA_GEOMETRY_ORACLE` set | **29 / 29 in 13.4 s** |
| Oriedita render oracle, same | **13 / 13 in 25.2 s** |

The env var was verified to matter: without it the same 29 tests "pass" in
**0.00 s**. `cargo clippy -p oristudio-cp --lib` and `rustfmt --check` are clean
on `permutation.rs` for this change (one `collapsible_if` was fixed; the
remaining `sort_by_key` warning at line 88 and the fmt diff at line 151 are in
another session's `ZPERF` probe). The 1×4 strip counterexample —
`the_coupled_strip_is_solved_across_its_two_planes`,
`the_coupled_strips_second_plane_is_decided_only_by_the_coupling`,
`the_coupled_strip_reports_two_planes_and_one_coupled_folded_line` — passes, and
is vacuous here: this change decomposes nothing and skips no work.

**A number in Round 19 needs re-measuring.** Its table gives `stick on a floor`
as 620 ms → **332 ms** after the AEA call. On this tree, with `folding.rs` and
`folding3d/order.rs` md5-pinned, AEA **without** this lever measures 627–699 ms
over six runs and AEA **with** it measures 317–328 ms. 332 ms sits in the second
band and 2× outside the first. Round 19's contamination note says the lever "is
not in the tree", and it was not at 11:38–11:46 — but it was from 11:47 onward,
which is inside the window its later runs fall in. Two readings survive: its
`stick` row was built against this uncommitted lever, or `folding.rs` /
`order.rs` changed again afterwards. **What is measured either way is that the
AEA pass alone does not make `stick on a floor` 2× faster; this does.** Nothing
else in the Round 19 table is affected — `cant_fold` 30 ms, `failed` 20 ms,
`successful` 16 ms and the two iguanas all reproduce on the no-lever baseline.

**Round 16's own projection, checked.** "Expect ~2× on the search" is right where
a search still runs (`stick`, 2.0×) and irrelevant where one no longer does. The
44× I first saw was Round 19, not this. Its cost estimate of "~40–60 lines" is
low: the real diff is **80 added, 39 removed** in `permutation.rs`, net +41.

**Status of the change.** Left **in the tree**, on top of the Round 19 baseline;
`permutation.rs` is now +536 / −66 against `HEAD`, of which +119 / −39 is this.
The isolated patch is at `<scratchpad>/lever.patch` with the pre-lever file at
`<scratchpad>/permutation_BASE.rs`, so it reverses in one `cp`. It is in the
**shared** Oriedita path, and deliberately carries no `Completeness` opt-in: it
changes no behaviour to opt into, and the flat measurement above shows no
regression there. If it lands, the pinning test is the identity check this round
ran — the folding oracle at 29/29 is the real gate, and
`worker_overlap_search_with_swap_matches_oriedita_oracle` plus
`combination_generator_sweep_matches_oriedita_oracle` are the two that would
catch a botched resolution.

**Instrumentation:** none in `src/` beyond the lever itself. One example,
`examples/zvq_lever.rs`, **deleted**; a copy is at
`<scratchpad>/zvq_lever.rs.saved`. No background process was started.

### Round 21 — adversarial A/B of the AEA lever, in a frozen tree (2026-08-29)

**Answer: the lever survives. It is the AEA call and not the concurrent SipHash
change that does the work, the produced stacks are checked against the
constraint system itself and not only against `interleavings`, and the three
things Round 19 left unmeasured are measured here: the fallback fires on real
files, the chosen ordering moves on exactly one file by exactly 9 pairs, and the
pass costs 24 ms.** *Measured.* Independent session, same landed change
(`close_hierarchy_with_removal` + `close_component_hierarchy`); this round adds
no code.

**Method: a frozen snapshot, because a shared worktree is not a control.**
Four sessions were editing `src/` during this window and `folding/permutation.rs`
changed under me twice — once mid-build, once between my baseline binary and my
treatment binary, which is exactly the trap Round 20 documents. So the whole A/B
was run inside an APFS clone of `crates/` + `tests/` + `tools/` +
`Cargo.{toml,lock}` in the scratchpad with its own target dir (51 MB, ~10 s a
rebuild). Both arms differ by **one line** — the `close_component_hierarchy` call
in `Builder::localise`, textually removed for the baseline — over a byte-identical
copy of everything else, `permutation.rs` included. Every number below is from
that pair, load 5–8. The tree was restored to the treatment afterwards and the
harness deleted.

**How much of the win is the AEA call, separated from Round 20's lever.** The
same file, three binaries:

| binary | `full_iguana_non_flat_failing.fold` sf=1 |
| --- | --- |
| real tree at 11:39, **before** the SipHash change, no AEA | 73,877 ms, `SearchExhausted{10001}` |
| frozen snapshot, **with** SipHash, no AEA | **16,862 ms**, `SearchExhausted{10001}` |
| frozen snapshot, with SipHash, **with AEA** | **584 ms, `Folded`** |

So SipHash alone is ~4.4× and leaves the verdict wrong; **AEA is 28.9× on top of
it and flips the verdict**. Independently consistent with Round 20's finding that
the two are not additive — measured from the other side, before the AEA landed.

**Round 19's open item 1 — does the contradiction fallback fire? Yes, on two
files, and it explains `stick on a floor`.** A temporary `eprintln` on both arms
of the match (in the frozen tree only):

| file | AEA closed | **fell back** |
| --- | --- | --- |
| `cant_fold.fold`, 21 faces | 23 | **0** |
| `failed_layer_ordering.fold`, 21 | 21 | **0** |
| `successful_layer_ordering.fold`, 21 | 21 | **0** |
| `spikes_large.fold`, 21 | 21 | **0** |
| `full_iguana_non_flat_failing.fold` sf=1 | 1 | **0** |
| `stick on a floor - failure.osf`, 21 | 10 | **11** |
| `impossible_folds/impossible_3d_shape.osf`, 21 | 0 | **21** |

**Nothing that folds ever falls back**, and both files that do keep today's exact
verdict — which is the fallback doing its job. It also sharpens Round 20: when
the pass *does* close on `stick`, conditions go `(25,876, 12,359) → (607, 308)`;
Round 20 records `(25,670, 12,028)` at sf=1, i.e. the **raw** shape. So sf=1 on
that file is a *discard*, not a closure that failed to collapse. `stick on a
floor` is not one disease but two, and its `Contradiction` is starting-face
dependent — 11 of 21 — so it is a frame artifact (see the `extents_overlap` and
non-equivariant-frame entries) and not a claim about the paper. Discarding it
rather than routing it to a verdict was the right call.

**Round 19's open item 2 — did the chosen ordering change on files that already
folded? On one file, by 9 pairs of 3,776.** Both arms dumped their relation sets;
compared pair for pair:

| file | pairs | same | **flipped** | only in one arm |
| --- | --- | --- | --- | --- |
| `cant_fold.fold` sf=1, 2, 3 | 3,776 | 3,767 | **9** | 0 |
| `failed_layer_ordering.fold`, 21 faces | 2,324 | all | **0** | 0 |
| `successful_layer_ordering.fold`, 21 | 2,289 | all | **0** | 0 |
| `spikes_large` / `spikes_small` / `hinge_90` / `box_90` / `box_90_unangled`, 21 each | — | all | **0** | 0 |

The same 9 pairs at every starting face, and both orderings pass every check
below. It is a different member of the solution set, not a wrong one — but it is
user-visible: `cant_fold`'s rendered stack differs in 9 face pairs from what
shipped yesterday.

**Round 19's open item 3 — the pass's own cost. 24 ms, on the worst instance in
the corpus.** `full_iguana_non_flat_failing.fold` sf=1, one component:
relations **7,506 → 50,920**, conditions **(50,980 triples, 16,640 quads) →
(193, 3,706)**, in **24 ms**. Everything else is ≤12 ms (`cant_fold` 12 ms,
`failed_layer_ordering` 3 ms, `spikes_large` 0 ms). Round 14's `O(k³)`-at-`k=103`
worry is answered directly, not in aggregate.

**A second, independent soundness axis: the constraint system itself.** Round 19
checked the answers with `interleavings`, which re-derives from geometry. This
round checks them against the conditions, using the shipped semantics rather than
a reimplementation (log R2): build a `HierarchyTable` from the **finished**
ordering and run `AdditionalEstimation::run` over the **original, pre-AEA**
condition set. Any violated condition makes `check_triple`/`check_quad` try to set
the opposite relation and `infer_above` rejects it as a `Contradiction`.

| file | raw conditions audited | result |
| --- | --- | --- |
| `full_iguana_non_flat_failing` sf=1–3 | 50,980 + 16,640 | **PASS**, `inferred_beyond = 0` |
| `cant_fold`, 21 faces (44 solves) | — | **PASS**, 0 violations |
| `failed_layer_ordering` / `successful_layer_ordering` / `spikes_large` / `box_90`, 21 each | — | **PASS**, 0 violations |

`inferred_beyond = 0` is the strong form: the finished stack is already a
fixpoint of the whole condition set, so the closure added nothing the search
would have had to undo. Separately, over all 21 iguana faces the ordering has
**50,713 relations, 0 undetermined, 0 crossings, 0 antisymmetry violations, 0 of
7,208–7,249 seed violations and 0 of 170–227 coupling violations**. Seeds and
couplings are direct geometric determinations, not derived, so this is a check
against ground truth and not only against internal consistency.

**The per-plane trap, run both ways.** `strip(&[-90, 180, +90])` and its mirror,
driven through `Fold3dOrderEnumerator` with the couplings and seeds checked
explicitly: **byte-identical between the two arms** — `planes=2 vars=2
couplings=1 components=[2] undetermined=0 unique_solution=true
violations=0 relations=[(1,0), (3,2)]` for both signs. Ladders at 90×3, 90×4 and
90×8 are identical too. The trap case is not merely still-passing; the answer
does not move at all.

**Round 17's discriminating case, now a fix rather than a bug.** The all-±180
twin pushed through the 3D path:

| `full_iguana_flat_working.fold` sf=1 via `Fold3dSession` | baseline | with AEA |
| --- | --- | --- |
| | 270,876 ms, `SearchExhausted{component:0, iterations:1000001}` | **681 ms, `Folded`** |

398×, and the failure mode is `FOLD_3D_ITERATION_BUDGET`, not the restart budget.
Verified: 54,656 relations, 0 undetermined, 0 crossings, **all 2,042 seeds
satisfied with 0 missing**, same ordering at sf=1, 2, 3. The flat path's own
result on that file is unchanged (`Solved`, 1 case, 632 vs 642 ms across arms) —
as it must be, since the new function is `pub(crate)` and no flat caller reaches
it.

**The false-positive gate.** `impossible_folds/impossible_3d_shape.osf` stays
**0/4** in both arms, byte-identical, 0 ms. Nothing became foldable that was not.

**Gate, all six run in the frozen tree:**

| check | result |
| --- | --- |
| `cant_fold.fold` sweep | **21 / 21**, worst 346 → **33 ms** |
| `failed_layer_ordering.fold` sweep | **21 / 21**, worst 203 → **16 ms** |
| `successful_layer_ordering.fold` sweep | **21 / 21**, worst 33 → **17 ms** |
| `cargo test -p oristudio-cp --release` | **975 passed, 0 failed** |
| Oriedita **folding** oracle, `ORIEDITA_GEOMETRY_ORACLE` set | **29 / 29** (11.5 s — ran, did not skip) |
| Oriedita **render** oracle (+ geometry oracle) | **13 / 13** (24.2 s) and 1 / 1 |

`rustfmt --check` and `cargo clippy` report **nothing** against `folding.rs` or
`folding3d/order.rs`; both fail elsewhere, only inside other sessions' in-flight
`permutation.rs` and `examples/`. One suite failure during setup
(`the_walk_reproduces_the_flat_folder_face_by_face`) was a fixture my snapshot had
not copied (`packages/origami-simulator/tests/fixtures/`), not a regression.

**What is still not measured.**

- **`stick on a floor` remains 0/2**, and is now the only open file. Round 20 says
  the SipHash lever is worth 2× there and nothing anywhere else; this round adds
  that half its starting faces never get the closure at all. The next question for
  that file is why AEA contradicts on 11 of 21 frames.
- **No wasm rebuild, no browser.** `npm --workspace @treemaker/web run
  build:oristudio-cp-wasm` before trusting the app.
- **`cargo test --workspace` was not run**, only `-p oristudio-cp`. No other crate
  reaches `folding3d`.
- **The 9 flipped `cant_fold` pairs were not looked at individually** — only
  counted, and shown to satisfy every seed, coupling and condition.
- **Timings are from a snapshot tree at load 5–8.** The 73,877 ms pre-SipHash
  baseline is below the documented 113,030 ms for the same reason Round 19's
  71,252 ms is: a quieter machine, not a different instance.

**Instrumentation:** none surviving in `src/`. One example,
`crates/oristudio-cp/examples/zaea_probe.rs` (sweeps, the seed/coupling/
antisymmetry verifier, the relation dumper, the strip driver), **deleted**; a copy
is at `<scratchpad>/zaea_probe.rs.saved`. The fallback counter and the
condition auditor (`zaudit_conditions`, plus a `#[derive(Clone)]` on
`HierarchyTable`) existed **only in the scratchpad snapshot**, which has been
removed. No background process is still running.

### Round 22 — the 113 s explained, verified on a rebuilt tree (2026-08-29)

**Root cause: the 3D path never runs the setup-time `removeMode` AEA pass the flat
path runs.** `run_additional_estimation_remove` / `run_with_removal` had exactly one
caller, `folding.rs::overlap_enumerator_from_segments` — the flat path.
`folding3d/order.rs` called only `validate_initial_hierarchy`, which seeds a table
with `infer_above` (single cell, no transitivity) and throws it away.

Measured on the same design, face 1:

| | flat path | 3D path (before) |
| --- | --- | --- |
| relations entering the search | **54,484** | 7,506 |
| conditions after the pass | 142 triple + 75 quad | full set, up to 4,325 + 1,222 on ONE subface |
| outer iterations | **1** | 10,494 |
| permutation tests | 1 | 1,336,961 |

So the flat path arrives at the search with the problem already almost solved, and
the 3D path hands it the raw instance. Same `possible_overlapping_search` in both.

**Fix:** `folding.rs::close_hierarchy_with_removal` — the same
`AdditionalEstimation::run_with_removal` the flat path already runs, over a
caller-supplied subface set instead of a `SubFaceConfiguration` (3D subfaces come
from `cells.rs` and the coupling scaffolding and never pass through
`configure_subfaces`). Called once per component from `Builder::localise`. A
contradiction discards the pass and the raw seeds go to the search as before —
a contradiction between synthetic coupling scaffolding and a determination is not
a statement about the user's paper. One caller; the flat path is untouched.

**Measured, on a tree rebuilt from HEAD carrying only these changes:**

| file | before | after |
| --- | --- | --- |
| `full_iguana_non_flat_failing.fold` | 113,030 ms, `SearchExhausted` | **21/21, worst 1,057 ms** |
| `full_iguana.fold` | 0/20, ~80 s | **21/21, worst 900 ms** |
| `cant_fold.fold` | 21/21, worst 2,368 ms | 21/21, worst **114 ms** |
| `failed_layer_ordering.fold` | 21/21, worst 623 ms | 21/21, worst **44 ms** |
| `successful_layer_ordering.fold` | 21/21, worst 85 ms | 21/21, worst **62 ms** |
| `stick on a floor - failure.osf` | 0/2 | 0/2, 821 ms |

975 crate tests; folding oracle 29/29 and render oracle 13/13 with
`ORIEDITA_GEOMETRY_ORACLE` set; both per-plane-trap tests
(`the_coupled_strip_is_solved_across_its_two_planes`,
`the_coupled_strips_second_plane_is_decided_only_by_the_coupling`) pass.
`undetermined_pairs` is 0 on every folded solve.

**`full_iguana` was another false verdict.** It folds, and always could.

**Soundness note, unlike the earlier fixes.** This one ADDS relations the search
treats as given, so a wrong inference yields a WRONG ACCEPTED ANSWER rather than a
false negative. The sweeps cannot detect that; the per-plane trap tests and the
oracles are the real gate. It reuses the shipped Oriedita pass rather than
reimplementing it, which is what keeps it defensible.

**Profile that located it** (98% of the time was one function):
`SubFacePermutationSearch::possible_overlapping_search_with_table` 98.05%;
`HierarchyTable::from_initial` 0.35% despite rebuilding a 1,213² matrix per outer
iteration; `enter_stacking_into` 0.06% over 21.6M pairs;
`run_final_additional_estimation` **0 calls** — no prefix was ever consistent.
`sample` put 52.1% of all CPU in std SipHash on `HashMap<usize,_>` lookups in the
penetration checks. **The 103-face subface was NOT the cost** (1.6–3%); cost tracks
conditions-per-subface, not face count — entry 51 (85 faces, 1,014 quads) alone was
35% of an attempt.

**Not landed, deliberately:** replacing those SipHash maps with dense local
indexing measured ~4.4× on its own and is purely representational, so it cannot
change a verdict. It arrived tangled with an `eprintln!` profiling probe woven
through the hot loops at ~40 sites in Oriedita-ported code, and no clean base
existed, so `permutation.rs` was rebuilt from HEAD without it. Worth doing
deliberately as its own change.

**Process note:** this round was nearly lost. A user interrupt killed the first
workflow (four agents started, zero results), and orphaned harness processes were
found still running — one for an hour, one since 18 August, ten days. Parallel
agents also landed edits in the shared worktree mid-measurement, and one verifier's
first A/B was wrong because its "baseline" binary had silently picked up another
session's fix. Rebuild from HEAD and re-measure before believing any number from a
contended tree.

### Round 23 — `stick on a floor` is a false verdict too, and for a new reason (2026-08-29)

**It folds at 10 of 21 starting faces, and the failing frames' constraint
instances are provably unsatisfiable. So the search is telling the truth about
the instance it was handed, and the instance is wrong. This is the first file in
the investigation whose root cause is the *constraint derivation* rather than the
enumeration.** *Measured.*

**The "0 / 2" was a two-face sweep.** The shipped public API
(`order_placement`, no instrumentation), faces 0–20:

| | faces | ms |
| --- | --- | --- |
| **Folded** | 7, 8, 10, 11, 12, 13, 15, 16, 19, 20 — **10 of 21** | 185–263 |
| `NoLayerOrder` | 0, 1, 2, 3, 4, 5, 6, 9, 14, 17, 18 | 301–571 |

Every folded solve reports **29,911 relations, 0 undetermined, 0 crossings**. The
component is one 523-face / 29,911-variable block at every face, with 13 real cell
subfaces (123, 123, 112, 96, 89, 89, 60, 57, 57, 57, 57, 29, 29) and 2,256
synthetic coupling subfaces.

**The relaxations were unnecessary, and the reason is the finding.** Dropping
every coupling — no synthetic subfaces, no 9,024 cut relations, no 2,256 coupling
quadruples — leaves the pure geometric core, and at face 1 **Oriedita's own
setup-time AEA reaches `Contradiction { 166, 11 }` on it in 4 ms**. `run` makes
only forced inferences, so that is a proof the instance has no solution. Face 1's
`NoLayerOrder` is *correct about its instance*. Couplings are not the problem:

| face | full instance | geometric core only (no couplings at all) |
| --- | --- | --- |
| 0–6, 9 | AEA contradicts | AEA contradicts, **same pair** |
| 7, 8, 10 | closes, 12,415 → 34,303 relations | closes, 3,391 → 22,135 |

**The witness, and what it proves.** The face-7 solution transported by the
identity (face ids and the 29,911 census pairs are the same set at every frame)
into each failing frame's **full** instance:

| target frame | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 9 | 14 | 17 | 18 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| seed conflicts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| cut conflicts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| undecided variables | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| coupling quadruples satisfied | 2256/2256 | 2256 | 2256 | 2256 | 2256 | 2256 | 2256 | 2256 | 2014/2014 | 2256 | 2256 |
| shipped AEA over the frame's raw conditions | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |

So a complete assignment satisfies every determination, every cut and **every
coupling** at each failing frame, and is refused only by that frame's geometric
conditions. `interleavings` — the independent re-derivation from geometry — gives
**0 crossings** on that assignment at faces 0, 1, 6, 7, 9, 17, 18 (17–40
"unordered"), and 1 crossing at face 14, which is itself frame-dependence in the
checker.

**The derivation is not equivariant, and that is measurable directly.** Same
paper, same 523 faces, same 29,911 variables, per starting face:
triples **25,147–25,979**, geometric quads **9,292–10,610**, seeds 2,796–3,391,
couplings 1,877–2,256. Bisection over the shipped closure (which *is* monotone in
the condition set, unlike the search predicate of R1) isolates, at every failing
frame, **one single condition** the witness breaks — and in each case no
condition over those faces exists at face 7 at all, not even under other roles:

| frame | isolated condition | any face-7 condition over the same faces |
| --- | --- | --- |
| 0, 1, 9, 17, 18 | `quad a=9 b=11 c=169 d=168` | none |
| 6 | `triple a=446 b=269 c=446 d=271` | none |
| 14 | `triple a=449 b=269 c=449 d=271` | none |

Face 1's own instance shrinks to a **5-condition minimal UNSAT core** over 11
faces (325 closure tests, 1.8 s):

```text
triple a=185 b=9   c=185 d=11
quad   a=9   b=11  c=169 d=168
quad   a=182 b=184 c=166 d=183
quad   a=11  b=186 c=184 d=187
quad   a=184 b=183 c=168 d=166
```

The first of those is carried by exactly faces 0, 1, 2, 3, 4, 5, 9, 14, 17, 18 —
**ten of the eleven frames that fail, and none that fold**. The other four are
carried nearly everywhere, so it is that one condition's frame-dependent presence
that turns a satisfiable instance into an unsatisfiable one. Face 6 is the
exception that shows there is more than one such condition: it fails *without*
that triple, on the `446/269/271` one instead, which only faces 6, 11 and 16
carry.

Suspect mechanism, **read-from-code, not measured**: the two known-real
non-equivariant frame choices already logged — `canonical_direction` fixing a
line's sign by scanning **world** components against a 1e-12 bar, and
`extents_overlap` mixing frames — are exactly a mechanism for emitting a
taco-tortilla condition at some placements and not others. Confirming that for
these specific creases was not done.

**The ten folding frames agree with each other**, which is what a real solution
set looks like: face 8 shares all 34,167 of its pairs with face 7 with **0
flipped**; faces 10–20 share 33,769–34,535 with 64–176 flipped — different
members of the solution set, not different answers.

**Also measured, and actionable on its own:** the 4 ms proof of unsatisfiability
is **thrown away**. `close_component_hierarchy`'s discard-on-contradiction
fallback (Round 22) hands the raw seeds to the search, which then spends 301–571
ms rediscovering "no" by a route that is not a decision procedure. The discard is
the right *policy* while the derivation can emit a spurious condition — a
contradiction from a bad condition must not become a verdict — but it means the
contradiction is invisible, and it is the cheapest signal on this file by two
orders of magnitude.

**Gate:** 975 crate tests, Oriedita folding oracle **29 / 29 in 17.59 s** with
`ORIEDITA_GEOMETRY_ORACLE` actually set (it is 0.00 s without). No behaviour
change was made; this gates the probe.

**Instrumentation: all removed.** `#[doc(hidden)] debug_close_hierarchy` in
`folding.rs`, and `DebugComponent` / `Builder::debug_raw` / `debug_plan` /
`debug_solve` plus a `debug_out` parameter on `plan` in `folding3d/order.rs`, were
added default-off and taken out again; `git diff --numstat` for those two files is
back to the baseline 30/1 and 230/16. `examples/fold3d_witness.rs` is deleted; a
copy is at `<scratchpad>/fold3d_witness.rs.saved` and the src patch at
`<scratchpad>/fold3d_witness_probe.patch`. **Collision worth knowing about:** a
parallel session's `examples/zcells.rs` picked up those three `debug_*` entry
points while they existed, so it no longer compiles — re-apply the patch above if
that round is still running. No background process was left running.

**What this changes for the investigation.** Every file is now a false verdict,
but not all for the same reason. `failed_layer_ordering`, `cant_fold` and
`full_iguana` were lost by the enumeration. `stick on a floor` is lost *before*
the search: the enumeration is handed an unsatisfiable instance derived from
satisfiable geometry. Open question 4 — does the `extents_overlap` fix become
correct now the enumeration is fixed — is no longer a side issue; it is the next
measurement on this file, and it should be judged by whether the instance becomes
starting-face invariant, not only by a sweep count.


### Round 24 — the cell decomposition is right, and the spurious condition is `extents_overlap` (2026-08-29)

**Two answers. (1) The 13 subfaces and 65 cells are *correct* — geometrically
verified, and the flat path's own reduction would produce the same 13; the thin
decomposition is a property of the model, not a defect, and it is a *consequence*
of the failure rather than its cause. (2) Round 23's "suspect mechanism, not
measured" is now measured: the condition it isolates,
`quad a=9 b=11 c=169 d=168`, is emitted between two creases that meet
**end to end at a single point**, and dropping that whole class makes the model
fold in 32 ms.** *Measured.* Run in parallel with Round 23 from a separate
harness; where the two overlap they agree exactly — same
`Contradiction { 166, 11 }`, same five-condition core, same subface sizes.

#### The decomposition (`cells.rs`), questions 1–4

Starting face 1. Every number from the public API (`place_segments` →
`census_placement` → `cell_index`):

| | `stick on a floor` | `cant_fold` | `successful_layer_ordering` |
| --- | --- | --- | --- |
| faces | 523 | 213 | 124 |
| overlap groups / traced components | **2 / 2** | 7 / 7 | 4 / 4 |
| cells | **65** | 109 | 79 |
| cells at or below the area bar | **0** | 0 | 0 |
| distinct multi-face covering sets | **63** | 106 | 79 |
| …after `maximal()` | **13** | 37 | 21 |
| faces per plane | **383 / 140** | 181 / 16 / 16 | 106 / 18 |
| cells per plane | **30 / 35** | 99 / 5 / 5 | 73 / 6 |

**Why so few (Q1, Q2).** One overlap group per plane, each connected, each traced
whole — the per-component split and the Euler gate are not dropping anything.
383 faces in plane 0 produce 30 cells because the folded footprints are
*coincident*, not merely overlapping: cell areas are 78.125 / 156.25 / 312.5 /
625 / 3750 against an area bar of 6.8e-4, i.e. **three to seven orders of
magnitude above it**, and quantised — a stack of aligned layers over a coarse
grid, which is what "a stick on a floor" is. The arrangement is small because the
edges coincide; the covering sets are large for the same reason. `cant_fold` has
109 cells from 213 faces because its footprints are varied.

**The covering sets are correct (Q3).** For each of the 13 maximal sets, the
cell's `inside_point_find` sample re-tested against every face of that plane with
an independent crossing-number predicate written in the harness:

- **0** member faces fail to contain the sample (over all 13, including both
  123-face sets),
- **0** non-member faces contain it,
- **0** of the 42,580 within-subface pairs is not a census overlap pair,
- worst face margin **3.66 paper units** on a span of 825 — nowhere near the
  1e-4 border band, and **0 of 65 cells** fall back to `Point::origin()`.

So 123 faces really do cover one point. *Measured.*

**No flat/3D disparity here (Q4).** `reduce_subface_set` is a containment
reduction, the same one `cells.rs::maximal()` performs, so the flat path over
this arrangement would reduce the same 63 covering sets to the same 13. Round 22
already measured the two producing literally the same 200 sets on the iguana flat
twin. The 632→200 vs 292 gap of Round 14 was the iguana's silhouette, not a rule
difference.

**The decomposition is not the cause (Q5).** Re-running the shipped
`Fold3dOrderEnumerator::with_cells` with a `CellIndex` carrying **all 63**
covering sets instead of the 13 maximal ones: `valid_count` **13 either way**,
outer iterations **24 either way**, same `NoLayerOrder`. `prioritize_subfaces`
picks the same prefix because the extra 50 sets are subsets and carry no new
pair. The 123-face subface is where the cost is, but it is not where the answer
is lost.

#### The mechanism Round 23 left open

`chord_pair` gates every taco-taco on `extents_overlap(first, second, 0.0)` —
**slack zero** (`constraints.rs:512`), where its sibling `interleavings` passes
the real `distance_relative * span` (`:1033`). Taking each geometric quadruple
condition back to its two creases through `placement.joins` /
`folded_line_ends`, and measuring how much of the folded line they actually
share:

| file | taco-taco quads | share ≤ slack | of those, endpoint-touching | strictly disjoint | worst |
| --- | --- | --- | --- | --- | --- |
| `stick on a floor` | 9,744 | **657 (6.7%)** | 623 | 34 | −25.0 |
| `cant_fold` | 1,241 | 196 (15.8%) | 128 | 68 | −59.3 |
| `failed_layer_ordering` | 645 | 92 (14.3%) | 68 | 24 | −28.6 |
| `successful_layer_ordering` | 629 | 68 (10.8%) | 68 | 0 | −1.5e-9 |
| `full_iguana` | 16,575 | 3,766 (22.9%) | 2,163 | 1,603 | −50.0 |
| `full_iguana_flat_working` | 17,020 | 3,912 (23.0%) | 2,273 | 1,639 | −50.0 |

**Both named bugs are live, and they split cleanly.** Of the strictly-disjoint
pairs — creases up to 59 units apart on a line they share to within 2e-8 —
**34 of 34, 68 of 68 and 1,603 of 1,603** have *antiparallel* canonical
directions, so `extents_overlap` reflected b's interval: that is the frame-mixing
bug, now measured rather than read. The endpoint-touching majority is the missing
slack: the strict `<` loses to ~1e-11 of rounding at a shared endpoint.

**And the load-bearing one is a touching pair.** Round 23's isolated condition
`quad a=9 b=11 c=169 d=168` is crease **67** (faces 9/11, −180°, length 25) and
crease **210** (faces 169/168, −180°, length 50), both in folded-line group 1,
collinear to 1e-10, spanning `t ∈ [0, 25]` and `t ∈ [25, 75]` of the same line —
**shared length exactly 0.0000**. They meet at a point. No region of paper
carries both wraps, so no interleaving between them is possible and the condition
is unwarranted.

**The counterfactual.** Dropping exactly the "share ≤ slack" class and changing
nothing else, at face 1:

| | AEA closure | shipped `ComponentSolver::new` |
| --- | --- | --- |
| shipped conditions | `Contradiction { 166, 11 }`, discarded | `NoLayerOrder`, 173–304 ms |
| touching/disjoint pairs dropped | **closes: 22,239 relations, 74.35% of 29,911 variables** | **FOUND, 32 ms** |

Controls, same harness, same run: `cant_fold`, `failed_layer_ordering`,
`successful_layer_ordering`, `full_iguana`, `full_iguana_non_flat_failing` and
`full_iguana_flat_working` are **FOUND both ways**, with closure coverage
unchanged to within 9 relations (iguana 50,566 → 50,557; flat twin 54,484 both
ways, which is Round 14's number reproduced from a third harness). So the class
is spurious everywhere and load-bearing only here.

**Corroboration that the pass really is discarded, from public API alone.**
`build_constraints` gives 3,391 seeds (FullFold 799 / SharedSlot 2,304 / Wall
288) and 2,256 kept couplings × 4 = 9,024 cut relations; 3,391 + 9,024 =
**12,415**, which is exactly the `initial_relations` the `fold-profiling` counter
reports for the shipped solve. The closure adds nothing because it never ran.

**The core is pure geometry.** Minimising the seed set alongside the conditions
gives 19 seeds, **all `FullFold`** — no `SharedSlot`, no `Wall`, no coupling cut.
Ablation agrees: keeping only FullFold seeds still contradicts; dropping them
does not. So neither the 2,304 SharedSlot seeds from the 230-crease group nor any
coupling scaffolding is implicated, which retires the brief's second anomaly.

**Calibration.** What is measured is that the shipped instance is UNSAT, that 657
of its conditions are between creases sharing no interior of the folded line, and
that removing that class yields a complete stacking the shipped search accepts.
What is **not** measured is that stacking against `interleavings` (0 crossings)
and `undetermined` — the debug surface was removed from the tree by the parallel
session mid-round, so it could not be re-run. That is one measurement, and it is
what would turn "likely" into "proven".

**Proposed fix, in order of confidence:** pass the real slack at
`constraints.rs:512` as `interleavings` already does, and project `b.span`
through `dot(a.direction, b.direction)` in `extents_overlap`. R10 measured the
frame fix regressing `cant_fold` 4/21 → 0/21 — but that was before Rounds 11, 19
and 22, and `cant_fold` now folds 21/21 with the class dropped, so R10 needs
re-running rather than trusting.

**Instrumentation: all removed.** One example, `examples/zcells.rs`
(shape/verify/solve/explain/quads, plus AEA-bisection modes while
`debug_plan`/`debug_solve`/`debug_close_hierarchy` existed), **deleted**;
`git status` shows nothing of mine and **nothing under `src/` was touched at any
point**. Copies at `<scratchpad>/zcells.rs.saved` (full, needs Round 23's
`fold3d_witness_probe.patch` re-applied) and `<scratchpad>/zcells_public.rs.saved`
(public API only, compiles against the tree as it stands). Built once with
`--release --features fold-profiling`. No background process was left running.
This is the `zcells.rs` Round 23's collision note names.

### Round 25 — do the 9,024 cut relations over-constrain in aggregate? (2026-08-29)

**No, on every measure, and the opposite is true: they are the single largest
source of *sound* closure coverage on this file. They land on 0 real ordering
variables, are acyclic and self-consistent, contribute 0 of 1,523 guide edges on
the 13 real subfaces, and deleting all 9,024 leaves the verdict unchanged and the
solve 3x slower.** *Measured.* Subject `stick on a floor - failure.osf`, starting
faces 0/1/2/5, one 523-face / 29,911-variable component. Run in a frozen APFS
snapshot of `crates/` with its own target dir, because the shared tree changed
under me twice inside ten minutes; nothing under the shared `src/` was touched at
any point. Independent of Rounds 23 and 24; where we overlap we agree exactly
(same `Contradiction { 166, 11 }`, same `quad a=9 b=11 c=169 d=168`, same
creases 67/210, same 13 subfaces at 123/123/112/96/89/89/60/57/57/57/57/29/29).

**Q1 — cuts on real ordering variables: 0 of 9,024.** They collapse to 4,608
distinct pairs (each written twice, by two couplings), **0** of which is a census
pair, **0** same-plane, and **0** running from a higher plane index to a lower
one. That is structural, not luck: `coupled` returns early when both slots are in
one plane, so every cut is cross-plane, and a census pair is coplanar by
construction. R5's `cant_fold` result reproduces here at 90x the coupling count.

**Q1b — nor do they decide any real variable indirectly.** Census pairs decided
only with the cuts present: **0**. Only without: **0**. Flipped: **0**. Also
structural — every non-cut relation is same-plane and every cut runs plane 0 →
plane 1, so no transitive chain can leave and re-enter a plane. The cuts reach a
real variable through exactly one channel, `check_quad` on their own coupling
condition, which is the documented encoding.

**Q2 — the cuts are mutually consistent.** Tarjan over the cut digraph alone:
**0 cycles**. Opposed cut pairs: **0**. Seeds alone: **0 cycles**. Seeds + cuts:
**0 cycles**. So the acyclicity `validate_initial_hierarchy` does not check is
satisfied anyway, for the same plane-layering reason.

**Q3 — the cuts contribute nothing to the real subfaces' pruning.** Replaying
`set_guide_map`'s guide derivation verbatim over the shipped hierarchy, per cell
subface:

| subface faces | 123 | 123 | 112 | 96 | 89 | 89 | 60 | 57 | 57 | 57 | 57 | 29 | 29 | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| guide edges | 192 | 192 | 216 | 174 | 133 | 133 | 121 | 72 | 79 | 79 | 72 | 30 | 30 | **1,523** |
| **from a cut** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| from a seed | all | all | all | all | all | all | all | all | all | all | all | all | all | **1,523** |
| lost if cuts deleted | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |

A cut pair is cross-plane and a cell subface is single-plane, so no cut can ever
be read by one. The 123-face subface has 7,503 internal pairs and **192** guides —
the pruning problem on this file is that there is almost none, not that it is
arbitrary. On `cant_fold` sf=1 the same measurement is 951 guides, 0 from cuts.

**Q4 — the ablation moves nothing.** Same component, synthetic subfaces and
coupling quadruples kept, cuts deleted, shipped `ComponentSolver::new` (all four
`Completeness` attempts):

| face 1 | verdict | ms |
| --- | --- | --- |
| shipped | `NoLayerOrder` | 176, 367 |
| all 9,024 cuts deleted | `NoLayerOrder` | 530, 1,258 |
| cuts and coupling quadruples both deleted | `NoLayerOrder` | 513, 1,078 |

Two runs each, contended machine — treat the ratio, not the absolute. Deleting
the scaffolding makes it **~3x slower** and changes no answer.

**The productive half, which is the actual finding.** Closing over subsets of the
condition set (`close_hierarchy_with_removal`, the shipped pass), face 1:

| conditions the closure sees | closes? | relations | census pairs decided |
| --- | --- | --- | --- |
| seeds only | yes | 21,845 | 21,845 — 73.03% |
| seeds + triples | yes | 22,239 | 22,239 — 74.35% |
| seeds + geometric quads | yes | 21,857 | 21,847 — 73.04% |
| seeds + cuts + coupling quads | yes | 26,557 | 21,949 — 73.38% |
| **seeds + cuts + coupling quads + triples** | **yes** | **34,399** | **29,791 — 99.60%** |
| seeds + cuts + coupling quads + geometric quads | yes | 26,571 | 21,953 — 73.39% |
| triples **and** geometric quads together (= shipped) | **`Contradiction { 166, 11 }`** | discarded | 3,391 — 11.34% |

So the coupling machinery is worth **+7,552 determinations** over `seeds +
triples` — a quarter of the whole variable set — and every class *except* the
triple/geometric-quad pair closes cleanly. The 99.60% closure passes every
independent check: 0 seed violations, **0 of 2,256 coupling violations**, 0 cyclic
cell subfaces, and **0 crossings** under `interleavings`. This is the direct
refutation of "9,024 cuts over-constrain": they under-determine nothing, decide no
real variable by themselves, and in concert with the triples they determine 99.6%
of the model.

**One condition of 37,665 is the whole verdict.** A non-aborting audit of that
99.60% closure against every condition, using `check_triple` / `check_quad`'s own
clauses: **0 of 25,665 triples conflict, 0 of 2,256 coupling quads conflict, and
1 of 9,744 geometric quads does** — `quad a=9 b=11 c=169 d=168`, all four faces in
plane 0, carried by creases 67 and 210. Identical at faces 0, 1, 2 and 5, so it is
**starting-face invariant**, unlike the frame-dependent triple Round 23 isolates.

**Withhold that one condition and the file folds, with a checked witness.** Keep
the other 9,743 geometric quads, all 25,665 triples, all 2,256 coupling quads and
all 9,024 cuts; hand the search the 99.60% closure:

| face | 0 | 1 | 2 | 5 |
| --- | --- | --- | --- | --- |
| result | FOLDED 35 ms | FOLDED 27–64 ms | FOLDED 33 ms | FOLDED 29–41 ms |
| undetermined of 29,911 | **0** | **0** | **0** | **0** |
| seed violations of 3,391 | 0 | 0 | 0 | 0 |
| coupling violations of 2,256 | 0 | 0 | 0 | 0 |
| triple conflicts of 25,665 | 0 | 0 | 0 | 0 |
| geometric-quad conflicts | 1 (the withheld one) | 1 | 1 | 1 |
| cell subfaces cyclic / incomplete | **0 of 13 / 0** | 0 / 0 | 0 / 0 | 0 / 0 |
| `interleavings` crossings | **0** | **0** | **0** | **0** |

Every one of the 13 cells is totally and acyclically ordered — the definition of a
stacking — and the independent backward re-derivation finds no crossing. So this
is a witness to everything except a single condition, and that condition is the
one Rounds 23 and 24 show is spurious. **`stick on a floor`'s `NoLayerOrder` is a
false negative**, and the cut scaffolding is not what loses it.

**Confirming 67/210 from a third harness.** Projecting both creases' folded
endpoints onto their shared direction: crease 67 occupies
`t ∈ [0, 25.00000000001182]`, crease 210 `t ∈ [25.00000000000114,
75.00000000000114]` — they meet at a point and overlap by **1.07e-11 on an
825 span, 1.3e-14 relative**, both collinear to 1e-10. `chord_pair` gates on
`extents_overlap(first, second, 0.0)`, strict `<` with **zero** slack, so the
rounding sliver passes and the taco-taco is written. Note this pair implicates the
*missing-slack* half of the known-real bug and **not** the frame-mixing half: b's
interval comes out the right way round here (`[25, 75]` after `[0, 25]`), it is
simply not separated by a tolerance. Round 24's class census is the general
picture; this is the one that matters.

**A caution on the "beyond one condition" arm.** Withholding *all* geometric
quads instead of just the conflicting one also folds (34–51 ms) but the answer is
worse — `interleavings` reports **8 crossings** and the ordering then conflicts
with 9 quads. So the geometric quadruples are doing real work; exactly one of them
is wrong. Do not read this round as an argument for dropping the class.

**Not measured.** Whether the sliver is the only reason 67/210 passes the gate —
I measured the folded endpoints, not `Crease.span` and `Crease.frame.origin`
themselves, which are private. Whether a slack fix changes any other file's
verdict — Round 24 has that control, I did not repeat it. Faces beyond 0/1/2/5.
And no gate was run: nothing behaviour-changing was applied, and the shared tree
is byte-identical to how this round found it.

**Instrumentation: none in the shared tree, at any point.** The whole round ran in
an APFS clone at `<scratchpad>/cutagg/tree`, where `close_hierarchy_with_removal`
was widened to `pub` (one word, snapshot only) and `examples/cutagg.rs` was added.
It reuses Round 23's `DebugComponent` / `debug_plan` / `debug_solve`, which were in
the tree when I snapshotted and have since been removed — so rebuilding it needs
`<scratchpad>/fold3d_witness_probe.patch` re-applied. `git status` in the shared
worktree shows nothing of mine, `grep -rl cutagg crates/` is empty,
`close_hierarchy_with_removal` is still `pub(crate)` there, and no background
process was left running.

### Round 26 — the outer loop, and the coupling count is not redundant (2026-08-29)

**Numbered 26 because a parallel session landed its own Round 25 (the
cut-aggregate question, and the checked witness that settles the file) between
this round's read of the doc and its write.**

**Three answers, from a fourth harness run in parallel with Rounds 23, 24 and 25;
where we overlap we agree exactly — same `Contradiction { 166, 11 }`, same 13
subfaces with the same sizes, same 2,256 couplings / 9,024 cuts / 25,665 triples
/ 9,744 geometric quads. (1) The search concludes in **six outer iterations per
attempt**, and all four `Completeness` attempts are byte-identical. (2) It does
**not** die at prefix position 1, and the exhaustion is not a stale checkpoint —
a fresh restart against the same table agrees at 5 of 5 rejections. (3) The 2,256
couplings contain **zero duplicates**; deduplicating them is a no-op and changes
neither the verdict nor the time.** *Measured*, starting face 1, on a throwaway
`git worktree` seeded from a snapshot of the shared tree (a parallel session was
mid-edit; the diffstat moved 397 → 556 → 738 lines while this round was reading).

**Baseline reproduced bit for bit** before anything was instrumented: 523 faces,
2 planes, 29,911 census pairs, 49 folded-line groups (largest 230), 13 cell
subfaces sized 123/123/112/96/89/89/60/57/57/57/57/29/29, 2,256 couplings,
`NoLayerOrder { component: 0, faces: 523, variables: 29911 }`.

#### 1. Where it concludes

Default-off probe on the `Inconsistent` / `Consistent` arms of
`possible_overlapping_search` and on `advance_subface_permutations`:

| attempt | outer iters | events | rejections | positions | terminating step |
| --- | --- | --- | --- | --- | --- |
| `Upstream` | 6 | 6 | 5 | 7, 3, 2, 2, 2 | `advance(2) -> 0` |
| `SwapReset` | 6 | 6 | 5 | 7, 3, 2, 2, 2 | identical |
| `SwapResetAndBackjump` | 6 | 6 | 5 | 7, 3, 2, 2, 2 | identical |
| `RestartOnReset` | 6 | 6 | 5 | 7, 3, 2, 2, 2 | identical |

Iteration 1 is the realtime-AEA retry, as on `cant_fold`. **All five rejections
in all four attempts are the same subface** — priority entry 7, which is **cell
subface index 2, 89 faces**. No other subface is ever rejected; positions 0–6 are
consistent at iteration 2.

The terminating step, read from the odometer trail:

```text
it6 fail@2  order [p0=e12/s7/f29/g1  p1=e11/s3/f29/g1  p2=e7/s2/f89/g171 ...]
    advance(2) -> 0 via [p1=e11/s3/f29/g1->0  p0=e12/s7/f29/g1->0]
```

The swapper has re-seated the two 29-face subfaces (cell subfaces 7 and 3) at
positions 0 and 1, and **both have generator count 1** — one permutation, pinned
by their guide maps — so both `next()` calls return 0 and the loop exits. At the
previous iteration the same call succeeded (`advance(2) -> 2 via
[p1=e9/s10/f96/g3->67]`), so whether the odometer can continue is decided by
which subfaces the swapper happens to place below the failing one.

**This corrects a reading, not a number.** Round 20 records 24 outer iterations
for this file at sf=1. That is the `fold-profiling` counter, which accumulates
across attempts: 6 x 4 = 24. No single search runs 24 iterations.

#### 2. Is the exhaustion genuine? Yes — and this is where it differs from `cant_fold`

Round 10's control, re-run here at every rejection: a clone of the rejected
entry, accelerator dropped and `clear_loop_checkpoint_on_reset` set so the reset
is a true restart, re-run against the very `HierarchyTable` the live entry was
handed.

| | `cant_fold` sf=0 (Round 10) | `stick on a floor` sf=1 |
| --- | --- | --- |
| fresh search on the identical table | `true` — the rejection was wrong | **`false` at 5 of 5** |

So none of the machinery Rounds 6–11 fixed is implicated. The brief's position-1
note does not apply either: the terminating call is `next(2)`, not `next(0)`.

#### 3. The coupling count is exactly right, and nothing is redundant

Slot geometry of the 230-crease group, re-derived from `placement.rings` /
`face_normals` the way `crease_slots` does it, with `same_slot`'s `dot > 0` test:
**3 distinct slots**, not the 4 the brief allowed — plane 0 contributes two,
plane 1 one. The 230 creases fall into four slot-pair classes:

| slot pair | planes | creases | pairs |
| --- | --- | --- | --- |
| (0, 0) | 0, 0 | 67 | taco — `coupled` returns early, one plane |
| (1, 1) | 0, 0 | 67 | taco |
| (0, 2) | 0, 1 | 48 | C(48,2) = **1,128** |
| (1, 2) | 0, 1 | 48 | C(48,2) = **1,128** |

**1,128 + 1,128 = 2,256.** The emission rule is one coupling per unordered pair
of creases inside one *cross-plane* slot-pair class, and the count is fully
explained. The 26,335 chord pairs of the group are not the unit; the two 48-crease
classes are.

They are **not** repeats of a handful of constraints:

| | count | distinct |
| --- | --- | --- |
| coupling quadruple conditions, raw tuples | 2,256 | **2,256** |
| …up to the condition's own symmetry (block swap `(a,b)<->(c,d)`, the only one of the eight `apply_quadruple_condition` rules' symmetries that closes) | 2,256 | **2,256** |
| …distinct 4-face sets | 2,256 | **2,256** |
| synthetic coupling subfaces | 2,256 | **2,256** |
| cut relations | 9,024 | 4,608 |

Only the cuts repeat, and a repeated relation is idempotent in the table. Each
coupling relates a *different* pair of creases, hence a different 4-face set, so
there is nothing to collapse.

#### 4. What dedup gives: nothing

Deduplicating coupling quads by canonical tuple, synthetic subfaces by face set,
and cuts as a set:

| | shipped | deduplicated |
| --- | --- | --- |
| subfaces | 2,269 | **2,269** |
| quadruple conditions | 12,000 | **12,000** |
| relations | 12,415 | 7,999 |
| verdict | `NoLayerOrder` | **`NoLayerOrder`** |
| time | 190 ms | 171 ms |

**The brief's second anomaly is retired**, and by the same conclusion Round 24
reached from the seed side.

#### 5. It is one subface, and the proof is one AEA call

Per-subface `AdditionalEstimation` closure, each cell subface **alone**, with the
geometric determinations only — no cuts, no coupling subfaces, no coupling quads:

| subface | faces | seeds+triples | seeds+geo quads | **seeds+triples+geo quads** |
| --- | --- | --- | --- | --- |
| 0,1,3,4,5,6,7,8,9,10,11,12 | 29–123 | closes | closes | **closes** |
| **2** | **89** | closes | closes | **`Contradiction { 166, 11 }`** |

Either condition class alone closes; together they contradict. Faces 166 and 11
are both in plane 0, both in cell subface 2, carry no direct seed between them,
and **(166, 11) is a real census ordering variable**. This is Round 23's pair,
found independently and localised to a single subface.

Whole-component ablations, same harness:

| | verdict | AEA | conditions after the pass |
| --- | --- | --- | --- |
| shipped | false, 190 ms | discarded | 25,665 / 12,000 |
| coupling scaffolding dropped entirely | false, 142 ms | discarded | 25,665 / 9,744 |
| cuts dropped | false, 558 ms | discarded | 25,665 / 12,000 |
| **cell subface 2 dropped** | **FOUND, 91 ms** | **closes** | **559 / 696** |
| **every triple condition dropped** | **FOUND, 114 ms** | **closes** | 0 / 3,219 |

So the whole verdict — and the AEA discard with it — hangs on that one 89-face
cell subface. Dropping it is a relaxation and proves nothing about the paper; it
localises the defect exactly, and it is consistent with Round 24's finding that
the load-bearing spurious condition is a taco-taco between two creases meeting
end to end.

#### Falsification controls, both negative

- **An independent min-conflicts witness search**, written from the search's own
  checked semantics (`position 1 is the top`; a triple forbids
  `pos[b] < pos[a] < pos[d]`; a quad forbids `a<c<b<d` and `c<a<d<b`), finds
  witnesses for cell subfaces 0/1/3/7/8/9/12 in milliseconds and fails on
  2/4/5/6/10/11. **Its failures prove nothing**: the shipped solo drive *solves*
  subface 6 on the identical constraint set. It is not a decision procedure and
  no negative from it is reported above.
- **Monotonicity check on the solo drive.** Solving each subface with no
  relations at all — a strict relaxation of a configuration the drive already
  called satisfiable — returns false for **12 of 13**, so a solo `false` can be
  intractability rather than unsatisfiability. Only the AEA contradiction, which
  makes forced inferences only, carries proof weight.

**What this leaves.** Nothing here says the verdict is true, and Round 25's
witness — the 99.60% closure with 0 undetermined variables and 0 `interleavings`
crossings, reached by withholding one geometric quadruple — settles that it is
not. This round's contribution is the mechanism on the search side: the six
iterations, the single rejected subface, and the fact that the enumeration is
behaving correctly on the instance it was handed, so none of the Rounds 6–11
machinery is a candidate here.

**Gate.** None run: nothing behaviour-changing was applied, no `src/` file in the
shared tree was touched, and both ablations live in a deleted worktree.

**Instrumentation: all removed.** A `zfloor` probe module plus hooks in the two
search arms, `advance_subface_permutations` and the rejection site of
`inconsistent_subface_request`, and `examples/zfloor.rs`, existed **only** in a
throwaway `git worktree` at `/private/tmp/claude-501/zfloor-wt`, which is
removed; `grep -rn zfloor crates/` in the shared tree is 0 and no example of mine
is in `crates/oristudio-cp/examples/`. Copies at `<scratchpad>/zfloor.rs.saved`
and `<scratchpad>/zfloor_probe.patch`. It builds against Round 23's
`DebugComponent` / `debug_plan` / `debug_solve`, which were present in the
snapshot it was seeded from and have since been removed from the shared tree —
re-apply `fold3d_witness_probe.patch` first. No background process was left
running.

### Round 27 — the SipHash lever, written fresh and landed on its own (2026-08-29)

**Answer: landed. It is representational — 107 solves agree on the verdict, the
layer order itself and all fourteen profiling counters — and it is worth 2.1× on
`stick on a floor - failure.osf` and nothing measurable on the other five files.**
*Measured.* This is Round 20's lever, rebuilt from scratch (Round 22 left it
unlanded because the only copy was tangled with a `ZPERF` probe at ~40 sites).
Round 20's post-AEA finding reproduces independently, on a different tree, two
rounds later.

**The change.** `folding/permutation.rs` only. A private
`LocalEquivalenceCondition { a, b, c, d }` holds 1-based positions in the
subface's `face_ids`; `triple_conditions` becomes `Vec<Vec<…>>` indexed by local
face rather than `HashMap<usize, Vec<…>>`; `quadruple_conditions` becomes
`Vec<LocalEquivalenceCondition>`; `face_id_map` becomes a dense
`face_id_slots: Vec<usize>` offset by `face_id_base`. `set_guide_map` resolves
each condition's four faces **once** via `to_local`, which is `fast_contains` and
the resolution in one pass — it returns `None` for exactly the conditions
`fastContains` rejected. The penetration checks then do array indexing only:
`face_id_to_permutation_digit` is deleted and its callers go straight to
`generator.locate(local)`. **+134 / −44** against the Round 22 baseline, net +90 —
Round 16's "~40–60 lines" is still low, and above Round 20's +80/−39 because the
helpers here are separately documented.

Two seams worth naming, both kept faithful rather than convenient:

- `CombinationGenerator::new` still takes upstream's global-id `HashMap`, rebuilt
  on demand by `global_face_id_map()`. It sits behind
  `COMBINATION_GENERATOR_THRESHOLD`, so it is off the hot path, and storing it
  would put a `HashMap` back into every clone of every subface. `combination.rs`
  is untouched.
- `equivalence_conditions()` still emits in `face_ids` order (bucket `i` *is* the
  bucket upstream keys by `face_ids[i]`) and `u_equivalence_conditions()` still
  sorts on **global** ids, via `to_global`. The generator sees byte-identical
  input. The one assumption is that a subface holds no duplicate face id — the
  same three construction sites Round 20 checked still give that, and it is now
  written down on `build_face_id_slots`.

**Method, because the tree would not hold still.** The shared worktree had
another session editing `folding3d/order.rs` **during** this work — it went from
+246 to +446 lines, passed through a non-compiling state (`DebugComponent` /
`debug_raw` undefined), and later gained `constraints.rs` edits and four scratch
examples. So everything below was measured in a **frozen APFS clone** of the
worktree taken at 13:28, with `folding.rs`, `combination.rs`, `order.rs`,
`cells.rs` and `constraints.rs` md5-pinned across the whole window, and the two
binaries built ten minutes apart from that one snapshot — the baseline being a
textual restore of `permutation.rs`, nothing else. One of that session's
in-flight examples (`fold3d_witness.rs`) did not compile and was removed **from
the frozen copy only**; their worktree was never written to.

**The machine was loaded 20–39 on 10 cores for the entire measurement** (other
agents), so wall clock is close to useless here. The primary table is therefore
**user CPU time**, which the single-threaded solve makes the right metric under
contention, min of 3 interleaved runs per arm:

| file | base CPU | lever CPU | effect | base RSS | lever RSS |
| --- | --- | --- | --- | --- | --- |
| `full_iguana_non_flat_failing.fold` | 13.91 s | 14.07 s | none (0.99×) | 66 MB | 64 MB |
| `full_iguana.fold` | 14.05 s | 14.15 s | none (0.99×) | 64 MB | 61 MB |
| `cant_fold.fold` | 0.72 s | 0.73 s | none (0.99×) | 10 MB | 10 MB |
| `failed_layer_ordering.fold` | 0.41 s | 0.41 s | none | 8 MB | 8 MB |
| `successful_layer_ordering.fold` | 0.40 s | 0.40 s | none | 9 MB | 8 MB |
| `stick on a floor - failure.osf` | 1.47 s | **0.70 s** | **2.10×** | 45 MB | 42 MB |

Worst starting face by wall clock, per-face minimum over 5 interleaved repeats —
same shape, and the absolute numbers are inflated by the load, so do not compare
them to Round 22's table:

| file | verdict | base worst | lever worst |
| --- | --- | --- | --- |
| `full_iguana_non_flat_failing.fold` | 21/21 | 670.9 ms | 678.0 ms |
| `full_iguana.fold` | 21/21 | 679.9 ms | 691.5 ms |
| `cant_fold.fold` | 21/21 | 35.1 ms | 36.4 ms |
| `failed_layer_ordering.fold` | 21/21 | 20.0 ms | 20.2 ms |
| `successful_layer_ordering.fold` | 21/21 | 19.5 ms | 19.6 ms |
| `stick on a floor - failure.osf` | 0/2 | 731.9 ms | **345.0 ms** |

**Memory is not the trade.** The dense array replaces two `HashMap`s per subface,
and peak RSS goes *down* slightly on every file (66→64, 45→42 MB). The
`max - min + 1` span per subface was the thing worth checking; it is cheaper than
what it replaced.

**Soundness: 107 solves, identical on everything but the clock.** Every starting
face of all five `.fold` files plus both of the `.osf`, compared field for field
with wall time stripped: verdict (including the `NoLayerOrder` payload), cell
count, an FNV-1a hash of `render_model().cell_stack` **and** `cell_attr`,
`can_advance()`, and — built with `--features fold-profiling` — all fourteen
counters (`outer_iters`, `inconsistent_requests`, `table_from_initial`,
`perm_advances`, `realtime`, `fast_realtime`, `add_est_passes`, `triple_cond`,
`quad_cond`, `faces_total`, `subface_total`, `valid_count`, `initial_relations`,
`max_subface_faces`). **Zero differences.** Matching counters are the stronger
claim: the search visits the same states in the same order, it does not merely
arrive at the same stack.

**A trap for the next harness.** `Fold3dSession::new` **degrades** rather than
erroring when the ordering solver cannot answer — it still returns `Ok` with a
drawable figure (`order.rs`'s `search_error` doc says so). A sweep that counts
`Ok` reports `stick on a floor` as **2/2**. The verdict lives in
`session.snapshot().verdict`; only `Fold3dVerdict::Folded` is a fold. The first
version of this round's harness got that wrong and reported 2/2 before the
criterion was fixed. (Faces 0–1 only, per the brief — Round 23 sweeps all 21 and
finds it folds at 10 of them.)

**Gate — all of it, on the frozen snapshot carrying the lever:**

| check | result |
| --- | --- |
| `cargo test -p oristudio-cp --release` | **975 passed, 0 failed** |
| Oriedita folding oracle, `ORIEDITA_GEOMETRY_ORACLE` set | **29 / 29 in 26.9 s** |
| Oriedita render oracle, same | **13 / 13 in 43.6 s** |
| `rustfmt --check` on `permutation.rs` | clean on **both** arms |
| `cargo clippy -p oristudio-cp --all-targets` | **0** notes mentioning `permutation.rs`, both arms |

The env var was verified to matter: without it the same 29 tests "pass" in
**0.00 s**. The two workspace-wide lint findings that remain — a `fmt` diff in
`folding3d/order.rs` and an unused import in `examples/zcells.rs` — are the other
session's in-flight files, present identically on both arms.

**Instrumentation:** none in `src/`. The harness was one example,
`crates/oristudio-cp/examples/fold3d_sweep.rs`, **deleted**; a copy is at
`<scratchpad>/fold3d_sweep.rs.saved` and it is ~110 lines against the public
`Fold3dSession::new`, so rebuild it rather than trusting a stale copy:

```bash
cargo run -p oristudio-cp --release --features fold-profiling \
  --example fold3d_sweep -- --faces 21 "$DIR/full_iguana_non_flat_failing.fold"
```

No background process was left running.

### Round 28 — the frame story is refuted; the gate has no tolerance (2026-08-29)

**Numbered 28 because a parallel session took 27 while this round was measuring.**

**Adversarial verification of Round 23's root cause. The *verdict* survives and is
now proven; the *cause* does not. Round 23 names non-equivariant frame choices —
`canonical_direction`, `frame_for`, `extents_overlap`'s frame mixing — and
prescribes the frame-projection fix. Applied and measured, that fix leaves `stick
on a floor` at 10 / 21, at the same ten faces, with both core conditions still
emitted. What loses the file is the *other* half: `chord_pair` gates on
`extents_overlap(first, second, 0.0)`, and both conditions of the core are
admitted by a ~1e-11 rounding sliver at a shared crease endpoint. The
frame-dependence Round 23 measured is that sliver's sign flipping under a rigid
rotation — a symptom of the missing tolerance, not an independent cause.**
*Measured*, in a throwaway `git worktree` at HEAD carrying only the four
baseline files, because a parallel session had already patched `constraints.rs`
in the shared tree.

**Baseline reproduced exactly**, 21 faces through the public `order_placement`:
FOLDED at 7, 8, 10, 11, 12, 13, 15, 16, 19, 20 — **10 / 21**, 182–212 ms folding,
291–341 ms not. Round 23's sweep, face for face.

**Both of Round 23's discriminating conditions, traced to their creases.** New:

| | crease pair | share, a's frame | frame projection changes it? |
| --- | --- | --- | --- |
| `quad 9,11,169,168` | 67 (9,11) vs 210 (168,169) | **+1.069e-11** | no — parallel |
| `triple 185,9,185,11` | 67 (9,11) vs **933** (185,209) | **+1.250e-11** | no — parallel |

Slack would be 8.25e-4. At face 7 the same pair 67/210 comes out at **−1.11e-10**
and the gate refuses it; crease 933 does not reach the gate at all and a
different sliver pair (251) does. So the instance's frame-dependence *is* the
zero-slack gate: at a residual of 1e-11 the strict `<` is decided by rounding,
and rounding moves when the model is rigidly rotated.

**Non-equivariance is not what loses a verdict — the controls carry it at full
strength.** Distinct condition instances over 21 starting faces (FNV over the
unordered condition multiset):

| | distinct instances | verdict |
| --- | --- | --- |
| `stick on a floor` | 20 / 21 | 10 / 21 |
| `cant_fold` | **21 / 21** | **21 / 21 FOLDED** |
| `full_iguana_non_flat_failing` | 20 / 21 | **21 / 21 FOLDED** |

**The two fixes, measured separately.**

| | `stick` | `cant_fold` | distinct instances (stick) | `T185_9_11` / `Q9_11_169_168` |
| --- | --- | --- | --- | --- |
| baseline | 10 / 21 | 21 / 21 | 20 | at 10 failing faces / at 16 faces |
| **frame projection only** (Round 23's fix) | **10 / 21**, same faces | 21 / 21 | **20** | **unchanged** |
| **real slack at the `chord_pair` gate only** | **21 / 21** | 21 / 21 | **20** | **0 / 0 at every face** |

So the frame fix changes nothing that matters here, and the slack fix folds the
file **while leaving the instance just as non-equivariant** — 20 distinct
instances either way. Round 23's proposed acceptance test ("the condition set
becomes identical at all 21 starting faces") is therefore the wrong test: its own
fix fails it, and the fix that works does not need it.

**R10 is stale, as Rounds 23–26 suspected.** The frame projection leaves
`cant_fold` at **21 / 21**, not the 4/21 → 0/21 R10 recorded.

**The witness, checked independently — this is what Round 24 left open.** With the
slack fix, every file at every one of 21 starting faces, through
`interleavings`:

| | folded | relations | undetermined | **crossings** |
| --- | --- | --- | --- | --- |
| `stick on a floor` | **21 / 21** | 29,911 | **0** | **0** |
| `cant_fold` | 21 / 21 | 3,776 | 0 | 0 |
| `failed_layer_ordering` | 21 / 21 | 2,324 | 0 | 0 |
| `successful_layer_ordering` | 21 / 21 | 2,289 | 0 | 0 |
| `full_iguana_non_flat_failing` | 21 / 21 | 50,713 | 0 | 0 |

`stick` also reports **0 "unordered"** at every face: a complete stacking, not a
partial one. **`NoLayerOrder` on this file is a proven false negative.**

**The killer question, answered honestly: the mechanism fires on every file.**
Pairs the zero-slack gate admits whose true shared extent is within slack —

| | admitted by the gate | of those, within slack | widest true share | pairs with share > 1e-6 |
| --- | --- | --- | --- | --- |
| `stick on a floor` | 25,648 | 2,278 | 2.465e-8 | **0** |
| `cant_fold` | 1,433 | 177 | 4.766e-9 | **0** |
| `full_iguana_non_flat_failing` | 20,484 | 3,176 | 8.319e-8 | **0** |
| `successful_layer_ordering` | 743 | 102 | 5.146e-9 | **0** |

It is not discriminative — `cant_fold` and the iguana carry 177 and 3,176 of
these and fold 21/21 — it is only *load-bearing* here. But the same table is the
soundness argument: the widest thing the fix drops is 8.3e-8 against a bar of
4e-4, and **nothing anywhere sits in the four-order-of-magnitude band between**.
Same empty-band reasoning `distance_relative`'s own doc uses. Note also that
`interleavings` (`:1033`) already passes the real slack, so the fix makes the
generator agree with the sanctioned checker rather than weakening it.

**Gate, with the slack fix applied:** `cargo test -p oristudio-cp --release`
**975 passed / 0 failed**; Oriedita folding oracle **29 / 29 in 24.98 s** with
`ORIEDITA_GEOMETRY_ORACLE` set (a live run, not the 0.00 s skip); the whole
`folding3d_order` suite 22/22, including both per-plane traps —
`the_coupled_strip_is_solved_across_its_two_planes` and
`the_coupled_strips_second_plane_is_decided_only_by_the_coupling` — **passed**.

**Where it goes:** `folding3d/constraints.rs`, ours outright. No shared
Oriedita-ported file is involved and no 3D-only opt-in is needed.

**Not measured.** The `Contradiction { 166, 11 }` three rounds report was not
re-derived here — that needs `src/` instrumentation and this round used the
public API only. Whether the controls' *answers* (not verdicts) move under the
slack fix was not fingerprinted; only that they still fold with 0 crossings.
Whether `canonical_direction`/`frame_for` should still be made equivariant on
their own merits is untouched by this round — the finding is only that doing so
would not have fixed this file, and could as easily have frozen the losing
rounding as the winning one.

**Instrumentation: none in the shared tree.** Everything ran in a throwaway
`git worktree` at HEAD seeded with the four baseline files, where
`Placement3d::directed_crease` was widened to `pub` (one word, snapshot only) and
`examples/zadv.rs` was added; the worktree is removed. `git status` in the shared
worktree shows nothing of mine. No background process was left running.

### Round 29 — the bar has no band, and the two fixes together are equivariant (2026-08-29)

**Numbered 29 because Rounds 27 and 28 landed in parallel while this was running.
Independent adversarial verification of the same candidate Round 28 verified, from
a fourth harness, plus four things that round did not measure: the per-file
*condition-count* delta, the gate's tolerance-sensitivity curve, a true-negative
control, and the two fixes applied *together*.** *Measured.* Where this round and
Round 28 overlap they agree; the one place they differ is stated below.

**File:line, checked in the working tree and against `git show HEAD` (the shared
tree was patched by a parallel session nine seconds after my baseline binary was
built, so the baseline arm is genuinely pre-fix).**

- `HEAD:folding3d/constraints.rs:512` — `if !extents_overlap(first, second, 0.0)`.
  The **only** zero-slack call in the crate.
- `HEAD:...:1017` / `:1033` — `interleavings` computes
  `tolerances.distance_relative * placement.span` and passes it.
- `HEAD:...:483–487` — `extents_overlap`, strict `<`, `b.span` used raw after a
  shift along a's direction.
- `quadruple_conditions.push` has exactly **one** site, `:550` inside `taco_taco`,
  reachable only through `chord_pair`. So the quad count is a pure read of that gate.
- `build_constraints` has exactly **one** caller, `folding3d/order.rs:838`. The
  shared Oriedita flat path never sees it.
- Working-tree `order.rs:1217–1240`, `close_component_hierarchy`: `Err(_) => Ok(hierarchy)`.

**Baseline and slack fix, seven files, 21 faces each.** Baseline reproduces
Round 23 face for face.

| file | baseline | slack fix | worst ms |
| --- | --- | --- | --- |
| `stick on a floor` | 10 / 21 (7, 8, 10–13, 15, 16, 19, 20) | **21 / 21** | 605 → 203 |
| `cant_fold` | 21 / 21 | 21 / 21 | 96 → 28 |
| `failed_layer_ordering` | 21 / 21 | 21 / 21 | 54 → 25 |
| `successful_layer_ordering` | 21 / 21 | 21 / 21 | 109 → 20 |
| `full_iguana_non_flat_failing` | 21 / 21 | 21 / 21 | 2,279 → 534 |
| `full_iguana` | 21 / 21 | 21 / 21 | 1,516 → 538 |
| `full_iguana_flat_working` | 21 / 21 | 21 / 21 | 1,055 → 738 |

Every folded solve: 0 undetermined, 0 `interleavings` crossings.

**A true negative stays negative — the control this class of fix most needs.**
`impossible_folds/impossible_3d_shape.osf` is `NoLayerOrder` at every face **in
both arms**, with the gate removing *nothing* on it: seeds 7, triples 8, quads 3,
identical before and after. Removing constraints did not buy a wrong accepted
answer on the one file we hold as genuinely unfoldable.

**The killer question, from the condition side. The mechanism fires on every
file, harder on the ones that fold.** Taco-taco quads at starting face 1, and the
total removed over 21 faces:

| file | quads base → fix (face 1) | drop | quads removed over 21 faces |
| --- | --- | --- | --- |
| `stick on a floor` | 9,744 → 8,719 | 10.5% | 19,316 |
| `cant_fold` | 1,241 → 1,093 | **11.9%** | 2,795 |
| `failed_layer_ordering` | 645 → 575 | 10.9% | 1,714 |
| `successful_layer_ordering` | 629 → 544 | **13.5%** | 1,444 |
| `full_iguana_non_flat_failing` | 16,540 → 13,879 | **16.1%** | 55,181 |
| `full_iguana` | 16,575 → 13,911 | 16.1% | 56,226 |
| `full_iguana_flat_working` | 17,020 → 14,300 | 16.0% | 57,028 |

So "does it fire only on this file" is **no**, by a wide margin and in the wrong
direction. What is unique to `stick on a floor` is only that one of its spurious
conditions is load-bearing. Same conclusion as Round 28's pair-side table,
measured on the emitted conditions instead.

**The bar has no band around it, over seven decades.** Sweeping
`distance_relative` into `build_constraints` alone (cells and census left at
`DEFAULT`) and reading the quad count — again a pure read of the gate:

| `distance_relative` | 0 | 1e-18 | 1e-15 | 1e-12 | **1e-10 … 1e-3** |
| --- | --- | --- | --- | --- | --- |
| `stick on a floor` (span 825) | 9,744 | 9,741 | 9,687 | 8,755 | **8,719** |
| `cant_fold` (span 489) | 1,241 | 1,241 | 1,230 | 1,145 | **1,093** |
| `successful_layer_ordering` (span 400) | 629 | 628 | 615 | 592 | **544** |
| `full_iguana_non_flat_failing` (span 400) | 16,540 | 16,537 | 16,470 | 14,748 | **13,879** |

The removed set is settled by a bar of 1e-10 and does not move again through
1e-3 — a shared extent of 0.8 paper units on `stick`. The shipped 1e-6 sits in
the middle of an empty seven-decade band, so the fix is not tolerance-tuned and
the class it drops is rounding noise rather than small-but-real overlap. This is
the argument `the_loop_gap_bar_sits_in_an_empty_band` and
`the_overlap_area_bar_sits_in_an_empty_band` already make for the other two bars.

**Auditing the new answer against the old instance, in shipped code.**
`interleavings` takes `tolerances` and uses it for nothing but that slack, so
running it at `distance_relative = 0` re-checks a solved order against **exactly
the pre-fix chord-pair set** — no condition semantics transcribed, no second
implementation. Over the post-fix answer on `stick`: **1 crossing** at 14 of 21
faces, 5 at face 6, and **0** at faces 7, 8, 11, 13. That is the shape Round 25's
single-condition audit predicts, reached by a different route.

**Both fixes together, which no round had run.** A parallel session added the
frame projection on top of the slack fix mid-round; measured on that tree:
`stick` **21 / 21**, `cant_fold` 21 / 21, `failed_layer_ordering` 21 / 21,
`successful_layer_ordering` 21 / 21, `full_iguana_non_flat_failing` 21 / 21,
`impossible_3d_shape` **0 / 21**. And the instance becomes **fully starting-face
invariant** — seeds 3,391, triples 25,295, quads 10,014, couplings 2,256 at *all
21 faces*, against 25,147–25,979 and 9,292–10,610 shipped — with `interleavings`
leaving **0 unranked** pairs. **This is where this round differs from Round 28**,
which measured 20 distinct instances under the slack fix alone and concluded
equivariance was unreachable: it is reachable, but only with both, and it is a
consequence rather than the cure. **R10 is dead either way** — the frame
projection leaves `cant_fold` at 21/21, not 0/21.

**Gate, run twice.** Slack fix alone: `cargo test -p oristudio-cp --release`
**975 passed / 0 failed**, Oriedita folding oracle **29 / 29 in 14.97 s** and
render oracle **13 / 13 in 45.83 s** with `ORIEDITA_GEOMETRY_ORACLE` set (live,
not the 0.00 s skip), `folding3d_order` 22/22 including both per-plane traps.
Slack + frame: **975 / 0**, folding oracle **29 / 29 in 19.28 s**, both traps
passed. Tests were run as `--lib --tests` because a parallel session's
`examples/zadv.rs` does not compile against the current tree and blocks the
default example build; no test target was skipped.

**Where it goes:** `folding3d/constraints.rs`, Ori Studio native, single caller
in `folding3d/`. No Oriedita-ported file changes, so no 3D-only opt-in of the
`resetting_generators_on_swap` kind is needed — that precedent is for divergences
*inside* the shared path.

**Not measured.** The identity of the load-bearing condition (`quad 9,11,169,168`
from creases 67/210) was taken from Rounds 23–25 and 28, not re-derived — it needs
the private `Crease` frames, and the fix's effect is established causally without
it. The `Contradiction { 166, 11 }` was not re-derived either. One honest caveat
on the corroboration: at the default bar `interleavings` now shares the fixed
gate, so its 0 crossings cannot see the removed class — the bar-0 re-run above is
what covers that, and it is why it was done.

**Instrumentation: removed.** One example, `examples/zz_r27.rs`, deleted; nothing
under `src/` was touched at any point by this round, and the only `src` change in
the tree is the parallel session's. Two binaries and the sweep logs are in the
scratchpad. No background process was left running.

### Round 30 — the corpus A/B, and the fix is net-additive (2026-08-29)

**Numbered 30 because Rounds 27–29 landed while this was measuring. This is the
round that applied both fixes to the shared tree — Round 29's "a parallel session
added the frame projection mid-round" is this session. Where we overlap we agree
to the digit (seeds 3,391 / triples 25,295 / quads 10,014 / couplings 2,256 at all
21 faces under both fixes), so treat that as two harnesses, not one.** Three
things no earlier round ran: the **35-model external non-flat corpus gate** as a
before/after, the observation that the fix is **net-additive** rather than a
constraint deletion, and a correction to my own equivariance measure. *Measured.*

**File:line, both arms.** `constraints.rs` was byte-identical to `git show
HEAD:...` when this round started (`git diff HEAD --stat` empty for it — the
~397 uncommitted lines are in the other four files), so working tree and HEAD
agree: `:512` `extents_overlap(first, second, 0.0)`, `:1017`/`:1033`
`interleavings` passing `distance_relative * placement.span`, `:483–487`
`extents_overlap` using `b.span` raw. Baseline reproduced face for face: `stick`
folds at 7, 8, 10, 11, 12, 13, 15, 16, 19, 20 — **10 / 21**.

**The corpus gate, before and after — the broadest soundness surface we have, and
nothing had run it.** `ORISTUDIO_NON_FLAT_CORPUS_DIR` set to the external
`non-flat` tree with `ORISTUDIO_NON_FLAT_CORPUS_REQUIRED=1`, both fixes applied,
35 models:

| | baseline | both fixes |
| --- | --- | --- |
| admitted / ordered | 27 / 26 | **27 / 26** |
| models with no layer order | `airplane.fold` | **`airplane.fold`** |
| per-model verdict (`ordered` / `contradictory` / `cells`) | — | **identical, all 35** |
| `interleavings` crossings | `birdBase.fold` 64, rest 0 | **`birdBase.fold` 64, rest 0** |
| undetermined | 0 everywhere | 0 everywhere |
| **unranked chord pairs** | 5,480 (iguanas 1,791 / 1,791 / 1,761; `cant_fold` 105; `failed_layer_ordering` 30) | **0, every model** |
| `cant_fold` constraint components | 2, largest 3,770 | **1, largest 3,776** |

**No verdict moved and no crossing appeared, on twenty-eight models beyond the
six the investigation has been staring at.** `corpus_census_reports_every_model`
fails **identically in both arms** — the corpus directory now holds 93 distinct
models against a pinned 55 — which is corpus drift, not this change; the other
ten tests pass in both.

**The fix is net-additive, which is the strongest thing against "you deleted
constraints until it passed".** With both fixes `stick`'s taco-taco quads go
**9,744 → 10,014** — the frame projection restores more true-overlap pairs than
the slack drops rounding ones. And on `cant_fold` it adds a coupling (14 → 15)
that **merges two constraint components into one**, so the fix hands the search a
*more* coupled instance and it still folds 21/21. A pure relaxation cannot do
that.

**Correction to my own number, against Round 28's finer one.** I reported the
instance as "1 distinct instance over 21 faces" under both fixes. That is
distinctness of the **counts** `(seeds, triples, quads, couplings)`, which is
coarser than Round 28's FNV over the unordered condition *multiset*. Counts being
equal at all 21 faces is necessary for equivariance, not sufficient. Round 28's
measure is the one to quote; my table only shows the counts stop moving.

**The killer question — same answer as Rounds 28 and 29, from the condition
side.** Conditions the slack fix alone removes, summed over 21 faces: `stick`
19,316 quads and 10,051 triples; `full_iguana` 56,226 / 956;
`full_iguana_non_flat_failing` 55,181 / 931; `cant_fold` 2,795 / 60;
`failed_layer_ordering` 1,714 / 67; `successful_layer_ordering` 1,444 / 51. Per
face the drop is 6–16% of the quad set on every file. **It fires everywhere, and
hardest on files that already fold.** The discriminator is load-bearingness, not
firing.

**True negative holds.** `impossible_folds/impossible_3d_shape.osf` is
`NoLayerOrder` at **0 / 21** with both fixes, 6 faces / 15 variables, unchanged;
`bending_a_folded_strip_the_wrong_way_admits_no_layer_order` (in the 975) still
gets `ContradictorySeeds` for both illegal M/V choices.

**Cost.** `full_iguana`, worst face of 21, three runs each on the same contended
machine: baseline 974 / 1,029 / 1,083 ms, both fixes 1,316 / 1,416 / 1,524 ms —
about **1.4×** on the largest model. The 4.2 s reading from a first pass was
contention. `stick` moves the other way, 375 → 264 ms worst.

**Gate, both fixes, seven numbers.**

| check | result |
| --- | --- |
| `stick on a floor - failure.osf` | **10 / 21 → 21 / 21**, 0 undetermined, 0 crossings, 0 unranked at every face |
| `cant_fold.fold` | 21 / 21 |
| `failed_layer_ordering.fold` | 21 / 21 |
| `successful_layer_ordering.fold` | 21 / 21 |
| `full_iguana_non_flat_failing.fold` | 21 / 21 (also `full_iguana` and `full_iguana_flat_working`, 21 / 21) |
| `cargo test -p oristudio-cp --release` | **975 passed, 0 failed** — the *plain* command, examples included |
| Oriedita folding oracle, `ORIEDITA_GEOMETRY_ORACLE` set | **29 / 29 in 19.20 s** (live; 0.00 s when unset) |

Plus render oracle **13 / 13 in 36.30 s**, `cargo fmt --check -p oristudio-cp`
clean, `cargo clippy -p oristudio-cp --release --lib --tests -D warnings` no
errors, and both per-plane traps —
`the_coupled_strip_is_solved_across_its_two_planes` and
`the_coupled_strips_second_plane_is_decided_only_by_the_coupling` — **passed**.
Round 29 had to use `--lib --tests` because a parallel session's `examples/zadv.rs`
did not compile; that example has since been removed and the default command
works again.

**Where it goes:** `folding3d/constraints.rs` — Ori Studio native, one caller
(`folding3d/order.rs`). No Oriedita-ported file is touched, so no 3D-only opt-in
of the `resetting_generators_on_swap` kind applies; that precedent exists for
divergences *inside* the shared flat path.

**Not measured.** The load-bearing condition's identity (`quad 9,11,169,168`,
creases 67/210) and `Contradiction { 166, 11 }` were taken from Rounds 23–25 and
28, not re-derived — both need the private `Crease` frames. Whether the controls'
*answers* move under the fix was fingerprinted per face but not diffed pair-wise.
The honest caveat on `interleavings` stands and is Round 29's: at the default bar
it now shares the fixed gate, so its 0 crossings cannot see the dropped class —
the corpus A/B above is a different kind of cover (28 unseen models, no verdict
moved), not a substitute for Round 29's bar-0 re-run.

**Instrumentation: none in `src/`.** One example,
`crates/oristudio-cp/examples/zslackprobe.rs` (sweep / census / verify, public API
only), **deleted**; copy and the `constraints.rs` patch are in the scratchpad.
The `src/` change is the fix itself, 9 added / 3 removed in
`folding3d/constraints.rs`, left in the working tree uncommitted alongside the
baseline's ~397 lines. No background process was left running.

### Round 31 — independently re-verified, and a reporting error of mine (2026-08-29)

**FIRST, A CORRECTION.** Every earlier round in this log records
`stick on a floor - failure.osf` as "0 / 2". That was a **two-face sweep**, run
that way because an early full sweep hung, and it was then repeatedly quoted as
though it meant "fails everywhere". It does not. Measured through the shipped
public API with the extents fix reverted, the file folds at **10 of 21** starting
faces (7, 8, 10, 11, 12, 13, 15, 16, 19, 20). It was never the uniformly-failing
outlier this log described. Do not quote a partial sweep as a rate.

**The failure was BEFORE the search, not in it — the first such case here.**
Drop every coupling (no synthetic subfaces, no 9,024 cut relations, no 2,256
coupling quadruples) and Oriedita's own setup AEA still reaches
`Contradiction { upper_face: 166, lower_face: 11 }` on the bare geometric core in
**4 ms**, at every failing frame. `AdditionalEstimation::run` makes only forced
inferences, so that is a *proof* the instance is unsatisfiable — the search was
telling the truth about what it was handed. The couplings are exonerated: the full
instance closes cleanly at exactly the frames the geometric core does
(12,415 → 34,303 relations) and contradicts at exactly the frames it does.

**The instance was wrong, because the condition derivation is not equivariant.**
Same 523 faces and same 29,911 ordering variables at every starting face, but
triples range 25,147–25,979 and geometric quadruples 9,292–10,610. A minimal UNSAT
core at face 1 — 5 conditions over 11 faces, found by bisection over the shipped
*closure*, which unlike the search **is** monotone so the bisection is sound —
contains `triple(185, 9, 185, 11)`, carried by ten of the eleven failing frames
and **no folding frame**.

**Root cause: `extents_overlap` mixed frames.** It computed `shift` along `a`'s
direction and then used `b.span`, b's extent in **b's own frame**, without
projecting through `dot(a.direction, b.direction)` — so an antiparallel canonical
direction reversed b's interval and flipped the gate that decides whether a chord
pair emits a condition at all. Fixed by projecting b's endpoints into a's frame,
plus giving the `chord_pair` call site the real slack its siblings
(`interleavings`, `census::coincident`) already use.

**This is R10, un-refuted.** R10 recorded the same fix as measurably harmful:
`cant_fold` 4/21 → 0/21. That measurement was correct *on the broken search* and is
now obsolete. It was open question 4 in this log, and the answer is yes.

**Measured A/B, same tree, one file changed:**

| | without the fix | with it |
| --- | --- | --- |
| `stick on a floor - failure.osf` | **10 / 21**, worst 371 ms | **21 / 21**, worst 254 ms |
| `full_iguana_non_flat_failing.fold` | 21 / 21, 663 ms | 21 / 21, 663 ms |
| `cant_fold.fold` | 21 / 21, 34 ms | 21 / 21, 35 ms |
| `failed_layer_ordering.fold` | 21 / 21, 19 ms | 21 / 21, 20 ms |
| `successful_layer_ordering.fold` | 21 / 21, 19 ms | 21 / 21, 19 ms |

`undetermined_pairs` 0 everywhere. 975 crate tests; folding oracle 29/29 and render
oracle 13/13 with `ORIEDITA_GEOMETRY_ORACLE` set; `folding3d_order` 22/22 including
both per-plane-trap tests, `folding3d` 10/10, `verify_fold_fixtures` 11/11,
`non_flat_corpus` 6/6.

**Also landed this round, cleanly:** the SipHash → `LocalEquivalenceCondition`
refactor deferred in Round 22. Conditions resolve to local permutation digits once
in `set_guide_map` instead of hashing face ids 4x per quadruple per permutation.
Purely representational. It arrived without the probe entanglement that forced the
Round 22 deferral, and is covered by the gate above.

**Every file in this investigation now folds at 21 of 21 starting faces.**

**Still open:** the derivation's non-equivariance is *reduced*, not eliminated —
`canonical_direction` still fixes a line's sign by scanning world components
against a 1e-12 bar, and `frame_for` still picks the most-perpendicular world axis.
The extents fix removes the consequence measured here; it does not make the frame
choice intrinsic. A model that trips a different consequence of the same
non-equivariance would look exactly like this one did.


### Round 32 — `hex head 2` is the first PROVEN-TRUE `NoLayerOrder`, and the "zero-FullFold regime" does not exist (2026-08-29)

**Two answers, and the first one voids the brief this round was given.
(1) `hex head 2 by Naoki Terao.osf` is not a zero-FullFold model: 290 of its 442
segments are 180-degree creases and they produce 290 `FullFold` seeds, 63% of the
seed set. (2) The shipped setup AEA proves the instance UNSATISFIABLE in 1 ms, on
the geometric core alone, and the minimal core is 4 taco-tortilla triples and 8
`FullFold` seeds over 8 faces in one plane — no `Wall`, no `SharedSlot`, no
coupling, no irregular angle anywhere in it. This is the only file in the
investigation whose `NoLayerOrder` is not demonstrably false.** *Measured.*

**The premise correction, first, because three of the brief's signatures rest on
it.** The brief's fold-magnitude census — `0 deg x336, 41.81 x73, 90 x30, 109.47
x1, 112.34 x2` — is the `LineSegment::fold_magnitude` **field** read literally.
`None` on a `Red1`/`Blue2` crease *is* 180 degrees; the field's own doc says so
("`None` is the **canonical** representation of 180 degrees"). Counted from the
file: 46 `Black0` borders and 290 `Red1`/`Blue2` creases carry `mag=None`. Read
through `Placement3d::fold_angle_radians` instead, the census is **180.0000 x290,
41.8103 x73, 90.0000 x30, 112.3391 x2, 109.4712 x1**. The pangolin control is the
same shape (527 at 180). The model is FullFold-dominated exactly like every other
file here, and every question in the brief's task 4 ("is a rule implicitly
assuming a flat-fold context") is moot: it *is* a flat-fold context, 63% of it.

**The starting-face invariance is an artefact of Rounds 28-31, not a new
animal.** FNV over the unordered multiset of all 6,376 seeds, triples,
quadruples and couplings, at starting faces 0-11:

| sf | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fingerprint | `b86f8eb1b493b415` at **all twelve** |||||||||||

One instance, not twelve. "0 of 12" therefore carries **zero** information — the
starting-face sweep, which is what found every earlier bug, is now dead as a
diagnostic on any model the extents fix makes equivariant. Cross-frame witness
replay (Rounds 4, 23) is dead here for the same reason: there is no other frame.

**Census against the control.** Both at sf=0, both invariant across the sweep:

| | `hex head 2` (fails) | `hex pleated pangolin` (folds 12/12) |
| --- | --- | --- |
| segments / faces | 442 / 245 | 683 / 365 |
| **planes** | **23** (96, 56, 11, 11, 10, 9, 7, 7, 6, 5, 5, 3, 3, 1x9) | **6** (133, 98, 98, 12, 12, 12) |
| census pairs | 4,798 | 3,780 |
| folded-line groups / coincident / cross-plane | 85 / 56 / 20 | 154 / 122 / 17 |
| seeds (FullFold / SharedSlot / Wall) | 463 (**290** / 115 / 58) | 647 (**527** / 48 / 72) |
| triples / geometric quads / couplings | 4,019 / 1,610 / 284 | 3,853 / 816 / 200 |
| cells / cell subfaces | 100 / 31 | 227 / 66 |
| **largest subfaces** | **76, 72, 64, 60, 54**, 26, 26, 24, 20, 16 | 26, 26, 25, 25, 25, 25, 24, 24, 23, 23 |
| constraint components | **1** (236 faces, 4,798 vars) | 1 (365 faces, 3,780 vars) |
| crossings | 0 | 0 |
| placement | `Folded`, 0 local crossings, loop gap 9.397e-8 deg / 2.157e-8 on span 346.410 | — |

The brief's recollection of "component 1, 56 faces" is stale: there is exactly
**one** component, and `NoLayerOrder { component: 0, faces: 236, variables: 4798 }`
is `ComponentSolver::new` exhausting its attempts, not `search_error`'s
face-ids-as-counts arm.

**The verdict is true about the instance, and the proof is 1 ms.** Through the
baseline's own `debug_plan_components` + `debug_aea_run` (no `src/` change), on
component 0:

| condition set | AEA closure |
| --- | --- |
| FULL (seeds + 1,136 cuts, 4,019 tri, 1,894 quad incl. 284 coupling, 315 subfaces) | **`Contradiction { 95, 228 }`** |
| FULL with removal (what the shipped path runs) | **`Contradiction { 95, 228 }`** |
| **geometric core** (463 seeds only, 4,019 tri, 1,610 geom quad, 31 real subfaces) | **`Contradiction { 95, 228 }`** |
| core, **triples only** | **`Contradiction { 95, 228 }`** |
| core, quadruples only | closed, 4,054 relations |
| core, no conditions | closed, 3,946 relations |

`AdditionalEstimation::run` makes only forced inferences, so a contradiction
there is a **proof** the instance has no solution. Same route as Round 23/31 on
`stick on a floor`, and the couplings are exonerated the same way — the core
contradicts without any of the scaffolding.

**The killer question: does the signal fire on files that fold? No — 0 of 6.**
Same probe, same binary, starting face 0:

| file | FULL | CORE | CORE tri-only |
| --- | --- | --- | --- |
| `cant_fold.fold` | closed 3,821 | closed 3,767 | closed 3,763 |
| `failed_layer_ordering.fold` | closed 2,360 | closed 2,324 | closed 2,288 |
| `successful_layer_ordering.fold` | closed 2,325 | closed 2,289 | closed 2,253 |
| `full_iguana_non_flat_failing.fold` | closed 50,919 | closed 50,541 | closed 50,497 |
| `stick on a floor - failure.osf` | closed 34,279 | closed 22,119 | closed 22,119 |
| `hex pleated pangolin` | closed 4,148 | closed 3,608 | closed 3,528 |
| **`hex head 2`** | **contradicts** | **contradicts** | **contradicts** |

(`stick` closing cleanly is the landed extents fix, re-confirmed from a seventh
harness.)

**Minimal UNSAT core: 4 triples + 8 seeds over 8 faces, 229 closure runs.**
Bisection over the closure, which is monotone in the condition set (R1 does not
apply). Every member is load-bearing — dropping any one triple, or flipping any
one seed, restores satisfiability, all 12 checked.

```text
TRIPLE crossed=43  taco=(237,103) from crease 377 (+180)
TRIPLE crossed=42  taco=(237,103) from crease 377 (+180)
TRIPLE crossed=225 taco=(42,43)   from crease  27 (-180)
TRIPLE crossed=42  taco=(101,43)  from crease  79 (-180)
SEED 42>43 (27)  101>43 (79)  101>102 (376)  237>101 (360)
     102>103 (81)  225>103 (330)  224>225 (378)  237>224 (361)   -- all FullFold, all +/-180
```

All 8 faces are in **plane 2**. The contradiction unwinds by hand: T4 forces
42>101, T2 then forces 42>237, T3 then forces 43>225, T1 then forces 43>237 —
against the seeds' 237>101>43.

**Every core item is a warranted, textbook flat-fold condition.** Traced back to
geometry:

| triple | route | evidence |
| --- | --- | --- |
| `43 / (237,103)` | `taco_and_hinge` | line 377's image lies on face 43's **border** (inside 0.0000, border 1.0000 of 2,001 samples); face 43 reaches the same folded-line group through crease **357** (-41.81 deg), and 357's plane-2 slot matches both of 377's slots |
| `42 / (237,103)` | `taco_and_hinge` | same, through crease **358** (+41.81 deg) |
| `225 / (42,43)` | `pierce_constraint` tortilla | line 27 runs through face 225's **interior**, inside 1.0000 |
| `42 / (101,43)` | `pierce_constraint` tortilla | line 79 runs through face 42's **interior**, inside 1.0000 |

Overlap areas for every pair involved are 135.3-270.6 paper units, so all four
are real ordering variables, not sliver pairs. **The `stick` mechanism is not in
play**: creases 377/357 and 377/358 share **12.5** units of folded line against a
slack of 3.464e-4 — four orders of magnitude clear of the gate — and the whole
group shares 12.5 pairwise.

**Nor is any tolerance load-bearing.** `distance_relative` swept into the whole
pipeline at sf=0: `NoLayerOrder`, byte-identical counts, at **1e-10, 1e-8, 1e-6,
1e-5, 1e-4, 1e-3** and still at 1e-2 (tri 4,019->4,015) and 3e-2 (tri 3,779). It
folds only at 1e-1, where the model is gone (tri 64). Below the band, 1e-12 gives
27 planes and a `ContradictorySeeds { 167, 46, (Wall, 190), (FullFold, 370) }`,
and 0 collapses the plane index to 242. `overlap_area_relative` likewise:
`NoLayerOrder` at 1e-4, a `Cells` refusal at 1e-3, and the model gone above.
Seven decades with no verdict change is the opposite of `stick`'s signature.

**Nor is it a seed-sign convention error.** Inverting an entire seed class and
re-closing the geometric core: `FullFold` inverted -> `Contradiction { 17, 196 }`;
`Wall` inverted -> `Contradiction { 25, 235 }`; `SharedSlot` inverted ->
`Contradiction { 32, 181 }`. No global sign choice rescues it.

**The brief's tasks 1-5, answered on their own terms.**

- **Wall seeds (task 2): 58, all sound as far as they can be checked, and none
  comes from an irregular angle.** Every one has `|dot(wall, plane.up)| = 1.000`
  exactly — 30 from -90 deg creases, 28 from +90 deg — with `|up| = |wall| = 1.000`.
  **0** have the anchor outside the pierced face's plane, **0** land off a census
  pair. Not one of the 73 creases at 41.81 deg, nor the 109.47 or 112.34 ones,
  produces a wall seed at all, so the "degenerate-but-symmetric at 180 versus not
  at 41.81" worry has no instance here. A private-geometry rebuild of `Crease` /
  `interior_direction` / `frame_for` from public fields reproduces the shipped
  decision on all 58, which validates the reconstruction rather than the rule; the
  rule itself is argued sound for any theta in (0, 180) in the note below.
- **SharedSlot seeds (task 3): 115, recomputed exactly, 0 off-census, 0
  disagreements** with an independently-argued wrap-order rule (the chord that
  leaves the shared slot at the smaller relative angle must sit on the
  winding-forward side). Not in the core.
- **Task 5 — seed consistency: clean.** 463 seeds over 456 distinct pairs, **0**
  pairs seeded in both directions, **0** non-trivial SCCs in the seed digraph
  (Tarjan over all 245 faces), **0** seeds on a non-census pair. Pangolin
  identical in shape (647 / 611 / 0 / 0 / 0). `ContradictorySeeds` not firing is
  therefore correct, and the weaker closure property it does not cover is broken
  only once the *conditions* are added.

**A separate latent hazard, found in passing and NOT implicated in this core.**
`Frame::angle` maps a direction into `[0, TAU)` by `if raw < 0.0 { raw + TAU }`,
so two **identical** directions can come back as `0.000000` and `6.283185`
depending on the sign of an `atan2` rounding. Measured on this model: crease 123
(faces 136/138, both plane 2, -180 deg) reports `intoAngles = (0.000000,
6.283185)` for what is one direction. `shared_slot` compares far angles with an
exact `first_far == second_far` and then with `<`, so a far slot that coincides
with the shared slot's direction across a plane boundary would be ordered by the
rounding rather than skipped. *Read-from-code for the consequence; measured for
the wrap.* Worth a bar rather than an exact compare, on its own merits.

**What this does and does not establish.** *Measured:* the derived instance is
unsatisfiable, by a proof that costs 1 ms; the minimal core is 12 items over 8
coplanar faces; every one of the 12 traces to a geometrically-verified
taco-tortilla or a 180-degree full fold; the placement is admitted `Folded` with
a 6.2e-11 relative loop gap and 0 crossings; and no tolerance, no seed class sign,
and no coupling changes the answer. *Not established:* that the **paper** admits
no stacking. That would need a witness from outside our derivation — the
constraint-derivation semantics themselves have not been independently
re-implemented, and R3 already rules out a per-plane Flat-Folder oracle. The
honest verdict today is that the search is telling the truth about what it was
handed, and the remaining doubt is entirely upstream of it, in whether
`taco_and_hinge`'s "the hinge's far face plays no part" simplification is exact
when the hinge leaves the plane at a non-right angle. Nothing here contradicts
it; nothing here proves it either.

**Gate.** No behaviour-changing change was made, so this gates a probe rather
than a fix. Nothing under `src/` was touched at any point: the round used only
the public API plus the baseline's existing `#[doc(hidden)]`
`debug_plan_components` / `debug_aea_run` / `debug_aea_run_with_removal`. The
controls above (six files closing cleanly, the pangolin folding 12/12 at 47-65 ms)
are what validate the harness.

**Instrumentation: removed.** One example, `crates/oristudio-cp/examples/zhex.rs`
(census / fingerprint / seeds / walls / slots / sweep / closure / core / explain /
group / flip / signs), **deleted**; a copy is at `<scratchpad>/zhex.rs.saved`.
Built once with `--release`. `git status` shows nothing of mine.
`examples/hexverdict.rs` and `examples/zpre.rs` in the tree are parallel sessions'.
No background process was left running.

### Round 33 — `hex head 2`: the pre-ordering stages are clean, measured stage by stage (2026-08-29)

**Numbered 33 because Round 32 landed while this was measuring. Same file, from
the other end: Round 32 audited the seeds and found the instance UNSAT; this
round audits everything *before* the constraint derivation — placement, plane
partition, folded lines, cells — which Round 32 did not measure. All four are
clean, with four to eight orders of margin, and every bar sits in an empty band.
So "upstream of ordering" is true but narrow: the defect, if there is one, is in
`build_constraints` and nowhere earlier.** *Measured*, from a separate harness
and a separate frozen tree. Where the two rounds overlap they agree to the digit,
including the same `Contradiction { 95, 228 }` — treat that as two harnesses.

Run in a frozen APFS snapshot, because the shared tree failed to compile twice in
ten minutes under parallel edits. In the snapshot `placement.rs`, `planes.rs`,
`census.rs`, `cells.rs` and `admit.rs` are **byte-identical to HEAD**, and
`constraints.rs` carries exactly the 12-line Round 29/30 baseline (`chord_pair`
slack + `extents_overlap` frame projection) and nothing more. Baseline
reproduced: 0 of 12 **and 0 of 25**, 100–106 ms, identical
`NoLayerOrder { component: 0, faces: 236, variables: 4798 }` at every face;
pangolin 12 of 12 at 43–45 ms. Instance fingerprint identical at **all 25**
starting faces (Round 32 measured 12; it holds to 25), and the pangolin is
1 distinct instance too — so the equivariance is the current tree's behaviour,
not something about this file.

#### 1 Placement

| | `hex head 2` | pangolin |
| --- | --- | --- |
| faces / segments / span | 245 / 442 / 346.410 | 365 / 683 / 461.880 |
| loop gap offset | 2.157e-8 = **6.23e-5 of bar** | 7.19e-12 = 1.56e-8 of bar |
| loop gap rotation | 1.640e-9 rad | 3.246e-13 rad |
| non-tree edges / vertex cycles | **152 / 152** | 251 / 251 |
| worst closure residual | 9.397e-8 deg = **9.40e-2 of bar** | 1.076e-11 deg = 1.08e-5 of bar |
| snapped creases / local crossings | 0 / 0 | 0 / 0 |

152 non-tree edges means the loop gap is a real self-check rather than the
vacuous zero of a tree dual graph. The prior investigation's "crossings 0,
residual 9.4e-8 deg" reproduces exactly.

**Interpenetration: 0 face pairs, and the test is demonstrably not vacuous.**
Every non-coplanar pair clipped to its two planes' intersection line, the
midpoint of the shared run tested for strict interiority in both polygons:
23,495 cross-plane pairs → 23,282 non-parallel → 1,774 both clipped → 630 with
overlapping intervals → **0 interior in both**. Widest shared run 50.0 units, all
of it along shared boundary edges. Pangolin: 47,948 / 37,912 / 3,324 / 957 / **0**.

**The closure residual is the only number in the whole pipeline within a decade
of a bar, and it is the authored decimals — not the walk.** 9.397e-8 deg against
`CLOSURE_RESIDUAL_BAR_DEGREES` = 1e-6. The irregular angles are given to seven
decimals (112.3390943 is `acos(-1/3)` to 7 dp), so ~1e-7 deg of rounding in the
*authored* angle is exactly what this looks like. It is why every residual on
this file sits ~4 decades above the pangolin's. It does **not** propagate:
everything downstream has four or more orders of margin. The brief's hypothesis
that irregular angles compose badly through the walk is directionally right about
the residuals and wrong about the consequence.

#### 2 Planes — the band around the bar is empty over 7.6 decades

23 planes, **0 alarms**, 36 topological classes; worst intra-plane normal
5.661e-10 rad (5.66e-3 of the 1e-7 bar), worst intra-plane offset 9.693e-12 of
span (9.69e-6 of the 1e-6 bar).

Writing `m = max(normal / angle_bar, offset / distance_bar)` over every face pair,
so `m <= 1` *is* `same_plane`:

| | worst INTRA-plane `m` | closest CROSS-plane `m` | empty band |
| --- | --- | --- | --- |
| `hex head 2` | 5.661e-3 (faces 74/152) | **2.182e5** (faces 97/170) | **7.6 decades** |
| pangolin | 1.362e-6 (184/342) | 6.250e4 (69/306) | 10.7 decades |

The closest cross-plane pair is one of 213 that are parallel within the angle bar
and **75.58 paper units apart** — 0.218 of span, which is also
`min_inter_separation_relative`. Cross-plane `m` by decade:
`{1e5: 213, 1e6: 9279, 1e7: 14003}`. **There is no near-coplanar pair anywhere on
this model**, so the brief's tolerance-mis-partition hypothesis — a good one, and
the one that would have explained a uniform fast failure — is dead. (The residual
formula is a transcription of `planes::compare`, checked against the public
`same_plane` on all 29,890 pairs: **0 disagreements**.)

#### 3 Folded lines — exactly collinear, R9's answer on a new file

85 groups, 56 coincident, 20 cross-plane; sizes
`1x29 2x17 3x9 4x10 5x2 6x4 7x1 8x3 10x2 12x1 13x1 15x1 16x1 22x1 30x1 31x1 42x1`.
Worst perpendicular deviation over **any** coincident group **5.618e-11 of span**
= 5.62e-5 of the 1e-6 bar. The five largest are far cleaner: 42 creases at
3.09e-15 of span, 31 at 2.76e-15, 30 at 2.13e-15, 22 at 2.51e-15, 16 at
1.31e-15 — **~3e-9 of the bar**, exactly collinear. Pangolin worst 1.446e-14.
**No over-merge.**

#### 4 Cells — sane, and the postconditions hold with a 7-decade bracket

Census 4,798 pairs over 245 faces (236 in overlap), 4,508 non-adjacent, 290
full-fold pairs. 100 cells, 31 subfaces, **14 groups / 14 components** (equal, so
nothing nested), **0 cells below the area bar**. Subface sizes
`3x4 4x6 5x4 6x1 7x3 8x1 9x2 16x1 20x1 24x1 26x2 54x1 60x1 64x1 72x1 76x1` — the
24-face subface the earlier investigation named is still there.

- Smallest surviving cell area 3.720 against an area bar of 1.200e-4 — **3.10e4x
  above it**.
- Area bracket: smallest accepted 6.809e-5 of span², largest rejected 3.459e-12,
  bar 1e-9 — **6.8e4x above and 3.5e-3x below**, an empty 7-decade band.
- Postconditions re-checked **independently of `cell_index`'s own `Ok`**, by
  building the within-subface pair set and differencing it against the census:
  `OverlapWithoutCell` **0**, `CellWithoutOverlap` **0**; the two sets are equal,
  4,798 pairs.

#### 5 The instance, and six disjoint cores

Same proof as Round 32, reached independently: full instance
`Contradiction { 95, 228 }`; geometric core with every coupling removed (463
seeds, 4,019 triples, 1,610 geometric quads, 31 real subfaces)
**same `Contradiction { 95, 228 }`**; pangolin closes at 4,148 and 3,608
relations. Class ablation on the core: seeds only **closes**, seeds+triples
**UNSAT**, seeds+quads **closes**.

**New here: the contradiction is not one bad condition. There are six disjoint
minimal cores, and all six live in plane 2.** Found by block-then-unit deletion,
removing each core's conditions from the pool and re-minimising (982 ms total):

| core | seeds | triples | quads | faces |
| --- | --- | --- | --- | --- |
| 1 | 3 | 2 | 1 | 49, 71, 116, 118 |
| 2 | 4 | 2 | 0 | 71, 116, 117, 118, 182 |
| 3 | 7 | 4 | 3 | 49, 51, 71, 89, 90, 116, 117, 118, 182, 203 |
| 4 | 6 | 3 | 1 | 44, 45, 80, 102, 103, 224, 225, 237 |
| 5 | 5 | 2 | 1 | 43, 80, 101, 102, 103, 237 |
| 6 | 4 | 4 | 0 | 42, 43, 80, 101, 102 |

Round 32's single core (faces 42, 43, 101, 102, 103, 224, 225, 237) is a merge of
cores 4–6; different deletion orders give different minimal cores of the same
instance, and both are valid. **Dropping those 23 conditions of 5,629 makes the
whole instance close at 4,593 relations = 95.73% of the 4,798 variables.** 15 of
the 23 are triples. Plane 2 holds 56 of the 245 faces and 100% of the trouble.

**Core 1, unwound.** Seeds, all `FullFold`: `118>49` (crease 99), `71>116`
(crease 98), `118>116` (crease 284). Triples `T(a=71, b=118, d=116)` and
`T(a=49, b=118, d=116)`; quad `Q(a=71, b=116, c=118, d=49)`. Forced: `71>116`
plus T1 gives `71>118`; `118>49` plus T2 gives `116>49`; the quad then fires
`infer_above(116, 118)` against the seed `118>116`.

**The geometry behind core 1 is real, which is the finding that matters.** Faces
49, 116, 118 are three **coincident** triangles (area 135.3165 each), face 71
covers them (270.6329); all six pairs are census pairs with intersection area
exactly 135.316469 (1.128e-3 of span²). Creases 98 and 99 are collinear to
**1.26e-13 = 3.6e-16 of span** and share their **full 25.0-unit extent**. The two
triples come from `taco_and_hinge` (`constraints.rs:575`), not from
`pierce_constraint` — `Polygon::inside` returns `Border` inside
`Epsilon::UNKNOWN_001` = **1e-4 absolute**, and these creases sit on each other's
boundary edges at ~1e-13, so `interior_spans` skips them. The hinges are in
folded-line **group 26**, the seam between plane 2 and plane 15: nine hinges at
**±41.8103149 deg** each joining a plane-2 face to a plane-15 face, plus three
±180 full folds inside plane 2 (lines 283, 284, 287). In one common parameter
along the group, crease 284 shares **12.5 units** with all eleven others,
including line 46 (face 71) and line 280 (face 49) — four and a half orders clear
of the 3.464e-4 gate slack. **The `stick on a floor` sliver mechanism is not in
play**, which corroborates Round 32's 12.5 from the other core.

#### Calibration, and one note on Round 32

*Measured*: stages 1–4 are clean with the margins above; the instance is UNSAT;
it stays UNSAT with every coupling removed; it reduces to six small cores all
inside plane 2; core 1's conditions are admitted on 12.5 and 25.0 units of real
shared extent.

*Not established*: **that the paper admits no stacking.** Round 32's heading says
"the first PROVEN-TRUE `NoLayerOrder`" and its own closing paragraph says the
opposite — "*Not established:* that the **paper** admits no stacking" — which is
the correct reading. What both rounds prove is that the search is honest about
the instance it was handed. The remaining doubt is entirely in the derivation, and
after this round it is one question: is `taco_and_hinge`'s rule (with
`normalized`'s orientation and `same_slot`'s side test) exact where a ±180 full
fold inside a plane shares a folded line with a hinge that leaves that plane at
41.81 deg? Every earlier file was lost in the enumeration or to a sliver at a
zero-slack gate. This one is neither. **Do not record it as a true verdict until
something outside the derivation says so.**

Also worth landing on its own: `close_component_hierarchy`'s
`Err(_) => Ok(hierarchy)` throws the 3 ms proof away and the search spends 91 ms
rediscovering "no" by a route that is not a decision procedure — the same wasted
signal Round 23 flagged on `stick on a floor`, now on a second file.

**Not run:** no behaviour-changing change was made, so `cargo test` and the
Oriedita oracle would have gated a probe rather than a change; the pangolin
control (12/12, 0 undetermined, 0 crossings) and the reproduced 0/25 baseline are
what validate the snapshot. The shared tree also would not compile for parts of
this round.

**Instrumentation: all removed.** One example,
`crates/oristudio-cp/examples/zpre.rs` — the one Round 32's closing note calls "a
parallel session's" — **deleted**; a copy is at `<scratchpad>/zpre.rs.saved`.
Nothing under `src/` was touched at any point. Sections 5's closure probes use
the baseline's existing `#[doc(hidden)]` `debug_plan_components` /
`debug_aea_run`; everything else is public API. No background process was left
running.

**Collision worth knowing about.** The shared tree's `constraints.rs` moved from
the 12-line baseline to 111 changed lines, and `order.rs` from 246 to 318, while
this round was measuring. Every number above is pinned to the 12-line baseline.
Re-measure before trusting them against the tree as it stands.

### Round 34 — `interleavings` corroborates the cores, which is the thing Rounds 32 and 33 said was missing (2026-08-29)

**Numbered 34 because Rounds 32 and 33 landed on this same file while this was
measuring. A fourth harness, run independently; where we overlap we agree to the
digit — same `Contradiction { 95, 228 }`, same 24-face subface, same 12.5-unit
shared extent, and my smallest core is Round 33's core 2 exactly. Three things
neither round ran: (1) the sanctioned independent re-derivation `interleavings`
over a minimally-relaxed witness, which reports self-intersection at **all six**
core face sets; (2) the core rebuilt in global ids from `build_constraints`
alone, taking `plan`, `cells` and the localisation out of the trust chain; (3)
the seed-reversal control, which kills the "a plane's `up` was chosen the other
way" hypothesis outright. On this evidence I do read the verdict as true, with
the residual named at the bottom.** *Measured.*

**Baseline reproduced**, shipped public API, no instrumentation: `hex head 2 by
Naoki Terao.osf` **0 of 12**, 97–104 ms,
`NoLayerOrder { component: 0, faces: 236, variables: 4798 }` at every face;
`hex pleated pangolin by Naoki Terao.osf` folds at 41–44 ms with 3,780 relations
and 0 undetermined. Both admitted `Folded`, 0 local crossings, worst closure
residual 9.397e-8 deg and 1.076e-11 deg on spans 346.410 and 461.880.

**The premise correction, reached independently of Round 32's.** Read through
`LineSegment::fold_magnitude` **by colour**, `hex head 2` is
`Black0 classic x46; Blue2 classic x150, 41.8103149 x24, 90 x14, 109.4712206 x1;
Red1 classic x140, 41.8103149 x49, 90 x16, 112.3390943 x2`. `classic` is 180 —
the field's own doc says `None` is the canonical 180 — so there are **290**
±180 creases, and `build_constraints` emits **290 FullFold seeds** of 463
(SharedSlot 115, Wall 58). Round 32 has this from the placement side; this is the
same finding from the document side.

#### The AEA test, and where the contradiction lives

Component 0 at sf=0: 236 faces, 4,798 variables, 315 subfaces (**31 real** cell
subfaces + 284 synthetic), 463 seeds + 1,136 cuts, 4,019 triples, 1,894 quads
(1,610 geometric + 284 coupling).

| instance | closure |
| --- | --- |
| FULL, `run_with_removal` (what `close_component_hierarchy` runs) | `Contradiction { 95, 228 }`, **1 ms** |
| FULL, `run` | `Contradiction { 95, 228 }`, 1 ms |
| **bare geometric core** (31 real subfaces, 463 seeds, 4,019 tri, 1,610 geom quad) | **`Contradiction { 95, 228 }`**, 1 ms — global faces (102, 237) |
| core, seeds only | closes, 3,946 relations |
| core, seeds + triples | `Contradiction { 95, 228 }` |
| core, seeds + geometric quads | closes, 4,054 relations |

Per real subface, alone, with only the conditions all four of whose faces it
holds: **29 of 31 close**; subface 13 (24 faces) gives `Contradiction { 95, 228 }`
and subface 14 (16 faces) gives `Contradiction { 83, 65 }`. So the 24-face
subface the earlier investigation named is one of **two** independently
contradicting subfaces, not the whole story.

#### Six cores, invariant over the sweep, and 0 on every control

Peeling minimal cores off the geometric core one at a time (ddmin over the
closure, which is monotone; each core's conditions removed before re-minimising):

| # | conditions | faces (global) |
| --- | --- | --- |
| 1 | 2 | 71, 116, 117, 182 |
| 2 | 4 | 42, 43, 101, 103, 225, 237 |
| 3 | 2 | 80, 102, 103, 237 |
| 4 | 4 | 49, 50, 71, 116, 118 |
| 5 | 3 | 49, 71, 116, 117, 118, 182 |
| 6 | 3 | 43, 80, 101, 102 |

**Identical, core for core and face for face, at all twelve starting faces.**
That is the whole of signature 1 in the brief: "0 of 12" is one instance measured
twelve times, so the uniformity carries no information about the failure — it is
the Round 29/30 fixes having made this derivation equivariant. (Round 33 gets the
same from a fingerprint over 25 faces; this is the same fact read off the cores.)

Different deletion orders give different minimal cores of one instance, so this
list and Round 32's single 12-item core and Round 33's six are all valid and not
in conflict; my core 1 **is** Round 33's core 2, found from a different harness.

**Falsification control — the peel finds nothing on anything that folds.** Same
binary, faces 0/1/2: `hex pleated pangolin` **0 cores**, `stick on a floor -
failure.osf` **0**, `stick on a floor 2 - working.osf` **0**, `540-level-0.osf`
**0**. The signal is not something this method manufactures.

#### Rule provenance, and the class ablation

A default-off provenance sink on the three `push` sites tags every emitted
condition with the rule that made it. On the geometric core: **1,610 `taco_taco`
quads, 3,659 `tortilla_pierce` triples, 360 `taco_and_hinge` triples**. Of the 18
conditions in the six cores: **9 `taco_and_hinge`, 7 `tortilla_pierce`, 2
`taco_taco`** — three rules, and every core contains at least one
`taco_and_hinge`.

| class dropped | AEA over the core | shipped search on the 31 real subfaces |
| --- | --- | --- |
| `taco_and_hinge` (360) | closes, 4,413 relations | **FOUND**, 4,798 relations, 22 ms |
| `tortilla_pierce` (3,659) | `Contradiction { 95, 94 }` | no stacking, 422 ms |
| `taco_taco` (1,610) | `Contradiction { 95, 228 }` | no stacking, 224 ms |

So `taco_and_hinge` is necessary for all six cores — which makes it the natural
suspect, and is why the next two measurements matter.

#### The witness manufacture, and what `interleavings` says about it

Withhold **exactly the 18 core conditions** of 5,629 — the smallest relaxation
that can admit any witness at all — and the shipped search finds a complete
assignment of all 4,798 variables in 43 ms, with **0** seed or cut conflicts.
Replayed into the FULL instance with the shipped predicates
(`apply_triple_condition` / `apply_quadruple_condition`) it violates 8 triples,
all of them withheld ones. Then the independent re-derivation:

| relaxation | search | `interleavings` on the answer |
| --- | --- | --- |
| withhold the 18 core conditions | FOUND, 4,798 relations | **94 crossings**, 0 unordered |
| drop the whole `taco_and_hinge` class | FOUND, 4,798 relations | **166 crossings**, 0 unordered |

**And the crossings land on the cores.** Every one of the six core face sets
appears in those 94 crossings — 3, 3, 3, 2, 4 and 2 crossings respectively share
two or more faces with a core, and **every face of every core is present**.
`interleavings` shares neither `slot_winding`, nor `normalized`'s role
assignment, nor any of the three emission rules: it ranks each slot's faces from
the relations alone and asks whether two chords interleave. So a second route,
from the placed geometry, says the paper passes through itself at exactly the
places the cores name. This is what Rounds 32 and 33 both list as not
established; on every earlier file in this investigation the same measurement
returned **0**.

#### Core 1 in full, with `plan` taken out of the trust chain

Five faces, all in **plane 2**, all ten pairs census pairs. Projected rings:
116, 117 and 118 are the *same* 30-60-90 triangle; 182 is a convex quad
containing it; 71 is a triangle containing it.

```text
seeds (all FullFold)   71>116 (crease  98, -180, Red1)    116>117 (crease  97, +180, Blue2)
                      118>116 (crease 284, -180, Red1)    182>118 (crease 285, +180, Blue2)
                      182>117 (crease 283, +180, Blue2)   <- present, not needed; minimal set is 4
T1  a=71  b=182 d=117   taco_and_hinge, taco = crease 283 (117|182, +180, in plane 2),
                        hinge = crease 46 (70|71, +41.8103149, planes 15/2)
T2  a=182 b=71  d=116   tortilla_pierce, crease 98 (71|116, -180) through face 182's interior
```

Unwound: seeds give `182 > 118 > 116 > 117` and `71 > 116`. T1 says 71 is not
between 117 and 182, and 71 > 117 is forced, so **71 > 182**. T2 says 182 is not
between 71 and 116, and 182 > 116 is forced, so **182 > 71**.

Rebuilt in **global** face ids straight from `build_constraints`, one subface
`[71,116,117,118,182]`, `plan` / `cells` / the localisation not involved:

| | result |
| --- | --- |
| 5 global seeds + T1 + T2 | **`Contradiction { 116, 182 }`** |
| T1 alone | closes, all 10 pairs decided |
| T2 alone | closes, 9 relations |
| **every seed reversed** | **`Contradiction { 182, 116 }`** |
| any one of the four load-bearing seeds flipped | closes |

The reversal row is the point: if a plane's `up` had been chosen the other way,
every seed in that plane would flip together, and both conditions are symmetric
under a global reversal — so **no `up` choice can manufacture this core.** What
*is* load-bearing is the individual M/V read at each of the four creases, and
those are ordinary Red1/Blue2 ±180 creases between faces whose normals are ±z to
1e-15.

**The geometry behind both conditions, measured.** T1's taco (crease 283) and
hinge (crease 46) are collinear to ~2e-14 and share **12.500000** units of folded
line with `dot(direction, direction) = 1.000000000`, against a gate slack of
3.46e-4 — the `stick on a floor` sliver mechanism is four orders of magnitude
away. Face 71's interior direction at crease 46 is `[0, 1, 0]` and both taco
faces' are `[~0, 1, ~0]`: the same slot, by a dot of 1.0, not by a rounding.
T2's crease 98 is the **diagonal of the convex quad** 182 (its four cross
products are all negative, so the quad is convex and a diagonal is strictly
interior), joining two non-adjacent vertices of it.

**On Round 33's remaining doubt** — whether `taco_and_hinge` is exact when the
hinge leaves the plane at 41.81 deg rather than 90. *Read-from-code, not
measured:* it cannot matter for a triple. `apply_triple_condition` reads only
`(a,b)` and `(a,d)` and is symmetric in `b`/`d`, so `normalized`'s orientation is
inert on triples and no sign or winding enters. The rule's only inputs are "the
taco is degenerate", "the hinge's near face is in the same slot" and "the extents
overlap", and the far face's angle enters only through `same_slot` deciding it is
*not* in that slot — here face 70 is in a different plane entirely, so 41.81
versus 90 changes nothing. The `interleavings` corroboration above is the
measured half of the same answer.

#### Calibration

*Measured:* the instance is unsatisfiable by a 1 ms forced-inference proof; it
stays unsatisfiable with every coupling, every cut and the whole localisation
removed; it decomposes into six small cores that are identical at all twelve
starting faces and absent from four control files; the minimally-relaxed witness
is refused by `interleavings` at all six of them; and no global sign choice
rescues it.

*Not measured:* an implementation of the taco/tortilla semantics independent of
ours. R2 rules out building one and R3 rules out the per-plane oracle, so
`interleavings` is the strongest available check, and it is only partly
independent — it shares `crease_slots` and `Frame` with the generator. I read the
verdict as **true**; a reader who wants certainty should treat the shared
`crease_slots` layer as the one remaining place a common-mode error could hide.

**Also worth landing, third round in a row:** `close_component_hierarchy`'s
`Err(_) => Ok(hierarchy)` throws away a 1 ms proof, and the search then spends
97–104 ms per starting face rediscovering "no" by a route that is not a decision
procedure. On a model where the AEA contradicts on the **bare geometric core**,
with no coupling scaffolding anywhere in it, the discard's stated justification —
"the scaffolding disagrees with itself" — does not apply, and the pass could be
promoted to a verdict under exactly that condition.

**Gate.** No behaviour-changing change was made, so this gates a probe. The
controls above are what validate it: four files with 0 cores, the same-author
pangolin folding with 0 undetermined, and the reproduced 0/12 baseline.

**Instrumentation: all removed, and the tree is byte-identical to the baseline it
started from** — same five md5s, same `30/1  32/1  239/44  9/3  230/16`
diffstat. What existed: `#[doc(hidden)] debug_aea_run` /
`debug_aea_run_with_removal` / `debug_violated_conditions` in `folding.rs`,
`DebugComponent` / `debug_plan_components` plus a thread-local sink in
`folding3d/order.rs`, and `DebugProvenance` / `debug_creases` /
`debug_record_provenance` / `debug_take_provenance` plus a `note(...)` call at
the three condition-push sites in `folding3d/constraints.rs`. One example,
`crates/oristudio-cp/examples/hexverdict.rs` (sweep / core / explain / classify /
peel / minicheck / faces / bisect / relax), **deleted**; copies at
`<scratchpad>/hexverdict.rs.saved` and
`<scratchpad>/hexverdict_probe_plus_baseline.diff` (which also carries the
uncommitted baseline, so re-apply selectively). Built once with `--release`. No
background process was left running.

### Round 35 — adversarial re-verification: the instance is UNSAT, but the whole verdict hangs on `taco_and_hinge` (2026-08-29)

**Rounds 32–34's instance-level result reproduces exactly, from a closure written
from the semantics rather than transcribed from `AdditionalEstimation` — and one
new measurement changes how much it is worth.** Splitting the 4,019 triples by
emission site, the contradiction is carried **entirely** by the 360 that
`taco_and_hinge` wrote. Withhold that one class and the closure closes at 4,413
relations. `taco_and_hinge` has **no unit test, no fixture and no oracle**, and on
every other corpus model it is **inert** — the closure is relation-for-relation
identical with and without it. So the step from "the derived instance is
unsatisfiable" (measured, solid) to "the paper does not fold" (the reading Round
34 adopted) rests on a single rule that has never once changed an answer.
*Measured.*

**Baseline, reproduced.** `hex head 2` 0/12 at 100–107 ms, identical
`NoLayerOrder { component: 0, faces: 236, variables: 4798 }`, `undetermined = 0`
at every starting face. `hex pleated pangolin` 12/12 at 44–47 ms. Round 32's
census reproduces field for field: 245 faces / 442 segments / 23 planes / 4,798
census pairs / 100 cells / 31 subfaces / top sizes `[76,72,64,60,54,26,26,24,20,16]`
/ seeds 463 (FullFold 290, SharedSlot 115, Wall 58, **0 off-census**) / 4,019
triples / 1,610 geometric quads / 284 couplings / 0 crossings.

**The brief's premise is confirmed wrong.** Read through
`Placement3d::fold_angle_radians`, the census is **180.0000000 ×290**, 41.8103149
×73, 90 ×30, 112.3390943 ×2, 109.4712206 ×1, not-a-crease ×46. `None` on a
`Red1`/`Blue2` segment *is* 180 (`geometry/line_segment.rs:211`). There is no
zero-FullFold regime.

**An independent closure, and it agrees to the relation.** Written against the
public API (`build_constraints` + `cell_index` + `census_placement`) with three
rules stated from their semantics — subface transitivity, "a is not between b and
d", and taco-taco non-interleaving applied by *enumerating the 24 orders of the
four faces* rather than transcribing `check_quad`:

| file | seeds only | seeds+triples | seeds+quads | geometric core |
| --- | --- | --- | --- | --- |
| `hex head 2` | 3,946 | **CONTRADICTION (237, 80)** | 4,054 | **CONTRADICTION (237, 80)** |
| `hex pleated pangolin` | 3,260 | 3,528 | 3,304 | 3,608 |
| `cant_fold` | 3,368 | 3,763 | 3,368 | 3,767 |
| `failed_layer_ordering` | 1,751 | 2,288 | 1,751 | 2,324 |
| `successful_layer_ordering` | 1,735 | 2,253 | 1,735 | 2,289 |
| `full_iguana_non_flat_failing` | 44,632 | 50,497 | 44,648 | 50,541 |
| `stick on a floor - failure` | 21,845 | 22,119 | 21,845 | 22,119 |

Every count matches Round 32's AEA numbers exactly. Six controls close; only
`hex head 2` contradicts. **Every condition names real ordering variables**: 0 of
8,038 triple pairs and 0 of 9,660 quad pairs are off the census, so the "a
condition over a pair that is not a variable" unsoundness route is closed.

**A complete UNSAT proof that uses no closure at all.** Deletion over the triple
set finds the same four conditions Round 32 named — `a=43 taco=(237,103)`,
`a=42 taco=(237,103)`, `a=225 taco=(42,43)`, `a=42 taco=(101,43)` — over six
faces `{42,43,101,103,225,237}`, all in plane 2. Those six lie inside one
subface, so a total order is forced, and **all 720 stackings** were enumerated
against the 15 constraint items entirely inside the set (5 FullFold seeds, 8
triples, 2 quads): **none satisfies them.** That is a decision procedure, not a
forced-inference argument, and it is independent of `AdditionalEstimation`.
Exhaustive MUS enumeration over 2¹⁵ subsets gives **5 minimal unsatisfiable
subsets**, and **every one of them contains `triple[5] a=43 taco=(237,103)`** — a
`taco_and_hinge` condition.

**The geometry behind the core is real, with 4–5 orders of margin.** Faces
43/101/103 are three coincident triangles of area 135.316469; 42/225/237 are
larger polygons of 270.632939 covering them; all 15 pairs are census pairs at
135.316469–270.632939. Five ±180 FullFold seeds (lines 27, 79, 330, 360, 377).
Lines 377, 357 and 358 are collinear to ~1e-13 of a 346.410 span and **share the
full 12.500000-unit stretch** against a `chord_pair` slack of **3.464e-4**. So the
`stick on a floor` zero-slack sliver mechanism is four and a half orders from
firing here.

**The split that matters.** Classifying each triple by whether the taco's folded
image runs through the crossed face's *interior* (`pierce_constraint`) or merely
lies on its *border* (`taco_and_hinge`), by sampling the line against the
polygon:

| file | pierce | hinge | hinge-crease angles | all triples | pierce only |
| --- | --- | --- | --- | --- | --- |
| `hex head 2` | 3,659 | **360** | 90 ×228, **41.8103149 ×132** | **CONTRADICTION** | **CLOSED 4,413** |
| `hex pleated pangolin` | 3,587 | 266 | 90 ×242, 60 ×24 | 3,608 | 3,608 |
| `cant_fold` | 3,374 | 27 | 90 ×27 | 3,767 | 3,767 |
| `failed_layer_ordering` | 2,217 | 27 | 90 ×27 | 2,324 | 2,324 |
| `successful_layer_ordering` | 2,183 | 27 | 90 ×27 | 2,289 | 2,289 |
| `full_iguana_non_flat_failing` | 50,746 | 241 | 90 ×241 | 50,541 | 50,541 |
| `stick on a floor - failure` | 21,839 | 3,456 | 90 ×3,456 | 22,119 | 22,111 |

The 3,659/360 split reproduces Round 34's provenance census exactly. The new
column is the last one: **`taco_and_hinge` changes nothing on five of six
controls** (and 8 relations of 22,119 on the sixth), and on `hex head 2` it is the
difference between a closed hierarchy and a contradiction. `hex head 2` is also
the only file whose hinge triples come from a non-right-angle hinge in any
quantity (132 at 41.8103149°; the pangolin's 24 at 60° are inert).

**`interleavings` is not independent for this rule.** Round 34 reads its 94
crossings on the minimally-relaxed witness as corroboration. Read the code
(`constraints.rs:1015`): for a taco/hinge chord pair it puts all three same-slot
faces on one ray, displaces each by `1e-9 * (1 + rank)` along `-up`, and asks
whether exactly one of the hinge's two endpoints falls in the taco's sliver arc.
The far endpoint is at a different angle and is therefore always outside, so the
test reduces to "is the hinge's near face between the taco's two faces" — which is
`taco_and_hinge` restated in the ε-lift model, not a second derivation of it. It
would have to report those crossings whether the rule is right or wrong.

**Where the rule stands.** I reconstructed its argument independently and I
believe it: the taco's hairpin closes a pocket in the slot over the shared stretch
of line, and a face inside that pocket whose paper must reach *any* other angle
has to cross the hairpin — which is true for a hinge at 41.81° exactly as at 90°,
so the doc's "the hinge's far face plays no part" reads as sound for every angle
in (0°, 180°). Nothing in the implementation looked wrong either: `normalized` is
inert on triples (`apply_triple_condition` is symmetric in `b`/`d`), `degenerate`
⇔ full fold, and `same_slot` is a plain same-plane-same-side test. But that is an
argument, not a measurement, and it is the only thing carrying the verdict.

**Other sensitivities, for the record.** Flipping the core's `42>43` (line 27) or
`225>103` (line 330) FullFold seed also makes the six-face core satisfiable;
flipping `101>43`, `237>101` or `237>103` does not. So the local core has three
single-item explanations, not one — the taco_and_hinge triple is distinguished by
being the only one whose *class* also resolves the global contradiction.

**Verdict.** The instance-level claim — the derived constraint set is
unsatisfiable, the search's `NoLayerOrder` is honest about it, and no other file
in the corpus behaves this way — is **confirmed**, independently and by a
decision procedure. The paper-level claim — that `hex head 2` admits no layer
order — is **not established**, and should not be published until
`taco_and_hinge` is tested. It is the single load-bearing rule, it has no test,
and it is inert everywhere else; that combination is exactly the profile of a
rule nobody would notice being wrong.

**Gate.** `cargo test -p oristudio-cp --release --lib --tests`: all suites pass
(343 lib + 51 targets, 0 failed). `folding3d_order` 22/22 including both named
traps — `the_coupled_strip_is_solved_across_its_two_planes` and
`the_coupled_strips_second_plane_is_decided_only_by_the_coupling`. Oriedita
folding oracle **with `ORIEDITA_GEOMETRY_ORACLE` set**: 29 passed in 13.92 s (a
live run, not a skip). External corpus
`corpus_ordering_reports_every_model`: **admitted models 28; ordered 27**, the
only holdout `airplane.fold` — no regression (nothing under `src/` was touched).
`cargo test` over *all* targets could not run: a parallel session's
`examples/zver35.rs` does not compile against the current `src/`
(`no method named directed_crease_public`); left alone per the parallel-agents
rule.

**Instrumentation.** One example, `crates/oristudio-cp/examples/hh_adv.rs`
(sweep / census / closure / core / classify / mus / explain), **deleted**; copy at
`<scratchpad>/hh_adv.rs.saved`. Nothing under `src/` was changed — every number
above comes from the public API. Built once with `--release`. No background
process left running.

### Round 36 — the `taco_and_hinge` doubt is closed by measurement, and the core is one crease's M/V from folding (2026-08-29)

**Numbered 36 because a parallel session's Round 35 landed while this was
measuring, and the two agree where they overlap: same 360 `taco_and_hinge`
triples, same 4,413 relations when the class is withheld, same "every core needs
one". Round 35's complaint is that the rule has no test, no fixture and no
oracle and is inert everywhere else. This round supplies the missing check —
`interleavings` agrees with it 24/24 and 120/120 on the two seams where it is
load-bearing, both at 41.81 deg.**

**Verifying Round 34's reading rather than re-deriving it, from a fifth harness
that shares no code with the AEA. Three things are new. (1) The
unsatisfiability reproduces from a closure I wrote from scratch — per-subface
transitivity plus `check_triple`/`check_quad`'s own algebra, never calling
`AdditionalEstimation` — and lands on the same faces to the digit. (2) The one
open question Rounds 32-34 all left standing, whether `taco_and_hinge` is exact
for a hinge leaving the plane at 41.81 deg, is now **measured**: over every
total order of a core's faces, `interleavings` agrees with that condition
**24 of 24** and **120 of 120**. (3) `interleavings` is structurally **blind to
tortillas** — it only pairs creases sharing a folded line — so Round 34's "94
crossings" corroborates the hinge and taco-taco conditions and says nothing
about the 3,162 tortilla triples. Net: I read the verdict as true about the
**document**, with a sharper statement of what that means than the log has so
far.** *Measured.*

**Baseline reproduced**, public API only: `hex head 2` **0 of 12**, 103-106 ms,
`NoLayerOrder { component: 0, faces: 236, variables: 4798 }` at every face;
`hex pleated pangolin` **12 of 12**, 49-51 ms, 3,780 relations, 0 undetermined.
Census at sf=0 matches Rounds 32-34 exactly: 245 faces, 23 planes, span 346.410,
seeds 463 (FullFold **290** / SharedSlot 115 / Wall 58), 4,019 triples, 1,610
geometric quads, 284 couplings, 0 crossings. The brief's "no flat folds" is the
`fold_magnitude` field read literally, as Rounds 32-34 found; through
`fold_angle_radians` the census by join is 180 x290 (140 at -180, 150 at +180),
41.8103149 x73, 90 x30, 112.3390943 x2, 109.4712206 x1.

#### The closure, rewritten from scratch, agrees to the digit

Not `debug_aea_run`: a table over global face ids, seeded from
`build_constraints`, closed by per-subface transitivity over `cell_index`'s own
subfaces plus the two condition rules transcribed from
`additional_estimation.rs`. Same answer, 1 ms:

| instance | mine | Round 32/34 |
| --- | --- | --- |
| `hex head 2` full geometric core | **CONTRADICTION at global (102, 237)** | `Contradiction { 95, 228 }` = global (102, 237) |
| seeds only | closed, **3,946** | 3,946 |
| seeds + triples | CONTRADICTION (102, 237) | contradicts |
| seeds + geometric quads | closed, **4,054** | 4,054 |
| `hex pleated pangolin` core | closed, **3,608** | 3,608 |
| pangolin seeds only / +triples / +quads | 3,260 / 3,528 / 3,304 | 3,260 / 3,528 / — |

Identical at sf = 0, 1, 2 on both files. **The killer question: it fires on
`hex head 2` and not on the same-author control** — scanning each real subface
alone, `hex head 2` has **two** contradicting subfaces (13 and 14) and the
pangolin has **zero**, at all three starting faces.

#### Minimal *face* sets, and every one of them is 0 of n by enumeration

A different reduction from Rounds 32-34's ddmin-over-conditions: shrink the
contradicting subface's **face set** while it still contradicts, then enumerate
**every total order** of the survivors and test the three question separately.

| core | faces | seeds | triples | quads | orders | satisfy seeds | satisfy conditions | **satisfy both** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A (subface 14) | 71, 116, 118, 182 | 3 | 3 | 0 | 24 | 3 | 6 | **0** |
| B (subface 13) | 80, 102, 103, 225, 237 | 4 | 5 | 1 | 120 | 12 | 6 | **0** |
| C (Round 33's core 1) | 49, 71, 116, 118 | 3 | 2 | 1 | 24 | 5 | 8 | **0** |

All in **plane 2**, identical at sf = 0, 1, 2. Enumeration needs no closure and
no search, so this is the unsatisfiability re-established a third way.

#### `taco_and_hinge` measured exact, which is what Rounds 32-34 could not do

Classifying all 4,019 triples from geometry alone — a tortilla has the taco's
folded line through the crossed face's interior, a hinge has the crossed face
carrying its own crease on that line — gives **360 hinge**, 3,162 tortilla, 497
neither. **360 matches Round 34's provenance sink exactly**, and dropping those
360 closes the instance at **4,413 relations** — also Round 34's number, from an
independent classifier. Dropping the tortillas instead still contradicts. So
`taco_and_hinge` is necessary for every core, and it is the load-bearing rule.

Core A's hinge triple is `T(a=71, b=118, d=116)`: taco = line 284 (116|118,
-180, plane 2), hinge = line 46 (70|71, **+41.8103149**, planes 15/2) — the exact
configuration the doubt was about. Running `interleavings` over **all 24 orders**:

| | agreement |
| --- | --- |
| `T(71,118,116)` holds **iff** `interleavings` reports no crossing | **24 / 24** |
| core B's `T(80,237,103)` (taco line 377, hinge line 53 at +41.8103149) vs a crossing on line 377 | **120 / 120** |
| core A's two tortilla triples | 16/24 and 16/24 |

Every disagreement in the last row is `interleavings` reporting **nothing**: it
iterates crease *pairs on a shared folded line*, and a tortilla face carries no
crease there, so it cannot see a tortilla at all. That is a structural blind
spot, not a disagreement — and it means **Round 34's 94 crossings corroborate
the hinge and taco-taco conditions only**. The 24/24 and 120/120 rows are the
corroboration that was missing, and they are on the 41.81 deg case specifically.

The seam geometry behind them, measured: folded-line group 26 carries 12 creases
with `|dot(direction, axis)| = 1.000000000`; line 284's two faces have interior
directions `[0, 1, 0]` and line 46's near face 71 has `[0, 1, 0]` — the same slot
bit-for-bit — while its far face 70 has `[0, -0.745356, -0.666667]`, a different
slot. Shared extent along the line **12.500000** units against a slack of
3.464e-4. Group 10 is the same shape for core B.

#### The seeds, and the one thing no measurement can adjudicate

The remaining lever was the per-face `FullFold` direction, which Round 34 lists
as unchecked and unavailable. Two measurements close the *orientation* half of
it: **0 of 245 rings have negative signed area** in paper coordinates (0 of 365
on the pangolin), so the CCW normalisation is uniform, and
`|dot(ring_normal, face_normal) - 1| <= 1.1e-15` over every face, so
`face_normals` is the front normal everywhere. The `dot(n_a, n_b)` vs
`cos(theta)` residual over every join is 1.3e-9 (6.6e-15 on the pangolin), and
`measured_dihedral` agrees in **sign** with the stated angle on all 106 non-flat
joins, 0 opposite.

What that leaves is exactly what the placement cannot see. A half-turn about a
line is the same rotation either way, so at ±180 the placed shape is
**identical** for mountain and valley — `interleavings` therefore cannot see a
seed violation, and no geometric check can. Core A makes the consequence
concrete: its three conditions alone admit `71 > 118 > 116 > 182` (and its
reverse), and the only thing that kills it is the seed `182 > 118` from line 285
(+180, Blue2). **Flip that one crease's M/V and core A folds.** The conditions
are reversal-symmetric, so no plane-`up` choice and no global colour convention
rescues it — that half is closed — but the individual assignment is the
document's, not the geometry's.

So the precise claim this file supports is: **the document, with its own
mountain/valley assignment, admits no layer order**, and the search reports that
honestly. "The paper does not fold" is a step further than the evidence goes,
because a design whose M/V is wrong at one crease has a foldable shape and an
unfoldable document, and those are indistinguishable to everything downstream of
`crease_fold_angle`.

#### Calibration

*Measured:* the instance is unsatisfiable, reproduced by a closure sharing no
code with the AEA; three minimal cores, each 0 of 24 / 0 of 120 by exhaustive
enumeration; the classifier reproduces Round 34's 360 and 4,413 independently;
`taco_and_hinge` agrees with `interleavings` 24/24 and 120/120 on the two
load-bearing 41.81 deg seams; ring winding and face normals are uniform to
1e-15; the pangolin closes and has 0 contradicting subfaces.

*Not measured:* the tortilla rule against anything outside our own derivation —
`interleavings` cannot reach it, and R2/R3 rule out the alternatives. Two of
core A's three conditions are tortillas, so that gap is load-bearing, though
core B reaches its contradiction with a hinge triple plus a taco-taco quad that
`interleavings` **can** see. Also not measured: whether the document's M/V at
line 285 is what the designer intended.

**File:line, checked in the working tree and at HEAD.** `taco_and_hinge` is
`constraints.rs:562` in the tree and `:556` at HEAD — the candidate diagnosis's
`:575` is wrong on both. `close_component_hierarchy` is `order.rs:1216` with the
discard `Err(_) => Ok(hierarchy)` at **`order.rs:1238`**, and it **does not exist
at HEAD at all** — it is part of the uncommitted baseline, so Round 33's
`order.rs:1301-1311` is stale by ~63 lines. The discard itself is confirmed, and
this is the fourth round to flag it.

**Gate.** No behaviour-changing change was made. `cargo test -p oristudio-cp
--release` all green. The two per-plane trap tests named in the brief pass:
`the_coupled_strip_is_solved_across_its_two_planes` **ok** and
`the_coupled_strips_second_plane_is_decided_only_by_the_coupling` **ok** (22/22
in `folding3d_order`). The Oriedita folding oracle ran **live** with
`ORIEDITA_GEOMETRY_ORACLE` set — 29 passed in **13.03 s**, not a 0.00 s skip.
External corpus: `corpus_ordering_reports_every_model` reports **admitted models
28; ordered 27**, `airplane.fold` the only holdout — one *more* admitted than the
brief's recorded 27/26 baseline and no new holdout.

**Instrumentation: removed.** One example,
`crates/oristudio-cp/examples/zver35.rs` (base / audit / closure / cores /
enumerate / correlate / classify / seam / geometry), **deleted**; a copy is at
`<scratchpad>/zver35.rs.saved`. Nothing under `src/` was touched at any point —
the round used only the public API. Built once with `--release`. No background
process was left running. `examples/hh_adv.rs` and `examples/zver.rs` in the tree
are parallel sessions'.

### Round 37 — the core drawn out, the `FullFold` rule re-derived from physics, and a scale trap in the two `.osf` pointers (2026-08-29)

**Numbered 37 because Rounds 35 and 36 both landed while this was measuring; a
sixth harness, and where we overlap we agree. Four things are new. (1) The two
`.osf` JSON pointers give the same model at **different scales** — every absolute
length in Rounds 32-36 is 2/√3 of mine, which is the whole of the "12.5 versus
14.43" discrepancy and is worth knowing before anyone compares numbers across
rounds. (2) Round 34's named-unclosable gap, the per-crease `FullFold`
direction, closes: a rule written from the physics of a half-turn reproduces
**817 of 817** shipped seeds across both files. (3) Round 34's core 1 drawn as
polygons rather than condition ids — it is a **four-layer roll** whose outermost
wrap folds along a line that is also the hinge edge of a sixth face attached to
an inner layer. (4) A necessity proof for `taco_and_hinge` that covers the
tortilla case too, which is the blind spot Round 36 correctly names in
`interleavings`.** *Measured, except the necessity proof, which is labelled.*

**The scale trap, first, because it reconciles three numbers that look like
disagreements.** `/workspace/creasePattern/creasePattern/document/crease_pattern`
(the pointer the brief names, used by Rounds 32-36) and
`/workspace/creasePattern/creasePattern/foldProjection` (the pointer
`non_flat_corpus.rs` and this round use) hold the **same model at different
sizes**, related by exactly `2/√3 = 1.1547005`:

| quantity | Rounds 32-36 | this round | ratio |
| --- | --- | --- | --- |
| `placement.span` | 346.410 | **400.000000** | 1.154700 |
| shared extent, creases 46 / 283 | 12.500000 | **14.433757** | 1.154700 |
| the small triangle's area | 135.316469 | **180.421959** | 1.333333 = (2/√3)² |

Everything topological and every relative quantity is identical — same 245 faces,
23 planes, 4,798 census pairs, same face ids, same verdict — and every tolerance
in the pipeline is relative to `span`, so nothing turns on it. But an absolute
length quoted from one round and a bar quoted from another are in different
units. **The candidate diagnosis's "12.5 units" is right in the
`document/crease_pattern` scale and not an error.**

**Baseline, public API.** `hex head 2` **0 of 12**, 99-102 ms, identical
`NoLayerOrder { component: 0, faces: 236, variables: 4798 }`; `hex pleated
pangolin` **12 of 12**, 43-44 ms, 3,780 relations, 0 undetermined. Both `Folded`,
**`snapped_creases = 0` on both** — the flat snap manufactures nothing here.
Fourth independent confirmation of the premise correction, this time from the
file's own `edges_foldAngle` array rather than from `fold_magnitude` or the
placement: `180 ×290, 41.8103149 ×73, 0 ×46, 90 ×30, 112.3390943 ×2,
109.4712206 ×1` over 442 edges (`M ×207, V ×189, B ×46`).

**The `FullFold` seed rule, re-derived and checked crease by crease.** Round 34
lists this as "no per-crease independent check was performed, and none is
available (R3)". One is. A ±180 fold puts the two faces in contact; a **mountain**
leaves both fronts outside so the **backs** touch, a **valley** puts the fronts
together; `face_normals[f]` is the side f's front faces. That sentence alone
gives "first is above second" `= mountain == (dot(n_first, up) > 0)`. Run against
every shipped seed:

| file | `FullFold` seeds | disagreements | full folds with non-antiparallel normals |
| --- | --- | --- | --- |
| `hex head 2` | 290 | **0** | 0 |
| `hex pleated pangolin` | 527 | **0** | 0 |

**What this does and does not settle.** It closes Round 34's gap — the shipped
rule is a correct reading of the document's M/V in both parities, verified 817
times, not just on the core. It does **not** touch Round 36's sharper point, which
stands: at ±180 the placed shape is identical for mountain and valley, so nothing
downstream can tell whether the *designer's* assignment is what they meant. My
rule and the shipped rule are the same function of the same inputs; agreeing
validates the implementation, not the document.

**Core 1, drawn.** Faces 49/71/116/117/118/182, all plane 2 (`x = -88.675135`,
normals `±[1,0,0]`). With `A = (4.166667, 26.461887)`,
`B = (-8.333333, 19.245009)`, `C = (16.666667, 4.811252)` and `T = ABC`:

- **116, 117, 118 and 49 are four coincident copies of `T`** (area 180.421959),
  identical rings, windings alternating with the normals.
- **182** is the quad `E B A C`, `E = (-8.333333, 4.811252)`, area 360.843918,
  **convex** (all four cross products negative). Three of its four vertices are
  `T`'s, so `T ⊂ 182` and **`B–C` is its diagonal**.
- **71** is the triangle `B C D`, `D = (16.666667, 33.678766)`, area 360.843918,
  and **`A` is exactly the midpoint of `B–D`** (measured midpoint
  `(4.166667, 26.461888)`). So `T ⊂ 71`, as half of it.

Every crease lands on an edge of `T`:

```text
edge A–B   283 (117|182) +180 Blue2    284 (116|118) -180 Red1
           46  (70 |71 ) +41.8103149 Blue2, planes 15/2   <- the hinge
edge C–A   97  (116|117) +180 Blue2    285 (118|182) +180 Blue2
edge B–C   98  ( 71|116) -180 Red1
```

So plane 2 holds a **four-layer roll** over `T`: the seeds force
`182 > 118 > 116 > 117`, the tacos at `C–A` nest as `[117,116]` and `[118,182]`,
and those at `A–B` nest as `[116,118]` inside `[117,182]` — crease 283, the
outermost wrap, joins the top of the stack to its bottom. Face 71 hangs off
**116, an inner layer**, by the taco at `B–C`, and 71's own edge `B–D` *contains*
`A–B` and hinges out of the plane there. The paper has to leave the roll along
the line the roll is wrapped on.

**Every gate measured here, not through `crease_slots` / `Frame` /
`extents_overlap` — the shared layer Round 34 named as unchecked.** Interior
directions recomputed from each face's own placed centroid:

| quantity | value | bar |
| --- | --- | --- |
| creases 283 and 46, `\|d₂₈₃ × d₄₆\|` / offset | 9.992e-16 / 4.019e-14 | — |
| their shared extent | **14.433757** (all of 283, inside 46's 28.867513) | slack 3.464e-4 |
| face 71's interior at crease 46 | `[0.000000, -0.500000, 0.866025]` | — |
| faces 117, 182's interior at crease 283 | `[0.000000, -0.500000, 0.866025]` | dot **1.0** |
| face **70**'s interior at crease 46 | `[0.666667, 0.372678, -0.645497]` | dot with the slot **−0.745** |
| crease 98's line vs face 182 | inside **0.9990**, border 0.0010, outside 0 | — |
| crease 283's line vs face 71 | border **1.0000** | — |

The last two rows separate the rules: crease 98 runs through 182's **interior**
(the quad's diagonal — `pierce_constraint`), crease 283 runs along 71's
**border**, so only `taco_and_hinge` can emit it.

**Exhaustive over all 120 stackings of `{71,116,117,118,182}`, with the two
conditions written from the geometry rather than read from `constraints`:**
`T1 = 71 ∉ (117,182)`, `T2 = 182 ∉ (71,116)`.

| condition set | survivors of 120 |
| --- | --- |
| all of it | **0** |
| **every seed reversed**, T1 and T2 kept | **0** |
| T1 dropped | 2 |
| T2 dropped | 1 |
| seed `71 > 116` dropped | 1 |

The reversal row kills "a plane's `up` was chosen the other way" without needing
a closure: both conditions are symmetric under a global stack reversal.

**An independent forced-inference closure, and the same discrimination.** Written
against `build_constraints` + `cell_index` + `census_placement`:

| file | relations | contradiction |
| --- | --- | --- |
| **`hex head 2`** | 4,176 of 4,798 | **global `(102, 237)`** |
| `hex pleated pangolin` | 3,608 of 3,780 | none |
| `cant_fold` | 3,767 of 3,776 | none |
| `failed_layer_ordering` | 2,324 | none |
| `successful_layer_ordering` | 2,289 | none |
| `stick on a floor - failure` | 22,119 of 29,911 | none |
| `full_iguana_non_flat_failing` | 50,541 of 50,713 | none |
| `540-level-0.osf` | 150 of 150 | none |

Every count matches Round 32's AEA core numbers. Seven controls close, one file
contradicts, third harness to reach `(102, 237)`.

**Why `taco_and_hinge` is necessary, and why the same argument reaches the
tortilla case Round 36 says `interleavings` cannot see.** Take a cross-section
perpendicular to `A–B` at any interior point of the shared stretch, `y` along the
slot direction, `z` the layer axis. The taco's paper is one connected curve: in
from `y = ∞` at layer `z₁₁₇`, through the hairpin at `y = 0`, back out at
`z₁₈₂`. That curve bounds a **pocket** whose only opening is the mouth at large
`y`. Face 71's paper is a second connected curve, in from `y = ∞` at layer
`z₇₁`, and — because face 70's interior has `dot = −0.745` with the slot, i.e.
**negative `y`** — continuing to `y < 0`. If `z₁₁₇ < z₇₁ < z₁₈₂` it starts inside
the pocket and ends outside, so it crosses the taco. Nothing there reads the
hinge's angle: only the **sign** of that dot is used, and 41.81° and 90° give the
same sign. This is Justin's taco-tortilla condition with "the tortilla continues
across the line *in the plane*" weakened to "the tortilla continues across the
line" — which is all the proof needs, and which is exactly what
`Crease::degenerate` tests. The same argument, run at edge `B–C` with the taco
`(71,116)` and face 182 crossing as the quad's diagonal, gives T2. So the one
condition class `interleavings` is structurally blind to is the one that is
easiest to check by hand here: a convex quad, its diagonal, and a flat fold along
it. *Argued from the measured geometry; not measured.*

**The emission census, recomputed from my own geometry.** Third independent
reproduction of Round 34's provenance sink, and it answers Round 35's inertness
table in the only way available: the predicate itself is not in doubt.

| file | `taco_and_hinge` | `taco_taco` |
| --- | --- | --- |
| `hex head 2` | **360** | **1,610** |
| `hex pleated pangolin` | 266 | 816 |
| `stick on a floor - failure` | 3,456 | 10,014 |
| `full_iguana_non_flat_failing` | 241 | 15,675 |
| `cant_fold` / `failed` / `successful` | 27 each | 1,209 / 591 / 588 |
| `540-level-0.osf` | 36 | 24 |

**Where I land, and where a reader may not.** Instance level: **confirmed**, now
by three closures and two exhaustive enumerations. Document level: I read it as
**true** — the five faces of core 1 are small enough to draw, the conditions on
them are the standard non-crossing conditions rather than a rule anyone invented,
and Round 36's `interleavings` 24/24 and 120/120 covers the hinge case by
measurement where I cover it by proof. A reader who weights "no implementation of
these semantics but ours has ever seen this file" above both should read Round
35's *undetermined*. Round 36's framing is the one I would ship: it is the
**document**, with its own M/V assignment, that admits no layer order.

**Two notes on the candidate diagnosis.** Its "12.5 units" is correct in the
other pointer's scale (above), not an error. Its "the enum arm for the weaker one
already exists" is half right: `SearchExhausted` (`order.rs:220`, HEAD `:122`)
draws exactly that distinction and carries the doc comment for it, but it means
*the iteration budget ran out*, not *four incomparable attempts all failed* —
re-purposing, not a drop-in.

**File:line, working tree and `git show HEAD:`.** `close_component_hierarchy`
`order.rs:1216`, discard at **`:1238`**, and **absent at HEAD** — it is part of
the uncommitted baseline, so the four-rounds-running "promote the core
contradiction" proposal is a change to an unlanded change. `constraints.rs`
tree/HEAD: `initial_hierarchy_3d` 239/239, `same_slot` 385/379, `crease_slots`
390/384, `extents_overlap` 486/483, `taco_and_hinge` 562/556, `pierce_constraint`
820/814, `interleavings` 1015/1009. `apply_triple_condition` `folding.rs:4932`.
Baseline diffstat unchanged at 31 / 33 / 283 / 12 / 246.

**Gate.** No fix proposed, nothing under `src/` touched, so this gates a probe.
`cargo test -p oristudio-cp --release`: **975 passed, 0 failed**.
`folding3d_order` **22/22**, both named traps ok —
`the_coupled_strip_is_solved_across_its_two_planes`,
`the_coupled_strips_second_plane_is_decided_only_by_the_coupling`. Oriedita
folding oracle with `ORIEDITA_GEOMETRY_ORACLE` set: **29/29 in 12.94 s** (live,
not the 0.00 s skip); render oracle **13/13 in 32.79 s**. External corpus
`corpus_ordering_reports_every_model`: **admitted 28; ordered 27**, only holdout
`airplane.fold` — the brief's "27; 26" is stale, not a regression, and neither
hex file is in that scan at all (`read_fold` reads only the `documents[0]`
workspace shape; both are the `creasePattern` shape).

**Instrumentation: removed.** One example,
`crates/oristudio-cp/examples/zver.rs` (sweep / core / closure / hinges),
**deleted**; copy at `<scratchpad>/zver.rs.saved`. Public API only — nothing under
`src/` was added or changed at any point. Built once with `--release`. No
background process was left running.

### Round 38 — necessity review before the PR: three of the fixes are dead weight (2026-08-29)

Before opening a PR, every change was ablated to ask whether it is still
*necessary*. The AEA pass (Round 22) landed last and is powerful enough to have
made the earlier search work redundant. It had.

Ablation matrix, `starting_face_id` sweeps over eight models (six owned plus both
Terao files), runtime-gated so one build tested every configuration:

| configuration | folded | note |
| --- | --- | --- |
| everything | 168/168 | the tree as it stood |
| **minus swapper-reset, sound-backjump, restart-on-reset, and the whole `Completeness` escalation** | **168/168** | identical, and marginally faster |
| minus the AEA pass | 60/72 | `full_iguana` 0/12, worst 11 s |
| minus the `extents_overlap` fix | 157/168 | `stick on a floor` back to 10/21 |

Corpus agrees: 27 of 28 ordered with or without the three search changes,
`airplane.fold` the only holdout either way.

**So three of the four search fixes were removed.** They were real fixes for real
defects — each one is measured and written up in Rounds 11, 22 and earlier — but
with a correctly-closed hierarchy reaching the search, the search no longer needs
them on any model available. Keeping them would have meant shipping three
deliberate divergences from Oriedita-ported shared code, plus an escalation
harness and two budget constants, for no measured benefit.

`crates/oristudio-cp/src/folding/combination.rs` is now **untouched** — the
excess-permutation accelerator carries no divergence at all.

**What ships instead**, 253 insertions across four files rather than 540 across five:

1. `close_hierarchy_with_removal` (`folding.rs`) + `close_component_hierarchy`
   (`folding3d/order.rs`) — the setup-time `removeMode` AEA round the flat path
   already runs, over 3D's own subfaces. Discarded on contradiction.
2. `extents_overlap` frame projection + real slack (`folding3d/constraints.rs`).
3. `FOLD_3D_LOOKAHEAD_BUDGET` + `set_iteration_budget` + `probe_next`
   (`order.rs`, `permutation.rs`) — bounds the "Another solution" probe.
4. The `LocalEquivalenceCondition` refactor (`permutation.rs`) — representational
   only; resolves condition faces to local digits once instead of hashing per
   permutation.

Only (1) and (2) can change an answer. (3) can only move a button from enabled to
disabled, and (4) cannot change anything.

**The lesson worth keeping:** the three removed fixes were each justified by a
measurement at the time it was made, and each was genuinely load-bearing *then*.
Necessity is a property of the final set, not of the moment a change is written,
and nothing tests it automatically. Ablate before shipping.


## Refuted — do not re-run

| # | Hypothesis | What killed it |
| --- | --- | --- |
| R1 | ddmin / MUS / "delete constraints until it passes" | Predicate is non-monotone: 4.62% of single-relation drops flip SAT→UNSAT (Round 1). Returns an arbitrary set, not a core. Also 22 seeds each *alone* flip the verdict, so every core has ≥22 members. |
| R2 | A SAT/CP oracle for the constraint system | Would be a second implementation of Oriedita-derived semantics, gated out of CI, drifting silently. `interleavings` is the sanctioned precedent — it re-derives from *geometry*, is unconditionally compiled, and is covered by `cargo test`. |
| R3 | Per-plane Flat-Folder oracle | Tautological or blind on every seed class: our `FullFold` sign and its `EF_EA_Ff_BF_BI_2_BA0` are the same function of the same inputs; `Wall` (312 of 529) and `SharedSlot` are cross-plane and absent from a per-plane sub-problem. **0% of the seed set is independently checkable.** |
| R4 | "Which subface did the search die on" as a diagnostic | Non-discriminative: 10 of 22 subfaces are individually unsatisfiable on the failing file — and 8 of 21 on the **working** control, whose prefix-of-one is also `found=false` while the full solve succeeds. |
| R5 | The coupling cut excludes valid orderings | Cuts landing on real ordering variables = **0 at every one of the 21 starting faces** on `cant_fold`. The cut never constrains a real variable. |
| R6 | Coupling count / quadruple count predicts the verdict | Couplings vary 20–33 with no correlation. Quads looked clean over 8 faces (FOLD 1232–1248 vs no-ord 1281–1320) and broke over 21: FOLD at 1282, no-ord at 1239. |
| R7 | Reset only generators that moved *shallower* (the obvious economy) | Fast but **wrong**: drops the sweep from 20/20 to 4/20. The re-enumeration is the guarantee, not waste around it. |
| R8 | Auto-select a good starting face | Relations are bit-identical across faces and geometry differs by a pure rotation — but `defaultFolded3dCamera` does `void model` and returns a world-fixed constant, so a different face silently draws the figure **turned**. And rebasing to a canonical frame does not collapse the timing spread. |
| R9 | `stick on a floor`'s 230-crease group is a tolerance-chain over-merge | Max perpendicular deviation **1.5e-11 of span** against a 1e-6 tolerance — an exactly-collinear grid line. |
| R11 | `next(0)` at prefix position 1 is the drop site | All 53 found=false searches across the sweep terminate there, including two at sf=5 and sf=6 **which fold**, and 17 of 21 faces of `failed_layer_ordering.fold` (21/21) contain one. It is where every failure ends because it is the only place a failure *can* end. Correct code: prefix position 0 is searched against a table nothing else affects, so a genuine exhaustion there is genuine. |
| R12 | Suppressing the `CombinationGenerator` hand-over | It does give `cant_fold` 21/21 — but `full_iguana` sf=0 did not finish in **480 s** against 34.3 s shipped (≥14×). Dead on arrival. |
| ~~R10~~ | ~~`extents_overlap` frame fix as the verdict fix~~ **UN-REFUTED in Round 23** — the 4/21 → 0/21 regression was real on the broken search and is obsolete now the search is fixed. It is the fix for `stick on a floor`. |
| R10 (original text, kept for the record) | `extents_overlap` frame fix as the verdict fix | It *is* a real bug (below) and it makes the instance starting-face invariant (1 distinct instance instead of 21) — but measured, it regresses `cant_fold` **4/21 → 0/21**. It would read as a fix while being strictly worse. |

## Corrections to earlier conclusions

- **The escalation is not monotone.** `Completeness::ATTEMPTS` reads as a ladder
  and is not one. Measured on `cant_fold` component 0: sf=1 `reset=false` →
  Ok(true) but `reset=true` → Ok(false); sf=5 the reverse. The strategies are
  **incomparable**. "Every attempt found nothing" is a disjunction, not a proof of
  coverage — so the `NoLayerOrder` it produces is a known-false claim. Corrected in
  the code doc; the original justification was wrong.
- **`FOLD_3D_ITERATION_BUDGET`'s doc is now false.** It says nothing should
  approach 1,000,000 and anything that does is a bug. Some starting faces now hit
  it at ~20 s.
- The blocking-subface histogram was reported as a root cause in an early probe.
  It is not; see R4.

## Known-real bugs not yet landed

- **`extents_overlap` mixes frames** (`folding3d/constraints.rs`). It computes
  `shift` along `a`'s direction, then uses `b.span` — b's extent in **b's own
  frame** — without projecting through `dot(a.direction, b.direction)`. Antiparallel
  canonical directions therefore reverse b's interval. Fix: project b's endpoints
  into a's frame, and give the `chord_pair` call site the real slack its siblings
  (`interleavings`, `census::coincident`) already use. **Land on its own merits;
  see R10 for why it is not the verdict fix.**
- **Non-equivariant frame choices.** `canonical_direction` fixes a line's sign by
  scanning world components for the first above `1e-12`; `frame_for` picks its
  perpendicular seed as the most-perpendicular **world** axis. Both rotate with the
  starting face, which is why the derived constraint set varies at all. Not itself
  a wrongness — every instance is satisfiable (Round 4) — but it is the source of
  the variation.
- **`search_error` reports face ids as counts.** `AdditionalEstimationError::Contradiction`
  is mapped to `NoLayerOrder { faces: upper_face, variables: lower_face }` —
  component-local ids in fields named for counts, unmapped through `global_faces`,
  rendered by `Display` as counts and shipped to the browser by `wire.rs`.

## Reproduction

```bash
# The whole gate.
cargo test -p oristudio-cp --release
ORIEDITA_GEOMETRY_ORACLE="$PWD/tools/oriedita-oracle/build/oriedita-oracle" \
  cargo test -p oristudio-cp --release --test oriedita_folding_oracle --test oriedita_render_oracle
# The browser runs a stale .wasm unless you do this after a kernel change.
npm --workspace @treemaker/web run build:oristudio-cp-wasm
```

The starting-face sweep is the cheapest signal in the whole investigation — ~40
lines against the public `Fold3dSession::new`, 3 s per file, no instrumentation,
and it is what found the bug. Rebuild it rather than trusting a stale harness.

Test files live outside the repo at
`~/Documents/open source/origami-designer/test_files/non-flat/fold_issues/`.
Schema-8 `.osf` loads via the JSON pointer
`/workspace/creasePattern/creasePattern/document/crease_pattern`; the pointer
`examples/fold3d_census.rs` uses does not exist in those files.

## Open questions, in priority order

1. **Where does the enumeration lose the witness?** Round 4 narrows it to
   `folding/permutation.rs` / `folding/combination.rs` rather than validation, but
   no drop site is named. *In progress.*
2. Is `full_iguana` / `stick on a floor` the same disease? Neither has been tested
   against a witness, and `stick on a floor` is coupling-dominated
   (`valid_count` 13 of 2,269) which looks like a different shape.
3. Should the verdict stop claiming `NoLayerOrder` at all when what is known is
   "no attempt found one"? A product decision, shippable independent of the root
   cause, and the enum arm for it already exists.
4. Does the `extents_overlap` fix become correct once the enumeration is fixed?
   R10 says it regresses today; that may be because it moves the instance to one
   the *broken* search fails on.
