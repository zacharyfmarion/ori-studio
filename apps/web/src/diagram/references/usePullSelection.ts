import { useState } from 'react';
import {
  browserSelection,
  type BrowserSelection,
  type BrowserStep,
  type PullCard,
} from './referencesBrowserSelection';

/** A pull browser's selection, bound: what is chosen and the verbs that choose. */
export interface PullSelection {
  selection: BrowserSelection;
  /** A press on a card: it is added or taken away; with Shift, so is every card from the last one pressed (`browserSelection.press`). */
  press: (index: number, modifiers: { range: boolean }) => void;
  /**
   * The keyboard's walk: to the card before or after the one the keyboard is
   * on, or the first or last, skipping any that does not read, choosing
   * nothing. The card it lands on, or null with none to land on.
   */
  move: (to: BrowserStep) => number | null;
  /** A card took focus (Tab, a press, the dialog's own move): the keyboard is on it now. */
  focusOn: (index: number) => void;
  /** The walk with Shift: the card it lands on is pressed as Shift+press does. It returns that card. */
  extend: (to: BrowserStep) => number | null;
  /** Space: press the card the keyboard is on. */
  toggle: () => void;
  selectAll: () => void;
  clear: () => void;
}

/**
 * The selection of a pull browser's list (`browserSelection`), whatever it
 * pulls from: References' plans or a Fold sequence (fold-workspace plan D17).
 * A list of another key starts afresh, and until the first press in a list
 * the selection is what it opens with (`initial` — a replaced step's card).
 * `finished` says whether the list's ending can be chosen.
 */
export function usePullSelection(
  cards: readonly PullCard[],
  listKey: string,
  initial: number | null,
  finished: boolean
): PullSelection {
  const [picked, setPicked] = useState<{ list: string | null; selection: BrowserSelection }>({
    list: null,
    selection: browserSelection.empty(),
  });
  const selection = picked.list === listKey ? picked.selection : browserSelection.initial(initial);
  // A change to the selection as it stands by then: a Shift+arrow extends it
  // and focuses the card it lands on, whose onFocus asks again in the same
  // event — and must see the extension, not this render's selection.
  const select = (change: (current: BrowserSelection) => BrowserSelection) =>
    setPicked((prev) => {
      const current = prev.list === listKey ? prev.selection : browserSelection.initial(initial);
      const next = change(current);
      return next === current && prev.list === listKey ? prev : { list: listKey, selection: next };
    });
  return {
    selection,
    press: (index, { range }) => select((current) => browserSelection.press(current, cards, index, { range, finished })),
    move: (to) => {
      const next = browserSelection.step(cards, selection.focus, to);
      if (next !== null) select((current) => browserSelection.moveTo(current, next));
      return next;
    },
    focusOn: (index) =>
      select((current) => (current.focus === index ? current : browserSelection.moveTo(current, index))),
    extend: (to) => {
      const next = browserSelection.step(cards, selection.focus, to);
      if (next !== null) select((current) => browserSelection.press(current, cards, next, { range: true, finished }));
      return next;
    },
    toggle: () => {
      const at = selection.focus ?? browserSelection.step(cards, null, 'next');
      if (at !== null) select((current) => browserSelection.press(current, cards, at, { range: false, finished }));
    },
    selectAll: () => select(() => browserSelection.all(cards, finished)),
    clear: () => select(() => browserSelection.empty()),
  };
}
