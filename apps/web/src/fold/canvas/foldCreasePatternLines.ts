/**
 * Front-relative crease assignments, using the same vocabulary as Send to
 * Edit. The view resolves these to the paper style's pens, reversing mountain
 * and valley on the back. Flat creases and marks use the auxiliary pen;
 * instructions stay separate so they can use the diagram-crease pens.
 *
 * Which creases are shown, and which are the instruction, is the pane's one
 * rule (`foldPaneCrease`), shared with the paper picture of the same state
 * (`creasePatternPaperScene`). Coordinates are sheet units, y up: the pane's
 * model space, which it maps to user space itself (`foldUnitToUser`).
 *
 * Pure: no React, no store, no DOM.
 */
import type { CpLineSegmentInput } from '../../cp-workspace/adapters/cpSnapshotToScene';
import type { Point } from '../../lib/geometry';
import type { FoldLetter, FoldScene } from '../engine/foldEngineWire';
import { foldPaneCrease, foldPaneMark, type FoldPaneCreaseOptions } from './foldPaneScenes';

/** One line of the instruction: where it runs, and which way it folds. */
export interface FoldInstructionLine {
  a: Point;
  b: Point;
  letter: FoldLetter;
}

export interface FoldCreasePatternLines {
  /**
   * The creases, as Edit's document lines, in painter's order: the flat
   * creases under the folds, the border over both, so a crease that ends on
   * the edge never breaks the outline.
   */
  creases: CpLineSegmentInput[];
  /** The instruction, drawn over the pattern; empty when there is none. */
  instruction: FoldInstructionLine[];
}

/** Edit's line colour for a fold, by its letter from the front. */
export function foldLetterLineColor(letter: FoldLetter): 'Red1' | 'Blue2' {
  return letter === 'mountain' ? 'Red1' : 'Blue2';
}

/** Edit's line colour for an auxiliary line (Oriedita's `CYAN_3`): what a flat crease is drawn as. */
export const FOLD_AUX_LINE_COLOR = 'Cyan3';

/** The pane's creases of a state, in Edit's vocabulary. */
export function creasePatternPaneLines(scene: FoldScene, options: FoldPaneCreaseOptions): FoldCreasePatternLines {
  const flat: CpLineSegmentInput[] = [];
  const folds: CpLineSegmentInput[] = [];
  const border: CpLineSegmentInput[] = [];
  const instruction: FoldInstructionLine[] = [];
  for (const crease of scene.creases) {
    const shown = foldPaneCrease(crease, options);
    if (!shown) continue;
    const a = crease.from;
    const b = crease.to;
    switch (shown.as) {
      case 'edge':
        border.push({ a, b, color: 'Black0' });
        break;
      case 'fold':
        folds.push({ a, b, color: foldLetterLineColor(shown.letter) });
        break;
      case 'flat':
        flat.push({ a, b, color: FOLD_AUX_LINE_COLOR });
        break;
      case 'instruction':
        instruction.push({ a, b, letter: shown.letter });
        break;
    }
  }
  // A crease mark: an auxiliary line as a flat crease is, or the instruction it is.
  for (const mark of scene.crease_marks ?? []) {
    const shown = foldPaneMark(mark, options);
    if (!shown) continue;
    if (shown.as === 'instruction') instruction.push({ a: mark.from, b: mark.to, letter: shown.letter });
    else flat.push({ a: mark.from, b: mark.to, color: FOLD_AUX_LINE_COLOR });
  }
  return { creases: [...flat, ...folds, ...border], instruction };
}
