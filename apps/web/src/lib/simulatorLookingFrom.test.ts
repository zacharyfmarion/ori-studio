import { describe, expect, it } from 'vitest';
import {
  setUprightView,
  simulatorViewLookingFrom,
  type SimulatorOrbitView,
  type SimulatorViewDirection,
} from './simulatorOrbit';
import { viewRotation } from '@treemaker/origami-simulator';

/**
 * Looking at the model from a named direction.
 *
 * Asserted against `viewRotation` itself rather than against the trigonometry
 * that produced the angles, for the same reason `simulatorUpright.test.ts`
 * projects its probes: a sign error that agrees with itself would otherwise
 * pass. Row 2 of the rotation *is* the eye direction, so "does this view look
 * from there" is a direct read rather than an inference.
 */

/** Where the eye is, under a whole view. */
function eyeDirection(view: SimulatorOrbitView): SimulatorViewDirection {
  const m = viewRotation(view.yaw, view.pitch, view.orient);
  return [m[6], m[7], m[8]];
}

/** The model direction drawn straight up the screen — row 1, read across. */
function screenUpAxis(view: SimulatorOrbitView): SimulatorViewDirection {
  const m = viewRotation(view.yaw, view.pitch, view.orient);
  return [m[3], m[4], m[5]];
}

function expectDirection(actual: SimulatorViewDirection, expected: SimulatorViewDirection) {
  expect(actual[0]).toBeCloseTo(expected[0], 12);
  expect(actual[1]).toBeCloseTo(expected[1], 12);
  expect(actual[2]).toBeCloseTo(expected[2], 12);
}

const AXES: Array<[string, SimulatorViewDirection]> = [
  ['right (+X)', [1, 0, 0]],
  ['left (−X)', [-1, 0, 0]],
  ['top (+Y)', [0, 1, 0]],
  ['bottom (−Y)', [0, -1, 0]],
  ['back (+Z)', [0, 0, 1]],
  ['front (−Z)', [0, 0, -1]],
];

/** The four side-on faces: the ones for which "upright" is a question. */
const SIDES = AXES.filter(([, d]) => d[1] === 0);

const STARTING_VIEWS: SimulatorOrbitView[] = [
  { yaw: Math.PI / 4, pitch: -0.955, zoom: 1.4 },
  { yaw: 0, pitch: 0, zoom: 1 },
  { yaw: -2.1, pitch: 0.6, zoom: 0.8 },
  { yaw: 3.0, pitch: -1.9, zoom: 2 },
];

describe('looking from a direction', () => {
  it('puts the eye exactly where it was asked to', () => {
    for (const start of STARTING_VIEWS) {
      for (const [, direction] of AXES) {
        expectDirection(eyeDirection(simulatorViewLookingFrom(start, direction)), direction);
      }
    }
  });

  it('lands the model upright, not on its head', () => {
    // The other branch of the inversion names the same eye direction and negates
    // the up row. Nothing about the eye direction catches that, so it is checked
    // where it shows: which way is up.
    for (const start of STARTING_VIEWS) {
      for (const [name, direction] of SIDES) {
        const up = screenUpAxis(simulatorViewLookingFrom(start, direction));
        // The paper's normal, straight up the screen — a sheet seen edge-on.
        expect(up[1], name).toBeCloseTo(1, 12);
      }
    }
  });

  it('reproduces the opening view from its own corner', () => {
    // DEFAULT_SIMULATOR_VIEW is the eye on the (1, 1, −1) diagonal. Clicking that
    // corner of a view cube has to return there and not to a near miss.
    const root = 1 / Math.sqrt(3);
    const view = simulatorViewLookingFrom({ yaw: 0, pitch: 0, zoom: 1.4 }, [root, root, -root]);
    expect(view.yaw).toBeCloseTo(Math.PI / 4, 12);
    expect(view.pitch).toBeCloseTo(-0.9553166, 6);
  });

  it('keeps the yaw on the poles, where it names nothing', () => {
    // Looking straight down the yaw axis, every yaw draws the same eye. Choosing
    // one would spin the paper about the line of sight for no reason.
    const start: SimulatorOrbitView = { yaw: 1.234, pitch: -0.7, zoom: 1 };
    expect(simulatorViewLookingFrom(start, [0, 1, 0]).yaw).toBe(start.yaw);
    expect(simulatorViewLookingFrom(start, [0, -1, 0]).yaw).toBe(start.yaw);
  });

  it('keeps zoom and orientation, which are not the eye', () => {
    const upright = setUprightView({ yaw: 1.2, pitch: 0.3, zoom: 2.5 });
    const looked = simulatorViewLookingFrom(upright, [1, 0, 0]);
    expect(looked.zoom).toBe(upright.zoom);
    expect(looked.orient).toBe(upright.orient);
  });

  it('still reaches the paper axis after an upright has been set', () => {
    // `orient` multiplies on the right of the camera, so it has to be folded into
    // the target before the angles are solved. Transposing it here would pass
    // every identity-orientation test above and be wrong on every standing model.
    for (const start of STARTING_VIEWS) {
      const upright = setUprightView(start);
      expect(upright.orient).toBeDefined();
      for (const [, direction] of AXES) {
        expectDirection(eyeDirection(simulatorViewLookingFrom(upright, direction)), direction);
      }
    }
  });
});
