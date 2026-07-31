/**
 * Store bindings for the fold-angle verbs.
 *
 * Lives beside the fold-angle modules rather than in a panel (AGENTS.md >
 * "Panel components"): the panel composes, it does not accumulate store
 * plumbing.
 */
import { useCallback, useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { selectedCpLineSegments } from '../../lib/creasePatternClipboard';
import { creaseFoldMagnitudeDegrees, isFoldingCrease } from '../../lib/foldAngle';
import {
  type FoldAngleSelectionSummary,
  summariseFoldAngles,
} from './foldAngleActions';

export interface FoldAngleSelectionBinding {
  /** Shape of the fold angles across the current selection. */
  summary: FoldAngleSelectionSummary;
  /** True when at least one selected line can carry a fold angle. */
  enabled: boolean;
  /**
   * Apply `|ρ|` to every folding crease in the selection.
   *
   * `null` means "make classic". 180 degrees normalises to classic in the
   * kernel, so both routes land in the same place.
   */
  setDegrees: (degrees: number | null) => Promise<boolean>;
}

export function useFoldAngleSelection(): FoldAngleSelectionBinding {
  const selection = useWorkspaceStore((s) => s.oristudioCpSelection);
  const cpDocument = useWorkspaceStore((s) => s.oristudioCpDocument?.document ?? null);
  const executeCommand = useWorkspaceStore((s) => s.executeOristudioCpCommand);

  const summary = useMemo(() => {
    const segments = selectedCpLineSegments(cpDocument, selection);
    const creases = segments.filter((segment) => isFoldingCrease(segment.color));
    const magnitudes = creases
      .map((segment) => creaseFoldMagnitudeDegrees(segment))
      .filter((value): value is number => value !== null);
    return summariseFoldAngles(magnitudes, segments.length - creases.length);
  }, [cpDocument, selection]);

  const setDegrees = useCallback(
    async (degrees: number | null) => {
      if (selection.lines.length === 0) return false;
      return executeCommand('CreaseSetFoldAngle', {
        line_ids: selection.lines,
        // Omitting the field is how the kernel is told "make classic".
        ...(degrees === null ? {} : { fold_magnitude_degrees: degrees }),
      });
    },
    [executeCommand, selection.lines]
  );

  return { summary, enabled: summary.creaseCount > 0, setDegrees };
}
