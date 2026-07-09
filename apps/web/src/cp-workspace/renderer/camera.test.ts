import { describe, expect, it } from 'vitest';
import {
  projectModelPoint,
  viewTransformFromSamples,
  viewTransformScale,
  viewTransformsEqual,
} from './camera';

describe('viewTransformFromSamples', () => {
  it('recovers a uniform scale + translation', () => {
    // model (0,0)->(100,50), scale 2 px/unit
    const view = viewTransformFromSamples({ x: 100, y: 50 }, { x: 102, y: 50 }, { x: 100, y: 52 });
    expect(view.origin).toEqual([100, 50]);
    expect(view.ex).toEqual([2, 0]);
    expect(view.ey).toEqual([0, 2]);
    // a model point maps as origin + x*ex + y*ey
    expect(projectModelPoint(view, 3, 4)).toEqual({ x: 106, y: 58 });
  });

  it('handles a Y-flip (screen y-down vs model y-up)', () => {
    const view = viewTransformFromSamples({ x: 0, y: 200 }, { x: 1, y: 200 }, { x: 0, y: 199 });
    expect(view.ey).toEqual([0, -1]);
    expect(projectModelPoint(view, 0, 100)).toEqual({ x: 0, y: 100 });
  });
});

describe('viewTransformScale', () => {
  it('is the device px per model unit for a uniform transform', () => {
    const view = viewTransformFromSamples({ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 3 });
    expect(viewTransformScale(view)).toBeCloseTo(3);
  });
});

describe('viewTransformsEqual', () => {
  const base = viewTransformFromSamples({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 });
  it('is true for identical transforms', () => {
    expect(viewTransformsEqual(base, { ...base })).toBe(true);
  });
  it('is false when a component drifts beyond epsilon', () => {
    expect(viewTransformsEqual(base, { ...base, origin: [0.01, 0] })).toBe(false);
  });
});
