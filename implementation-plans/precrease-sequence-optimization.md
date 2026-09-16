# Precrease sequence optimization

## Goal

Produce flat-sheet precreasing instructions that are easier to execute, with
fewer preparatory marks and less crease outside the pattern. Preserve target
coverage, approximation policy, physical references, and the existing human
feedback rules. Every operation starts and ends with the sheet unfolded.

## Approach

Independently audit the supplied review against merge `5855e070`. Establish a
reproducible baseline before training anything. Extract the actual scheduling
transition, including historical paper snapshots and retroactive pinch repairs.
Evaluate complete counterfactual schedules by replaying physical instructions;
retain the baseline whenever an alternative fails the acceptance criteria.
Measure runtime and per-design outcomes, including regressions and unavailable
external data. Only consider model training if useful deterministic search is
too expensive. Any RunPod resources would be created and tracked specifically
for this task; other agents' resources must never be used or deleted.

The original planner is not an upstream port. Its geometric constructors and
axiom validity rules remain authoritative. A folded-line set alone is not a
search state: crease coverage, face, witnesses, and prior pinch commitments
matter. Future folded-state planning needs an explicit layer/material state;
this change must not imply that flat-sheet monotonicity extends to it.

## Affected Areas

- `crates/oristudio-precrease`: ordering, replay quality, planner integration.
- Planner examples and tests: reproducible comparisons and regression cases.
- Research notes: independent assessment, methods, results, limitations.
- The precrease WASM bridge and References workspace for integration validation.

## Checklist

- [x] Read the review, repository guidance, and scheduling implementation.
- [x] Establish baseline tests, benchmark inputs, and physical replay metrics.
- [x] Extract scheduling transitions without changing baseline output.
- [x] Compare dynamic scheduling and bounded counterfactual search.
- [x] Ship only measured improvements with replay acceptance safeguards.
- [x] Add adversarial, regression, and budget/determinism coverage.
- [x] Validate native, WASM, and affected browser behavior.
- [x] Record reproducible results and remaining research limitations.
- [x] Open a draft PR against `main` and provide the local testing surface.

Draft PR: https://github.com/zacharyfmarion/ori-studio/pull/383. The local
References preview runs through `scripts/dev-server.sh` on port 5246.
