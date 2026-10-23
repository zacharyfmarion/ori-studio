import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_DEFINITIONS,
  workspaceForCommandId,
  workspaceForPanelId,
} from './workspaces';

describe('workspace definitions', () => {
  it('defines the six primary workspaces in rail order', () => {
    expect(WORKSPACE_DEFINITIONS.map((workspace) => workspace.id)).toEqual([
      'edit',
      'design',
      'simulate',
      'references',
      'fold',
      'diagram',
    ]);
    expect(WORKSPACE_DEFINITIONS.map((workspace) => workspace.label)).toEqual([
      'Edit',
      'Design',
      'Simulate',
      'References',
      'Fold',
      'Diagram',
    ]);
  });

  it('names each workspace its own command and primary pane', () => {
    for (const workspace of WORKSPACE_DEFINITIONS) {
      expect(workspaceForCommandId(workspace.commandId), workspace.id).toBe(workspace.id);
      expect(workspaceForPanelId(workspace.primaryPanelId), workspace.id).toBe(workspace.id);
    }
  });

  it('maps panels and compatibility commands to their owning workspaces', () => {
    expect(workspaceForPanelId('inspector')).toBe('design');
    expect(workspaceForPanelId('diagnostics')).toBe('design');
    expect(workspaceForPanelId('conditions')).toBe('design');
    expect(workspaceForPanelId('crease-pattern')).toBe('edit');
    expect(workspaceForPanelId('cp-view-controls')).toBe('edit');
    expect(workspaceForPanelId('cp-properties')).toBe('edit');
    expect(workspaceForPanelId('simulator')).toBe('simulate');
    expect(workspaceForPanelId('references')).toBe('references');
    expect(workspaceForPanelId('references-view-controls')).toBe('references');
    expect(workspaceForPanelId('diagram')).toBe('diagram');
    expect(workspaceForPanelId('diagram-step')).toBe('diagram');
    expect(workspaceForPanelId('fold')).toBe('fold');
    expect(workspaceForPanelId('fold-step')).toBe('fold');
    expect(workspaceForPanelId('fold-paper')).toBe('fold');

    expect(workspaceForCommandId('view.creasePattern')).toBe('edit');
    expect(workspaceForCommandId('view.simulator')).toBe('simulate');
    expect(workspaceForCommandId('view.references')).toBe('references');
    expect(workspaceForCommandId('view.diagram')).toBe('diagram');
    expect(workspaceForCommandId('view.fold')).toBe('fold');
  });
});
