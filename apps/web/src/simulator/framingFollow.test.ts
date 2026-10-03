import { describe, expect, it } from 'vitest';
import {
  FRAMING_DEAD_BAND,
  FRAMING_EASE_MS,
  FRAMING_MEASURE_MS,
  createFramingFollow,
  followFraming,
  framingOf,
  type Framing,
} from './framingFollow';

const FLAT: Framing = { center: [0, 0, 0], radius: 10 };
const FOLDED: Framing = { center: [1, 0, 0], radius: 2 };

/** A shape that is `shape` whenever it is measured, counting the measures. */
function shapeOf(shape: { current: Framing }) {
  let measures = 0;
  return {
    measure: () => {
      measures += 1;
      return shape.current;
    },
    measures: () => measures,
  };
}

describe('followFraming', () => {
  it('lands on the first shape it sees', () => {
    const follow = createFramingFollow();
    const { measure } = shapeOf({ current: FLAT });
    expect(followFraming(follow, 0, measure, false)).toEqual({ framing: FLAT, arrived: true });
  });

  it('eases toward a shape that has folded, by time rather than by frame', () => {
    const follow = createFramingFollow();
    const shape = { current: FLAT };
    const { measure } = shapeOf(shape);
    followFraming(follow, 0, measure, false);
    shape.current = FOLDED;
    // One time constant after the fold is measured: about two thirds of the way,
    // the radius by ratio.
    followFraming(follow, FRAMING_MEASURE_MS, measure, false);
    const { framing, arrived } = followFraming(
      follow,
      FRAMING_MEASURE_MS + FRAMING_EASE_MS,
      measure,
      false
    );
    expect(arrived).toBe(false);
    const k = 1 - Math.exp(-(FRAMING_EASE_MS + FRAMING_MEASURE_MS) / FRAMING_EASE_MS);
    expect(framing.radius).toBeCloseTo(10 * Math.pow(0.2, k), 9);
    expect(framing.center[0]).toBeCloseTo(k, 9);
  });

  it('arrives, and says so, once it is close enough to land', () => {
    const follow = createFramingFollow();
    const shape = { current: FLAT };
    const { measure } = shapeOf(shape);
    followFraming(follow, 0, measure, false);
    shape.current = FOLDED;
    let result = followFraming(follow, FRAMING_MEASURE_MS, measure, true);
    let now = FRAMING_MEASURE_MS;
    while (!result.arrived && now < 10_000) {
      now += 16;
      result = followFraming(follow, now, measure, true);
    }
    expect(result).toEqual({ framing: FOLDED, arrived: true });
    // A few time constants, not the whole budget.
    expect(now).toBeLessThan(FRAMING_MEASURE_MS + 8 * FRAMING_EASE_MS);
  });

  it('measures a moving shape a few times a second, not every frame', () => {
    const follow = createFramingFollow();
    const shape = shapeOf({ current: FLAT });
    for (let now = 0; now <= 1000; now += 16) followFraming(follow, now, shape.measure, false);
    expect(shape.measures()).toBeLessThanOrEqual(Math.ceil(1000 / FRAMING_MEASURE_MS) + 1);
  });

  it('measures once more when the shape settles, however recently it last did', () => {
    const follow = createFramingFollow();
    const shape = { current: FLAT };
    const counted = shapeOf(shape);
    followFraming(follow, 0, counted.measure, false);
    shape.current = FOLDED;
    followFraming(follow, 1, counted.measure, true);
    expect(counted.measures()).toBe(2);
    // And not again while it stays settled.
    followFraming(follow, 2, counted.measure, true);
    expect(counted.measures()).toBe(2);
  });

  it('holds still for a shape that moves by less than the dead band', () => {
    // A settling solver moves the bounds by a hair; the camera must not breathe.
    const follow = createFramingFollow();
    const shape = { current: FLAT };
    const { measure } = shapeOf(shape);
    followFraming(follow, 0, measure, false);
    shape.current = { center: [0, 0, 0], radius: 10 * (1 + FRAMING_DEAD_BAND / 2) };
    const result = followFraming(follow, FRAMING_MEASURE_MS, measure, false);
    expect(result).toEqual({ framing: FLAT, arrived: true });
  });
});

describe('framingOf', () => {
  it('is the centroid and the bounding radius about it', () => {
    const framing = framingOf(new Float32Array([0, 0, 0, 2, 0, 0, 1, 3, 0]));
    expect(framing.center).toEqual([1, 1, 0]);
    expect(framing.radius).toBeCloseTo(2, 6);
  });

  it('never frames a degenerate model at zero radius', () => {
    expect(framingOf(new Float32Array([1, 1, 1, 1, 1, 1])).radius).toBeGreaterThan(0);
  });
});

describe('framingOf with pinned nodes', () => {
  // Three points along x: the pinned one at the left end.
  const positions = new Float32Array([0, 0, 0, 4, 0, 0, 8, 0, 0]);

  it('centres on the model when nothing is pinned', () => {
    expect(framingOf(positions)).toEqual({ center: [4, 0, 0], radius: 4 });
    expect(framingOf(positions, null)).toEqual({ center: [4, 0, 0], radius: 4 });
    expect(framingOf(positions, [])).toEqual({ center: [4, 0, 0], radius: 4 });
  });

  it('centres on the pinned nodes, and reaches the whole model from there', () => {
    // Centred on the pin, the radius has to span the far end to keep it in frame.
    expect(framingOf(positions, [0])).toEqual({ center: [0, 0, 0], radius: 8 });
    expect(framingOf(positions, Uint32Array.from([0, 1]))).toEqual({ center: [2, 0, 0], radius: 6 });
  });
});
