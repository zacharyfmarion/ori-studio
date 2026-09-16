import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { SYMMETRY_FOLDS, symmetryFoldLabel, symmetryProblemLabel } from './bpSymmetryLabels';

const t = ((_key: string, fallback: string, options?: Record<string, string>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => options?.[name] ?? '')) as unknown as TFunction;

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

describe('symmetryProblemLabel', () => {
  it('names the unpaired flaps and the verbs that pair them', () => {
    const label = symmetryProblemLabel(t, { kind: 'unpaired', names: ['a', 'c'] });
    expect(label).toContain('a, c');
    expect(label).toContain('Pair with mirror');
    expect(label).toContain('Pair all mirrored');
  });

  it('has words for every problem', () => {
    expect(symmetryProblemLabel(t, { kind: 'axis-off-centre' })).toContain('centre of the sheet');
    expect(symmetryProblemLabel(t, { kind: 'not-a-mirror' })).toContain('not a mirror');
  });
});
