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
export const LEARN_PATH = '/learn';

/**
 * True for `/learn/:courseId/:lessonId` — a lesson, as opposed to the catalog
 * (`/learn`) or a course page (`/learn/:courseId`). Segment count is the whole
 * test; whether the ids resolve is the router's business, not this module's.
 */
export function isLessonPath(pathname: string): boolean {
  if (!pathname.startsWith(`${LEARN_PATH}/`)) return false;
  return pathname.slice(LEARN_PATH.length + 1).replace(/\/+$/u, '').split('/').length === 2;
}

/** Route for a course's own page: its chapters and lessons. */
export function coursePath(courseId: string): string {
  return `${LEARN_PATH}/${courseId}`;
}

/** Route for a single lesson, within its course. */
export function lessonPath(courseId: string, lessonId: string): string {
  return `${LEARN_PATH}/${courseId}/${lessonId}`;
}

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
    case 'learn':
      return LEARN_PATH;
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
    case LEARN_PATH:
      return { workspace: 'learn' };
    case DESIGN_PATH:
      return { workspace: 'design', variant: 'nux' };
    case DESIGN_TREEMAKER_PATH:
      return { workspace: 'design', variant: 'treemaker' };
    case DESIGN_BP_PATH:
      return { workspace: 'design', variant: 'box-pleat' };
    default:
      // Only a lesson (`/learn/:courseId/:lessonId`) builds the learn layout.
      // The catalog and a course page render full width with no canvas, so they
      // must not provision a practice document nobody is about to draw on.
      return isLessonPath(pathname) ? { workspace: 'learn' } : null;
  }
}
