import { expect, it } from 'vitest';
import { clampReveal, readLayerSpread, snapRevealToCenter, withSpreadField, DEFAULT_CONNECTED_SPREAD } from './layerSpreadSettings';
it('takes no reveal as an edit like any other, and caps the rim', () => {
  const saved = { ...DEFAULT_CONNECTED_SPREAD, reveal: [0, 0] as [number, number] };
  expect(readLayerSpread(saved)).toEqual(saved);
  expect(clampReveal([0, 0])).toEqual([0, 0]);
  expect(clampReveal([0.001, -0.002])).toEqual([0.001, -0.002]);
  expect(Math.hypot(...clampReveal([10, -10]))).toBeCloseTo(2);
  expect(clampReveal([Number.NaN, 0])).toEqual(DEFAULT_CONNECTED_SPREAD.reveal);
  const cleared = withSpreadField(DEFAULT_CONNECTED_SPREAD, { verb: 'spread-reveal', reveal: [0, 0] });
  expect(cleared.kind === 'connected' && cleared.reveal).toEqual([0, 0]);
  const oneAxis = withSpreadField(cleared, { verb: 'spread-reveal-axis', axis: 0, value: 0.4 });
  expect(oneAxis.kind === 'connected' && oneAxis.reveal).toEqual([0.4, 0]);
});
it('snaps a pointer at the pad\'s centre to no reveal, and nowhere else', () => {
  expect(snapRevealToCenter([0.05, -0.05])).toEqual([0, 0]);
  expect(snapRevealToCenter([0.1, 0])).toEqual([0.1, 0]);
  expect(Math.hypot(...snapRevealToCenter([10, -10]))).toBeCloseTo(2);
});
