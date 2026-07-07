# CP Tool Options Pane

## Goal

Move the crease-pattern active tool helper/options UI out of the floating
bottom-right canvas overlay and into the docked CP view options pane, using the
bottom of that pane for contextual tool controls that grow to fit the active
tool's settings.

## Approach

- Keep the existing registry-backed `CpContextToolPanel` controls and state
  semantics.
- Keep the active CP tool state owned by the crease-pattern canvas and portal
  the existing context panel into a docked slot in the view options pane.
- Render view controls and tool options as stacked sections in the
  `cp-view-controls` pane, with the tool-options section taking natural height
  and scrolling only when the pane is too small.
- Update focused component tests for placement, visibility, and editable
  settings behavior.

## Affected Areas

- `apps/web/src/components/panels/CreasePatternPanel.tsx`
- `apps/web/src/components/panels/CpViewControlsPanel.tsx`
- `apps/web/src/components/panels/cpToolOptionsPortal.ts`
- `apps/web/src/components/panels/*test.tsx`
- `apps/web/src/styles/theme.css`

## Checklist

- [x] Add implementation plan.
- [x] Expose a docked target for contextual CP tool options in the view controls pane.
- [x] Move `CpContextToolPanel` rendering out of the CP viewport overlay.
- [x] Update styles so options occupy the bottom of the view controls pane and fit active tools.
- [x] Update focused web tests.
- [x] Run focused validation.
