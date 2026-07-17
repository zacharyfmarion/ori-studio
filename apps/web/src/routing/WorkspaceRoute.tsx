import { useEffect } from 'react';
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
 * direction of workspace sync). Rendered into {@link WorkspaceShell}'s outlet for
 * each workspace path. On mount it makes the active workspace — and, for Design,
 * the layout variant — match the route.
 *
 * The design variant is applied before `activateWorkspace` so the layout is
 * built once with the right variant; `ensureDesignLayout` then rebuilds if only
 * the variant changed (a within-Design switch, where `activateWorkspace` no-ops).
 * All three no-op when already consistent, so re-renders and Strict-Mode
 * double-invokes never thrash Dockview.
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

  return null;
}
