import { persistedCameraView } from './viewport3dCamera';
import { describe, expect, it } from 'vitest';
import { viewRotationFor } from '@treemaker/origami-simulator';
import {
  createCameraGesture,
  panCamera,
  normalizeAngle,
  nextOrbitView,
  withRollAbsorbed,
  type CameraDrag,
  type OrbitView,
} from './viewport3dCamera';

describe('simulator orbit controls', () => {
  const view: OrbitView = { yaw: 1, pitch: 0.2, zoom: 1.5 };
  const drag: CameraDrag = { x: 100, y: 100, yaw: view.yaw, pitch: view.pitch, roll: 0 };

  it('maps horizontal dragging to conventional orbit direction', () => {
    expect(nextOrbitView(view, drag, { x: 140, y: 100 }).yaw).toBeLessThan(view.yaw);
    expect(nextOrbitView(view, drag, { x: 60, y: 100 }).yaw).toBeGreaterThan(view.yaw);
  });

  it('maps vertical dragging to conventional orbit direction', () => {
    expect(nextOrbitView(view, drag, { x: 100, y: 140 }).pitch).toBeGreaterThan(view.pitch);
    expect(nextOrbitView(view, drag, { x: 100, y: 60 }).pitch).toBeLessThan(view.pitch);
  });

  it('allows vertical orbiting past the old pitch limit', () => {
    expect(nextOrbitView(view, drag, { x: 100, y: -80 }).pitch).toBeLessThan(-1.35);
    expect(nextOrbitView(view, drag, { x: 100, y: 300 }).pitch).toBeGreaterThan(1.35);
  });

  it('preserves zoom and normalizes angles', () => {
    expect(nextOrbitView(view, drag, { x: 100, y: 100 }).zoom).toBe(view.zoom);
    const farOrbit = nextOrbitView(view, drag, { x: 5000, y: 5000 });
    expect(farOrbit.yaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(farOrbit.yaw).toBeLessThan(Math.PI);
    expect(farOrbit.pitch).toBeGreaterThanOrEqual(-Math.PI);
    expect(farOrbit.pitch).toBeLessThan(Math.PI);
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(-Math.PI);
  });
});

describe('withRollAbsorbed', () => {
  it('folds a roll into the orientation without moving the picture', () => {
    const rolled: OrbitView = {
      yaw: 0.7,
      pitch: -0.4,
      zoom: 1.3,
      roll: 0.9,
      orient: [0, 0, 1, 0, 1, 0, -1, 0, 0],
    };
    const absorbed = withRollAbsorbed(rolled);
    expect(absorbed).toMatchObject({ yaw: 0.7, pitch: -0.4, zoom: 1.3, roll: 0 });
    const before = viewRotationFor(rolled);
    const after = viewRotationFor(absorbed);
    after.forEach((value, index) => expect(value).toBeCloseTo(before[index]!, 12));
  });

  it('leaves a view with no roll as it is', () => {
    const view: OrbitView = { yaw: 1, pitch: 0.2, zoom: 1.5 };
    expect(withRollAbsorbed(view)).toBe(view);
    expect(withRollAbsorbed({ ...view, roll: 0 })).toEqual({ ...view, roll: 0 });
  });
});

describe('viewport pan', () => {
  it('follows CSS travel independent of zoom, aspect ratio and display pixels', () => {
    const view: OrbitView = { yaw: 0.2, pitch: -0.5, zoom: 3, pan: [0.1, -0.1] };
    expect(panCamera(view, 100, 50, 500).pan?.[0]).toBeCloseTo(0.3);
    expect(panCamera(view, 100, 50, 500).pan?.[1]).toBe(0);
  });

  it('measures a drag from its starting camera and ignores moves after release', () => {
    let view: OrbitView = { yaw: 1, pitch: -0.5, zoom: 2 };
    const gesture = createCameraGesture({
      read: () => view,
      write: (v) => {
        view = v;
      },
      shortEdge: () => 400,
    });
    gesture.begin({ x: 20, y: 30 }, 'pan');
    gesture.move({ x: 60, y: 50 });
    gesture.move({ x: 100, y: 70 });
    expect(view).toEqual({ yaw: 1, pitch: -0.5, zoom: 2, pan: [0.2, 0.1] });
    gesture.end();
    gesture.move({ x: 200, y: 200 });
    expect(view.pan).toEqual([0.2, 0.1]);
  });
});

it('persists a rolled or upright camera without transient fields', () => {
  const view: OrbitView = { yaw: 0.7, pitch: -0.4, zoom: 1.3, roll: 0.9, pan: [0.2, -0.1] };
  const saved = persistedCameraView(view);
  expect(saved).not.toHaveProperty('roll');
  expect(saved.pan).toEqual(view.pan);
  viewRotationFor(saved).forEach((v, i) => expect(v).toBeCloseTo(viewRotationFor(view)[i]!, 12));
});
