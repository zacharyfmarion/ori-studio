import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { deriveDesignVariant } from '../store/workspaceStore/designVariant';
import { currentPath, navigateTo } from './appRouter';
import { WELCOME_PATH, workspacePath } from './paths';

/**
 * The path that matches the current store state: the active workspace, plus the
 * Design layout variant when in Design.
 */
function targetPath(): string {
  const workspace = useLayoutStore.getState().activeWorkspace;
  if (workspace === 'design') {
    return workspacePath('design', deriveDesignVariant(useWorkspaceStore.getState()));
  }
  return workspacePath(workspace);
}

/**
 * Keep the URL in sync with `activeWorkspace` (the store→URL direction).
 *
 * The codebase switches workspaces imperatively from many call sites
 * (`activateWorkspace(...)` in slices, panels, and hooks). Rather than rewrite
 * each one to navigate, this subscription observes the resulting
 * `activeWorkspace` change and points the URL at the matching path. It fires only
 * on the workspace transition (not on every design-field change) so a multi-step
 * document creation can't misfire mid-flight; the variant is read fresh at that
 * moment. Design variant switches that don't change the workspace (the method
 * chooser) navigate explicitly.
 *
 * The URL→store direction lives in {@link WorkspaceRoute}; both are guarded so
 * they settle without looping: navigate only fires when the derived path differs
 * from the current one, and `activateWorkspace` no-ops when already active. While
 * on `/welcome` the sync is suppressed — leaving the start screen is an explicit
 * UI navigation.
 */
export function startWorkspaceUrlSync(): () => void {
  return useLayoutStore.subscribe((state, prev) => {
    if (state.activeWorkspace === prev.activeWorkspace) return;
    const path = currentPath();
    if (path === null || path === WELCOME_PATH || path === '/') return;
    const desired = targetPath();
    if (desired !== path) navigateTo(desired);
  });
}
