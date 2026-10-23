/**
 * The Fold session over the workspace store's Fold slice: a commit goes
 * through the slice and the replay that follows shows it; undo, redo and
 * delete reconcile the reader and fold nothing again; a branch, a note, the
 * paper and a load each replay what they must and no more.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { valleyAt } from '../../fold/document/foldSequence.fixtures';
import { createFoldSequence, rectangleShape } from '../../fold/document/foldSequenceDocument';
import { createFoldSession, type FoldSession } from '../../fold/session/foldSession';
import {
  fakeFoldEngine,
  inProcessFoldRuntime,
  settle,
  type FakeFoldEngine,
} from '../../fold/session/foldSession.fixtures';
import { selectFoldCursorNode } from '../../fold/session/foldSessionState';
import { foldSessionDocumentSource } from './foldSession';
import { useWorkspaceStore } from './store';

const state = () => useWorkspaceStore.getState();
const shown = () => state().foldSequences[0]!.document;

let session: FoldSession;
let engine: FakeFoldEngine;
let runtime: ReturnType<typeof inProcessFoldRuntime>;

const snapshot = () => session.store.getState();
const statuses = () => Object.fromEntries([...snapshot().nodes].map(([id, node]) => [id, node.status]));

async function commit(y: number): Promise<string> {
  const committed = await session.commitStep(valleyAt(y));
  if (committed.status !== 'committed') throw new Error(`not committed: ${committed.status}`);
  await settle();
  return committed.stepId;
}

beforeEach(async () => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  runtime = inProcessFoldRuntime(() => (engine = fakeFoldEngine()));
  session = createFoldSession({ document: foldSessionDocumentSource(useWorkspaceStore), runtime });
  session.retain();
  await settle();
});

afterEach(() => {
  session.dispose();
});

describe('the Fold session over the store', () => {
  it('commits through the slice, with the state it landed expected, and shows it once replayed', async () => {
    expect(snapshot()).toMatchObject({ sequence: null, cursor: null });
    expect(snapshot().sheet.status).toBe('ok');

    const committed = await session.commitStep(valleyAt(0.5));
    if (committed.status !== 'committed') throw new Error(committed.status);
    expect(shown().steps).toEqual([
      { id: committed.stepId, parent: null, op: valleyAt(0.5), expect: committed.fingerprint },
    ]);
    expect(state().foldReader?.cursor).toBe(committed.stepId);
    expect(state().foldHistory.past.map((entry) => entry.label)).toEqual(['Valley fold']);
    expect(state().dirty).toBe(true);

    await settle();
    expect(snapshot()).toMatchObject({ cursor: committed.stepId, activePath: [committed.stepId] });
    expect(selectFoldCursorNode(snapshot())).toMatchObject({ status: 'ok', fingerprint: committed.fingerprint });
    expect(snapshot().progress.done).toBe(true);
  });

  it('reconciles the reader on undo, redo and delete, and folds nothing again', async () => {
    const a = await commit(0.5);
    const b = await commit(0.25);
    engine.log.length = 0;

    expect(state().undoFold()).toBe(true);
    // The cursor's step is gone: it moves to its nearest surviving ancestor.
    expect(snapshot().cursor).toBe(a);
    expect(statuses()).toEqual({ [a]: 'ok' });
    await settle();
    expect(selectFoldCursorNode(snapshot()).status).toBe('ok');

    expect(state().redoFold()).toBe(true);
    // A redo moves the cursor to the step it restores.
    expect(snapshot().cursor).toBe(b);
    await settle();
    expect(statuses()).toEqual({ [a]: 'ok', [b]: 'ok' });

    expect(state().deleteFoldStep(a)).toBe(true);
    expect(snapshot()).toMatchObject({ cursor: null, activePath: [] });
    expect(snapshot().nodes.size).toBe(0);
    await settle();
    expect(snapshot().sheet.status).toBe('ok');

    expect(state().undoFold()).toBe(true);
    await settle();
    expect(statuses()).toEqual({ [a]: 'ok', [b]: 'ok' });
    expect(engine.log).toEqual([]);
  });

  it('makes a branch when a step is committed where one already follows', async () => {
    const a = await commit(0.5);
    const b = await commit(0.25);
    expect(state().moveFoldCursor(a)).toBe(true);
    expect(snapshot().cursor).toBe(a);

    const c = await commit(0.75);
    expect(shown().steps.map((node) => [node.id, node.parent])).toEqual([
      [a, null],
      [b, a],
      [c, a],
    ]);
    expect(snapshot().activePath).toEqual([a, c]);
    expect(statuses()).toEqual({ [a]: 'ok', [b]: 'ok', [c]: 'ok' });
  });

  it('replays a spread for free, and a new sheet from scratch', async () => {
    const a = await commit(0.5);
    engine.log.length = 0;
    const before = snapshot().nodes.get(a);

    // Fold starts every step with no spread: turning one on is the change, and needs no fold.
    expect(state().setFoldStepSpread(a, { kind: 'depth', amount: 0.05, toward: 'down' })).toBe(true);
    await settle();
    expect(engine.log).toEqual([]);
    expect(snapshot().nodes.get(a)).toBe(before);

    // Changing the paper empties the steps; the new sheet is folded.
    expect(state().setFoldPaperShape(rectangleShape(2, 1)!)).toBe(true);
    expect(snapshot().nodes.size).toBe(0);
    await settle();
    expect(engine.log).toEqual(['sheet']);
    expect(snapshot()).toMatchObject({ paper: { shape: { kind: 'rectangle' } }, sheet: { status: 'ok' } });
  });

  it('replays a loaded project, and commits nothing a load replaced while it folded', async () => {
    await commit(0.5);
    const loaded = { ...createFoldSequence(), steps: [{ id: 'fstep-x', parent: null, op: valleyAt(0.4) }] };
    runtime.hold();
    const late = session.commitStep(valleyAt(0.25));
    state().installFoldSequences([{ document: loaded, readOnlyRaw: null }], null);
    await runtime.open();

    await expect(late).resolves.toEqual({ status: 'stale' });
    expect(shown().steps.map((node) => node.id)).toEqual(['fstep-x']);
    expect(snapshot()).toMatchObject({ loadId: state().foldLoadId, cursor: null });
    expect(statuses()).toEqual({ 'fstep-x': 'ok' });
  });

  it('hears only the changes that are the Fold slice’s', () => {
    let heard = 0;
    const source = foldSessionDocumentSource(useWorkspaceStore);
    const stop = source.subscribe(() => {
      heard += 1;
    });
    useWorkspaceStore.setState({ dirty: true });
    expect(heard).toBe(0);
    state().setFoldStepSpread('missing', 'off');
    expect(heard).toBe(0);
    state().setFoldPaperShape(rectangleShape(3, 4)!);
    expect(heard).toBeGreaterThan(0);
    stop();
  });
});
