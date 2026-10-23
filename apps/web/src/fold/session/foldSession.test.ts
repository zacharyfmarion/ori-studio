/**
 * The Fold session over a fake engine and a document in memory: replay
 * follows the document and asks the engine only for what is new; a run for a
 * replaced document reports nothing; states are released once nothing needs
 * them; a lost engine takes every handle with it and the sequence is
 * replayed; the step a tool folds is previewed latest-wins and committed
 * without folding it twice.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WasmErrorEnvelope } from '../../engine/types';
import { initialFoldReaderState, withFoldCursor, type FoldReaderState } from '../document/foldReaderState';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import { setFoldStartSide, setFoldStepNote } from '../document/foldSequenceEdits';
import type { FoldSequenceDocument } from '../document/foldSequenceDocument';
import type { FoldStateSummary } from '../engine/foldEngineWire';
import {
  createFoldSession,
  FOLD_ENGINE_KEPT_STOPPING,
  MAX_RESTARTS,
  type FoldEngineRestart,
  type FoldSession,
  type FoldStateCall,
} from './foldSession';
import {
  fakeFoldEngine,
  foldOpLabel,
  inProcessFoldRuntime,
  memoryFoldDocument,
  settle,
  type FakeFoldEngine,
  type FakeFoldEngineOptions,
} from './foldSession.fixtures';
import { selectFoldCursorNode, type FoldSessionSnapshot } from './foldSessionState';

/** sheet → a → b, and a → c: the reader on c. */
function branching(): FoldSequenceDocument {
  return sequenceOf([step('a', null, valleyAt(0.5)), step('b', 'a', valleyAt(0.25)), step('c', 'a', valleyAt(0.75))]);
}

function readerOn(document: FoldSequenceDocument, cursor: string | null): FoldReaderState {
  return withFoldCursor(initialFoldReaderState(document.id), document, cursor);
}

let sessions: FoldSession[] = [];

afterEach(() => {
  for (const session of sessions) session.dispose();
  sessions = [];
});

function setup({
  document = branching(),
  cursor = 'c',
  engine = {},
  capacity,
}: {
  document?: FoldSequenceDocument | null;
  cursor?: string | null;
  engine?: FakeFoldEngineOptions;
  capacity?: number;
} = {}) {
  const engines: FakeFoldEngine[] = [];
  const runtime = inProcessFoldRuntime(() => {
    const made = fakeFoldEngine(engine);
    engines.push(made);
    return made;
  });
  let next = 0;
  const source = memoryFoldDocument(
    { held: document && { document, readOnlyRaw: null }, reader: document && readerOn(document, cursor) },
    (prefix) => `${prefix}-${(next += 1)}`
  );
  const reported: WasmErrorEnvelope[] = [];
  const crashes: FoldEngineRestart[] = [];
  const session = createFoldSession({
    document: source,
    runtime,
    reportError: (error) => reported.push(error),
    onEngineCrash: (restart) => crashes.push(restart),
    capacity,
  });
  sessions.push(session);
  const snapshot = () => session.store.getState();
  return {
    session,
    runtime,
    source,
    reported,
    crashes,
    snapshot,
    /** The engine answering now. */
    engine: () => engines[engines.length - 1],
    engines,
    statuses: () => Object.fromEntries([...snapshot().nodes].map(([id, node]) => [id, node.status])),
    cursor: () => selectFoldCursorNode(snapshot()),
  };
}

describe('the Fold session: replay', () => {
  it('replays nothing until a surface holds it, then the active path first, reporting progress', async () => {
    const { session, engine, snapshot, statuses, cursor, runtime } = setup();
    await settle();
    expect(engine().log).toEqual([]);
    expect(snapshot()).toMatchObject({ live: false, cursor: 'c', activePath: ['a', 'c'], readOnly: false });
    expect(statuses()).toEqual({ a: 'pending', b: 'pending', c: 'pending' });

    const seen: FoldSessionSnapshot['progress'][] = [];
    session.store.subscribe((state) => seen.push(state.progress));
    session.retain();
    expect(runtime.holders()).toBe(1);
    await settle();

    expect(engine().log).toEqual(['sheet', 'step:valley@0.5', 'step:valley@0.75', 'step:valley@0.25']);
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
    // The active path settled before the branch nobody is looking at.
    const activeDone = seen.findIndex((progress) => progress.activeSettled === 2);
    expect(seen[activeDone]).toMatchObject({ activeTotal: 2, settled: 2, total: 3, done: false });
    expect(snapshot().progress).toEqual({
      replaying: false,
      activeSettled: 2,
      activeTotal: 2,
      settled: 3,
      total: 3,
      done: true,
    });
    // The step on screen: its handle, fingerprint and what the engine said of it.
    expect(cursor()).toMatchObject({ status: 'ok', state: { generation: 0 }, summary: { step: 2 } });
    expect(cursor().report).not.toBeNull();
    expect(cursor().fingerprint).toMatch(/^fs1:/);
    expect(snapshot().sheet).toMatchObject({ status: 'ok', report: null, summary: { step: 0 } });
  });

  it('shows the flat square before the first edit, ready to fold', async () => {
    const { session, snapshot, engine } = setup({ document: null });
    session.retain();
    await settle();
    expect(snapshot()).toMatchObject({
      sequence: null,
      cursor: null,
      activePath: [],
      paper: { shape: { kind: 'square' } },
    });
    expect(snapshot().sheet.status).toBe('ok');
    expect(engine().log).toEqual(['sheet']);
  });

  it('replays after every change, asking the engine only for what is new', async () => {
    const { session, source, engine, statuses, snapshot } = setup();
    session.retain();
    await settle();
    const log = engine().log;
    const before = snapshot().nodes.get('b');
    log.length = 0;

    // A note: outside fh1, so nothing to fold, and nothing on screen changes.
    const noted = setFoldStepNote(branching(), 'b', 'Fold the flap down.');
    source.set({ held: { document: noted, readOnlyRaw: null } });
    await settle();
    expect(log).toEqual([]);
    expect(snapshot().nodes.get('b')).toBe(before);

    // A new step: only it is folded.
    const added = { ...noted, steps: [...noted.steps, step('d', 'b', valleyAt(0.1))] };
    source.set({ held: { document: added, readOnlyRaw: null } });
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok', d: 'pending' });
    await settle();
    expect(log).toEqual(['step:valley@0.1']);
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok', d: 'ok' });

    // Deleting it and bringing it back (undo, redo) folds nothing.
    source.set({ held: { document: noted, readOnlyRaw: null } });
    await settle();
    source.set({ held: { document: added, readOnlyRaw: null } });
    await settle();
    expect(log).toEqual(['step:valley@0.1']);
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok', d: 'ok' });
  });

  it('drops a run for a document since replaced, by its load id', async () => {
    const { session, source, runtime, snapshot, statuses, engine } = setup();
    session.retain();
    await settle();
    const published: FoldSessionSnapshot[] = [];
    session.store.subscribe((state) => published.push(state));

    // A step is folding for the first load when a second replaces it.
    runtime.hold();
    const document = branching();
    const added = { ...document, steps: [...document.steps, step('d', 'c', valleyAt(0.1))] };
    source.set({ held: { document: added, readOnlyRaw: null } });
    await settle();
    expect(snapshot().progress).toMatchObject({ replaying: true, settled: 3, total: 4 });
    const other = sequenceOf([step('x', null, valleyAt(0.4))], undefined, 'fold-b');
    source.set({ loadId: 2, held: { document: other, readOnlyRaw: null }, reader: readerOn(other, 'x') });
    await runtime.open();

    expect(snapshot()).toMatchObject({ loadId: 2, cursor: 'x' });
    expect(statuses()).toEqual({ x: 'ok' });
    // The first load's step was folded, late, and never shown.
    expect(engine().log).toContain('step:valley@0.1');
    expect(published.some((state) => state.nodes.get('d')?.status === 'ok')).toBe(false);
  });

  it('holds no step at the old side once the start side changes, so nothing is folded from it', async () => {
    const { session, source, runtime, snapshot, statuses, cursor, engine } = setup({
      document: sequenceOf([step('a', null, valleyAt(0.5))]),
      cursor: 'a',
    });
    session.retain();
    await settle();
    expect(cursor()).toMatchObject({ status: 'ok' });

    // The start side changes while the engine is busy: every step keeps its id, and none its path.
    runtime.hold();
    const turned = setFoldStartSide(snapshot().sequence!, 'back');
    source.set({ held: { document: turned, readOnlyRaw: null } });
    expect(statuses()).toEqual({ a: 'pending' });
    expect(cursor().state).toBeNull();
    const committing = session.commitStep(valleyAt(0.25));
    await runtime.open();

    await expect(committing).resolves.toMatchObject({ status: 'committed' });
    await settle();
    // The second step folded from the first as it lands on the back, and was committed at that.
    expect(Object.values(statuses())).toEqual(['ok', 'ok']);
    const second = engine().trail(cursor().state!.id);
    expect(second).toEqual(['sheet:square:back', 'valley@0.5', 'valley@0.25']);
  });

  it('marks a step broken, with the refusal, and what folds from it', async () => {
    const { session, statuses, snapshot } = setup({
      engine: { refuse: (op) => (foldOpLabel(op) === 'valley@0.5' ? 'near_miss' : null) },
    });
    session.retain();
    await settle();
    expect(statuses()).toEqual({ a: 'broken', b: 'broken', c: 'broken' });
    expect(snapshot().nodes.get('c')?.refusal).toEqual({ at: 'a', code: 'near_miss' });
    expect(snapshot().progress.done).toBe(true);
  });

  it('marks a stored step the bridge cannot read broken, and replays its siblings', async () => {
    const { session, snapshot, reported, statuses } = setup({
      engine: {
        fail: (op) => (foldOpLabel(op) === 'valley@0.25' ? { code: 'invalid_input', message: 'expected usize' } : null),
      },
    });
    session.retain();
    await settle();
    expect(statuses()).toEqual({ a: 'ok', b: 'broken', c: 'ok' });
    expect(snapshot().nodes.get('b')?.refusal).toEqual({ at: 'b', code: 'invalid_input' });
    expect(snapshot().error).toBeNull();
    expect(reported).toEqual([]);
  });

  it('reports a replay that fails for any other reason, and replays again on a retry', async () => {
    let failing = true;
    const failure = { code: 'oristudio_fold_wasm_error', message: 'unreachable' };
    const { session, snapshot, reported, statuses } = setup({
      engine: { fail: () => (failing ? failure : null) },
    });
    session.retain();
    await settle();
    expect(snapshot().error).toEqual(failure);
    expect(reported).toEqual([snapshot().error]);
    expect(snapshot().progress.replaying).toBe(false);

    failing = false;
    session.retry();
    await settle();
    expect(snapshot().error).toBeNull();
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
  });
});

describe('the Fold session: handles', () => {
  it('releases the states the cache no longer keeps, and every state once the last surface lets go', async () => {
    const { session, source, engine, runtime } = setup({ capacity: 0 });
    // Another holder keeps the engine up, so the session's releases reach it.
    runtime.retain();
    const release = session.retain();
    await settle();
    expect(engine().live()).toBe(4);

    // Delete b: its state is no longer on screen, and the cache keeps nothing more.
    const document = branching();
    const without = { ...document, steps: document.steps.filter((node) => node.id !== 'b') };
    source.set({ held: { document: without, readOnlyRaw: null } });
    await settle();
    expect(engine().live()).toBe(3);

    release();
    await settle();
    expect(runtime.holders()).toBe(1);
    expect(engine().live()).toBe(0);
  });

  it('forgets every handle when the engine is lost, and replays into the next one', async () => {
    const { session, runtime, snapshot, statuses, cursor } = setup();
    session.retain();
    await settle();
    const fingerprint = cursor().fingerprint;
    await session.preview(valleyAt(0.9));
    expect(snapshot().pending.status).toBe('landed');

    runtime.lose('crashed');
    // At once: no handle of the lost engine is left on screen.
    expect(statuses()).toEqual({ a: 'pending', b: 'pending', c: 'pending' });
    expect(snapshot().pending.status).toBe('idle');

    await settle();
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
    expect(cursor()).toMatchObject({ state: { generation: 1 }, fingerprint });

    // A stop to end work is a loss too; letting go of the last reference is not replayed.
    runtime.lose('stopped');
    await settle();
    expect(cursor().state?.generation).toBe(2);
  });

  it('stops replaying into an engine that keeps crashing, until a retry or the next change', async () => {
    const { session, runtime, snapshot, source, statuses, engine, reported, crashes } = setup();
    session.retain();
    await settle();
    const held = source.read().held;
    for (let crash = 0; crash <= MAX_RESTARTS; crash += 1) runtime.lose('crashed', 'wasm_trap');
    await settle();
    expect(snapshot().error).toBe(FOLD_ENGINE_KEPT_STOPPING);
    expect(engine().log).toEqual([]);
    expect(statuses()).toEqual({ a: 'pending', b: 'pending', c: 'pending' });
    // Told once, with what to do; each crash counted with what came of its restart.
    expect(reported).toEqual([FOLD_ENGINE_KEPT_STOPPING]);
    expect(crashes).toEqual([
      { cause: 'wasm_trap', attempt: 1, outcome: 'crashed_again' },
      { cause: 'wasm_trap', attempt: 2, outcome: 'crashed_again' },
      { cause: 'wasm_trap', attempt: 3, outcome: 'gave_up' },
    ]);
    // The document is the user's: nothing was written to it.
    expect(source.read().held).toBe(held);

    // A change is worth one more try.
    source.set({ held: { document: setFoldStepNote(branching(), 'a', 'Again.'), readOnlyRaw: null } });
    await settle();
    expect(snapshot().error).toBeNull();
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
    // One: the count stays until a change finds the engine sound.
    runtime.lose('crashed', 'wasm_trap');
    await settle();
    expect(snapshot().error).toBe(FOLD_ENGINE_KEPT_STOPPING);
    expect(crashes.at(-1)).toEqual({ cause: 'wasm_trap', attempt: 4, outcome: 'gave_up' });

    session.retry();
    await settle();
    expect(snapshot().error).toBeNull();
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
  });

  it('says a restart recovered once the replay after it finishes', async () => {
    const { session, runtime, statuses, crashes, reported } = setup();
    session.retain();
    await settle();
    runtime.lose('crashed', 'engine_poisoned');
    expect(crashes).toEqual([]);
    await settle();
    expect(statuses()).toEqual({ a: 'ok', b: 'ok', c: 'ok' });
    expect(crashes).toEqual([{ cause: 'engine_poisoned', attempt: 1, outcome: 'recovered' }]);
    // Recovered on its own: no toast.
    expect(reported).toEqual([]);
    // A stop or a release is no crash.
    runtime.lose('stopped');
    await settle();
    expect(crashes).toHaveLength(1);
  });

  it('gives up on a crash that comes back after every replay, as a query asked again would bring it', async () => {
    const { session, runtime, snapshot, statuses, crashes, engines } = setup();
    session.retain();
    await settle();
    // Each replay finishes, then the same query crashes the engine again.
    for (let crash = 0; crash <= MAX_RESTARTS + 2; crash += 1) {
      runtime.lose('crashed', 'wasm_trap');
      await settle();
    }
    expect(snapshot().error).toBe(FOLD_ENGINE_KEPT_STOPPING);
    expect(statuses()).toEqual({ a: 'pending', b: 'pending', c: 'pending' });
    expect(crashes.map(({ attempt, outcome }) => [attempt, outcome])).toEqual([
      [1, 'recovered'],
      [2, 'recovered'],
      [3, 'gave_up'],
      [4, 'gave_up'],
      [5, 'gave_up'],
    ]);
    // Only the restarts asked an engine for anything: none after the third crash.
    expect(engines.filter((made) => made.log.length > 0)).toHaveLength(MAX_RESTARTS + 1);
  });

  it('ends a run of crashes when the document changes, and counts a crash under way as left when the surface goes', async () => {
    const { session, runtime, snapshot, source, crashes } = setup();
    const release = session.retain();
    await settle();
    runtime.lose('crashed', 'unexpected_error');
    runtime.lose('crashed', 'unexpected_error');
    await settle();
    source.set({ held: { document: setFoldStepNote(branching(), 'a', 'Moved on.'), readOnlyRaw: null } });
    await settle();
    // Two more in a row from here are within the limit again.
    runtime.lose('crashed', 'unexpected_error');
    runtime.lose('crashed', 'unexpected_error');
    expect(snapshot().error).toBeNull();
    release();
    expect(crashes.map(({ attempt, outcome }) => [attempt, outcome])).toEqual([
      [1, 'crashed_again'],
      [2, 'recovered'],
      [1, 'crashed_again'],
      [2, 'left'],
    ]);
  });

  it('answers a query on any landed state, and a handle that outlived its engine is unavailable', async () => {
    const { session, runtime, cursor, engine } = setup();
    session.retain();
    await settle();
    const summary = await session.withCursor((worker, state) => worker.summary(state));
    expect(summary).toEqual({ status: 'answered', value: cursor().summary });
    await expect(session.withNode('missing', (worker, state) => worker.summary(state))).resolves.toEqual({
      status: 'unavailable',
      reason: 'no-state',
    });

    const old = cursor().state!;
    runtime.lose('crashed');
    await expect(session.withState(old, (worker, state) => worker.summary(state))).resolves.toMatchObject({
      status: 'unavailable',
    });
    await settle();

    // A state released behind the session's back is landed again.
    const now = cursor().state!;
    engine().release([now.id]);
    await expect(session.withState(now, (worker, state) => worker.summary(state))).resolves.toMatchObject({
      status: 'unavailable',
    });
    await settle();
    expect(cursor().status).toBe('ok');
    await expect(session.withCursor((worker, state) => worker.summary(state))).resolves.toMatchObject({
      status: 'answered',
    });
  });
});

describe('the Fold session: the step a tool folds', () => {
  it('previews from the step on screen, latest request wins, releasing what it supersedes', async () => {
    const { session, snapshot, engine } = setup();
    session.retain();
    await settle();
    const held = engine().live();

    const first = session.preview(valleyAt(0.8));
    const second = session.preview(valleyAt(0.9));
    expect(snapshot().pending).toMatchObject({ status: 'working', request: { op: valleyAt(0.9) } });
    await expect(first).resolves.toEqual({ status: 'superseded' });
    const landed = await second;
    expect(landed).toMatchObject({ status: 'landed', summary: { step: 3 } });
    expect(snapshot().pending).toBe(landed);
    await settle();
    // The superseded preview's state is let go; the one on screen is held.
    expect(engine().live()).toBe(held + 1);

    session.cancel();
    await settle();
    expect(snapshot().pending.status).toBe('idle');
    expect(engine().live()).toBe(held);
  });

  it('refuses with the engine’s fixes, and analyses without folding', async () => {
    const { session, snapshot } = setup({
      engine: { refuse: (op) => (op.kind === 'mountain' ? 'nothing_stays' : null) },
    });
    session.retain();
    await settle();
    const refused = await session.preview({ ...valleyAt(0.9), kind: 'mountain' });
    expect(refused).toMatchObject({
      status: 'refused',
      refused: { refusal: { code: 'nothing_stays' }, fixes: [{ fix: 'opposite_direction' }] },
    });
    expect(snapshot().pending).toBe(refused);

    const analysed = await session.analyse(valleyAt(0.9));
    expect(analysed).toMatchObject({ status: 'analysed', analysis: { picked: [0] } });
    expect(snapshot().analysis).toBe(analysed);
  });

  it('asks the engine once per line from a state, until the state is gone', async () => {
    const { session, source, runtime, engine } = setup();
    session.retain();
    await settle();
    const first = await session.analyse(valleyAt(0.9));
    await session.analyse(valleyAt(0.8));
    // Back on the first line, and back on this step after leaving it: answered from memory.
    await expect(session.analyse(valleyAt(0.9))).resolves.toBe(first);
    source.set({ reader: readerOn(branching(), 'b') });
    source.set({ reader: readerOn(branching(), 'c') });
    await expect(session.analyse(valleyAt(0.9))).resolves.toBe(first);
    expect(engine().log.filter((call) => call.startsWith('analyse'))).toEqual([
      'analyse:valley@0.9',
      'analyse:valley@0.8',
    ]);

    runtime.lose('crashed');
    await settle();
    await expect(session.analyse(valleyAt(0.9))).resolves.toMatchObject({ status: 'analysed' });
    expect(engine().log.filter((call) => call.startsWith('analyse'))).toEqual(['analyse:valley@0.9']);
  });

  it('lets the pending step go when the cursor moves', async () => {
    const { session, source, snapshot, engine } = setup();
    session.retain();
    await settle();
    const held = engine().live();
    await session.preview(valleyAt(0.9));
    await session.analyse(valleyAt(0.9));
    source.set({ reader: readerOn(branching(), 'b') });
    expect(snapshot().pending.status).toBe('idle');
    expect(snapshot().analysis.status).toBe('idle');
    await settle();
    expect(engine().live()).toBe(held);
  });

  it('commits the preview on screen without folding it again, expecting its fingerprint', async () => {
    const { session, source, snapshot, engine, cursor, statuses } = setup();
    session.retain();
    await settle();
    const preview = await session.preview(valleyAt(0.9));
    if (preview.status !== 'landed') throw new Error(preview.status);
    engine().log.length = 0;

    const committed = await session.commitStep(valleyAt(0.9));
    if (committed.status !== 'committed') throw new Error(committed.status);
    expect(source.commits).toEqual([{ parent: 'c', op: valleyAt(0.9), expect: committed.fingerprint }]);
    expect(snapshot().pending.status).toBe('idle');
    await settle();

    // Fingerprinted as the preview landed, never folded again: the commit asked
    // the engine nothing, and the replay adopted the preview's state.
    expect(engine().log).toEqual([]);
    expect(snapshot().cursor).toBe(committed.stepId);
    expect(cursor()).toMatchObject({ status: 'ok', state: preview.state, fingerprint: committed.fingerprint });
    expect(cursor().summary).toBe(preview.summary);
    expect(statuses()[committed.stepId]).toBe('ok');
  });

  it('publishes a commit on its own, the replay it causes waiting for a task of its own', async () => {
    const { session, snapshot } = setup();
    session.retain();
    await settle();
    const preview = await session.preview(valleyAt(0.9));
    if (preview.status !== 'landed') throw new Error(preview.status);
    await settle();
    const published: FoldSessionSnapshot[] = [];
    session.store.subscribe((state) => published.push(state));
    const committed = await session.commitStep(valleyAt(0.9));
    if (committed.status !== 'committed') throw new Error(committed.status);
    // Every microtask the commit queued has run: only the commit is published, so it is painted first.
    for (let k = 0; k < 10; k += 1) await Promise.resolve();
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ cursor: committed.stepId, pending: { status: 'idle' } });
    await settle();
    expect(published.length).toBeGreaterThan(1);
    expect(snapshot().progress).toBe(published.at(-1)?.progress);
  });

  it('keeps the preview on screen while it commits, then shows the step at its state at once', async () => {
    const { session, runtime, snapshot, cursor, engine } = setup();
    session.retain();
    await settle();
    // The fingerprint asked as the preview landed did not come: the commit asks it again.
    const { fingerprint } = engine();
    engine().fingerprint = () => {
      throw { code: 'busy', message: 'not now' };
    };
    const preview = await session.preview(valleyAt(0.9));
    if (preview.status !== 'landed') throw new Error(preview.status);
    await settle();
    engine().fingerprint = fingerprint;

    // The fingerprint is on its way: what the folder saw stays up.
    runtime.hold();
    const committing = session.commitStep(valleyAt(0.9));
    await settle();
    expect(snapshot()).toMatchObject({ cursor: 'c', pending: { status: 'landed', state: preview.state } });

    // Committed: the step is on screen at the preview's state in the same publish
    // that moves the cursor, before the replay the commit causes has run.
    const published: FoldSessionSnapshot[] = [];
    session.store.subscribe((state) => published.push(state));
    await runtime.open();
    const committed = await committing;
    if (committed.status !== 'committed') throw new Error(committed.status);
    const moved = published.filter((state) => state.cursor === committed.stepId);
    expect(moved.length).toBeGreaterThan(0);
    for (const state of moved) {
      expect(selectFoldCursorNode(state)).toMatchObject({ status: 'ok', state: preview.state, summary: preview.summary });
    }
    expect(cursor()).toMatchObject({ status: 'ok', state: preview.state, fingerprint: committed.fingerprint });
  });

  it('answers a pure query once per state for every asker, and the committed step with its preview’s answers', async () => {
    const { session, engine, cursor } = setup();
    session.retain();
    await settle();
    const summaryOf: FoldStateCall<FoldStateSummary> = (worker, state) => worker.summary(state);
    const preview = await session.preview(valleyAt(0.9));
    if (preview.status !== 'landed') throw new Error(preview.status);
    engine().log.length = 0;

    const [first, second] = await Promise.all([
      session.query(preview.state, summaryOf),
      session.query(preview.state, summaryOf),
    ]);
    expect(first).toEqual(second);
    expect(session.peek(preview.state, summaryOf)).toEqual({ value: preview.summary });

    const committed = await session.commitStep(valleyAt(0.9));
    if (committed.status !== 'committed') throw new Error(committed.status);
    await settle();
    await expect(session.query(cursor().state!, summaryOf)).resolves.toEqual({
      status: 'answered',
      value: preview.summary,
    });
    // One summary for three asks; the commit asked nothing (the preview's fingerprint was in).
    expect(engine().log).toEqual(['summary']);
  });

  it('folds a step it has no preview for, and committing where a step follows makes a branch', async () => {
    const { session, source, snapshot, engine, cursor } = setup({ cursor: 'a' });
    session.retain();
    await settle();
    engine().log.length = 0;
    const committed = await session.commitStep(valleyAt(0.6));
    if (committed.status !== 'committed') throw new Error(committed.status);
    await settle();
    // Folded with its fingerprint, in one call.
    expect(engine().log).toEqual(['step:valley@0.6']);
    expect(source.commits[0]).toMatchObject({ parent: 'a' });
    // a now has three children; the active path runs through the new one.
    expect(snapshot().activePath).toEqual(['a', committed.stepId]);
    expect(cursor()).toMatchObject({ status: 'ok', fingerprint: committed.fingerprint });
  });

  it('folds from a step a commit just made, once the replay lands it', async () => {
    const { session, source, runtime, cursor, engine } = setup();
    session.retain();
    await settle();

    // A step committed, its replay not landed yet: a preview waits for it.
    runtime.hold();
    const d = source.commit({ parent: 'c', op: valleyAt(0.9) }, 1);
    await settle();
    expect(cursor().status).toBe('pending');
    const preview = session.preview(valleyAt(0.92));
    await runtime.open();
    const landed = await preview;
    if (landed.status !== 'landed') throw new Error(landed.status);
    expect(landed.parent).toBe(cursor().state);

    // And so does a commit.
    runtime.hold();
    const e = source.commit({ parent: d, op: valleyAt(0.93) }, 1);
    await settle();
    const committing = session.commitStep(valleyAt(0.95));
    await runtime.open();
    const committed = await committing;
    if (committed.status !== 'committed') throw new Error(committed.status);
    expect(source.commits.at(-1)).toMatchObject({ parent: e });
    await settle();
    expect(engine().trail(cursor().state!.id)?.slice(-3)).toEqual(['valley@0.9', 'valley@0.93', 'valley@0.95']);
  });

  it('commits nothing that is refused, read-only, stale or already under way', async () => {
    const { session, source, snapshot, engine } = setup({
      engine: { refuse: (op) => (op.kind === 'mountain' ? 'nothing_stays' : null) },
    });
    session.retain();
    await settle();
    await expect(session.commitStep({ ...valleyAt(0.9), kind: 'mountain' })).resolves.toMatchObject({
      status: 'refused',
      refused: { refusal: { code: 'nothing_stays' } },
    });
    expect(snapshot().pending.status).toBe('refused');

    const twice = [session.commitStep(valleyAt(0.9)), session.commitStep(valleyAt(0.9))];
    await expect(twice[1]).resolves.toEqual({ status: 'unavailable', reason: 'busy' });
    await expect(twice[0]).resolves.toMatchObject({ status: 'committed' });
    await settle();

    // The document replaced while the step folded: nothing is committed, and its state is let go.
    const held = engine().live();
    const stale = session.commitStep(valleyAt(0.95));
    source.set({ loadId: 2 });
    await expect(stale).resolves.toEqual({ status: 'stale' });
    await settle();
    expect(engine().live()).toBe(held);
    expect(source.commits).toHaveLength(1);

    source.set({ held: { document: branching(), readOnlyRaw: { formatVersion: 2 } } });
    await settle();
    expect(snapshot().readOnly).toBe(true);
    await expect(session.commitStep(valleyAt(0.9))).resolves.toEqual({ status: 'unavailable', reason: 'read-only' });
  });

  it('says a commit the crash took with it failed, and nothing for a deliberate stop', async () => {
    const { session, runtime, reported } = setup();
    session.retain();
    await settle();
    runtime.hold();
    const crashed = session.commitStep(valleyAt(0.9));
    // The step is in the engine when it goes.
    await settle();
    runtime.lose('crashed');
    await expect(crashed).resolves.toMatchObject({ status: 'failed', error: { code: 'fold_sequence_client_lost' } });
    expect(reported.map((error) => error.code)).toEqual(['fold_sequence_client_lost']);
    await runtime.open();

    runtime.hold();
    const stopped = session.commitStep(valleyAt(0.9));
    await settle();
    runtime.lose('stopped');
    await expect(stopped).resolves.toMatchObject({ status: 'failed' });
    expect(reported).toHaveLength(1);
    await runtime.open();
  });

  it('folds nothing while no surface holds it', async () => {
    const { session, engine } = setup();
    await expect(session.preview(valleyAt(0.9))).resolves.toEqual({ status: 'unavailable', reason: 'not-live' });
    await expect(session.analyse(valleyAt(0.9))).resolves.toEqual({ status: 'unavailable', reason: 'not-live' });
    await expect(session.commitStep(valleyAt(0.9))).resolves.toEqual({ status: 'unavailable', reason: 'not-live' });
    expect(engine().log).toEqual([]);
  });
});

describe('the Fold session: searches', () => {
  it('sends a search’s cancel to the engine it runs on, and nothing while no surface holds it', async () => {
    const cancelled: number[] = [];
    const document = branching();
    const runtime = inProcessFoldRuntime(() => Object.assign(fakeFoldEngine(), { cancelSearch: (id: number) => void cancelled.push(id) }));
    const session = createFoldSession({
      document: memoryFoldDocument({ held: { document, readOnlyRaw: null }, reader: readerOn(document, 'c') }),
      runtime,
    });
    sessions.push(session);
    session.cancelSearch({ id: 7 });
    await settle();
    expect(cancelled).toEqual([]);
    session.retain();
    await settle();
    session.cancelSearch({ id: 8 });
    await settle();
    expect(cancelled).toEqual([8]);
  });

  it('takes an engine that has no searches to cancel as nothing to stop', async () => {
    const { session } = setup();
    session.retain();
    await settle();
    expect(() => session.cancelSearch({ id: 9 })).not.toThrow();
    await settle();
  });
});
