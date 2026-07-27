import { describe, expect, it } from 'vitest';
import {
  fitUserCamera,
  modelViewFromCamera,
  normalizeCameraRotation,
  panUserCamera,
  projectModelPoint,
  unprojectDevicePoint,
  userCameraToView,
  viewTransformFromSamples,
  viewTransformScale,
  viewTransformsEqual,
  zoomUserCameraAt,
  type UserCamera,
} from './camera';
import type { Viewport } from './types';

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

describe('UserCamera', () => {
  const vp: Viewport = { width: 800, height: 600, dpr: 1 };

  it('maps the camera centre to the viewport centre', () => {
    const cam: UserCamera = { centerX: 50, centerY: 40, zoom: 2, rotation: 0 };
    const view = userCameraToView(cam, vp);
    expect(projectModelPoint(view, 50, 40)).toEqual({ x: 400, y: 300 });
    // +1 user unit east -> +zoom device px
    expect(projectModelPoint(view, 51, 40)).toEqual({ x: 402, y: 300 });
  });

  it('pans in user units', () => {
    const cam: UserCamera = { centerX: 0, centerY: 0, zoom: 2, rotation: 0 };
    panUserCamera(cam, 10, -4); // drag content right/up -> centre left/down
    expect(cam.centerX).toBeCloseTo(-5);
    expect(cam.centerY).toBeCloseTo(2);
  });

  it('zooms about the cursor, keeping that user point fixed', () => {
    const cam: UserCamera = { centerX: 0, centerY: 0, zoom: 2, rotation: 0 };
    const view0 = userCameraToView(cam, vp);
    const before = projectModelPoint(view0, 100, 50);
    zoomUserCameraAt(cam, vp, before.x, before.y, 1.5);
    const after = projectModelPoint(userCameraToView(cam, vp), 100, 50);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(cam.zoom).toBeCloseTo(3);
  });

  it('fits content bounds centered in the viewport', () => {
    const cam = fitUserCamera({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, vp, 1);
    expect(cam.centerX).toBeCloseTo(50);
    expect(cam.centerY).toBeCloseTo(50);
    // limited by the shorter viewport axis (height 600 / content 100 = 6)
    expect(cam.zoom).toBeCloseTo(6);
    // content corners land inside the viewport
    const view = userCameraToView(cam, vp);
    const tl = projectModelPoint(view, 0, 0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeLessThanOrEqual(vp.height);
  });

  it('composes model->device via modelToSvg', () => {
    const cam: UserCamera = { centerX: 0, centerY: 0, zoom: 2, rotation: 0 };
    // modelToSvg scales model by 10 (model 1 -> user 10)
    const modelToSvg = (p: { x: number; y: number }) => ({ x: p.x * 10, y: p.y * 10 });
    const view = modelViewFromCamera(cam, vp, modelToSvg);
    // model (0,0) -> user (0,0) -> device viewport centre
    expect(projectModelPoint(view, 0, 0)).toEqual({ x: 400, y: 300 });
    // model +1 -> user +10 -> device +10*zoom = +20
    expect(projectModelPoint(view, 1, 0).x).toBeCloseTo(420);
  });
});

describe('normalizeCameraRotation', () => {
  it('wraps to (-PI, PI]', () => {
    expect(normalizeCameraRotation(0)).toBe(0);
    expect(normalizeCameraRotation(Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(normalizeCameraRotation(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeCameraRotation(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeCameraRotation(2 * Math.PI + 0.25)).toBeCloseTo(0.25);
  });

  it('snaps a floating-point speck back to exactly zero', () => {
    // 24 steps of 15 degrees is a full turn; the residue must not leave the
    // view "rotated" by an invisible amount (the reset affordance keys off it).
    let angle = 0;
    for (let i = 0; i < 24; i++) angle = normalizeCameraRotation(angle + Math.PI / 12);
    expect(angle).toBe(0);
  });
});

describe('UserCamera under rotation', () => {
  const vp: Viewport = { width: 800, height: 600, dpr: 1 };
  // Deliberately includes 0 (regression guard) and 45 degrees (worst case for
  // the fit extent), plus a negative and a non-multiple-of-45 angle.
  const ANGLES = [0, Math.PI / 6, Math.PI / 4, Math.PI / 2, (2 * Math.PI) / 3, -Math.PI / 3];

  it('turns content clockwise on screen for a positive angle', () => {
    // Pins the sign convention the toolbar buttons depend on. Screen y is down,
    // so model east swinging to screen down is a clockwise quarter turn.
    const view = userCameraToView({ centerX: 0, centerY: 0, zoom: 1, rotation: Math.PI / 2 }, vp);
    const centre = projectModelPoint(view, 0, 0);
    const east = projectModelPoint(view, 1, 0);
    expect(east.x - centre.x).toBeCloseTo(0);
    expect(east.y - centre.y).toBeCloseTo(1);
  });

  it('rotates the basis while keeping it orthogonal and uniformly scaled', () => {
    for (const rotation of ANGLES) {
      const view = userCameraToView({ centerX: 0, centerY: 0, zoom: 3, rotation }, vp);
      const [exx, exy] = view.ex;
      const [eyx, eyy] = view.ey;
      expect(Math.hypot(exx, exy)).toBeCloseTo(3);
      expect(Math.hypot(eyx, eyy)).toBeCloseTo(3);
      expect(exx * eyx + exy * eyy).toBeCloseTo(0); // orthogonal
      expect(viewTransformScale(view)).toBeCloseTo(3); // tolerance math stays valid
    }
  });

  it('always maps the camera centre to the viewport centre', () => {
    for (const rotation of ANGLES) {
      const cam: UserCamera = { centerX: 17, centerY: -9, zoom: 2.5, rotation };
      const at = projectModelPoint(userCameraToView(cam, vp), cam.centerX, cam.centerY);
      expect(at.x).toBeCloseTo(400);
      expect(at.y).toBeCloseTo(300);
    }
  });

  it('round-trips project -> unproject at every angle', () => {
    for (const rotation of ANGLES) {
      const view = userCameraToView({ centerX: 4, centerY: 6, zoom: 1.7, rotation }, vp);
      for (const p of [
        { x: 0, y: 0 },
        { x: 120, y: -45 },
        { x: -33.5, y: 88.25 },
      ]) {
        const device = projectModelPoint(view, p.x, p.y);
        const back = unprojectDevicePoint(view, device.x, device.y);
        expect(back).not.toBeNull();
        expect(back!.x).toBeCloseTo(p.x);
        expect(back!.y).toBeCloseTo(p.y);
      }
    }
  });

  it('pans so content follows the cursor at any angle', () => {
    for (const rotation of ANGLES) {
      const cam: UserCamera = { centerX: 0, centerY: 0, zoom: 2, rotation };
      // The model point that starts under the cursor must still be under it
      // after dragging by the same device delta.
      const before = userCameraToView(cam, vp);
      const grabbed = unprojectDevicePoint(before, 500, 380);
      panUserCamera(cam, 60, -25);
      const after = projectModelPoint(userCameraToView(cam, vp), grabbed!.x, grabbed!.y);
      expect(after.x).toBeCloseTo(500 + 60);
      expect(after.y).toBeCloseTo(380 - 25);
    }
  });

  it('zooms about the cursor at any angle', () => {
    for (const rotation of ANGLES) {
      for (const factor of [1.35, 1 / 1.35]) {
        const cam: UserCamera = { centerX: -3, centerY: 11, zoom: 2, rotation };
        const anchorDevice = { x: 610, y: 155 };
        const anchor = unprojectDevicePoint(userCameraToView(cam, vp), anchorDevice.x, anchorDevice.y);
        zoomUserCameraAt(cam, vp, anchorDevice.x, anchorDevice.y, factor);
        const after = projectModelPoint(userCameraToView(cam, vp), anchor!.x, anchor!.y);
        expect(after.x).toBeCloseTo(anchorDevice.x);
        expect(after.y).toBeCloseTo(anchorDevice.y);
        expect(cam.zoom).toBeCloseTo(2 * factor);
      }
    }
  });

  it('fits rotated content inside the viewport', () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 40 };
    for (const rotation of ANGLES) {
      const cam = fitUserCamera(bounds, vp, 1, rotation);
      expect(cam.rotation).toBe(rotation);
      const view = userCameraToView(cam, vp);
      for (const [x, y] of [
        [bounds.minX, bounds.minY],
        [bounds.maxX, bounds.minY],
        [bounds.minX, bounds.maxY],
        [bounds.maxX, bounds.maxY],
      ]) {
        const p = projectModelPoint(view, x, y);
        // Allow a hair of float slack at the exact-fit boundary.
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x).toBeLessThanOrEqual(vp.width + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeLessThanOrEqual(vp.height + 1e-6);
      }
    }
  });

  it('fits a square turned 45 degrees tighter than its diagonal would allow', () => {
    // The naive width/height fit would ignore that a rotated square presents
    // its diagonal to the viewport, overshooting by sqrt(2).
    const square = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const upright = fitUserCamera(square, vp, 1, 0);
    const turned = fitUserCamera(square, vp, 1, Math.PI / 4);
    expect(turned.zoom).toBeCloseTo(upright.zoom / Math.SQRT2);
  });

  it('keeps model->device composition correct when rotated', () => {
    const cam: UserCamera = { centerX: 0, centerY: 0, zoom: 2, rotation: Math.PI / 2 };
    const modelToSvg = (p: { x: number; y: number }) => ({ x: p.x * 10, y: p.y * 10 });
    const view = modelViewFromCamera(cam, vp, modelToSvg);
    expect(projectModelPoint(view, 0, 0).x).toBeCloseTo(400);
    expect(projectModelPoint(view, 0, 0).y).toBeCloseTo(300);
    // +1 model unit east is +20 device px, turned a quarter turn -> straight down
    const east = projectModelPoint(view, 1, 0);
    expect(east.x).toBeCloseTo(400);
    expect(east.y).toBeCloseTo(320);
  });
});
