import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceCapabilities } from '../store/workspaceStore/useWorkspaceCapabilities';
import type { WorkspaceCapability } from '../lib/workspaceCapabilities';
import type { WorkspaceId } from '../workspaces/workspaces';

/**
 * Workspaces whose canvas gets undo/redo pills.
 *
 * Edit only, for now. Simulate does show Undo and Redo in its Edit menu
 * (`SIMULATE_VISIBLE_EDIT`), but they act on the crease pattern you are not
 * looking at, so a pill over the 3D view would be an invitation to edit
 * something off-screen. Design has its own history per kind and will get pills
 * when its panes go one-at-a-time; adding them here first would put two new
 * controls over the design canvas at once.
 */
const HISTORY_PILL_WORKSPACES: readonly WorkspaceId[] = ['edit'];

export interface CanvasHistoryPillsState {
  /** Null where the pills should not exist at all. */
  actions: { undo: WorkspaceCapability; redo: WorkspaceCapability } | null;
}

/**
 * Whether the canvas lane offers undo/redo, and whether each side is live.
 *
 * The enabled state comes from the capability layer rather than from a history
 * stack read directly, because "which stack" is a question about the active
 * editing context: the CP editor answers for itself and every design kind
 * answers through its descriptor (`historyCountForContext`). A pill wired
 * straight to `oristudioCpHistoryPast` would be greyed out over a design canvas
 * with fifty edits behind it.
 */
export function useCanvasHistoryPills(): CanvasHistoryPillsState {
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);
  const capabilities = useWorkspaceCapabilities();

  if (!HISTORY_PILL_WORKSPACES.includes(activeWorkspace)) return { actions: null };
  return { actions: { undo: capabilities['edit.undo'], redo: capabilities['edit.redo'] } };
}
