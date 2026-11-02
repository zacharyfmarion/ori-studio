/**
 * Where each Edit figure's spread stands on the canvas, by figure id: the
 * drawing side writes it as it prepares and solves a figure's spread, and the
 * Properties sheet reads it, to say beside "Spread layers" why a spread that
 * is on does not show. Runtime state only: never saved, never in history.
 *
 * A figure with no entry has nothing to report: its spread is off, or it is
 * drawn. Only `unavailable` is for the user to read; `preparing` exists so
 * the drawing side can tell a solve still running from one that failed, and
 * is never shown as text.
 */

import { create } from 'zustand';

export type FoldedFigureSpreadStatus = 'preparing' | 'ready' | 'unavailable';

interface FoldedFigureSpreadStatusState {
  readonly byFigure: Readonly<Record<string, FoldedFigureSpreadStatus>>;
}

export const useFoldedFigureSpreadStatusStore = create<FoldedFigureSpreadStatusState>()(() => ({ byFigure: {} }));

/** Record a figure's status, or forget it with `null`. A status that stands already changes nothing. */
export function setFoldedFigureSpreadStatus(id: string, status: FoldedFigureSpreadStatus | null): void {
  const { byFigure } = useFoldedFigureSpreadStatusStore.getState();
  if ((byFigure[id] ?? null) === status) return;
  const next = { ...byFigure };
  if (status === null) delete next[id];
  else next[id] = status;
  useFoldedFigureSpreadStatusStore.setState({ byFigure: next });
}

/** A figure's status as a hook, or null when it has none. */
export function useFoldedFigureSpreadStatus(id: string | null): FoldedFigureSpreadStatus | null {
  return useFoldedFigureSpreadStatusStore((state) => (id === null ? null : (state.byFigure[id] ?? null)));
}
