import { describe, expect, it } from 'vitest';
import {
  fitUserCamera,
  modelViewFromCamera,
  panUserCamera,
  projectModelPoint,
  seedUserCamera,
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
    const cam: UserCamera = { centerX: 50, centerY: 40, zoom: 2 };
    const view = userCameraToView(cam, vp);
    expect(projectModelPoint(view, 50, 40)).toEqual({ x: 400, y: 300 });
    // +1 user unit east -> +zoom device px
    expect(projectModelPoint(view, 51, 40)).toEqual({ x: 402, y: 300 });
  });

  it('round-trips through seedUserCamera', () => {
    const cam: UserCamera = { centerX: 12, centerY: -7, zoom: 3 };
    const seeded = seedUserCamera(userCameraToView(cam, vp), vp);
    expect(seeded).not.toBeNull();
    expect(seeded!.centerX).toBeCloseTo(12);
    expect(seeded!.centerY).toBeCloseTo(-7);
    expect(seeded!.zoom).toBeCloseTo(3);
  });

  it('pans in user units', () => {
    const cam: UserCamera = { centerX: 0, centerY: 0, zoom: 2 };
    panUserCamera(cam, 10, -4); // drag content right/up -> centre left/down
    expect(cam.centerX).toBeCloseTo(-5);
    expect(cam.centerY).toBeCloseTo(2);
  });

  it('zooms about the cursor, keeping that user point fixed', () => {
    const cam: UserCamera = { centerX: 0, centerY: 0, zoom: 2 };
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
    const cam: UserCamera = { centerX: 0, centerY: 0, zoom: 2 };
    // modelToSvg scales model by 10 (model 1 -> user 10)
    const modelToSvg = (p: { x: number; y: number }) => ({ x: p.x * 10, y: p.y * 10 });
    const view = modelViewFromCamera(cam, vp, modelToSvg);
    // model (0,0) -> user (0,0) -> device viewport centre
    expect(projectModelPoint(view, 0, 0)).toEqual({ x: 400, y: 300 });
    // model +1 -> user +10 -> device +10*zoom = +20
    expect(projectModelPoint(view, 1, 0).x).toBeCloseTo(420);
  });
});
