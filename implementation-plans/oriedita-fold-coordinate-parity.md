# Oriedita FOLD Coordinate Parity

## Goal

Make exported FOLD crease patterns appear with the same vertical orientation in
Oriedita and Ori Studio, using Oriedita's coordinate convention as the standard.

## Approach

- Confirm Oriedita imports FOLD coordinates into its object space with y
  increasing downward on screen.
- Convert TreeMaker-generated paper coordinates from y-up to Oriedita y-down
  when building FOLD documents.
- Render editable Oriedita CP documents in the shared web viewport with the
  same y-down convention.
- Keep TreeMaker design/paper rendering unchanged.
- Add focused regression tests for exported FOLD coordinates and CP viewport
  mapping.

## Affected Areas

- `crates/treemaker-core`
- `apps/web/src/lib/creasePatternViewport.ts`
- `apps/web/src/lib/creasePatternViewport.test.ts`

## Checklist

- [x] Trace FOLD import/export and Oriedita viewport conventions.
- [x] Flip generated TreeMaker FOLD coordinates for Oriedita.
- [x] Render editable CP coordinates with Oriedita y-down orientation.
- [x] Add regression coverage.
- [x] Run targeted validation.
