import { describe, expect, it } from 'vitest';
import { letterInputs } from './inputLetters';

describe('letterInputs', () => {
  it('letters lines from A and points from P, each in input order', () => {
    // O6 in the crate's order: [p1, m1, p2, m2].
    expect(letterInputs(['point', 'line', 'point', 'line'])).toEqual({
      byInput: ['P', 'A', 'Q', 'B'],
      nextPoint: 'R',
      nextLine: 'C',
    });
  });

  it('counts each kind on its own, so a line never takes a mark’s letter', () => {
    expect(letterInputs(['line', 'line', 'line']).byInput).toEqual(['A', 'B', 'C']);
    expect(letterInputs(['line', 'line', 'line']).nextPoint).toBe('P');
  });

  it('starts both runs at the beginning when there is nothing to letter', () => {
    expect(letterInputs([])).toEqual({ byInput: [], nextPoint: 'P', nextLine: 'A' });
  });

  it('wraps round after O and Z rather than running into the other kind’s letters', () => {
    const lines = letterInputs(Array.from({ length: 16 }, () => 'line' as const));
    expect(lines.byInput[14]).toBe('O');
    expect(lines.byInput[15]).toBe('A');
    const points = letterInputs(Array.from({ length: 12 }, () => 'point' as const));
    expect(points.byInput[10]).toBe('Z');
    expect(points.byInput[11]).toBe('P');
  });
});
