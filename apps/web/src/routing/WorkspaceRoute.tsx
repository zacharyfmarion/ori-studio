import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLayoutStore, type DesignLayoutVariant } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { WorkspaceId } from '../workspaces/workspaces';
import { WELCOME_PATH } from './paths';

interface WorkspaceRouteProps {
  workspace: WorkspaceId;
  /** Design sub-route variant; omitted for non-Design workspaces. */
  variant?: DesignLayoutVariant;
}

/**
 * Invisible route element that reconciles store state to the URL (the URL→store
 * direction of workspace sync) and sends deep links with no project back to the
 * start screen.
 *
 * Reconcile: make the active workspace — and, for Design, the layout variant —
 * match the route. The design variant is applied before `activateWorkspace` so
 * the layout is built once with the right variant; `ensureDesignLayout` then
 * rebuilds if only the variant changed. All three no-op when already consistent.
 *
 * Guard: a workspace route with no established project (a cold reload / deep
 * link) redirects to `/welcome` rather than showing an empty editor. The Design
 * method chooser (`/design`, variant `nux`) is exempt — it is the pre-project
 * entry point.
 */
export function WorkspaceRoute({ workspace, variant }: WorkspaceRouteProps) {
  const projectEstablished = useWorkspaceStore((state) => state.projectEstablished);
  const navigate = useNavigate();

  useEffect(() => {
    const layout = useLayoutStore.getState();
    if (workspace === 'design' && variant) {
      useWorkspaceStore.getState().applyDesignRoute(variant);
    }
    layout.activateWorkspace(workspace);
    if (workspace === 'design') layout.ensureDesignLayout();
  }, [workspace, variant]);

  useEffect(() => {
    const isChooser = workspace === 'design' && variant === 'nux';
    if (!isChooser && !projectEstablished) {
      navigate(WELCOME_PATH, { replace: true });
    }
  }, [workspace, variant, projectEstablished, navigate]);

  return null;
}
