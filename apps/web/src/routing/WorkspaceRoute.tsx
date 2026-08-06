import { useEffect } from 'react';
import { useWorkspaceViewedEvent } from '../analytics';
import { useLayoutStore } from '../store/layoutStore';
import type { WorkspaceId } from '../workspaces/workspaces';

interface WorkspaceRouteProps {
  workspace: WorkspaceId;
}

/**
 * Invisible route element that reconciles store state to the URL (the URL→store
 * direction of workspace sync): make the active workspace match the route.
 * No-ops when already consistent.
 *
 * Design used to carry a method sub-route, which this element applied and then
 * asked the layout store to rebuild around. Both are gone: a design's method
 * belongs to its tab, several tabs can disagree about it, and the workspace holds
 * one panel whose contents the tab owns.
 *
 * Deep links with no established project are turned away earlier, by the route
 * loader, so this element only mounts for real work.
 */
export function WorkspaceRoute({ workspace }: WorkspaceRouteProps) {
  useEffect(() => {
    useLayoutStore.getState().activateWorkspace(workspace);
  }, [workspace]);

  // This route element *is* the view for each workspace, so the "viewed" event
  // belongs here rather than in the URL-sync subscription.
  useWorkspaceViewedEvent(workspace);

  return null;
}
