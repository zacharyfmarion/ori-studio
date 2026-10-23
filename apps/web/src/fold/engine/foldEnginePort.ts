/**
 * The Fold engine as a document replay drives it: `fold/document/foldReplay`'s
 * {@link FoldEnginePort}, implemented over the bridge's calls. The document
 * declares the port and its outcomes; this adapts the bridge to them, the
 * document's paper, ops and choices crossing to the engine unchanged.
 *
 * **Handles carry their engine's generation.** A worker that is terminated
 * (to stop work) or crashes takes every state it held with it, and the one
 * spawned after it numbers its states from 1 again. A handle is therefore
 * `{ generation, id }`: a step from a handle of an older generation rejects
 * as `fold_state_lost` instead of folding some other state that happens to
 * share its number, and releasing one is a no-op. The replayer's owner hears
 * the loss (`onFoldSequenceClientLost`), clears the replayer and replays.
 *
 * Pure: no React, no store, no wasm.
 */

import type { WasmErrorEnvelope } from '../../engine/types';
import type { FoldStateFingerprint } from '../document/foldDigest';
import type { FoldEngineOutcome, FoldEnginePort } from '../document/foldReplay';
import type { FoldChoices, FoldPaper } from '../document/foldSequenceDocument';
import { foldCapOf } from '../foldCaps';
import type {
  FoldEngineOp,
  FoldEngineOutcome as FoldEngineAnswer,
  FoldSheetLanded,
  FoldStepFingerprinted,
} from './foldEngineWire';

/** A landed state, named for the engine that holds it. */
export interface FoldEngineStateHandle {
  readonly generation: number;
  readonly id: number;
}

/** Where the engine runs: the worker's client, or the wasm in-process (tests). */
export interface FoldEngineSource {
  /** The engine instance now answering; it changes whenever the old one and its states are gone. */
  generation(): number;
  sheet(paper: FoldPaper): Promise<FoldEngineAnswer<FoldSheetLanded>>;
  step(state: number, op: FoldEngineOp, choices?: FoldChoices): Promise<FoldEngineAnswer<FoldStepFingerprinted>>;
  returnTo?(current: number, target: number, history: readonly number[]): Promise<FoldEngineAnswer<FoldStepFingerprinted>>;
  release(states: readonly number[]): Promise<unknown>;
}

/** A step was asked of a state its engine no longer holds. */
export function foldStateLostError(handle: FoldEngineStateHandle): WasmErrorEnvelope {
  return {
    code: 'fold_state_lost',
    message: `state ${handle.id} belonged to engine ${handle.generation}, which has since stopped`,
  };
}

/**
 * A stored value the bridge cannot take, as a refusal of the node that holds
 * it. The port hands the document's paper and steps over unchanged, so an
 * `invalid_input` from one is the file's — a value the reader accepted and
 * the bridge does not — and the replay marks that node broken and goes on
 * with its siblings, as for any refusal. Every other error is thrown on.
 */
async function refusingInvalidInput<T>(
  answer: () => Promise<FoldEngineOutcome<T>>
): Promise<FoldEngineOutcome<T>> {
  try {
    return await answer();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'invalid_input') {
      return { landed: false, code: 'invalid_input' };
    }
    throw error;
  }
}

/** A refusal as replay keeps it: its code, and the counts of one over a cap. */
function refusedOutcome(refusal: { readonly code: string }): FoldEngineOutcome<never> {
  const cap = foldCapOf(refusal);
  return { landed: false, code: refusal.code, ...(cap ? { cap } : {}) };
}

/**
 * The port over `source`. Releases are batched: every handle released in one
 * turn of the event loop goes to the engine in one call, which is what a
 * cache trim of a hundred states needs.
 */
export function createFoldEnginePort(
  source: FoldEngineSource,
  engineVersion: number
): FoldEnginePort<FoldEngineStateHandle> {
  let releasing: { generation: number; ids: number[] } | null = null;

  const flush = () => {
    const batch = releasing;
    releasing = null;
    // An engine that stopped since took these with it.
    if (!batch || batch.generation !== source.generation()) return;
    // Nothing waits on a release, and a failed one leaves only memory held
    // in an engine that is being replaced anyway.
    source.release(batch.ids).catch(() => undefined);
  };

  const landing = <T extends { state: number; fingerprint: FoldStateFingerprint }>(
    answer: FoldEngineAnswer<T>,
    generation: number
  ): FoldEngineOutcome<FoldEngineStateHandle> =>
    answer.status === 'ok'
      ? { landed: true, state: { generation, id: answer.state }, fingerprint: answer.fingerprint }
      : refusedOutcome(answer.refusal);

  return {
    engineVersion,

    sheet(paper) {
      const generation = source.generation();
      return refusingInvalidInput(async () => landing(await source.sheet(paper), generation));
    },

    async step(parent, { op, choices }) {
      const generation = source.generation();
      if (parent.generation !== generation) throw foldStateLostError(parent);
      return refusingInvalidInput(async () => landing(await source.step(parent.id, op, choices), generation));
    },

    async returnTo(parent, target, history) {
      const generation = source.generation();
      for (const handle of [parent, target, ...history]) {
        if (handle.generation !== generation) throw foldStateLostError(handle);
      }
      if (!source.returnTo) return { landed: false, code: 'return_unavailable' };
      return refusingInvalidInput(async () => landing(await source.returnTo!(parent.id, target.id, history.map((s) => s.id)), generation));
    },

    release(state) {
      if (state.generation !== source.generation()) return;
      if (releasing?.generation !== state.generation) {
        // A batch of an older generation is stale: its engine is gone.
        releasing = { generation: state.generation, ids: [] };
        queueMicrotask(flush);
      }
      releasing.ids.push(state.id);
    },
  };
}
