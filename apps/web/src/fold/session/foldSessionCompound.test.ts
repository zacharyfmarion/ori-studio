/**
 * Every compound family through the session's one path: what the engine says
 * of a compound step — its report, tagged by its family, with the legs its
 * animation plays — reaches the node a replay settles, the step a tool
 * previews, the step a commit appends, and a step its family's own call
 * landed (`commitLanded`) with the choices it stores; nothing is folded twice.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { initialFoldReaderState, withFoldCursor } from '../document/foldReaderState';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import type {
  FoldCompletionChoice,
  FoldCrimpOp,
  FoldSequenceDocument,
  FoldSinkOp,
  FoldSquashOp,
  FoldTuckOp,
} from '../document/foldSequenceDocument';
import {
  compoundFamilyOf,
  type FoldCompoundFamily,
  type FoldCompoundReport,
  type FoldCompoundReportBase,
} from '../engine/foldEngineCompoundWire';
import type { FoldEngineOp } from '../engine/foldEngineWire';
import { createFoldSession, type FoldSession } from './foldSession';
import { fakeFoldEngine, inProcessFoldRuntime, memoryFoldDocument, settle, type FakeFoldEngine } from './foldSession.fixtures';
import { selectFoldCursorNode, selectFoldNode } from './foldSessionState';

const LINE = { n: [0, 1] as [number, number], d: 0.5 };
const SNAP = { clusters: 0, angle: 0, max_shift: 0 };
const ORDER: FoldCompletionChoice = { faces: [[0.1, 0.1], [0.2, 0.2]], orders: [[0, 1, 1]] };

const SQUASH: FoldSquashOp = { kind: 'squash', flap: [0.2, 0.2], direction: 'valley' };
const SINK: FoldSinkOp = {
  kind: 'open-sink',
  line: { via: 'free', through: [[0.35, 0.35], [0.2, 0.5]] },
  seed: { scope: 'flaps', at: [[0.4, 0.45]] },
};
const TUCK: FoldTuckOp = {
  kind: 'tuck',
  line: { via: 'free', through: [[0, 0.3], [0.3, 0]] },
  direction: 'valley',
  seed: { scope: 'flaps', at: [[0.05, 0.05]] },
  target: [0.75, 0.5],
};
const CRIMP: FoldCrimpOp = {
  kind: 'crimp',
  line: { via: 'free', through: [[0, 0.5], [0.25, 0.5]] },
  second: { via: 'free', through: [[0, 0.3], [0.25, 0.3]] },
  crimp: 'inside',
  moving: [0.1, 0.2],
  seed: { scope: 'all' },
};

/** What every compound fold did, its legs naming the family so each report can be told apart. */
function base(family: FoldCompoundFamily): FoldCompoundReportBase {
  return {
    moving: [1],
    blocks: [[2]],
    created: [3],
    unfolded: [],
    refolded: [],
    reversed: [],
    split: 1,
    motion: {
      kind: 'visual',
      legs: [{ name: 'spread', stacking: 'parent', groups: [{ faces: [family.length], axis: LINE, side: 'positive', from: 0, to: 1 }] }],
    },
  };
}

/** The report the bridge lands a compound op with, by its family; none for any other op. */
function reportOf(op: FoldEngineOp): FoldCompoundReport | null {
  switch (compoundFamilyOf(op)) {
    case 'vertex':
      return { family: 'vertex', ...base('vertex'), kind: 'squash', vertices: [[0.5, 0.5]], creases: [LINE], direction: 'valley', stored: {} };
    case 'sink':
      return { family: 'sink', ...base('sink'), step: 'open', line: LINE, side: 'positive', snap: SNAP, ring: [4, 5], stored: {} };
    case 'tuck':
      return {
        family: 'tuck',
        ...base('tuck'),
        line: LINE,
        side: 'negative',
        snap: SNAP,
        direction: 'valley',
        placement: 'under',
        target: 0,
        stored: {},
      };
    case 'crimp':
      return {
        family: 'crimp',
        ...base('crimp'),
        first: LINE,
        side: 'positive',
        snap: SNAP,
        second: LINE,
        second_side: 'positive',
        second_snap: SNAP,
        kind: 'inside',
        openings: [],
        whole: [],
        stored: { order: ORDER },
      };
    case 'reverse':
    case null:
      return null;
  }
}

let sessions: FoldSession[] = [];

afterEach(() => {
  for (const session of sessions) session.dispose();
  sessions = [];
});

function setup(document: FoldSequenceDocument, cursor: string) {
  const engines: FakeFoldEngine[] = [];
  const runtime = inProcessFoldRuntime(() => {
    const made = fakeFoldEngine({ compound: reportOf });
    engines.push(made);
    return made;
  });
  let next = 0;
  const source = memoryFoldDocument(
    {
      held: { document, readOnlyRaw: null },
      reader: withFoldCursor(initialFoldReaderState(document.id), document, cursor),
    },
    (prefix) => `${prefix}-${(next += 1)}`
  );
  const session = createFoldSession({ document: source, runtime });
  sessions.push(session);
  return {
    session,
    runtime,
    source,
    engine: () => engines[engines.length - 1]!,
    cursor: () => selectFoldCursorNode(session.store.getState()),
  };
}

describe('the Fold session: every compound family on one path', () => {
  it('keeps each family’s report, with its legs, on the node a replay settles', async () => {
    const document = sequenceOf([step('a', null, valleyAt(0.5)), step('b', 'a', SQUASH), step('c', 'b', SINK)]);
    const { session } = setup(document, 'c');
    session.retain();
    await settle();
    const node = (id: string) => selectFoldNode(session.store.getState(), id);
    expect(node('a')).toMatchObject({ status: 'ok' });
    expect(node('a')?.report).not.toBeNull();
    expect(node('a')?.compound).toBeUndefined();
    expect(node('b')).toMatchObject({ status: 'ok', report: null, compound: { family: 'vertex', kind: 'squash' } });
    expect(node('c')).toMatchObject({ status: 'ok', report: null, compound: { family: 'sink', step: 'open' } });
    // Every family's report is kept whole on its node, its motion legs among it.
    expect(node('b')?.compound?.motion.legs[0]?.groups[0]?.faces).toEqual(['vertex'.length]);
    expect(node('c')?.compound?.motion.legs[0]?.groups[0]?.faces).toEqual(['sink'.length]);
  });

  it('previews a compound step with its report, and commits it without folding it again', async () => {
    const { session, engine, cursor, source } = setup(sequenceOf([step('a', null, valleyAt(0.5))]), 'a');
    session.retain();
    await settle();
    const previewed = await session.preview(TUCK);
    expect(previewed).toMatchObject({ status: 'landed', report: null, compound: { family: 'tuck', placement: 'under' } });
    expect(session.store.getState().pending).toMatchObject({ status: 'landed', compound: { family: 'tuck' } });

    const committed = await session.commitStep(TUCK);
    await settle();
    expect(committed).toMatchObject({ status: 'committed' });
    expect(source.commits).toHaveLength(1);
    expect(cursor()).toMatchObject({ status: 'ok', report: null, compound: { family: 'tuck' } });
    // Landed once, by the preview: the replay the commit caused took its state.
    expect(engine().log.filter((call) => call.endsWith(':tuck'))).toEqual(['apply:tuck']);
  });

  it('commits a step its family’s own call landed, with the choices it stores and its report', async () => {
    const { session, engine, cursor, source, runtime } = setup(sequenceOf([step('a', null, valleyAt(0.5))]), 'a');
    session.retain();
    await settle();
    const parent = cursor().state!;
    // A crimp's order, landed by its family's call as the bridge lands one.
    const landed = engine().apply(parent.id, CRIMP);
    if (landed.status !== 'ok' || !landed.compound) throw new Error('not landed');
    const choices = { completion: ORDER };
    const log = engine().log.length;

    const outcome = await session.commitLanded({
      state: { generation: runtime.generation(), id: landed.state },
      parent,
      op: CRIMP,
      choices,
      fingerprint: engine().fingerprint(landed.state),
      summary: landed.summary,
      compound: landed.compound,
    });
    await settle();

    expect(outcome).toMatchObject({ status: 'committed' });
    expect(source.commits).toEqual([{ parent: 'a', op: CRIMP, choices, expect: expect.stringMatching(/^fs1:/) }]);
    expect(cursor()).toMatchObject({
      status: 'ok',
      state: { id: landed.state },
      report: null,
      compound: { family: 'crimp', stored: { order: ORDER } },
    });
    // The replay that followed took the state with its choices: nothing folded again.
    expect(engine().log.slice(log).filter((call) => call.startsWith('step:'))).toEqual([]);
  });
});
