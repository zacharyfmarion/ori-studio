# Preserve fold direction when choosing a landing

## Goal

A Mountain/Valley tool must not offer the opposite fold direction as a layer-order
choice. The reported corner fold on a precreased sheet has one valid Valley
result, even though its opposite Mountain result is also a flat endpoint.

## Approach

The copied external example reproduces two exact choices. The inserted choice
has the same moving faces and geometry but reverses both newly folded crease
letters. Legacy Tuck names a target-relative placement, not a guarantee about
the fold direction at the flap's attachment. Taking its full union introduced
this opposite-direction result into the M/V chooser.

Admit insertion candidates only when each folded attachment between moving and
stationary material agrees with the selected direction in the parent view.
Determine moving pieces from the change in their face orientation, including
split faces and precreases. Do not constrain the flap against unrelated layers:
real insertion choices and target-dependent closure must remain available.

Apply this admission check to authoring search, leaving stored landing recipes
and their completion witnesses unchanged. This preserves deterministic replay
of existing files and avoids making a witness incomplete by adding search-only
solver seeds. Do not modify the Flat-Folder solver or geometry guards.

The external file, snapshot, and reproduction evidence remain in ignored
`artifacts/heart-layer-order/`. Regression tests construct synthetic paper.

## Affected Areas

- `crates/oristudio-fold/src/fold/placements.rs`: direction admission.
- Fold engine placement integration tests: grid, views, seeds, genuine insertion.
- Fold bridge and web WASM tests: unique count reaches the chooser correctly.

## Checklist

- [x] Copy the external file before debugging; preserve original.
- [x] Replay the reported fold and identify the opposite-direction candidate.
- [x] Add failing synthetic regression coverage.
- [x] Filter direction-incompatible insertion results without changing replay.
- [x] Verify real insertion choices, view transforms, precreases, and closure.
- [x] Rebuild WASM and replay the copied example; verify the UI flow.

## Validation

- The regression failed before the fix (two results instead of one).
- The copied native file now returns exactly one result in the initial WASM
  search batch; the resulting saved operation is unchanged.
- All 468 Fold engine/bridge tests passed. The new matrix covers both directions,
  front/back starts, turned/rotated views, all/flap/depth seeds, and newly scored
  versus precreased attachments. A separate exhaustive test retains all legacy
  insertion endpoints whose hinge letters agree with the requested direction.
- All 10 focused web tests passed, including two new real-WASM canvas flows
  that click corner/center, receive no chooser, and commit normally, plus the
  existing multi-target Heart insertion and order-resolution tests.
- Fold WASM build, TypeScript, changed-test ESLint, formatting and targeted
  clippy passed. Clippy emits the existing configured unknown-lint warning.
- The app runs from this checkout on port 5328. Browser file-picker automation
  did not expose a usable chooser, so the copied file was verified through the
  production replay/engine APIs; the full tool interaction was verified through
  the real-WASM canvas-flow tests rather than a manual browser import.
- No upstream solver changes, file migrations, commits, pushes, or PRs. Saved
  landing replay is unchanged. The full unrelated workspace was not retested.

The current desktop worktree started without Fold. Its baseline was copied from
`codex/fold-origami-trials`, including that worktree's pending changes, without
modifying the source worktree. Task-specific code changes are limited to
`fold/placements.rs`, `tests/fold_placements.rs`, and the new web regression;
this plan is the only added task documentation. The baseline patch and status
are recorded in the ignored diagnostic directory.
