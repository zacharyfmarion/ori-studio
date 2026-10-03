import { useCallback } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramStep } from '../document/diagramDocument';
import type { DiagramLinkStatus } from './linkStatus';
import { askReferencesForStep } from './referencesStepActions';
import { useDiagramLinkStatuses } from './useLinkStatus';

export interface DiagramCardLinks {
  /** Each linked step's status, by step id. */
  statuses: ReadonlyMap<string, DiagramLinkStatus>;
  /** The steps being captured, by id, and whether each one's fold can be stopped. */
  captures: Readonly<Record<string, { stoppable: boolean }>>;
  stop: (stepId: string) => void;
  /**
   * How many linked patterns changed: what Refresh all would capture again. A
   * step sent from References is not among them, whatever its sheet did — its
   * picture is a snapshot, never refreshed (D6).
   */
  refreshable: number;
  /** The step From References… waits to fill, if any. */
  awaitingReferences: string | null;
  /** Ask References for a step's picture (From References…). */
  askReferences: (stepId: string) => void;
  /** Stop waiting for a step from References. */
  cancelAwaiting: () => void;
}

/**
 * Every card's link, bound to the store: how each linked step stands against
 * its pattern, which are being captured, and a Stop for a capture's fold; and
 * which step waits for a picture from References, with its way there and back.
 */
export function useDiagramCardLinks(steps: readonly DiagramStep[]): DiagramCardLinks {
  const statuses = useDiagramLinkStatuses(steps);
  const runs = useWorkspaceStore((state) => state.diagramCaptures);
  const foldRuns = useWorkspaceStore((state) => state.oristudioCpFoldRuns);
  const captures: Record<string, { stoppable: boolean }> = {};
  for (const [stepId, run] of Object.entries(runs)) {
    captures[stepId] = { stoppable: run.runId !== null && foldRuns[run.runId]?.cancellable === true };
  }
  const stop = useCallback((stepId: string) => {
    useWorkspaceStore.getState().stopDiagramCapture(stepId);
  }, []);
  const awaitingReferences = useWorkspaceStore((state) => state.diagramReferencesTarget);
  let refreshable = 0;
  for (const step of steps) {
    if (step.source?.kind === 'cp' && statuses.get(step.id) === 'stale') refreshable += 1;
  }
  return {
    statuses,
    captures,
    stop,
    refreshable,
    awaitingReferences,
    askReferences: askReferencesForStep,
    cancelAwaiting: cancelAwaitingReferences,
  };
}

function cancelAwaitingReferences(): void {
  useWorkspaceStore.getState().cancelDiagramReferencesTarget();
}
