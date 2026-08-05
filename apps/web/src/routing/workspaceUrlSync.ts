import { track } from '../analytics';
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
 * The last workspace(:variant) we emitted a `workspace viewed` for, so a
 * transition that doesn't change the semantic screen isn't double-counted.
 */
let lastWorkspaceViewed: string | null = null;

/**
 * Emit `workspace viewed` for the current screen — the useful analytics "screen"
 * signal on both the browser and memory routers. Suppressed on the welcome
 * screen; the Design variant (nux/treemaker/box-pleat) rides along, and a
 * variant switch that keeps the workspace is captured by `design method chosen`.
 */
function captureWorkspaceViewed(): void {
  const path = currentPath();
  if (path === null || path === WELCOME_PATH || path === '/') return;
  const workspace = useLayoutStore.getState().activeWorkspace;
  const variant =
    workspace === 'design' ? deriveDesignVariant(useWorkspaceStore.getState()) : undefined;
  const key = variant ? `${workspace}:${variant}` : workspace;
  if (key === lastWorkspaceViewed) return;
  lastWorkspaceViewed = key;
  track('workspace viewed', { workspace, variant });
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
  // The screen visible when the sync starts (initial load or a deep link).
  captureWorkspaceViewed();
  return useLayoutStore.subscribe((state, prev) => {
    if (state.activeWorkspace === prev.activeWorkspace) return;
    const path = currentPath();
    if (path === null || path === WELCOME_PATH || path === '/') return;
    const desired = targetPath();
    if (desired !== path) navigateTo(desired);
    captureWorkspaceViewed();
  });
}
