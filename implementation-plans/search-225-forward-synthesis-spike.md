# SEARCH 22.5 Forward Synthesis Derisking Spike

## Goal

Validate the first two assumptions behind a target-conditioned 22.5-degree
forward solver: a labeled metric tree can be represented as a signed axial
schedule, and a generated candidate can be accepted or rejected using exact
tree correspondence instead of a spectral nearest-neighbor score.

## Approach

Add an isolated experimental Rust crate with no changes to canonical TreeMaker
behavior. Model labeled metric trees, enumerate signed axial schedules, build a
minimal folded ribbon-complex representation, extract its tree, and compare
candidate trees using label-preserving graph isomorphism plus scale-normalized
edge-length error. Capture the experiment's conclusions and remaining risks in
the crate README.

## Affected Areas

- `Cargo.toml`
- `crates/treemaker-225-spike/`
- `implementation-plans/search-225-forward-synthesis-spike.md`

## Checklist

- [x] Inspect SEARCH 22.5 and the existing TreeMaker/FOLD architecture.
- [x] Implement labeled metric-tree validation and exact correspondence.
- [x] Implement signed axial schedules and ribbon-complex round trips.
- [x] Add focused unit tests.
- [x] Document conclusions, falsified assumptions, and the next experiment.
- [x] Run deterministic Rust validation.
- [x] Open a draft pull request against `main`.
