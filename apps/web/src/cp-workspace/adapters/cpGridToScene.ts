import type { CpGridLine, CpModelBounds } from '../../lib/creasePatternViewport';
import type { OristudioCpGridMetadata } from '../../engine/oristudioCpTypes';
import { unprojectDevicePoint } from '../renderer/camera';
import type { Rgba, StrokeGeometry, ViewTransform } from '../renderer/types';

/** Extra visible-region coverage so the grid never ends at the viewport edge. */
const MARGIN_RATIO = 0.3;
/** Snap step ratio — coarsens bounds so the grid only regenerates on real pans. */
const SNAP_STEP_RATIO = 0.1;

/**
 * Visible model-space bounds for the current view, by unprojecting the canvas
 * corners and expanding by a margin. Snapped to a coarse step so small pans do
 * not churn the grid. Returns `null` for a degenerate transform.
 */
export function visibleGridBounds(
  view: ViewTransform,
  deviceWidth: number,
  deviceHeight: number
): CpModelBounds | null {
  const corners = [
    unprojectDevicePoint(view, 0, 0),
    unprojectDevicePoint(view, deviceWidth, 0),
    unprojectDevicePoint(view, 0, deviceHeight),
    unprojectDevicePoint(view, deviceWidth, deviceHeight),
  ];
  if (corners.some((c) => c === null)) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    if (!c) continue;
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const marginX = spanX * MARGIN_RATIO;
  const marginY = spanY * MARGIN_RATIO;
  const step = Math.max(1e-3, Math.max(spanX, spanY) * SNAP_STEP_RATIO);
  const snapMin = (v: number) => Math.floor(v / step) * step;
  const snapMax = (v: number) => Math.ceil(v / step) * step;

  const sMinX = snapMin(minX - marginX);
  const sMinY = snapMin(minY - marginY);
  const sMaxX = snapMax(maxX + marginX);
  const sMaxY = snapMax(maxY + marginY);
  return {
    minX: sMinX,
    minY: sMinY,
    maxX: sMaxX,
    maxY: sMaxY,
    spanX: Math.max(step, sMaxX - sMinX),
    spanY: Math.max(step, sMaxY - sMinY),
  };
}

/** Stable key for {@link visibleGridBounds} + grid params — regenerate only when it changes. */
export function gridBoundsKey(bounds: CpModelBounds, grid: OristudioCpGridMetadata): string {
  return [
    grid.grid_size,
    grid.grid_angle,
    grid.grid_xa,
    grid.grid_ya,
    grid.interval_grid_size,
    bounds.minX.toFixed(3),
    bounds.minY.toFixed(3),
    bounds.maxX.toFixed(3),
    bounds.maxY.toFixed(3),
  ].join(':');
}

/** Major grid lines are drawn wider and a touch more opaque than minor ones. */
const MAJOR_WIDTH_MUL = 1.8;
const MAJOR_ALPHA_SCALE = 1.35;

/**
 * Convert generated grid lines into stroke geometry. Major lines get a wider
 * width multiplier and slightly boosted alpha so they read as distinct.
 */
export function cpGridLinesToStrokes(lines: readonly CpGridLine[], color: Rgba): StrokeGeometry {
  const count = lines.length;
  const a = new Float32Array(count * 2);
  const b = new Float32Array(count * 2);
  const colorBuf = new Float32Array(count * 4);
  const widthMul = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const line = lines[i];
    a[i * 2] = line.a.x;
    a[i * 2 + 1] = line.a.y;
    b[i * 2] = line.b.x;
    b[i * 2 + 1] = line.b.y;
    const alpha = line.major ? Math.min(1, color[3] * MAJOR_ALPHA_SCALE) : color[3];
    colorBuf[i * 4] = color[0];
    colorBuf[i * 4 + 1] = color[1];
    colorBuf[i * 4 + 2] = color[2];
    colorBuf[i * 4 + 3] = alpha;
    widthMul[i] = line.major ? MAJOR_WIDTH_MUL : 1;
  }
  return { a, b, color: colorBuf, widthMul, count };
}
