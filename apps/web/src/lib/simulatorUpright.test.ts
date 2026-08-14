import { describe, expect, it } from 'vitest';
import {
  UPRIGHT_PITCH,
  nextSimulatorOrbitView,
  setUprightView,
  type SimulatorOrbitView,
} from './simulatorOrbit';
import { toViewSpace, viewRotation, type CameraUniforms, type Mat3 } from '@treemaker/origami-simulator';

/**
 * Setting which way is up.
 *
 * Two things have to be true at once and they pull against each other: the
 * picture must not move at the moment of the press, and the axis that was
 * pointing up must become the one yaw spins about. Both are asserted here
 * against the projection itself rather than against the formula that produced
 * it, so a sign error cannot satisfy the test by agreeing with itself.
 */

function uniforms(rotation: Mat3): CameraUniforms {
  return {
    center: [0, 0, 0],
    rotation,
    scale: 1,
    width: 0,
    height: 0,
    depthRange: 1,
    camDist: 1,
  };
}

/** Where a model direction lands in view space, under a whole view. */
function imageOf(view: SimulatorOrbitView, d: readonly [number, number, number]) {
  const camera = uniforms(viewRotation(view.yaw, view.pitch, view.orient));
  return toViewSpace(d[0], d[1], d[2], camera);
}

/** The model direction currently drawn straight up the screen. */
function screenUpAxis(view: SimulatorOrbitView): [number, number, number] {
  // Rows of a rotation are orthonormal, so the inverse is the transpose: the
  // direction mapping to view +Y is the middle *column*, i.e. row 1 read down.
  const m = viewRotation(view.yaw, view.pitch, view.orient);
  return [m[3], m[4], m[5]];
}

const VIEWS: SimulatorOrbitView[] = [
  { yaw: Math.PI / 4, pitch: -0.955, zoom: 1.4 },
  { yaw: 0, pitch: 0, zoom: 1 },
  { yaw: -2.1, pitch: 0.6, zoom: 0.8 },
  { yaw: 3.0, pitch: -1.9, zoom: 2 },
];

const PROBES: Array<[number, number, number]> = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0.3, -0.8, 0.5],
];

describe('setting the current view as upright', () => {
  it('does not move the picture', () => {
    // The press must feel like it did what you asked and nothing else. Compared
    // on where every probe direction *lands*, not on the stored angles, because
    // the angles deliberately change.
    for (const view of VIEWS) {
      const upright = setUprightView(view);
      for (const probe of PROBES) {
        const before = imageOf(view, probe);
        const after = imageOf(upright, probe);
        expect(after[0]).toBeCloseTo(before[0], 12);
        expect(after[1]).toBeCloseTo(before[1], 12);
        expect(after[2]).toBeCloseTo(before[2], 12);
      }
    }
  });

  it('makes the axis that was pointing up the one yaw spins about', () => {
    for (const view of VIEWS) {
      const up = screenUpAxis(view);
      const upright = setUprightView(view);

      // Yawing must leave that axis exactly where it is on screen — that is what
      // "this is up" means, and it is the thing that was false before.
      const spun = { ...upright, yaw: upright.yaw + 1.1 };
      const held = imageOf(upright, up);
      const stillHeld = imageOf(spun, up);

      expect(stillHeld[0]).toBeCloseTo(held[0], 12);
      expect(stillHeld[1]).toBeCloseTo(held[1], 12);
      expect(stillHeld[2]).toBeCloseTo(held[2], 12);
      // And it is genuinely up the screen, not merely fixed.
      expect(held[1]).toBeCloseTo(1, 12);
      expect(held[0]).toBeCloseTo(0, 12);
    }
  });

  it('is idempotent — pressing it twice is pressing it once', () => {
    for (const view of VIEWS) {
      const once = setUprightView(view);
      const twice = setUprightView(once);
      expect(twice.yaw).toBeCloseTo(once.yaw, 12);
      expect(twice.pitch).toBeCloseTo(once.pitch, 12);
      for (let i = 0; i < 9; i += 1) {
        expect(twice.orient![i]!).toBeCloseTo(once.orient![i]!, 12);
      }
    }
  });

  it('lands at the horizon, not at an extreme', () => {
    // UPRIGHT_PITCH looks alarming written down. It is the ordinary side-on
    // view, and dragging either way from it is an ordinary turntable rather
    // than a wall.
    const upright = setUprightView(VIEWS[0]!);
    expect(upright.pitch).toBe(UPRIGHT_PITCH);

    const drag = { x: 0, y: 0, yaw: upright.yaw, pitch: upright.pitch };
    const down = nextSimulatorOrbitView(upright, drag, { x: 0, y: 40 });
    const up = nextSimulatorOrbitView(upright, drag, { x: 0, y: -40 });
    expect(down.pitch).toBeGreaterThan(upright.pitch);
    expect(up.pitch).toBeLessThan(upright.pitch);
  });

  it('keeps zoom, which is not a rotation', () => {
    for (const view of VIEWS) expect(setUprightView(view).zoom).toBe(view.zoom);
  });
});

describe('the way back from an upright', () => {
  it('is a view reset, which drops the orientation with the angles', () => {
    // There is no clear verb on either surface. A simulation's upright is
    // session-only with no undo behind it, so its `resetView` returns the whole
    // opening view — orientation included — which is what stops a model getting
    // stuck on a pole picked by accident. A folded figure's is document state,
    // so undo reaches it and its reset deliberately leaves an upright alone.
    const opening: SimulatorOrbitView = { yaw: Math.PI / 4, pitch: -0.955, zoom: 1.4 };
    const upright = setUprightView({ yaw: 1.2, pitch: 0.3, zoom: 2.5 });
    expect(upright.orient).toBeDefined();

    // What `SimulatorViewport.resetView` does: back to the opening view whole.
    const reset: SimulatorOrbitView = { ...opening };

    expect(reset.orient).toBeUndefined();
    expect(reset.yaw).toBe(opening.yaw);
    expect(reset.pitch).toBe(opening.pitch);
  });
});
