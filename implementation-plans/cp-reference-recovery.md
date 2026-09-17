# Recover original crease-pattern geometry

## Goal

Improve complete-graph recovery, including AUX, from the merged #387 baseline
of 178/421 at 1e-9 paper width and 38/421 at 1e-12. Keep the full browser solve
within 25 seconds, preserve pins/assignments/topology, and investigate the
remaining ambiguity rather than equating local validity with reference recovery.

## Approach

Freeze the merged implementation and the existing recognition-input gate.
Diagnose per-case numerical errors, missed constructions, and unconstrained
degrees of freedom. Develop general geometric methods on the development split;
score truth only after solving. Keep the already-observed holdout label honest.
Test candidate methods independently and in combination, record rejected ideas,
and validate selected changes in the actual browser and on fresh synthetic
examples. Real patterns are evaluation data only, never training data. A plateau
is empirical evidence, not a proof of a universal theoretical maximum.

## Affected Areas

- `crates/oristudio-cp-compiler`: geometric inference and exact solving.
- `scripts/cp-detect/research`: diagnostics and reproducible experiments.
- `research/cp-solver`: ongoing experiment ledger and limits.
- Detection WASM/browser integration and validation.

## Checklist

- [x] Freeze baseline and perform initial error triage of the 243 primary failures.
- [x] Quantify numerical precision and reference-coordinate precision separately.
- [ ] Test general construction inference and constraint formulations.
- [x] Diagnose residual ambiguity with explicit alternative solutions (27 checked witnesses; not a universal ceiling).
- [ ] Replay all 421 cases plus the ten assignment-defect controls in browser.
- [ ] Validate AUX, pins, existing exact inputs, and independent synthetic cases.
- [ ] Archive immutable evidence and report per-case gains/losses at both thresholds.
- [ ] Run affected checks and open a draft PR against main; do not merge.

No production/model publication is authorized. If training becomes useful it
must use synthetic data only. No RunPod resources are currently owned by this
task; resources belonging to the other agent must remain untouched.
