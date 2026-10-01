import { describe, expect, it } from 'vitest';
import { APPLE_MOBILE_PNG_CANVAS_LIMIT, pngFitsCanvas } from './pngCanvasLimits';

describe('pngFitsCanvas', () => {
  it('takes a page up to the engine’s side limit', () => {
    expect(pngFitsCanvas({ width: 16_384, height: 1_000 })).toBe(true);
    expect(pngFitsCanvas({ width: 16_385, height: 1_000 })).toBe(false);
    expect(pngFitsCanvas({ width: 1_000, height: 16_385 })).toBe(false);
  });

  it('holds an iPhone or iPad to its area, however the sides are shared', () => {
    expect(pngFitsCanvas({ width: 4_096, height: 4_096 }, APPLE_MOBILE_PNG_CANVAS_LIMIT)).toBe(true);
    expect(pngFitsCanvas({ width: 8_192, height: 2_048 }, APPLE_MOBILE_PNG_CANVAS_LIMIT)).toBe(true);
    expect(pngFitsCanvas({ width: 8_192, height: 2_049 }, APPLE_MOBILE_PNG_CANVAS_LIMIT)).toBe(false);
  });
});
