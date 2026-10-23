# Precrease and fold along existing creases

## Goal

Allow Segment and Pinch precreases to reuse an existing flat crease, including
reversing only its selected portion. Verify mountain and valley folds use those
creases with the correct layer order. Unblock Witch Hat source step 7 locally.

## Approach

Use the existing line analysis and layer selection. Include flat hinges between
moving and stationary material, subdivide them only where their remembered
letter changes, and retain face identities, geometry, order and crease history.
Keep marks off topology edges and run the normal state validation. Full folds
continue through the existing refold path. No new tools or non-flat behavior.

## Affected Areas

- Fold engine partial precreases and focused regression tests.
- Real WASM bridge / saved-document replay tests.
- Witch Hat native model and campaign evidence.

## Checklist

- [x] Reproduce the existing-crease refusal and inspect full M/V refolding.
- [x] Implement bounded reuse with existing guards intact.
- [x] Test M/V, both paper sides, layer selection, endpoint splits and replay.
- [x] Rebuild WASM and verify the local Fold workspace.
- [x] Retry Witch Hat, preserve exact failures, and update the gap ledger.

Local work only; no PR or push requested.

## Result

F014 is resolved. Witch Hat is saved through source 7 / Fold step 10; source 8
is a separate compound-authoring investigation (F031). The next confirmed tool
improvement is F019, squash pocket selection across flat subdivisions. Full
workspace tests passed (2,837 tests); see
[verification report](../research/origami-me-flat-catalog/batches/existing-crease-2026-10-14.md).
