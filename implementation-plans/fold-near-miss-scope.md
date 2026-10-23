# Near-miss checks on participating paper

## Goal

Do not refuse a selected-layer fold or precrease because its line passes near
an existing vertex on untouched paper. Keep the numerical safety checks on
paper selected directly or included by attachment and overlap closure.

## Approach

Reproduce the issue using independent square-sheet folds. Separate provisional
line classification for layer selection from the minimum-feature validation
required before changing paper. Preserve existing snapping and all thresholds.
Check the completed moving set, including automatically included layers. Keep
the depth picker and cross-section usable for valid selections. Confirm the
private authoring case without including private geometry in public fixtures.

## Affected Areas

- Original Fold line classification, closure and layer-selection queries.
- Public engine regression tests and the local Fold WASM build.
- Private model validation and progress notes (Git-excluded).

## Checklist

- [x] Reproduce a valid selected-layer operation refused by untouched paper.
- [x] Confirm the affected-layer membership in the private operation.
- [x] Scope validation to participating paper without relaxing tolerances.
- [x] Test affected vertices, closure-added layers, preview parity and replay.
- [x] Run engine/bridge checks, rebuild WASM and recheck the saved operation.

## Result and validation

Plain folds, whole/partial precreases and depth choices classify stable near
misses provisionally, then validate every vertex of the completed moving
faces before scoring or moving paper. This includes stationary corners of
split faces and layers included by adjacency or overlap. Unsafe snap changes
still refuse globally. Compound callers retain strict classification.

Cross-sections describe all layers before a selection exists; a section is not
permission to fold them. Invalid depths are omitted, and applying an invalid
selection retains the original typed refusal and landmark fix.

- 447 Fold engine/bridge tests pass; 11 existing extended campaigns ignored.
- Regressions cover untouched lower vertices, whole and segment precreases,
  valley/mountain with turned paper, directly selected and closure-added
  vertices, depth/section/action/summary parity, material positions and sides,
  stationary face identity, and deterministic replay.
- Scoped Clippy, formatting and diff checks pass (Clippy retains the existing
  unknown configured lint warning on this installed toolchain).
- 1,141 Fold web tests pass. The two localStorage-dependent UI files required
  disabling Node 26 experimental web storage; their 28 tests pass on retry.
- Fold WASM rebuilt; private stored operations replayed through it and the
  resulting native sequence opened and inspected in the Fold workspace.
- Unrelated workspace, production bundle and upstream-oracle suites omitted:
  no ported algorithm, frontend source, wire format or build setup changed.
