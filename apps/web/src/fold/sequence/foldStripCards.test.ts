import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import { regularPolygonShape, SQUARE_PAPER, type FoldLockedStep } from '../document/foldSequenceDocument';
import { FOLD_PENDING_NODE, type FoldSessionNode } from '../session/foldSessionState';
import type { FoldSentenceStep } from '../stepSentence';
import { foldPathEntries } from './foldSequencePath';
import { foldStripCards, type FoldStripPending } from './foldStripCards';

const t = i18n.t.bind(i18n);

const node = (status: FoldSessionNode['status'], at?: string): FoldSessionNode => ({
  ...FOLD_PENDING_NODE,
  status,
  refusal: at ? { at, code: 'crease_not_found' } : null,
});

const VALLEY: FoldSentenceStep = { op: 'fold', direction: 'valley', line: { via: 'free' }, scope: { kind: 'all' } };
const TURN: FoldSentenceStep = { op: 'turn', turn: { kind: 'turn-over', axis: 'vertical' } };

const locked: FoldLockedStep = { id: 'l', parent: 'b', unknown: { op: { kind: 'sink' } } };
const document = sequenceOf([
  step('a', null, valleyAt(0.5)),
  step('t', 'a', { kind: 'turn', axis: 'vertical' }),
  step('b', 't', valleyAt(0.25)),
  step('b2', 't', valleyAt(0.75)),
  locked,
]);

function strip(nodes: Record<string, FoldSessionNode>, cursor: number, pending: FoldStripPending | null = null) {
  const entries = foldPathEntries(document, ['a', 't', 'b', 'l'], node('ok'), new Map(Object.entries(nodes)), FOLD_PENDING_NODE);
  return foldStripCards(t, {
    paper: SQUARE_PAPER,
    entries,
    words: [{ op: 'unknown' }, VALLEY, TURN, VALLEY, { op: 'unknown' }],
    pictures: entries.map(() => null),
    cursor,
    pending,
  });
}

const OK = { a: node('ok'), t: node('ok'), b: node('ok'), l: node('locked') };

describe('foldStripCards', () => {
  it('draws the sheet, then each step numbered or badged, with its sentence and its branches', () => {
    const { cards, active } = strip(OK, 2);
    expect(cards.map((card) => [card.number, card.badge, card.kind, card.state])).toEqual([
      [0, 'Sheet', 'fold', undefined],
      [1, 'Valley', 'fold', undefined],
      [null, 'Turn over', 'turn-over', undefined],
      [2, 'Valley', 'fold', undefined],
      [3, 'Newer', 'fold', 'locked'],
    ]);
    expect(cards[0]?.sentence).toBe('Start with a square, front side up.');
    expect(cards[2]?.sentence).toBe('Turn over, side to side.');
    expect(cards[3]?.ways).toEqual({ count: 2, index: 0 });
    expect(active).toBe(2);
  });

  it('says a step’s standing in its frame and its badge', () => {
    const { cards } = strip({ a: node('changed'), t: node('pending'), b: node('broken', 'b'), l: node('broken', 'b') }, 0);
    expect(cards.slice(1).map((card) => [card.state, card.badge])).toEqual([
      ['changed', 'Changed'],
      ['pending', 'Turn over'],
      ['blocked', 'Broken'],
      // Under a broken step: its own inputs may be fine, so it keeps its badge.
      ['blocked', 'Newer'],
    ]);
  });

  it('puts the step being folded after the step it folds from, as the active card, numbered on', () => {
    const preview: FoldStripPending = { refused: false, words: VALLEY, picture: null, branch: false };
    const { cards, active } = strip(OK, 4, preview);
    expect(cards).toHaveLength(6);
    expect(active).toBe(5);
    expect(cards[5]).toMatchObject({ number: 4, badge: 'Preview', state: 'preview', tag: 'Next', entry: null });
  });

  it('says the step being folded starts a branch, or was refused', () => {
    const branch = strip(OK, 1, { refused: false, words: VALLEY, picture: null, branch: true });
    expect(branch.active).toBe(2);
    expect(branch.cards[2]).toMatchObject({ number: 2, state: 'new-branch', tag: 'New branch' });
    // The path goes on after it, numbered as it was.
    expect(branch.cards[4]?.number).toBe(2);

    const refused = strip(OK, 4, { refused: true, words: TURN, picture: null, branch: true });
    expect(refused.cards[5]).toMatchObject({ number: null, kind: 'turn-over', badge: 'Blocked', state: 'blocked' });
    // It will be nothing once committed: there is nothing to commit.
    expect(refused.cards[5]).not.toHaveProperty('tag');
  });

  it('says a polygon sheet by its sides, and the back up', () => {
    const entries = foldPathEntries(sequenceOf([]), [], node('ok'), new Map(), FOLD_PENDING_NODE);
    const { cards } = foldStripCards(t, {
      paper: { shape: regularPolygonShape(6)!, startSide: 'back' },
      entries,
      words: [{ op: 'unknown' }],
      pictures: [null],
      cursor: 0,
      pending: null,
    });
    expect(cards[0]?.sentence).toBe('Start with a regular polygon of 6 sides, back side up.');
  });
});
