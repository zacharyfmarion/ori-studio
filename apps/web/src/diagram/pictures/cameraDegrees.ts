/**
 * A 3D step's camera as the reader is told it: yaw and pitch in whole
 * degrees, yaw folded into (−180, 180] so a turn all the way round reads as
 * where it ends. For Pose's readout and the Step pane's View row (D5, D13).
 *
 * Pure.
 */
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';

export interface CameraDegrees {
  yaw: number;
  pitch: number;
}

export function cameraDegrees(camera: Pick<FoldedFigureCamera, 'yaw' | 'pitch'>): CameraDegrees {
  const degrees = (radians: number) => (radians * 180) / Math.PI;
  let yaw = Math.round(degrees(camera.yaw)) % 360;
  if (yaw <= -180) yaw += 360;
  if (yaw > 180) yaw -= 360;
  // Never −0 in a readout.
  return { yaw: yaw + 0, pitch: Math.round(degrees(camera.pitch)) + 0 };
}
