/**
 * The engine as the Fold session hands it to replay: the bridge's port
 * (`createFoldEnginePort`), with two things only the session knows.
 *
 * - **Details.** The engine answers every landed step with its summary and
 *   what it did; the port keeps only the handle and the fingerprint, which is
 *   all replay needs. The surfaces need the rest — the counts, the crease
 *   diff, "Layers" — so it is kept here, beside the handle, from the answer
 *   that came anyway, and dropped when the handle is released.
 * - **Adoption.** A tool previews a step, and the user commits it: the state
 *   is already in the engine. The replay the commit causes asks the port for
 *   that step from that parent, and gets the preview's state back instead of
 *   folding it again — the commit is free, and the state on screen is the one
 *   the user saw. A state nobody adopts by the end of the next replay is
 *   released.
 *
 * Pure: no React, no store, no worker of its own.
 */

import { canonicalJson, type FoldStateFingerprint } from '../document/foldDigest';
import { normalizeFoldLandingOp } from '../document/foldLandingMigration';
import type { FoldEngineOutcome, FoldEnginePort } from '../document/foldReplay';
import type { FoldChoices, FoldOp } from '../document/foldSequenceDocument';
import {
  createFoldEnginePort,
  type FoldEngineSource,
  type FoldEngineStateHandle,
} from '../engine/foldEnginePort';
import type { FoldEngineOp } from '../engine/foldEngineWire';
import { foldStateDetailsOf, type FoldStateDetails } from './foldSessionState';

/** A step as replay asks for it, or a tool previews it. */
export interface FoldEngineStepInput {
  op: FoldOp | FoldEngineOp;
  choices?: FoldChoices;
}

/** A state a tool landed, ready to stand for a step once it is committed. */
export interface FoldAdoptedState {
  state: FoldEngineStateHandle;
  fingerprint: FoldStateFingerprint;
  details: FoldStateDetails;
}

export interface FoldSessionEngine {
  /** What replay drives. */
  readonly port: FoldEnginePort<FoldEngineStateHandle>;
  /** What the engine said of a state the session holds. */
  details(state: FoldEngineStateHandle): FoldStateDetails | undefined;
  /**
   * Let the next replay of `step` from `parent` take `landed` rather than ask
   * the engine. `ticket` is the newest replay started when the step was
   * committed: a replay started after it adopts the state, or it is released
   * when one finishes without ({@link releaseUnadopted}). Its details are
   * known from now on. Returns a withdrawal that releases it at once, for a
   * commit that did not happen.
   */
  adopt(parent: FoldEngineStateHandle, step: FoldEngineStepInput, landed: FoldAdoptedState, ticket: number): () => void;
  /** Release the states offered before replay `ticket` started that it did not take. */
  releaseUnadopted(ticket: number): void;
  /** Release a state the session landed itself — a preview — through the port's batch. */
  release(state: FoldEngineStateHandle): void;
  /** Forget everything without releasing it: the engine that held it is gone. */
  clear(): void;
}

/**
 * Which step this is: its op and choices, canonical. A tool's request and the
 * step it commits, read back from the document, spell one key, so a commit
 * finds the preview it came from.
 */
export function foldStepInputKey({ op, choices }: FoldEngineStepInput): string {
  return canonicalJson({ op: normalizeFoldLandingOp(op), choices });
}

/** Which step from which parent. */
function adoptionKey(parent: FoldEngineStateHandle, step: FoldEngineStepInput): string {
  return `${parent.generation}:${parent.id}:${foldStepInputKey(step)}`;
}

const handleKey = (state: FoldEngineStateHandle) => `${state.generation}:${state.id}`;

export function createFoldSessionEngine(source: FoldEngineSource, engineVersion: number): FoldSessionEngine {
  const details = new Map<string, FoldStateDetails>();
  const adoptions = new Map<string, { landed: FoldAdoptedState; ticket: number }>();

  // The bridge's answers carry the summary and reports — a compound fold's of
  // any family; keep them before the port reduces each to its handle. The
  // generation is read where the port reads it, before the call, so both
  // name the same engine.
  const keeping: FoldEngineSource = {
    generation: () => source.generation(),
    async sheet(paper) {
      const generation = source.generation();
      const answer = await source.sheet(paper);
      if (answer.status === 'ok') {
        details.set(
          handleKey({ generation, id: answer.state }),
          foldStateDetailsOf({ summary: answer.summary, report: null })
        );
      }
      return answer;
    },
    async step(state, op, choices) {
      const generation = source.generation();
      const answer = await source.step(state, op, choices);
      if (answer.status === 'ok') details.set(handleKey({ generation, id: answer.state }), foldStateDetailsOf(answer));
      return answer;
    },
    ...(source.returnTo ? { async returnTo(current: number, target: number, history: readonly number[]) {
      const generation = source.generation();
      const answer = await source.returnTo!(current, target, history);
      if (answer.status === 'ok') details.set(handleKey({ generation, id: answer.state }), foldStateDetailsOf(answer));
      return answer;
    } } : {}),
    release: (states) => source.release(states),
  };
  const inner = createFoldEnginePort(keeping, engineVersion);

  const release = (state: FoldEngineStateHandle) => {
    details.delete(handleKey(state));
    inner.release?.(state);
  };

  const port: FoldEnginePort<FoldEngineStateHandle> = {
    engineVersion: inner.engineVersion,
    sheet: (paper) => inner.sheet(paper),
    step(parent, step) {
      const key = adoptionKey(parent, step);
      const offered = adoptions.get(key);
      if (!offered) return inner.step(parent, step);
      adoptions.delete(key);
      const { state, fingerprint, details: known } = offered.landed;
      details.set(handleKey(state), known);
      const adopted: FoldEngineOutcome<FoldEngineStateHandle> = { landed: true, state, fingerprint };
      return Promise.resolve(adopted);
    },
    returnTo(parent, target, history, step) {
      const key = adoptionKey(parent, step);
      const offered = adoptions.get(key);
      if (!offered) return inner.returnTo!(parent, target, history, step);
      adoptions.delete(key);
      const { state, fingerprint, details: known } = offered.landed;
      details.set(handleKey(state), known);
      return Promise.resolve({ landed: true, state, fingerprint });
    },
    release,
  };

  return {
    port,

    details: (state) => details.get(handleKey(state)),

    adopt(parent, step, landed, ticket) {
      const key = adoptionKey(parent, step);
      const replaced = adoptions.get(key);
      adoptions.set(key, { landed, ticket });
      // Known now, for a step shown at this state before the replay adopts it.
      details.set(handleKey(landed.state), landed.details);
      if (replaced && replaced.landed.state !== landed.state) release(replaced.landed.state);
      return () => {
        if (adoptions.get(key)?.landed !== landed) return;
        adoptions.delete(key);
        release(landed.state);
      };
    },

    releaseUnadopted(ticket) {
      for (const [key, offered] of adoptions) {
        if (offered.ticket >= ticket) continue;
        adoptions.delete(key);
        release(offered.landed.state);
      }
    },

    release,

    clear() {
      details.clear();
      adoptions.clear();
    },
  };
}
