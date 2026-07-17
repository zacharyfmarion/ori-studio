import { useEffect } from 'react';
import { useLayoutStore } from '../store/layoutStore';
import type { WorkspaceId } from '../workspaces/workspaces';

interface WorkspaceRouteProps {
  workspace: WorkspaceId;
}

/**
 * Invisible route element that reconciles store state to the URL (the URL→store
 * direction of workspace sync). Rendered into {@link WorkspaceShell}'s outlet for
 * each workspace path; on mount it makes {@link useLayoutStore.activateWorkspace}
 * match the route. `activateWorkspace` no-ops when already active, so re-renders
 * and Strict-Mode double-invokes never thrash the Dockview layout.
 */
export function WorkspaceRoute({ workspace }: WorkspaceRouteProps) {
  useEffect(() => {
    useLayoutStore.getState().activateWorkspace(workspace);
  }, [workspace]);

  return null;
}
