/**
 * The sentence table. Exhaustiveness is a compile-time property of the switch;
 * what needs asserting at runtime is that every arm is *reachable* with a real
 * key and produces a distinct sentence — a copy-pasted arm typechecks fine and
 * tells the user the wrong thing.
 */
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { cpExactSolveReasonLabel, cpExactSolveStageLabel } from './cpExactSolveMessages';
import { CP_EXACT_SOLVE_REASONS } from './cpExactSolveTypes';

/**
 * Stands in for i18next: returns the inline English default, as the app does.
 * A plural call passes an options object — `count` with `defaultValue_one` /
 * `defaultValue_other` — and gets the matching form with `{{count}}` filled.
 */
function render(key: string, second?: unknown): string {
  if (typeof second === 'string') return second;
  if (second && typeof second === 'object') {
    const options = second as { count?: number; defaultValue?: string; defaultValue_one?: string; defaultValue_other?: string };
    const form =
      options.count === 1 ? options.defaultValue_one : (options.defaultValue_other ?? options.defaultValue);
    if (form) return form.replace(/\{\{count\}\}/g, String(options.count));
  }
  return key;
}
const t = render as unknown as TFunction;

/** Records the key each arm asks for, so the table's keys can be inspected. */
const keys: string[] = [];
const recording = ((key: string, defaultValue?: string) => {
  keys.push(key);
  return defaultValue ?? key;
}) as unknown as TFunction;

describe('cpExactSolveReasonLabel', () => {
  it('gives all twelve endings a distinct sentence', () => {
    const sentences = CP_EXACT_SOLVE_REASONS.map((reason) => cpExactSolveReasonLabel(t, reason));

    expect(sentences).toHaveLength(12);
    expect(new Set(sentences).size).toBe(12);
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(20);
  });

  it('keys every sentence under one namespace and prefix', () => {
    keys.length = 0;
    for (const reason of CP_EXACT_SOLVE_REASONS) cpExactSolveReasonLabel(recording, reason);

    expect(keys).toHaveLength(12);
    expect(new Set(keys).size).toBe(12);
    for (const key of keys) expect(key.startsWith('panels:cpExactSolve.reason.')).toBe(true);
  });

  it('says the answer was not applied on every gate rejection', () => {
    // On any non-acceptance the solver returns the coordinates it was given, so
    // the document is unchanged. A message that only named the fault would leave
    // the user looking for something to undo.
    const gateRejections = [
      'candidate_status_failed',
      'movement_budget_exceeded',
      'odd_degree_vertices_worsened',
      'degenerate_edges_worsened',
      'unmodeled_crossings_worsened',
      'boundary_failures_worsened',
      'objective_not_improved',
    ] as const;

    for (const reason of gateRejections) {
      expect(cpExactSolveReasonLabel(t, reason)).toMatch(/not applied|nothing was applied/u);
    }
  });

  /**
   * `candidate_status_failed` is the solver refusing its own answer, and the
   * answer is never applied — so none of what it would have broken is drawn
   * as a marker. The sentence has to name the condition, or it sends the user
   * to markers that do not exist, which is what happened over a clean region.
   */
  it('names what the refused answer would have broken, most actionable first', () => {
    const findings = (over = {}) => ({
      degenerateEdges: 0,
      unmodeledCrossings: 0,
      boundaryFailures: 0,
      movedOverBudget: false,
      improvedAngles: true,
      ...over,
    });
    const label = (over = {}) => cpExactSolveReasonLabel(t, 'candidate_status_failed', findings(over));
    expect(label({ unmodeledCrossings: 2 })).toMatch(/2 pairs of creases would cross/);
    expect(label({ unmodeledCrossings: 1 })).toMatch(/1 pair of creases would cross/);
    expect(label({ degenerateEdges: 1 })).toMatch(/collapse 1 crease to zero length/);
    expect(label({ boundaryFailures: 3 })).toMatch(/push 3 vertices off the edge/);
    expect(label({ movedOverBudget: true })).toMatch(/further than it is allowed to/);
    expect(label({ improvedAngles: false })).toMatch(/brought the angles no closer/);
    // Crossings outrank the rest: they are the one the user can fix by hand.
    expect(label({ unmodeledCrossings: 1, degenerateEdges: 4, movedOverBudget: true })).toMatch(/would cross/);
    for (const over of [{ unmodeledCrossings: 1 }, { degenerateEdges: 1 }, { boundaryFailures: 1 }, { movedOverBudget: true }, { improvedAngles: false }, {}]) {
      expect(label(over)).toMatch(/not applied and nothing moved/);
    }
  });

  it('never sends the user to markers when the refused answer is all it knows', () => {
    expect(cpExactSolveReasonLabel(t, 'candidate_status_failed')).not.toMatch(/remaining markers/);
    expect(cpExactSolveReasonLabel(t, 'candidate_status_failed', null)).toMatch(/there may be no marker/);
  });

  it('tells the user the solve never started on a preflight refusal', () => {
    for (const reason of ['preflight_degenerate_edges', 'preflight_boundary_failures'] as const) {
      expect(cpExactSolveReasonLabel(t, reason)).toContain('could not start');
    }
  });

  it('offers the partial rather than only reporting the clock on a timeout', () => {
    expect(cpExactSolveReasonLabel(t, 'timeout')).toContain('how far it got');
  });

  it('does not claim nothing was applied on the one ending that was accepted', () => {
    // `above_fold_precision` sits in the same table as the gate rejections but
    // means the opposite thing about the solver's verdict: it accepted. Reusing
    // their "so it was not applied" phrasing would make an accepted solve read
    // as a refusal, and points the user at an undo that does not exist.
    const sentence = cpExactSolveReasonLabel(t, 'above_fold_precision');

    expect(sentence).not.toMatch(/not applied|nothing was applied|could not start/u);
    expect(sentence).toContain('foldability check');
    expect(sentence).toContain('solve again');
  });
});

describe('cpExactSolveStageLabel', () => {
  it('names the solver stages, not a generic spinner', () => {
    expect(cpExactSolveStageLabel(t, 'geometry')).toBe('Solving geometry');
    expect(cpExactSolveStageLabel(t, 'refinement')).toBe('Refining to fold precision');
  });
});
