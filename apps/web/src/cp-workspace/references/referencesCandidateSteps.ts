/**
 * The steps a ReferenceFinder answer is *read* as: the sheet's diagonals it
 * leans on, folded first, then one card per diagram of ReferenceFinder's own.
 *
 * ReferenceFinder treats both diagonals as rank-1 originals, so they never
 * appear as a step of its own — a solution that folds a corner onto the
 * diagonal simply names the diagonal, and the workspace used to say so in a
 * footnote: "Also needs the sheet diagonal(s)…". Zach (2026-09-15): "then it
 * should be a part of the folding sequence. The sequence should always start
 * from the empty square." So each diagonal the answer uses is a step, the
 * first ones, drawn and described here the way the planner draws a corner
 * onto a corner; ReferenceFinder's follow, renumbered after them.
 *
 * ReferenceFinder's own steps are not its cards. Its `steps` list has an
 * entry per reference — a fold makes a line, an intersection makes a mark —
 * but it draws one diagram per *fold*, and the mark that fold is for is
 * drawn in the same picture (`third_party/reference-finder/src/core/class/
 * refBase.cpp`, `DrawDiagram`: the action line, and the mark right after it
 * in action style too, unless that mark is the very last step, which gets a
 * standalone diagram). A card per step therefore showed every fold twice —
 * once for the fold, once more for its mark, borrowing the same picture —
 * which is what Zach saw on the sheet centre's alternatives: "steps 2 and 3
 * are exactly the same. Same with 4 and 5, 6 and 7, and 8 and 9." A card is
 * a diagram, and its sentence names everything the diagram introduces.
 *
 * Pure: the same list drives the strip's cards, the canvas and the step
 * navigation, so the three cannot count the steps differently.
 */
import type { TFunction } from 'i18next';
import type { ExtractedSolution, ExtractedStep } from './referenceFinder/extractor';
import type { Diagram, RawSolution } from './referenceFinder/solution';
import { finalMarkDiagram, type StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { pinchNote, referenceName, stepSentence } from './referencesStepSentences';
import { foldArrowArc } from './stepDiagramGeometry';

/** One of the sheet's two diagonals, by ReferenceFinder's name for it. */
export type FreeDiagonal = ExtractedSolution['freeDiagonals'][number];

/**
 * One of ReferenceFinder's diagrams: the fold it draws and the marks it
 * introduces, as indices into `solution.steps`, in the order they are read.
 */
export interface ReferencesCandidateRfStep {
  kind: 'rf';
  /** The steps this card covers — its fold, and the marks first drawn in it. */
  steps: readonly number[];
  /**
   * Which `diagrams[]` entry draws it; null for the trailing standalone
   * diagram the core prints for a point query's final mark.
   */
  diagramIndex: number | null;
}

export type ReferencesCandidateStep =
  /** One of the sheet's diagonals the answer leans on: fold corner onto corner. */
  | { kind: 'diagonal'; diagonal: FreeDiagonal }
  | ReferencesCandidateRfStep;

/**
 * ReferenceFinder's steps grouped as it draws them, one group per diagram.
 *
 * `BuildDiagrams` makes a diagram per action line, and `DrawDiagram` draws the
 * mark right after that line in it — the mark the fold is for — unless the
 * mark is the last step of all, which gets a diagram of its own. Any other
 * mark (one made only of the sheet's lines before any fold, or the second of
 * two in a row) is first drawn, as an input, in the diagram of the next fold,
 * so it is read there, before the fold.
 */
function referenceFinderCards(steps: readonly ExtractedStep[]): ReferencesCandidateRfStep[] {
  const cards: ReferencesCandidateRfStep[] = [];
  let pending: number[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.diagramIndex === null) {
      pending.push(i);
      continue;
    }
    const covered = [...pending, i];
    pending = [];
    // refBase.cpp: `act < ss - 2 && !sSequence[act + 1]->IsLine()`.
    const next = steps[i + 1];
    if (next && next.diagramIndex === null && i + 1 < steps.length - 1) {
      covered.push(i + 1);
      i += 1;
    }
    cards.push({ kind: 'rf', steps: covered, diagramIndex: step.diagramIndex });
  }
  if (pending.length > 0) cards.push({ kind: 'rf', steps: pending, diagramIndex: null });
  return cards;
}

/** The answer's steps in reading order: the diagonals it uses, then its own. */
export function candidateViewSteps(solution: ExtractedSolution): ReferencesCandidateStep[] {
  return [
    ...solution.freeDiagonals.map((diagonal) => ({ kind: 'diagonal' as const, diagonal })),
    ...referenceFinderCards(solution.steps),
  ];
}

export function candidateStepCount(solution: ExtractedSolution | null): number {
  if (!solution) return 0;
  return candidateViewSteps(solution).length;
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

/**
 * The diagram a ReferenceFinder card draws: its fold's own, or the trailing
 * standalone one for a final mark. Null when the core printed none.
 */
export function candidateStepDiagram(raw: RawSolution, step: ReferencesCandidateRfStep): Diagram | null {
  if (step.diagramIndex !== null) return raw.diagrams[step.diagramIndex] ?? null;
  return finalMarkDiagram(raw);
}

/**
 * A card's sentence: each step it covers, in reading order, and the pinch
 * note last — after the mark the pinch is for has been named.
 */
export function describeCandidateStep(
  t: TFunction,
  solution: ExtractedSolution,
  step: ReferencesCandidateStep
): string {
  if (step.kind === 'diagonal') return describeDiagonalStep(t, step.diagonal);
  const covered = step.steps.map((index) => solution.steps[index]).filter((s) => s !== undefined);
  const sentences = covered.map((s) => stepSentence(t, s));
  if (covered.some((s) => s.pinch)) sentences.push(pinchNote(t));
  return sentences.join(' ');
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
