import type { DesignLayoutVariant } from '../store/layoutStore';
import type { WorkspaceId } from '../workspaces/workspaces';

/**
 * URL routes for the app. Each workspace has its own path; the Design workspace
 * additionally distinguishes its method (NUX chooser vs. TreeMaker vs. BP) as
 * sub-paths. `/welcome` is the start screen and the default landing route.
 */
export const WELCOME_PATH = '/welcome';
export const DESIGN_PATH = '/design';
export const DESIGN_TREEMAKER_PATH = '/design/treemaker';
export const DESIGN_BP_PATH = '/design/bp';
export const EDIT_PATH = '/edit';
export const SIMULATE_PATH = '/simulate';
/**
 * Share links land here, hand their payload to the store, and redirect to Edit.
 *
 * A route of its own rather than a fragment on `/edit`, for three reasons: the
 * route table documents that share links exist, the handling code mounts only
 * when one is opened, and the redirect strips the payload from the URL — so a
 * refresh cannot re-import it over work in progress, and no reload guard is
 * needed. The payload stays in the *fragment*, never the path, so it is never
 * sent to a server (RFC 3986 §3.5).
 */
export const SHARE_PATH = '/s';

/** Path for a Design workspace layout variant. */
export function designVariantPath(variant: DesignLayoutVariant): string {
  switch (variant) {
    case 'box-pleat':
      return DESIGN_BP_PATH;
    case 'treemaker':
      return DESIGN_TREEMAKER_PATH;
    case 'nux':
      return DESIGN_PATH;
  }
}

/**
 * Canonical path for a workspace. For Design, an optional variant selects the
 * sub-path; without one it lands on the method chooser (`/design`).
 */
export function workspacePath(workspace: WorkspaceId, variant?: DesignLayoutVariant): string {
  switch (workspace) {
    case 'design':
      return variant ? designVariantPath(variant) : DESIGN_PATH;
    case 'edit':
      return EDIT_PATH;
    case 'simulate':
      return SIMULATE_PATH;
  }
}

/**
 * Reverse of {@link workspacePath}: the workspace (and Design variant) a path
 * targets, or null for a non-workspace path (e.g. `/welcome`). Lets the shell
 * build the correct initial layout straight from the URL.
 */
export function parseWorkspacePath(
  pathname: string
): { workspace: WorkspaceId; variant?: DesignLayoutVariant } | null {
  switch (pathname) {
    case EDIT_PATH:
      return { workspace: 'edit' };
    case SIMULATE_PATH:
      return { workspace: 'simulate' };
    case DESIGN_PATH:
      return { workspace: 'design', variant: 'nux' };
    case DESIGN_TREEMAKER_PATH:
      return { workspace: 'design', variant: 'treemaker' };
    case DESIGN_BP_PATH:
      return { workspace: 'design', variant: 'box-pleat' };
    default:
      return null;
  }
}
