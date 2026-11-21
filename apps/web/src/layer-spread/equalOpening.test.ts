import { describe, expect, it } from 'vitest';
import { spreadOpening, type ConnectedSpread, type SpreadSolution } from '@oristudio/layer-spread';
import { connectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';
import { plainBook } from '../cp-workspace/folded/foldedPrecrease.fixtures';
import { DEFAULT_CONNECTED_SPREAD, DEFAULT_DEPTH_SPREAD } from '../cp-workspace/folded/layerSpreadSettings';
import {
  entersPerspective,
  equalOpeningAmount,
  equalOpeningGain,
  equalOpeningGainOf,
  FULL_OPENING_DEG,
  perspectiveHeightScale,
  spreadInPerspective,
  startedSpread,
  STEEPEST_AT_FULL_DEG,
} from './equalOpening';

const tanDeg = (degrees: number) => Math.tan((degrees * Math.PI) / 180);
/** Stored amount 2 (100%), doubled. */
const FULL = 4;

/** The book fixture, its free leaf lifted to `lift` at amount 1. */
function prepared(lift = 0.2) {
  const source = connectedSpreadSource(plainBook());
  const reference = { plane: [0, 0, 0] as [number, number, number], center: [0, 0, 0] as [number, number, number], samples: 1, rms: 0 };
  const solution: SpreadSolution = {
    version: 'normalized-50-v1',
    heights: source.vertices.map((id) => (id === 2 || id === 5 ? lift : 0)),
    references: [reference, reference],
    diagnostics: { status: 'solved', iterations: 1, qp_seconds: 0, variables: 6, constraints: 0,
      overlap_regions: 1, crossing_weight: 50, opening_scale: 1, max_relative_warp: 0,
      max_slope: lift, max_crossing: 0, rms_crossing: 0, mean_gap: lift / 2 },
  };
  return { source, solution };
}

describe('how many times its version 1 height a model is drawn', () => {
  it('opens neighbouring layers 12.4° at 100% when nothing is too steep', () => {
    const opening = 0.01;
    const gain = equalOpeningGainOf({ opening, steep: 0.02 });
    expect(Math.atan(FULL * gain * opening) * (180 / Math.PI)).toBeCloseTo(FULL_OPENING_DEG, 9);
  });

  it('brings a model that opened past it down, however steep', () => {
    expect(equalOpeningGainOf({ opening: 0.2, steep: 0.1 })).toBeCloseTo(tanDeg(FULL_OPENING_DEG) / (FULL * 0.2), 12);
    expect(equalOpeningGainOf({ opening: 0.2, steep: 0.1 })).toBeLessThan(1);
  });

  it('holds a gain back where the steepest paper would pass 65°, never below version 1', () => {
    const steep = 0.05;
    const held = equalOpeningGainOf({ opening: 0.001, steep });
    expect(Math.atan(FULL * held * steep) * (180 / Math.PI)).toBeCloseTo(STEEPEST_AT_FULL_DEG, 9);
    // Steeper at 100% than 65° already: no gain, and none taken away.
    expect(equalOpeningGainOf({ opening: 0.001, steep: 1 })).toBe(1);
  });

  it('keeps a solve that opens nothing as it is, and bounds the rest', () => {
    expect(equalOpeningGainOf({ opening: 0, steep: 0 })).toBe(1);
    expect(equalOpeningGainOf({ opening: 1e-6, steep: 0 })).toBe(20);
  });

  it('measures a prepared solve once, as spreadOpening reads it', () => {
    const spread = prepared();
    expect(equalOpeningGain(spread)).toBe(equalOpeningGainOf(spreadOpening(spread.source.input, spread.solution.heights)));
    expect(equalOpeningGain(spread)).toBe(equalOpeningGain(spread));
  });
});

describe('Perspective 3D’s height, by version', () => {
  const v1: ConnectedSpread = { ...DEFAULT_CONNECTED_SPREAD, amount: 1.2 };
  const v2: ConnectedSpread = { ...v1, version: 2 };

  it('doubles a version 1 amount, as every saved picture was drawn', () => {
    expect(perspectiveHeightScale(v1, prepared())).toBe(2);
    expect(perspectiveHeightScale(v1, prepared(0.0001))).toBe(2);
  });

  it('opens a version 2 amount alike on every model', () => {
    for (const lift of [0.02, 0.2]) {
      const spread = prepared(lift);
      expect(perspectiveHeightScale(v2, spread)).toBeCloseTo(2 * equalOpeningGain(spread), 12);
    }
    // Ten times the lift opens ten times as fast, so it is drawn a tenth as high.
    expect(perspectiveHeightScale(v2, prepared(0.02)) / perspectiveHeightScale(v2, prepared(0.2))).toBeCloseTo(10, 9);
  });

  it('updates a version 1 amount to the version 2 one that draws the same height, no more than 100%', () => {
    const spread = prepared(0.02);
    const amount = equalOpeningAmount({ ...v1, amount: 0.2 }, spread);
    expect(amount * perspectiveHeightScale(v2, spread)).toBeCloseTo(0.2 * 2, 3);
    // Opened past the new 100% by version 1: it comes down to 100%.
    expect(equalOpeningAmount({ ...v1, amount: 2 }, prepared(0.2))).toBe(2);
  });
});

describe('where version 2 is written', () => {
  it('makes a Default spread version 2, and leaves the others and a version 2 one as they are', () => {
    expect(spreadInPerspective(DEFAULT_CONNECTED_SPREAD)).toEqual({ ...DEFAULT_CONNECTED_SPREAD, version: 2 });
    expect(spreadInPerspective(DEFAULT_DEPTH_SPREAD)).toBe(DEFAULT_DEPTH_SPREAD);
    const shown: ConnectedSpread = { ...DEFAULT_CONNECTED_SPREAD, version: 2 };
    expect(spreadInPerspective(shown)).toBe(shown);
  });

  it('starts a spread by version 2 only in Perspective 3D', () => {
    const camera = { yaw: 0, pitch: 0, zoom: 1 };
    expect(startedSpread(DEFAULT_CONNECTED_SPREAD, undefined)).toBe(DEFAULT_CONNECTED_SPREAD);
    expect(startedSpread(DEFAULT_CONNECTED_SPREAD, { kind: 'diagram', camera, orderSide: 'front' })).toBe(DEFAULT_CONNECTED_SPREAD);
    expect(startedSpread(DEFAULT_CONNECTED_SPREAD, { kind: 'perspective', camera, orderSide: 'front' }).version).toBe(2);
  });

  it('enters Perspective 3D from Diagram or from none, never from itself', () => {
    const camera = { yaw: 0, pitch: 0, zoom: 1 };
    expect(entersPerspective(undefined, 'perspective')).toBe(true);
    expect(entersPerspective({ kind: 'diagram', camera, orderSide: 'front' }, 'perspective')).toBe(true);
    expect(entersPerspective({ kind: 'perspective', camera, orderSide: 'front' }, 'perspective')).toBe(false);
    expect(entersPerspective({ kind: 'perspective', camera, orderSide: 'front' }, 'diagram')).toBe(false);
  });
});
