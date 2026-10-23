/**
 * A step's change to the crease pattern as the Step pane words it
 * (`fold/stepWords`' `FoldCreaseDiff`), from the engine's per-step summary
 * (plan D14).
 *
 * The engine names the creases a step added by their edge ids in the landed
 * state; the words count them by letter, so each id is looked up in that
 * state's crease pattern: a folded crease under its letter, front-relative as
 * the counts are, and a precrease's as flat.
 *
 * The engine's *refolded* are flat creases folded again, with the letter each
 * remembered; the words split them by whether they went the way they
 * remember. Its *reversed* — a crease that changed letter while folded — the
 * words count with the second kind: in both a crease now reads the other way
 * to the one it had.
 *
 * Pure.
 */
import type { FoldSceneCrease, FoldStepSummary } from '../engine/foldEngineWire';
import type { FoldCreaseCounts, FoldCreaseDiff } from '../stepWords';

/** What a step changed, by letter; null while the landed state's creases are unknown. */
export function foldCreaseDiff(
  summary: FoldStepSummary,
  creases: ReadonlyMap<number, FoldSceneCrease> | null
): FoldCreaseDiff | null {
  if (!creases) return null;
  const added: FoldCreaseCounts = { mountain: 0, valley: 0, flat: 0 };
  for (const id of summary.diff.added) {
    const crease = creases.get(id);
    if (!crease || crease.kind === 'border') continue;
    if (crease.kind === 'flat') added.flat += 1;
    else if (crease.letter === 'mountain') added.mountain += 1;
    else added.valley += 1;
  }
  const sameWay = summary.diff.refolded.filter((refold) => refold.letter === refold.remembered).length;
  // A partial precrease's crease marks, which the engine counts apart: no crease is added.
  const marks = summary.diff.marks_added ?? 0;
  return {
    added,
    refolded: sameWay,
    reversed: summary.diff.refolded.length - sameWay + summary.diff.reversed.length,
    unfolded: summary.diff.unfolded.length,
    ...(marks > 0 ? { marks } : {}),
  };
}
