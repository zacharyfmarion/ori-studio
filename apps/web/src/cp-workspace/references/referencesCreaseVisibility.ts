/**
 * Which of the document's creases a step of the sequence shows.
 *
 * A folding diagram shows the paper *as it is at that step*: the creases made
 * so far, with the one being made picked out. Drawing the finished crease
 * pattern behind every step — which is what this workspace did first — buries
 * the step's own crease in three hundred others and makes the sequence
 * unreadable.
 *
 * Three rules, and they are all here rather than in the hook so they can be
 * tested without a store:
 *
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
 *
 * The border is always visible. A sheet with no edges is not a sheet, and the
 * first steps of most sequences fold the paper in half against them.
 */
import type { ReferencesFlatStep } from './referencesBreakdown';
import type { ReferencesPlanVariant } from './referencesResults';
import type { ReferencesCreaseVisibility } from './referencesViewGeometry';

/** How much of its colour a crease keeps once an earlier step made it. */
export const REFERENCES_DIM_ALPHA = 0.26;

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

/** The whole sheet, with everything but `activeLineIds` dimmed. */
export function targetVisibility(input: ReferencesVisibilityInput): ReferencesCreaseVisibility {
  const { sheetLineIds, activeLineIds } = input;
  if (!sheetLineIds) {
    return activeLineIds.size === 0
      ? REFERENCES_ALL_CREASES
      : { visible: null, dimmed: null, dimAlpha: 1 };
  }
  const dimmed = new Set<number>();
  for (const id of sheetLineIds) if (!activeLineIds.has(id)) dimmed.add(id);
  return { visible: sheetLineIds, dimmed, dimAlpha: REFERENCES_DIM_ALPHA };
}

/**
 * The sheet as it stands at `activeStep` of a plan.
 *
 * Steps of other sheets in `flatSteps` are skipped rather than folded in: the
 * flat list is the one the scrubber walks, and with one sheet planned it holds
 * only that sheet's steps anyway — but a plan carried over from a multi-sheet
 * run must not leak another pattern's creases into this one's build-up.
 */
export function planVisibility(
  variants: readonly ReferencesPlanVariant[],
  flatSteps: readonly ReferencesFlatStep[],
  activeStep: number,
  input: ReferencesVisibilityInput
): ReferencesCreaseVisibility {
  const { sheetLineIds, borderLineIds } = input;
  const target = flatSteps[activeStep];
  if (!target) return targetVisibility({ ...input, activeLineIds: new Set() });

  const visible = new Set<number>(borderLineIds ?? []);
  const active = new Set<number>();
  for (let i = 0; i <= activeStep && i < flatSteps.length; i += 1) {
    const flat = flatSteps[i];
    if (flat.component !== target.component) continue;
    const step = variants[flat.component]?.sequence.steps[flat.step];
    if (!step) continue;
    for (const id of step.cp_line_ids) {
      if (sheetLineIds && !sheetLineIds.has(id)) continue;
      visible.add(id);
      if (i === activeStep) active.add(id);
    }
  }
  const dimmed = new Set<number>();
  for (const id of visible) if (!active.has(id)) dimmed.add(id);
  return { visible, dimmed, dimAlpha: REFERENCES_DIM_ALPHA };
}
