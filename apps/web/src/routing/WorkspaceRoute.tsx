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
 * True while an auto-provision is in flight. Provisioning is async, so the
 * document isn't present yet on a synchronous re-invocation (React Strict Mode's
 * double-effect, or a rapid remount); this guard stops a second blank document
 * from being created. Only one WorkspaceRoute is mounted at a time, so a single
 * module-level flag is sufficient.
 */
let provisioning = false;

/**
 * Invisible route element that reconciles store state to the URL (the URL→store
 * direction of workspace sync) and auto-provisions a document when a workspace is
 * deep-linked empty.
 *
 * Reconcile: make the active workspace — and, for Design, the layout variant —
 * match the route. The design variant is applied before `activateWorkspace` so
 * the layout is built once with the right variant; `ensureDesignLayout` then
 * rebuilds if only the variant changed. All three no-op when already consistent.
 *
 * Provision: once the engine is ready, create the document the route needs if it
 * is absent (blank CP for Edit; a design for the TreeMaker/BP sub-routes). The
 * checks are presence-guarded so an existing document is never clobbered.
 * `/simulate` has nothing to fabricate from empty, so it redirects to `/welcome`
 * when there is no crease pattern to fold.
 */
export function WorkspaceRoute({ workspace, variant }: WorkspaceRouteProps) {
  const engineReady = useWorkspaceStore((state) => state.engineReady);
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
    // Provisioning needs the wasm engine; wait for it (the shell shows a loading
    // overlay meanwhile) and re-run once it is ready.
    if (!engineReady || provisioning) return;
    const store = useWorkspaceStore.getState();

    const provision = (create: () => Promise<void>) => {
      provisioning = true;
      void create().finally(() => {
        provisioning = false;
      });
    };

    if (workspace === 'edit') {
      if (store.oristudioCpDocument === null && store.importedCreasePattern === null) {
        provision(() => store.createNewCreasePattern());
      }
      return;
    }

    if (workspace === 'simulate') {
      const hasCreasePattern =
        store.oristudioCpDocument !== null || store.importedCreasePattern !== null;
      if (!hasCreasePattern) navigate(WELCOME_PATH, { replace: true });
      return;
    }

    // Design: the chooser (`nux`) is itself the empty state; the concrete
    // variants provision a fresh design only when none of that kind exists.
    if (variant === 'treemaker' && store.project.nodes.length === 0) {
      provision(() => store.chooseDesignMethod('treemaker'));
    } else if (variant === 'box-pleat' && store.oristudioBpDocument === null) {
      provision(() => store.chooseDesignMethod('box-pleat'));
    }
  }, [workspace, variant, engineReady, navigate]);

  return null;
}
