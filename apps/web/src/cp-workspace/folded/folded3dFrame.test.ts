import { describe, expect, it } from 'vitest';
import { cameraUniforms } from '@treemaker/origami-simulator';
import {
  FOLDED_3D_CAMERA_DISTANCE_FACTOR,
  FOLDED_3D_SILHOUETTE_FACTOR,
  folded3dFrameHalfSide,
} from './folded3dFrame';

describe('the 3D figure’s frame under perspective', () => {
  it('restates the eye distance the simulator’s camera fits with', () => {
    // The factor is derived from `cameraUniforms`'s eye distance, which the
    // simulator does not export. If that constant moves, the frame is sized
    // for the wrong perspective and a model can leave its own box.
    const camera = cameraUniforms({ yaw: 0, pitch: 0, zoom: 1 }, [0, 0, 0], 1, 512, 512);
    expect(camera.camDist).toBeCloseTo(FOLDED_3D_CAMERA_DISTANCE_FACTOR, 12);
  });

  it('is the sphere’s tangent-cone silhouette, a 5.3% growth at 3.2 radii', () => {
    // r · d / √(d² − r²) at r = 1, d = 3.2 — F11's number, not the 45% of the
    // nearest point that the orthographic window was sized against.
    const d = FOLDED_3D_CAMERA_DISTANCE_FACTOR;
    expect(FOLDED_3D_SILHOUETTE_FACTOR).toBeCloseTo(d / Math.sqrt(d * d - 1), 12);
    expect(FOLDED_3D_SILHOUETTE_FACTOR).toBeCloseTo(1.0527, 4);
  });

  it('grows the frame from the stored radius, leaving the radius itself alone', () => {
    // `frameRadius` is persisted and checked to 1e-9 on rehydrate, so the
    // growth lives in the derived frame and never in the stored number.
    expect(folded3dFrameHalfSide(40)).toBeCloseTo(40 * FOLDED_3D_SILHOUETTE_FACTOR, 12);
    expect(folded3dFrameHalfSide(0)).toBe(0);
  });
});
