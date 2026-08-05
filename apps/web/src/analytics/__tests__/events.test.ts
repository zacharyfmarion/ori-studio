import { describe, expect, it } from 'vitest';
import { bucketCount } from '../events';

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
