import { useCallback } from 'react';
import { trackSimulatorAuxLinesChanged } from '../analytics';
import { documentHasAuxLines } from '../cp-workspace/sheets/simulationLines';
import { foldAuxLinesAreFacets } from '../lib/simulationAuxLines';
import { useWorkspaceStore } from '../store/workspaceStore';
import { selectCpAuxLinesAreFacets } from '../store/workspaceStore/cpSimulationAuxLines';

/**
 * The open crease pattern's "bend along auxiliary creases" setting: whether
 * its aux lines are built into the simulated paper as facets or drawn on it.
 * Offered only for an editable pattern that has aux lines, where it changes
 * something.
 */
export function useAuxLinesAsFacets(): {
  offered: boolean;
  facets: boolean;
  setFacets: (facets: boolean) => void;
} {
  const offered = useWorkspaceStore((state) => {
    const document = state.oristudioCpDocument?.document;
    return document !== undefined && documentHasAuxLines(document);
  });
  const facets = useWorkspaceStore(selectCpAuxLinesAreFacets);
  const fileSaysFacets = useWorkspaceStore((state) =>
    foldAuxLinesAreFacets(state.importedCreasePattern?.sourceFold)
  );
  const setCpAuxLinesAreFacets = useWorkspaceStore((state) => state.setCpAuxLinesAreFacets);
  const setFacets = useCallback(
    (next: boolean) => {
      setCpAuxLinesAreFacets(next);
      trackSimulatorAuxLinesChanged({ auxLinesAreFacets: next, fileSaysFacets });
    },
    [setCpAuxLinesAreFacets, fileSaysFacets]
  );
  return { offered, facets, setFacets };
}
