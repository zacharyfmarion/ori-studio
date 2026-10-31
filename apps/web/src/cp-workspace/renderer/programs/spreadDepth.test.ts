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
