import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import {
  advanceSolutionFrontier,
  frontierSolutions,
  layerOrderCount,
  solutionFrontierKnowing,
  solutionPlaceCount,
  UNSEARCHED_FRONTIER,
} from './layerOrderPlace';

const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/gu, (_match, name: string) => String(values?.[name]))) as unknown as TFunction;

describe('the search frontier', () => {
  it('grows with what the kernel finds, and closes when a search at its edge fails', () => {
    let frontier = advanceSolutionFrontier(UNSEARCHED_FRONTIER, { discovered: 1, hasNext: true });
    expect(frontier).toEqual({ cases: 1, complete: false });
    frontier = advanceSolutionFrontier(frontier, { discovered: 3, hasNext: true });
    expect(frontier).toEqual({ cases: 3, complete: false });
    frontier = advanceSolutionFrontier(frontier, { discovered: 3, hasNext: false });
    expect(frontier).toEqual({ cases: 3, complete: true });
  });

  it('keeps what it reached when a step back restarts the search', () => {
    // Back from 5 of 5: the replay to 2 has found 2 and may find more.
    const frontier = advanceSolutionFrontier({ cases: 5, complete: true }, { discovered: 2, hasNext: true });
    expect(frontier).toEqual({ cases: 5, complete: true });
    expect(frontierSolutions(frontier)).toEqual({ discovered: 5, hasNext: false });
  });

  it('takes the orders a step is known to have, which a fold opened fresh cannot know', () => {
    expect(solutionFrontierKnowing({ cases: 1, complete: true }, 3)).toEqual({ cases: 3, complete: false });
    expect(solutionFrontierKnowing({ cases: 4, complete: true }, 3)).toEqual({ cases: 4, complete: true });
  });

  it('says one at least before the search has reached any', () => {
    expect(frontierSolutions(UNSEARCHED_FRONTIER)).toEqual({ discovered: 1, hasNext: true });
  });
});

describe('layerOrderCount', () => {
  it('reads as the Diagram has always read it', () => {
    expect(layerOrderCount(2, null, t)).toBe('2');
    expect(layerOrderCount(2, { discovered: 5, hasNext: true }, t)).toBe('2 of 5+');
    expect(layerOrderCount(2, { discovered: 5, hasNext: false }, t)).toBe('2 of 5');
    // The order shown is never past the total.
    expect(layerOrderCount(6, { discovered: 5, hasNext: false }, t)).toBe('6 of 6');
    expect(layerOrderCount(0, { discovered: 0, hasNext: false, none: true }, t)).toBe('None');
  });
});

describe('solutionPlaceCount', () => {
  const place = (index: number, n: number, exact: boolean, counted = true) => ({
    position: { index, total: { n, exact } },
    counted,
  });

  it('reads “k of N” once the count is final', () => {
    expect(solutionPlaceCount(place(2, 3, true), t)).toBe('2 of 3');
    expect(solutionPlaceCount(place(1, 1, true), t)).toBe('1 of 1');
  });

  it('reads “Solution k” until then: the index counts the solutions found so far, not their rank (E9)', () => {
    expect(solutionPlaceCount(place(26, 123, false), t)).toBe('Solution 26');
    expect(solutionPlaceCount(place(1, 1, false), t)).toBe('Solution 1');
  });

  it('reads “Solution k” on a figure too large to count (D7)', () => {
    expect(solutionPlaceCount(place(3, 3, false, false), t)).toBe('Solution 3');
    expect(solutionPlaceCount(place(3, 3, true, false), t)).toBe('Solution 3');
  });
});
