/**
 * Target crease patterns referenced by lessons.
 *
 * **Author these by drawing them in the editor and exporting `.fold`.** A `.cp`
 * is only a list of segments: two creases written as whole lines cross without
 * meeting, the boundary is never split where a crease reaches it, and the
 * resulting document is topologically degenerate — the foldability checker
 * reports violations that have nothing to do with the pattern being taught.
 * `.fold` carries the vertices, so a drawn-and-exported target behaves the way
 * the same pattern behaves when a user draws it.
 *
 * The `.cp` entries below predate that and are simple enough to be sound (single
 * creases, or creases that do not cross). Anything with an interior crossing
 * should be `.fold`.
 *
 * The paper is the editor's own 400×400 sheet spanning (-200,-200) to (200,200)
 * with an 8×8 grid, so a grid cell is 50 units. Note `+y` points *down*.
 */
import blankSheet from './blank-sheet.cp?raw';
import bothDiagonals from './both-diagonals.cp?raw';
import firstCrease from './first-crease.cp?raw';
import inscribedSquare from './inscribed-square.cp?raw';
import perpendicularStart from './perpendicular-start.cp?raw';
import perpendicularDone from './perpendicular-done.cp?raw';
import bisectorStart from './bisector-start.cp?raw';
import bisectorDone from './bisector-done.cp?raw';
import parallelStart from './parallel-start.cp?raw';
import parallelDone from './parallel-done.cp?raw';
import mirrorStart from './mirror-start.cp?raw';
import mirrorDone from './mirror-done.cp?raw';
import maekawaBroken from './maekawa-broken.cp?raw';
import preliminaryBase from './preliminary-base.fold?raw';
import preliminaryBaseExtraCrease from './preliminary-base-extra-crease.fold?raw';
import type { LessonTarget } from '../types';

export const LESSON_TARGETS: readonly LessonTarget[] = [
  { id: 'blank-sheet', text: blankSheet, format: 'cp' },
  { id: 'first-crease', text: firstCrease, format: 'cp' },
  { id: 'both-diagonals', text: bothDiagonals, format: 'cp' },
  { id: 'inscribed-square', text: inscribedSquare, format: 'cp' },
  { id: 'perpendicular-start', text: perpendicularStart, format: 'cp' },
  { id: 'perpendicular-done', text: perpendicularDone, format: 'cp' },
  { id: 'bisector-start', text: bisectorStart, format: 'cp' },
  { id: 'bisector-done', text: bisectorDone, format: 'cp' },
  { id: 'parallel-start', text: parallelStart, format: 'cp' },
  { id: 'parallel-done', text: parallelDone, format: 'cp' },
  { id: 'mirror-start', text: mirrorStart, format: 'cp' },
  { id: 'mirror-done', text: mirrorDone, format: 'cp' },
  { id: 'maekawa-broken', text: maekawaBroken, format: 'cp' },
  { id: 'preliminary-base', text: preliminaryBase, format: 'fold' },
  { id: 'preliminary-base-extra-crease', text: preliminaryBaseExtraCrease, format: 'fold' },
];

const TARGET_BY_ID = new Map(LESSON_TARGETS.map((target) => [target.id, target]));

export function lessonTarget(id: string): LessonTarget | undefined {
  return TARGET_BY_ID.get(id);
}
