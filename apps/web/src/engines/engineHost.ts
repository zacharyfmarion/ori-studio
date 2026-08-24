import { wrap, type Remote } from 'comlink';
import { createOristudioCpNativeClient } from '../engine/oristudioCpNativeClient';
import { attachWorkerDiagnostics, type WorkerFailure } from '../lib/workerDiagnostics';
import { surfaceSupports } from '../platform/capabilities';
import { installFoldCancellation } from '../lib/foldCancellation';
import type { OristudioBpWorkerApi } from '../workers/oristudioBpWorker';
import type { OristudioCpWorkerApi } from '../workers/oristudioCpWorker';
import type { TreemakerWorkerApi } from '../workers/treemakerWorker';

/**
 * One owner for the app's long-lived engine clients.
 *
 * Every engine module used to carry the same three lines — a module-level
 * `worker`, a module-level `client`, and a `getX()` that spawns on first use —
 * and none of them could answer "is this engine still alive?". A worker that
 * dies leaves comlink calls pending forever (see `workerDiagnostics`), and
 * nothing respawned it, because no module owned the question.
 *
 * That was survivable while each engine held exactly one document. With N design
 * documents sharing one worker, a crash has to park *every* document on that
 * engine — which the document registry can only do if something reports the
 * loss. This is that something.
 *
 * ## Scope
 *
 * Only the three **persistent** engines that hold documents. Deliberately absent:
 *
 * - `oristudio-bp-optimizer` — spawned per run and terminated in a `finally`,
 *   so its lifetime is a function call, not a session. Modelling it here would
 *   make `connect`/`reset` mean two different things.
 * - `simulator` and `cp-detect` — services rather than document stores, and
 *   outside the blast radius of the design-tabs work. Adding them later is one
 *   table entry each.
 */
export interface EngineClients {
  treemaker: Remote<TreemakerWorkerApi>;
  'oristudio-cp': Remote<OristudioCpWorkerApi>;
  'oristudio-bp': Remote<OristudioBpWorkerApi>;
}

export type EngineId = keyof EngineClients;

export const ENGINE_IDS: readonly EngineId[] = ['treemaker', 'oristudio-cp', 'oristudio-bp'];

/**
 * How an engine produces a client, and whether that client is backed by a worker
 * this host can terminate.
 *
 * The `new Worker(new URL(...))` calls are written out literally rather than
 * built from the id, because that is the form the bundler statically analyses to
 * emit the worker chunk. A table of thunks keeps them literal.
 */
type Connection<E extends EngineId> =
  | { worker: Worker; client: EngineClients[E] }
  /** Desktop CP runs natively through Tauri commands — no worker to own. */
  | { worker: null; client: EngineClients[E] };

const CONNECTORS: { [E in EngineId]: () => Connection<E> } = {
  treemaker: () => {
    const worker = new Worker(new URL('../workers/treemakerWorker.ts', import.meta.url), {
      type: 'module',
    });
    return { worker, client: wrap<TreemakerWorkerApi>(worker) };
  },
  'oristudio-cp': () => {
    if (surfaceSupports('nativeCpEngine')) {
      // Native Rust engine via Tauri commands (no wasm worker). The native
      // client implements the same OristudioCpWorkerApi surface.
      const client = createOristudioCpNativeClient() as unknown as Remote<OristudioCpWorkerApi>;
      // The native path has no buffer to install, but its cancel flag outlives
      // this webview's run-id counter — so cancellation is prepared on both
      // branches, not just the one with a worker.
      installFoldCancellation(client);
      return { worker: null, client };
    }
    const worker = new Worker(new URL('../workers/oristudioCpWorker.ts', import.meta.url), {
      type: 'module',
    });
    const client = wrap<OristudioCpWorkerApi>(worker);
    // Here rather than at a fold call site: this runs exactly once per live
    // client and so also on the respawn after a crash, which is the case where a
    // fold-time install would silently leave Stop dead with its button enabled.
    installFoldCancellation(client);
    return { worker, client };
  },
  'oristudio-bp': () => {
    const worker = new Worker(new URL('../workers/oristudioBpWorker.ts', import.meta.url), {
      type: 'module',
    });
    return { worker, client: wrap<OristudioBpWorkerApi>(worker) };
  },
};

interface LiveEngine {
  worker: Worker | null;
  client: unknown;
  detachDiagnostics: () => void;
}

const live = new Map<EngineId, LiveEngine>();

export interface EngineLoss {
  engine: EngineId;
  /** Absent when the engine was reset deliberately rather than lost. */
  failure?: WorkerFailure;
}

type LossListener = (loss: EngineLoss) => void;

const lossListeners = new Set<LossListener>();

/**
 * Observe an engine going away — crashed, or reset deliberately.
 *
 * The document registry uses this to park every document on that engine: their
 * serialized text is still valid, only the handles are gone. Listeners must not
 * throw; one that does is isolated so the rest still hear about the loss.
 */
export function onEngineLost(listener: LossListener): () => void {
  lossListeners.add(listener);
  return () => lossListeners.delete(listener);
}

function announceLoss(loss: EngineLoss): void {
  for (const listener of [...lossListeners]) {
    try {
      listener(loss);
    } catch (error) {
      console.error('[ori-studio] engine loss listener failed', error);
    }
  }
}

function drop(id: EngineId): LiveEngine | null {
  const engine = live.get(id);
  if (!engine) return null;
  live.delete(id);
  engine.detachDiagnostics();
  return engine;
}

/**
 * The client for an engine, spawning it on first use.
 *
 * Memoized per engine, so this stays the cheap call every engine module already
 * assumed it was making.
 */
export async function connectEngine<E extends EngineId>(id: E): Promise<EngineClients[E]> {
  const existing = live.get(id);
  if (existing) return existing.client as EngineClients[E];

  const connection = CONNECTORS[id]();
  const detachDiagnostics = connection.worker
    ? attachWorkerDiagnostics(connection.worker, id, (failure) => {
        // The client is dead: every further call on it would hang. Drop it so the
        // next `connectEngine` spawns a replacement, and tell the registry its
        // handles are gone.
        if (live.get(id)?.worker === connection.worker) {
          drop(id);
          announceLoss({ engine: id, failure });
        }
      })
    : () => undefined;

  live.set(id, { worker: connection.worker, client: connection.client, detachDiagnostics });
  return connection.client;
}

/**
 * Terminate an engine and forget its client. The next {@link connectEngine}
 * spawns a fresh one.
 *
 * Every handle that engine held is invalid afterwards, so this announces a loss
 * exactly as a crash does — callers should not have to distinguish "the worker
 * died" from "we killed it" when deciding what happened to their documents.
 */
export function resetEngine(id: EngineId): void {
  const engine = drop(id);
  if (!engine) return;
  engine.worker?.terminate();
  announceLoss({ engine: id });
}

/** Whether an engine currently has a live client. Diagnostics and tests. */
export function isEngineConnected(id: EngineId): boolean {
  return live.has(id);
}

/**
 * Tear down every engine. For tests, and for a full-app reset; production code
 * should reset the one engine it means to.
 */
export function resetAllEngines(): void {
  for (const id of [...live.keys()]) resetEngine(id);
}
