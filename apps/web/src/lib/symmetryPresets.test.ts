import { describe, expect, it } from 'vitest';
import {
  defaultSymmetryOption,
  nextSymmetryOption,
  paperCenter,
  symmetrySelectValueForState,
  symmetryOptionForAngle,
  symmetryOptionForPreset,
} from './symmetryPresets';

describe('symmetry preset helpers', () => {
  it('infers the closest preset option from an existing angle', () => {
    expect(symmetryOptionForAngle(90).variant).toBe('vertical');
    expect(symmetryOptionForAngle(182).variant).toBe('horizontal');
    expect(symmetryOptionForAngle(47).variant).toBe('risingDiagonal');
    expect(symmetryOptionForAngle(132).variant).toBe('fallingDiagonal');
  });

  it('uses the first option as the default when changing preset families', () => {
    expect(symmetryOptionForPreset('diagonal', 90)).toEqual(defaultSymmetryOption('diagonal'));
    expect(symmetryOptionForPreset('book', 45)).toEqual(defaultSymmetryOption('book'));
  });

  it('cycles within the selected preset family', () => {
    const vertical = defaultSymmetryOption('book');
    expect(nextSymmetryOption(vertical).variant).toBe('horizontal');
    expect(nextSymmetryOption(nextSymmetryOption(vertical)).variant).toBe('vertical');
  });

  it('centers symmetry presets on the current paper dimensions', () => {
    expect(paperCenter(2, 3)).toEqual({ x: 1, y: 1.5 });
  });

  it('maps symmetry state to the dropdown value', () => {
    expect(
      symmetrySelectValueForState({
        hasSymmetry: false,
        symAngle: 90,
        symLoc: { x: 0.5, y: 0.5 },
        paperWidth: 1,
        paperHeight: 1,
      }),
    ).toBe('none');
    expect(
      symmetrySelectValueForState({
        hasSymmetry: true,
        symAngle: 45,
        symLoc: { x: 0.5, y: 0.5 },
        paperWidth: 1,
        paperHeight: 1,
      }),
    ).toBe('diagonal');
    expect(
      symmetrySelectValueForState({
        hasSymmetry: true,
        symAngle: 44,
        symLoc: { x: 0.5, y: 0.5 },
        paperWidth: 1,
        paperHeight: 1,
      }),
    ).toBe('custom');
    expect(
      symmetrySelectValueForState({
        hasSymmetry: true,
        symAngle: 90,
        symLoc: { x: 0.25, y: 0.5 },
        paperWidth: 1,
        paperHeight: 1,
      }),
    ).toBe('custom');
  });
});
