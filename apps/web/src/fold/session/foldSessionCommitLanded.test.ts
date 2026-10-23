/**
 * Committing a step the engine landed itself — an Import CP, Edit's folded
 * figure (plan D16) — through the session: appended after the step it was
 * landed after, with that state standing for it in the replay that follows,
 * so nothing is folded twice; an import into an empty sequence adopts its
 * sheet in the same edit; a step that no longer fits where it was landed is
 * stale, and its state is let go.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import {
  rectangleShape,
  type FoldCpJumpOp,
  type FoldPaper,
  type FoldSequenceDocument,
} from '../document/foldSequenceDocument';
import type { FoldEngineStateHandle } from '../engine/foldEnginePort';
import { createFoldSession, type FoldLandedStep, type FoldSession } from './foldSession';
import {
  fakeFoldEngine,
  inProcessFoldRuntime,
  memoryFoldDocument,
  settle,
  type FakeFoldEngine,
} from './foldSession.fixtures';
import { selectFoldCursorNode } from './foldSessionState';

const JUMP: FoldCpJumpOp = { kind: 'cp-jump', cpJson: '{"vertices_coords":[]}', orderJson: '[]', origin: 'cp' };

let sessions: FoldSession[] = [];

afterEach(() => {
  for (const session of sessions) session.dispose();
  sessions = [];
});

function setup(document: FoldSequenceDocument | null, cursor: string | null = null) {
  const engines: FakeFoldEngine[] = [];
  const runtime = inProcessFoldRuntime(() => {
    const made = fakeFoldEngine();
    engines.push(made);
    return made;
  });
  let next = 0;
  const source = memoryFoldDocument(
    {
      held: document && { document, readOnlyRaw: null },
      reader: document && withFoldCursor(initialFoldReaderState(document.id), document, cursor),
    },
    (prefix) => `${prefix}-${(next += 1)}`
  );
  const session = createFoldSession({ document: source, runtime });
  sessions.push(session);
  const engine = () => engines[engines.length - 1]!;
  const cursorNode = () => selectFoldCursorNode(session.store.getState());
  /** Land the jump in the engine as an import would: after `from`, or from a fresh sheet of `paper`. */
  const land = (from: FoldEngineStateHandle | FoldPaper, adopt?: FoldLandedStep['adopt']): FoldLandedStep => {
    const after = 'generation' in from ? from : null;
    const parentId = 'generation' in from ? from.id : (engine().sheet(from) as { state: number }).state;
    const landed = engine().apply(parentId, JUMP);
    if (landed.status !== 'ok') throw new Error('refused');
    return {
      state: { generation: runtime.generation(), id: landed.state },
      parent: after,
      op: JUMP,
      fingerprint: engine().fingerprint(landed.state),
      summary: landed.summary,
      ...(adopt ? { adopt } : {}),
    };
  };
  return { session, runtime, source, engine, cursorNode, land };
}

describe('the Fold session: committing a landed step', () => {
  it('appends it after the step on screen, and the replay takes the state it landed', async () => {
    const { session, source, engine, cursorNode, land } = setup(sequenceOf([step('a', null, valleyAt(0.5))]), 'a');
    session.retain();
    await settle();
    const parent = cursorNode().state!;
    const landed = land(parent);
    const log = engine().log.length;

    const outcome = await session.commitLanded(landed);
    await settle();

    expect(outcome).toEqual({ status: 'committed', stepId: 'fstep-1', fingerprint: landed.fingerprint });
    expect(source.commits).toEqual([{ parent: 'a', op: JUMP, expect: landed.fingerprint }]);
    expect(session.store.getState().cursor).toBe('fstep-1');
    // Nothing folded again: the step on screen is the state the import landed.
    expect(engine().log.slice(log).filter((call) => call.startsWith('step:'))).toEqual([]);
    expect(cursorNode()).toMatchObject({ status: 'ok', state: landed.state, fingerprint: landed.fingerprint });
  });

  it('adopts the sheet of an empty sequence in the same commit, and lands the step again from it', async () => {
    const rectangle = rectangleShape(1, 0.5)!;
    const { session, source, engine, cursorNode, land } = setup(null);
    session.retain();
    await settle();
    const landed = land({ shape: rectangle, startSide: 'front' }, rectangle);

    const outcome = await session.commitLanded(landed);
    await settle();

    expect(outcome).toMatchObject({ status: 'committed', fingerprint: landed.fingerprint });
    expect(source.commits).toEqual([{ parent: null, op: JUMP, expect: landed.fingerprint, adopt: rectangle }]);
    const snapshot = session.store.getState();
    expect(snapshot.paper.shape).toEqual(rectangle);
    // A new sheet: the step is landed from it, matching what the import said it would be.
    expect(engine().log.filter((call) => call === 'step:cp-jump')).toHaveLength(1);
    expect(cursorNode()).toMatchObject({ status: 'ok', fingerprint: landed.fingerprint });
    expect(engine().trail(landed.state.id)).toBeUndefined();
  });

  it('is stale, letting the state go, once the step on screen is not the one it was landed after', async () => {
    const document = sequenceOf([step('a', null, valleyAt(0.5)), step('b', 'a', valleyAt(0.25))]);
    const { session, source, engine, cursorNode, land } = setup(document, 'a');
    session.retain();
    await settle();
    const landed = land(cursorNode().state!);
    source.set({ reader: withFoldCursor(source.read().reader!, document, 'b') });
    await settle();

    await expect(session.commitLanded(landed)).resolves.toEqual({ status: 'stale' });
    await settle();
    expect(source.commits).toEqual([]);
    expect(engine().trail(landed.state.id)).toBeUndefined();
  });

  it('is stale when it would adopt a sheet for a sequence that has a step by now', async () => {
    const { session, source, engine, cursorNode, land } = setup(sequenceOf([step('a', null)]));
    session.retain();
    await settle();
    expect(session.store.getState().cursor).toBeNull();
    const landed = land(cursorNode().state!, { kind: 'square' });

    await expect(session.commitLanded(landed)).resolves.toEqual({ status: 'stale' });
    await settle();
    expect(source.commits).toEqual([]);
    expect(engine().trail(landed.state.id)).toBeUndefined();
  });

  it('commits one landed step at a time', async () => {
    const { session, source, cursorNode, land } = setup(sequenceOf([step('a', null)]), 'a');
    session.retain();
    await settle();
    const parent = cursorNode().state!;
    const first = session.commitLanded(land(parent));
    await expect(session.commitLanded(land(parent))).resolves.toEqual({ status: 'unavailable', reason: 'busy' });
    await expect(first).resolves.toMatchObject({ status: 'committed' });
    expect(source.commits).toHaveLength(1);
  });

  it('is unavailable while no surface holds the session', async () => {
    const { session, source, land } = setup(null);
    const release = session.retain();
    await settle();
    const landed = land({ shape: { kind: 'square' }, startSide: 'front' }, { kind: 'square' });
    release();
    await expect(session.commitLanded(landed)).resolves.toEqual({ status: 'unavailable', reason: 'not-live' });
    expect(source.commits).toEqual([]);
  });
});
