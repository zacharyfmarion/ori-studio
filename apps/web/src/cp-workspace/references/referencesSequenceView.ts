/**
 * The sequence as it is *read*, which is not quite the sequence the planner
 * emits.
 *
 * The planner answers a geometry question — which folds construct these lines,
 * in an order where every reference already exists. It says nothing about which
 * way a crease folds, and a fold made by bringing paper up and over makes a
 * valley on the face you are looking at. So a plan followed literally leaves a
 * sheet of valleys, and a crease pattern that wanted mountains is not folded.
 *
 * **Why the fix is at the end and not throughout.** Measured on the planner's
 * own fixtures, 57 of iguana-c0's 91 steps make a chord that is mountain along
 * some spans and valley along others; one fold along that chord cannot produce
 * both. Nor can the sequence be regrouped by side: the order is a topological
 * order over "the chosen witness's inputs must already be folded", and `extent`,
 * `visible`, `unlocks`, `Step.id` and `LineEntry.step` are all computed from the
 * emitted order, so a consumer cannot reorder even within a round.
 *
 * What makes it tractable is that **a reference needs the crease to exist, not
 * to point a particular way**. So the construction runs unchanged from the
 * front, and the directions are settled afterwards, in one pass from the back:
 *
 * 1. the planner's steps, folded from the front — every crease a valley;
 * 2. turn the paper over;
 * 3. reverse the creases the pattern wants as mountains, which from the back are
 *    valleys, which is why this is one operation and not a fight;
 * 4. turn it back, so the pattern is read from the side its assignment is
 *    stated in.
 *
 * Two flips, whatever the pattern, and it is what a folder does anyway. Steps
 * 2–4 appear only when the sheet actually has mountain creases (plan D17).
 */
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { ReferencesFlatStep } from './referencesBreakdown';
import { mountainLineIds } from './referencesFoldDirection';
import type { ReferencesPlanVariant } from './referencesResults';

/** Which face of the paper is up while a step is performed. */
export type ReferencesPaperSide = 'front' | 'back';

export type ReferencesViewStep =
  /** One of the planner's folds. */
  | { kind: 'fold'; side: 'front'; component: number; step: number }
  /** The finished front pattern, with the turn-over arrow on it. */
  | { kind: 'turn-over'; side: 'front'; component: number }
  /** Seen from the back: the creases to reverse. */
  | { kind: 'reverse'; side: 'back'; component: number; lineIds: number[] }
  /** The finished pattern, read from the front. */
  | { kind: 'done'; side: 'front'; component: number };

/** The planner step a view step stands for, or null for a flip step. */
export function planStepOf(step: ReferencesViewStep): ReferencesFlatStep | null {
  return step.kind === 'fold' ? { component: step.component, step: step.step } : null;
}

/**
 * The steps to read, in order.
 *
 * `flatSteps` is still the planner's own list and still what the crate's step
 * data is addressed by; this wraps it rather than replacing it, so nothing
 * downstream has to learn that a step index might not name a fold.
 */
export function referencesViewSteps(
  geometry: CpGeometryTransport | null,
  variants: readonly ReferencesPlanVariant[],
  flatSteps: readonly ReferencesFlatStep[]
): ReferencesViewStep[] {
  const steps: ReferencesViewStep[] = flatSteps.map((flat) => ({
    kind: 'fold',
    side: 'front',
    component: flat.component,
    step: flat.step,
  }));
  if (!geometry || steps.length === 0) return steps;

  // One sheet is planned at a time, so the closing steps belong to whichever
  // component the folds did. A plan carried over from a multi-sheet run would
  // have more; taking the last fold's component keeps the closing steps with the
  // pattern the reader ends on.
  const component = flatSteps[flatSteps.length - 1]?.component ?? 0;
  const variant = variants[component];
  if (!variant) return steps;

  const mountains = mountainLineIds(geometry, variant.sequence);
  if (mountains.length === 0) return steps;

  steps.push({ kind: 'turn-over', side: 'front', component });
  steps.push({ kind: 'reverse', side: 'back', component, lineIds: mountains });
  steps.push({ kind: 'done', side: 'front', component });
  return steps;
}

/** Which face is up at `index`, for the view to mirror on. */
export function sideAt(steps: readonly ReferencesViewStep[], index: number): ReferencesPaperSide {
  return steps[index]?.side ?? 'front';
}
