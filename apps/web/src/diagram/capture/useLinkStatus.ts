import { useEffect, useMemo, useState } from 'react';
import { peekCpSheetIndex } from '../../cp-workspace/sheets/cpSheetIndex';
import { useCpSheetIndex } from '../../cp-workspace/sheets/useCpSheetIndexState';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramStep } from '../document/diagramDocument';
import { foldLinkNeedsReplay, type FoldLinkContext } from '../fold/foldStepLink';
import { foldLinkContextNow, useFoldLinkContext } from '../fold/useFoldLinkContext';
import { diagramLinkStatus } from './diagramLinks';
import { linkedSourceOf, type DiagramLinkContext, type DiagramLinkStatus } from './linkStatus';

const NO_STATUSES: ReadonlyMap<string, DiagramLinkStatus> = new Map();

/** Whether any of these steps is linked to a region of Edit's pattern, and so needs the sheet index. */
function wantsSheetIndex(steps: readonly DiagramStep[]): boolean {
  return steps.some((step) => {
    const source = linkedSourceOf(step);
    return source !== null && source.kind !== 'fold-step';
  });
}

/**
 * Whether any of these steps is linked to a Fold step the session's replay can
 * tell, and so needs it: a link to a step that is gone, a newer build's, or in
 * a sequence Fold does not show is told without it.
 */
function wantsFoldReplay(steps: readonly DiagramStep[], sequences: FoldLinkContext['sequences']): boolean {
  return steps.some((step) => {
    const source = linkedSourceOf(step);
    return source?.kind === 'fold-step' && foldLinkNeedsReplay(source, sequences);
  });
}

/**
 * Each linked step's link status, by step id (D2, D3, D6; fold-workspace
 * D17): what the cards and the Step pane say, and what Refresh is offered
 * for, each by its kind's descriptor (`diagramLinks.ts`). A step that is not
 * linked — to a pattern, the sheet it was sent from, or a Fold step — has
 * none. Statuses are memoized by the lines' content (`linkStatus`), so this
 * costs a lookup per card once the pattern has been looked at; a Fold link's
 * is a lookup in the session's replay, which the diagram holds while it has a
 * link the replay can tell.
 */
export function useDiagramLinkStatuses(
  steps: readonly DiagramStep[],
  background = false
): ReadonlyMap<string, DiagramLinkStatus> {
  const document = useWorkspaceStore((state) => state.oristudioCpDocument?.document ?? null);
  const sheets = useCpSheetIndex(wantsSheetIndex(steps));
  const sequences = useWorkspaceStore((state) => state.foldSequences);
  const wantsFold = useMemo(() => wantsFoldReplay(steps, sequences), [steps, sequences]);
  const fold = useFoldLinkContext(wantsFold);
  const context = useMemo((): DiagramLinkContext => ({ cp: { document, sheets }, fold }), [document, sheets, fold]);
  const [checked, setChecked] = useState<ReadonlyMap<string, DiagramLinkStatus> | null>(null);
  useEffect(() => {
    if (!background) return;
    // The workspace needs all statuses for Refresh all; checking hundreds in
    // render blocks a scroll as soon as the sheet index lands. Fill the shared
    // choice cache between frames, and publish one complete answer.
    // Single-step inspectors still check their selected source immediately.
    const cancel = checkLinkStatusesInBackground(steps, (step) => {
      const source = linkedSourceOf(step);
      return source ? diagramLinkStatus(source, context) : null;
    }, setChecked);
    return cancel;
  }, [background, steps, context]);
  return useMemo(() => {
    // The last complete answer stays up while the next pass runs: going blank
    // until it lands made every card's chip and the Refresh-all count blink on
    // each edit. Statuses are by step id, so a step that is gone has none.
    if (background) return checked ?? NO_STATUSES;
    let statuses: Map<string, DiagramLinkStatus> | null = null;
    for (const step of steps) {
      const source = linkedSourceOf(step);
      if (!source) continue;
      statuses ??= new Map();
      statuses.set(step.id, diagramLinkStatus(source, context));
    }
    return statuses ?? NO_STATUSES;
  }, [background, checked, steps, context]);
}

/** Cancellable, time-bounded bulk checks; no second cache and no document copies. */
export function checkLinkStatusesInBackground(
  steps: readonly DiagramStep[],
  check: (step: DiagramStep) => DiagramLinkStatus | null,
  publish: (statuses: ReadonlyMap<string, DiagramLinkStatus>) => void
): () => void {
  const statuses = new Map<string, DiagramLinkStatus>();
  let index = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const batch = () => {
    if (cancelled) return;
    const until = performance.now() + 4;
    do {
      const step = steps[index++];
      if (!step) break;
      const status = check(step);
      if (status !== null) statuses.set(step.id, status);
    } while (index < steps.length && performance.now() < until);
    if (index < steps.length) timer = setTimeout(batch, 16);
    else publish(statuses);
  };
  timer = setTimeout(batch, 0);
  return () => { cancelled = true; clearTimeout(timer); };
}

/**
 * A step's link status as it can be told right now, without waiting for the
 * sheet index or a replay: for a surface that builds its verbs at the moment
 * it needs them (a context menu opening).
 */
export function linkStatusNow(step: DiagramStep): DiagramLinkStatus | null {
  const source = linkedSourceOf(step);
  if (!source) return null;
  return diagramLinkStatus(source, linkContextNow());
}

/** Everything a link is told against, as it stands now. */
export function linkContextNow(): DiagramLinkContext {
  const document = useWorkspaceStore.getState().oristudioCpDocument?.document ?? null;
  return {
    cp: { document, sheets: peekCpSheetIndex(document) },
    fold: foldLinkContextNow(),
  };
}
