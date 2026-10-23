import { CREASE_PATTERN_DOCUMENT_ID } from '../../lib/nativeProjectDesigns';
import type { WorkspaceId } from '../../workspaces/workspaces';
import { projectDocumentLanding, type ProjectDocumentPresence } from './projectDocuments';
import type { WorkspaceState } from './types';

/**
 * Which workspace to land in after opening a file: Edit when the file produced a
 * crease pattern, Diagram when it holds nothing but a diagram and Fold when
 * nothing but fold sequences (a project document's own workspace:
 * `projectDocuments`, the Diagram first when it holds both), otherwise Design. Single
 * source of truth for every open path — File › Open, the start screen, the
 * desktop open-with handler, and a drop — so they cannot disagree about where a
 * given file opens.
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
  state: Pick<WorkspaceState, 'oristudioCpDocument' | 'importedCreasePattern' | 'designTabs'> &
    ProjectDocumentPresence
): WorkspaceId {
  const hasDesign = state.designTabs.some((tab) => tab.kind !== null);
  // A linked CP is this sequence's authoring source. Reopening its native
  // project should show the sequence, with the source still available in Edit.
  if (!hasDesign && state.diagram === null && state.foldSequences?.some(({ document }) =>
    document.steps.some(({ op }) => op?.kind === 'cp-jump' && op.source?.documentId === CREASE_PATTERN_DOCUMENT_ID))) {
    return 'fold';
  }
  if (state.oristudioCpDocument !== null || state.importedCreasePattern !== null) return 'edit';
  // A project that is only a diagram — pictures drawn elsewhere, no pattern and
  // no design — or only fold sequences has nothing to show in Design but the chooser.
  return (hasDesign ? null : projectDocumentLanding(state)) ?? 'design';
}
