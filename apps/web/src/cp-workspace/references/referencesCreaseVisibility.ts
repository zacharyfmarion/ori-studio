/**
 * Which of the document's creases a step of the sequence shows.
 *
 * A folding diagram shows the paper *as it is at that step*: the creases made
 * so far, with the one being made picked out. Drawing the finished crease
 * pattern behind every step — which is what this workspace did first — buries
 * the step's own crease in three hundred others and makes the sequence
 * unreadable.
 *
 * Four rules, and they are all here rather than in the panel so they can be
 * tested without a store:
 *
 * - **A sheet nobody is reading is shown whole.** Before a plan is worked out
 *   and with nothing picked, there is no step to be at, so nothing is held back
 *   and nothing is dimmed.
 * - **Only the selected sheet is drawn.** The workspace answers for one crease
 *   pattern at a time (plan D12); another sheet's creases are not context, they
 *   are a different problem.
 * - **Reading a plan builds up.** At step *k* the sheet's border plus the
 *   creases of steps 0…*k*, with step *k*'s own at full strength and everything
 *   earlier dimmed.
 * - **Reading one reference dims, but hides nothing.** ReferenceFinder's steps
 *   are folds on a blank sheet and have no relation to the pattern's creases, so
 *   there is no "so far" to build up — the pattern goes quiet instead, and the
 *   construction ghosts read over it.
 * - **The closing steps show the whole sheet.** Turning the paper over, reversing
 *   the mountains and reading the finished pattern all happen after every crease
 *   is made, so nothing is held back; the reverse step picks out the creases it
 *   is about instead.
 *
 * The border is always visible, and never dimmed. A sheet with no edges is not
 * a sheet; the paper's outline is the thing the folds are drawn on rather than
 * one of them, and a diagram that fades it out reads as an empty page.
 */
import type { ReferencesPlanVariant } from './referencesResults';
import type { ReferencesViewStep } from './referencesSequenceView';
import type { ReferencesCreaseVisibility } from './referencesViewGeometry';

/** How much of its colour a crease keeps once an earlier step made it. */
export const REFERENCES_DIM_ALPHA = 0.26;
/**
 * How much wider the step's own creases draw.
 *
 * Width and opacity carry the emphasis, not hue: a crease's colour already says
 * which way it folds, and that is the one thing the folder is reading it for.
 */
export const REFERENCES_EMPHASIS_WIDTH = 2.6;

/** Everything at full strength: no sheet chosen, and nothing being read. */
export const REFERENCES_ALL_CREASES: ReferencesCreaseVisibility = {
  visible: null,
  dimmed: null,
  dimAlpha: 1,
};

export interface ReferencesVisibilityInput {
  /** The selected sheet's creases, border included; null draws the document. */
  sheetLineIds: ReadonlySet<number> | null;
  /** The selected sheet's border loop, never hidden. */
  borderLineIds: ReadonlySet<number> | null;
  /** The creases the active step is about — the picked crease, or the step's. */
  activeLineIds: ReadonlySet<number>;
}

/**
 * The sheet as it is, at full strength: no plan yet and nothing picked, so
 * there is no step to be at.
 */
export function unreadVisibility(input: ReferencesVisibilityInput): ReferencesCreaseVisibility {
  const { sheetLineIds } = input;
  if (!sheetLineIds) return REFERENCES_ALL_CREASES;
  return { visible: sheetLineIds, dimmed: null, dimAlpha: 1 };
}

/** The whole sheet, with everything but `activeLineIds` dimmed. */
export function targetVisibility(input: ReferencesVisibilityInput): ReferencesCreaseVisibility {
  const { sheetLineIds, activeLineIds } = input;
  if (!sheetLineIds) {
    return activeLineIds.size === 0
      ? REFERENCES_ALL_CREASES
      : { visible: null, dimmed: null, dimAlpha: 1 };
  }
  const dimmed = new Set<number>();
  for (const id of sheetLineIds) {
    if (activeLineIds.has(id) || input.borderLineIds?.has(id)) continue;
    dimmed.add(id);
  }
  return {
    visible: sheetLineIds,
    dimmed,
    dimAlpha: REFERENCES_DIM_ALPHA,
    emphasis: activeLineIds,
    emphasisWidth: REFERENCES_EMPHASIS_WIDTH,
  };
}

/**
 * The sheet as it stands at `activeStep` of a plan.
 *
 * Steps of other sheets are skipped rather than folded in: with one sheet
 * planned the list holds only that sheet's steps anyway — but a plan carried
 * over from a multi-sheet run must not leak another pattern's creases into this
 * one's build-up.
 */
export function planVisibility(
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  activeStep: number,
  input: ReferencesVisibilityInput
): ReferencesCreaseVisibility {
  const { sheetLineIds, borderLineIds } = input;
  const target = viewSteps[activeStep];
  if (!target) return targetVisibility({ ...input, activeLineIds: new Set() });

  // A closing step comes after every fold, so the pattern is whole. `reverse`
  // says which creases it is about; the other two are about the sheet.
  if (target.kind !== 'fold') {
    const activeLineIds = new Set(target.kind === 'reverse' ? target.lineIds : []);
    return activeLineIds.size === 0
      ? unreadVisibility(input)
      : targetVisibility({ ...input, activeLineIds });
  }

  const visible = new Set<number>(borderLineIds ?? []);
  const active = new Set<number>();
  for (let i = 0; i <= activeStep && i < viewSteps.length; i += 1) {
    const view = viewSteps[i];
    if (view.kind !== 'fold' || view.component !== target.component) continue;
    const step = variants[view.component]?.sequence.steps[view.step];
    if (!step) continue;
    for (const id of step.cp_line_ids) {
      if (sheetLineIds && !sheetLineIds.has(id)) continue;
      visible.add(id);
      if (i === activeStep) active.add(id);
    }
  }
  const dimmed = new Set<number>();
  for (const id of visible) {
    if (active.has(id) || borderLineIds?.has(id)) continue;
    dimmed.add(id);
  }
  return {
    visible,
    dimmed,
    dimAlpha: REFERENCES_DIM_ALPHA,
    emphasis: active,
    emphasisWidth: REFERENCES_EMPHASIS_WIDTH,
  };
}
