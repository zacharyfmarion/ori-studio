import { useEffect } from 'react';
import { useLayoutStore, type DesignLayoutVariant } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { enterCpDocumentSlot } from '../store/workspaceStore/cpDocumentSlots';
import type { CpDocumentSlotId } from '../store/workspaceStore/types';
import type { WorkspaceId } from '../workspaces/workspaces';

interface WorkspaceRouteProps {
  workspace: WorkspaceId;
  /** Design sub-route variant; omitted for non-Design workspaces. */
  variant?: DesignLayoutVariant;
  /**
   * Which crease-pattern document this route brings to the foreground. Routes
   * are the *only* place slots are asserted — see `cpDocumentSlots`. Omit to
   * keep whichever slot is current, which is what `/simulate` wants so a lesson
   * can simulate its own pattern.
   */
  slot?: CpDocumentSlotId;
}

/**
 * Invisible route element that reconciles store state to the URL (the URL→store
 * direction of workspace sync): make the active workspace — and, for Design, the
 * layout variant — match the route. The design variant is applied before
 * `activateWorkspace` so the layout is built once with the right variant;
 * `ensureDesignLayout` then rebuilds if only the variant changed. All three no-op
 * when already consistent.
 *
 * The document slot is asserted first, so the panels this route builds mount
 * against the right document instead of briefly reading the outgoing one.
 *
 * Deep links with no established project are turned away earlier, by the route
 * loader ({@link workspaceGuard}), so this element only mounts for real work.
 */
export function WorkspaceRoute({ workspace, variant, slot }: WorkspaceRouteProps) {
  useEffect(() => {
    if (slot) enterCpDocumentSlot(slot);
    const layout = useLayoutStore.getState();
    if (workspace === 'design' && variant) {
      useWorkspaceStore.getState().applyDesignRoute(variant);
    }
    layout.activateWorkspace(workspace);
    if (workspace === 'design') layout.ensureDesignLayout();
  }, [workspace, variant, slot]);

  return null;
}
