# 3D layer ordering: the coupling livelock, and the cancel that concludes

## Goal

Make `Fold3dOrderEnumerator` terminate on every admitted placement, and make
pressing Stop unwind instead of minting a figure that asserts something false
about the crease pattern.

Three separable defects, in the order they hurt:

1. **A cancel during the ordering search is laundered into a verdict.** The user
   presses Stop, the fold "succeeds", and a figure appears labelled *"The layers
   of this figure could not be put in order."* — plus a kernel handle, a canvas
   entry, an undo step and a dirty project.
2. **The search cannot see the coupling constraints it is required to satisfy.**
   Every channel that would carry them is closed, so on a model with binding
   couplings the search never converges. It is a livelock, not a long
   computation.
3. **Nothing bounds the search.** Even with (2) fixed, no model may be allowed to
   hang; the kernel must be able to give up and say so honestly.

Reproduced on `hex pleated pangolin by Naoki Terao.osf` (683 creases, 88
non-classic, 365 faces, 6 planes). Everything before layer ordering costs ~35 ms;
layer ordering never returns.

## Root cause

Measured with a throwaway `examples/fold3d_profile.rs` against `oristudio-cp`,
driven by the `fold-profiling` counters plus temporary counters inside
`possible_overlapping_search`. Numbers below are from that harness.

### The coupling constraint is correct. Do not "fix" it.

The first plausible reading of this bug is that the coupling scaffolding in
`plan()` (`folding3d/order.rs:775-801`) is self-contradictory: it writes four cut
relations asserting *every* face of `first` above *every* face of `second`
straight into the initial hierarchy, and then adds a quadruple condition over the
same four faces which promptly contradicts them.

That reading is wrong, and it is worth stating because it costs a day to
rediscover. With the cut in place, `apply_quadruple_condition`'s rule 1 fires
exactly when `a>c ∧ b>d` and rule 3 exactly when `c>a ∧ d>b`; both raise a
contradiction through `HierarchyTable::infer_above` (`folding.rs:4763`, which
errors when the opposite cell is already set). What survives is precisely
`[a above c] != [b above d]` — the documented encoding, with `differ` flipping it
to `==` by swapping `b`/`d`. **The contradiction is the mechanism, not a defect.**

On the pangolin, coupling #40 is `first=(81,153) second=(159,156) same=true`,
condition `{a:81, b:156, c:153, d:159}`. The observed failure —
`Contradiction { upper_face: 159, lower_face: 81 }` — is rule 3 firing because
the AEA had established `153>81` and `159>156`, which is exactly the combination
this coupling forbids. The constraint is doing its job.

### All three channels that would let the search respect it are closed

**Channel 1 — the guide map.** The coupling's four faces live in exactly one
subface: the synthetic one `plan()` creates for the coupling (index 106 of 266).
`prioritize_subfaces` selects a valid prefix by "adds new pair information", and
the coupling subfaces duplicate pairs the real subfaces already cover, so the
prefix is `valid_count = 66` and the carrier is outside it. `set_guide_map` is
only built for the prefix, so those four faces are never permuted together and no
guide encodes the condition.

**Channel 2 — the realtime AEA.** The only remaining propagation path. It is
disabled permanently the first time it reports a contradiction
(`permutation.rs:1385`), which is faithful to upstream
(`FoldedFigure_Worker.java:187`, *"Disable realtime AEA"*). Because the coupling
is binding, that happens immediately:

```
realtime AEA disabled at subface position 1 of 66: Contradiction { upper_face: 159, lower_face: 81 }
```

Counters confirm it never runs again: `realtime=1 fast_realtime=0` for the whole
run. Upstream's policy is a reasonable fit for the flat path, where a realtime
contradiction is rare and hard to interpret. It is a poor fit for the native 3D
path, where couplings make an early contradiction close to guaranteed.

**Channel 3 — the promotion recovery.** The final check catches the violation
every single time, and reports it with no error index:

```
finalAEA[calls, trans_x, tri_x, quad_x, passes, ok] = [3344, 0, 0, 3344, 0, 0]
failing_quad = [(930, 3344)]      # 3344 of 3344, always the same condition
```

Index 930 sits in the coupling tail (890 constraint quads + 200 coupling quads),
i.e. it *is* coupling #40's condition. `run_final_additional_estimation` returns
`error_position: None` for both the triple and quadruple arms — correct parity,
since upstream sets `errorIndex` only in the `CONTRADICTED_2` catch and leaves it
`0` for `CONTRADICTED_3`/`CONTRADICTED_4`. So the recovery at
`permutation.rs:628-646` cannot fire, and `valid_count` stays frozen at 66/266
forever.

This is the cruel part: upstream's own comment says that branch exists because
*"typically it means the solution contradicts some of the SubFace not counted as
valid previously. In that case, adding it to the valid set will solve the
problem."* That is a precise description of our failure — and the code path that
would act on it is unreachable for the error class that produces it.

### What that costs

~1,500 outer iterations/sec. ~31% of them reach a fully consistent stacking of
all 66 valid subfaces; all are rejected by the final check on condition 930, at
~1.3 ms each — about 60% of wall clock spent re-proving the same contradiction.
The search then backtracks the deepest subface and regenerates an equivalent
candidate. Indefinitely.

Control experiment (`SCRATCH_NO_COUPLINGS=1`, diagnostic only — **not** a
proposed fix, see the 1×4 strip counterexample in the `order.rs` module doc):

```
components=12 (1172, 1172, 1069, 199, 39, 39, 15×6)
order (with_cells): 24.1 ms
relations=3780  undetermined=0  crossings=0
realtime=22 fast_realtime=14      # AEA stays enabled
outer_iters=17
```

The 200 couplings fuse 12 natural components into one 3,780-variable monolith,
and close every channel that would let it be solved.

### The cancel leak

`search_error` (`folding3d/order.rs:570-584`) matches only the `Contradiction`
arm and funnels everything else into `SearchFailed`:

```rust
_ => Fold3dOrderError::SearchFailed { component },
```

`WorkerOverlapSearchError::Cancelled` lands there, and
`Fold3dOrderError::is_cancelled()` returns **false** for `SearchFailed`. So
`Fold3dSession::new` takes its degrade path (`folding3d/session.rs:181-198`)
instead of unwinding, and mints a placed figure carrying `no_layer_order` —
exactly what the comment at `session.rs:172-179` says must never happen: *"A
cancel unwinds; it never concludes."* The sibling guard exists on the `cell_index`
arm directly above; this arm was missed.

Two more sites leak the same way:
- `ComponentSolver::step` (`order.rs:530-537`) — `.map_err(|_| SearchFailed)` on
  `enumerator.next()` swallows `PermutationError::Cancelled`.
- `Builder::localise` (`order.rs:934`) — `AdditionalEstimationError::Setup(_) =>
  SearchFailed` swallows `Setup(FoldSetupError::Cancelled)`, which
  `FoldSetupError::is_cancelled` confirms is a real route.

The existing regression test does not catch it. `a_cancelled_3d_fold_never_
concludes_about_the_pattern` (`tests/cancel.rs:304`) asserts the verdict is not
`NoLayerOrder { reason: Cancelled }` — a cancel laundered into
`reason: SearchFailed` passes it. The test was written for the arm that was
fixed.

## Approach

Four phases. Phase 1 is independent and should land first. Phase 2 is expected to
be sufficient on its own for the pangolin; Phase 3 is only undertaken if
measurement says it is still needed, because it diverges from upstream. Phase 4
is the safety net and is not optional — it is what makes "no model hangs" a
property rather than a hope.

### Phase 1 — a cancel unwinds, at every depth

Route all three sites through the existing `is_cancelled()` predicates rather
than through a wildcard. `WorkerOverlapSearchError::is_cancelled()` already
handles every nested arm correctly; the bug is only that nobody calls it.

```rust
fn search_error(component: usize, error: WorkerOverlapSearchError) -> Fold3dOrderError {
    if error.is_cancelled() {
        return Fold3dOrderError::Cancelled;
    }
    match error { /* unchanged */ }
}
```

Same treatment for `ComponentSolver::step`'s `next()` mapping
(`PermutationError::Cancelled => Fold3dOrderError::Cancelled`) and `localise`'s
`Setup` arm.

Then tighten the test so it cannot pass on a laundered cancel: assert the verdict
is not `NoLayerOrder { .. }` for **any** reason, not just `Cancelled`. Add a
fixture whose ordering search runs long enough for a cancel to land inside
`possible_overlapping_search` — the current fixtures may not reach it, and a test
that never enters the code it guards is not a guard.

### Phase 2 — give the final check an error index it can act on

Make the promotion recovery reachable for condition-driven contradictions. When
`run_final_additional_estimation` fails on a triple or quadruple condition,
locate a subface that carries that condition's faces and report its position, so
the caller promotes it into the valid set, builds its guide map, and the search
can then see the constraint it has been violating.

Mechanics that matter:

- **Index space.** `error_position` is a **1-based position in `self.order`**,
  not an entry index — `infer_final_subface_transitivity` enumerates
  `configuration.reduced_subface_indices`, which is `0..n` over
  `order.iter().take(entries.len())`, and the recovery swaps within `self.order`.
  A condition-derived index must be in the same space.
- **Only promote from outside the prefix.** If the carrier is already at a
  position `< valid_count`, promotion is meaningless; fall back to `None` and
  keep today's behaviour.
- **Prefer the smallest carrier.** Several subfaces may contain all four faces;
  the synthetic coupling subface is the tightest and the one whose guide map
  actually encodes the condition.

**Parity gating is mandatory.** `permutation.rs` is shared with the flat Oriedita
path, where upstream returns `SubFace_valid_number` with no promotion for
3EC/4EC. Changing that changes flat-path solution *order*, which the oracle tests
pin. Add an explicit opt-in on `WorkerOverlapEnumerator` (e.g.
`promote_on_condition_contradiction`), set by `folding3d::order::build_enumerator`
and left off for every flat caller. Run `oriedita_folding_oracle` to confirm the
flat path is byte-identical.

### Phase 3 — stop disabling the AEA wholesale (only if Phase 2 is not enough)

A realtime-AEA contradiction at subface `i` is a proof that the partial
assignment over `order[0..=i]` is infeasible. Backtracking at `i` is sound and is
strictly better pruning than switching the detector off for the rest of the run.
Upstream's concern is about *interpreting* the inference error, not about the
logic.

If Phase 2 leaves the search slow, treat the failure as
`WorkerSearchStep::Inconsistent { subface_id: index + 1 }` on the 3D path only,
behind the same opt-in flag as Phase 2. Watch for the dirty-table hazard upstream
alludes to: `inconsistent_subface_request` returns its table, and `last_table`
feeds the `found = false` return.

Measure before and after. If Phase 2 alone brings the pangolin to a sane time,
**skip this phase** — it is a deliberate divergence and should not be taken
speculatively.

### Phase 4 — a bounded search with an honest verdict

No model may hang. Bound the per-component search and report giving up as its own
outcome.

- **Bound iterations, never wall clock.** `folding3d/session.rs:13-18` promises
  *"Solution N is the same solution on every run of the same segments"*. A
  wall-clock budget makes the result machine-dependent and breaks that contract.
  An outer-iteration budget is deterministic.
- **A new error arm, not `NoLayerOrder`.** Reporting "we gave up" as "no layer
  order exists" is the same category error as reporting a cancel that way — it
  asserts something false about the user's crease pattern. Add
  `Fold3dOrderError::SearchExhausted { component, iterations }`, a matching
  `Fold3dOrderWire` arm, and its own sentence in `orderReasonDetail`, keeping the
  "Simulate instead" action.
- Pick the budget from measurement, generous enough that every model in
  `tests/fixtures` and the non-flat corpus finishes well inside it.

## Affected Areas

- `crates/oristudio-cp/src/folding3d/order.rs` — `search_error`,
  `ComponentSolver::step`, `Builder::localise` (Phase 1); `build_enumerator`
  opt-in (Phase 2); new error arm (Phase 4).
- `crates/oristudio-cp/src/folding/permutation.rs` —
  `run_final_additional_estimation` and the promotion recovery in
  `possible_overlapping_search` (Phase 2); the realtime-AEA disable site
  (Phase 3); the iteration budget (Phase 4).
- `crates/oristudio-cp/src/folding3d/wire.rs` — `Fold3dOrderWire` arm and its
  `From` mapping (Phase 4).
- `crates/oristudio-cp/tests/cancel.rs` — tighten
  `a_cancelled_3d_fold_never_concludes_about_the_pattern`; add a fixture that
  reaches the ordering search.
- `crates/oristudio-cp/tests/folding3d_order.rs` — coverage for promotion and for
  the exhausted verdict.
- `crates/oracle-tests` / `oriedita_folding_oracle` — flat-path parity must be
  unchanged.
- `apps/web/src/cp-workspace/folded/foldedFigureNotice.ts` and
  `apps/web/public/locales/*/panels.json` — the new reason's sentence, all
  locales (Phase 4).
- `apps/web/src/engine/oristudioCpTypes.ts` — `OristudioCpFold3dOrderReason`
  gains the arm.

## Validation

- `cargo test --workspace`, plus `cargo clippy --workspace --all-targets -- -D warnings`.
- `oriedita_folding_oracle` specifically, as the flat-path parity gate for
  Phases 2 and 3.
- The pangolin file end to end, timed, at each phase. It is not committed (it is
  a community file outside the repo); the harness reads any `.osf` by path.
- `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`, and
  `npm run i18n:check` for Phase 4's user-facing string.
- Rebuild the CP wasm bridge before trusting anything in the browser:
  `npm --workspace @treemaker/web run build:oristudio-cp-wasm`.

## Amendment, found during Phase 2: the priority pass was losing subfaces

The plan above assumed the coupling carrier subface was *present but outside the
valid prefix*. It was not present at all.

`max_priority_subface` seeds "best so far" with index 0. Upstream's arrays are
1-based, so `0` is its nothing-found sentinel; this port is 0-based, so `0` names
a real subface that has usually already been placed. Once the sweep reaches the
tail where nothing carries new pair information — which is every sweep — no
candidate beats the seed and the already-placed subface is selected again. The
returned list is the right length and the wrong contents: 266 subfaces came back
as 266 slots holding **66 distinct** ones, and the 200 that vanished were every
subface the 3D path invents for a coupling. `condition_carrier_position`
therefore returned `None` for the very condition it was written to find.

With that fixed, promotion fires as designed — 10 promotions, `valid_count` 66 ->
76 — and the model orders in 299 ms. The lesson for the next reader is that
"outside the valid prefix" and "absent from the search" look identical from every
symptom the plan was written from; only `distinct_subface_indices` told them
apart.

## Notes for whoever picks this up

The diagnostic harness was an `examples/fold3d_profile.rs` in `oristudio-cp` that
loads `workspace.creasePattern.creasePattern.document.crease_pattern` from an
`.osf` into a `CreasePatternModel`, filters to `is_folding_line()`, and runs
`admit_with` → `census_placement` → `cell_index` →
`Fold3dOrderEnumerator::with_cells` → `render_model` with a timer on each. It was
reverted rather than committed; rebuild it if you need the numbers again. The
useful temporary counters were: per-component sizes in `with_cells`, a 1 Hz
progress line in `possible_overlapping_search` reporting `valid_count` and a
histogram of the `subface_id` that came back `Inconsistent`, and a histogram of
the failing quadruple-condition index in `run_final_additional_estimation`. The
last of those is what turned "the search is slow" into "3,344 of 3,344 failures
are the same condition".

One measurement that looked promising and was not: swapping
`run_final_additional_estimation`'s hand-rolled `O(subfaces × k³)` transitivity
sweep for the ported incremental `AdditionalEstimation::run` (which upstream
actually uses for its final check) moved per-call cost only 1.35 ms → 1.28 ms.
Worth doing for parity's sake at some point, but it is not the lever here — the
lever is the number of calls, not their cost.

## Checklist

- [x] Phase 1: route `search_error` through `WorkerOverlapSearchError::is_cancelled()`
- [x] Phase 1: `ComponentSolver::step` maps `PermutationError::Cancelled` to `Cancelled`
- [x] Phase 1: `Builder::localise` maps `Setup(FoldSetupError::Cancelled)` to `Cancelled`
- [x] Phase 1: tighten the cancel test — it now compares against the unbound
      baseline verdict, so a cancel wearing *any* reason code fails it
- [x] Phase 1: add a test whose cancel lands inside `possible_overlapping_search`
- [x] Phase 2: derive an `error_position` for condition-driven final-check contradictions
- [x] Phase 2: add the `promote_on_condition_contradiction` opt-in; 3D on, flat off
- [x] Phase 2: **the priority pass was losing subfaces** — see the amendment above
- [x] Phase 2: `oriedita_folding_oracle` confirms the flat path is unchanged
- [x] Phase 2: pangolin — never terminated -> 299 ms, `Folded`, nothing undetermined
- [x] Phase 3: decided — **not needed**; Phase 2 alone brought the pangolin to 299 ms
- [x] Phase 4: deterministic outer-iteration budget per component
- [x] Phase 4: `SearchExhausted` error arm, wire arm, and `From` mapping
- [x] Phase 4: `orderReasonDetail` sentence + all 9 locales + `i18n:check`
- [x] Every committed fixture finishes well inside the budget (0-1 iterations;
      worst real model 2,248 against a budget of 1,000,000)
- [x] Rebuild the CP wasm bridge and confirm the pangolin in the browser —
      folds through the real bridge in 435-593 ms, `verdict: folded`,
      `undetermined_cells: 0`; `hex head 2` reports a genuine `no_layer_order`
      in 552 ms, so the budget does not fire on it
