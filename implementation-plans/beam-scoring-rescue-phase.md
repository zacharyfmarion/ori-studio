# Beam Scoring Rescue Phase

## Goal

Improve `select_candidate_graph_beam_from_ir` so weak legacy candidates that are already present in `CandidateGraph` can win when they improve local graph validity. This phase does not create new candidate lines.

## Approach

- Keep the legacy and arrangement candidate sources source-neutral: both still feed `CandidateGraph`.
- Score beam states by candidate evidence plus cheap local residuals, not by candidate evidence alone.
- Make lower-threshold legacy candidates less double-penalized when their visual support is high.
- Add a bounded rescue pass for plausible lower-threshold candidates that were not reached by normal beam expansion.
- Make Stage 5b audit explain why a candidate won or lost with structural/theorem deltas.

## Non-Goals

- Do not run the full exact solver during beam expansion.
- Do not add missing candidate generation.
- Do not change Python or legacy decoding behavior.

## Done Criteria

- A weak candidate that connects dangling/odd interior endpoints can be selected when it improves the state score.
- A weak candidate that creates new local topology/theorem problems remains unselected.
- Long replacement spans still displace conflicting fragments.
- Stage 5b score breakdown exposes non-zero local topology/theorem terms.
- Targeted compiler tests cover weak promotion, weak rejection, Maekawa/Kawasaki scoring, and replacement behavior.

## Checklist

- [x] Document phase and acceptance criteria.
- [x] Add support-calibrated source cost for lower-threshold legacy candidates.
- [x] Replace IR beam odd-only score with local residual scoring.
- [x] Add bounded lower-threshold rescue pass.
- [x] Populate Stage 5b audit breakdown/reasons with local deltas.
- [x] Add targeted unit tests.
- [x] Run focused Rust and frontend validation.
