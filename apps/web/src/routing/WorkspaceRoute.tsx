import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useLayoutStore, type DesignLayoutVariant } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { designLayoutVariant } from '../store/workspaceStore/designVariant';
import type { WorkspaceId } from '../workspaces/workspaces';
import { designVariantPath } from './paths';

interface WorkspaceRouteProps {
  workspace: WorkspaceId;
  /** Design sub-route variant; omitted for non-Design workspaces. */
  variant?: DesignLayoutVariant;
}

/**
 * Invisible route element that reconciles store state to the URL (the URL→store
 * direction of workspace sync): make the active workspace — and, for Design, the
 * method — match the route. The method is applied before `activateWorkspace` so
 * the layout is built once with the right variant; `ensureDesignLayout` then
 * rebuilds if only the method changed. All three no-op when already consistent.
 *
 * Deep links with no established project are turned away earlier, by the route
 * loader, so this element only mounts for real work.
 */
export function WorkspaceRoute({ workspace, variant }: WorkspaceRouteProps) {
  const designMethod = useWorkspaceStore((state) => state.designMethod);
  // Bare `/design` is where the method chooser lives, so it is the one Design
  // route that cannot set a method. Rather than clear one — which is how landing
  // there used to replace a design that had just loaded with the chooser — it
  // sends an established design on to its own sub-route. Only `startNewDesign`
  // clears the method, and it navigates here deliberately.
  const redirectTo =
    workspace === 'design' && variant === 'nux' && designMethod !== 'none'
      ? designVariantPath(designLayoutVariant(designMethod))
      : null;

  useEffect(() => {
    if (redirectTo) return;
    const layout = useLayoutStore.getState();
    if (workspace === 'design' && variant) {
      useWorkspaceStore.getState().applyDesignRoute(variant);
    }
    layout.activateWorkspace(workspace);
    if (workspace === 'design') layout.ensureDesignLayout();
  }, [workspace, variant, redirectTo]);

  return redirectTo ? <Navigate to={redirectTo} replace /> : null;
}
