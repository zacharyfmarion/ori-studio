import { useCallback } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramStep } from '../document/diagramDocument';
import type { DiagramLinkStatus } from './linkStatus';
import { useDiagramLinkStatuses } from './useLinkStatus';

export interface DiagramCardLinks {
  /** Each linked step's status, by step id. */
  statuses: ReadonlyMap<string, DiagramLinkStatus>;
  /** The steps being captured, by id, and whether each one's fold can be stopped. */
  captures: Readonly<Record<string, { stoppable: boolean }>>;
  stop: (stepId: string) => void;
}

/**
 * Every card's link, bound to the store: how each linked step stands against
 * its pattern, which are being captured, and a Stop for a capture's fold.
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
  return { statuses, captures, stop };
}
