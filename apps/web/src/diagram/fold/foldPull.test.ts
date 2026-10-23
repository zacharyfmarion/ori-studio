import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { sequenceOf, step, valleyAt } from '../../fold/document/foldSequence.fixtures';
import type { FoldStepNode } from '../../fold/document/foldSequenceDocument';
import { foldNodeSentenceStep } from '../../fold/sequence/foldSentenceStep';
import { foldPathEntries } from '../../fold/sequence/foldSequencePath';
import { FOLD_PENDING_NODE, type FoldSessionNode } from '../../fold/session/foldSessionState';
import { foldSendTargets } from './foldBrowserActions';
import { FOLD_PULL_RENDER, foldBrowserCards, foldPullRender } from './foldPull';

const t = ((_key: string, fallback: string | Record<string, unknown>, options?: Record<string, unknown>) => {
  const text = typeof fallback === 'string' ? fallback : String(fallback.defaultValue ?? _key);
  return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String((options ?? (typeof fallback === 'object' ? fallback : {}))[name] ?? ''));
}) as unknown as TFunction;

const TURN: FoldStepNode = step('fstep-2', 'fstep-1', { kind: 'turn', axis: 'vertical' });
const NODES: FoldStepNode[] = [
  step('fstep-1', null, valleyAt(0.5)),
  TURN,
  step('fstep-3', 'fstep-2', valleyAt(0.25)),
  step('fstep-4', 'fstep-3', valleyAt(0.75)),
];
const SEQUENCE = sequenceOf(NODES);

const landed = (id: number): FoldSessionNode => ({
  status: 'ok',
  path: null,
  state: { generation: 0, id },
  fingerprint: `fs1:${id}`,
  summary: null,
  report: null,
  refusal: null,
});

const broken: FoldSessionNode = { ...FOLD_PENDING_NODE, status: 'broken', refusal: { at: 'fstep-4', code: 'no_fold' } };

/** The path as the session has it: every step landed but the last — still folding, unless given. */
function view(last: boolean | FoldSessionNode = false, failed = false) {
  const nodes = new Map<string, FoldSessionNode>([
    ['fstep-1', landed(1)],
    ['fstep-2', landed(2)],
    ['fstep-3', landed(3)],
    ['fstep-4', last === true ? landed(4) : last === false ? FOLD_PENDING_NODE : last],
  ]);
  const entries = foldPathEntries(SEQUENCE, NODES.map((node) => node.id), landed(0), nodes, FOLD_PENDING_NODE);
  return {
    entries,
    document: SEQUENCE,
    words: entries.map((entry) =>
      entry.node ? foldNodeSentenceStep(entry.node, { parent: null, child: null, report: null }) : { op: 'unknown' as const }
    ),
    failed,
  };
}

describe('the Fold browser’s cards (D17)', () => {
  it('lists every step after the sheet — a turn as a turn — then Finished, each with what it adds', () => {
    const cards = foldBrowserCards(t, view(true));
    expect(cards.map((card) => [card.index, card.kind, card.number])).toEqual([
      [0, 'fold', 1],
      [1, 'turn-over', null],
      [2, 'fold', 2],
      [3, 'fold', 3],
      [4, 'done', null],
    ]);
    expect(cards.map((card) => card.step)).toEqual([
      { kind: 'step', step: 'fstep-1', moment: 'before' },
      { kind: 'turn', turn: { kind: 'turn-over', axis: 'vertical' } },
      { kind: 'step', step: 'fstep-3', moment: 'before' },
      { kind: 'step', step: 'fstep-4', moment: 'before' },
      { kind: 'step', step: 'fstep-4', moment: 'after' },
    ]);
    expect(cards[1]!.sentence).toContain('Turn');
  });

  it('lists a step Fold has not landed, and offers nothing for it — nor Finished after it', () => {
    const cards = foldBrowserCards(t, view(false));
    expect(cards[3]!.step).toBeNull();
    expect(cards[4]!.step).toBeNull();
  });

  it('has the picture of a step still replaying on its way, not missing', () => {
    const cards = foldBrowserCards(t, view(false));
    expect(cards[3]!.picture).toEqual({ status: 'pending' });
    expect(cards[4]!.picture).toEqual({ status: 'pending' });
  });

  it('has no picture to wait for when nothing will land: the step broke, or the replay stopped short', () => {
    const brokenCards = foldBrowserCards(t, view(broken));
    expect(brokenCards[3]!.picture).toEqual({ status: 'none' });
    expect(brokenCards[4]!.picture).toEqual({ status: 'none' });
    const stopped = foldBrowserCards(t, view(false, true));
    expect(stopped[3]!.picture).toEqual({ status: 'none' });
    // What landed before the replay stopped is still pictured.
    expect(stopped[2]!.picture.status).toBe('landed');
  });

  it('pictures each landed state and its inherited spread, including turns and Finished', () => {
    const spread = { kind: 'depth' as const, amount: 0.06, toward: 'down-right' as const };
    const document = sequenceOf(NODES.map((node, index) => index === 1 ? { ...node, spread } : node));
    const cards = foldBrowserCards(t, { ...view(true), document });
    expect(cards.map((card) => card.picture)).toEqual([
      { status: 'landed', source: { state: { generation: 0, id: 1 }, key: 'fs1:1', spread: null } },
      { status: 'landed', source: { state: { generation: 0, id: 2 }, key: 'fs1:2', spread } },
      { status: 'landed', source: { state: { generation: 0, id: 3 }, key: 'fs1:3', spread } },
      { status: 'landed', source: { state: { generation: 0, id: 4 }, key: 'fs1:4', spread } },
      { status: 'landed', source: { state: { generation: 0, id: 4 }, key: 'fs1:4', spread } },
    ]);
  });

  it('draws a merge as one card, the step it becomes: numbered first to last, the last state’s picture, said for both sides', () => {
    const merges = [{ steps: ['fstep-3', 'fstep-4'], kind: 'mirror' as const }];
    const cards = foldBrowserCards(t, view(true), merges);
    expect(cards.map((card) => [card.index, card.kind, card.number, card.through])).toEqual([
      [0, 'fold', 1, undefined],
      [1, 'turn-over', null, undefined],
      [2, 'fold', 2, 3],
      [3, 'done', null, undefined],
    ]);
    expect(cards[2]!.step).toEqual({ kind: 'step', step: 'fstep-3', through: 'fstep-4', moment: 'before' });
    expect(cards[2]!.picture).toEqual({ status: 'landed', source: { state: { generation: 0, id: 4 }, key: 'fs1:4', spread: null } });
    // The first step's kind, once, for both sides: the mirror's are not said again.
    const first = foldBrowserCards(t, view(true))[2]!.sentence;
    expect(first).toBe('Valley fold.');
    expect(cards[2]!.sentence).toBe('Valley fold on both sides.');
    // Added only once every step of it has landed.
    expect(foldBrowserCards(t, view(false), merges)[2]!.step).toBeNull();
  });

  it('draws a merge whose steps are not all on the path as its steps', () => {
    const cards = foldBrowserCards(t, view(true), [{ steps: ['fstep-3', 'fstep-gone'], kind: 'mirror' }]);
    expect(cards.map((card) => card.number)).toEqual([1, null, 2, 3, null]);
  });

  it('has no Finished for a path that only turns', () => {
    const turnOnly = sequenceOf([{ ...TURN, parent: null }]);
    const entries = foldPathEntries(turnOnly, ['fstep-2'], landed(0), new Map([['fstep-2', landed(2)]]), FOLD_PENDING_NODE);
    const cards = foldBrowserCards(t, {
      document: turnOnly,
      entries,
      words: entries.map(() => ({ op: 'unknown' as const })),
      failed: false,
    });
    expect(cards.map((card) => card.kind)).toEqual(['turn-over']);
  });
});

describe('a pulled step’s spread', () => {
  const depth = { kind: 'depth' as const, amount: 0.06, toward: 'down-right' as const };
  const spread = sequenceOf([
    step('fstep-1', null, valleyAt(0.5)),
    step('fstep-3', 'fstep-1', valleyAt(0.25), { spread: depth }),
    step('fstep-4', 'fstep-3', valleyAt(0.75), { spread: 'off' }),
  ]);

  it('is the spread Fold shows the state with: the parent’s before a step, the step’s own after it', () => {
    expect(foldPullRender(spread, 'fold-a', { step: 'fstep-4', moment: 'before' })).toEqual({ ...FOLD_PULL_RENDER, spread: depth });
    expect(foldPullRender(spread, 'fold-a', { step: 'fstep-4', moment: 'after' })).toEqual(FOLD_PULL_RENDER);
    // The first step folds from the sheet, with spread off by default.
    expect(foldPullRender(spread, 'fold-a', { step: 'fstep-1', moment: 'before' })).toEqual(FOLD_PULL_RENDER);
  });

  it('is none for a sequence that is not the one asked for', () => {
    expect(foldPullRender(spread, 'fold-b', { step: 'fstep-4', moment: 'before' })).toEqual(FOLD_PULL_RENDER);
    expect(foldPullRender(null, 'fold-a', { step: 'fstep-4', moment: 'before' })).toEqual(FOLD_PULL_RENDER);
  });
});

describe('Send to Diagram from Fold (D17)', () => {
  const path = [NODES[0]!, NODES[1]!, NODES[2]!];

  it('sends the step on screen alone: the state before it, or a turn as a turn', () => {
    expect(foldSendTargets(path, 'step')).toEqual([{ kind: 'step', step: 'fstep-3', moment: 'before' }]);
    expect(foldSendTargets(path.slice(0, 2), 'step')).toEqual([{ kind: 'turn', turn: { kind: 'turn-over', axis: 'vertical' } }]);
  });

  it('sends every step to it, then Finished: the state it leaves', () => {
    expect(foldSendTargets(path, 'path')).toEqual([
      { kind: 'step', step: 'fstep-1', moment: 'before' },
      { kind: 'turn', turn: { kind: 'turn-over', axis: 'vertical' } },
      { kind: 'step', step: 'fstep-3', moment: 'before' },
      { kind: 'step', step: 'fstep-3', moment: 'after' },
    ]);
  });

  it('sends nothing from the flat sheet', () => {
    expect(foldSendTargets([], 'step')).toEqual([]);
    expect(foldSendTargets([], 'path')).toEqual([]);
  });
});
