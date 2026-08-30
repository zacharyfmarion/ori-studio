# Debugging 3D layer ordering: telling "no order exists" from "the search gave up"

> **Partly superseded.** This plan was written before the investigation found the
> actual defects. Phases 0 and 3 are still wanted; the instrumentation phases were
> overtaken by measurement. The live record — what was tried, what it showed, and
> what is refuted — is
> [`research/2026-08-fold3d-layer-order-investigation.md`](../research/2026-08-fold3d-layer-order-investigation.md).
> Read that first.

## Goal

Make a failing layer-ordering solve **locatable** on a real crease pattern —
hundreds of faces, tens of thousands of ordering variables, tens of thousands of
constraints — instead of a three-integer verdict that names nothing.

The investigation that produced this plan changed what the tool has to do, so the
goal is stated in its corrected form: the first job is not to explain a
contradiction. **On the files that motivated this work there is no contradiction
to explain.** `Fold3dOrderError::NoLayerOrder` is being reported on models that
have a layer order the shipped solver can already find. So the instruments have
to answer *which of the two failures this is* before anything else, and the
verdict has to stop asserting the stronger one.

## What is actually happening

Everything in this section is measured. Where a number came from a probe rather
than from the shipped composition, it says so.

### 1. `NoLayerOrder` is a false negative on at least two of the three files

Sweeping `starting_face_id` through the **shipped** `Fold3dSession::new` — no
instrumentation, no kernel edit, the same composition the app calls:

| file | ordered / 20 | note |
| --- | --- | --- |
| `failed_layer_ordering.fold` | **2 / 20** | `sf=2` folds in 231 ms, `sf=3` in 25.5 s |
| `successful_layer_ordering.fold` (control) | **20 / 20** | 109–231 ms throughout |
| `full_iguana.fold` | 0 / 20 | 4.2–10.3 s each |
| `stick on a floor - failure.osf` | 0 / 6 measured | starting-face invariant; `sf=0` ran **> 22 min** with no verdict before it was killed |

`failed_layer_ordering.fold` therefore **has** a layer order, and the shipped
solver **finds** it — for 2 of 20 arbitrary choices of the face the placement
walk starts from. The census is pinned at 2,324 variables across the whole
sweep, so this is not a different problem being solved; it is the same problem
solved from a different entry point.

That also reframes the twin pair. The difference between the twins is not
"orderable vs unorderable", it is **robustness: 2/20 against 20/20.**

### 2. A second, independent axis says the same thing

Re-running component 0's search with the identical subfaces, initial hierarchy
and equivalence conditions but a randomly permuted **subface order** (probe, via
`WorkerOverlapEnumerator::from_ordered_subfaces`):

- `failed_layer_ordering.fold` — **29 of 32** trials find a layer order, in ~3 ms,
  against `found = false` after 135 outer iterations in the shipped order.
- `full_iguana.fold` — **2 of 6**. So `full_iguana` is rescued on the subface-order
  axis while being invariant on the starting-face axis. Same class, different axis.
- `stick on a floor - failure.osf` — **0 of 5**. Different character; see §5.

### 3. The search is measurably not a decision procedure

A probe ran the shipped search in the 3D path's exact configuration
(`from_subfaces` + `promoting_on_condition_contradiction` + iteration budget)
over 3,971 random instances and then **removed one hierarchy relation at a time**:

| conditions present | baselines SAT | single-relation drops | drops that flipped SAT → **UNSAT** |
| --- | --- | --- | --- |
| with quadruple conditions | 3,273 | 15,096 | **697 (4.62 %)** |
| no conditions | 3,971 | 18,506 | **0 (0.00 %)** |

Removing a relation strictly *enlarges* the feasible set — the previous solution
still satisfies the weaker relation set and the same conditions — so every one of
those 697 is a witnessed incompleteness, not a logical fact. And it localises:
**the incompleteness is in the condition-handling path**, not in the odometer.

Three consequences, and the third is the one that costs money later:

- `found = false` means "this search, under this subface priority and this
  `valid_count`, did not reach a solution". It does not mean unsatisfiable.
- Any reduction technique whose predicate is `found == false` — ddmin, MUS
  extraction, "which constraint can I delete to make it pass" — is running over a
  **non-monotone oracle** and returns an arbitrary set, not a core. This is why
  the plan below does not contain one.
- The `normalized()` role assignment (`constraints.rs`) reads each taco
  condition's `b`/`d` roles **from the seed map**, so deleting a seed and
  re-deriving silently rewrites the roles of every condition over that pair. Any
  ablation must either replay frozen emitted constraints or label itself as a
  re-derivation. The two answer different questions.

### 4. The verdict the code was built to give cannot fire

[`order.rs:630-634`](crates/oristudio-cp/src/folding3d/order.rs:630) and
[`permutation.rs:747-753`](crates/oristudio-cp/src/folding/permutation.rs:747)
together explain why every one of these lands on the wrong arm.

`Fold3dOrderError::SearchExhausted` exists precisely so that "we stopped looking"
is never reported as "your pattern has no layer order" — it is documented that way
in the enum. It is gated on `FOLD_3D_ITERATION_BUDGET = 1_000_000`. Measured outer
iterations before `found = false`: **135** (`failed_layer_ordering`), **30**
(`full_iguana`), **6** (`stick on a floor`). The budget is four to five orders of
magnitude away. The loop does not run out of budget; it **exits**, because
`advance_subface_permutations`
([permutation.rs:1526-1551](crates/oristudio-cp/src/folding/permutation.rs:1526))
returns 0 once position 0's generator wraps, and `while changed_subface != 0` ends.

The odometer itself is correct — position 0 is the most significant digit, so its
wrap really is exhaustion *of the space the guides left*. The incompleteness is in
what the guides pruned (§3), not in the walk. But the outcome is that a pruned-space
exhaustion is reported as a claim about the user's paper, and the arm built to
prevent exactly that never runs.

### 5. `stick on a floor - failure.osf` is a different bug

Invariant on both axes (0/6 starting faces, 0/5 shuffles). Its shape:
2,256 couplings on 49 folded-line groups, all surviving; 523 faces; 29,911
variables; **`valid_count` 13 of 2,269 subfaces**, because 2,256 of those subfaces
are the synthetic 4-face ones the coupling encoding creates and they contribute no
new pair information to `prioritize_subfaces`. 73 % of its relations are invented
cut relations.

Two hypotheses were tested and **falsified**, which is worth as much as the
positives:

- *Its 230-crease coincident group is a tolerance-chain over-merge.* No. Max
  perpendicular deviation of all 230 creases from the supporting line is
  **1.5 × 10⁻¹¹ of span**, against a `distance_relative` of 1 × 10⁻⁶ — five orders
  inside tolerance, on an exactly-collinear grid line.
- *`extents_overlap` is dead code.* No — 8,312 of its 26,335 chord pairs fail the
  extent test on this file. It is heavily exercised here for the first time.

### 6. A shipped bug found in passing, worth landing on its own

[`order.rs:630-634`](crates/oristudio-cp/src/folding3d/order.rs:630):

```rust
AdditionalEstimationError::Contradiction { upper_face, lower_face }
    => Fold3dOrderError::NoLayerOrder { component, faces: upper_face, variables: lower_face },
```

Two **component-local face ids** are written into fields named `faces` and
`variables`, never mapped back through `ComponentInput.global_faces` (contrast
`Builder::localise`, which does map back for its own `ContradictorySeeds` arm).
`Display` then renders them as counts — "component 0 (37 faces, 12 ordering
variables)" where 37 and 12 are face ids — and `wire.rs` ships the same numbers to
the browser. Every field report from that arm is currently meaningless, and a
reader cannot tell which of the two meanings a given payload carries.

### 7. The obvious diagnostic is a trap

"Which subface did the search die on" is the first thing anyone would print. It is
**non-discriminative**: on `failed_layer_ordering.fold`, ten of 22 cell subfaces are
individually unsatisfiable and the prefix-of-one is already `found = false` — but
on the **working** control, eight of 21 are individually unsatisfiable and its
prefix-of-one is *also* `found = false`, and the full solve still succeeds. A report
whose output has the same shape on the failing and the working model has localised
nothing. Print it if you like; do not build on it.

Same for two numbers that read as alarming and are not: "`valid_count` 13 of 2,269"
and "73 % invented cut relations" are the *intended* behaviour of the priority rule
and of the coupling encoding respectively.

## Approach

Four phases, each producing signal before the next starts, ordered so that the
cheapest decisive instrument comes first. Total new permanent surface: **one
example, and roughly 60 lines of kernel change.**

The governing constraint: `possible_overlapping_search` is Oriedita-ported and
**shared with the flat path**, which is pinned by
`tests/oriedita_folding_oracle.rs`. So instruments are read-only, and any
behaviour change is 3D-only and opt-in, following the existing
`promoting_on_condition_contradiction` precedent (flat path off, because upstream
sets `errorIndex` only in the transitivity catch).

### Phase 0 — Stop the error lying (~1 hour)

Split the `Contradiction` arm out of `NoLayerOrder` into its own variant carrying
**global** face ids, mapped through `ComponentInput.global_faces`. Add the wire
arm and the notice string. Independent of everything else here; land it first.

Note the cost the critique surfaced: `orderReasonDetail` in
[`foldedFigureNotice.ts`](apps/web/src/cp-workspace/folded/foldedFigureNotice.ts)
is an exhaustive switch with no default, so a new `Fold3dOrderWire` arm is a hard
typecheck break, and the new string must clear `npm run i18n:check` across nine
locales. Budget it.

### Phase 1 — The two order-sensitivity sweeps, committed (~half a day)

One example, `crates/oristudio-cp/examples/fold3d_triage.rs`, that answers the
one question everything else is conditioned on: **is this failure order-dependent?**

- **Starting-face sweep.** ~40 lines against the already-public `Fold3dSession`.
  This is the whole reframe and it needs no kernel change at all; the table in §1
  is its output. Report `ordered N/M` as the headline.
- **Subface-order shuffle.** Re-enter `WorkerOverlapEnumerator::from_ordered_subfaces`
  with permuted orders. Everything it needs is already `pub`
  ([permutation.rs:573, :614, :620, :654](crates/oristudio-cp/src/folding/permutation.rs:573));
  `WorkerOverlapSearch`'s four fields are `pub` too.
- **Read both `.osf` shapes.** Schema-8 files have no `workspace.documents` array;
  the working pointer is `/workspace/creasePattern/creasePattern/document/crease_pattern`.
  Lift `read_fold_any_workspace_shape` from `tests/non_flat_corpus.rs`. Do **not**
  widen that file's default `read_fold` — its doc comment records that widening is
  a re-measurement (55 → 77 models, five new rows on the unorderable roster), not
  a bug fix.
- **Instance-shape header**: faces / variables / planes / folded-line groups /
  subfaces / `valid_count` / outer iterations / seed histogram by `SeedKind` /
  conditions by class / couplings kept-vs-emitted.

The two agent-written throwaways in the worktree
(`examples/fold3d_triage.rs`, plus `TRIAGE-TEMP` edits to `order.rs` and
`permutation.rs`) are **reference, not the deliverable** — write the committed
example fresh, and re-anchor every line number against `HEAD` first, since roughly
half the citations in the source investigation only resolve while that
uncommitted patch is applied.

Verdict this phase reaches, per file: *order-dependent* (`failed_layer_ordering`,
`full_iguana`) or *invariant* (`stick on a floor`). Those go to different places.

### Phase 2 — Witness replay: the one instrument that proves a false negative (~half a day)

For an order-dependent failure, take the ordering found under an alternate
starting face or subface order and **replay it through the shipped configuration**:
build the `HierarchyTable` from the original instance's initial hierarchy, enter the
candidate stacking, and run `run_final_additional_estimation` against the full
condition set.

If it validates, the original run's `found = false` is a **proven** false negative
for that instance — proven with zero trust in any encoding, any ablation, or any
second implementation. That is the artifact to attach to a bug report, and it is
the regression fixture: a committed instance plus a witness the shipped search
fails to find.

Cross-check with `constraints::interleavings`
([constraints.rs](crates/oristudio-cp/src/folding3d/constraints.rs)), which is an
independent backward re-derivation from geometry, takes `above: &dyn Fn(usize, usize)
-> Option<bool>` — so it accepts a *partial* order, not only a solved one — and
already distinguishes "these chords cross" from "the relations cannot say". It shares
neither `slot_winding` nor `normalized()` with the forward generator. Any
interleaving it reports that the forward generator did not is a forward-generator
bug, named by crease.

Then narrow §3's result: re-run the relation-drop probe with each condition class
disabled in turn, to find which class carries the incompleteness. Report it as a
class, not as a culprit constraint.

### Phase 3 — Make the verdict honest (~1 day, 3D-only, opt-in)

Two changes, both in the native 3D path.

- **Stop discarding the search state.**
  [`order.rs:544-547`](crates/oristudio-cp/src/folding3d/order.rs:544) does
  `if !overlap.found { self.has_next = false; return Ok(false); }`, throwing away the
  `WorkerOverlapSearch` that `permutation.rs:758` just built: the near-miss hierarchy
  (measured 919 derived relations against 556 initial — 363 relations of solver work
  destroyed on every failure), the post-swapper priority order, and the final
  `valid_count`. All four fields are already `pub`. Keep it; it is what makes Phase 2's
  replay runnable from inside the session rather than from a re-run.
- **Do not claim `NoLayerOrder` from a pruned-space exhaustion.** Behind a 3D-only
  builder opt-in, when the search exits because the odometer wrapped rather than
  because a contradiction was proven, report the "we stopped looking" arm. The
  honest verdict for these files is *undetermined*, and the figure still draws —
  `NoLayerOrder` is already documented as a verdict rather than a refusal, so this
  is a change of which sentence the user reads, not of whether they get a figure.

Gate: `cargo test -p oristudio-cp` plus the Oriedita folding oracle. **The oracle
skips silently without `ORIEDITA_GEOMETRY_ORACLE` set** and reports green — the
whole point of `oracle_env_guard.rs` — so this phase must be run with the Java
oracle actually built, not merely with the command typed.

### Phase 4 — Only then, `stick on a floor` (~1 day, and only if it is still failing)

It is invariant on both axes, so Phases 1–3 will not move it and it needs its own
question. Start from what is already known and *not* from a fresh instrument:
2,256 couplings, `valid_count` 13 of 2,269, and 8,312 of 26,335 chord pairs failing
`extents_overlap` on a group whose collinearity is exact. The live hypothesis is
that `promoting_on_condition_contradiction` — which promotes one subface per
final-check contradiction — cannot keep up with 2,256 synthetic subfaces in 6 outer
iterations. Measure promotions-per-iteration before designing anything.

Note also that this is the one file where the iteration budget is a live question
rather than an unreachable backstop: `starting_face_id = 0` ran for over 22 minutes
without returning, and a probe's shuffled trial took 493 s over 9,593 outer
iterations (51 ms each). So on this file `SearchExhausted` *can* eventually fire —
after roughly 14 hours. A budget expressed in wall-clock, or scaled by subface
count, would change the reported verdict here. That is a product decision, not a
debugging one, and it belongs with Phase 3's honesty change rather than with the
instruments.

## What this deliberately does not build

Each of these was designed and then rejected on measured grounds. Recording that
is the point; the next person will otherwise re-propose them.

| Not building | Why |
| --- | --- |
| ddmin / minimal-unsat-core reduction | The predicate is non-monotone (§3, 4.62 % flip rate). ddmin over a non-monotone oracle returns "a set that also fails", not a core. Also: on `failed_layer_ordering` 22 seeds each *alone* flip the verdict, so by MCS/MUS duality every core has ≥ 22 members — not a pointer. And the cost is 27 min / 3.8 h / ~90 h per file. |
| A SAT/CP oracle for the constraint system | It would be a second implementation of Oriedita-derived shipped semantics, gated out of CI, drifting silently. `interleavings` is the sanctioned precedent: it re-derives from **geometry**, is unconditionally compiled, and is covered by `cargo test --all-targets`. |
| A trace file format | For `full_iguana` it is 4.4 MB, of which 82 % is the variable and condition inventories that are already `pub` and regenerate in 4.3 s. The genuinely unobtainable part is ~7 KB. Re-running is cheaper than deserializing. Revisit only when a diagnosis must cross a machine boundary (a user bug report). |
| A `fold3d-inspector` app / browser route | No CI job passes `--features` anywhere, and the one precedent — `fold-profiling` — has *zero* instrumentation sites in `folding3d/`, so `--features fold-profiling` on a 3D fold prints nothing today. A new opt-in surface inherits that trajectory. Also: `apps/web` costs a four-bridge wasm rebuild on every iteration, a shared eslint-config edit for the i18n glob, and the first `import.meta.env.DEV` route in `routing/`. |
| A forked Flat-Folder pipeline | `solve-projected` would be a hand-copy of `buildPipeline`, and flat-folder is a live tracked upstream (`upstream-sync.json`). Worse, it is **tautological or blind** on every seed class: our `FullFold` sign and its `EF_EA_Ff_BF_BI_2_BA0` are the same function of the same inputs, while `Wall` (312 of 529 seeds) and `SharedSlot` are cross-plane and absent from a per-plane sub-problem. 0 % of the seed set is independently checkable. |
| `lattice.rs` grid-divisor inference | Built to align the twins so their constraint counts could be diffed — but the "SharedSlot 29 vs 23" delta is a **placement artifact**: sweeping `starting_face_id` on the *control alone* produces 23/14 at `sf=1` and 28/20 at `sf=0`. The same-starting-face delta is +1 seed on a file with one more face. |
| "Which subface did it die on" as a headline | Non-discriminative — same shape on the working control (§7). |

## Affected Areas

- `crates/oristudio-cp/src/folding3d/order.rs` — the `Contradiction` arm (Phase 0),
  the `found = false` discard (Phase 3), the 3D-only verdict opt-in (Phase 3).
- `crates/oristudio-cp/src/folding3d/wire.rs` — one new arm.
- `crates/oristudio-cp/examples/fold3d_triage.rs` (new) — the committed instrument.
  Note `--all-targets` compiles and clippy-lints every example on every CI run,
  forever, so this is permanent surface: keep it one file.
- `crates/oristudio-cp/src/folding/permutation.rs` — read-only surfacing of the
  blocking position only, and only if Phase 2 needs it. Shared with the flat path.
- `apps/web/src/cp-workspace/folded/foldedFigureNotice.ts` + nine locale files.
- `implementation-plans/fold3d-inspector.md` — **reconcile.** That plan is the
  teaching tool for the same six stages and reserves `folding3d/explain.rs` behind
  `#[cfg(feature = "explain")]`. This plan is the debugging half and deliberately
  ships no feature gate. Say so in both files rather than letting two plans
  disagree about gating.

## Risks

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Phase 3 changes flat-path behaviour through shared `permutation.rs` | 3D-only opt-in, `promoting_on_condition_contradiction` precedent; Oriedita oracle run **with the env var actually set** |
| R2 | The "false negative" reading is wrong and these models are genuinely unorderable | Phase 2's witness replay settles it per instance with no trust in any encoding. §1 already settles `failed_layer_ordering` — the shipped solver folds it at `sf=2` |
| R3 | The committed example rots, like `fold-profiling` and like `examples/fold3d_census.rs` (1,727 lines that import nothing from `folding3d/` and carry their own `struct Rigid`) | One file, no feature gate, pinned against a committed fixture so it runs in the default `cargo test --workspace --all-targets` that CI executes |
| R4 | All three target files live outside the repo, so nothing here is CI-gated on them | Pin Phase 1's report shape against a committed `tests/fixtures/fold-angle-3d/` fixture; treat the external files as the investigation set, not the regression set |
| R5 | Line anchors drift | Everything above is anchored to `HEAD`. Re-verify before editing; the worktree currently carries +186 uncommitted lines from the investigation |

## Checklist

### Phase 0 — the error stops lying
- [ ] Split `Contradiction` out of `NoLayerOrder`, mapping face ids through `global_faces`
- [ ] Wire arm + `orderReasonDetail` case + nine locales; `npm run i18n:check`
- [ ] `cargo test -p oristudio-cp`, `npm run typecheck:web`

### Phase 1 — order-sensitivity, committed
- [ ] `examples/fold3d_triage.rs`: starting-face sweep, subface-order shuffle, both `.osf` shapes, instance-shape header
- [ ] Reproduce the §1 table (2/20, 20/20, 0/20) as the acceptance gate
- [ ] Pin the report shape against a committed fixture so CI compiles and runs it

### Phase 2 — witness replay
- [ ] Replay an alternate-order solution through the original instance's table + `run_final_additional_estimation`
- [ ] Cross-check with `constraints::interleavings` on the partial order
- [ ] Commit one proven false-negative instance + witness as a regression fixture
- [ ] Narrow §3's relation-drop probe to a condition class

### Phase 3 — honest verdict
- [ ] Keep `WorkerOverlapSearch` at the `found = false` return
- [ ] 3D-only opt-in: odometer-wrap exhaustion no longer reports `NoLayerOrder`
- [ ] Oriedita folding oracle green **with `ORIEDITA_GEOMETRY_ORACLE` set**

### Phase 4 — `stick on a floor`, only if still failing
- [ ] Measure promotions-per-iteration against 2,256 synthetic coupling subfaces
- [ ] Decide whether the promotion policy or the coupling filter is the lever

### Reconciliation
- [ ] State this plan's relationship to `implementation-plans/fold3d-inspector.md` in both files
