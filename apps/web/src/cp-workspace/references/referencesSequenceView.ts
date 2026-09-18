/**
 * The sequence as it is *read*, which is not quite the sequence the planner
 * emits.
 *
 * The planner's steps are folds. A folder also turns the paper over, and looks
 * at the finished thing — neither is a fold, but both are cards in the strip.
 * This is where those cards come from.
 *
 * **Turn-overs are not decided here.** An alignment fold is a valley on the
 * face you are working from, so a crease that must end up a mountain is made
 * with the sheet turned over, and the direction a step wants decides the side
 * it is on. That decision belongs to the planner — `extent`, `visible`,
 * `unlocks`, `Step.id` and `LineEntry.step` are all computed from the emitted
 * order, so a consumer that regrouped the steps would invalidate every one of
 * them. The crate groups by side inside each round (plan D23) and hands each
 * step its `side`; all this module does is notice where that changes.
 *
 * Two consequences worth stating, because they read as bugs otherwise:
 *
 * - A plan whose first step is a mountain **opens** with a turn-over. The sheet
 *   starts front side up, and the first thing the folder does is flip it.
 * - A plan whose last block is on the back **closes** with one, so the finished
 *   pattern is always read from the front — the side its assignment is stated
 *   in.
 */
import type { ReferencesFlatStep } from './referencesBreakdown';
import type { PrecreaseSide } from './precreaseSequence';
import type { ReferencesPlanVariant } from './referencesResults';

/** Which face of the paper is up while a step is performed. */
export type ReferencesPaperSide = PrecreaseSide;

export type ReferencesViewStep =
  /**
   * One of the planner's folds, on the side the crate put it — with the
   * planner step made at once with it, when the crate paired them
   * (`PrecreaseStep.twin`): the card shows both, and the reader passes the
   * pair as one.
   */
  | {
      kind: 'fold';
      side: ReferencesPaperSide;
      component: number;
      step: number;
      twin?: number;
    }
  /**
   * Turn the paper over. `side` is the face you are looking at while you do it
   * — the one you are leaving — and `after` is the planner step the build-up
   * has reached, or null when nothing is folded yet.
   */
  | { kind: 'turn-over'; side: ReferencesPaperSide; component: number; after: number | null }
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
  variants: readonly ReferencesPlanVariant[],
  flatSteps: readonly ReferencesFlatStep[]
): ReferencesViewStep[] {
  const steps: ReferencesViewStep[] = [];
  let side: ReferencesPaperSide = 'front';
  let last: ReferencesFlatStep | null = null;

  // A twin pair is one card: the second of the pair is folded into the
  // first's view step and gets none of its own.
  const paired = new Set<string>();
  for (const flat of flatSteps) {
    const sequence = variants[flat.component]?.sequence;
    const step = sequence?.steps[flat.step];
    if (paired.has(`${flat.component}:${flat.step}`)) {
      last = flat;
      continue;
    }
    const wants: ReferencesPaperSide = step?.side ?? 'front';
    if (wants !== side) {
      steps.push({
        kind: 'turn-over',
        side,
        component: last?.component ?? flat.component,
        after: last?.step ?? null,
      });
      side = wants;
    }
    // The twin must be the very next planner step of the same sheet, on the
    // same side — which is how the crate places it; anything else is read
    // as two cards.
    const next = sequence?.steps[flat.step + 1];
    const twin =
      step?.twin !== undefined && next?.id === step.twin && next.side === step.side
        ? flat.step + 1
        : undefined;
    if (twin !== undefined) paired.add(`${flat.component}:${twin}`);
    steps.push({
      kind: 'fold',
      side,
      component: flat.component,
      step: flat.step,
      ...(twin !== undefined ? { twin } : {}),
    });
    last = flat;
  }

  // One sheet is planned at a time, so the closing cards belong to whichever
  // component the folds did. A plan carried over from a multi-sheet run would
  // have more; taking the last fold's component keeps them with the pattern the
  // reader ends on. A plan that stopped before its first fold still ends: its
  // one card is the ending, which is where the strip says why it stopped.
  if (!last) {
    if (variants.length > 0) steps.push({ kind: 'done', side: 'front', component: 0 });
    return steps;
  }
  const component = last.component;
  if (side === 'back') {
    steps.push({ kind: 'turn-over', side, component, after: last.step });
  }
  steps.push({ kind: 'done', side: 'front', component });
  return steps;
}

/** Which face is up at `index`, for the view to mirror on. */
export function sideAt(steps: readonly ReferencesViewStep[], index: number): ReferencesPaperSide {
  return steps[index]?.side ?? 'front';
}

/** How many times the folder turns the paper over to read this sequence. */
export function turnOverCount(steps: readonly ReferencesViewStep[]): number {
  return steps.filter((step) => step.kind === 'turn-over').length;
}
