import { expect, it } from 'vitest';
import type { Vec3 } from '@treemaker/origami-simulator';
import { maskCameraDepth } from './cameraSpreadMask';
import type { CameraPaintPiece } from './cameraSpreadVisibility';

it('matches the GPU ink bias without revealing distinctly buried edges', () => {
  const cover: CameraPaintPiece = {
    kind: 'face',
    face: 0,
    rank: 1,
    patch: false,
    plane: [0, 0, 1, 0],
    points: [
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
    ],
  };
  const line = (z: number): CameraPaintPiece => ({
    kind: 'line',
    face: 1,
    rank: 0,
    patch: false,
    plane: [0, 0, 1, -z],
    role: 'aux',
    points: [
      [0.2, 0.2, z],
      [0.8, 0.2, z],
    ],
  });
  const project = ([x, y]: Vec3): Vec3 => [x, y, 1];
  const depth = ([, , z]: Vec3) => -z / 2;
  expect(maskCameraDepth([cover, line(-0.00004)], project, depth).filter((p) => p.kind === 'line')).toHaveLength(1);
  expect(maskCameraDepth([cover, line(-0.002)], project, depth).filter((p) => p.kind === 'line')).toHaveLength(0);
  // A crease coincident with a covering triangle's border is still visible
  // on the exposed side of its pixel-width stroke, despite roundoff at zero.
  const boundary = line(-0.002);
  boundary.points = [
    [0.2, 1e-15, -0.002],
    [0.8, 1e-15, -0.002],
  ];
  expect(maskCameraDepth([cover, boundary], project, depth).filter((p) => p.kind === 'line')).toHaveLength(1);
});
