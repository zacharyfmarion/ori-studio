export type WorkspaceId = 'design' | 'edit' | 'simulate';

export interface WorkspaceDefinition {
  id: WorkspaceId;
  label: string;
  tooltip: string;
  commandId: 'view.design' | 'view.edit' | 'view.simulate';
  primaryPanelId: 'design' | 'crease-pattern' | 'simulator';
}

export const WORKSPACE_DEFINITIONS: WorkspaceDefinition[] = [
  {
    id: 'edit',
    label: 'Edit',
    tooltip: 'Edit workspace',
    commandId: 'view.edit',
    primaryPanelId: 'crease-pattern',
  },
  {
    id: 'design',
    label: 'Design',
    tooltip: 'Design workspace',
    commandId: 'view.design',
    primaryPanelId: 'design',
  },
  {
    id: 'simulate',
    label: 'Simulate',
    tooltip: 'Simulate workspace',
    commandId: 'view.simulate',
    primaryPanelId: 'simulator',
  },
];

export const WORKSPACE_IDS = WORKSPACE_DEFINITIONS.map(
  (workspace) => workspace.id
) as WorkspaceId[];

const WORKSPACE_BY_PANEL_ID: Record<string, WorkspaceId> = {
  design: 'design',
  'bp-editor': 'design',
  'explori-tree': 'design',
  'explori-results': 'design',
  inspector: 'design',
  conditions: 'design',
  diagnostics: 'design',
  'crease-pattern': 'edit',
  'cp-view-controls': 'edit',
  'simulator-view-controls': 'simulate',
  simulator: 'simulate',
  sequence: 'simulate',
};

export function workspaceForPanelId(panelId: string): WorkspaceId | null {
  return WORKSPACE_BY_PANEL_ID[panelId] ?? null;
}

/**
 * The pane a workspace is "on" when nothing more specific is known.
 *
 * The answer for a workspace that has no dock to ask — a headless test, or the
 * moment during an open before Dockview has built the layout. Without it, code
 * that needs to name a pane at that moment has to guess, and a guess that
 * disagrees with the workspace is what left the Edit shortcuts dead after
 * opening a design bundled with a crease pattern.
 */
export function primaryPanelIdFor(workspace: WorkspaceId): string {
  const definition = WORKSPACE_DEFINITIONS.find((candidate) => candidate.id === workspace);
  // Unreachable for a real `WorkspaceId`; `design` is the app's own landing.
  return definition?.primaryPanelId ?? 'design';
}

export function workspaceForCommandId(commandId: string): WorkspaceId | null {
  switch (commandId) {
    case 'view.design':
      return 'design';
    case 'view.edit':
    case 'view.creasePattern':
      return 'edit';
    case 'view.simulate':
    case 'view.simulator':
      return 'simulate';
    case 'view.conditions':
      return 'design';
    default:
      return null;
  }
}
