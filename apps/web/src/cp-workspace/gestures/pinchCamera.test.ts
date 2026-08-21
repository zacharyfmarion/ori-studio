import { describe, expect, it } from 'vitest';
import {
  projectModelPoint,
  unprojectDevicePoint,
  userCameraToView,
  type UserCamera,
} from '../renderer/camera';
import type { Viewport } from '../renderer/types';
import { applyPinchToCamera } from './pinchCamera';
import { contactCentroid, pinchTransform, type GesturePoint } from './pinchTransform';

const viewportOf = (ratio: number): Viewport => ({
  width: 800 * ratio,
  height: 600 * ratio,
  dpr: ratio,
});

const cameraAt = (over: Partial<UserCamera> = {}): UserCamera => ({
  centerX: 200,
  centerY: 140,
  zoom: 3,
  rotation: 0,
  ...over,
});

/** The user point currently under a canvas-relative client position. */
const userUnder = (
  cam: UserCamera,
  viewport: Viewport,
  point: GesturePoint,
  ratio: number
): GesturePoint => {
  const view = userCameraToView(cam, viewport);
  const user = unprojectDevicePoint(view, point.x * ratio, point.y * ratio);
  if (!user) throw new Error('degenerate camera');
  return user;
};

/** Where a user point now sits, back in canvas-relative client pixels. */
const screenOf = (
  cam: UserCamera,
  viewport: Viewport,
  user: GesturePoint,
  ratio: number
): GesturePoint => {
  const device = projectModelPoint(userCameraToView(cam, viewport), user.x, user.y);
  return { x: device.x / ratio, y: device.y / ratio };
};

describe('applyPinchToCamera', () => {
  it('does nothing for the identity transform', () => {
    const cam = cameraAt();
    applyPinchToCamera(cam, viewportOf(1), { dx: 0, dy: 0, scale: 1 }, { x: 400, y: 300 }, 1);
    expect(cam).toEqual(cameraAt());
  });

  it.each([1, 2, 3])('holds the anchor fixed while zooming at ratio %s', (ratio) => {
    const viewport = viewportOf(ratio);
    const cam = cameraAt();
    const anchor = { x: 120, y: 480 };
    const anchored = userUnder(cam, viewport, anchor, ratio);

    applyPinchToCamera(cam, viewport, { dx: 0, dy: 0, scale: 1.75 }, anchor, ratio);

    expect(cam.zoom).toBeCloseTo(3 * 1.75, 9);
    const after = screenOf(cam, viewport, anchored, ratio);
    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);
  });

  it('holds the anchor fixed on a rotated view', () => {
    // The camera owns rotation and both verbs route through its single
    // device->user inverse, so a turned view must not shear the gesture.
    const ratio = 2;
    const viewport = viewportOf(ratio);
    const cam = cameraAt({ rotation: Math.PI / 5 });
    const anchor = { x: 610, y: 90 };
    const anchored = userUnder(cam, viewport, anchor, ratio);

    applyPinchToCamera(cam, viewport, { dx: 0, dy: 0, scale: 0.4 }, anchor, ratio);

    const after = screenOf(cam, viewport, anchored, ratio);
    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);
    expect(cam.rotation).toBe(Math.PI / 5);
  });

  it('moves the content with the fingers, not against them', () => {
    // The sign that separates a drag from a scroll: `onWheel` negates, this
    // must not. A two-finger drag right moves the paper right.
    const ratio = 1;
    const viewport = viewportOf(ratio);
    const cam = cameraAt();
    const mark = userUnder(cam, viewport, { x: 400, y: 300 }, ratio);

    applyPinchToCamera(cam, viewport, { dx: 60, dy: -25, scale: 1 }, { x: 400, y: 300 }, ratio);

    const after = screenOf(cam, viewport, mark, ratio);
    expect(after.x).toBeCloseTo(460, 6);
    expect(after.y).toBeCloseTo(275, 6);
  });

  it('scales a drag by the device ratio', () => {
    const cam = cameraAt();
    const other = cameraAt();
    applyPinchToCamera(cam, viewportOf(1), { dx: 30, dy: 0, scale: 1 }, { x: 0, y: 0 }, 1);
    applyPinchToCamera(other, viewportOf(2), { dx: 30, dy: 0, scale: 1 }, { x: 0, y: 0 }, 2);
    // Twice the device pixels for the same CSS drag, but the camera zoom is in
    // device px per user unit too, so the paper travels the same distance under
    // the fingers on a Retina screen as on a plain one.
    expect(other.centerX - 200).toBeCloseTo((cam.centerX - 200) * 2, 9);
  });
});

describe('the gesture end to end', () => {
  // The property requirement 2 is actually asking for, stated exactly: whatever
  // user point was under the fingers before the sample is under them after it.
  // Everything else about the pinch is a matter of taste; this is not.
  const cases: readonly [string, GesturePoint[], GesturePoint[]][] = [
    [
      'spreading',
      [
        { x: 300, y: 300 },
        { x: 400, y: 300 },
      ],
      [
        { x: 250, y: 300 },
        { x: 450, y: 300 },
      ],
    ],
    [
      'pinching in while sliding',
      [
        { x: 200, y: 120 },
        { x: 500, y: 420 },
      ],
      [
        { x: 300, y: 200 },
        { x: 420, y: 320 },
      ],
    ],
    [
      'a plain two-finger drag',
      [
        { x: 100, y: 100 },
        { x: 260, y: 180 },
      ],
      [
        { x: 190, y: 40 },
        { x: 350, y: 120 },
      ],
    ],
    [
      'one finger left of a pinch',
      [{ x: 640, y: 500 }],
      [{ x: 610, y: 470 }],
    ],
  ];

  it.each(cases)('keeps the paper under the fingers while %s', (_label, prev, next) => {
    const ratio = 2;
    const viewport = viewportOf(ratio);
    const cam = cameraAt({ rotation: -0.4 });
    const anchor = contactCentroid(prev)!;
    const anchored = userUnder(cam, viewport, anchor, ratio);

    applyPinchToCamera(cam, viewport, pinchTransform(prev, next), anchor, ratio);

    const after = screenOf(cam, viewport, anchored, ratio);
    const target = contactCentroid(next)!;
    expect(after.x).toBeCloseTo(target.x, 6);
    expect(after.y).toBeCloseTo(target.y, 6);
  });

  it('survives a long staggered pinch without the paper creeping', () => {
    // A pinch delivers one `pointermove` per finger, so the camera is driven by
    // dozens of half-updated samples. The anchor invariant has to hold across
    // the whole chain, not just one sample — this is what a fixed reference
    // point taken at gesture start would get wrong.
    const ratio = 2;
    const viewport = viewportOf(ratio);
    const cam = cameraAt();
    let contacts: GesturePoint[] = [
      { x: 340, y: 300 },
      { x: 460, y: 300 },
    ];
    const anchored = userUnder(cam, viewport, contactCentroid(contacts)!, ratio);

    for (let step = 0; step < 40; step++) {
      // Alternate fingers, exactly as the browser delivers them.
      const moving = step % 2;
      const prev = contacts;
      const next = prev.map((point, index) =>
        index === moving ? { x: point.x + (moving === 0 ? -3 : 5), y: point.y + 1 } : point
      );
      const anchor = contactCentroid(prev)!;
      applyPinchToCamera(cam, viewport, pinchTransform(prev, next), anchor, ratio);
      contacts = next;
    }

    const after = screenOf(cam, viewport, anchored, ratio);
    const target = contactCentroid(contacts)!;
    expect(after.x).toBeCloseTo(target.x, 4);
    expect(after.y).toBeCloseTo(target.y, 4);
  });
});
