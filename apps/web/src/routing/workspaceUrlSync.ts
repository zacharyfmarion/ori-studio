import { useLayoutStore } from '../store/layoutStore';
import { currentPath, navigateTo } from './appRouter';
import { WELCOME_PATH, workspacePath } from './paths';

/**
 * Keep the URL in sync with `activeWorkspace` (the store→URL direction).
 *
 * The codebase switches workspaces imperatively from many call sites
 * (`activateWorkspace(...)` in slices, panels, and hooks). Rather than rewrite
 * each one to navigate, this subscription observes the resulting
 * `activeWorkspace` change and points the URL at the matching path. The URL→store
 * direction lives in {@link WorkspaceRoute}; both are guarded so they settle in
 * one round without looping:
 *
 * - navigate only fires when the derived path differs from the current one, and
 * - `activateWorkspace` no-ops when the workspace is already active.
 *
 * While on `/welcome` the sync is suppressed: leaving the start screen is an
 * explicit UI navigation, and the default `activeWorkspace` must not drag the
 * user off it.
 */
export function startWorkspaceUrlSync(): () => void {
  return useLayoutStore.subscribe((state, prev) => {
    if (state.activeWorkspace === prev.activeWorkspace) return;
    const path = currentPath();
    if (path === null || path === WELCOME_PATH || path === '/') return;
    const desired = workspacePath(state.activeWorkspace);
    if (desired !== path) navigateTo(desired);
  });
}
