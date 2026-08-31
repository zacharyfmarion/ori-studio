import { describe, expect, it } from 'vitest';
import {
  normalizeAngle,
  nextSimulatorOrbitView,
  type SimulatorOrbitDrag,
  type SimulatorOrbitView,
} from './simulatorOrbit';

describe('simulator orbit controls', () => {
  const view: SimulatorOrbitView = { yaw: 1, pitch: 0.2, zoom: 1.5 };
  const drag: SimulatorOrbitDrag = { x: 100, y: 100, yaw: view.yaw, pitch: view.pitch, roll: 0 };

  it('maps horizontal dragging to conventional orbit direction', () => {
    expect(nextSimulatorOrbitView(view, drag, { x: 140, y: 100 }).yaw).toBeLessThan(view.yaw);
    expect(nextSimulatorOrbitView(view, drag, { x: 60, y: 100 }).yaw).toBeGreaterThan(view.yaw);
  });

  it('maps vertical dragging to conventional orbit direction', () => {
    expect(nextSimulatorOrbitView(view, drag, { x: 100, y: 140 }).pitch).toBeGreaterThan(view.pitch);
    expect(nextSimulatorOrbitView(view, drag, { x: 100, y: 60 }).pitch).toBeLessThan(view.pitch);
  });

  it('allows vertical orbiting past the old pitch limit', () => {
    expect(nextSimulatorOrbitView(view, drag, { x: 100, y: -80 }).pitch).toBeLessThan(-1.35);
    expect(nextSimulatorOrbitView(view, drag, { x: 100, y: 300 }).pitch).toBeGreaterThan(1.35);
  });

  it('preserves zoom and normalizes angles', () => {
    expect(nextSimulatorOrbitView(view, drag, { x: 100, y: 100 }).zoom).toBe(view.zoom);
    const farOrbit = nextSimulatorOrbitView(view, drag, { x: 5000, y: 5000 });
    expect(farOrbit.yaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(farOrbit.yaw).toBeLessThan(Math.PI);
    expect(farOrbit.pitch).toBeGreaterThanOrEqual(-Math.PI);
    expect(farOrbit.pitch).toBeLessThan(Math.PI);
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(-Math.PI);
  });
});
