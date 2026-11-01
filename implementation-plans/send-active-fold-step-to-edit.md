# Send the active Fold step to Edit

## Goal

Send to Edit transfers the crease pattern of the currently selected Fold step,
including only the creases present at that step.

## Approach

- Capture the reader's cursor when Send to Edit runs and wait for that state.
- Keep the existing FOLD conversion, auxiliary-line handling, merge and analytics.
- Gate Send to Edit on the selected state; later steps do not block it.
- Keep sequence exports scoped to the complete active path.
- Update the tooltip and regression coverage for earlier steps, turns, the sheet,
  read-only sequences, broken descendants and navigation during replay.

## Affected Areas

- Fold hand-offs and session waits.
- Fold action catalog, button coverage and translated tooltips.
- Fold integration tests and the existing workspace plan.

## Checklist

- [x] Trace the button, shared command and engine hand-off.
- [x] Add regressions and implement cursor-based Send to Edit.
- [x] Run focused tests, web lint, typecheck and translation checks (106 tests;
  all WASM bridges and the simulator rebuilt by `npm run typecheck:web`).
- [x] Open draft PR #554 against main and start the local app for testing at
  `http://localhost:5236/` (welcome screen verified in the browser).
