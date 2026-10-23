/**
 * A plain fold's placement search (`oristudio-fold-wasm/src/order_selection.rs`)
 * as a search the worker runs in slices (`foldSearch.ts`).
 *
 * The bridge keeps one search per fold and spends a query's `searchMs` on
 * it in calls of at most 150 ms, answering `searching` while that time is
 * not spent and the search is not over. This asks again until it is, giving
 * the thread back between calls, so a search can be stopped there. A new
 * `batch` is a new press of Find more orders, with its own time; a press
 * searches on from wherever the last one stopped, so each press finds more
 * than the one before it could have. A forced fold is decided before any of
 * this runs (`FoldPlacementSearch`), so a slow machine never asks one.
 *
 * A press whose time is spent before it has found a single placement, with
 * the search not over, keeps searching, one more press's time per call, for
 * up to {@link FIRST_PLACEMENT_MS} past its own: how long the first placement
 * takes depends on the machine, and an answer of none found leaves a fold
 * that lands with no preview, as it did on CI's slower runners.
 *
 * Pure: no React, no store, no wasm import (the engine is handed in).
 */
import { FoldSearchStopped, type FoldSearch } from './foldSearch';
import type { FoldOrderQuery, FoldOrderSelection, FoldWasmCompoundEngine } from './foldEngineCompoundCalls';
import type { FoldEngineOp, FoldEngineOutcome } from './foldEngineWire';
import type { FoldChoices } from '../document/foldSequenceDocument';

/** A press's search time at the first budget: one of the bridge's slices. Each press after multiplies it with the budget. */
export const FOLD_PLACEMENT_SEARCH_MS = 150;

/** The most a press that has found no placement searches past its own time, for its first. */
const FIRST_PLACEMENT_MS = 1_000;

/** The time a placement search runs within, beyond its own `searchMs` and its first placement's: a bound for the driver, never reached by a bridge that counts its own time. */
const DRIVER_SLACK_MS = 1_000;

export function isFoldPlacementOp(op: FoldEngineOp): boolean {
  return op.kind === 'valley' || op.kind === 'mountain';
}

export function foldPlacementSearchBudget(query: FoldOrderQuery): number {
  return (query.searchMs ?? FOLD_PLACEMENT_SEARCH_MS) + FIRST_PLACEMENT_MS + DRIVER_SLACK_MS;
}

/** Ask until the press's time is spent, with a placement found, or the search is over; stopped for time, the latest answer. */
export function* foldPlacementSearch(
  engine: FoldWasmCompoundEngine,
  state: number,
  op: FoldEngineOp,
  choices: FoldChoices | undefined,
  query: FoldOrderQuery
): FoldSearch<FoldEngineOutcome<FoldOrderSelection>> {
  // The bridge keeps a batch's spent time across calls, so the same batch
  // asked with a longer `searchMs` searches on. A stopped press (`searchMs`
  // 0) only reads what is found; a query with no time is one call's search.
  const press = query.searchMs ?? 0;
  const most = press + FIRST_PLACEMENT_MS;
  let asked = query;
  const ask = () => engine.order_selection(state, op, choices, asked) as FoldEngineOutcome<FoldOrderSelection>;
  const unfound = (reply: FoldOrderSelection) =>
    press > 0 && reply.count.orders === 0 && !reply.count.exact && (asked.searchMs ?? 0) < most;
  let answer = ask();
  try {
    while (answer.status === 'ok' && (answer.searching || unfound(answer))) {
      yield;
      if (!answer.searching) asked = { ...asked, searchMs: Math.min(most, (asked.searchMs ?? 0) + press) };
      answer = ask();
    }
  } catch (error) {
    if (!(error instanceof FoldSearchStopped) || error.reason !== 'budget') throw error;
  }
  return answer;
}
