import { describe, expect, it } from 'vitest';
import { NEWER } from '../../lib/documentFile';
import type { AffineSpreadOptions, DepthSpreadOptions } from './foldedLayerSpread';
import { spreadAmountSlider, spreadSliderEdit } from './layerSpreadControls';
import {
  DEFAULT_CONNECTED_SPREAD,
  DEFAULT_DEPTH_SPREAD,
  DEFAULT_LAYER_SPREAD,
  DEFAULT_SPREAD_STARTS,
  readLayerSpread,
  sameSpread,
  spreadStartsAmong,
  weightedSpread,
  withSpreadField,
  writeLayerSpread,
} from './layerSpreadSettings';

const depth = (amount: number, toward: DepthSpreadOptions['toward'] = 'down'): DepthSpreadOptions => ({
  kind: 'depth',
  amount,
  toward,
});
const affine = (amount: number, axisDeg = 81): AffineSpreadOptions => ({ kind: 'affine', amount, keep: 'top', skew: 1, axisDeg });

describe('the start rule (13g), shared by the Diagram and Fold', () => {
  it('starts from the nearest earlier spread, and each kind from the nearest of its kind', () => {
    expect(spreadStartsAmong([depth(0.05), affine(0.06), depth(0.1)])).toEqual({
      connected: DEFAULT_CONNECTED_SPREAD,
      any: depth(0.05),
      depth: depth(0.05),
      affine: affine(0.06),
    });
    expect(spreadStartsAmong([affine(0.06)])).toEqual({ connected:DEFAULT_CONNECTED_SPREAD, any: affine(0.06), depth: DEFAULT_DEPTH_SPREAD, affine: affine(0.06) });
  });

  it('starts from the defaults with nothing earlier, connected first', () => {
    expect(spreadStartsAmong([])).toEqual(DEFAULT_SPREAD_STARTS);
    expect(DEFAULT_LAYER_SPREAD).toBe(DEFAULT_CONNECTED_SPREAD);
  });

  it('stops walking back once all kinds are found', () => {
    let read = 0;
    function* earlier() {
      for (const spread of [depth(0.05), affine(0.06), DEFAULT_CONNECTED_SPREAD, depth(0.1)]) {
        read += 1;
        yield spread;
      }
    }
    spreadStartsAmong(earlier());
    expect(read).toBe(3);
  });
});

describe('a spread set by its controls', () => {
  it('sets one value within its range, and leaves a spread of the other kind alone', () => {
    expect(withSpreadField(affine(0.03), { verb: 'spread-axis', axisDeg: 200 })).toEqual(affine(0.03, 20));
    expect(withSpreadField(depth(0.05), { verb: 'spread-skew', skew: 0.5 })).toEqual(depth(0.05));
    expect(withSpreadField(depth(0.05), { verb: 'spread-amount', amount: 0.07, kind: 'affine' })).toEqual(depth(0.05));
  });

  it('turns a slider’s value into its edit, clamped as the file holds it', () => {
    expect(spreadSliderEdit('amount', 'depth', 0.123456)).toEqual({ verb: 'spread-amount', amount: 0.1235, kind: 'depth' });
    expect(spreadSliderEdit('skew', 'affine', 1.4)).toEqual({ verb: 'spread-skew', skew: 1 });
    expect(spreadSliderEdit('axis', 'affine', 270)).toEqual({ verb: 'spread-axis', axisDeg: 90 });
  });

  it('lays the amount out in whole percents, ends rounded inward, float noise ignored', () => {
    // Default's 0 to 2 is 0% to 100%; 0.49 shows at 25% and stays 0.49 until the slider moves.
    expect(spreadAmountSlider('connected', 0.49)).toEqual({ scale: 50, min: 0, max: 100, step: 1, value: 25 });
    // 1.13 × 50 is 56.49999999999999 in floats: still a half, rounded up.
    expect(spreadAmountSlider('connected', 1.13).value).toBe(57);
    // Depth's 0.5% end and its 2.5% start round to whole percents.
    expect(spreadAmountSlider('depth', DEFAULT_DEPTH_SPREAD.amount)).toEqual({ scale: 100, min: 1, max: 20, step: 1, value: 3 });
    expect(spreadAmountSlider('affine', 0.005)).toMatchObject({ min: 1, max: 25, value: 1 });
  });

  it('tells a spread from another, and no spread from none', () => {
    expect(sameSpread(null, undefined)).toBe(true);
    expect(sameSpread(affine(0.03), null)).toBe(false);
    expect(sameSpread(affine(0.03), { ...affine(0.03) })).toBe(true);
  });
});

describe('a spread part of the way on (the motion seam)', () => {
  it('scales the amount, none at 0 and the spread itself at 1', () => {
    expect(weightedSpread(affine(0.04), 0.5)).toEqual(affine(0.02));
    expect(weightedSpread(affine(0.04), 0)).toBeNull();
    expect(weightedSpread(affine(0.04), 1)).toEqual(affine(0.04));
    expect(weightedSpread(null, 1)).toBeNull();
  });
});

describe('a spread as a file holds it', () => {
  it('writes every field in a fixed order, and reads back what it wrote', () => {
    for (const spread of [depth(0.025, 'up-left'), affine(0.03)]) {
      const written = writeLayerSpread(spread);
      expect(readLayerSpread(JSON.parse(JSON.stringify(written)))).toEqual(spread);
      expect(JSON.stringify(writeLayerSpread(readLayerSpread(written) as typeof spread))).toBe(JSON.stringify(written));
    }
    expect(Object.keys(writeLayerSpread(affine(0.03)))).toEqual(['kind', 'amount', 'keep', 'skew', 'axisDeg']);
  });

  it('reads a newer build’s spread as news, and a damaged one as damage', () => {
    expect(readLayerSpread(undefined)).toBeUndefined();
    expect(readLayerSpread({ kind: 'curve', amount: 0.1 })).toBe(NEWER);
    expect(readLayerSpread({ ...affine(0.03), bend: 2 })).toBe(NEWER);
    expect(readLayerSpread({ ...affine(0.03), amount: 0.9 })).toBe(NEWER);
    expect(readLayerSpread({ ...affine(0.03), amount: -1 })).toBeNull();
    expect(readLayerSpread('affine')).toBeNull();
    // Before there were two kinds, every spread was by depth.
    expect(readLayerSpread({ amount: 0.05, toward: 'down' })).toEqual(depth(0.05));
  });
});
