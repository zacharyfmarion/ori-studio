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
  PrecreaseGroup,
  PrecreaseSequence,
  PrecreaseStep,
  PrecreaseStepKind,
  PrecreaseTotals,
} from './precreaseSequence';

/** One collapsed row: a group of consecutive steps folded the same way. */
export interface ReferencesBreakdownRow {
  /** Stable across re-renders and re-plans of the same sequence. */
  id: string;
  kind: PrecreaseStepKind;
  /** Presentation ids of the steps the row stands for. */
  stepIds: number[];
  count: number;
  axiom: number;
  round: number;
  /** Normal angle of the direction cluster, radians in `[0, π)`. */
  directionAngle: number;
  pattern: string;
  /** The chosen witness trips a legibility rule. */
  hard: boolean;
  /** Auxiliary rows only: the crease stays full-length and will show. */
  visible: boolean;
  /** Auxiliary rows only: every step in the row is reduced to pinches. */
  pinched: boolean;
  /** Auxiliary rows only: presentation ids of the CP steps this unlocks. */
  unlocks: number[];
}

export type ReferencesBreakdownSectionKind = 'landmarks' | 'round';

export interface ReferencesBreakdownSection {
  id: string;
  kind: ReferencesBreakdownSectionKind;
  round: number;
  rows: ReferencesBreakdownRow[];
  stepCount: number;
  /** Steps in this section that fold a crease-pattern line. */
  cpCount: number;
  auxCount: number;
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

function rowFor(group: PrecreaseGroup, index: number, steps: Map<number, PrecreaseStep>): ReferencesBreakdownRow {
  const members = group.step_ids.map((id) => steps.get(id)).filter((s): s is PrecreaseStep => !!s);
  const unlocks = new Set<number>();
  for (const step of members) for (const id of step.unlocks) unlocks.add(id);
  return {
    id: `r${group.round}-${index}-${group.step_ids[0] ?? 0}`,
    kind: group.kind,
    stepIds: [...group.step_ids],
    count: group.count,
    axiom: group.axiom,
    round: group.round,
    directionAngle: group.direction_angle,
    pattern: group.pattern,
    hard: members.some((step) => step.hard),
    visible: members.some((step) => step.visible),
    pinched: members.length > 0 && members.every(isPinched),
    unlocks: [...unlocks].sort((a, b) => a - b),
  };
}

/**
 * The breakdown's sections, in presentation order. Round 0 is the landmarks
 * phase the "landmarks first" toggle creates; without the toggle there is
 * none, and the auxiliary rows sit in their own rounds between the CP rounds —
 * which is what attaches each to the step it unlocks.
 */
export function breakdownSections(sequence: PrecreaseSequence): ReferencesBreakdownSection[] {
  const steps = new Map(sequence.steps.map((step) => [step.id, step]));
  const sections = new Map<number, ReferencesBreakdownSection>();
  sequence.groups.forEach((group, index) => {
    let section = sections.get(group.round);
    if (!section) {
      section = {
        id: group.round === 0 ? 'landmarks' : `round-${group.round}`,
        kind: group.round === 0 ? 'landmarks' : 'round',
        round: group.round,
        rows: [],
        stepCount: 0,
        cpCount: 0,
        auxCount: 0,
      };
      sections.set(group.round, section);
    }
    const row = rowFor(group, index, steps);
    section.rows.push(row);
    section.stepCount += row.count;
    if (row.kind === 'cp') section.cpCount += row.count;
    else section.auxCount += row.count;
  });
  return [...sections.values()].sort((a, b) => a.round - b.round);
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

/** Where a component's step sits in the flat list, or -1. */
export function flatIndexOf(
  flat: readonly ReferencesFlatStep[],
  component: number,
  step: number
): number {
  return flat.findIndex((entry) => entry.component === component && entry.step === step);
}

/** The step a row press should frame: its first member. */
export function firstStepOf(row: ReferencesBreakdownRow): number | null {
  return row.stepIds[0] ?? null;
}

/**
 * The row containing a step, for driving the sidebar from the transport strip
 * and the `references.nextStep` chord.
 */
export function rowForStep(
  sections: readonly ReferencesBreakdownSection[],
  stepId: number
): ReferencesBreakdownRow | null {
  for (const section of sections) {
    for (const row of section.rows) {
      if (row.stepIds.includes(stepId)) return row;
    }
  }
  return null;
}
