import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { SYMMETRY_FOLDS, symmetryFoldLabel } from './bpSymmetryLabels';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

describe('symmetryFoldLabel', () => {
  it('names folds in origami terms', () => {
    expect(symmetryFoldLabel(t, 'book')).toBe('Book fold');
    expect(symmetryFoldLabel(t, 'diagonal')).toBe('Diagonal fold');
  });

  it('names every fold on offer', () => {
    // The names are paper-relative, so unlike the grid axis they do not depend
    // on the sheet.
    for (const fold of SYMMETRY_FOLDS) {
      expect(symmetryFoldLabel(t, fold)).toBeTruthy();
    }
  });
});
