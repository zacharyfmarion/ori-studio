import { describe, expect, it } from 'vitest';
import {
  SHADOW_EDGE_TEXTURE_WIDTH,
  TEXELS_PER_EDGE,
  packShadowEdges,
  unpackShadowPoint,
  unpackShadowStep,
} from './shadowProgram';

describe('packShadowEdges', () => {
  it('round-trips segment endpoints to within 16-bit resolution of the scene', () => {
    const edges = new Float32Array([
      -100.5, 20.25, 340.75, -80, //
      0, 0, 1, 1, //
      2000, -1000, -50, 999.5,
    ]);
    const packed = packShadowEdges(edges, new Uint8Array([1, 1, 1]), 3);
    const tolerance = Math.max(packed.span[0], packed.span[1]) / 65535;

    for (let edge = 0; edge < 3; edge++) {
      for (const end of [0, 1] as const) {
        const [x, y] = unpackShadowPoint(packed, edge, end);
        expect(Math.abs(x - edges[edge * 4 + end * 2])).toBeLessThanOrEqual(tolerance);
        expect(Math.abs(y - edges[edge * 4 + end * 2 + 1])).toBeLessThanOrEqual(tolerance);
      }
    }
  });

  it('keeps each segment\'s ledge height beside its endpoints', () => {
    const packed = packShadowEdges(
      new Float32Array([0, 0, 1, 0, 0, 0, 1, 1]),
      new Uint8Array([1, 7]),
      2
    );

    expect(unpackShadowStep(packed, 0)).toBe(1);
    expect(unpackShadowStep(packed, 1)).toBe(7);
  });

  it('never records a ledge below one sheet, which would cast nothing', () => {
    const packed = packShadowEdges(new Float32Array([0, 0, 1, 0]), new Uint8Array([0]), 1);

    expect(unpackShadowStep(packed, 0)).toBe(1);
  });

  it('lays three texels per segment across rows of the fixed width', () => {
    const count = SHADOW_EDGE_TEXTURE_WIDTH + 3;
    const edges = new Float32Array(count * 4).map((_, i) => i);
    const packed = packShadowEdges(edges, new Uint8Array(count).fill(2), count);

    expect(packed.width).toBe(SHADOW_EDGE_TEXTURE_WIDTH);
    expect(packed.height).toBe(Math.ceil((count * TEXELS_PER_EDGE) / SHADOW_EDGE_TEXTURE_WIDTH));
    expect(packed.data.length).toBe(packed.width * packed.height * 4);
    // The last segment lands where the shader will look for it.
    const [x] = unpackShadowPoint(packed, count - 1, 1);
    expect(x).toBeCloseTo(edges[(count - 1) * 4 + 2], 0);
    expect(unpackShadowStep(packed, count - 1)).toBe(2);
  });

  it('stays decodable with no segments at all', () => {
    const packed = packShadowEdges(new Float32Array(0), new Uint8Array(0), 0);

    expect(packed.height).toBe(1);
    expect(packed.span[0]).toBeGreaterThan(0);
    expect(packed.span[1]).toBeGreaterThan(0);
  });

  it('spans a degenerate axis rather than dividing by zero', () => {
    const packed = packShadowEdges(new Float32Array([5, 7, 9, 7]), new Uint8Array([1]), 1);

    expect(packed.span[1]).toBeGreaterThan(0);
    expect(unpackShadowPoint(packed, 0, 1)[1]).toBeCloseTo(7, 6);
  });
});
