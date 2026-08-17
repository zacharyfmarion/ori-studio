import { describe, expect, it } from 'vitest';

import { advanceFoldedFigureOrbit, beginFoldedFigureOrbit } from './foldedFigureOrbitGesture';
import { DEFAULT_FOLDED_3D_CAMERA } from './foldedFigure3dProjection';
import { unprojectDevicePoint, userCameraToView, type UserCamera } from '../renderer/camera';

/**
 * A turn belongs to the hand, not to the crease-pattern camera.
 *
 * `foldedFigureOrbitGesture.test.ts` already pins that this module answers a
 * drag exactly as `nextSimulatorOrbitView` does. That test passed throughout the
 * bug this file exists for, and could never have failed: the arithmetic was
 * always shared, and what differed was the **space the canvas measured the drag
 * in**. A simulation window measures `clientX/clientY`; the crease-pattern
 * canvas ran the same pointer through `clientToUser` first and handed on the
 * result.
 *
 * So the property worth stating is about the *composition*, and it is stated
 * against the real camera math rather than a local re-derivation of it — the
 * whole point is that `unprojectDevicePoint ∘ userCameraToView` is not the
 * identity on deltas, so a private copy of it would prove nothing.
 */

/** Device pixels per CSS pixel, as the canvas's `clientToUser` applies it. */
const DPR = 1;

function camera(overrides: Partial<UserCamera> = {}): UserCamera {
  return { centerX: 200, centerY: 200, zoom: 1, rotation: 0, ...overrides };
}

/**
 * The canvas's `clientToUser`, composed from the modules it actually calls.
 *
 * The viewport and the camera centre only shift the origin, and a turn is a
 * *difference* of two of these, so neither affects anything asserted below —
 * what survives the subtraction is exactly the linear part, which is the scale
 * and the rotation this file is about.
 */
function clientToUser(cam: UserCamera, clientX: number, clientY: number) {
  const point = unprojectDevicePoint(
    userCameraToView(cam, { width: 1200 * DPR, height: 800 * DPR, dpr: DPR }),
    clientX * DPR,
    clientY * DPR
  );
  if (!point) throw new Error('degenerate camera');
  return point;
}

/** Where a hand movement of `(dx, dy)` CSS pixels leaves the figure. */
function turnBy(
  dx: number,
  dy: number,
  through: (clientX: number, clientY: number) => { x: number; y: number }
) {
  const drag = beginFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, through(400, 300));
  return advanceFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, drag, through(400 + dx, 300 + dy));
}

const screenSpace = (clientX: number, clientY: number) => ({ x: clientX, y: clientY });

const CAMERAS = [
  camera({ zoom: DPR }),
  camera({ zoom: DPR * 4 }),
  camera({ zoom: DPR * 0.25 }),
  camera({ zoom: DPR, rotation: Math.PI / 6 }),
];

const key = (turn: { yaw: number; pitch: number }) =>
  `${turn.yaw.toFixed(9)},${turn.pitch.toFixed(9)}`;

describe('the turn a drag produces', () => {
  it('is one answer in screen space and four in user space', () => {
    const screen = CAMERAS.map(() => turnBy(60, 40, screenSpace));
    const user = CAMERAS.map((cam) => turnBy(60, 40, (x, y) => clientToUser(cam, x, y)));

    // Screen space takes no camera at all, so the same hand movement is the same
    // turn whatever the crease pattern is doing. That is the fix, and it is what
    // an inline simulation has always done.
    expect(new Set(screen.map(key)).size).toBe(1);

    // User space gave a different turn for every one of them, which is the bug.
    expect(new Set(user.map(key)).size).toBe(CAMERAS.length);
  });

  it('keeps a horizontal drag a pure yaw', () => {
    const turn = turnBy(60, 0, screenSpace);

    expect(turn.pitch).toBeCloseTo(DEFAULT_FOLDED_3D_CAMERA.pitch, 12);
    expect(turn.yaw).not.toBeCloseTo(DEFAULT_FOLDED_3D_CAMERA.yaw, 6);
  });
});

/**
 * The rejected path, characterised — so the reason the canvas may not unproject
 * is a failing assertion rather than a comment someone can talk themselves out
 * of.
 */
describe('measuring the drag in crease-pattern user space', () => {
  it('is right at 100% zoom and nowhere else', () => {
    const reference = turnBy(60, 40, screenSpace);
    const yawOf = (turn: { yaw: number }) => turn.yaw - DEFAULT_FOLDED_3D_CAMERA.yaw;

    // The zoom readout defines 100% as one user unit per CSS pixel, i.e.
    // `cam.zoom === dpr`, so the `* dpr` and the `/ zoom` cancel exactly there.
    // That single coincidence is why this read as "odd" rather than as broken.
    expect(turnBy(60, 40, (x, y) => clientToUser(camera({ zoom: DPR }), x, y))).toEqual(reference);

    // A quarter of the turn at 4x, four times it at 1/4x.
    expect(yawOf(turnBy(60, 40, (x, y) => clientToUser(camera({ zoom: DPR * 4 }), x, y)))).toBeCloseTo(
      yawOf(reference) / 4,
      12
    );
    expect(
      yawOf(turnBy(60, 40, (x, y) => clientToUser(camera({ zoom: DPR * 0.25 }), x, y)))
    ).toBeCloseTo(yawOf(reference) * 4, 12);
  });

  it('turns a horizontal drag into a pitch on a rotated canvas', () => {
    // The other half, and the one that reads as the gesture being off-axis: the
    // view rotation rotates the delta, so a drag straight across the screen
    // arrives as a mix of yaw and pitch.
    const rotated = turnBy(60, 0, (x, y) =>
      clientToUser(camera({ zoom: DPR, rotation: Math.PI / 6 }), x, y)
    );

    expect(rotated.pitch).not.toBeCloseTo(DEFAULT_FOLDED_3D_CAMERA.pitch, 6);
  });
});
