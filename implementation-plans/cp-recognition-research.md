# Crease-pattern recognition research

## Goal

Make Ori Studio's browser recognition substantially more reliable on large,
complex patterns, targeting a 3–5× reduction in recognition errors, exact graph
recovery, and end-to-end latency of about one minute or less. Train only on
synthetic patterns. Keep all attempts, including negative results, reproducible.

## Approach

1. Audit the latest real-benchmark harness, September research, current model,
   and training provenance. Treat older conclusions as hypotheses.
2. Freeze the starting commit, benchmark inputs, metrics, and runtime settings;
   report exact topology, assignments, solved recovery, and large-pattern strata.
3. Attribute remaining failures and test distinct approaches (higher-resolution
   inference, direct raster geometry, and synthetic-only training as evidence
   warrants). Keep truth files outside all inference and training paths.
4. Select on a declared development subset; reserve a deterministic holdout for
   the final comparison. Record any prior benchmark exposure honestly.
5. Integrate only measured improvements in the shared browser-compatible code,
   test meaningful regressions, validate in the browser, and prepare a draft PR.

## Affected Areas

- `research/cp-recognition/`: notebook, experiment register, findings.
- `scripts/cp-detect/`: reproducible experiment and evaluation tooling.
- `crates/oristudio-cp-detect/`: recognition algorithms and benchmark harness.
- `apps/web/src/engine/`: browser inference, if experiments justify changes.
- Ignored `artifacts/cp-recognition/`: reports and intermediate outputs.

## Checklist

- [x] Read recent research and audit training/data provenance.
- [x] Establish current benchmark baseline and complexity/runtime strata.
- [x] Declare experiment metrics, development set, and holdout.
- [x] Run and record competing recognition experiments.
- [x] Implement the best supported browser-compatible approach as a local preview.
- [x] Run held-out evaluation and browser runtime checks.
- [x] Complete relevant tests and document limitations.
- [x] Confirm all research-created RunPod resources are deleted.
- [x] Open [draft PR #384](https://github.com/zacharyfmarion/ori-studio/pull/384)
  against `main` with reproducible results.

## Measured outcome and remaining objective

The selected synthetic-only candidate has 4.09× fewer missing/extra edges on
the combined corpus and 2.39× fewer on the reserved internal holdout. Exact
recognition improves from 356 to 431 of 545 graphs. Largest measured browser
recognition completes in 23.6 seconds after a parity-preserving speedup.
Oriedita cyan AUX is retained as F through recognition, solving, and preview.

Perfect complex-pattern recognition, consistent curated-case improvement, and
a one-minute bound including exact solving remain unmet. The production model
is not promoted. See `research/cp-recognition/results.md` for the evidence and
the remaining research questions; the delivery checklist is not a claim that
these quality objectives are solved.

## Follow-up investigation

- [x] Diagnose remaining model versus decoder errors with clearly labeled oracles.
- [x] Test larger sampling and synthetic-only annotation training; reject regressions.
- [x] Prototype a partial dominant-grid solve on development only.
- [x] Integrate opt-in fallback with original-coordinate checks and a shared deadline.
- [x] Replay the integrated policy and verify browser results and elapsed time.
- [x] Update reproducible evidence, tests, notes, and the draft PR.

E027 raises strict solved recovery to 390/526, with 20 gains and no recovery
regressions over the prior candidate. Dwarf is fully exact in the browser in
14.16 seconds. Automatic compact import shares a cooperative 60-second budget;
recognition quality, ambiguous low-resolution inputs, and curated regressions
remain limitations. E028 and E029 did not justify changing the selected model.
E030's optional second-model strategy is recorded but is not the default.
