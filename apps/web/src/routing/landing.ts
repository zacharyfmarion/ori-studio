import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { designLayoutVariant } from '../store/workspaceStore/designVariant';
import { workspacePath } from './paths';
import type { WorkspaceId } from '../workspaces/workspaces';

/**
 * The path for `workspace` as the store currently stands. Design resolves to its
 * method sub-route, because bare `/design` is the method-chooser route — routing
 * there replaces a loaded design with the chooser.
 *
 * The only place a workspace path is derived from state. Everything that needs
 * one goes through here or through {@link currentWorkspacePath}: the workspace
 * rail, the URL sync, and every path that opens a file. They used to derive it
 * three separate ways, and the copy that opening used disagreed with the other
 * two — it asked which documents existed rather than which workspace was showing,
 * so any project with no crease pattern landed on the chooser.
 */
export function pathForWorkspace(workspace: WorkspaceId): string {
  if (workspace === 'design') {
    return workspacePath('design', designLayoutVariant(useWorkspaceStore.getState().designMethod));
  }
  return workspacePath(workspace);
}

/**
 * The path matching the workspace the app is currently showing.
 *
 * This is how a caller follows a decision the store already made rather than
 * making a second one. Opening a project is the case that matters: the loader
 * installs the documents and `applyLandingWorkspace` picks the workspace, so the
 * start screen, the drop handler, and the desktop open-with handler only have to
 * name where that landed.
 */
export function currentWorkspacePath(): string {
  return pathForWorkspace(useLayoutStore.getState().activeWorkspace);
}
