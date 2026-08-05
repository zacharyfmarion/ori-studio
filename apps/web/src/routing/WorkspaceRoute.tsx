import { useEffect } from 'react';
import { useWorkspaceViewedEvent } from '../analytics';
import { useLayoutStore, type DesignLayoutVariant } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceId } from '../workspaces/workspaces';

interface WorkspaceRouteProps {
  workspace: WorkspaceId;
  /** Design sub-route variant; omitted for non-Design workspaces. */
  variant?: DesignLayoutVariant;
}

/**
 * Invisible route element that reconciles store state to the URL (the URL→store
 * direction of workspace sync): make the active workspace — and, for Design, the
 * layout variant — match the route. The design variant is applied before
 * `activateWorkspace` so the layout is built once with the right variant;
 * `ensureDesignLayout` then rebuilds if only the variant changed. All three no-op
 * when already consistent.
 *
 * Deep links with no established project are turned away earlier, by the route
 * loader ({@link workspaceGuard}), so this element only mounts for real work.
 */
export function WorkspaceRoute({ workspace, variant }: WorkspaceRouteProps) {
  useEffect(() => {
    const layout = useLayoutStore.getState();
    if (workspace === 'design' && variant) {
      useWorkspaceStore.getState().applyDesignRoute(variant);
    }
    layout.activateWorkspace(workspace);
    if (workspace === 'design') layout.ensureDesignLayout();
  }, [workspace, variant]);

  // This route element *is* the view for each workspace, so the "viewed" event
  // belongs here rather than in the URL-sync subscription. Only Design carries a
  // variant.
  useWorkspaceViewedEvent(workspace, workspace === 'design' ? variant : undefined);

  return null;
}
