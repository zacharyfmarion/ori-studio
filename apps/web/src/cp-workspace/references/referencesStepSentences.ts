/**
 * The sentence for one step of a ReferenceFinder construction, from the
 * extractor's labelled inputs.
 *
 * The core serialises each step's inputs as `p0`/`p1`/`l0`/`l1` and the
 * extractor flattens them, points first (`ExtractedStep.inputs`). Which slot
 * means what is fixed per axiom by the core's `Serialize` methods
 * (`third_party/reference-finder/src/core/class/refLine/*.cpp`), and the
 * wording below follows each class's own "how to" comment:
 *
 * - O1 `C2PC2P`: a crease through p0 and p1.
 * - O2 `P2P`: bring p0 to p1.
 * - O3 `L2L`: bring l0 to l1.
 * - O4 `L2LC2P`: bring l0 to itself so the crease goes through p0.
 * - O5 `P2LC2P`: bring p0 to l0 so the crease passes through p1.
 * - O6 `P2LP2L`: bring p0 to l0 and p1 to l1.
 * - O7 `L2LP2L`: bring **l1** onto itself so that p0 falls on **l0** (note: O7
 *   is the one axiom whose serialised slots run the other way — `Serialize`
 *   emits `rl2` as `l1` and `rl1` as `l0`, see
 *   `third_party/reference-finder/src/core/class/refLine/refLineL2LP2L.cpp:146-148`.
 *   The class comment above that constructor names its arguments `l1`/`l2` in
 *   the abstract, which is *not* the slot order on the wire).
 *
 * React-free; literal `t()` keys so the extractor sees them.
 */
import type { TFunction } from 'i18next';
import type { ExtractedStep } from './referenceFinder/extractor';
import { directionOfGroup, type ReferencesBreakdownRow, type ReferencesDirection } from './referencesBreakdown';
import {
  chosenWitness,
  type PrecreaseCornerName,
  type PrecreaseEdgeSide,
  type PrecreaseRef,
  type PrecreaseSequence,
} from './precreaseSequence';

/** How many point and line inputs each axiom serialises, in that order. */
export const STEP_INPUT_ARITY: Readonly<Record<number, { points: number; lines: number }>> = {
  0: { points: 0, lines: 2 },
  1: { points: 2, lines: 0 },
  2: { points: 2, lines: 0 },
  3: { points: 0, lines: 2 },
  4: { points: 1, lines: 1 },
  5: { points: 2, lines: 1 },
  6: { points: 2, lines: 2 },
  7: { points: 1, lines: 2 },
};

/** Split a step's flattened inputs back into its point and line slots. */
export function splitStepInputs(step: Pick<ExtractedStep, 'axiom' | 'inputs'>): {
  points: string[];
  lines: string[];
} {
  const arity = STEP_INPUT_ARITY[step.axiom] ?? { points: 0, lines: 0 };
  return {
    points: step.inputs.slice(0, arity.points),
    lines: step.inputs.slice(arity.points, arity.points + arity.lines),
  };
}

/**
 * Whether a label names a line. The core assigns `A`–`J` to lines and `P`–`Z`
 * to marks (`solution.ts`); the sheet's own lines and corners have names.
 */
export function isLineLabel(label: string): boolean {
  if (['s', 'n', 'w', 'e', 'sw_ne', 'nw_se'].includes(label)) return true;
  if (['sw', 'se', 'nw', 'ne'].includes(label)) return false;
  return /^[A-O]$/.test(label);
}

/** A reference's name in a sentence: the sheet's own by description, a step's by letter. */
export function referenceName(t: TFunction, label: string): string {
  switch (label) {
    case 's':
      return t('panels:references.ref.bottomEdge', 'the bottom edge');
    case 'n':
      return t('panels:references.ref.topEdge', 'the top edge');
    case 'w':
      return t('panels:references.ref.leftEdge', 'the left edge');
    case 'e':
      return t('panels:references.ref.rightEdge', 'the right edge');
    case 'sw_ne':
      return t('panels:references.ref.diagonalSwNe', 'the bottom-left to top-right diagonal');
    case 'nw_se':
      return t('panels:references.ref.diagonalNwSe', 'the top-left to bottom-right diagonal');
    case 'sw':
      return t('panels:references.ref.cornerSw', 'the bottom-left corner');
    case 'se':
      return t('panels:references.ref.cornerSe', 'the bottom-right corner');
    case 'nw':
      return t('panels:references.ref.cornerNw', 'the top-left corner');
    case 'ne':
      return t('panels:references.ref.cornerNe', 'the top-right corner');
    default:
      return isLineLabel(label)
        ? t('panels:references.ref.line', 'line {{name}}', { name: label })
        : t('panels:references.ref.point', 'point {{name}}', { name: label });
  }
}

/**
 * The instruction for one step. Unknown axioms (the core's enum is closed, so
 * this is a wire-shape change) fall back to naming the fold and its inputs
 * rather than inventing a Huzita–Justin reading.
 */
export function describeStep(t: TFunction, step: ExtractedStep): string {
  const { points, lines } = splitStepInputs(step);
  const name = (label: string | undefined) => (label ? referenceName(t, label) : '?');
  const x = step.label || '?';
  const p0 = name(points[0]);
  const p1 = name(points[1]);
  const l0 = name(lines[0]);
  const l1 = name(lines[1]);
  let sentence: string;
  switch (step.axiom) {
    case 0:
      sentence = t('panels:references.step.mark', 'Mark {{x}} where {{l0}} meets {{l1}}.', {
        x,
        l0,
        l1,
      });
      break;
    case 1:
      sentence = t('panels:references.step.axiom1', 'Fold {{x}} through {{p0}} and {{p1}}.', {
        x,
        p0,
        p1,
      });
      break;
    case 2:
      sentence = t('panels:references.step.axiom2', 'Fold {{x}}, bringing {{p0}} onto {{p1}}.', {
        x,
        p0,
        p1,
      });
      break;
    case 3:
      sentence = t('panels:references.step.axiom3', 'Fold {{x}}, bringing {{l0}} onto {{l1}}.', {
        x,
        l0,
        l1,
      });
      break;
    case 4:
      sentence = t(
        'panels:references.step.axiom4',
        'Fold {{x}} through {{p0}}, folding {{l0}} onto itself.',
        { x, p0, l0 }
      );
      break;
    case 5:
      sentence = t(
        'panels:references.step.axiom5',
        'Fold {{x}} through {{p1}}, bringing {{p0}} onto {{l0}}.',
        { x, p0, p1, l0 }
      );
      break;
    case 6:
      sentence = t(
        'panels:references.step.axiom6',
        'Fold {{x}}, bringing {{p0}} onto {{l0}} and {{p1}} onto {{l1}}.',
        { x, p0, p1, l0, l1 }
      );
      break;
    case 7:
      // O7 alone serialises its lines the other way round: the self-folded
      // line arrives in `l1` and the landing line in `l0`. The placeholders are
      // named by role so a translator cannot re-plant the swap.
      sentence = t(
        'panels:references.step.axiom7',
        'Fold {{x}}, folding {{lSelf}} onto itself so that {{p0}} lands on {{lLand}}.',
        { x, p0, lSelf: l1, lLand: l0 }
      );
      break;
    default:
      sentence = t('panels:references.step.unknown', 'Fold {{x}} using {{inputs}}.', {
        x,
        inputs: step.inputs.map((label) => referenceName(t, label)).join(', '),
      });
  }
  if (step.pinch) {
    return `${sentence} ${t('panels:references.step.pinch', 'Pinch only — just the mark is needed.')}`;
  }
  return sentence;
}

// ---------------------------------------------------------------------------
// Planner steps
// ---------------------------------------------------------------------------
//
// The planner does not label its references the way ReferenceFinder does; it
// ships **typed refs** (`crates/oristudio-precrease/src/predicates.rs`), which
// is what lets a sentence say "the crease from step 12" and "where step 3
// meets step 12" instead of "line C" and "point P". Resolving one needs the
// whole sequence — a state line id becomes a step id through `sequence.lines`,
// and an edge's side and a corner's name are carried only on the refs
// themselves — so the lookups are built once per sequence.

/** Cross-references a sequence's typed refs need, built once. */
export interface PlannerRefIndex {
  /** State line id → which sheet edge it is. */
  edgeSides: Map<number, PrecreaseEdgeSide>;
  /** State point id → which sheet corner it is. */
  corners: Map<number, PrecreaseCornerName>;
  /** State line id → the presentation id of the step that folds it. */
  stepOfLine: Map<number, number>;
  /** State point id → the state lines through it. */
  linesOfPoint: Map<number, number[]>;
}

/**
 * Build the index. Edge sides and corner names come from the refs rather than
 * from `sequence.lines`, which records a line's tag but not which edge it is;
 * any sequence that names an edge at all therefore names its side.
 */
export function plannerRefIndex(sequence: PrecreaseSequence): PlannerRefIndex {
  const edgeSides = new Map<number, PrecreaseEdgeSide>();
  const corners = new Map<number, PrecreaseCornerName>();
  const stepOfLine = new Map<number, number>();
  const linesOfPoint = new Map<number, number[]>();
  for (const entry of sequence.lines) {
    if (entry.step !== null) stepOfLine.set(entry.id, entry.step);
  }
  for (const point of sequence.points) linesOfPoint.set(point.id, point.lines);
  for (const step of sequence.steps) {
    for (const witness of step.witnesses) {
      for (const ref of witness.inputs) {
        if (ref.kind === 'edge') edgeSides.set(ref.id, ref.side);
        else if (ref.kind === 'corner') corners.set(ref.id, ref.corner);
      }
    }
  }
  return { edgeSides, corners, stepOfLine, linesOfPoint };
}

function edgeName(t: TFunction, side: PrecreaseEdgeSide): string {
  switch (side) {
    case 'bottom':
      return t('panels:references.ref.bottomEdge', 'the bottom edge');
    case 'top':
      return t('panels:references.ref.topEdge', 'the top edge');
    case 'left':
      return t('panels:references.ref.leftEdge', 'the left edge');
    case 'right':
      return t('panels:references.ref.rightEdge', 'the right edge');
  }
}

function cornerName(t: TFunction, corner: PrecreaseCornerName): string {
  switch (corner) {
    case 'sw':
      return t('panels:references.ref.cornerSw', 'the bottom-left corner');
    case 'se':
      return t('panels:references.ref.cornerSe', 'the bottom-right corner');
    case 'nw':
      return t('panels:references.ref.cornerNw', 'the top-left corner');
    case 'ne':
      return t('panels:references.ref.cornerNe', 'the top-right corner');
  }
}

/** How a state line reads in a sentence: an edge by name, a crease by its step. */
function plannerLineName(t: TFunction, index: PlannerRefIndex, id: number): string {
  const side = index.edgeSides.get(id);
  if (side) return edgeName(t, side);
  const step = index.stepOfLine.get(id);
  if (step !== undefined) {
    return t('panels:references.ref.stepCrease', 'the crease from step {{n}}', { n: step });
  }
  return t('panels:references.ref.existingCrease', 'an existing crease');
}

/**
 * A planner reference in a sentence. A mark is named by what makes it — "where
 * the left edge meets the crease from step 12" — because a folder can find
 * that and cannot find "point 47".
 */
export function plannerReferenceName(
  t: TFunction,
  index: PlannerRefIndex,
  ref: PrecreaseRef
): string {
  switch (ref.kind) {
    case 'edge':
      return edgeName(t, ref.side);
    case 'corner':
      return cornerName(t, ref.corner);
    case 'line':
      return plannerLineName(t, index, ref.id);
    case 'point': {
      const corner = index.corners.get(ref.id);
      if (corner) return cornerName(t, corner);
      const lines = index.linesOfPoint.get(ref.id) ?? [];
      if (lines.length >= 2) {
        return t('panels:references.ref.intersection', 'where {{a}} meets {{b}}', {
          a: plannerLineName(t, index, lines[0]),
          b: plannerLineName(t, index, lines[1]),
        });
      }
      if (lines.length === 1) {
        return t('panels:references.ref.markOn', 'the mark on {{a}}', {
          a: plannerLineName(t, index, lines[0]),
        });
      }
      return t('panels:references.ref.mark', 'the mark');
    }
  }
}

/**
 * The instruction for one planner step, from its chosen witness. The witness's
 * `inputs` are in the axiom's own order (`predicates.rs`), which is not
 * ReferenceFinder's, so this is a separate reading rather than a reuse of
 * {@link describeStep}: O5 is `[pivot, p, m]` here and `[p, pivot, m]` there.
 */
export function describePlannerStep(
  t: TFunction,
  sequence: PrecreaseSequence,
  index: PlannerRefIndex,
  stepIndex: number
): string {
  const step = sequence.steps[stepIndex];
  if (!step) return '';
  const witness = chosenWitness(step);
  if (!witness) {
    return t('panels:references.planStep.free', 'This line is already on the sheet.');
  }
  const name = (ref: PrecreaseRef | undefined) =>
    ref ? plannerReferenceName(t, index, ref) : '?';
  const [i0, i1, i2, i3] = witness.inputs;
  let sentence: string;
  switch (witness.axiom) {
    case 1:
      sentence = t('panels:references.planStep.axiom1', 'Fold through {{a}} and {{b}}.', {
        a: name(i0),
        b: name(i1),
      });
      break;
    case 2:
      sentence = t('panels:references.planStep.axiom2', 'Fold {{a}} onto {{b}}.', {
        a: name(i0),
        b: name(i1),
      });
      break;
    case 3:
      sentence = t('panels:references.planStep.axiom3', 'Fold {{a}} onto {{b}}.', {
        a: name(i0),
        b: name(i1),
      });
      break;
    case 4:
      sentence = t(
        'panels:references.planStep.axiom4',
        'Fold through {{a}}, folding {{b}} onto itself.',
        { a: name(i0), b: name(i1) }
      );
      break;
    case 5:
      sentence = t(
        'panels:references.planStep.axiom5',
        'Fold through {{a}}, bringing {{b}} onto {{c}}.',
        { a: name(i0), b: name(i1), c: name(i2) }
      );
      break;
    case 6:
      sentence = t(
        'panels:references.planStep.axiom6',
        'Fold {{a}} onto {{b}} and {{c}} onto {{d}}.',
        { a: name(i0), b: name(i1), c: name(i2), d: name(i3) }
      );
      break;
    case 7:
      sentence = t(
        'panels:references.planStep.axiom7',
        'Fold {{b}} onto itself so that {{a}} lands on {{c}}.',
        { a: name(i0), b: name(i1), c: name(i2) }
      );
      break;
    default:
      sentence = t('panels:references.planStep.unknown', 'Fold using {{inputs}}.', {
        inputs: witness.inputs.map((ref) => plannerReferenceName(t, index, ref)).join(', '),
      });
  }
  if (step.extent.kind === 'pinches') {
    return `${sentence} ${t('panels:references.planStep.pinch', 'Pinch only — just the mark is needed.')}`;
  }
  if (step.kind === 'aux' && step.visible) {
    return `${sentence} ${t('panels:references.planStep.visibleAux', 'This crease will show in the finished model.')}`;
  }
  return sentence;
}

/** How a direction reads in a row's sentence. */
export function describeDirection(t: TFunction, direction: ReferencesDirection): string {
  switch (direction.kind) {
    case 'horizontal':
      return t('panels:references.direction.horizontal', 'horizontally');
    case 'vertical':
      return t('panels:references.direction.vertical', 'vertically');
    case 'diagonal-up':
      return t('panels:references.direction.diagonalUp', 'on the rising diagonal');
    case 'diagonal-down':
      return t('panels:references.direction.diagonalDown', 'on the falling diagonal');
    case 'angle':
      return t('panels:references.direction.angle', 'at {{deg}}°', { deg: direction.degrees });
  }
}

/**
 * A collapsed row's headline: what is folded, which way, and how many. The
 * count is the chip, so the sentence names the direction and the row's kind
 * and leaves the number to the chip.
 */
export function describeBreakdownRow(t: TFunction, row: ReferencesBreakdownRow): string {
  const direction = describeDirection(t, directionOfGroup(row.directionAngle));
  if (row.kind === 'aux') {
    return row.pinched
      ? t('panels:references.row.auxPinch', 'Pinch a landmark {{direction}}', { direction })
      : t('panels:references.row.aux', 'Fold a landmark crease {{direction}}', { direction });
  }
  return t('panels:references.row.cp', 'Fold {{direction}}', { direction });
}

/** The axiom a row's steps use, as a folder would name the move. */
export function describeAxiom(t: TFunction, axiom: number): string {
  switch (axiom) {
    case 1:
      return t('panels:references.axiom.o1', 'through two points');
    case 2:
      return t('panels:references.axiom.o2', 'point onto point');
    case 3:
      return t('panels:references.axiom.o3', 'edge onto edge');
    case 4:
      return t('panels:references.axiom.o4', 'perpendicular through a point');
    case 5:
      return t('panels:references.axiom.o5', 'point onto a line, through a point');
    case 6:
      return t('panels:references.axiom.o6', 'two points onto two lines');
    case 7:
      return t('panels:references.axiom.o7', 'point onto a line, perpendicular');
    default:
      return t('panels:references.axiom.free', 'already on the sheet');
  }
}
