import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { ExtractedSolution, ExtractedStep } from './referenceFinder/extractor';
import {
  candidateStepCount,
  candidateViewSteps,
  clampCandidateStep,
  describeDiagonalStep,
  diagonalStepDiagram,
} from './referencesCandidateSteps';

function step(overrides: Partial<ExtractedStep>): ExtractedStep {
  return { axiom: 1, inputs: [], label: '', pinch: false, diagramIndex: null, ...overrides };
}

function solution(
  steps: ExtractedStep[],
  freeDiagonals: ExtractedSolution['freeDiagonals'] = []
): ExtractedSolution {
  return {
    exact: true,
    err: 0,
    rank: steps.length,
    foldCount: steps.length + freeDiagonals.length,
    steps,
    freeDiagonals,
    target: { kind: 'point', point: [0, 0] },
  };
}

/** The English default, with its placeholders filled. */
const t = ((key: string, defaultValue: string, options?: Record<string, string>) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_, name) => options?.[name] ?? '')) as unknown as TFunction;

describe('candidateViewSteps', () => {
  it('reads the diagonals the answer leans on first, then its own steps', () => {
    const two = solution([step({ label: 'A' }), step({ label: 'B' })], ['sw_ne', 'nw_se']);
    expect(candidateViewSteps(two)).toEqual([
      { kind: 'diagonal', diagonal: 'sw_ne' },
      { kind: 'diagonal', diagonal: 'nw_se' },
      { kind: 'rf', index: 0 },
      { kind: 'rf', index: 1 },
    ]);
    expect(candidateStepCount(two)).toBe(4);
    expect(candidateStepCount(null)).toBe(0);
  });

  it('is only the diagonal when the diagonal is the answer', () => {
    const only = solution([], ['nw_se']);
    expect(candidateViewSteps(only)).toEqual([{ kind: 'diagonal', diagonal: 'nw_se' }]);
    expect(clampCandidateStep(only, 5)).toBe(0);
  });

  it('clamps a stale step index into the reading order', () => {
    const two = solution([step({ label: 'A' })], ['sw_ne']);
    expect(clampCandidateStep(two, 9)).toBe(1);
    expect(clampCandidateStep(two, -3)).toBe(0);
    expect(clampCandidateStep(two, 1.7)).toBe(1);
    expect(clampCandidateStep(null, 4)).toBe(0);
  });
});

describe('diagonalStepDiagram', () => {
  it('folds corner onto corner along the diagonal, as a valley, with the motion drawn', () => {
    const model = diagonalStepDiagram('sw_ne', { width: 1, height: 0.75 });
    expect(model.sheet).toEqual({ width: 1, height: 0.75 });
    expect(model.primitives).toContainEqual({
      kind: 'line',
      from: [0, 0],
      to: [1, 0.75],
      style: 'valley',
    });
    expect(model.primitives.filter((p) => p.kind === 'point')).toHaveLength(2);
    expect(model.primitives.some((p) => p.kind === 'fold-arrow')).toBe(true);
    const other = diagonalStepDiagram('nw_se', { width: 1, height: 1 });
    expect(other.primitives).toContainEqual({ kind: 'line', from: [0, 1], to: [1, 0], style: 'valley' });
  });
});

describe('describeDiagonalStep', () => {
  it('names the two corners', () => {
    expect(describeDiagonalStep(t, 'sw_ne')).toBe(
      'Fold the bottom-left corner onto the top-right corner, creasing the diagonal.'
    );
    expect(describeDiagonalStep(t, 'nw_se')).toBe(
      'Fold the top-left corner onto the bottom-right corner, creasing the diagonal.'
    );
  });
});
