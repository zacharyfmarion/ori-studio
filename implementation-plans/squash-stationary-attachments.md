# Squash folds beside stationary attachments

## Goal

Allow a squash when another fold is attached only to the part of its lower
material layer that stays still. Continue rejecting attached or covered moving
paper and invalid layer orders.

## Approach

Resolve the squash's per-layer creases before its freedom and coverage checks.
The upper layer moves in full; only the lower layer's spine-side portion moves.
Check off-hinge attachments and covering polygons against that moving portion.
Keep scoring, continuity checks and layer-order completion authoritative.

Use independent square-sheet rectangular pockets for public regression tests;
no private source models or geometry enter the repository.

## Affected Areas

- Original Fold engine squash analysis and validation.
- Squash integration tests and generated local Fold WASM build.

## Checklist

- [x] Reproduce the overbroad refusal with independent rectangular pockets.
- [x] Check attachment and coverage against the moving portion.
- [x] Verify stationary paper, reflection geometry, replay and unsafe refusals.
- [x] Run engine tests, rebuild WASM and validate the native Fold workflow.

## Validation

- 441 Fold engine and bridge tests pass; 11 extended campaigns remain ignored
  by the existing test configuration. Includes mirrored and turned pockets,
  precreased subdivisions, exact stationary and moving material positions,
  stable replay, covered moving paper, and a hinge attached to moving paper.
- Focused Clippy passes; the installed toolchain reports an existing unknown
  configured lint. The local Fold WASM was rebuilt and exercised in Fold.
- 1,316 affected web tests pass after that rebuild. Private checkpoint replay
  compares fingerprints, geometry, exposed sides and all layer stacks; its
  source-derived evidence remains Git-excluded.
- Full workspace and upstream oracle runs were not repeated: the change is
  confined to the original Fold squash primitive and changes no port behavior.
