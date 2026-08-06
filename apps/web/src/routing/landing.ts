import { useLayoutStore } from '../store/layoutStore';
import { workspacePath } from './paths';
import type { WorkspaceId } from '../workspaces/workspaces';

/**
 * The path for `workspace`.
 *
 * A thin pass-through now that Design has one route: it used to resolve Design to
 * a method sub-route, because bare `/design` *was* the method-chooser route and
 * landing there replaced a loaded design with the chooser. The chooser is a state
 * of a tab, not a route, so there is nothing left to disambiguate.
 *
 * Kept as the single place a workspace path is derived, because the callers still
 * matter: the workspace rail, the URL sync, and every path that opens a file used
 * to derive it three separate ways and disagree.
 */
export function pathForWorkspace(workspace: WorkspaceId): string {
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
