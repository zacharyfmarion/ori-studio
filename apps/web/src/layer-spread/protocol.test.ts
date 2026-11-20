import { expect, it } from 'vitest';
import type { SpreadInput, SpreadSolution } from '@oristudio/layer-spread';
import { validSolution } from './protocol';

const input: SpreadInput = {
  xy: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  faces: [[0, 1, 2]],
  triangles: [[0, 1, 2]],
  triangleFaces: [0],
  orders: [],
  cells: [],
};
const solution = {
  version: 'normalized-50-v1',
  heights: [0, 0.1, 0],
  references: [
    { plane: [0, 0, 0], center: [0, 0, 0], samples: 1, rms: 0 },
    { plane: [0, 0, 0], center: [0, 0, 0], samples: 1, rms: 0 },
  ],
  diagnostics: { max_relative_warp: 0, max_slope: 0.1 },
} as SpreadSolution;
const withShifts = (shifts: unknown) => ({ ...solution, shifts }) as SpreadSolution;

it('accepts a solution with no shift, a whole one, or a side the solver left empty', () => {
  expect(validSolution(solution, input)).toBe(true);
  expect(validSolution(withShifts([[0, 0, -0.01, 0, 0, 0], [0, 0, 0.01, 0, 0, 0]]), input)).toBe(true);
  expect(validSolution(withShifts([[0, 0, -0.01, 0, 0, 0], []]), input)).toBe(true);
});

it('refuses a shift that does not fit the model or is not a credible number', () => {
  expect(validSolution(withShifts([[0, 0, 0, 0], []]), input)).toBe(false);
  expect(validSolution(withShifts([[0, 0, 0, 0, 0, 0]]), input)).toBe(false);
  expect(validSolution(withShifts([[0, 0, Number.NaN, 0, 0, 0], []]), input)).toBe(false);
  expect(validSolution(withShifts([[0, 0, 1.5, 0, 0, 0], []]), input)).toBe(false);
});
