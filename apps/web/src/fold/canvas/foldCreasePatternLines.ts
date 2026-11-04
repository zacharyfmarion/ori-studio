/**
 * The crease-pattern pane in Edit's vocabulary: each crease the pane shows as
 * the line Edit's document would hold for it, so the pane is drawn the way
 * Edit's canvas draws a crease pattern — its role inks, widths and dashes,
 * on the canvas's own ground, no paper — and reads the same as the pattern
 * Send to Edit lands.
 *
 * - The border is Edit's `Black0`, a fold its `Red1` or `Blue2` by the letter
 *   it has from the front.
 * - A flat crease — a precrease, or a fold undone — and a crease mark — a
 *   pinch, a segment (`foldPaneMark`) — are what Send to Edit lands them as
 *   (`foldEngineIoSendToEdit`): auxiliary lines, Edit's `Cyan3`, in the ink
 *   and line style Edit draws its auxiliary lines in.
 * - The instruction — the step's own creases and marks, or the ones a
 *   previewed fold would add — is the line a tool is drawing, kept apart for
 *   the pane to draw as Edit draws a tool's preview: in the crease colour it
 *   would make, solid (`useFoldCreasePatternStrokes`).
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
