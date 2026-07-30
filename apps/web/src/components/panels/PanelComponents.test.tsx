import { describe, expect, it } from 'vitest';
import { panelComponents } from './PanelComponents';
import { PANEL_BOUNDARY_DISPLAY_PREFIX } from '../errors/withPanelErrorBoundary';

/**
 * The registry is the single place every dock panel passes through, which is
 * why the boundary is applied there. This test is what keeps that true: a panel
 * added to the map without going through `withPanelErrorBoundary` — or an
 * "optimization" that unwraps one — fails here rather than silently reinstating
 * the old behavior where one bad pane blanked the whole app.
 */
describe('panelComponents', () => {
  it('registers the panels the workspaces mount', () => {
    expect(Object.keys(panelComponents).sort()).toEqual([
      'bp-editor',
      'conditions',
      'cp-view-controls',
      'crease-pattern',
      'design',
      'diagnostics',
      'inspector',
      'lesson',
      'sequence',
      'simulator',
      'simulator-view-controls',
    ]);
  });

  it('wraps every panel in an error boundary', () => {
    for (const [id, Panel] of Object.entries(panelComponents)) {
      expect(Panel.displayName, `panel "${id}" is not wrapped in an error boundary`).toMatch(
        new RegExp(`^${PANEL_BOUNDARY_DISPLAY_PREFIX}\\(`)
      );
    }
  });
});
