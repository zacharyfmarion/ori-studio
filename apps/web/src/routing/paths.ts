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
