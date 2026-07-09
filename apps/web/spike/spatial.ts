// THROWAWAY Phase 0 spike — uniform-grid spatial index over segments.
// Used here for hover hit-testing; in the real plan the same structure feeds
// viewport culling. We index by segment midpoint into a coarse grid, then do a
// precise point-to-segment distance test on the candidates in the query cell
// and its 8 neighbours.

import type { StrokeData } from './geometry';

export interface SpatialIndex {
  query(wx: number, wy: number, toleranceWorld: number): number; // segment idx or -1
}

export function buildSpatialIndex(strokes: StrokeData, cellSize: number): SpatialIndex {
  const { a, b, count } = strokes;
  let minX = Infinity;
  let minY = Infinity;
  for (let i = 0; i < count; i++) {
    const mx = (a[i * 2] + b[i * 2]) * 0.5;
    const my = (a[i * 2 + 1] + b[i * 2 + 1]) * 0.5;
    if (mx < minX) minX = mx;
    if (my < minY) minY = my;
  }

  const cells = new Map<number, number[]>();
  const key = (cx: number, cy: number) => cx * 73856093 + cy * 19349663;

  for (let i = 0; i < count; i++) {
    const mx = (a[i * 2] + b[i * 2]) * 0.5;
    const my = (a[i * 2 + 1] + b[i * 2 + 1]) * 0.5;
    const cx = Math.floor((mx - minX) / cellSize);
    const cy = Math.floor((my - minY) / cellSize);
    const k = key(cx, cy);
    let bucket = cells.get(k);
    if (!bucket) {
      bucket = [];
      cells.set(k, bucket);
    }
    bucket.push(i);
  }

  function distToSegment(px: number, py: number, i: number): number {
    const ax = a[i * 2];
    const ay = a[i * 2 + 1];
    const bx = b[i * 2];
    const by = b[i * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    return Math.hypot(px - qx, py - qy);
  }

  return {
    query(wx, wy, toleranceWorld) {
      const cx = Math.floor((wx - minX) / cellSize);
      const cy = Math.floor((wy - minY) / cellSize);
      let best = -1;
      let bestDist = toleranceWorld;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = cells.get(key(cx + ox, cy + oy));
          if (!bucket) continue;
          for (const i of bucket) {
            const d = distToSegment(wx, wy, i);
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          }
        }
      }
      return best;
    },
  };
}
