/**
 * A sink tool's own queries — how many orders a sink leaves, what a pick
 * stores, and the sunk points an unsink can pull back out — over the same
 * wasm `FoldEngine` as `foldEngineCalls.ts`: what
 * `workers/foldSequenceWorker.ts` exposes beside the step calls, kept apart
 * from the worker so the wasm test drives exactly these calls in-process. A
 * sink itself lands through `apply`, as every step does, and what its point
 * is before it lands is the compound question's
 * (`foldEngineCompoundCalls.ts`, `foldEngineSinkWire.ts`).
 *
 * Every argument is checked here, at the boundary, as `foldEngineCalls.ts`
 * checks its own: handles are whole numbers, the op is a sink's, a choice is
 * a list of indices. Shapes inside an op or choices are serde's to check, in
 * Rust. A caller's mistake throws a `{ code, message }` envelope; a refusal is
 * a value.
 *
 * Pure: no React, no store, no wasm import (the engine is handed in).
 */

import type { FoldChoices } from '../document/foldSequenceDocument';
import { invalidInput, requireHandle, requireObject } from './foldEngineCalls';
import {
  isFoldSinkOp,
  type FoldEngineSinkOp,
  type FoldSinkOrders,
  type FoldSinkPicked,
  type FoldSunkPoints,
} from './foldEngineSinkWire';
import type { FoldEngineOutcome } from './foldEngineWire';

/** The wasm class's sink surface, as the generated `FoldEngine` has it. */
export interface FoldWasmSinkEngine {
  sink_orders(state: number, op: unknown, choices: unknown): unknown;
  sink_pick(state: number, op: unknown, choices: unknown, choice: Uint32Array): unknown;
  sunk_points(state: number, op: unknown, choices: unknown): unknown;
}

export interface FoldEngineSinkCalls {
  /**
   * The sunk points an unsink op's line can pull back out on its side, each
   * a flap of that side; the op's seed is not read. Any other op is the
   * caller's mistake.
   */
  sunkPoints(state: number, op: FoldEngineSinkOp, choices?: FoldChoices): FoldEngineOutcome<FoldSunkPoints>;
  /** How many orders the sink leaves with these choices: one when it is decided. */
  sinkOrders(state: number, op: FoldEngineSinkOp, choices?: FoldChoices): FoldEngineOutcome<FoldSinkOrders>;
  /** The completion a step stores for one listed order per component; null when the sink is decided. */
  sinkPick(
    state: number,
    op: FoldEngineSinkOp,
    choice: readonly number[],
    choices?: FoldChoices
  ): FoldEngineOutcome<FoldSinkPicked>;
}

/** The largest index a choice can carry: a `u32`. */
const MAX_INDEX = 0xffff_ffff;

function requireSinkOp(op: FoldEngineSinkOp): FoldEngineSinkOp {
  requireObject('op', op);
  if (!isFoldSinkOp(op)) {
    const kind: unknown = (op as { kind?: unknown }).kind;
    throw invalidInput(`op must be an open-sink, closed-sink or unsink op, got ${String(kind)}`);
  }
  return op;
}

function requireChoices(choices: FoldChoices | undefined): FoldChoices | undefined {
  return choices === undefined ? undefined : requireObject('choices', choices);
}

function requireChoice(choice: readonly number[]): Uint32Array {
  if (!Array.isArray(choice)) throw invalidInput('choice must be an array of indices');
  choice.forEach((k, at) => {
    if (typeof k !== 'number' || !Number.isInteger(k) || k < 0 || k > MAX_INDEX) {
      throw invalidInput(`choice[${at}] must be an index (a whole number from 0), got ${String(k)}`);
    }
  });
  return Uint32Array.from(choice);
}

export function createFoldEngineSinkCalls(engine: FoldWasmSinkEngine): FoldEngineSinkCalls {
  return {
    sunkPoints(state, op, choices) {
      const checked = requireSinkOp(op);
      if (checked.kind !== 'unsink') throw invalidInput(`op must be an unsink op, got ${checked.kind}`);
      return engine.sunk_points(
        requireHandle('state', state),
        checked,
        requireChoices(choices)
      ) as FoldEngineOutcome<FoldSunkPoints>;
    },

    sinkOrders(state, op, choices) {
      return engine.sink_orders(
        requireHandle('state', state),
        requireSinkOp(op),
        requireChoices(choices)
      ) as FoldEngineOutcome<FoldSinkOrders>;
    },

    sinkPick(state, op, choice, choices) {
      return engine.sink_pick(
        requireHandle('state', state),
        requireSinkOp(op),
        requireChoices(choices),
        requireChoice(choice)
      ) as FoldEngineOutcome<FoldSinkPicked>;
    },
  };
}
