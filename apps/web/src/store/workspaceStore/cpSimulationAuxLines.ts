import { documentAuxLinesAreFacets } from '../../lib/simulationAuxLines';
import type { WorkspaceState } from './types';

/**
 * Whether the open crease pattern's aux lines are facets the simulated paper
 * is built with, rather than lines drawn on it: the user's choice when they
 * made one, else what the FOLD it was imported from says
 * (`lib/simulationAuxLines.ts`). Every simulation of the document reads this.
 */
export function selectCpAuxLinesAreFacets(
  state: Pick<WorkspaceState, 'oristudioCpDocumentExtensions' | 'importedCreasePattern'>
): boolean {
  return documentAuxLinesAreFacets(
    state.oristudioCpDocumentExtensions,
    state.importedCreasePattern?.sourceFold
  );
}
