import { pleatOrderSearch, pleatOrders, pleatSearchBudget, type PleatInput } from '../tools/pleat/pleatEngine';
import type { FoldWasmEngine } from './foldEngineCalls';
import { runFoldSearch, type FoldSearch } from './foldSearch';
import type { FoldPleatOp } from '../document/foldSequenceDocument';
/**
 * The compound folds' one question on the Fold engine's bridge
 * (`oristudio-fold-wasm/src/compound.rs`), beside the step calls
 * (`foldEngineCalls.ts`) and the io calls (`foldEngineIoCalls.ts`) over the
 * same wasm `FoldEngine`: what `workers/foldSequenceWorker.ts` exposes, kept
 * apart from the worker so the wasm tests drive exactly this call.
 *
 * Every compound fold — a reverse fold, a crimp, a tuck, a vertex fold, a
 * sink — lands, replays and is pictured through the step calls like any
 * step; this asks only what its family's tools need before it lands, and
 * answers with its family's answer tagged by `family`
 * (`foldEngineCompoundWire.ts`). A family's choosing calls are its own
 * (`foldEngineCrimpTuckCalls.ts`, `foldEngineSquashCalls.ts`,
 * `foldEngineSinkCalls.ts`).
 *
 * Arguments are checked here as `foldEngineCalls.ts` checks its own: a
 * handle is a whole number, the op a compound fold's, the choices an
 * object. A caller's mistake throws a `{ code, message }` envelope; a refusal
 * is a value.
 *
 * Pure: no React, no store, no wasm import (the engine is handed in).
 */

import type { FoldChoices, FoldCompletionChoice, FoldLanding } from '../document/foldSequenceDocument';
import { invalidInput, requireHandle, requireObject } from './foldEngineCalls';
import { isFoldCompoundOp, type FoldCompoundAnalysis, type FoldEngineCompoundOp } from './foldEngineCompoundWire';
import type { FoldEngineOp, FoldEngineOutcome } from './foldEngineWire';
import { foldPlacementSearch, foldPlacementSearchBudget, isFoldPlacementOp } from './foldPlacementSearch';

/** The wasm class's compound surface, as the generated `FoldEngine` has it. */
export interface FoldOrderQuery {
  batch?: number; prefer?: readonly (readonly [number, number])[]; index: number; perComponent?: number; maxNodes?: number;
  /** A plain fold's placement search: how long this batch may search in all (`foldPlacementSearch.ts`). */
  searchMs?: number }
export interface FoldOrderSelection {
  pleat?: FoldPleatOp['resolved'];
  landing?: FoldLanding;
  moving_varies?: boolean;
  relations?: [number, number][];
  count: { orders: number; exact: boolean };
  index: number;
  completion: FoldCompletionChoice | null;
  /** A placement search with time left in its batch: the same query searches further. */
  searching?: boolean;
}

export interface FoldWasmCompoundEngine {
  release_order_search?(state: number): void;
  order_selection(state: number, op: unknown, choices: unknown, query: unknown): unknown;
  compound_analysis(state: number, op: unknown, choices: unknown): unknown;
}

/** A search the worker runs in slices (`foldSearch.ts`), with the budget it runs within. */
export interface FoldBudgetedSearch<T> {
  search: FoldSearch<T>;
  budgetMs: number;
}

export interface FoldEngineCompoundCalls {
  releaseOrderSearch?(state: number): void;
  orderSelection(state: number, op: FoldEngineOp, choices: FoldChoices | undefined, query: FoldOrderQuery): FoldEngineOutcome<FoldOrderSelection>;
  /**
   * A pleat's orders as a search the worker runs in slices: what
   * `orderSelection` runs to the end in one go for a pleat.
   */
  pleatOrderSearch(
    state: number,
    op: PleatInput,
    choices: FoldChoices | undefined,
    query: FoldOrderQuery
  ): FoldBudgetedSearch<FoldEngineOutcome<FoldOrderSelection>>;
  /**
   * A valley or mountain fold's placements as a search the worker runs in
   * slices, one press's `searchMs` long: what `orderSelection` runs to the
   * end in one go when the query names a time.
   */
  placementOrderSearch(
    state: number,
    op: FoldEngineOp,
    choices: FoldChoices | undefined,
    query: FoldOrderQuery
  ): FoldBudgetedSearch<FoldEngineOutcome<FoldOrderSelection>>;
  /**
   * What a compound fold from `state` is before it lands, as its family's
   * tools ask: a reverse fold's tip and the kinds that land, a crimp's tip
   * and kinds, a tuck's targets, a vertex op's flap, petal or fan, a sink's
   * point and pockets. A refusal is its family's: nothing stays, a flap with
   * no opening, a stored choice that no longer resolves, …
   */
  compoundAnalysis(
    state: number,
    op: FoldEngineCompoundOp,
    choices?: FoldChoices
  ): FoldEngineOutcome<FoldCompoundAnalysis>;
}

function requireIndex(query: FoldOrderQuery) {
  if (!Number.isSafeInteger(query.index) || query.index < 0) throw invalidInput('order index must be a nonnegative safe integer');
}

function requireCompoundOp(op: FoldEngineCompoundOp): FoldEngineCompoundOp {
  requireObject('op', op);
  if (!isFoldCompoundOp(op)) {
    const kind: unknown = (op as { kind?: unknown }).kind;
    throw invalidInput(`op must be a compound fold's, got ${String(kind)}`);
  }
  return op;
}

export function createFoldEngineCompoundCalls(engine: FoldWasmCompoundEngine): FoldEngineCompoundCalls {
  return {
    releaseOrderSearch(state) { engine.release_order_search?.(requireHandle('state', state)); },
    orderSelection(state, op, choices, query) {
      requireIndex(query);
      if (op.kind === 'pleat') return pleatOrders(engine as FoldWasmEngine & FoldWasmCompoundEngine, requireHandle('state', state), op, choices, query);
      if (query.searchMs !== undefined && isFoldPlacementOp(requireObject('op', op))) {
        return runFoldSearch(foldPlacementSearch(engine, requireHandle('state', state), op, choices, query), foldPlacementSearchBudget(query));
      }
      return engine.order_selection(requireHandle('state', state), requireObject('op', op), choices, query) as FoldEngineOutcome<FoldOrderSelection>;
    },
    pleatOrderSearch(state, op, choices, query) {
      requireIndex(query);
      requireObject('op', op);
      return {
        search: pleatOrderSearch(engine as FoldWasmEngine & FoldWasmCompoundEngine, requireHandle('state', state), op, choices, query),
        budgetMs: pleatSearchBudget(query),
      };
    },
    placementOrderSearch(state, op, choices, query) {
      requireIndex(query);
      if (!isFoldPlacementOp(requireObject('op', op))) throw invalidInput(`op must be a valley or mountain fold, got ${String(op.kind)}`);
      return {
        search: foldPlacementSearch(engine, requireHandle('state', state), op, choices, query),
        budgetMs: foldPlacementSearchBudget(query),
      };
    },
    compoundAnalysis(state, op, choices) {
      return engine.compound_analysis(
        requireHandle('state', state),
        requireCompoundOp(op),
        choices === undefined ? undefined : requireObject('choices', choices)
      ) as FoldEngineOutcome<FoldCompoundAnalysis>;
    },
  };
}
