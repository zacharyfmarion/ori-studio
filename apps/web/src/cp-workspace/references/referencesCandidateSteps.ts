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
import {
  EXTRACT_TOLERANCE,
  type ExtractedSolution,
  type ExtractedStep,
} from './referenceFinder/extractor';
import type { Diagram, OriginalMarkName, RawSolution } from './referenceFinder/solution';
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
 * note last — after the mark the pinch is for has been named. `sheet` is
 * the paper in ReferenceFinder's units, which decides how a diagonal is made.
 */
export function describeCandidateStep(
  t: TFunction,
  solution: ExtractedSolution,
  step: ReferencesCandidateStep,
  sheet: RfSheet
): string {
  if (step.kind === 'diagonal') return describeDiagonalStep(t, step.diagonal, sheet);
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

type SheetPoint = readonly [number, number];

/** The sheet's corners by ReferenceFinder's names (y up, the lower-left at the origin). */
function sheetCorners(sheet: RfSheet): Record<OriginalMarkName, SheetPoint> {
  const { width: w, height: h } = sheet;
  return { sw: [0, 0], se: [w, 0], nw: [0, h], ne: [w, h] };
}

/** How a diagonal step is made and drawn, in ReferenceFinder's sheet coordinates. */
export interface DiagonalStep {
  /** The corners the crease joins, sw before ne or nw before se, and where they are. */
  through: readonly [OriginalMarkName, OriginalMarkName];
  ends: readonly [SheetPoint, SheetPoint];
  /** What moves and where it lands: the lower of the two mating points first. */
  from: SheetPoint;
  to: SheetPoint;
  /**
   * The corners `from` and `to` are, on a square — the fold brings one onto
   * the other. Null on a rectangle, where the fold is made through `through`.
   */
  onto: readonly [OriginalMarkName, OriginalMarkName] | null;
}

/**
 * The crease runs corner to corner, and those two corners stay put: what a
 * folder brings together is the paper on either side of it. On a square that
 * is the other two corners, one onto the other — the reading the planner
 * gives the same fold, whose O2 pairs are enumerated in the sheet's corner
 * order (`crates/oristudio-precrease/src/predicates.rs`, `scan_points`) and
 * whose first of the pair moves — so the bottom one moves. The sentence
 * names the two, and the rings mark them.
 *
 * On a rectangle a crease through two corners carries neither of the others
 * onto anything, so it is a fold sighted through the two it joins, and the
 * motion is the one ReferenceFinder draws for that
 * (`RefLine_C2P_C2P_Logic::DrawSelf`, `third_party/reference-finder/src/core/
 * class/refLine/refLineC2PC2P.cpp`): the perpendicular to the fold through the
 * middle of the two sighted points, clipped to the paper at the nearer of
 * its exits on either side — the two edge points that meet. On a square those
 * exits are the other two corners, so the arrow is one construction in both
 * readings; only the words and the rings change.
 */
export function diagonalStep(diagonal: FreeDiagonal, sheet: RfSheet): DiagonalStep {
  const { width: w, height: h } = sheet;
  const corners = sheetCorners(sheet);
  const through: DiagonalStep['through'] = diagonal === 'sw_ne' ? ['sw', 'ne'] : ['nw', 'se'];
  const ends: DiagonalStep['ends'] = [corners[through[0]], corners[through[1]]];
  // A normal of the crease pointing to its upper side — the crease's own
  // direction turned a right angle — and how far along it the perpendicular
  // through the sheet's centre reaches the nearer edge. Unnormalised, so a
  // square's exits land on its corners exactly.
  const up: SheetPoint = diagonal === 'sw_ne' ? [-h, w] : [h, w];
  const reach = Math.min(w / (2 * h), h / (2 * w));
  const from: SheetPoint = [w / 2 - reach * up[0], h / 2 - reach * up[1]];
  const to: SheetPoint = [w / 2 + reach * up[0], h / 2 + reach * up[1]];
  const square = Math.abs(w - h) <= EXTRACT_TOLERANCE;
  const onto: DiagonalStep['onto'] = !square
    ? null
    : diagonal === 'sw_ne'
      ? ['se', 'nw']
      : ['sw', 'ne'];
  return { through, ends, from, to, onto };
}

/**
 * The card for a diagonal step, in ReferenceFinder's sheet coordinates: the
 * sheet, the diagonal as the valley it is folded as, a ring on each reference
 * the sentence names, and the motion that makes it. The canvas draws the same
 * primitives mapped onto the pattern (`diagramInModel`), so the two pictures
 * are one description.
 */
export function diagonalStepDiagram(diagonal: FreeDiagonal, sheet: RfSheet): StepDiagramModel {
  const { ends, from, to, onto } = diagonalStep(diagonal, sheet);
  const named: readonly [SheetPoint, SheetPoint] = onto ? [from, to] : ends;
  const model: StepDiagramModel = {
    sheet: { width: sheet.width, height: sheet.height },
    primitives: [
      { kind: 'sheet', width: sheet.width, height: sheet.height },
      { kind: 'line', from: ends[0], to: ends[1], style: 'valley' },
      { kind: 'point', at: named[0], style: 'highlight' },
      { kind: 'point', at: named[1], style: 'highlight' },
    ],
  };
  const out = foldArrowArc(from, to, [sheet.width / 2, sheet.height / 2]);
  if (out) model.primitives.push({ kind: 'fold-arrow', out });
  return model;
}

/**
 * "Fold the bottom-right corner onto the top-left corner, creasing the
 * diagonal." — or, on a rectangle, "Fold through the bottom-left corner and
 * the top-right corner, creasing the diagonal."
 */
export function describeDiagonalStep(t: TFunction, diagonal: FreeDiagonal, sheet: RfSheet): string {
  const { through, onto } = diagonalStep(diagonal, sheet);
  if (onto) {
    return t('panels:references.step.diagonal', 'Fold {{a}} onto {{b}}, creasing the diagonal.', {
      a: referenceName(t, onto[0]),
      b: referenceName(t, onto[1]),
    });
  }
  return t(
    'panels:references.step.diagonalThrough',
    'Fold through {{a}} and {{b}}, creasing the diagonal.',
    { a: referenceName(t, through[0]), b: referenceName(t, through[1]) }
  );
}
