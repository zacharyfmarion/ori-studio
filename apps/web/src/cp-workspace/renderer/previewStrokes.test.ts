import { describe, expect, it } from 'vitest';
import { previewGroupsToStrokes, previewSegmentsToStrokes } from './previewStrokes';
import { OVERLAY_DASH_PATTERN, type Rgba } from './types';

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];

const seg = (n: number) => ({ a: { x: n, y: n }, b: { x: n + 1, y: n + 1 } });

/** The RGBA of segment `i`, for readable assertions. */
function colorAt(color: Float32Array, i: number): number[] {
  return Array.from(color.slice(i * 4, i * 4 + 4));
}

describe('previewGroupsToStrokes', () => {
  it('packs endpoints in order across groups', () => {
    const strokes = previewGroupsToStrokes([
      { segments: [seg(0)], color: RED },
      { segments: [seg(10)], color: BLUE },
    ]);

    expect(strokes.count).toBe(2);
    expect(Array.from(strokes.a)).toEqual([0, 0, 10, 10]);
    expect(Array.from(strokes.b)).toEqual([1, 1, 11, 11]);
  });

  /**
   * The regression this exists for: candidate geometry and existing-crease
   * highlights ride the same channel. They used to be concatenated into one array
   * and stroked in one colour, so painting candidates in the active crease colour
   * also painted every hovered crease in it — the crease read as though the tool
   * had recoloured it.
   */
  it('gives each group its own colour', () => {
    const strokes = previewGroupsToStrokes([
      { segments: [seg(0), seg(1)], color: RED },
      { segments: [seg(10)], color: BLUE },
    ]);

    expect(strokes.count).toBe(3);
    expect(colorAt(strokes.color, 0)).toEqual([1, 0, 0, 1]);
    expect(colorAt(strokes.color, 1)).toEqual([1, 0, 0, 1]);
    expect(colorAt(strokes.color, 2)).toEqual([0, 0, 1, 1]);
  });

  it('skips empty groups without disturbing the packing', () => {
    const strokes = previewGroupsToStrokes([
      { segments: [], color: RED },
      { segments: [seg(5)], color: BLUE },
      { segments: [], color: RED },
    ]);

    expect(strokes.count).toBe(1);
    expect(Array.from(strokes.a)).toEqual([5, 5]);
    expect(colorAt(strokes.color, 0)).toEqual([0, 0, 1, 1]);
  });

  it('produces empty geometry when every group is empty', () => {
    const strokes = previewGroupsToStrokes([{ segments: [], color: RED }]);

    expect(strokes.count).toBe(0);
    expect(strokes.a).toHaveLength(0);
    expect(strokes.color).toHaveLength(0);
  });

  it('carries the overlay dash pattern only when dashed', () => {
    expect(previewGroupsToStrokes([{ segments: [seg(0)], color: RED }]).dashPatterns).toEqual([]);
    expect(
      previewGroupsToStrokes([{ segments: [seg(0)], color: RED }], true).dashPatterns
    ).toEqual([OVERLAY_DASH_PATTERN]);
  });

  it('defaults every segment to the base width', () => {
    const strokes = previewGroupsToStrokes([{ segments: [seg(0), seg(1)], color: RED }]);
    expect(Array.from(strokes.widthMul)).toEqual([1, 1]);
  });
});

describe('previewSegmentsToStrokes', () => {
  it('is the single-colour form of the grouped packer', () => {
    const segments = [seg(0), seg(3)];
    const single = previewSegmentsToStrokes(segments, RED, true);
    const grouped = previewGroupsToStrokes([{ segments, color: RED }], true);

    expect(single.count).toBe(grouped.count);
    expect(Array.from(single.a)).toEqual(Array.from(grouped.a));
    expect(Array.from(single.b)).toEqual(Array.from(grouped.b));
    expect(Array.from(single.color)).toEqual(Array.from(grouped.color));
    expect(single.dashPatterns).toEqual(grouped.dashPatterns);
  });
});
