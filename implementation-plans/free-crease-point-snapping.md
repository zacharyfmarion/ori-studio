# Optional point snapping for Free crease

## Goal

Allow a free fold line to combine an exact reference endpoint with an arbitrary
endpoint. Offer a switch in the right-hand tool options.

## Approach

- Reuse the current pane's point-target index and normal point snap radius.
- Snap eligible free-line endpoints when enabled; fall back to the exact click
  when no target is near. Option/Alt temporarily bypasses snapping.
- Keep the setting on by default and retain it between folds/tool changes.
  Changing it affects future picks, not endpoints already placed.
- Keep free-line picks and saved operations in their existing format. Region
  picks for squash, petal and rabbit ear must remain unsnapped.
- Use the shared field-row switch, shared tool state and central analytics.

## Affected Areas

Fold input registry and picking, tool state/window descriptors, right-hand tool
options, localized strings and targeted canvas/UI tests.

## Checklist

- [x] Add endpoint snapping with raw-click fallback on both panes.
- [x] Wire the persistent-in-session toggle and Option/Alt bypass.
- [x] Verify point targets, mixed endpoints, region picks and saved replay.
- [x] Run web checks and verify the control in the browser.

## Verification

- The shared point index supplies exactly the same targets as point-reference
  tools, including marks and midpoints. Both panes, buried CP references,
  off-paper folded-pane endpoints and spread-layer coordinates are covered.
- A real-WASM canvas flow clicks near a midpoint for the first endpoint and
  empty paper for the second. It checks the resulting line passes through
  both exact positions, commits it, and verifies identical fresh replay.
- The right-panel switch was checked in the running browser, on and off.
  It changes future picks only and stays chosen across folds and tool changes.
- 148 focused test files / 1,101 tests pass. Web lint passes with the existing
  StepFilmstrip compiler warning; translation validation passes for all locales.
- TypeScript and `git diff --check` pass. Browser proof is saved under the
  ignored `artifacts/free-crease-snapping/options.png`. Component tests use
  `NODE_OPTIONS=--no-experimental-webstorage` so Node 26's unconfigured native
  localStorage does not mask the browser test environment's localStorage.
- No engine changes or file migration. Native tests, WASM rebuild and production
  bundling are unnecessary for this input/UI change. Existing server: 5328.
