import { describe, expect, it } from 'vitest';
import { cameraDegrees } from './cameraDegrees';

describe('cameraDegrees', () => {
  it('says a camera in whole degrees, a full turn folded back to where it ends', () => {
    expect(cameraDegrees({ yaw: Math.PI / 4, pitch: -0.955 })).toEqual({ yaw: 45, pitch: -55 });
    expect(cameraDegrees({ yaw: (2 * Math.PI) + Math.PI / 2, pitch: 0 })).toEqual({ yaw: 90, pitch: 0 });
    expect(cameraDegrees({ yaw: -Math.PI, pitch: 0 }).yaw).toBe(180);
    expect(cameraDegrees({ yaw: -3 * Math.PI / 2, pitch: -0.0001 })).toEqual({ yaw: 90, pitch: 0 });
    expect(Object.is(cameraDegrees({ yaw: -0.001, pitch: 0 }).yaw, -0)).toBe(false);
  });
});
