import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  SYMMETRY_AXIS_ANGLES,
  symmetryAxisLabel,
  symmetryAxisLabelForAngle,
  symmetryFoldKind,
} from './bpSymmetryLabels';

// Stand-in for i18next: return the English default, interpolating {{...}}.
const t = ((_key: string, fallback: string, vars?: Record<string, string>) =>
  fallback.replace(/{{(\w+)}}/g, (_, name: string) => vars?.[name] ?? '')) as unknown as TFunction;

describe('symmetryFoldKind', () => {
  it('reads an axis-aligned fold as a book fold on a rectangular sheet', () => {
    expect(symmetryFoldKind('rectangular', 'verticalHalf')).toBe('book');
    expect(symmetryFoldKind('rectangular', 'horizontalHalf')).toBe('book');
  });

  it('reads the same fold as diagonal on a diamond', () => {
    // The paper is turned 45 degrees against the grid, so its corners point
    // along the grid axes and a vertical fold line joins two of them.
    expect(symmetryFoldKind('diagonal', 'verticalHalf')).toBe('diagonal');
    expect(symmetryFoldKind('diagonal', 'horizontalHalf')).toBe('diagonal');
  });

  it('swaps the 45-degree folds the same way', () => {
    expect(symmetryFoldKind('rectangular', 'mainDiagonal')).toBe('diagonal');
    expect(symmetryFoldKind('rectangular', 'antiDiagonal')).toBe('diagonal');
    expect(symmetryFoldKind('diagonal', 'mainDiagonal')).toBe('book');
    expect(symmetryFoldKind('diagonal', 'antiDiagonal')).toBe('book');
  });
});

describe('symmetryAxisLabel', () => {
  it('names the fold and where the line runs', () => {
    expect(symmetryAxisLabel(t, 'rectangular', 'verticalHalf')).toBe('Book fold, vertical');
    expect(symmetryAxisLabel(t, 'diagonal', 'verticalHalf')).toBe('Diagonal fold, vertical');
    expect(symmetryAxisLabel(t, 'rectangular', 'antiDiagonal')).toBe('Diagonal fold, falling');
  });

  it('labels every offered axis on both sheets', () => {
    for (const { angle } of SYMMETRY_AXIS_ANGLES) {
      expect(symmetryAxisLabelForAngle(t, 'rectangular', angle)).toBeTruthy();
      expect(symmetryAxisLabelForAngle(t, 'diagonal', angle)).toBeTruthy();
    }
  });

  it('has no label for an angle the optimizer cannot honour', () => {
    expect(symmetryAxisLabelForAngle(t, 'rectangular', 30)).toBeNull();
  });
});
