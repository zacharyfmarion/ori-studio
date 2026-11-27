/**
 * Collapse's picks (`implementation-plans/fold-collapse-existing-creases.md`):
 * which pieces the folder has set, and to what.
 *
 * The folder holds a letter — Valley, Mountain or Open — and a click on a
 * piece sets it to that letter. Only a choice that changes something is
 * taken: a click on a piece already set to the letter in hand unsets it, and
 * one on a piece that already is that letter (a mountain fold clicked with
 * Mountain, a precrease with Open) leaves it as it is. A pick is named by
 * its sheet ends, so it is the same pick on either pane and on the step and
 * the Collapse it previews alike.
 *
 * Pure: no React, no store, no engine.
 */
import type { FoldCollapseCrease, FoldCollapseTo, SheetPoint } from '../document/foldSequenceDocument';
import type { FoldLetter } from '../engine/foldEngineWire';
import type { FoldCollapsePiece } from './creaseCollapsePieces';

/** A piece set to a letter: its sheet ends, what it becomes, and what it was. */
export interface FoldCollapsePick {
  a: SheetPoint;
  b: SheetPoint;
  to: FoldCollapseTo;
  /** What the piece is on the step on screen. */
  was: FoldCollapseTo;
  /** The letter it has or remembers there: what an open crease is drawn by. */
  letter: FoldLetter;
}

const SAME = 1e-7;

const near = (p: SheetPoint, q: SheetPoint) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= SAME;

/** Whether a pick names this piece. */
export function picksPiece(pick: Pick<FoldCollapsePick, 'a' | 'b'>, piece: FoldCollapsePiece): boolean {
  const [a, b] = piece.sheet;
  return (near(pick.a, a) && near(pick.b, b)) || (near(pick.a, b) && near(pick.b, a));
}

/** The pick on a piece; null for none. */
export function pickOf(picks: readonly FoldCollapsePick[], piece: FoldCollapsePiece): FoldCollapsePick | null {
  return picks.find((pick) => picksPiece(pick, piece)) ?? null;
}

/**
 * The picks after a click on `piece` with `to` in hand (see the module docs):
 * set, set again, unset, or as they were.
 */
export function clickPiece(picks: readonly FoldCollapsePick[], piece: FoldCollapsePiece, to: FoldCollapseTo): readonly FoldCollapsePick[] {
  const picked = pickOf(picks, piece);
  const others = picks.filter((pick) => pick !== picked);
  // Set to it already, or already it on the paper: the piece goes back to what it is.
  if (picked?.to === to || piece.now === to) return picked ? others : picks;
  return [...others, { a: piece.sheet[0], b: piece.sheet[1], to, was: piece.now, letter: piece.letter }];
}

/** What a Collapse is asked for: the picks' stretches and what each becomes. The engine merges and orders them. */
export function collapseStretches(picks: readonly FoldCollapsePick[]): FoldCollapseCrease[] {
  return picks.map(({ a, b, to }) => ({ a, b, to }));
}

/** The picks as a key: one set of picks, whatever order they were made in. */
export function collapsePicksKey(picks: readonly FoldCollapsePick[]): string {
  return picks
    .map(({ a, b, to }) => {
      const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
      return `${p[0].toFixed(9)},${p[1].toFixed(9)};${q[0].toFixed(9)},${q[1].toFixed(9)}:${to}`;
    })
    .sort()
    .join('|');
}

/** The picks still standing on a state whose pieces are `pieces`: a pick no piece names any more is let go. */
export function picksOn(picks: readonly FoldCollapsePick[], pieces: readonly FoldCollapsePiece[]): readonly FoldCollapsePick[] {
  const kept = picks.filter((pick) => pieces.some((piece) => picksPiece(pick, piece)));
  return kept.length === picks.length ? picks : kept;
}
