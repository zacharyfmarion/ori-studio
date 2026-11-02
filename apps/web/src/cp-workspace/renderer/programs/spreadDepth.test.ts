import { expect, it } from 'vitest';
import { spreadInkDepthBias } from './spreadDepth';

it('keeps ink resolvably above its own fill without crossing the next layer on deep stacks', () => {
  for (const bits of [16, 24, 32]) {
    // Simulate both float attributes and quantized window depth.
    const depth = (d: number) => Math.round(Math.fround(1 - Math.fround(1 - 2 * d)) / 2 * (2 ** bits - 1));
    for (const bands of [1, 256, 2048]) {
      const bias = spreadInkDepthBias(bands, bits);
      for (const rank of [0, Math.floor(bands / 2), bands - 1]) {
        for (const z of [0, 0.5, 1]) {
          const fill = (rank + 0.1 + 0.8 * z) / bands;
          expect(depth(Math.fround(fill + bias))).toBeGreaterThan(depth(fill));
        }
        if (rank + 1 < bands) {
          const ink = (rank + 0.9) / bands + bias;
          const coveringPaper = (rank + 1.1) / bands;
          expect(depth(Math.fround(ink))).toBeLessThan(depth(coveringPaper));
        }
      }
    }
  }
});

it('is the whole range’s bias when the picture owns it, and stays inside a figure’s band', () => {
  for (const bands of [1, 256, 2048]) expect(spreadInkDepthBias(bands, 24, 1)).toBe(spreadInkDepthBias(bands, 24));
  // Edit's canvas: twelve figures, each a twelfth of the range.
  const bits = 24;
  const span = 1 / 12;
  const base = 5 / 12;
  const depth = (d: number) => Math.round(Math.fround(1 - Math.fround(1 - 2 * d)) / 2 * (2 ** bits - 1));
  for (const bands of [1, 64, 256]) {
    const bias = spreadInkDepthBias(bands, bits, span);
    for (const rank of [0, bands - 1]) {
      const fill = base + span * ((rank + 0.1 + 0.8) / bands);
      expect(depth(Math.fround(fill + bias))).toBeGreaterThan(depth(fill));
      // Never past the figure's band: the next figure's paper still covers it.
      expect(base + span * ((rank + 0.9) / bands) + bias).toBeLessThan(base + span * ((rank + 1.1) / bands));
    }
  }
});
