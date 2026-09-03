import { describe, expect, it } from 'vitest';
import { viewCubeSnapAt, viewCubeSnapDurationMs } from './viewCubeTween';
import { simulatorViewLookingFrom, type SimulatorOrbitView } from '../../lib/simulatorOrbit';
import { VIEW_CUBE_FACES } from './viewCubeGeometry';

const OPENING: SimulatorOrbitView = { yaw: Math.PI / 4, pitch: -0.955, zoom: 1.4 };

describe('the view cube snap', () => {
  it('times a turn by how far the eye moves', () => {
    // A quarter turn at 2π rad/s is a quarter second, which is drei's rule and
    // the reason the two cubes feel the same.
    const front = simulatorViewLookingFrom(OPENING, [0, 0, -1]);
    const right = simulatorViewLookingFrom(OPENING, [1, 0, 0]);
    expect(viewCubeSnapDurationMs(front, right)).toBeCloseTo(250, 6);
    expect(viewCubeSnapDurationMs(front, simulatorViewLookingFrom(OPENING, [0, 0, 1]))).toBeCloseTo(
      500,
      6
    );
  });

  it('does not spend time going nowhere', () => {
    // Snapping to the view you are already at is a no-op the eye cannot see, so
    // it gets the floor rather than the full easing curve.
    const top = simulatorViewLookingFrom(OPENING, [0, 1, 0]);
    expect(viewCubeSnapDurationMs(top, top)).toBe(120);
    // And a yaw change at the pole moves the eye not at all, however large.
    expect(viewCubeSnapDurationMs(top, { ...top, yaw: top.yaw + 3 })).toBe(120);
  });

  it('lands exactly on the view that was asked for', () => {
    // Not "close to". A snap that stops a rounding error short would leave the
    // camera off every named viewpoint, and the error would accumulate.
    for (const face of VIEW_CUBE_FACES) {
      const target = simulatorViewLookingFrom(OPENING, face.direction);
      expect(viewCubeSnapAt(OPENING, target, 1)).toBe(target);
      expect(viewCubeSnapAt(OPENING, target, 1.5)).toBe(target);
    }
  });

  it('starts where it started', () => {
    const target = simulatorViewLookingFrom(OPENING, [1, 0, 0]);
    const start = viewCubeSnapAt(OPENING, target, 0);
    expect(start.yaw).toBeCloseTo(OPENING.yaw, 12);
    expect(start.pitch).toBeCloseTo(OPENING.pitch, 12);
  });

  it('takes the short way round a wrap', () => {
    // Yaw is normalized to (−π, π], so 3.0 to −3.0 is a 0.28 rad step and not a
    // 6 rad one. Halfway must be outside the pair, not between them.
    const from: SimulatorOrbitView = { yaw: 3.0, pitch: -1, zoom: 1 };
    const to: SimulatorOrbitView = { yaw: -3.0, pitch: -1, zoom: 1 };
    const half = viewCubeSnapAt(from, to, 0.5).yaw;
    expect(Math.abs(half)).toBeGreaterThan(3.0);
  });

  it('carries the target’s zoom and orientation the whole way', () => {
    // The tween moves the eye and nothing else; `to` is spread first so a snap
    // never half-applies a zoom.
    const target = { ...simulatorViewLookingFrom(OPENING, [1, 0, 0]), zoom: 3 };
    expect(viewCubeSnapAt(OPENING, target, 0.4).zoom).toBe(3);
  });
});
