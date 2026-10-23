# Squash selection across precreases

## Goal

Selecting any exposed flat subdivision of a squash pocket identifies the same
spine, hinge and material layers. Resolve F019 without accepting covered or
attached pockets, changing their geometry, or dropping preparation creases.

## Approach

Discover the two picked layers' connected flat components before looking for
their folded spine. Resolve hinge endpoints from the actual incident lower
faces, then retain the existing hinge-bounded flap growth, coverage checks and
compound landing pipeline. Validate stable selection and results across all
subdivisions, both viewing sides, asymmetric targets and later squashes.

## Affected Areas

- `crates/oristudio-fold/src/compound/squash.rs`
- Fold engine and real-WASM/document regression tests
- Campaign F019 evidence and ledger notes

## Checklist

- [x] Preserve and reproduce the Bird pocket-selection failure.
- [x] Resolve the spine and hinge across flat subdivisions.
- [x] Verify every equivalent pick produces the same material and layer order.
- [x] Keep covered, unrelated and attached-pocket refusals intact.
- [x] Rebuild Fold WASM, test in the browser and update F019 evidence.

Validation: 2,838 workspace tests and 20 focused real-WASM tests pass. All 568
states in the 42 saved models retain their recorded canonical hashes. Browser
selection and commit from Bird's previously failing pocket subdivision passed.
See [batch evidence](../research/origami-me-flat-catalog/batches/squash-precreases-2026-10-14.md).

The CP-linked Collapse step is a separate design discussion. Preserve the
user-edited Witch Hat file unchanged. No PR, push or schedule.
