import { expect, it } from 'vitest';
import { NEWER } from '../../lib/documentFile';
import { clampReveal, readLayerSpread, withSpreadField, writeLayerSpread, DEFAULT_CONNECTED_SPREAD } from './layerSpreadSettings';

it('excludes the center on edits but preserves saved zero reveal', () => {
  const saved = { ...DEFAULT_CONNECTED_SPREAD, reveal: [0, 0] as [number, number] };
  expect(readLayerSpread(saved)).toEqual(saved);
  expect(clampReveal([0, 0], [0, -1])).toEqual([0, -0.1]);
  expect(Math.hypot(...clampReveal([0.001, 0.001]))).toBeCloseTo(0.1);
  expect(Math.hypot(...clampReveal([10, -10]))).toBeCloseTo(3);
  const next = withSpreadField(saved, { verb: 'spread-reveal', reveal: [0, 0] });
  expect(next.kind === 'connected' && Math.hypot(...next.reveal)).toBeCloseTo(0.1);
});

it.each<[number, number]>([
  [0, 0], [0.001, -0.002], [0.8, 0.6], [-1.2, 1.6], [2, 0],
  [2.000005, 0], // Preserve the old reader's rim tolerance too.
  [1.8, -2.4], [0, 3], [-3, 0],
])('round trips saved reveal (%s, %s) exactly, without rescaling height or direction', (x, y) => {
  const saved = { ...DEFAULT_CONNECTED_SPREAD, amount: 0.37, reveal: [x, y] as [number, number] };
  const bytes = JSON.stringify(writeLayerSpread(saved));
  const read = readLayerSpread(JSON.parse(bytes));
  expect(read).toEqual(saved);
  if (!read || read === NEWER) throw new Error('Expected a known spread');
  expect(JSON.stringify(writeLayerSpread(read))).toBe(bytes);
});

it('extends vector and axis edits without changing the height or default view', () => {
  expect(DEFAULT_CONNECTED_SPREAD).toEqual({ kind: 'connected', version: 1, amount: 0.14, reveal: [0.8, 0.6] });
  const spread = { ...DEFAULT_CONNECTED_SPREAD, amount: 0.23 };
  expect(withSpreadField(spread, { verb: 'spread-reveal', reveal: [1.8, -2.4] }))
    .toEqual({ ...spread, reveal: [1.8, -2.4] });
  expect(withSpreadField({ ...spread, reveal: [0, 0] }, { verb: 'spread-reveal-axis', axis: 1, value: -3 }))
    .toEqual({ ...spread, reveal: [0, -3] });
  const clamped = clampReveal([12, -16]);
  expect(clamped[0]).toBeCloseTo(1.8);
  expect(clamped[1]).toBeCloseTo(-2.4);
});

it('recognizes unsupported radii as newer data and rejects nonfinite values', () => {
  expect(readLayerSpread({ ...DEFAULT_CONNECTED_SPREAD, reveal: [3.000005, 0] })).not.toBe(NEWER);
  for (const reveal of [[3.001, 0], [2.5, 2.5]]) {
    expect(readLayerSpread({ ...DEFAULT_CONNECTED_SPREAD, reveal })).toBe(NEWER);
  }
  for (const reveal of [[NaN, 0], [0, Infinity]]) {
    expect(readLayerSpread({ ...DEFAULT_CONNECTED_SPREAD, reveal })).toBeNull();
  }
});
