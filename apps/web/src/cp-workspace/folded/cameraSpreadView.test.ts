import { describe, expect, it } from 'vitest';
import {
  cameraSpreadInitialView,
  cameraSpreadViewFrame,
  cameraSpreadStoredView,
  cameraSpreadViewportView,
} from './cameraSpreadView';
import { cameraSpreadRotation } from './cameraSpreadCamera';
import { setUprightView, withRollAbsorbed } from '../../lib/viewport3dCamera';
import { multiplyMat3, transposeMat3, viewRotationFor } from '@treemaker/origami-simulator';

describe('shared camera basis for connected spread', () => {
  it.each([15, 90, 180, 315])('sets the visible up after a %i degree page rotation', (rotationDeg) => {
    const original = {
      ...cameraSpreadInitialView({ directionDeg: 247, inclinationDeg: 45 }),
      pan: [0.2, -0.1] as const,
      zoom: 1.7,
    };
    const viewport = cameraSpreadViewportView(original, rotationDeg);
    const upright = setUprightView(viewport);
    const stored = cameraSpreadStoredView(upright, rotationDeg);
    // Set Upright must not move the picture, including its independent page turn.
    cameraSpreadViewFrame(stored).forEach((n, i) =>
      expect(n).toBeCloseTo(cameraSpreadViewFrame(original)[i]!, 12)
    );
    const reopened = cameraSpreadViewportView(stored, rotationDeg);
    const yawed = { ...reopened, yaw: reopened.yaw + 0.5 };
    const relative = multiplyMat3(viewRotationFor(yawed), transposeMat3(viewRotationFor(reopened)));
    // A horizontal drag must rotate around the VISIBLE vertical, with no tilt.
    expect(relative[1]).toBeCloseTo(0, 12);
    expect(relative[4]).toBeCloseTo(1, 12);
    expect(relative[7]).toBeCloseTo(0, 12);
    expect(stored.pan).toEqual(original.pan);
    expect(stored.zoom).toBe(original.zoom);
  });
  it.each([0, 45, 90, 135, 180])(
    'keeps the approved frame at tilt %i without mirroring',
    (inclinationDeg) => {
      const pose = { directionDeg: 143, inclinationDeg, rollDeg: 28 };
      const view = cameraSpreadInitialView(pose);
      const expected = cameraSpreadRotation(pose);
      cameraSpreadViewFrame(view).forEach((n, i) => expect(n).toBeCloseTo(expected[i]!, 12));
      cameraSpreadViewFrame(setUprightView(view)).forEach((n, i) => expect(n).toBeCloseTo(expected[i]!, 12));
    }
  );
  it('preserves framing while absorbing roll for a saved pose', () => {
    const view = {
      ...cameraSpreadInitialView({ directionDeg: 247, inclinationDeg: 45 }),
      roll: 0.71,
      pan: [0.2, -0.1] as const,
      zoom: 2,
    };
    const saved = withRollAbsorbed(view);
    expect(saved.pan).toEqual(view.pan);
    expect(saved.zoom).toBe(view.zoom);
    cameraSpreadViewFrame(saved).forEach((n, i) =>
      expect(n).toBeCloseTo(cameraSpreadViewFrame(view)[i]!, 12)
    );
  });
});
