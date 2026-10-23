/**
 * The crimp's and the tuck's own calls, over the same wasm `FoldEngine` as
 * `foldEngineCalls.ts`: what `workers/foldSequenceWorker.ts` exposes beside
 * the step calls, kept apart from the worker so the wasm test drives exactly
 * these calls in-process. What either moves before it lands is the compound
 * question's (`foldEngineCompoundCalls.ts`).
 *
 * Arguments are checked here as `foldEngineCalls.ts` checks its own: a
 * handle is a whole number, an op and choices are objects; the shapes inside
 * are serde's to check, in Rust. A caller's mistake throws a
 * `{ code, message }` envelope; a refusal is a value.
 *
 * Every landed state — the one a fold lands, and each order a choice lists —
 * is a step as `step` lands one, its report the step's `compound`, and
 * carries its `fs1` fingerprint, taken here like a step's, so a commit needs
 * nothing more from the worker.
 *
 * Pure: no React, no store, no wasm import (the engine is handed in).
 */

import { foldStateFingerprint } from '../document/foldDigest';
import type { FoldChoices } from '../document/foldSequenceDocument';
import { requireHandle, requireObject } from './foldEngineCalls';
import type {
  FoldCrimpTuckFingerprinted,
  FoldCrimpTuckLanded,
  FoldCrimpTuckTried,
  FoldEngineCrimpOp,
  FoldEngineTuckOp,
} from './foldEngineCrimpTuckWire';
import type { FoldEngineOutcome } from './foldEngineWire';

/** The wasm class's crimp and tuck surface, as the generated `FoldEngine` has it. */
export interface FoldWasmCrimpTuckEngine {
  crimp(state: number, op: unknown, choices: unknown): unknown;
  tuck(state: number, op: unknown, choices: unknown): unknown;
  canonical_keys(state: number): string[];
}

/** A crimp's or tuck's answer, every landed state fingerprinted. */
export type FoldCrimpTuckOutcome<F extends 'crimp' | 'tuck' = 'crimp' | 'tuck'> = FoldEngineOutcome<
  FoldCrimpTuckTried<FoldCrimpTuckFingerprinted<F>>
>;

export interface FoldEngineCrimpTuckCalls {
  /** Fold a crimp: landed, an opening to choose, or the orders to choose from, each landed. */
  crimp(state: number, op: FoldEngineCrimpOp, choices?: FoldChoices): FoldCrimpTuckOutcome<'crimp'>;
  /** Fold a tuck: landed, or the orders to choose from, each landed. */
  tuck(state: number, op: FoldEngineTuckOp, choices?: FoldChoices): FoldCrimpTuckOutcome<'tuck'>;
}

export function createFoldEngineCrimpTuckCalls(engine: FoldWasmCrimpTuckEngine): FoldEngineCrimpTuckCalls {
  const args = (state: number, op: object, choices: FoldChoices | undefined) =>
    [
      requireHandle('state', state),
      requireObject('op', op),
      choices === undefined ? undefined : requireObject('choices', choices),
    ] as const;

  function fingerprinted(landed: FoldCrimpTuckLanded): FoldCrimpTuckFingerprinted {
    return { ...landed, fingerprint: foldStateFingerprint({ keys: engine.canonical_keys(landed.state) }) };
  }

  /** Either family's answer, its landed states fingerprinted; each call names its own family's. */
  function tried(answer: unknown): FoldCrimpTuckOutcome {
    const outcome = answer as FoldEngineOutcome<FoldCrimpTuckTried>;
    if (outcome.status !== 'ok') return outcome;
    switch (outcome.outcome) {
      case 'landed':
        return { ...outcome, ...fingerprinted(outcome) };
      case 'choose_order':
        return { ...outcome, candidates: outcome.candidates.map(fingerprinted) };
      case 'choose_opening':
        return outcome;
    }
  }

  return {
    crimp(state, op, choices) {
      return tried(engine.crimp(...args(state, op, choices))) as FoldCrimpTuckOutcome<'crimp'>;
    },

    tuck(state, op, choices) {
      return tried(engine.tuck(...args(state, op, choices))) as FoldCrimpTuckOutcome<'tuck'>;
    },
  };
}
