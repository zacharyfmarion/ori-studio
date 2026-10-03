import { describe, expect, it } from 'vitest';
import type { BrowserCard } from './referencesBrowserPlans';
import { browserSelection, pullableCards, shownCardIn } from './referencesBrowserSelection';

/** A strip: folds 1–2, a turn-over, folds 3–4, the ending; card 4's picture does not read. */
function strip(): BrowserCard[] {
  const step = (index: number) =>
    ({ card: { card: index }, picture: { key: `p${index}` }, way: null }) as unknown as BrowserCard['step'];
  const card = (index: number, kind: BrowserCard['kind'], readable = true): BrowserCard => ({
    index,
    kind,
    number: kind === 'fold' ? index : null,
    badge: '',
    sentence: `card ${index}`,
    ways: null,
    step: readable ? step(index) : null,
  });
  return [card(0, 'fold'), card(1, 'fold'), card(2, 'turn-over'), card(3, 'fold'), card(4, 'fold', false), card(5, 'done')];
}
const indices = (pulled: ReturnType<typeof pullableCards>['pullable']) =>
  pulled.map((step) => (step.card as unknown as { card: number }).card);

describe('the browser’s selection', () => {
  it('selects one card, extends with Shift from the last pressed, adds or takes away with Cmd', () => {
    let selection = browserSelection.press(browserSelection.empty(), 1, { range: false, toggle: false });
    expect([...selection.indices]).toEqual([1]);
    selection = browserSelection.press(selection, 3, { range: true, toggle: false });
    expect([...selection.indices].sort()).toEqual([1, 2, 3]);
    selection = browserSelection.press(selection, 2, { range: false, toggle: true });
    expect([...selection.indices].sort()).toEqual([1, 3]);
    selection = browserSelection.press(selection, 0, { range: false, toggle: false });
    expect([...selection.indices]).toEqual([0]);
  });

  it('opens on the card a replaced step was made from', () => {
    expect([...browserSelection.initial(3).indices]).toEqual([3]);
    expect(browserSelection.initial(null).indices.size).toBe(0);
  });

  it('walks from the last card pressed with the keyboard, over a card that does not read', () => {
    const cards = strip();
    expect(browserSelection.step(cards, 3, 'next')).toBe(5);
    expect(browserSelection.step(cards, 5, 'next')).toBe(5);
    expect(browserSelection.step(cards, 5, 'previous')).toBe(3);
    expect(browserSelection.step(cards, 0, 'previous')).toBe(0);
    // From nothing: forward from the start, back from the end.
    expect(browserSelection.step(cards, null, 'next')).toBe(0);
    expect(browserSelection.step(cards, null, 'previous')).toBe(5);
    expect(browserSelection.step(cards, 2, 'first')).toBe(0);
    expect(browserSelection.step(cards, 2, 'last')).toBe(5);
    expect(browserSelection.step([], null, 'next')).toBeNull();
  });

  it('selects all the cards a range can add: not the ending, not one that does not read', () => {
    expect([...browserSelection.all(strip()).indices]).toEqual([0, 1, 2, 3]);
  });
});

describe('what a selection adds', () => {
  it('adds a range in order, its turn-overs with it, and never a card that does not read', () => {
    const { pullable, turnOverBefore } = pullableCards(strip(), new Set([0, 1, 2, 3, 4]), { finished: true, withTurnOver: true });
    expect(indices(pullable)).toEqual([0, 1, 2, 3]);
    expect(turnOverBefore).toBeNull();
  });

  it('offers the turn-over just before the first card, and adds it unless it is declined', () => {
    const offered = pullableCards(strip(), new Set([3]), { finished: true, withTurnOver: true });
    expect(offered.turnOverBefore).toBe(2);
    expect(indices(offered.pullable)).toEqual([2, 3]);
    expect(indices(pullableCards(strip(), new Set([3]), { finished: true, withTurnOver: false }).pullable)).toEqual([3]);
  });

  it('adds the Finished card only on its own, and only from a plan that ran to its end', () => {
    expect(indices(pullableCards(strip(), new Set([5]), { finished: true, withTurnOver: true }).pullable)).toEqual([5]);
    expect(pullableCards(strip(), new Set([5]), { finished: false, withTurnOver: true }).pullable).toEqual([]);
    expect(indices(pullableCards(strip(), new Set([3, 5]), { finished: true, withTurnOver: false }).pullable)).toEqual([3]);
  });
});

describe('the card a replaced step shows', () => {
  const lined = (): BrowserCard[] =>
    strip().map((card) =>
      card.step ? { ...card, step: { ...card.step, card: { card: card.number, line: { n: [0, 1], d: card.index / 10 } } } } : card
    ) as unknown as BrowserCard[];

  it('is found by its line in the plan it came from, and only there', () => {
    const shown = { plan: 'plan-a', card: 9, line: { n: [0, 1] as const, d: 0.3 } };
    expect(shownCardIn(lined(), 'plan-a', shown)).toBe(3);
    expect(shownCardIn(lined(), 'plan-b', shown)).toBeNull();
  });

  it('is found by its number when it folds no line', () => {
    expect(shownCardIn(lined(), 'plan-a', { plan: 'plan-a', card: 1, line: null })).toBe(1);
  });

  // The browser opened from the header: nothing replaced, and no plan listed yet.
  it('is none when nothing is being replaced, or no pattern is shown', () => {
    expect(shownCardIn(lined(), 'plan-a', null)).toBeNull();
    expect(shownCardIn(lined(), null, null)).toBeNull();
    expect(shownCardIn(lined(), null, { plan: null, card: 1, line: null })).toBeNull();
  });
});
