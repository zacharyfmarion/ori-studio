/**
 * Store bindings for the fold-angle verbs.
 *
 * Lives beside the fold-angle modules rather than in a panel (AGENTS.md >
 * "Panel components"): the panel composes, it does not accumulate store
 * plumbing.
 */
import { useCallback, useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { OristudioCpSelection } from '../../lib/creasePatternViewport';
import { selectedCpLineSegments } from '../../lib/creasePatternClipboard';
import { creaseFoldMagnitudeDegrees, isFoldingCrease } from '../../lib/foldAngle';
import {
  type FoldAngleSelectionSummary,
  summariseFoldAngles,
} from './foldAngleActions';

/**
 * Is there anything in the selection a fold angle could be set on?
 *
 * The one definition of that question — {@link useFoldAngleSelection} reports it
 * as `enabled`, and {@link useFoldAngleAvailable} is the form for callers that
 * only need the answer. Short-circuits and clones nothing, because the tool hint
 * window asks it on every selection change to decide whether to open at all.
 */
export function hasFoldableCpSelection(
  document: OristudioCpDocumentSnapshot | null | undefined,
  selection: OristudioCpSelection
): boolean {
  if (!document) return false;
  return selection.lines.some((id) => {
    const segment = document.crease_pattern.line_segments[id - 1];
    return segment !== undefined && isFoldingCrease(segment.color);
  });
}

/**
 * {@link hasFoldableCpSelection} against the live selection, without building
 * the summary the control itself needs.
 */
export function useFoldAngleAvailable(): boolean {
  const selection = useWorkspaceStore((s) => s.oristudioCpSelection);
  const cpDocument = useWorkspaceStore((s) => s.oristudioCpDocument?.document ?? null);
  return useMemo(() => hasFoldableCpSelection(cpDocument, selection), [cpDocument, selection]);
}

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
  /**
   * Forget the magnitude while remembering the direction.
   *
   * The chip's counterpart to the presets: the same control that says "fold this
   * 90 degrees" can say "I have not decided how far". It keeps the direction
   * because that is the common intent, and because the direction is exactly the
   * bit the solver cannot recover on its own — at a full fold `+180` and `-180`
   * are the same rotation.
   */
  setUnassigned: () => Promise<boolean>;
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

  const setUnassigned = useCallback(async () => {
    if (selection.lines.length === 0) return false;
    // The default keeps the direction; forgetting it is the menu's explicit ask.
    return executeCommand('CreaseMakeUnassigned', { line_ids: selection.lines });
  }, [executeCommand, selection.lines]);

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

  return {
    summary,
    enabled: hasFoldableCpSelection(cpDocument, selection),
    setDegrees,
    setUnassigned,
  };
}
