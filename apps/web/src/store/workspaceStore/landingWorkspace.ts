import type { WorkspaceId } from '../../workspaces/workspaces';
import type { WorkspaceState } from './types';

/**
 * Which workspace to land in after opening a file: Edit when the file produced a
 * crease pattern, otherwise Design. Single source of truth for every open path —
 * File › Open, the start screen, the desktop open-with handler, and a drop — so
 * they cannot disagree about where a given file opens.
 *
 * Deliberately derived from the documents the open produced rather than from a
 * field in the file. A `.osf` records `activeMode`, but that field marks which
 * document the single-document loader treats as primary (a design always wins,
 * or reloading would drop it), not which view the user was working in — so a
 * bundle holding a design plus an Edit crease pattern always claimed its design
 * and always opened on Design.
 *
 * Each format's loader still activates a workspace of its own as it installs
 * state, so `openProject` applies this rule afterwards; otherwise the landing is
 * whichever loader happened to run last.
 */
export function landingWorkspace(
  state: Pick<WorkspaceState, 'oristudioCpDocument' | 'importedCreasePattern'>,
): WorkspaceId {
  return state.oristudioCpDocument !== null || state.importedCreasePattern !== null
    ? 'edit'
    : 'design';
}
