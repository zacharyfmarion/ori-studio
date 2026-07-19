import { useWorkspaceStore } from '../store/workspaceStore';
import { DESIGN_PATH, EDIT_PATH } from './paths';

/**
 * Where to land after opening a project: the Edit workspace when it produced a
 * crease pattern, otherwise the Design workspace (method chooser).
 */
export function openedProjectPath(): string {
  const state = useWorkspaceStore.getState();
  return state.oristudioCpDocument !== null || state.importedCreasePattern !== null
    ? EDIT_PATH
    : DESIGN_PATH;
}
