/**
 * The step strip's cards (plan D14, shot-0's top): the flat sheet, every step
 * of the active path, and the step a tool is folding — each a picture of its
 * state, a number or a badge, its sentence, and its branches.
 *
 * - **Pictures** are the state each step lands at, painted as the folded
 *   pane paints it (`useFoldCardPicture`); a step with no state yet, or none
 *   at all, has none.
 * - **Standing** is a card state and a word: broken, changed, locked, or
 *   still folding; the step being folded is a preview, a blocked one when the
 *   engine refused it, and a new branch when it folds from a step that is not
 *   the tip.
 * - **The active card** is the step on screen — or the step being folded,
 *   which is drawn after it and whose sentence the caption then reads, tagged
 *   "Next".
 *
 * Pure: words in, cards out.
 */
import type { TFunction } from 'i18next';
import type { StepFilmstripCard, StepFilmstripCardState } from '../../components/steps/StepFilmstrip';
import type { FoldPaper } from '../document/foldSequenceDocument';
import { foldStepSentence, type FoldSentenceStep } from '../stepSentence';
import { operationBadge } from '../stepWords';
import type { FoldEntryStatus, FoldPathEntry } from './foldSequencePath';
import { pendingBadge, pendingTag, sheetBadge, sheetSentence, statusBadge } from './foldSequenceWords';
import type { FoldCardPictureSource } from './useFoldCardPictures';

/** A card, and what it is a card of. */
export interface FoldStripCard extends StepFilmstripCard {
  /** Part of the source range being repeated, independently of the cursor. */
  repeatSource?: boolean;
  /** The path entry it shows, by index; null for the step being folded. */
  entry: number | null;
  /** The state its picture is of; null for none. */
  picture: FoldCardPictureSource | null;
}

/** The step a tool is folding, as the strip draws it. */
export interface FoldStripPending {
  /** The engine refused it: there is nothing to commit. */
  refused: boolean;
  words: FoldSentenceStep;
  picture: FoldCardPictureSource | null;
  /** It folds from a step that is not the active path's tip: committing it starts a branch. */
  branch: boolean;
}

export interface FoldStripInput {
  paper: FoldPaper;
  entries: readonly FoldPathEntry[];
  /** Each entry's words, by index; the sheet's is unused. */
  words: readonly FoldSentenceStep[];
  /** Each entry's picture, by index. */
  pictures: readonly (FoldCardPictureSource | null)[];
  /** The step on screen, by entry index. */
  cursor: number;
  pending: FoldStripPending | null;
}

/** The card state for an entry's standing; none for a step that stands as it should. */
function cardState(status: FoldEntryStatus, imported: boolean): StepFilmstripCardState | undefined {
  switch (status) {
    case 'broken':
    case 'brokenAbove':
      return 'blocked';
    case 'changed':
      return 'changed';
    case 'locked':
      return 'locked';
    case 'pending':
      return 'pending';
    case 'ok':
      return imported ? 'imported' : undefined;
  }
}

export function foldStripCards(
  t: TFunction,
  { paper, entries, words, pictures, cursor, pending }: FoldStripInput
): { cards: FoldStripCard[]; active: number } {
  const cards: FoldStripCard[] = entries.map((entry, index): FoldStripCard => {
    const picture = pictures[index] ?? null;
    const ways = entry.branches ? { count: entry.branches.ids.length, index: entry.branches.index } : null;
    if (entry.kind === 'sheet') {
      return {
        key: entry.key,
        kind: 'fold',
        number: 0,
        badge: sheetBadge(t),
        sentence: sheetSentence(t, paper),
        ways: null,
        state: entry.status === 'ok' ? undefined : cardState(entry.status, false),
        entry: index,
        picture,
      };
    }
    const stepWords = words[index] ?? { op: 'unknown' as const };
    return {
      key: entry.key,
      kind: entry.kind === 'turn' ? 'turn-over' : 'fold',
      number: entry.number,
      badge: statusBadge(t, entry.status) ?? operationBadge(t, stepWords),
      sentence: foldStepSentence(t, stepWords),
      ways,
      state: cardState(entry.status, stepWords.op === 'cp-jump'),
      entry: index,
      picture,
    };
  });
  if (!pending) return { cards, active: Math.min(cursor, cards.length - 1) };

  // Drawn straight after the step it folds from, which a branch makes a step
  // in the middle of the path.
  const from = entries[cursor];
  const turn = pending.words.op === 'turn';
  const number = turn ? null : (lastNumber(entries, cursor) ?? 0) + 1;
  cards.splice(cursor + 1, 0, {
    key: `pending:${from?.key ?? ''}`,
    kind: turn ? 'turn-over' : 'fold',
    number,
    badge: pendingBadge(t, pending.refused),
    sentence: foldStepSentence(t, pending.words),
    ways: null,
    state: pending.refused ? 'blocked' : pending.branch ? 'new-branch' : 'preview',
    // What it will be once committed; a refused one will not be.
    ...(pending.refused ? {} : { tag: pendingTag(t, pending.branch) }),
    entry: null,
    picture: pending.refused ? null : pending.picture,
  });
  return { cards, active: cursor + 1 };
}

/** The number of the last numbered entry up to `index`: what the next fold is numbered after. */
function lastNumber(entries: readonly FoldPathEntry[], index: number): number | null {
  for (let at = index; at >= 0; at -= 1) {
    const number = entries[at]?.number;
    if (number !== null && number !== undefined) return number;
  }
  return null;
}
