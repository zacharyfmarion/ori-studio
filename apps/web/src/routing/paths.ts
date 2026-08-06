import type { WorkspaceId } from '../workspaces/workspaces';

/**
 * URL routes for the app. One path per workspace; `/welcome` is the start screen
 * and the default landing route.
 *
 * Design used to have three (`/design`, `/design/treemaker`, `/design/bp`),
 * because the workspace showed exactly one design and the URL could therefore
 * name its method. With tabs it cannot: a Design workspace holding a
 * circle-packed design beside a box-pleat one has no single method to put in a
 * path. The old sub-paths redirect, so existing links and bookmarks still land.
 */
export const WELCOME_PATH = '/welcome';
export const DESIGN_PATH = '/design';
/** Retired Design sub-paths, kept so old links redirect rather than 404. */
export const LEGACY_DESIGN_PATHS = ['/design/treemaker', '/design/bp'] as const;
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

/** Canonical path for a workspace. */
export function workspacePath(workspace: WorkspaceId): string {
  switch (workspace) {
    case 'design':
      return DESIGN_PATH;
    case 'edit':
      return EDIT_PATH;
    case 'simulate':
      return SIMULATE_PATH;
  }
}

/**
 * Reverse of {@link workspacePath}: the workspace a path targets, or null for a
 * non-workspace path (e.g. `/welcome`). Lets the shell build the initial layout
 * straight from the URL.
 *
 * The retired Design sub-paths resolve here too, so the shell mounts the right
 * workspace on the render before the redirect lands.
 */
export function parseWorkspacePath(pathname: string): { workspace: WorkspaceId } | null {
  switch (pathname) {
    case EDIT_PATH:
      return { workspace: 'edit' };
    case SIMULATE_PATH:
      return { workspace: 'simulate' };
    case DESIGN_PATH:
      return { workspace: 'design' };
    default:
      return LEGACY_DESIGN_PATHS.some((path) => path === pathname)
        ? { workspace: 'design' }
        : null;
  }
}
