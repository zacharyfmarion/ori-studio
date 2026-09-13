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
 * - **Reading a plan builds up, and stops one step short.** At step *k* the
 *   sheet's border plus the creases of steps 0…*k*−1, dimmed. Step *k*'s own
 *   crease is deliberately absent: it has not been folded yet, and the pattern
 *   is what the paper already has on it. The step draws that crease itself, as
 *   the dashed fold line it is — so it is drawn once, by the thing that is
 *   asking for it, and the dimmed build-up is what it stands out from. The
 *   same set is what can be pointed at: a crease a later step makes, or a
 *   vertex it will make, is not on the paper for the pointer to find.
 * - **Reading one reference shows the paper and the crease, and nothing else.**
 *   ReferenceFinder's steps are folds on a blank sheet and have no relation to
 *   the pattern's creases, so there is no "so far" to build up. The pattern
 *   used to go quiet behind the construction instead, and three hundred dimmed
 *   creases were still three hundred creases: the construction's own lines
 *   were lost among them, and a reader picking a crease partway through the
 *   sequence took the build-up for the answer. So the sheet is the paper's
 *   outline and the picked crease, and the construction draws over blank paper
 *   as ReferenceFinder means it to.
 * - **A turn-over shows the build-up too, and one more step of it.** Turning
 *   the paper over happens between folds, not only at the end, so it holds back
 *   the creases that are not made yet exactly as a fold card does — but the
 *   fold it comes after *is* made, so its crease is on the paper. It picks
 *   nothing out, and so it dims nothing either: dimming is what a fold's own
 *   line stands out from, and a card with no line of its own has nothing to
 *   stand out. The finished card is the same rule at the end — its build-up is
 *   the whole sheet, at full strength, which is the point of it.
 *
 * The border is always visible, and never dimmed. A sheet with no edges is not
 * a sheet; the paper's outline is the thing the folds are drawn on rather than
 * one of them, and a diagram that fades it out reads as an empty page.
 */
import { flipDirection } from './diagram/diagramModel';
import type { PrecreaseDirection, PrecreaseStep } from './precreaseSequence';
import type { ReferencesPlanVariant } from './referencesResults';
import type { ReferencesViewStep } from './referencesSequenceView';
import type { ReferencesCreaseVisibility } from './referencesViewGeometry';

/** How much of its colour a crease keeps once an earlier step made it. */
export const REFERENCES_DIM_ALPHA = 0.26;
/**
 * How much wider the picked crease draws while one reference is being read.
 *
 * Width and opacity carry the emphasis, not hue: a crease's colour already says
 * which way it folds, and that is the one thing the folder is reading it for.
 * A *plan* step needs none of this — the crease it is about is not in this
 * channel at all, because it has not been folded yet.
 */
export const REFERENCES_EMPHASIS_WIDTH = 2.6;

/** Everything at full strength: no sheet chosen, and nothing being read. */
export const REFERENCES_ALL_CREASES: ReferencesCreaseVisibility = {
  visible: null,
  dimmed: null,
  dimAlpha: 1,
};

export interface ReferencesVisibilityInput {
  /**
   * The reader is looking at the paper's back, so a crease's direction is named
   * from that face — see `diagram/diagramModel.flipDirection`.
   */
  mirrored?: boolean;
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

/**
 * The paper's outline and `activeLineIds`, at full strength; every other crease
 * of the sheet is hidden. A picked vertex has no line of its own, so its sheet
 * is blank paper with the vertex marked on it.
 */
export function targetVisibility(input: ReferencesVisibilityInput): ReferencesCreaseVisibility {
  const { sheetLineIds, borderLineIds, activeLineIds } = input;
  if (!sheetLineIds) {
    return activeLineIds.size === 0
      ? REFERENCES_ALL_CREASES
      : { visible: null, dimmed: null, dimAlpha: 1 };
  }
  const visible = new Set<number>();
  for (const id of sheetLineIds) {
    if (activeLineIds.has(id) || borderLineIds?.has(id)) visible.add(id);
  }
  return {
    visible,
    dimmed: null,
    dimAlpha: 1,
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
  const { sheetLineIds, borderLineIds, mirrored = false } = input;
  const target = viewSteps[activeStep];
  // No step to be at: the sheet as it is, whole.
  if (!target) return unreadVisibility(input);

  // A card that is not a fold — a turn-over, or the finished pattern — picks
  // nothing out, but still shows only what has been folded by the time it is
  // reached, exactly as a fold card does.
  const { component } = target;

  const visible = new Set<number>(borderLineIds ?? []);
  const directions = new Map<number, 'mountain' | 'valley'>();
  // A fold card stops one short of itself: its crease is the instruction, not
  // the paper, and the step's own diagram is what draws it. Any other card is
  // read *after* the fold it follows, so that fold's crease is on the paper.
  const folded = target.kind === 'fold' ? activeStep - 1 : activeStep;
  for (let i = 0; i <= folded && i < viewSteps.length; i += 1) {
    const view = viewSteps[i];
    if (view.kind !== 'fold' || view.component !== component) continue;
    const entry = variants[view.component]?.sequence.steps[view.step];
    if (!entry) continue;
    for (const made of creasesMadeBy(entry)) {
      for (const id of made.cpLineIds) {
        if (sheetLineIds && !sheetLineIds.has(id)) continue;
        visible.add(id);
        if (made.direction !== 'unassigned') {
          // Named from the face the reader is on, like everything else in the
          // picture — see `diagram/diagramModel.flipDirection`.
          directions.set(id, mirrored ? flipDirection(made.direction) : made.direction);
        }
      }
    }
  }
  if (target.kind !== 'fold') {
    return { visible, pickable: visible, dimmed: null, dimAlpha: 1, directions, borderLineIds };
  }
  const dimmed = new Set<number>();
  for (const id of visible) {
    if (borderLineIds?.has(id)) continue;
    dimmed.add(id);
  }
  return {
    visible,
    pickable: visible,
    dimmed,
    dimAlpha: REFERENCES_DIM_ALPHA,
    borderLineIds,
    // One step, one direction (plan D20), and it stays that way afterwards —
    // a line whose creases disagree would otherwise go back to reading red
    // here and blue there the moment its step stopped being active.
    directions,
  };
}

/**
 * The creases a step puts on the paper, each with the direction it was made
 * in. One entry for a fold; one per line for a grid step, whose own
 * `direction` is unassigned because a pleat alternates — the family's lines
 * carry theirs.
 */
function creasesMadeBy(
  step: PrecreaseStep
): readonly { cpLineIds: readonly number[]; direction: PrecreaseDirection }[] {
  if (step.grid) {
    return step.grid.lines.map((line) => ({
      cpLineIds: line.cp_line_ids,
      direction: line.direction,
    }));
  }
  return [{ cpLineIds: step.cp_line_ids, direction: step.direction }];
}
