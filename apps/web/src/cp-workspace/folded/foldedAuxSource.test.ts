import { describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { SEG_ATTR_STRIDE } from '../../engine/oristudioCpGeometry';
import { cpAuxLinesKey, NO_AUX_LINES_KEY } from './foldedAuxSource';

/** A transport of `[x1, y1, x2, y2, colour]` segments. */
function transport(segments: [number, number, number, number, number][]): CpGeometryTransport {
  const segAttr = new Int32Array(segments.length * SEG_ATTR_STRIDE);
  segments.forEach((segment, i) => {
    segAttr[i * SEG_ATTR_STRIDE] = segment[4];
  });
  return {
    segEndpoints: Float64Array.from(segments.flatMap((segment) => segment.slice(0, 4))),
    segAttr,
  } as unknown as CpGeometryTransport;
}

const SQUARE: [number, number, number, number, number][] = [
  [0, 0, 1, 0, 0],
  [1, 0, 1, 1, 0],
  [1, 1, 0, 1, 0],
  [0, 1, 0, 0, 0],
  [0, 0, 1, 1, 1],
];

describe('cpAuxLinesKey', () => {
  it('is the same for any document with no aux line, and for none at all', () => {
    expect(cpAuxLinesKey(transport(SQUARE))).toBe(NO_AUX_LINES_KEY);
    expect(cpAuxLinesKey(null)).toBe(NO_AUX_LINES_KEY);
  });

  it('changes when an aux line is drawn or moved, and not for any other edit', () => {
    const one = cpAuxLinesKey(transport([...SQUARE, [0, 0.5, 1, 0.5, 3]]));
    expect(one).not.toBe(NO_AUX_LINES_KEY);
    const moved = cpAuxLinesKey(transport([...SQUARE, [0, 0.25, 1, 0.25, 3]]));
    expect(moved).not.toBe(one);
    // A crease recoloured, or a new mountain, leaves the aux lines alone.
    const edited = cpAuxLinesKey(
      transport([...SQUARE.slice(0, 4), [0, 0, 1, 1, 2], [0, 0.5, 1, 0.5, 3], [0, 1, 1, 0, 1]])
    );
    expect(edited).toBe(one);
  });
});
