/** Camera frame shared by the vector projector, GPU preview and orbit gesture. */
import { multiplyMat3, type Mat3 } from '@treemaker/origami-simulator';
import { ORBIT_SENSITIVITY } from '../../lib/viewport3dCamera';

export interface CameraSpreadPose {
  /** Azimuth around the paper, degrees from right toward down. */
  directionDeg: number;
  /** 0 is top-down, 90 edge-on, 180 the underside. */
  inclinationDeg: number;
  /** Clockwise screen rotation. Orbiting retains this third degree of freedom. */
  rollDeg?: number;
}
const radians = Math.PI / 180;
const degrees = 180 / Math.PI;

/** Row-major frame: screen right, screen down, direction toward the eye. */
export function cameraSpreadRotation(pose: CameraSpreadPose): Mat3 {
  const a = pose.directionDeg * radians;
  const t = pose.inclinationDeg * radians;
  const u = Math.cos(a),
    v = Math.sin(a),
    c = Math.cos(t),
    s = Math.sin(t);
  const base: Mat3 = [
    u * u * c + v * v,
    u * v * (c - 1),
    -u * s,
    u * v * (c - 1),
    v * v * c + u * u,
    -v * s,
    u * s,
    v * s,
    c,
  ];
  const r = (pose.rollDeg ?? 0) * radians;
  const cr = Math.cos(r),
    sr = Math.sin(r);
  return multiplyMat3([cr, -sr, 0, sr, cr, 0, 0, 0, 1], base);
}

/** Diagram compensation is a shear; the two 3D modes use the rotation as-is. */
export function cameraSpreadTransform(
  pose: CameraSpreadPose & { projection: 'diagram' | 'orthographic' | 'perspective'; frame?: Mat3 }
): Mat3 {
  if (pose.frame) return pose.frame;
  if (pose.projection !== 'diagram') return cameraSpreadRotation(pose);
  const a = pose.directionDeg * radians;
  const t = Math.min(80, Math.max(0, pose.inclinationDeg)) * radians;
  const u = Math.cos(a),
    v = Math.sin(a);
  return [1, 0, -u * Math.tan(t), 0, 1, -v * Math.tan(t), u * Math.sin(t), v * Math.sin(t), Math.cos(t)];
}

/**
 * Rotate about an axis in the screen plane, measured from the press in CSS px.
 * Unlike a clamped azimuth/pitch drag this can cross either pole continuously.
 * Converting the full frame back to three angles keeps the numeric controls and
 * saved reviews in sync without losing the roll produced by a free orbit.
 */
export function orbitCameraSpread(pose: CameraSpreadPose, dx: number, dy: number): CameraSpreadPose {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return pose;
  const x = -dy / distance,
    y = dx / distance;
  const angle = distance * ORBIT_SENSITIVITY;
  const c = Math.cos(angle),
    s = Math.sin(angle),
    k = 1 - c;
  const rotation = multiplyMat3(
    [c + x * x * k, x * y * k, y * s, x * y * k, c + y * y * k, -x * s, -y * s, x * s, c],
    cameraSpreadRotation(pose)
  );
  const flat = Math.hypot(rotation[6], rotation[7]);
  const directionDeg =
    flat < 1e-10 ? pose.directionDeg : (Math.atan2(rotation[7], rotation[6]) * degrees + 360) % 360;
  const inclinationDeg = Math.atan2(flat, rotation[8]) * degrees;
  const base = cameraSpreadRotation({ directionDeg, inclinationDeg });
  const cosine = rotation[0] * base[0] + rotation[1] * base[1] + rotation[2] * base[2];
  const sine = rotation[3] * base[0] + rotation[4] * base[1] + rotation[5] * base[2];
  return { directionDeg, inclinationDeg, rollDeg: Math.atan2(sine, cosine) * degrees };
}
