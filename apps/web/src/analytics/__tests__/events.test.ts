import { describe, expect, it } from 'vitest';
import { PAPER_STYLE_FIELDS, type PaperStyleField } from '../../lib/paper/paperStyle';
import { bucketCount, PAPER_STYLE_FIELD_NAMES, type PaperStyleFieldName } from '../events';

describe('bucketCount', () => {
  it('returns the first threshold the value fits under', () => {
    expect(bucketCount(0, [1, 5, 20])).toBe('<=1');
    expect(bucketCount(1, [1, 5, 20])).toBe('<=1');
    expect(bucketCount(3, [1, 5, 20])).toBe('<=5');
    expect(bucketCount(20, [1, 5, 20])).toBe('<=20');
  });

  it('returns ">last" when the value exceeds every threshold', () => {
    expect(bucketCount(21, [1, 5, 20])).toBe('>20');
    expect(bucketCount(1000, [1, 5, 20])).toBe('>20');
  });
});

describe('PAPER_STYLE_FIELD_NAMES', () => {
  it('names exactly the paper style’s fields, so no edit goes uncounted', () => {
    // Each type assignable to the other, so tsc fails first on a one-sided edit.
    const nameOf = (field: PaperStyleField): PaperStyleFieldName => field;
    const fieldOf = (name: PaperStyleFieldName): PaperStyleField => name;
    expect(PAPER_STYLE_FIELDS.map(nameOf).map(fieldOf)).toEqual(PAPER_STYLE_FIELDS);
    expect([...PAPER_STYLE_FIELD_NAMES].sort()).toEqual([...PAPER_STYLE_FIELDS].sort());
  });
});
