# CAMV Rendering And Edit Polish

## Goal

Make CAMV diagnostic markers match Oriedita's advanced violation shapes and
colors, fix diagnostic navigation so selected issues fit into view, and polish
the edit workspace rail and bottom toolbar spacing.

## Approach

- Expose Oriedita flat-foldability violation rule/color metadata through the
  structured CP diagnostic result contract.
- Render CAMV point diagnostics with Oriedita's triangle, square, circle, ring,
  and LBL sector markers while keeping existing generic check markers intact.
- Fit the CP viewport to the selected diagnostic geometry instead of zooming to
  a single point.
- Remove horizontal overflow from the left edit tool rail with responsive,
  contained grid sizing.
- Add modest horizontal breathing room to the bottom viewport toolbar buttons.
- Tune CAMV marker opacity and keep folded-figure toolbar controls aligned with
  the M/V/B/U line-type spacing.
- Cover the behavior with focused Rust and web tests, then run the smallest
  validation set for the touched surfaces.

## Affected Areas

- `crates/oristudio-cp/src/lib.rs`
- `apps/web/src/engine/oristudioCpTypes.ts`
- `apps/web/src/components/panels/CreasePatternPanel.tsx`
- `apps/web/src/styles/theme.css`
- `apps/web/src/components/panels/CreasePatternPanel.test.tsx`
- `crates/oristudio-cp/src/lib.rs` tests

## Checklist

- [x] Expose Oriedita violation color on structured flat-foldability diagnostics.
- [x] Render CAMV diagnostics with Oriedita-style marker shapes and colors.
- [x] Fit selected diagnostics into the CP viewport.
- [x] Fix horizontal overflow in the left edit tool rail.
- [x] Add horizontal breathing room to bottom toolbar icon buttons.
- [x] Match CAMV marker opacity more closely to Oriedita.
- [x] Tighten folded-figure action spacing to match M/V/B/U controls.
- [x] Add focused regression coverage.
- [x] Run targeted validation and prepare the draft PR.
