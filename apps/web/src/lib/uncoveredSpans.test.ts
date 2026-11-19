import { describe, expect, it } from 'vitest';
import { uncoveredSpans } from './uncoveredSpans';

describe('uncoveredSpans', () => {
  it('leaves the whole segment when nothing covers it', () => {
    expect(uncoveredSpans([], 1e-6)).toEqual([[0, 1]]);
  });

  it('takes a covered stretch out of the middle, whichever way round it is given', () => {
    expect(uncoveredSpans([[0.25, 0.5]], 1e-6)).toEqual([
      [0, 0.25],
      [0.5, 1],
    ]);
    expect(uncoveredSpans([[0.5, 0.25]], 1e-6)).toEqual([
      [0, 0.25],
      [0.5, 1],
    ]);
  });

  it('merges stretches that overlap, in any order', () => {
    expect(
      uncoveredSpans(
        [
          [0.6, 0.8],
          [0.1, 0.3],
          [0.25, 0.4],
        ],
        1e-6
      )
    ).toEqual([
      [0, 0.1],
      [0.4, 0.6],
      [0.8, 1],
    ]);
  });

  it('clips a stretch at the ends, and leaves nothing of a segment covered past both', () => {
    expect(uncoveredSpans([[-0.5, 0.5]], 1e-6)).toEqual([[0.5, 1]]);
    expect(uncoveredSpans([[-1, 2]], 1e-6)).toEqual([]);
  });

  it('makes no gap of a stretch of the same line beyond the segment', () => {
    expect(uncoveredSpans([[1.2, 1.5]], 1e-6)).toEqual([[0, 1]]);
    expect(uncoveredSpans([[-0.4, -0.1]], 1e-6)).toEqual([[0, 1]]);
  });

  it('drops a gap no longer than the rounding', () => {
    expect(uncoveredSpans([[1e-7, 0.5]], 1e-6)).toEqual([[0.5, 1]]);
    expect(uncoveredSpans([[0, 1 - 1e-7]], 1e-6)).toEqual([]);
    expect(
      uncoveredSpans(
        [
          [0, 0.5],
          [0.5 + 1e-7, 1],
        ],
        1e-6
      )
    ).toEqual([]);
  });
});
