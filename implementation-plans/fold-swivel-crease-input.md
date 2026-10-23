# Swivel crease input and participating-paper guards

The three-point UI, and the two-line construction that followed it, are superseded by the [swivel by its valley and mountain](swivel-valley-mountain.md). The guard fixes remain.

## Goal

Make coupled flat reverse/swivel constructions authorable in Fold when their
hinges are specified by existing points or precreases. Verify the intended
geometry through the public operation and actual UI path. Correct a reverse
fold's near-miss scope without relaxing numerical guards.

## Approach

Compare the existing inside swivel's derived creases with the requested
construction. Reuse that operation if its geometry fits; otherwise add only the
missing well-defined flat construction, preserving material continuity and
explicit layer-order choices. Keep private reference geometry, probes, and
models in the ignored study folder. Use independent synthetic public tests.
For reverse folds, classify provisionally, resolve the complete attached tip,
then validate its vertices before analysis/landing; unsafe snaps still refuse.

## Affected Areas

- Original Fold compound operations and numerical validation.
- Fold bridge, saved operations and shared tool input/preview/commit path as needed.
- Public regression tests; private authoring evidence and checkpoint.

## Checklist

- [x] Establish the intended crease geometry and test the existing inside swivel.
- [x] Implement missing engine/input functionality, if required.
- [x] Correct and test reverse near-miss scope, including connected unsafe paper.
- [x] Verify UI picking, preview, order choice, commit and fresh replay.
- [x] Compare the private candidate with the reference and preserve the original.
- [x] Rebuild local WASM, run affected validation and document exact UI steps.


## Implementation

- Added **Swivel → Construct by → By creases**. Pick the exact meeting point
  on a folded edge, a point along the first layer’s crease, and a point along
  the other layer’s hinge. Open/Inside, direction, and explicit layer-order
  selection use the existing controls. Enter appends the saved operation.
- The original edge-onto-line construction constrains the second hinge to a
  bisector relationship. The new construction locates both hinges independently
  and computes the remaining crease from reflection closure. Both constructions
  share the folded-swivel compiler, material continuity checks, order solver,
  and validity gates.
- Sequential compound scoring can refine an unsplit neighbor’s boundary ring
  without changing that face’s identity. This allows the two layers to crease
  differently at their shared meeting point. Ordinary scoring keeps its stricter
  contract.
- A meeting-point reference can belong to underlying paper: exact coincident
  scene geometry anchors it to the folded edge. Nearby points are not moved to
  manufacture a coincidence. The given meeting point renders as a dot on hover
  and selection; the edge construction retains its whole-edge highlight.
- Reverse-fold near misses are checked after the complete attached tip is
  resolved. Unrelated stationary paper no longer blocks the operation; selected
  or attached near misses and unsafe snapping still refuse.
- Saved operations use `via: "creases"` with three sheet anchors, direction,
  kind, and the normal saved order choice. Engine version 4 marks the changed
  operation surface. Existing operations continue to replay.

## Validation

- Both affected Rust crates: **451 passed**, 11 existing extended tests ignored.
  Existing folded-swivel cases and new synthetic independent-hinge and
  participating-paper guard regressions pass. Formatting and scoped Clippy pass
  (the toolchain reports the existing unknown-lint warning).
- Rebuilt the Fold WASM bridge. Real bridge tests cover three-point input,
  Inside selection, commit, serialization and fresh replay. The Fold web suite
  passed 153 files; its one failing file had obsolete setting-count expectations,
  corrected and rerun successfully. Focused picking/overlay/swivel tests pass
  after the exact-point feedback correction; the reach tests pass too.
- Web typecheck and lint pass (one existing virtualizer warning); translation
  extraction/check and diff checks pass.
- An ignored private study uses actual folded-pane clicks through the shared
  canvas path, preserves the original model, and freshly replays every saved
  state. The checkpoint opens in Fold. Its intermediate geometry, exposed paper
  sides and layer order were compared with the reference. It is ready for audit.
- A real browser check confirms the first click displays a point and advances
  the instruction to the first hinge. No private geometry or book images are in
  tracked tests. Whole-workspace/oracle/desktop/production-bundle checks were not
  run: this changes the original Fold subsystem and shared web interaction;
  affected native crates, the rebuilt bridge, and the local browser were checked.
