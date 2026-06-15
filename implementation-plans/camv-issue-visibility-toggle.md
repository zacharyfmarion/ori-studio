# CAMV Issue Visibility Toggle

## Goal

Add an easy crease-pattern viewport control for showing or hiding CAMV issue
markers on editable CP vertices without disabling the underlying diagnostics.

## Approach

- Treat CAMV issue visibility as CP viewport state, defaulting to visible.
- Add a compact toolbar toggle in the editable crease-pattern viewport.
- Filter CAMV diagnostics out of the canvas marker/HUD layer when hidden while
  preserving stored CAMV results for the Diagnostics panel.
- Add focused tests for the toggle and viewport state.

## Affected Areas

- `apps/web/src/lib/creasePatternViewport.ts`
- `apps/web/src/components/panels/CreasePatternPanel.tsx`
- `apps/web/src/components/panels/CreasePatternPanel.test.tsx`
- `apps/web/src/store/workspaceStore/store.test.ts`

## Checklist

- [x] Add CAMV visibility to CP viewport options.
- [x] Add the editable CP toolbar toggle.
- [x] Hide CAMV canvas markers and HUD when the toggle is off.
- [x] Add focused frontend tests.
- [x] Run focused web validation.
