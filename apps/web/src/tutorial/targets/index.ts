/**
 * Target crease patterns referenced by lessons.
 *
 * Each is a `.cp` file — one segment per line, `<type> <x1> <y1> <x2> <y2>`,
 * where type 1 is the paper edge, 2 valley, 3 mountain, 4 auxiliary. The paper
 * is the editor's own 400×400 sheet spanning (-200,-200) to (200,200) with an
 * 8×8 grid, so a grid cell is 50 units. Authoring by hand keeps them reviewable
 * as diffs; the engine remains the only thing that *parses* them.
 */
import blankSheet from './blank-sheet.cp?raw';
import bothDiagonals from './both-diagonals.cp?raw';
import diagonalWithGuide from './diagonal-with-guide.cp?raw';
import diagonalsAfterDelete from './diagonals-after-delete.cp?raw';
import firstCrease from './first-crease.cp?raw';
import fourCreases from './four-creases.cp?raw';
import inscribedSquare from './inscribed-square.cp?raw';
import perpendicularStart from './perpendicular-start.cp?raw';
import perpendicularDone from './perpendicular-done.cp?raw';
import bisectorStart from './bisector-start.cp?raw';
import bisectorDone from './bisector-done.cp?raw';
import quarters from './quarters.cp?raw';
import mirrorStart from './mirror-start.cp?raw';
import mirrorDone from './mirror-done.cp?raw';
import type { LessonTarget } from '../types';

export const LESSON_TARGETS: readonly LessonTarget[] = [
  { id: 'blank-sheet', cp: blankSheet },
  { id: 'first-crease', cp: firstCrease },
  { id: 'both-diagonals', cp: bothDiagonals },
  { id: 'diagonal-with-guide', cp: diagonalWithGuide },
  { id: 'four-creases', cp: fourCreases },
  { id: 'diagonals-after-delete', cp: diagonalsAfterDelete },
  { id: 'inscribed-square', cp: inscribedSquare },
  { id: 'perpendicular-start', cp: perpendicularStart },
  { id: 'perpendicular-done', cp: perpendicularDone },
  { id: 'bisector-start', cp: bisectorStart },
  { id: 'bisector-done', cp: bisectorDone },
  { id: 'quarters', cp: quarters },
  { id: 'mirror-start', cp: mirrorStart },
  { id: 'mirror-done', cp: mirrorDone },
];

const TARGET_BY_ID = new Map(LESSON_TARGETS.map((target) => [target.id, target]));

export function lessonTarget(id: string): LessonTarget | undefined {
  return TARGET_BY_ID.get(id);
}
