# Increase Default spread inclination

## Goal

Let Default spread reveal layers farther at the same height throughout Ori
Studio, while preserving the exact view of existing saved models.

## Approach

- Expand the shared reveal-vector radius from 2 to 3 (1.5 times the previous
  maximum). Keep stored vectors, projection, height amounts, defaults and the
  absolute minimum edit radius of 0.1 unchanged. No migration or version bump.
- Use the same range for edits and file validation, including Fold, Diagram,
  Edit properties, export and share. Older builds already treat vectors beyond
  their supported range as newer data.
- Scale the circle's pointer mapping, handle and minimum marker from that
  range. Keep fine keyboard increments; Shift remains the larger increment.
  Saved handles move inward in the expanded circle, without changing the view.
- Retain the existing spread-change analytics; this extends an existing control.
- Verify old and expanded values through file round trips, gestures and the
  shared projection. Check the control in a browser.

## Affected Areas

- `apps/web/src/cp-workspace/folded/layerSpreadSettings.ts`
- `apps/web/src/components/paper/LayerRevealControl.tsx`
- Focused reveal, project persistence and geometry regression tests.

## Checklist

- [x] Trace the shared control, edit, projection and persistence paths.
- [x] Expand the range and keep circle geometry consistent.
- [x] Cover saved-view compatibility and expanded edits with regression tests.
- [x] Revalidate the requested 1.5× range with focused tests, lint, typecheck and the browser.
- [x] Prepare the draft PR handoff and leave the local app running for review.

Validation: full web lint passed, with targeted lint after the final test edits.
TypeScript passed after rebuilding the workspace libraries and all WASM bridges
(the primary checkout's copied artifacts were incomplete/stale). The affected
11-suite run passed all 694 tests after the requested 1.5× revision. Targeted lint,
TypeScript and the browser check also passed again. File tests cover unchanged old values and expanded
values in Fold defaults/steps, Diagram poses and native project folded figures.
Projection tests confirm 1.5 times the lateral displacement at the same height
on both sides of a fold.

In-app browser: created a two-layer valley fold, enabled Default at 7% height,
dragged reveal to 100%, reset to the original vector (33⅓% of the expanded
radius), then undid the reset in one step. Paper and thumbnail both updated.
Local screenshot: `artifacts/spread-inclination/reveal-max.png` (ignored).
Server: `http://localhost:5257/fold`, started with `scripts/dev-server.sh`.

Skipped: full web suite in favor of the affected 11 suites; production build,
Rust/oracle and Tauri checks because no bundling, solver, engine, upstream-format
or native-shell implementation changed. No translation strings changed.
