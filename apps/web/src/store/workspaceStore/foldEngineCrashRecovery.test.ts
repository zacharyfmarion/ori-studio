/**
 * A Fold engine that traps, end to end: the worker module (`foldSequenceWorker`)
 * over a mocked bridge, the runtime that owns its worker, and the session
 * that replays into it — everything but comlink's postMessage and the wasm.
 *
 * The mocked bridge behaves as the real one does (see
 * `foldSequenceWorker.wasm.test.ts`): a call that traps throws a
 * `WebAssembly.RuntimeError`, and every call on that instance after it throws
 * wasm-bindgen's "recursive use of an object detected". What has to hold:
 * the dead instance is never asked again, a fresh worker replays the
 * sequence, the crash reaches Sentry once and analytics with what came of it,
 * and a step or a query that traps every time stops after the restart limit
 * with the sequence untouched and the user told what to do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WasmErrorEnvelope } from '../../engine/types';
import { initialFoldReaderState, withFoldCursor } from '../../fold/document/foldReaderState';
import { sequenceOf, step, valleyAt } from '../../fold/document/foldSequence.fixtures';
import type { FoldPaper, FoldSequenceDocument } from '../../fold/document/foldSequenceDocument';
import type { FoldEngineOp } from '../../fold/engine/foldEngineWire';
import {
  createFoldSession,
  FOLD_ENGINE_KEPT_STOPPING,
  MAX_RESTARTS,
  type FoldEngineRestart,
  type FoldSession,
} from '../../fold/session/foldSession';
import { foldOpLabel, memoryFoldDocument } from '../../fold/session/foldSession.fixtures';
import { selectFoldCursorNode } from '../../fold/session/foldSessionState';
import {
  askFoldSequenceClient,
  createFoldPreviewChannel,
  foldSequenceClientGeneration,
  foldSequenceEngineSource,
  onFoldSequenceClientLost,
  releaseFoldSequenceClient,
  retainFoldSequenceClient,
} from './foldSequenceRuntime';

type Api = Record<string, (...args: unknown[]) => Promise<unknown>>;

const harness = vi.hoisted(() => ({
  /** Workers whose module has yet to expose its api, in spawn order. */
  starting: [] as ((api: Record<string, (...args: unknown[]) => Promise<unknown>>) => void)[],
  /** Each wasm `FoldEngine` the mocked bridge made: the calls that reached it after it trapped, which must be none. */
  engines: [] as { afterTrap: string[] }[],
  /** What a call throws, by its name and arguments and the engine's index; undefined to answer. */
  trap: (() => undefined) as (call: string, args: unknown[], engine: number) => unknown,
  reportError: vi.fn(),
}));

vi.mock('../../monitoring', () => ({ reportError: harness.reportError }));

vi.mock('comlink', () => ({
  expose: (api: Api) => harness.starting.shift()?.(api),
  // The worker's api, asked over a pretend postMessage: arguments cross as copies.
  wrap: (worker: { call(name: string, args: unknown[]): Promise<unknown> }) =>
    new Proxy(
      {},
      { get: (_target, name) => (name === 'then' ? undefined : (...args: unknown[]) => worker.call(String(name), args)) }
    ),
}));

vi.mock('../../generated/oristudio-fold-wasm/oristudio_fold_wasm', async () => {
  const { fakeFoldEngine } = await import('../../fold/session/foldSession.fixtures');
  const RECURSIVE_USE = 'recursive use of an object detected which would lead to unsafe aliasing in rust';

  /** The wasm class's surface over the session tests' fake engine. */
  class FoldEngine {
    private readonly calls = fakeFoldEngine();
    private readonly index: number;
    private readonly record = { afterTrap: [] as string[] };
    private poisoned = false;

    constructor() {
      this.index = harness.engines.push(this.record) - 1;
    }

    private run<T>(name: string, args: unknown[], body: () => T): T {
      if (this.poisoned) {
        this.record.afterTrap.push(name);
        throw new Error(RECURSIVE_USE);
      }
      const thrown = harness.trap(name, args, this.index);
      if (thrown !== undefined) {
        // Rust ran no destructors on the way out: the borrow stays taken.
        this.poisoned = true;
        throw thrown;
      }
      return body();
    }

    sheet(paper: FoldPaper) {
      return this.run('sheet', [paper], () => this.calls.sheet(paper));
    }
    apply(state: number, op: FoldEngineOp, choices: unknown) {
      return this.run('apply', [state, op, choices], () => this.calls.apply(state, op));
    }
    canonical_keys(state: number) {
      return this.run('canonical_keys', [state], () =>
        (this.calls.trail(state) ?? []).map((label, k) => `${k}:${label}`)
      );
    }
    summary(state: number) {
      return this.run('summary', [state], () => this.calls.summary(state));
    }
    scene(state: number) {
      return this.run('scene', [state], () => ({ state, faces: [] }));
    }
    release(states: Uint32Array) {
      return this.run('release', [states], () => this.calls.release([...states]));
    }
    clear() {
      return this.run('clear', [], () => this.calls.clear());
    }
    live() {
      return this.run('live', [], () => this.calls.live());
    }
  }

  return { default: async () => {}, FoldEngine, fold_engine_version: () => 1 };
});

/** A worker with a module of its own, answering by calling its api, as comlink would. */
class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  terminated = false;
  private readonly api: Promise<Api>;

  constructor() {
    super();
    FakeWorker.instances.push(this);
    this.api = new Promise((resolve) => harness.starting.push(resolve));
    vi.resetModules();
    void import('../../workers/foldSequenceWorker');
  }

  async call(name: string, args: unknown[]): Promise<unknown> {
    const api = await this.api;
    // A terminated worker answers nothing.
    if (this.terminated) return new Promise(() => {});
    return api[name]!(...structuredClone(args));
  }

  terminate() {
    this.terminated = true;
  }

  postMessage() {}
}

/** sheet → a → b, and a → c: the reader on c. */
function branching(): FoldSequenceDocument {
  return sequenceOf([step('a', null, valleyAt(0.5)), step('b', 'a', valleyAt(0.25)), step('c', 'a', valleyAt(0.75))]);
}

const trapsOn =
  (call: string, label?: string, onEngine?: number) =>
  (name: string, args: unknown[], engine: number) =>
    name === call &&
    (label === undefined || foldOpLabel(args[1] as FoldEngineOp) === label) &&
    (onEngine === undefined || engine === onEngine)
      ? new WebAssembly.RuntimeError('unreachable')
      : undefined;

let sessions: FoldSession[] = [];

beforeEach(() => {
  FakeWorker.instances = [];
  harness.starting = [];
  harness.engines = [];
  harness.trap = () => undefined;
  harness.reportError.mockReset();
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const session of sessions) session.dispose();
  sessions = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(document: FoldSequenceDocument = branching(), cursor = 'c') {
  let next = 0;
  const source = memoryFoldDocument(
    { held: { document, readOnlyRaw: null }, reader: withFoldCursor(initialFoldReaderState(document.id), document, cursor) },
    (prefix) => `${prefix}-${(next += 1)}`
  );
  const toasts: WasmErrorEnvelope[] = [];
  const crashes: FoldEngineRestart[] = [];
  // The app's runtime (`store/workspaceStore/foldSession.ts`).
  const session = createFoldSession({
    document: source,
    runtime: {
      retain: () => {
        retainFoldSequenceClient();
      },
      release: releaseFoldSequenceClient,
      generation: foldSequenceClientGeneration,
      onLost: onFoldSequenceClientLost,
      ask: askFoldSequenceClient,
      createChannel: createFoldPreviewChannel,
      source: foldSequenceEngineSource,
    },
    reportError: (error) => toasts.push(error),
    onEngineCrash: (restart) => crashes.push(restart),
  });
  sessions.push(session);
  const snapshot = () => session.store.getState();
  const statuses = () => Object.fromEntries([...snapshot().nodes].map(([id, node]) => [id, node.status]));
  return { session, source, toasts, crashes, snapshot, statuses };
}

/** Let the workers start and the replays run. */
async function settle(rounds = 20): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const sentryReports = () =>
  harness.reportError.mock.calls.map(([error, context]) => [(error as Error).message, context]);

describe('a Fold engine that traps', () => {
  it('is replaced by a fresh worker, which replays the sequence; the crash is reported once', async () => {
    // Folding c traps the first engine; the dead instance would answer "recursive use" from then on.
    harness.trap = trapsOn('apply', 'valley@0.75', 0);
    const { session, source, toasts, crashes, snapshot, statuses } = setup();
    const held = source.read().held;
    const release = session.retain();
    await vi.waitFor(() => expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' }));

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[0]!.terminated).toBe(true);
    expect(harness.engines[0]!.afterTrap).toEqual([]);
    expect(selectFoldCursorNode(snapshot()).state?.generation).toBe(1);
    expect(sentryReports()).toEqual([['wasm_trap: unreachable', { surface: 'fold:engine', tags: { reason: 'wasm_trap' } }]]);
    expect(crashes).toEqual([{ cause: 'wasm_trap', attempt: 1, outcome: 'recovered' }]);
    // Recovered without a word, and nothing of the document changed.
    expect(toasts).toEqual([]);
    expect(snapshot().error).toBeNull();
    expect(source.read().held).toBe(held);
    release();
  });

  it('names an instance already broken, answering "recursive use", as poisoned', async () => {
    harness.trap = (name, _args, engine) =>
      name === 'apply' && engine === 0
        ? new Error('recursive use of an object detected which would lead to unsafe aliasing in rust')
        : undefined;
    const { session, crashes, statuses } = setup();
    session.retain();
    await vi.waitFor(() => expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' }));
    expect(crashes).toEqual([{ cause: 'engine_poisoned', attempt: 1, outcome: 'recovered' }]);
    expect(sentryReports()).toEqual([
      [
        'engine_poisoned: recursive use of an object detected which would lead to unsafe aliasing in rust',
        { surface: 'fold:engine', tags: { reason: 'engine_poisoned' } },
      ],
    ]);
  });

  it('stops after the restart limit when the same step traps on every replay, and a change lets it try again', async () => {
    harness.trap = trapsOn('apply', 'valley@0.75');
    const { session, source, toasts, crashes, snapshot, statuses } = setup();
    const held = source.read().held;
    session.retain();
    await vi.waitFor(() => expect(snapshot().error).toBe(FOLD_ENGINE_KEPT_STOPPING));
    await settle();

    // The first worker and MAX_RESTARTS more; none since.
    expect(FakeWorker.instances).toHaveLength(MAX_RESTARTS + 1);
    expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(true);
    expect(harness.engines.every((engine) => engine.afterTrap.length === 0)).toBe(true);
    expect(statuses()).toEqual({ a: 'pending', b: 'pending', c: 'pending' });
    // Each crash reported once; the user told once, with what to do.
    expect(harness.reportError).toHaveBeenCalledTimes(MAX_RESTARTS + 1);
    expect(toasts).toEqual([FOLD_ENGINE_KEPT_STOPPING]);
    expect(crashes).toEqual([
      { cause: 'wasm_trap', attempt: 1, outcome: 'crashed_again' },
      { cause: 'wasm_trap', attempt: 2, outcome: 'crashed_again' },
      { cause: 'wasm_trap', attempt: 3, outcome: 'gave_up' },
    ]);
    // The sequence is the user's, untouched: nothing was committed or dropped.
    expect(source.read().held).toBe(held);

    // Undoing the step that traps is a change: one more try, which lands.
    const undone = sequenceOf([step('a', null, valleyAt(0.5)), step('b', 'a', valleyAt(0.25))]);
    source.set({
      held: { document: undone, readOnlyRaw: null },
      reader: withFoldCursor(initialFoldReaderState(undone.id), undone, 'b'),
    });
    await vi.waitFor(() => expect(statuses()).toEqual({ a: 'ok', b: 'ok' }));
    expect(snapshot().error).toBeNull();
    expect(FakeWorker.instances).toHaveLength(MAX_RESTARTS + 2);
  });

  it('stops after the restart limit when a query traps each time the replay lands', async () => {
    harness.trap = trapsOn('scene');
    const { session, crashes, snapshot, statuses } = setup();
    session.retain();
    // A surface asks the step on screen for its scene whenever it has a state.
    for (let ask = 0; ask < MAX_RESTARTS + 3 && !snapshot().error; ask += 1) {
      await vi.waitFor(() => expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' }));
      await expect(session.withCursor((worker, state) => worker.scene(state))).resolves.toEqual({
        status: 'unavailable',
        reason: 'no-state',
      });
      await settle();
    }

    expect(snapshot().error).toBe(FOLD_ENGINE_KEPT_STOPPING);
    expect(FakeWorker.instances).toHaveLength(MAX_RESTARTS + 1);
    expect(crashes.map(({ attempt, outcome }) => [attempt, outcome])).toEqual([
      [1, 'recovered'],
      [2, 'recovered'],
      [3, 'gave_up'],
    ]);
    // Halted: the next ask finds no state and starts nothing.
    await expect(session.withCursor((worker, state) => worker.scene(state))).resolves.toMatchObject({
      status: 'unavailable',
    });
    await settle();
    expect(FakeWorker.instances).toHaveLength(MAX_RESTARTS + 1);
  });
});
