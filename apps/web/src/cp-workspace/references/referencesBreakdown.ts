/**
 * The whole-pattern breakdown as the sidebar shows it: rounds as sections,
 * and within a round one collapsed row per direction + axiom + input pattern
 * with a count chip ("fold the sixteenths horizontally: 7 creases").
 *
 * The crate's `sequence()` already returns those groups, ordered and merged
 * (`order.rs`), so this module **renders** them rather than re-deriving them:
 * it slices the group list into sections, resolves the per-row facts a group
 * does not carry (whether an auxiliary row is pinched, what it unlocks), and
 * turns the totals into the numbers the summary strip prints. No geometry, no
 * React, no store.
 */
import type {
  PrecreaseSequence,
  PrecreaseStep,
  PrecreaseTotals,
} from './precreaseSequence';
import type { ReferencesPlanRecord } from './referencesResults';

/**
 * Whether a plan describes the sheet the workspace is showing.
 *
 * A plan belongs to a document revision **and** to a sheet, and only the first
 * of those was ever checked. Switching sheets changes neither the document nor
 * its revision, so the side table's last plan stayed "fresh" and the filmstrip,
 * the outline and the crease build-up all went on describing a pattern that was
 * no longer selected — against a canvas showing the new one, where the old
 * plan's crease ids name nothing and the build-up draws a bare sheet.
 *
 * A refused sheet counts as described: the run recorded why it would not plan
 * that sheet, and that answer is this sheet's too.
 */
export function planIsForSheet(plan: ReferencesPlanRecord, selected: number | null): boolean {
  if (selected === null) return true;
  return (
    plan.components.some((entry) => entry.component === selected) ||
    plan.refused.some((entry) => entry.component === selected)
  );
}

/** Which way a group's creases run, for its sentence. */
export type ReferencesDirection =
  | { kind: 'horizontal' }
  | { kind: 'vertical' }
  | { kind: 'diagonal-up' }
  | { kind: 'diagonal-down' }
  | { kind: 'angle'; degrees: number };

const HALF_PI = Math.PI / 2;
const QUARTER_PI = Math.PI / 4;
/** Rounding slack for naming a direction; well above the planner's own TOL. */
const DIRECTION_EPSILON = 1e-6;

/**
 * The direction a group's creases run, from its **normal** angle: a normal
 * along +x is a vertical line. Anything not on one of the four named axes is
 * reported in degrees rather than approximated onto a neighbour.
 */
export function directionOfGroup(normalAngle: number): ReferencesDirection {
  const line = wrapPi(normalAngle + HALF_PI);
  if (near(line, 0) || near(line, Math.PI)) return { kind: 'horizontal' };
  if (near(line, HALF_PI)) return { kind: 'vertical' };
  if (near(line, QUARTER_PI)) return { kind: 'diagonal-up' };
  if (near(line, 3 * QUARTER_PI)) return { kind: 'diagonal-down' };
  return { kind: 'angle', degrees: Math.round((line * 180) / Math.PI) };
}

function wrapPi(angle: number): number {
  const wrapped = angle % Math.PI;
  return wrapped < 0 ? wrapped + Math.PI : wrapped;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= DIRECTION_EPSILON;
}

/** Whether the pinch pass reduced this step to short spans. */
export function isPinched(step: PrecreaseStep): boolean {
  return step.extent.kind === 'pinches';
}
/** Every step by its presentation id, for a row press. */
export function stepsById(sequence: PrecreaseSequence): Map<number, PrecreaseStep> {
  return new Map(sequence.steps.map((step) => [step.id, step]));
}

/**
 * What the summary strip prints. `folds = cpLines + aux` by construction, and
 * `lowerBound` is the exact lower bound *within the flat-sheet model* — the
 * number of distinct CP lines off the outline. Never a claimed minimum: the
 * search is bounded (plan, "Honest statement").
 */
export interface ReferencesBreakdownTotals {
  folds: number;
  cpLines: number;
  aux: number;
  visibleAux: number;
  lowerBound: number;
  freeLines: number;
  unsolved: number;
  /** `folds` equals the lower bound: no auxiliary fold was needed at all. */
  atLowerBound: boolean;
}

export function breakdownTotals(totals: PrecreaseTotals): ReferencesBreakdownTotals {
  return {
    folds: totals.folds,
    cpLines: totals.cp_lines,
    aux: totals.aux,
    visibleAux: totals.visible_aux,
    lowerBound: totals.lower_bound,
    freeLines: totals.free_lines,
    unsolved: totals.unsolved,
    atLowerBound: totals.folds === totals.lower_bound,
  };
}

/** One step of one component, as the transport strip addresses it. */
export interface ReferencesFlatStep {
  /** Index into the record's planned components. */
  component: number;
  /** Index into that component's `sequence.steps`. */
  step: number;
}

/**
 * Every step of every planned component, in order — what the step scrubber
 * and the `references.nextStep` chord walk. A pattern with one sheet (almost
 * all of them) gets exactly its own steps; a multi-sheet canvas gets each
 * sheet's in turn, which is the order the sidebar lists them in.
 */
export function flatPlanSteps(sequences: readonly PrecreaseSequence[]): ReferencesFlatStep[] {
  const out: ReferencesFlatStep[] = [];
  sequences.forEach((sequence, component) => {
    sequence.steps.forEach((_, step) => out.push({ component, step }));
  });
  return out;
}
