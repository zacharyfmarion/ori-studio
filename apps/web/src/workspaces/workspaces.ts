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
