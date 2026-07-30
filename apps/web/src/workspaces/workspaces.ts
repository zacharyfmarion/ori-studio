export type WorkspaceId = 'design' | 'edit' | 'simulate' | 'learn';

export interface WorkspaceDefinition {
  id: WorkspaceId;
  label: string;
  tooltip: string;
  commandId: 'view.design' | 'view.edit' | 'view.simulate' | 'view.learn';
  primaryPanelId: 'design' | 'crease-pattern' | 'simulator' | 'lesson';
  /**
   * Omitted from the workspace switcher. The tutorial is entered from Help or
   * the start screen, not by flipping workspaces mid-task.
   */
  hiddenFromSwitcher?: boolean;
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
  {
    id: 'learn',
    label: 'Learn',
    tooltip: 'Tutorial',
    commandId: 'view.learn',
    primaryPanelId: 'lesson',
    hiddenFromSwitcher: true,
  },
];

export const WORKSPACE_IDS = WORKSPACE_DEFINITIONS.map(
  (workspace) => workspace.id
) as WorkspaceId[];

/**
 * The workspaces the left rail offers, in rail order. The tutorial is reached
 * from Help or the start screen instead — it is a mode you enter deliberately,
 * not one of the three surfaces you flip between while working.
 */
export const SWITCHER_WORKSPACE_DEFINITIONS = WORKSPACE_DEFINITIONS.filter(
  (workspace) => !workspace.hiddenFromSwitcher
);

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
  lesson: 'learn',
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
    case 'view.learn':
      return 'learn';
    default:
      return null;
  }
}
