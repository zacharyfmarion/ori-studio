# Clean-topology solving within 25 seconds

## Goal

Approach 100% exact geometric solving of clean crease-pattern topologies within
25 seconds, including large patterns, in the browser and desktop. A successful
solve must pass the existing editor checks without weakening them, preserve
topology and AUX connectivity, and respect pins and movement limits.

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
- [ ] Create a draft PR with quantified remaining failures.

No model publication is needed for algorithm-only changes. Any future model
publication follows verified code deployment and preserves the legacy channel.
Never use/delete another agent's RunPod resources; no pods are currently owned.

**User instruction:** do not merge anything without explicit go-ahead. Deliver
research and a draft PR; no merge or deployment is authorized by this phase.
