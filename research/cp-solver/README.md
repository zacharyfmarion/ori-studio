# Exact CP solving research

User objective (clarified 2026-09-16): recover the exact ground-truth geometry
from clean recognition topology, including AUX, within 25 seconds. Passing
local foldability checks or matching within 2px does not meet this objective.
The earlier S000–S016 work optimized the wrong primary outcome. The goal is
**not achieved**; see [the exact-coordinate audit](exact-recovery-audit.md).

The follow-up [reference-recovery notebook](reference-recovery-log.md) records
S029 onward: tighter numerical solving, generated construction hypotheses,
nonlinear propagation, explicit ambiguity witnesses and rejected searches.
These experiments target complete reference graphs, rather than local validity.
The [validated result](reference-recovery-results.md) is 285/421 at 1e-9 and
276/421 at 1e-12, with zero merged-baseline losses and a 24.551s browser maximum.
See the [machine-readable summary](reference-recovery-summary.json).

## Protocol

- The original external `real_benchmark` inventory remains frozen. No real
  patterns, including evaluation cases, may be used for model training.
- Exact reference coordinates, graph and assignments within 25 seconds are the
  primary outcome. Report a 1e-9-paper-width numerical threshold and sensitivity
  at literal equality and 1e-12; do not call any of these mathematical proof.
  Local `Solved` status is a separate necessary check, not reference recovery.
- Report recognition-correct topology and repaired-topology solver-only gates
  separately. Report assignment defects, reference mismatch, and unsupported
  boundary cases; no complexity cap or silent removal of failures.
- Wall time is measured at 25 seconds, sequentially for timing claims. A timeout
  is a failure even if an earlier intermediate graph looked promising. Native
  results do not establish browser performance; test the actual WASM worker.
- The legacy 2px metric is only a near-match diagnostic. Include AUX in the
  primary reference score; retain the physical-only score as a separate diagnostic.
- Audit whether solver inputs already equal truth. In the old repaired-topology
  gate, 505/526 scored inputs do. That gate measures preservation, not recovery.
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
| S017, S019 | Initial user-provided Knight files | Superseded: user clarified these were the wrong file; do not use for the Knight fix |
| S018 | Exact coordinate recovery audit | Only 178/421 clean recognition outputs match including AUX at 1e-9 paper width |
| S020 | Corrected user-provided Knight file | Missing raster metadata disables partial-grid repair; no GT available |
| S021 | Projection-first partial-grid repair everywhere | Rejected: four exact-reference losses despite all local solves passing |
| S022–S024 | Preserve outer/dark crop candidates | Rejected: neighboring illustration outlines can win |
| S025 | Partial-grid repair for document inputs | Knight aligned in ~2.1s browser; 421/421 local passes, 178/421 numerical reference matches preserved |
| S026 | Additional crop candidates require complete outline | 14/209 source crops change; Knight fixed; existing partial crops remain |
| S027 | Generated document grids up to 18,624 edges | Largest fails: fully fixed proposal validation outlasts its short slice |
| S028 | Reserve validation time for fully fixed document proposals | All three pass in browser; maximum 21.297s, coordinate error at most 3.93e-17 |

The [Knight follow-up](knight-followup.md) records the selected changes and
the rejected experiments.

Final [results](results.md), [machine-readable summary](browser-summary.json),
and [chronological notebook](2026-09-16-log.md) retain the full failure counts
and distinguish local exact solving from original-reference recovery.

## Resource ledger

No cloud resources created. Another agent shares the RunPod account; ownership
must be recorded before provisioning, and only this task's resources cleaned up.
