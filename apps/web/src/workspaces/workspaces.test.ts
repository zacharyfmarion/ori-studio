import { describe, expect, it } from 'vitest';
import { WORKSPACE_DEFINITIONS, workspaceForCommandId, workspaceForPanelId } from './workspaces';

describe('workspace definitions', () => {
  it('defines the three primary workspaces in rail order', () => {
    expect(WORKSPACE_DEFINITIONS.map((workspace) => workspace.id)).toEqual([
      'edit',
      'design',
      'simulate',
    ]);
    expect(WORKSPACE_DEFINITIONS.map((workspace) => workspace.label)).toEqual([
      'Edit',
      'Design',
      'Simulate',
    ]);
  });

  it('maps panels and compatibility commands to their owning workspaces', () => {
    expect(workspaceForPanelId('inspector')).toBe('design');
    expect(workspaceForPanelId('diagnostics')).toBe('design');
    expect(workspaceForPanelId('conditions')).toBe('design');
    expect(workspaceForPanelId('crease-pattern')).toBe('edit');
    expect(workspaceForPanelId('cp-view-controls')).toBe('edit');
    expect(workspaceForPanelId('simulator')).toBe('simulate');
    expect(workspaceForPanelId('sequence')).toBe('simulate');

    expect(workspaceForCommandId('view.creasePattern')).toBe('edit');
    expect(workspaceForCommandId('view.simulator')).toBe('simulate');
  });
});
