import { describe, expect, it } from 'vitest';
import { cameraSpreadInitialView, cameraSpreadViewFrame } from './cameraSpreadView';
import { cameraSpreadRotation } from './cameraSpreadCamera';
import { setUprightView, withRollAbsorbed } from '../../lib/viewport3dCamera';

describe('shared camera basis for connected spread', () => {
  it.each([0, 45, 90, 135, 180])('keeps the approved frame at tilt %i without mirroring', (inclinationDeg) => {
    const pose = { directionDeg: 143, inclinationDeg, rollDeg: 28 };
    const view = cameraSpreadInitialView(pose);
    const expected = cameraSpreadRotation(pose);
    cameraSpreadViewFrame(view).forEach((n, i) => expect(n).toBeCloseTo(expected[i]!, 12));
    cameraSpreadViewFrame(setUprightView(view)).forEach((n, i) => expect(n).toBeCloseTo(expected[i]!, 12));
  });
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
    cameraSpreadViewFrame(saved).forEach((n, i) => expect(n).toBeCloseTo(cameraSpreadViewFrame(view)[i]!, 12));
  });
});
