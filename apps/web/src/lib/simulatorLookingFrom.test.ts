import { describe, expect, it } from 'vitest';
import {
  setUprightView,
  simulatorViewLookingFrom,
  type SimulatorOrbitView,
  type SimulatorViewDirection,
} from './simulatorOrbit';
import { viewRotation, viewRotationFor } from '@treemaker/origami-simulator';

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
  const m = viewRotationFor(view);
  return [m[6], m[7], m[8]];
}

/** The model direction drawn straight up the screen — row 1, read across. */
function screenUpAxis(view: SimulatorOrbitView): SimulatorViewDirection {
  const m = viewRotationFor(view);
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

  it('answers the yaw on the poles rather than inheriting it', () => {
    // Nothing about the direction pins the in-plane angle here, so keeping the
    // camera's own yaw does not avoid an arbitrary spin — it preserves one. The
    // four side faces come up square because their yaw *is* pinned; Top and
    // Bottom used to come up at whatever angle the last drag ended on.
    const start: SimulatorOrbitView = { yaw: 1.234, pitch: -0.7, zoom: 1 };
    expect(simulatorViewLookingFrom(start, [0, 1, 0]).yaw).toBe(0);
    expect(simulatorViewLookingFrom(start, [0, -1, 0]).yaw).toBe(0);
  });

  it('lays Top out the way the crease-pattern canvas draws it', () => {
    // Which is why zero is the answer rather than merely a fallback: at
    // (yaw 0, pitch 0) the transform is screen_x = FOLD x, screen_y = −FOLD y.
    const top = simulatorViewLookingFrom({ yaw: 2.5, pitch: 0.4, zoom: 1 }, [0, 1, 0]);
    const m = viewRotationFor(top);
    // Row 0 is screen-right, row 1 screen-up.
    expect([m[0], m[1], m[2]]).toEqual([1, 0, 0]);
    expect(m[3]).toBeCloseTo(0, 12);
    expect(m[4]).toBeCloseTo(0, 12);
    expect(m[5]).toBeCloseTo(1, 12);
  });

  it('leaves any roll alone: it is not the eye either', () => {
    // Roll spins the picture about the line of sight, so it says nothing about
    // where you are looking from. A snap that wiped it would undo a deliberate
    // choice for no reason.
    const rolled: SimulatorOrbitView = { yaw: 1, pitch: -0.8, zoom: 1, roll: 0.9 };
    expect(simulatorViewLookingFrom(rolled, [0, 0, -1]).roll).toBe(0.9);
  });

  it('keeps zoom and orientation, which are not the eye', () => {
    const upright = setUprightView({ yaw: 1.2, pitch: 0.3, zoom: 2.5 });
    const looked = simulatorViewLookingFrom(upright, [1, 0, 0]);
    expect(looked.zoom).toBe(upright.zoom);
    expect(looked.orient).toBe(upright.orient);
  });

  it('names directions in the frame an upright chose, not the paper’s', () => {
    // The argument is in the camera's own frame, so an upright changes which
    // physical direction it names and nothing about how it is solved. That is
    // what lets a view cube stay honest across one: the cube shows the frame the
    // angles turn in, so its vertical is the axis a drag actually spins about.
    for (const start of STARTING_VIEWS) {
      const upright = setUprightView(start);
      expect(upright.orient).toBeDefined();
      for (const [, direction] of AXES) {
        const looked = simulatorViewLookingFrom(upright, direction);
        // Row 2 of the camera alone — the eye in the chosen frame.
        const camera = viewRotation(looked.yaw, looked.pitch);
        expectDirection([camera[6], camera[7], camera[8]], direction);
        // And the orientation is carried, not consumed.
        expect(looked.orient).toBe(upright.orient);
      }
    }
  });

  it('leaves the paper reachable through the orientation it was given', () => {
    // The paper's axes have not gone anywhere; they are just no longer what an
    // argument names. `orient · n` is the paper direction `n` restated in the
    // chosen frame, and asking for that still puts the eye on the paper's axis —
    // which is the conversion this function used to do for every caller.
    const upright = setUprightView({ yaw: 1.2, pitch: 0.3, zoom: 2.5 });
    const orient = upright.orient!;
    for (const [, direction] of AXES) {
      const inChosenFrame: SimulatorViewDirection = [
        orient[0] * direction[0] + orient[1] * direction[1] + orient[2] * direction[2],
        orient[3] * direction[0] + orient[4] * direction[1] + orient[5] * direction[2],
        orient[6] * direction[0] + orient[7] * direction[1] + orient[8] * direction[2],
      ];
      const looked = simulatorViewLookingFrom(upright, inChosenFrame);
      expectDirection(eyeDirection(looked), direction);
    }
  });
});
