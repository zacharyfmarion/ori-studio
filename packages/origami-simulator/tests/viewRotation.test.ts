import { describe, expect, it } from 'vitest';
import {
  IDENTITY_MAT3,
  multiplyMat3,
  toViewSpace,
  transposeMat3,
  viewDepthAxis,
  viewRotation,
  type CameraUniforms,
  type Mat3,
} from '../src/webgl/camera.js';

/**
 * The view rotation, which used to be written out five times.
 *
 * Three GLSL shaders (one of them a *partial* copy that skipped the x row), the
 * CPU `toViewSpace`, and the canvas-2D fallback's `projectPositions` each
 * expanded the same six products by hand. This is the one statement of it now,
 * so it is worth pinning against the expansion it replaced rather than only
 * against its own output.
 */

/** The transform exactly as it was written before the matrix, for comparison. */
function longhand(
  yaw: number,
  pitch: number,
  d: readonly [number, number, number]
): [number, number, number] {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const yawX = cosYaw * d[0] + sinYaw * d[2];
  const yawZ = -sinYaw * d[0] + cosYaw * d[2];
  return [yawX, cosPitch * yawZ - sinPitch * d[1], sinPitch * yawZ + cosPitch * d[1]];
}

function uniforms(rotation: Mat3): CameraUniforms {
  return {
    center: [0, 0, 0],
    rotation,
    scale: 1,
    width: 0,
    height: 0,
    depthRange: 1,
    camDist: 1,
  };
}

const ANGLES: Array<[number, number]> = [
  [0, 0],
  [Math.PI / 4, -0.955],
  [-1.3, 0.7],
  [Math.PI, -Math.PI / 2],
  [2.4, 3.0],
];

const POINTS: Array<[number, number, number]> = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [3, -2, 5],
  [-0.25, 0.5, -1.75],
];

describe('the view rotation as a matrix', () => {
  it('is the transform it replaced, to the last bit it can be', () => {
    // The refactor's whole claim. Reassociating `cosP*(cosY*dz)` into
    // `(cosP*cosY)*dz` is not required to be bit-identical, so this asserts to
    // double precision rather than exact equality — but in practice the golden
    // primitive stream downstream survived unchanged, which is the stronger
    // statement and the one that mattered.
    for (const [yaw, pitch] of ANGLES) {
      const camera = uniforms(viewRotation(yaw, pitch));
      for (const point of POINTS) {
        const [x, y, z] = toViewSpace(point[0], point[1], point[2], camera);
        const [ex, ey, ez] = longhand(yaw, pitch, point);
        expect(x).toBeCloseTo(ex, 12);
        expect(y).toBeCloseTo(ey, 12);
        expect(z).toBeCloseTo(ez, 12);
      }
    }
  });

  it('is orthonormal, so it turns the model without resizing it', () => {
    for (const [yaw, pitch] of ANGLES) {
      const m = viewRotation(yaw, pitch);
      const shouldBeIdentity = multiplyMat3(m, transposeMat3(m));
      for (let i = 0; i < 9; i += 1) {
        expect(shouldBeIdentity[i]!).toBeCloseTo(IDENTITY_MAT3[i]!, 12);
      }
    }
  });

  it('puts the eye direction in row 2, where it can be read instead of derived', () => {
    // `folded3dEyeDirection` used to re-derive this in trigonometry, with a
    // comment warning that a wrong sign draws the figure near-to-far. Row 2 is
    // by definition the direction whose dot product with a point is its depth,
    // so this checks the row against depth itself rather than against a second
    // formula for the row.
    for (const [yaw, pitch] of ANGLES) {
      const rotation = viewRotation(yaw, pitch);
      const axis = viewDepthAxis(rotation);
      const camera = uniforms(rotation);
      for (const point of POINTS) {
        const depth = toViewSpace(point[0], point[1], point[2], camera)[2];
        const dot = axis[0] * point[0] + axis[1] * point[1] + axis[2] * point[2];
        expect(dot).toBeCloseTo(depth, 12);
      }
      expect(Math.hypot(...axis)).toBeCloseTo(1, 12);
    }
  });
});

describe('the model orientation', () => {
  it('is identity by default, so nothing that omits it moves', () => {
    for (const [yaw, pitch] of ANGLES) {
      expect(viewRotation(yaw, pitch, IDENTITY_MAT3)).toEqual(viewRotation(yaw, pitch));
    }
  });

  it('applies before the camera, so yaw spins about the model up it names', () => {
    // A quarter turn about X carries world Z onto world Y. With that as the
    // orientation, the axis yaw spins about — world Y in the composed frame —
    // is therefore the model's Z.
    const quarterAboutX: Mat3 = [1, 0, 0, 0, 0, -1, 0, 1, 0];
    const rotation = viewRotation(0.7, -0.4, quarterAboutX);

    // Spinning yaw must leave the chosen axis fixed on screen: that is what
    // "this is up" means. Compare the axis's view-space image across two yaws.
    const other = viewRotation(2.1, -0.4, quarterAboutX);
    const modelUp: [number, number, number] = [0, 0, 1];
    const imageA = uniforms(rotation);
    const imageB = uniforms(other);
    const a = toViewSpace(modelUp[0], modelUp[1], modelUp[2], imageA);
    const b = toViewSpace(modelUp[0], modelUp[1], modelUp[2], imageB);

    expect(a[0]).toBeCloseTo(b[0], 12);
    expect(a[1]).toBeCloseTo(b[1], 12);
    expect(a[2]).toBeCloseTo(b[2], 12);
  });
});
