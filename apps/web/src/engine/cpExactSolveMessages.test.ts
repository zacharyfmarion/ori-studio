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

/** Stands in for i18next: returns the inline English default, as the app does. */
const t = ((key: string, defaultValue?: string) => defaultValue ?? key) as unknown as TFunction;

/** Records the key each arm asks for, so the table's keys can be inspected. */
const keys: string[] = [];
const recording = ((key: string, defaultValue?: string) => {
  keys.push(key);
  return defaultValue ?? key;
}) as unknown as TFunction;

describe('cpExactSolveReasonLabel', () => {
  it('gives all eleven endings a distinct sentence', () => {
    const sentences = CP_EXACT_SOLVE_REASONS.map((reason) => cpExactSolveReasonLabel(t, reason));

    expect(sentences).toHaveLength(11);
    expect(new Set(sentences).size).toBe(11);
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(20);
  });

  it('keys every sentence under one namespace and prefix', () => {
    keys.length = 0;
    for (const reason of CP_EXACT_SOLVE_REASONS) cpExactSolveReasonLabel(recording, reason);

    expect(keys).toHaveLength(11);
    expect(new Set(keys).size).toBe(11);
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

  it('tells the user the solve never started on a preflight refusal', () => {
    for (const reason of ['preflight_degenerate_edges', 'preflight_boundary_failures'] as const) {
      expect(cpExactSolveReasonLabel(t, reason)).toContain('could not start');
    }
  });

  it('offers the partial rather than only reporting the clock on a timeout', () => {
    expect(cpExactSolveReasonLabel(t, 'timeout')).toContain('how far it got');
  });
});

describe('cpExactSolveStageLabel', () => {
  it('names the solver stages, not a generic spinner', () => {
    expect(cpExactSolveStageLabel(t, 'geometry')).toBe('Solving geometry');
    expect(cpExactSolveStageLabel(t, 'refinement')).toBe('Refining to fold precision');
  });
});
