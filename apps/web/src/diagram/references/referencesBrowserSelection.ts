/**
 * The References browser's selection (D20), and what it adds. Pure.
 *
 * - A press selects one card; Shift extends from the last card pressed alone
 *   to this one; Cmd (Ctrl) adds or takes away one. The keyboard does the
 *   same through `focus`, the card it is on: the step keys move it and
 *   select the card, with Shift they extend the range to it, and Space adds
 *   or takes it away.
 * - A range holds only cards a range can add: never the ending, never a card
 *   whose picture does not read.
 * - What is added is the selection in order. Turn-overs inside a range come
 *   with it; the one just before the first card is offered with it.
 * - The Finished card is added only on its own, and only from a plan that ran
 *   to its end: in a range it says nothing a step should.
 * - A card whose picture does not read is never added.
 */
import type { BrowserCard } from './referencesBrowserPlans';
import type { PulledCard } from './referencesPulledSteps';

export interface BrowserSelection {
  indices: ReadonlySet<number>;
  /** The card a range extends from: the last one pressed or toggled on its own. */
  pivot: number | null;
  /** The card last pressed or stepped to: where the keyboard is, and the list's Tab stop. */
  focus: number | null;
}

/** The ways the step keys move through the cards. */
export type BrowserStep = 'previous' | 'next' | 'first' | 'last';

/** Whether a range takes the card: one that can be added among others. */
const inRange = (card: BrowserCard | undefined): boolean => card !== undefined && card.step !== null && card.kind !== 'done';

export const browserSelection = {
  empty(): BrowserSelection {
    return { indices: new Set(), pivot: null, focus: null };
  },

  /** What a list opens with: the card a replaced step was made from ("Shown now"), or nothing. */
  initial(shown: number | null): BrowserSelection {
    return shown === null ? browserSelection.empty() : { indices: new Set([shown]), pivot: shown, focus: shown };
  },

  press(
    selection: BrowserSelection,
    cards: readonly BrowserCard[],
    index: number,
    { range, toggle }: { range: boolean; toggle: boolean }
  ): BrowserSelection {
    if (range && selection.pivot !== null) {
      const from = Math.min(selection.pivot, index);
      const to = Math.max(selection.pivot, index);
      const indices = new Set<number>();
      for (let at = from; at <= to; at += 1) if (inRange(cards[at])) indices.add(at);
      return { indices, pivot: selection.pivot, focus: index };
    }
    if (toggle) {
      const indices = new Set(selection.indices);
      if (indices.has(index)) indices.delete(index);
      else indices.add(index);
      return { indices, pivot: index, focus: index };
    }
    return { indices: new Set([index]), pivot: index, focus: index };
  },

  /**
   * The card a keyboard step lands on, from `from` (where the keyboard is):
   * the one before or after it, or the first or last — skipping a card that
   * does not read, which cannot be selected. From nothing, back starts at the
   * end and forward at the start. Null with no card to land on.
   */
  step(cards: readonly BrowserCard[], from: number | null, to: BrowserStep): number | null {
    const open = cards.filter((card) => card.step).map((card) => card.index);
    if (open.length === 0) return null;
    const at = from === null ? -1 : open.indexOf(from);
    const last = open.length - 1;
    switch (to) {
      case 'first':
        return open[0]!;
      case 'last':
        return open[last]!;
      case 'previous':
        return open[at < 0 ? last : Math.max(0, at - 1)]!;
      case 'next':
        return open[at < 0 ? 0 : Math.min(last, at + 1)]!;
    }
  },

  /** Every card a range can add: all but the ending, and any that does not read. */
  all(cards: readonly BrowserCard[]): BrowserSelection {
    const indices = new Set(cards.filter(inRange).map((card) => card.index));
    const first = cards.find(inRange)?.index ?? null;
    return { indices, pivot: first, focus: first };
  },
};

/**
 * The cards a selection adds, in order, and the turn-over just before it that
 * is offered with it (null when there is none, or it is selected already).
 */
export function pullableCards(
  cards: readonly BrowserCard[],
  indices: ReadonlySet<number>,
  { finished, withTurnOver }: { finished: boolean; withTurnOver: boolean }
): { pullable: PulledCard[]; turnOverBefore: number | null } {
  const chosen = [...indices].sort((a, b) => a - b).flatMap((index) => cards[index] ?? []);
  const alone = chosen.length === 1;
  const kept = chosen.filter((card) => card.step && (card.kind !== 'done' || (alone && finished)));
  const first = kept[0];
  const before = first ? cards[first.index - 1] : undefined;
  const turnOverBefore =
    before && before.kind === 'turn-over' && before.step && !indices.has(before.index) ? before.index : null;
  const withBefore = turnOverBefore !== null && withTurnOver ? [cards[turnOverBefore]!, ...kept] : kept;
  return {
    pullable: withBefore.map((card) => card.step!),
    turnOverBefore,
  };
}

/** The card a replaced step was made from, as the browser was opened with it. */
export interface ShownCard {
  /** Its plan, by cache key id; null for a step pulled before plans were recorded. */
  plan: string | null;
  card: number | null;
  line: { n: readonly [number, number]; d: number } | null;
}

/**
 * Where the card a replaced step shows is in the list on screen ("Shown
 * now"): only in the plan it came from, found by its line — which stays put
 * while Landmarks first renumbers the cards — or, for a card that folds no
 * line, by its number. Null for none, or when nothing is being replaced.
 */
export function shownCardIn(
  cards: readonly BrowserCard[],
  plan: string | null,
  shown: ShownCard | null
): number | null {
  if (!shown || plan === null || shown.plan !== plan) return null;
  const { line, card } = shown;
  if (line) return cards.find((candidate) => sameLine(candidate.step?.card.line ?? null, line))?.index ?? null;
  if (card !== null) return cards.find((candidate) => candidate.number === card)?.index ?? null;
  return null;
}

/** Whether two plan lines `n · p = d` are one line. */
export function sameLine(
  a: { n: readonly [number, number]; d: number } | null,
  b: { n: readonly [number, number]; d: number } | null
): boolean {
  if (!a || !b) return false;
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-9;
  return near(a.n[0], b.n[0]) && near(a.n[1], b.n[1]) && near(a.d, b.d);
}
