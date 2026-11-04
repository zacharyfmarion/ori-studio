import { expect, it } from 'vitest';
import { clampReveal, readLayerSpread, withSpreadField, DEFAULT_CONNECTED_SPREAD } from './layerSpreadSettings';
it('excludes the center on edits but preserves saved zero reveal', () => {
  const saved = { ...DEFAULT_CONNECTED_SPREAD, reveal: [0, 0] as [number, number] };
  expect(readLayerSpread(saved)).toEqual(saved);
  expect(clampReveal([0, 0], [0, -1])).toEqual([0, -0.1]);
  expect(Math.hypot(...clampReveal([0.001, 0.001]))).toBeCloseTo(0.1);
  expect(Math.hypot(...clampReveal([10, -10]))).toBeCloseTo(2);
  const next = withSpreadField(saved, { verb: 'spread-reveal', reveal: [0, 0] });
  expect(next.kind === 'connected' && Math.hypot(...next.reveal)).toBeCloseTo(0.1);
});
