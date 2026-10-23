# Keep layer-order choices within the selected flaps

## Goal

An M/V layer-order choice must move exactly the selected connected flaps.
Selecting one flap must not offer or preview folds through other flaps.

## Approach

Resolve the seed into its material-connected flaps before searching placements.
Retain all valid outer and inserted landings of that moving set; reject
placements whose overlap closure adds unselected flaps. Keep the existing
connectivity, fold-direction and layer-order checks. Historical saved recipes
still replay directly, without running the authoring search.

## Affected Areas

Fold placement search and target discovery, engine/bridge regression tests,
and the local Heart UI reproduction. No solver algorithm or file-format change.

## Checklist

- [x] Copy Heart and trace candidate generation and final validation.
- [x] Check the reproduced endpoints against the independent Flat-Folder oracle.
- [x] Constrain authoring candidates to the selected material-connected flaps.
- [x] Verify ordinary and inserted placements and explicitly expanded selections.
- [x] Rebuild WASM and verify Heart's CP, preview, confirmation and fresh replay.
- [x] Run focused checks and record results.

## Investigation

The two endpoints from the earlier Heart reproduction both pass Flat-Folder's
independent constraint check. One is nevertheless the wrong action: it moves
other flaps the user explicitly deselected. The bug is in the placement search's
selection contract, not evidence of a failed layer-order solver. Private copies
and oracle evidence stay ignored under `artifacts/heart-order-validity/`.

## Result and validation

- The search resolves selected flaps by material adjacency, rejects candidates
  with a different moving set, and considers targets reached by the selected
  pieces only. Selecting additional flaps still exposes their valid landings.
  The original outer-fold closure refusal is retained if no placement works.
- The copied Heart's front flap (face 12, display Flap 2) now has one exact
  result. It adds one front-relative valley crease at the bottom-right corner
  of the source CP, corresponding to the requested mountain fold in the view.
  No central or other-flap crease is added. The mounted UI reproduction toggles
  flaps, checks the preview, commits, reopens and verifies identical replay.
- All 472 Fold engine/bridge tests passed. The 8 placement tests passed again
  after narrowing the target pool. All 147 Fold web test files (1,080 tests,
  including the local Heart flow) passed against the rebuilt WASM. Scoped
  clippy passed, with the pre-existing unknown-lint warning; touched Rust
  formatting and `git diff --check` passed.
- No web production code, wire format or solver algorithm changed. Full
  unrelated workspace tests, frontend lint/typecheck and production bundling
  were not rerun for this engine-only selection fix.
- The existing server on 5328 serves this checkout. Reload to replace its
  running WASM worker. The original Heart hash still equals the snapshot;
  no model migration, commit, push or PR.
