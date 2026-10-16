import type { StoreApi } from 'zustand';
import type { WorkspaceState } from './types';
import { releaseFoldedFigureHandles } from '../../cp-workspace/folded/foldedFigureHandles';

/**
 * Trimming or branching either history also expires the unreachable portion
 * of its partner. Skipping a missing compound entry would let an older snapshot
 * silently undo only half an import; keeping it would block undo forever.
 */
export function installCompoundHistory(store: StoreApi<WorkspaceState>): void {
  store.subscribe((state, previous) => {
    if (
      state.diagramHistory === previous.diagramHistory &&
      state.oristudioCpHistoryPast === previous.oristudioCpHistoryPast &&
      state.oristudioCpHistoryFuture === previous.oristudioCpHistoryFuture
    )
      return;
    const cpIds = new Set(
      [...state.oristudioCpHistoryPast, ...state.oristudioCpHistoryFuture].map((e) => e.compoundId),
    );
    const diagramIds = new Set(
      [...state.diagramHistory.past, ...state.diagramHistory.future].map((e) => e.compoundId),
    );
    const cpPast = reachable(state.oristudioCpHistoryPast, diagramIds, 'past');
    const cpFuture = reachable(state.oristudioCpHistoryFuture, diagramIds, 'future');
    const past = reachable(state.diagramHistory.past, cpIds, 'past');
    const future = reachable(state.diagramHistory.future, cpIds, 'future');
    if (
      cpPast === state.oristudioCpHistoryPast &&
      cpFuture === state.oristudioCpHistoryFuture &&
      past === state.diagramHistory.past &&
      future === state.diagramHistory.future
    )
      return;
    const kept = new Set([...cpPast, ...cpFuture]);
    for (const entry of [...state.oristudioCpHistoryPast, ...state.oristudioCpHistoryFuture]) {
      if (!kept.has(entry)) releaseFoldedFigureHandles(entry.foldedFigures);
    }
    store.setState({
      oristudioCpHistoryPast: cpPast,
      oristudioCpHistoryFuture: cpFuture,
      diagramHistory: { past, future },
    });
  });
}

function reachable<T extends { compoundId?: string }>(
  entries: T[],
  partners: Set<string | undefined>,
  direction: 'past' | 'future',
): T[] {
  const orphan = (entry: T) => entry.compoundId !== undefined && !partners.has(entry.compoundId);
  if (direction === 'past') {
    let last = -1;
    for (let i = entries.length - 1; i >= 0; i--)
      if (orphan(entries[i]!)) {
        last = i;
        break;
      }
    return last < 0 ? entries : entries.slice(last + 1);
  }
  const first = entries.findIndex(orphan);
  return first < 0 ? entries : entries.slice(0, first);
}
