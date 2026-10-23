/**
 * A Fold step captured for the Diagram is worded by its kind
 * (`foldDiagramSentence`), from the strip's own reading of it (plan D17):
 * the capture reads the line a step folded along — a plain fold's report, or
 * a compound fold's — so an unfold the engine reported reads as one in both,
 * and the card the author picks says what the step it adds says.
 *
 * Over the session itself, its replay landing each step through a fake
 * engine as the bridge lands a compound fold: no plain report, the line in
 * the compound one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { initialFoldReaderState, withFoldCursor } from '../../fold/document/foldReaderState';
import { sequenceOf, step } from '../../fold/document/foldSequence.fixtures';
import type { FoldCrimpOp, FoldModelLine, FoldOp, FoldReverseOp } from '../../fold/document/foldSequenceDocument';
import {
  foldedLineOf,
  type FoldCompoundReport,
  type FoldCompoundReportBase,
} from '../../fold/engine/foldEngineCompoundWire';
import type { FoldEngineOp, FoldReport } from '../../fold/engine/foldEngineWire';
import { diagonalHalfScene, squareScene } from '../../fold/sequence/foldScene.fixtures';
import { foldNodeSentenceStep } from '../../fold/sequence/foldSentenceStep';
import { foldStateFrame } from '../../fold/sequence/foldStateFrame';
import { createFoldSession, type FoldSession } from '../../fold/session/foldSession';
import {
  fakeFoldEngine,
  inProcessFoldRuntime,
  memoryFoldDocument,
  settle,
  type FakeFoldEngine,
} from '../../fold/session/foldSession.fixtures';
import { selectFoldNode } from '../../fold/session/foldSessionState';
import { foldStepSentence, type FoldSentenceStep } from '../../fold/stepSentence';
import { foldDiagramSentence } from './foldDiagramSentence';
import { FOLD_PULL_RENDER } from './foldPull';
import { captureFoldStep } from './foldStepCapture';

// The app's own i18next, started on the inline English defaults.
const t = i18n.t.bind(i18n);

const SQUARE: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/**
 * O2 between the bottom-right corner and the top-left, listed in that order:
 * its line is the diagonal y = x, and the side the fold moves — the
 * negative one of this normal — holds the second input, the top-left corner.
 */
const AXIOM = {
  via: 'axiom',
  axiom: 2,
  inputs: [
    { kind: 'point', at: [1, 0] },
    { kind: 'point', at: [0, 1] },
  ],
} as const satisfies FoldReverseOp['line'];
const DIAGONAL: FoldModelLine = { n: [Math.SQRT1_2, -Math.SQRT1_2], d: 0 };
const SNAP = { clusters: 0, angle: 0, max_shift: 0 };

const REVERSE: FoldReverseOp = { kind: 'inside-reverse', line: AXIOM, moving: [0.1, 0.9], seed: { scope: 'all' } };
const CRIMP: FoldCrimpOp = {
  kind: 'crimp',
  line: AXIOM,
  second: { via: 'free', through: [[0.2, 0], [1, 0.8]] },
  crimp: 'inside',
  moving: [0.1, 0.9],
  seed: { scope: 'all' },
};

const BASE: FoldCompoundReportBase = {
  moving: [0],
  blocks: [[0]],
  created: [4],
  unfolded: [],
  refolded: [],
  reversed: [],
  split: 1,
  motion: { kind: 'visual', legs: [] },
};

/** What the bridge lands each op with: a compound report folding along the diagonal, its top-left side moving. */
function reportOf(op: FoldEngineOp): FoldCompoundReport | null {
  switch (op.kind) {
    case 'inside-reverse':
      return { family: 'reverse', ...BASE, line: DIAGONAL, side: 'negative', snap: SNAP, kind: 'inside', openings: [], whole: [], stored: {} };
    case 'crimp':
      return {
        family: 'crimp',
        ...BASE,
        first: DIAGONAL,
        side: 'negative',
        snap: SNAP,
        second: { n: [Math.SQRT1_2, -Math.SQRT1_2], d: 0.2 * Math.SQRT1_2 },
        second_side: 'negative',
        second_snap: SNAP,
        kind: 'inside',
        openings: [],
        whole: [],
        stored: {},
      };
    default:
      return null;
  }
}

let sessions: FoldSession[] = [];
/** Every fake engine the sessions' runtimes made, the newest last. */
let fakes: FakeFoldEngine[] = [];

afterEach(() => {
  for (const session of sessions) session.dispose();
  sessions = [];
  fakes = [];
  vi.useRealTimers();
});

/**
 * A session showing a sequence of one step, `op`, folded from the flat square
 * to the square folded on its diagonal: held and replayed, or with `linger`,
 * held by nothing until a capture holds it.
 */
async function sessionOf(op: FoldOp, report?: Partial<FoldReport>, { linger }: { linger?: number } = {}): Promise<FoldSession> {
  const document = sequenceOf([step('fstep-1', null, op)]);
  const runtime = inProcessFoldRuntime(() => {
    const fake = fakeFoldEngine({ compound: reportOf, ...(report ? { report: () => report } : {}) });
    fakes.push(fake);
    const folded = (state: number) => (fake.trail(state)?.length ?? 0) > 1;
    return {
      ...fake,
      scene: (state: number) => (folded(state) ? diagonalHalfScene() : squareScene()),
      summary: (state: number) => ({ ...fake.summary(state), sheet: SQUARE }),
      stepAction: () => ({ status: 'ok' as const, action: null }),
    };
  });
  const source = memoryFoldDocument({
    held: { document, readOnlyRaw: null },
    reader: withFoldCursor(initialFoldReaderState(document.id), document, 'fstep-1'),
  });
  const session = createFoldSession({ document: source, runtime, linger });
  sessions.push(session);
  if (linger === undefined) session.retain();
  await settle();
  return session;
}

/** The step as Fold's strip reads it: from the states either side and the line it folded along. */
function stripWords(session: FoldSession, op: FoldOp): FoldSentenceStep {
  const node = selectFoldNode(session.store.getState(), 'fstep-1');
  if (!node) throw new Error('no node');
  return foldNodeSentenceStep(step('fstep-1', null, op), {
    parent: foldStateFrame(squareScene()),
    child: foldStateFrame(diagonalHalfScene()),
    report: foldedLineOf(node),
  });
}

async function capturedSentence(session: FoldSession): Promise<string | undefined> {
  const result = await captureFoldStep(
    session,
    { sequence: 'fold-a', step: 'fstep-1', moment: 'before', render: FOLD_PULL_RENDER },
    { t }
  );
  if (result.status !== 'captured') throw new Error(`not captured: ${JSON.stringify(result)}`);
  return result.source.sentence;
}

describe('a Fold step captured for the Diagram, worded by its kind (D17)', () => {
  it('words an inside reverse fold as the Diagram does, from the strip’s reading of its compound report', async () => {
    const session = await sessionOf(REVERSE);
    // The session holds the line in the compound report alone, as the bridge lands one.
    expect(selectFoldNode(session.store.getState(), 'fstep-1')).toMatchObject({
      status: 'ok',
      report: null,
      compound: { family: 'reverse' },
    });
    const sentence = await capturedSentence(session);
    expect(sentence).toBe('Inside reverse fold.');
    expect(sentence).toBe(foldDiagramSentence(t, stripWords(session, REVERSE)));
    // Fold's strip still names the corners it brings together; the Diagram's picture has no letters to name.
    expect(foldStepSentence(t, stripWords(session, REVERSE))).toContain('bringing the top-left corner onto the bottom-right corner');
  });

  it('words a crimp by its kind', async () => {
    const session = await sessionOf(CRIMP);
    const sentence = await capturedSentence(session);
    expect(sentence).toBe('Inside crimp.');
    expect(sentence).toBe(foldDiagramSentence(t, stripWords(session, CRIMP)));
  });

  it('says an unfold stored as a valley fold along a bend unfolds, as the engine reported', async () => {
    const UNFOLD: FoldOp = {
      kind: 'valley',
      landing: { kind: 'outer' },
      line: { via: 'crease', at: [0.5, 0.5] },
      seed: { scope: 'depth', at: [0.25, 0.75], layers: 1 },
    };
    const session = await sessionOf(UNFOLD, { created: [], unfolded: [4], refolded: [] });
    const sentence = await capturedSentence(session);
    expect(sentence).toBe('Unfold.');
    expect(sentence).toBe(foldDiagramSentence(t, stripWords(session, UNFOLD)));
  });
});

describe('a Fold step captured while the session lingers', () => {
  it('captures again from the states the last capture left, replaying nothing, until the linger runs out', async () => {
    const LINGER = 60_000;
    const session = await sessionOf(REVERSE, undefined, { linger: LINGER });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const replayed = () => fakes.flatMap((fake) => fake.log).filter((call) => call === 'sheet' || call.startsWith('step:'));

    expect(await capturedSentence(session)).toBe('Inside reverse fold.');
    expect(replayed()).toEqual(['sheet', 'step:inside-reverse']);
    // The capture let go; the engine lingers, and the next capture finds every state where it was.
    expect(session.store.getState().live).toBe(false);
    expect(await capturedSentence(session)).toBe('Inside reverse fold.');
    expect(replayed()).toEqual(['sheet', 'step:inside-reverse']);

    // Once it runs out, a capture replays into a fresh engine, as every capture did before.
    await vi.advanceTimersByTimeAsync(LINGER);
    expect(await capturedSentence(session)).toBe('Inside reverse fold.');
    expect(replayed()).toEqual(['sheet', 'step:inside-reverse', 'sheet', 'step:inside-reverse']);
  });
});
