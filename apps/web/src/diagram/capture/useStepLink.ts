import { useCallback, useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramShowAs, DiagramStep } from '../document/diagramDocument';
import type { DiagramLinkStatus } from './linkStatus';
import { linkDiagramStep, pickerShowAs } from './stepCaptureActions';
import {
  linkedSheet,
  useDiagramPatternSheets,
  type DiagramPatternSheet,
  type DiagramPatternSheets,
} from './useDiagramPatternSheets';
import { useDiagramLinkStatuses } from './useLinkStatus';

const NO_STEPS: readonly DiagramStep[] = [];

export interface DiagramStepLink {
  /** How the step's link stands; null for a step that is not linked. */
  link: DiagramLinkStatus | null;
  patternOpen: boolean;
  /** The step's capture while one runs, and its Stop when its fold can be stopped. */
  capture: { stop: (() => void) | null } | null;
  /** The pattern picker, while the step's pattern is being chosen; null otherwise. */
  picker: {
    sheets: DiagramPatternSheets;
    selectedId: number | null;
    busy: boolean;
    /** How the step will show the pattern it links to (D19). */
    showAs: DiagramShowAs;
    setShowAs: (way: DiagramShowAs) => void;
    pick: (sheet: DiagramPatternSheet) => void;
    cancel: () => void;
  } | null;
}

/**
 * A step's link to the crease pattern, bound to the store, for the Step pane's
 * Picture section: how it stands, its capture with a Stop, the pattern picker
 * while its pattern is being chosen.
 */
export function useDiagramStepLink(step: DiagramStep | null): DiagramStepLink {
  const stepId = step?.id ?? null;
  const statuses = useDiagramLinkStatuses(step ? [step] : NO_STEPS);
  const link = (stepId !== null ? statuses.get(stepId) : undefined) ?? null;
  const patternOpen = useWorkspaceStore((state) => state.oristudioCpDocument !== null);
  const runId = useWorkspaceStore((state) =>
    stepId !== null && Object.hasOwn(state.diagramCaptures, stepId)
      ? (state.diagramCaptures[stepId]?.runId ?? null)
      : undefined
  );
  const stoppable = useWorkspaceStore(
    (state) => runId != null && state.oristudioCpFoldRuns[runId]?.cancellable === true
  );
  const pickerOpen = useWorkspaceStore(
    (state) => stepId !== null && state.diagramPatternPicker === stepId
  );
  const sheets = useDiagramPatternSheets(pickerOpen);

  // The way the picker links in: the step's own, or the session's last, until
  // the reader picks another — and again from those each time it opens, so a
  // way picked for one link is forgotten when the picker closes, whatever
  // closed it (a link, Cancel, another step selected).
  const [chosen, setChosen] = useState<{ stepId: string; way: DiagramShowAs } | null>(null);
  if (!pickerOpen && chosen !== null) setChosen(null);
  const showAs = chosen && chosen.stepId === stepId && pickerOpen ? chosen.way : pickerShowAs(step);
  const setShowAs = useCallback(
    (way: DiagramShowAs) => {
      if (stepId !== null) setChosen({ stepId, way });
    },
    [stepId]
  );

  const stop = useCallback(() => {
    if (stepId !== null) useWorkspaceStore.getState().stopDiagramCapture(stepId);
  }, [stepId]);
  const pick = useCallback(
    (sheet: DiagramPatternSheet) => {
      if (stepId !== null) void linkDiagramStep(stepId, sheet.segment, showAs);
    },
    [stepId, showAs]
  );
  const cancel = useCallback(() => {
    useWorkspaceStore.getState().closeDiagramPatternPicker();
  }, []);

  const capturing = runId !== undefined;
  const selectedId = useMemo(
    () =>
      step && sheets.status === 'ready' ? (linkedSheet(step, sheets.sheets)?.segment.id ?? null) : null,
    [step, sheets]
  );
  return {
    link,
    patternOpen,
    capture: capturing ? { stop: stoppable ? stop : null } : null,
    picker: pickerOpen ? { sheets, selectedId, busy: capturing, showAs, setShowAs, pick, cancel } : null,
  };
}
