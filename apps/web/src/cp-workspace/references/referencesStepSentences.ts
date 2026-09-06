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
 * - O7 `L2LP2L`: bring l0 onto itself so that p0 falls on l1.
 *
 * React-free; literal `t()` keys so the extractor sees them.
 */
import type { TFunction } from 'i18next';
import type { ExtractedStep } from './referenceFinder/extractor';

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
      sentence = t(
        'panels:references.step.axiom7',
        'Fold {{x}}, folding {{l0}} onto itself so that {{p0}} lands on {{l1}}.',
        { x, p0, l0, l1 }
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
