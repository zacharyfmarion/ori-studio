/**
 * The Fold session's linger: once the last surface lets go, the engine and
 * every state it landed are kept for a while, so a surface that comes back —
 * Fold after a visit to the Diagram — shows the step on screen at once and
 * asks the engine nothing. An edit made meanwhile is replayed on the way back,
 * asking only for what it changed; a load, a lost engine or the end of the
 * linger let the engine go as the last release did before.
 *
 * Timers are faked; `flush` lets the session's own tasks (a message channel)
 * and promise reactions run on the real clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialFoldReaderState, withFoldCursor, type FoldReaderState } from '../document/foldReaderState';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import { setFoldStepNote } from '../document/foldSequenceEdits';
import type { FoldSequenceDocument } from '../document/foldSequenceDocument';
import { createFoldSession, type FoldEngineRestart, type FoldSession } from './foldSession';
import { fakeFoldEngine, inProcessFoldRuntime, memoryFoldDocument, type FakeFoldEngine } from './foldSession.fixtures';
import { selectFoldCursorNode } from './foldSessionState';

const LINGER = 60_000;

/** The clock the fake timers leave alone, for the session's own tasks. */
const realTimeout = globalThis.setTimeout;

async function flush(rounds = 5): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => realTimeout(resolve, 0));
  }
}

/** sheet → a → b, and a → c: the reader on c. */
function branching(): FoldSequenceDocument {
  return sequenceOf([step('a', null, valleyAt(0.5)), step('b', 'a', valleyAt(0.25)), step('c', 'a', valleyAt(0.75))]);
}

function readerOn(document: FoldSequenceDocument, cursor: string | null): FoldReaderState {
  return withFoldCursor(initialFoldReaderState(document.id), document, cursor);
}

let sessions: FoldSession[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  for (const session of sessions) session.dispose();
  sessions = [];
  vi.useRealTimers();
});

function setup({ linger = LINGER, document = branching() }: { linger?: number; document?: FoldSequenceDocument } = {}) {
  const engines: FakeFoldEngine[] = [];
  const cancelled: number[] = [];
  const runtime = inProcessFoldRuntime(() => {
    const made = Object.assign(fakeFoldEngine(), { cancelSearch: (id: number) => void cancelled.push(id) });
    engines.push(made);
    return made;
  });
  const source = memoryFoldDocument({ held: { document, readOnlyRaw: null }, reader: readerOn(document, 'c') });
  const crashes: FoldEngineRestart[] = [];
  const session = createFoldSession({ document: source, runtime, linger, onEngineCrash: (restart) => crashes.push(restart) });
  sessions.push(session);
  const snapshot = () => session.store.getState();
  return {
    session,
    runtime,
    source,
    crashes,
    cancelled,
    snapshot,
    engines,
    engine: () => engines[engines.length - 1],
    statuses: () => Object.fromEntries([...snapshot().nodes].map(([id, node]) => [id, node.status])),
    cursor: () => selectFoldCursorNode(snapshot()),
  };
}

/** Held, replayed, and let go: lingering, with every state landed. */
async function leftAfterReplay(options?: Parameters<typeof setup>[0]) {
  const harness = setup(options);
  const release = harness.session.retain();
  await flush();
  expect(harness.statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
  release();
  await flush();
  return harness;
}

describe('the Fold session: lingering', () => {
  it('keeps the engine and every state, so a surface back within it shows the step at once and asks nothing', async () => {
    const { session, runtime, engine, snapshot, statuses, cursor } = await leftAfterReplay();
    const replayed = [...engine().log];
    const shown = cursor().state;

    // Let go: no surface, but the engine and its four states (the sheet, a, b, c) are kept.
    expect(snapshot().live).toBe(false);
    expect(runtime.holders()).toBe(1);
    expect(engine().live()).toBe(4);
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' });

    await vi.advanceTimersByTimeAsync(LINGER - 1000);
    const replaying: boolean[] = [];
    session.store.subscribe((next) => replaying.push(next.progress.replaying));
    session.retain();
    // At once: the step on screen is the state it was, before anything runs.
    expect(snapshot().live).toBe(true);
    expect(cursor()).toMatchObject({ status: 'ok', state: shown });
    await flush();
    // Nothing was asked of the engine, nor replayed, and it is the same engine.
    expect(engine().log).toEqual(replayed);
    expect(replaying).not.toContain(true);
    expect(snapshot().progress).toMatchObject({ replaying: false, done: true, settled: 3 });
    expect(runtime.generation()).toBe(0);

    // The linger was cancelled by the hold: long after it would have run out, nothing stopped.
    await vi.advanceTimersByTimeAsync(LINGER * 2);
    expect(runtime.holders()).toBe(1);
    expect(cursor().state).toEqual(shown);
  });

  it('answers a query on a kept state before the hold comes back, so a surface remounting is answered', async () => {
    const { session, cursor } = await leftAfterReplay();
    const state = cursor().state!;
    const summary = await session.withState(state, (worker, at) => worker.summary(at));
    expect(summary).toMatchObject({ status: 'answered', value: { step: 2 } });
    // Folding still needs a surface.
    await expect(session.preview(valleyAt(0.9))).resolves.toEqual({ status: 'unavailable', reason: 'not-live' });
  });

  it('lets the engine go once the linger runs out, and the next hold replays into a fresh one', async () => {
    const { session, runtime, engines, statuses, crashes } = await leftAfterReplay();

    await vi.advanceTimersByTimeAsync(LINGER);
    expect(runtime.holders()).toBe(0);
    expect(runtime.generation()).toBe(1);
    expect(statuses()).toEqual({ a: 'pending', b: 'pending', c: 'pending' });

    session.retain();
    await flush();
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
    expect(engines.at(-1)!.log).toEqual(['sheet', 'step:valley@0.5', 'step:valley@0.75', 'step:valley@0.25']);
    expect(crashes).toEqual([]);
  });

  it('lets the engine go at once when the sequences are replaced', async () => {
    const { runtime, source, statuses } = await leftAfterReplay();
    const other = sequenceOf([step('x', null, valleyAt(0.3))], undefined, 'fold-b');
    source.set({ loadId: 2, held: { document: other, readOnlyRaw: null }, reader: readerOn(other, 'x') });
    expect(runtime.holders()).toBe(0);
    expect(runtime.generation()).toBe(1);
    expect(statuses()).toEqual({ x: 'pending' });
  });

  it('replays only what an edit made while it lingered changed, and never shows a stale state meanwhile', async () => {
    const { session, source, engine, statuses, cursor } = await leftAfterReplay();
    const before = engine().log.length;
    const shownBefore = cursor().state;

    // c folded another way, in place (as a refresh or an undo of one does), and a note on b.
    const edited = {
      ...branching(),
      steps: [step('a', null, valleyAt(0.5)), step('b', 'a', valleyAt(0.25)), step('c', 'a', valleyAt(0.6))],
    };
    source.set({ held: { document: setFoldStepNote(edited, 'b', 'Crease firmly.'), readOnlyRaw: null } });
    await flush();
    // Nothing runs while it lingers; the step the edit changed shows no state until it is replayed.
    expect(engine().log).toHaveLength(before);
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'pending' });

    session.retain();
    await flush();
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
    expect(engine().log.slice(before)).toEqual(['step:valley@0.6']);
    expect(cursor().state).not.toEqual(shownBefore);
  });

  it('stops the replay under way when the last surface goes, and finishes it from there when one comes back', async () => {
    const { session, runtime, engine, statuses } = setup();
    const release = session.retain();
    // The engine's version is asked at once; the replay's first call, the sheet, waits.
    runtime.hold();
    await flush();
    expect(session.store.getState().progress.replaying).toBe(true);
    release();
    // The calls asked before the release answer; nothing more is asked.
    const opened = runtime.open();
    for (let round = 0; round < 25; round += 1) await vi.advanceTimersByTimeAsync(1);
    await opened;
    await flush();
    expect(engine().log).toEqual(['sheet']);
    expect(runtime.holders()).toBe(1);

    session.retain();
    await flush();
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
    // The sheet came from the cache: only the steps were asked.
    expect(engine().log).toEqual(['sheet', 'step:valley@0.5', 'step:valley@0.75', 'step:valley@0.25']);
  });

  it('lets the engine go when it is lost while lingering, and starts afresh at the next hold', async () => {
    const { session, runtime, crashes, statuses, engines } = await leftAfterReplay();
    runtime.lose('crashed', 'unexpected_error');
    await flush();
    // No surface to restart it for: it is let go, and nothing is counted.
    expect(runtime.holders()).toBe(0);
    expect(crashes).toEqual([]);
    expect(statuses()).toEqual({ a: 'pending', b: 'pending', c: 'pending' });

    session.retain();
    await flush();
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
    expect(engines.at(-1)!.log[0]).toBe('sheet');
    expect(session.store.getState().error).toBeNull();
  });

  it('sends a search’s cancel to the kept engine, so nothing is left running', async () => {
    const { session, cancelled } = await leftAfterReplay();
    session.cancelSearch({ id: 12 });
    await flush();
    expect(cancelled).toEqual([12]);
  });

  it('lets go of everything when disposed while lingering', async () => {
    const { session, runtime } = await leftAfterReplay();
    session.dispose();
    expect(runtime.holders()).toBe(0);
    await vi.advanceTimersByTimeAsync(LINGER);
    expect(runtime.holders()).toBe(0);
  });

  it('stops at once with no linger, as the last release always did', async () => {
    const { runtime, statuses } = await leftAfterReplay({ linger: 0 });
    expect(runtime.holders()).toBe(0);
    expect(statuses()).toEqual({ a: 'pending', b: 'pending', c: 'pending' });
  });
});
