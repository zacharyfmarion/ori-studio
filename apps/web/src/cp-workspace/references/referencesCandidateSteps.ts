/**
 * The steps a ReferenceFinder answer is *read* as: the sheet's diagonals it
 * leans on, folded first, then ReferenceFinder's own.
 *
 * ReferenceFinder treats both diagonals as rank-1 originals, so they never
 * appear as a step of its own — a solution that folds a corner onto the
 * diagonal simply names the diagonal, and the workspace used to say so in a
 * footnote: "Also needs the sheet diagonal(s)…". Zach (2026-09-15): "then it
 * should be a part of the folding sequence. The sequence should always start
 * from the empty square." So each diagonal the answer uses is a step, the
 * first ones, drawn and described here the way the planner draws a corner
 * onto a corner; ReferenceFinder's steps follow, renumbered after them.
 *
 * Pure: the same list drives the strip's cards, the canvas and the step
 * navigation, so the three cannot count the steps differently.
 */
import type { TFunction } from 'i18next';
import type { ExtractedSolution } from './referenceFinder/extractor';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { referenceName } from './referencesStepSentences';
import { foldArrowArc } from './stepDiagramGeometry';

/** One of the sheet's two diagonals, by ReferenceFinder's name for it. */
export type FreeDiagonal = ExtractedSolution['freeDiagonals'][number];

export type ReferencesCandidateStep =
  /** One of the sheet's diagonals the answer leans on: fold corner onto corner. */
  | { kind: 'diagonal'; diagonal: FreeDiagonal }
  /** One of ReferenceFinder's own steps, by its index in `solution.steps`. */
  | { kind: 'rf'; index: number };

/** The answer's steps in reading order: the diagonals it uses, then its own. */
export function candidateViewSteps(solution: ExtractedSolution): ReferencesCandidateStep[] {
  return [
    ...solution.freeDiagonals.map((diagonal) => ({ kind: 'diagonal' as const, diagonal })),
    ...solution.steps.map((_, index) => ({ kind: 'rf' as const, index })),
  ];
}

export function candidateStepCount(solution: ExtractedSolution | null): number {
  if (!solution) return 0;
  return solution.freeDiagonals.length + solution.steps.length;
}

/**
 * Clamp a step index into the answer's reading order, so a stale `activeStep`
 * (from a candidate with more steps) still names a step rather than nothing.
 */
export function clampCandidateStep(solution: ExtractedSolution | null, index: number): number {
  const count = candidateStepCount(solution);
  if (count === 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.trunc(index)));
}

/** A sheet's size in ReferenceFinder's units, where the longer side is 1. */
export interface RfSheet {
  width: number;
  height: number;
}

/**
 * The two corners a diagonal joins, in ReferenceFinder's sheet coordinates
 * (y up, the lower-left corner at the origin): the one that moves first, the
 * one it lands on second.
 */
export function diagonalCorners(
  diagonal: FreeDiagonal,
  sheet: RfSheet
): { from: [number, number]; to: [number, number]; names: [string, string] } {
  return diagonal === 'sw_ne'
    ? { from: [0, 0], to: [sheet.width, sheet.height], names: ['sw', 'ne'] }
    : { from: [0, sheet.height], to: [sheet.width, 0], names: ['nw', 'se'] };
}

/**
 * The card for a diagonal step, in ReferenceFinder's sheet coordinates: the
 * sheet, the diagonal as the valley it is folded as, a mark on each corner,
 * and the corner's motion onto the other. The canvas draws the same
 * primitives mapped onto the pattern (`diagramInModel`), so the two
 * pictures are one description.
 */
export function diagonalStepDiagram(diagonal: FreeDiagonal, sheet: RfSheet): StepDiagramModel {
  const { from, to } = diagonalCorners(diagonal, sheet);
  const model: StepDiagramModel = {
    sheet: { width: sheet.width, height: sheet.height },
    primitives: [
      { kind: 'sheet', width: sheet.width, height: sheet.height },
      { kind: 'line', from, to, style: 'valley' },
      { kind: 'point', at: from, style: 'highlight' },
      { kind: 'point', at: to, style: 'highlight' },
    ],
  };
  const out = foldArrowArc(from, to, [sheet.width / 2, sheet.height / 2]);
  if (out) model.primitives.push({ kind: 'fold-arrow', out });
  return model;
}

/** "Fold the bottom-left corner onto the top-right corner, creasing the diagonal." */
export function describeDiagonalStep(t: TFunction, diagonal: FreeDiagonal): string {
  const { names } = diagonalCorners(diagonal, { width: 1, height: 1 });
  return t('panels:references.step.diagonal', 'Fold {{a}} onto {{b}}, creasing the diagonal.', {
    a: referenceName(t, names[0]),
    b: referenceName(t, names[1]),
  });
}
