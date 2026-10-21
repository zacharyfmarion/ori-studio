import { describe, expect, it } from 'vitest';
import {
  cameraSpreadRotation,
  cameraSpreadTransform,
  orbitCameraSpread,
  type CameraSpreadPose,
} from './cameraSpreadCamera';

const top: CameraSpreadPose = { directionDeg: 247, inclinationDeg: 0 };
const close = (a: readonly number[], b: readonly number[]) =>
  a.forEach((n, i) => expect(n).toBeCloseTo(b[i]!, 10));

describe('camera spread free orbit', () => {
  it('keeps the established projection before a drag, including diagram compensation', () => {
    close(cameraSpreadRotation(top), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    close(cameraSpreadRotation({ directionDeg: 0, inclinationDeg: 90 }), [0, 0, -1, 0, 1, 0, 1, 0, 0]);
    const compensated = cameraSpreadTransform({
      directionDeg: 0,
      inclinationDeg: 45,
      rollDeg: 90,
      projection: 'diagram',
    });
    close(compensated.slice(0, 6), [1, 0, -1, 0, 1, 0]);
  });
  it('allows a full revolution through both poles with no snap or angle clamp', () => {
    const circle = (Math.PI * 2) / 0.01;
    const under = orbitCameraSpread(top, 0, circle / 2);
    expect(under.inclinationDeg).toBeCloseTo(180);
    close(cameraSpreadRotation(orbitCameraSpread(top, 0, circle)), cameraSpreadRotation(top));
    const before = cameraSpreadRotation(orbitCameraSpread(top, 0, circle / 2 - 0.0001));
    const after = cameraSpreadRotation(orbitCameraSpread(top, 0, circle / 2 + 0.0001));
    expect(Math.max(...before.map((n, i) => Math.abs(n - after[i]!)))).toBeLessThan(0.000003);
  });
  it('follows the hand from top down and returns exactly on a click', () => {
    expect(orbitCameraSpread(top, 0, 0)).toBe(top);
    const right = cameraSpreadRotation(orbitCameraSpread(top, 50, 0));
    const down = cameraSpreadRotation(orbitCameraSpread(top, 0, 50));
    // A point above the paper moves right/down under the respective drag.
    expect(right[2]).toBeGreaterThan(0);
    expect(down[5]).toBeGreaterThan(0);
  });
  it('reverses screen-space drags from an arbitrary rolled underside camera', () => {
    const pose = { directionDeg: 114, inclinationDeg: 137, rollDeg: -72 };
    const next = orbitCameraSpread(pose, 177, -241);
    const back = orbitCameraSpread(next, -177, 241);
    close(cameraSpreadRotation(back), cameraSpreadRotation(pose));
  });
  it('retains a finite orthonormal frame through repeated mixed-axis drags', () => {
    let pose = top;
    for (let i = 0; i < 1000; i++) pose = orbitCameraSpread(pose, Math.sin(i) * 40, Math.cos(i * 3) * 30);
    const m = cameraSpreadRotation(pose);
    expect(m.every(Number.isFinite)).toBe(true);
    for (let r = 0; r < 3; r++)
      for (let s = 0; s < 3; s++)
        expect([0, 1, 2].reduce((sum, c) => sum + m[r * 3 + c]! * m[s * 3 + c]!, 0)).toBeCloseTo(
          r === s ? 1 : 0,
          10
        );
  });
});
