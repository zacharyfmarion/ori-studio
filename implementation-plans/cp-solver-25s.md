# Clean-topology solving within 25 seconds

## Goal

Approach 100% recovery of the exact ground-truth coordinates from clean
recognition topology within 25 seconds, including large patterns, in the browser
and desktop. Local foldability alone is insufficient. Preserve topology, AUX,
assignments, pins and movement limits. **Not achieved:** S018 finds only 178/421
clean recognition outputs match the complete reference graph at 1e-9 paper width.

## Approach

Measure two separate inputs: recognition outputs whose physical topology is
correct, and the benchmark's repaired `topology.fold` files (the solver-only
gate). Record strict `Solved` status, checker defects, runtime, movement, and
agreement with truth separately. An accepted ambiguous improvement is not a
success. Do not exclude hard cases by size. Infeasible assignments and imperfect
reference geometry must remain visible in denominators and attribution.

Use the current external real benchmark for evaluation only, with its existing
development/previously-observed holdout labels. Keep source-frozen baseline
binaries and per-case evidence. Develop on the development set; validate the
selected changes on the observed holdout and independent generated stress cases.
Training, if justified by profiling, uses synthetic data only. Record all
experiments, including negative results, in `research/cp-solver/`.

## Affected Areas

- `crates/oristudio-cp-compiler`: constraint model, optimization, proposal policy.
- `crates/oristudio-cp-detect-wasm` and shared web solving: browser budget/tests.
- `scripts/cp-detect/research`: reproducible isolated solver experiments.
- `research/cp-solver`: protocol, notebook, results and limitations.

## Checklist

- [x] Read current solver research, E027 and the latest benchmark contract.
- [x] Freeze and measure a strict 25-second baseline and failure attribution.
- [x] Profile and test alternative formulations and bounded proposal policies.
- [x] Select improvements without relaxing exactness or geometry checks.
- [x] Validate all complexity strata, independent synthetic cases, and browser.
- [x] Verify AUX/pin compatibility, workspace tests, and affected web checks.
- [x] Archive evidence outside the worktree, with file hashes.
- [x] Create a draft PR with quantified remaining failures: [#387](https://github.com/zacharyfmarion/ori-studio/pull/387).
- [x] Correct the primary metric after the user's exact-coordinate clarification.
- [x] Audit saved predictions with numerical tolerances and AUX included.
- [x] Fix the reproduced Knight BP structural failure without claiming unavailable GT.
- [x] Fix its default crop and inspect changed candidates across external source images.
- [x] Replay recognized and affected document inputs; exact-score exports separately.
- [x] Check independent document grids through 18,624 edges in the browser.
- [ ] Improve exact reference recovery, reporting gains/losses and ambiguity.

No model publication is needed for algorithm-only changes. Any future model
publication follows verified code deployment and preserves the legacy channel.
Never use/delete another agent's RunPod resources; no pods are currently owned.

**User instruction:** do not merge anything without explicit go-ahead. Deliver
research and a draft PR; no merge or deployment is authorized by this phase.
