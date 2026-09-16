# Exact CP solving research

User objective (2026-09-16): approach 100% clean-topology solving, regardless of
complexity, within 25 seconds. This follows the pixel detector and AUX graph
work in `../cp-recognition/`.

## Protocol

- The original external `real_benchmark` inventory remains frozen. No real
  patterns, including evaluation cases, may be used for model training.
- `Solved` plus passing the editor's existing checks is the primary outcome;
  `accepted` alone includes ambiguous results and is insufficient.
- Report recognition-correct topology and repaired-topology solver-only gates
  separately. Report assignment defects, reference mismatch, and unsupported
  boundary cases; no complexity cap or silent removal of failures.
- Wall time is measured at 25 seconds, sequentially for timing claims. A timeout
  is a failure even if an earlier intermediate graph looked promising. Native
  results do not establish browser performance; test the actual WASM worker.
- Geometric truth agreement (2 px) is a separate outcome: a nearby valid CP may
  not reproduce the original underdetermined design.
- All previous benchmark splits have already been observed. Develop on the
  development split; label holdout replays as observed, never blind. Add
  independent procedural stress cases without real-pattern training.
- Retain baseline binary/source hashes and all per-case outcomes under ignored
  `artifacts/cp-solver/`; archive durable evidence outside this worktree.

## Experiment ledger

| ID | Question | Status |
| --- | --- | --- |
| S000 | Strict 25s baseline and failure attribution | Complete; topology scoring frame corrected |
| S001–S002 | Direct coordinates and crimp-equality Python prototypes | Feasibility established; rejected Kawasaki-only |
| S003–S007 | Shared Rust projection, numerical stability, angle proposal | Corrected rank/null-space failures |
| S008 | Integrated detected development replay | 330/330 exact topology + assignment inputs Solved |
| S009–S010 | Repaired topology and document carrier grouping | 422/422 supported development inputs Solved |
| S011 | Browser hard-case probe | 28/28 supported inputs Solved |
| S012–S013 | Independent procedural scaling and attempt budgeting | All 12 grids solve; native max 4.84s |
| S014 | Numerical grouping for inferred proposal carriers | Clears remaining three recognition geometry failures |
| S015 | Complete actual-browser replay | 531/531 supported clean repaired; 421/421 correct recognition; 24/24 procedural |
| S016 | Isolated timing audit | 256 repaired repeats agree; both slow recognition repeats below 20.6s |

Final [results](results.md), [machine-readable summary](browser-summary.json),
and [chronological notebook](2026-09-16-log.md) retain the full failure counts
and distinguish local exact solving from original-reference recovery.

## Resource ledger

No cloud resources created. Another agent shares the RunPod account; ownership
must be recorded before provisioning, and only this task's resources cleaned up.
