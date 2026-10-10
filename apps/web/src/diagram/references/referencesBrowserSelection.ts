/**
 * The References browser's selection (D20, as Phase 11 has it), and what it
 * adds. Pure.
 *
 * - A press adds a card, or takes it away: many cards are chosen by pressing
 *   each. Shift+press does to every card from the last one pressed to this
 *   one, both included, what that last press did — adds them, or takes them
 *   away. Cmd (Ctrl) changes nothing: a press already adds one more.
 * - The keyboard: the arrows, Home and End move where the keyboard is
 *   (`focus`) without changing what is chosen; Space presses the card there;
 *   with Shift a move presses it as Shift+press does.
 * - Only a card that can be added can be chosen: one whose picture reads, and
 *   the Finished card only from a plan that ran to its end.
 * - What is added is the selection in order. Turn-overs inside it come with
 *   it; the one just before its first card is offered with it.
 */
import type { BrowserCard } from './referencesBrowserPlans';
import type { PulledCard } from './referencesPulledSteps';

export interface BrowserSelection {
  indices: ReadonlySet<number>;
  /** The card a Shift+press reaches from: the last one pressed. */
  pivot: number | null;
  /** Where the keyboard is: the card last pressed or moved to, and the list's Tab stop. */
  focus: number | null;
}

/** The ways the keyboard moves through the cards. */
export type BrowserStep = 'previous' | 'next' | 'first' | 'last';

/** Whether a card can be chosen: its picture reads, and an ending only ends a plan that ran to its end. */
export function selectable(card: BrowserCard | undefined, finished: boolean): card is BrowserCard {
  return card !== undefined && card.step !== null && (card.kind !== 'done' || finished);
}

export const browserSelection = {
  empty(): BrowserSelection {
    return { indices: new Set(), pivot: null, focus: null };
  },

  /** What a list opens with: the card a replaced step was made from ("Shown now"), or nothing. */
  initial(shown: number | null): BrowserSelection {
    return shown === null ? browserSelection.empty() : { indices: new Set([shown]), pivot: shown, focus: shown };
  },

  /**
   * A press on a card: it is added, or taken away when it was chosen. With
   * `range`, every card from the last one pressed to this one, both included,
   * is added — or taken away, when the last press took its card away — those
   * that cannot be chosen left out. A card that cannot be chosen takes the
   * keyboard; pressed alone it changes nothing, and a range to it keeps the
   * card the range reached from.
   */
  press(
    selection: BrowserSelection,
    cards: readonly BrowserCard[],
    index: number,
    { range, finished }: { range: boolean; finished: boolean }
  ): BrowserSelection {
    const choosable = selectable(cards[index], finished);
    const ranging = range && selection.pivot !== null;
    if (!choosable && !ranging) return { ...selection, focus: index };
    const indices = new Set(selection.indices);
    if (ranging && selection.pivot !== null) {
      const adding = selection.indices.has(selection.pivot);
      const from = Math.min(selection.pivot, index);
      const to = Math.max(selection.pivot, index);
      for (let at = from; at <= to; at += 1) {
        if (!selectable(cards[at], finished)) continue;
        if (adding) indices.add(at);
        else indices.delete(at);
      }
    } else if (indices.has(index)) {
      indices.delete(index);
    } else {
      indices.add(index);
    }
    return { indices, pivot: choosable ? index : selection.pivot, focus: index };
  },

  /** The keyboard moved: it is on `index` now, and nothing chosen changes. */
  moveTo(selection: BrowserSelection, index: number): BrowserSelection {
    return { ...selection, focus: index };
  },

  /**
   * The card a keyboard move lands on, from `from` (where the keyboard is):
   * the one before or after it, or the first or last — skipping a card that
   * does not read, from one too (a press focuses it). From nothing, back
   * starts at the end and forward at the start. Null with no card to land on.
   */
  step(cards: readonly BrowserCard[], from: number | null, to: BrowserStep): number | null {
    const open = cards.filter((card) => card.step).map((card) => card.index);
    if (open.length === 0) return null;
    const at = from === null ? -1 : open.indexOf(from);
    const last = open.length - 1;
    if (from !== null && at < 0) {
      // On a card that does not read: the nearest one that does, that way.
      if (to === 'next') return open.find((index) => index > from) ?? open[last]!;
      if (to === 'previous') return [...open].reverse().find((index) => index < from) ?? open[0]!;
    }
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

  /** Every card that can be chosen. */
  all(cards: readonly BrowserCard[], finished: boolean): BrowserSelection {
    const chosen = cards.filter((card) => selectable(card, finished)).map((card) => card.index);
    const first = chosen[0] ?? null;
    return { indices: new Set(chosen), pivot: first, focus: first };
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
  const kept = [...indices]
    .sort((a, b) => a - b)
    .map((index) => cards[index])
    .filter((card): card is BrowserCard => selectable(card, finished));
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
 * while Landmarks first renumbers the cards — and of the cards on its line (a
 * press shares its fold's), the one with its number when there is one; or,
 * for a card that folds no line, by its number. Null for none, or when
 * nothing is being replaced.
 */
export function shownCardIn(
  cards: readonly BrowserCard[],
  plan: string | null,
  shown: ShownCard | null
): number | null {
  if (!shown || plan === null || shown.plan !== plan) return null;
  const { line, card } = shown;
  if (line) {
    const onLine = cards.filter((candidate) => sameLine(candidate.step?.card.line ?? null, line));
    return (onLine.find((candidate) => candidate.number === card) ?? onLine[0])?.index ?? null;
  }
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
