/**
 * The active crease pattern's grid width in model units — one cell.
 *
 * Read from the store rather than threaded down as a prop. The only thing that
 * wants it is the Square tool's cells ↔ paper conversion, and routing it there
 * by hand meant `CpContextToolPanel` and its group dispatcher — which exist to
 * choose *which* params render, not to know what any of them mean — both grew a
 * parameter for one tool's unit maths. AGENTS.md puts store bindings for one
 * concern in a hook beside that concern; this is that.
 *
 * `undefined` when there is no editable document or its grid is degenerate.
 * Callers decide what that means: `squareSizeUnitScale` falls back to the paper
 * edge, because a square of size zero is not a useful answer to "no grid".
 */
import { useMemo } from 'react';

import { getOrieditaGridBasis, visibleOrieditaGridMetadata } from '../../lib/creasePatternViewport';
import { useWorkspaceStore } from '../../store/workspaceStore/store';

export function useCpGridWidth(): number | undefined {
  const document = useWorkspaceStore((state) => state.oristudioCpDocument);
  const grid = document?.document?.crease_pattern.grid;

  return useMemo(() => {
    if (!grid) return undefined;
    const { gridWidth } = getOrieditaGridBasis(visibleOrieditaGridMetadata(grid));
    return Number.isFinite(gridWidth) && gridWidth > 0 ? gridWidth : undefined;
  }, [grid]);
}
