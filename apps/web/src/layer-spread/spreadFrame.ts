import { scenePoint } from '../cp-workspace/folded/connectedSpreadSource';
import { turnClockwise } from '../lib/geometry';
import type { ConnectedSpreadView } from './view';

/** Stable framing uses only the flat paper, not another full render of it. */
export function spreadFrame(
  view: ConnectedSpreadView,
  rotationDeg: number,
  spatial: boolean,
  width: number,
  height: number,
  zoom = 1,
) {
  const turn = turnClockwise(rotationDeg);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const xy of view.prepared.source.input.xy) {
    const p = turn(scenePoint(view.prepared.source, xy));
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const extent = spatial ? 1.2 * Math.hypot(maxX - minX, maxY - minY) : 1.35 * Math.max(maxX - minX, maxY - minY);
  const scale = (Math.min(width, height) / Math.max(extent, 1e-9)) * (spatial ? 1 : zoom);
  return {
    scale,
    x: width / 2 - (spatial ? 0 : (minX + maxX) / 2) * scale,
    y: height / 2 - (spatial ? 0 : (minY + maxY) / 2) * scale,
  };
}
