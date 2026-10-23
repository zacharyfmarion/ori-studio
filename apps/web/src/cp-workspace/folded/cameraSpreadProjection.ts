import type { Vec3 } from '@treemaker/origami-simulator';
import type { ScenePoint } from '../../lib/paper/paperScene';
import { cameraSpreadTransform } from './cameraSpreadCamera';
import type { CameraSpreadLift } from './cameraSpreadLift';
import type { CameraSpreadOptions } from './cameraSpreadScene';

/** One projection for visible fragments and the unoccluded paper anchor mesh. */
export function cameraSpreadProjection(mesh: CameraSpreadLift, options: CameraSpreadOptions) {
  const frame = cameraSpreadTransform(options);
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of mesh.xy) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2;
  const distance = options.projection === 'perspective' ? 2.5 : 1e8;
  const eye: Vec3 = [cx + distance * frame[6], cy + distance * frame[7], (distance * frame[8]) / (options.amount || 1)];
  const homogeneous = ([x, y, height]: Vec3, basis = frame): Vec3 => {
    const px = x - cx,
      py = y - cy,
      z = height * options.amount;
    const horizontal = basis[0] * px + basis[1] * py + basis[2] * z;
    const vertical = basis[3] * px + basis[4] * py + basis[5] * z;
    const depth = basis[6] * px + basis[7] * py + basis[8] * z;
    return [horizontal, vertical, options.projection === 'perspective' ? (distance - depth) / distance : 1];
  };
  // Match the live GPU depth convention, including its perspective divide.
  const clipDepth = ([x, y, height]: Vec3): number => {
    const depth = frame[6] * (x - cx) + frame[7] * (y - cy) + frame[8] * height * options.amount;
    const w = (distance - depth) / distance;
    return options.projection === 'perspective' ? 1.020202 * w - 0.080808 : -depth / 2;
  };
  const project = (p: Vec3): ScenePoint => {
    const [x, y, w] = homogeneous(p);
    return [mesh.origin.x + mesh.size * (cx + x / w), mesh.origin.y + mesh.size * (cy + y / w)];
  };
  return { frame, eye, homogeneous, clipDepth, project, centre: [cx, cy] as [number, number] };
}
