/**
 * Store bindings for the fold-direction-hint verb.
 *
 * Lives beside the fold-angle modules rather than in a panel (AGENTS.md >
 * "Panel components"), and mirrors {@link useFoldAngleSelection} hook for hook,
 * because the two controls sit next to each other and answer adjacent questions.
 */
import { useCallback, useMemo } from 'react';

import { useWorkspaceStore } from '../../store/workspaceStore/store';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { OristudioCpSelection } from '../../lib/creasePatternViewport';
import { selectedCpLineSegments } from '../../lib/creasePatternClipboard';
import {
  summariseDirectionHints,
  type DirectionHintChange,
  type DirectionHintSelectionSummary,
} from './directionHintActions';

/** Whether a segment is an undecided crease — the only thing a hint can sit on. */
function isUnassignedCrease(color: string): boolean {
  return color === 'None';
}

/**
 * Is there anything in the selection a direction hint could be set on?
 *
 * The exact complement of `hasFoldableCpSelection`: that one asks for `Red1`
 * or `Blue2`, this one for `None`, and the kernel's two verbs are gated the same
 * way round. A selection can satisfy both, in which case both controls show and
 * each acts only on the creases it can reach.
 *
 * Short-circuits and clones nothing — the context panel asks it on every
 * selection change to decide whether it has anything to render at all.
 */
export function hasUnassignedCpSelection(
  document: OristudioCpDocumentSnapshot | null | undefined,
  selection: OristudioCpSelection
): boolean {
  if (!document) return false;
  return selection.lines.some((id) => {
    const segment = document.crease_pattern.line_segments[id - 1];
    return segment !== undefined && isUnassignedCrease(segment.color);
  });
}

/**
 * {@link hasUnassignedCpSelection} against the live selection, without building
 * the summary the control itself needs.
 */
export function useDirectionHintAvailable(): boolean {
  const selection = useWorkspaceStore((s) => s.oristudioCpSelection);
  const cpDocument = useWorkspaceStore((s) => s.oristudioCpDocument?.document ?? null);
  return useMemo(() => hasUnassignedCpSelection(cpDocument, selection), [cpDocument, selection]);
}

export interface DirectionHintSelectionBinding {
  /** Shape of the hints across the current selection. */
  summary: DirectionHintSelectionSummary;
  /** True when at least one selected line is an undecided crease. */
  enabled: boolean;
  /**
   * Set or clear the hint on every undecided crease in the selection.
   *
   * The kernel skips decided creases, borders and auxiliary lines, so this is
   * safe to fire on a mixed selection: it reaches exactly the creases the
   * summary counted.
   */
  setHint: (change: DirectionHintChange) => Promise<boolean>;
}

export function useDirectionHintSelection(): DirectionHintSelectionBinding {
  const selection = useWorkspaceStore((s) => s.oristudioCpSelection);
  const cpDocument = useWorkspaceStore((s) => s.oristudioCpDocument?.document ?? null);
  const executeCommand = useWorkspaceStore((s) => s.executeOristudioCpCommand);

  const summary = useMemo(() => {
    const segments = selectedCpLineSegments(cpDocument, selection);
    const unassigned = segments.filter((segment) => isUnassignedCrease(segment.color));
    // `?? null` matters: an unhinted crease must count as a *shared* value so
    // an all-unhinted selection reads as "None", not as mixed.
    const hints = unassigned.map((segment) => segment.fold_direction_hint ?? null);
    return summariseDirectionHints(hints, segments.length - unassigned.length);
  }, [cpDocument, selection]);

  const setHint = useCallback(
    async (change: DirectionHintChange) => {
      if (selection.lines.length === 0) return false;
      return executeCommand('CreaseSetDirectionHint', {
        line_ids: selection.lines,
        direction_hint: change,
      });
    },
    [executeCommand, selection.lines]
  );

  return {
    summary,
    enabled: hasUnassignedCpSelection(cpDocument, selection),
    setHint,
  };
}
