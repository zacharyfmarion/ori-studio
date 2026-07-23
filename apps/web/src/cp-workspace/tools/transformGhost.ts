/**
 * The ghost buffer behind the crease copy tools: the selected creases drawn at
 * their prospective position while the gesture is still in progress.
 *
 * The move tools do not need this — they shift the real strokes in place through
 * `buildStrokes(move)`, so the originals leave with them. A *copy* has to show the
 * originals and the new geometry at once, so its ghost is an extra stroke set on
 * the renderer's preview channel.
 *
 * The endpoint and colour arrays are snapshotted once when the gesture starts and
 * the transformed endpoints are written back into the same preallocated arrays on
 * every pointer move: an N-segment selection allocates once per gesture, not once
 * per frame.
 */
import { lineColorName, SEG_ATTR_STRIDE, type CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { CpAffineMatrix } from '../adapters/cpSnapshotToScene';
import type { CpLineSegmentInput } from '../adapters/cpSnapshotToScene';
import type { Rgba, StrokeGeometry } from '../renderer/types';

/** How a ghost is drawn relative to the creases it copies. */
export interface CpGhostStyle {
  /** Multiplies each segment's own alpha, so the ghost reads as not-yet-real. */
  alpha: number;
  /** Width multiplier, matching the selection highlight's emphasis. */
  widthMul: number;
}

export interface CpTransformGhost {
  /** Segments in the ghost (the size of the selection when the gesture began). */
  readonly count: number;
  /**
   * Transformed geometry for `matrix`. The returned object is reused between
   * calls — the renderer copies into GPU buffers on upload, so callers must not
   * retain it across frames.
   */
  update(matrix: CpAffineMatrix): StrokeGeometry;
}

/** Endpoints + colours of the creases a gesture is transforming. */
export interface CpGhostBase {
  /** Source endpoints, [ax, ay] * count and [bx, by] * count. */
  a: Float32Array;
  b: Float32Array;
  /** Per-segment RGBA, alpha already scaled by the ghost style. */
  color: Float32Array;
  count: number;
}

/**
 * Snapshot the selected creases out of the compact geometry transport — the hot
 * path, and the only one a real edit takes.
 */
export function ghostBaseFromGeometry(
  transport: CpGeometryTransport,
  selectedIds: ReadonlySet<number>,
  colorFor: (color: string) => Rgba,
  style: CpGhostStyle
): CpGhostBase {
  const endpoints = transport.segEndpoints;
  const attr = transport.segAttr;
  const total = endpoints.length / 4;
  const base = allocateBase(countSelected(total, selectedIds));
  const colorCache = new Map<number, Rgba>();

  let out = 0;
  for (let i = 0; i < total; i += 1) {
    if (!selectedIds.has(i + 1)) continue;
    const e = i * 4;
    base.a[out * 2] = endpoints[e];
    base.a[out * 2 + 1] = endpoints[e + 1];
    base.b[out * 2] = endpoints[e + 2];
    base.b[out * 2 + 1] = endpoints[e + 3];

    const colorNumber = attr[i * SEG_ATTR_STRIDE];
    let rgba = colorCache.get(colorNumber);
    if (!rgba) {
      rgba = colorFor(lineColorName(colorNumber));
      colorCache.set(colorNumber, rgba);
    }
    writeColor(base.color, out, rgba, style.alpha);
    out += 1;
  }
  return base;
}

/** Structured-snapshot equivalent of {@link ghostBaseFromGeometry}. */
export function ghostBaseFromSegments(
  lineSegments: readonly CpLineSegmentInput[],
  selectedIds: ReadonlySet<number>,
  colorFor: (color: string) => Rgba,
  style: CpGhostStyle
): CpGhostBase {
  const base = allocateBase(countSelected(lineSegments.length, selectedIds));
  const colorCache = new Map<string, Rgba>();

  let out = 0;
  for (let i = 0; i < lineSegments.length; i += 1) {
    if (!selectedIds.has(i + 1)) continue;
    const segment = lineSegments[i];
    base.a[out * 2] = segment.a.x;
    base.a[out * 2 + 1] = segment.a.y;
    base.b[out * 2] = segment.b.x;
    base.b[out * 2 + 1] = segment.b.y;

    let rgba = colorCache.get(segment.color);
    if (!rgba) {
      rgba = colorFor(segment.color);
      colorCache.set(segment.color, rgba);
    }
    writeColor(base.color, out, rgba, style.alpha);
    out += 1;
  }
  return base;
}

/**
 * Wrap a snapshot in the per-move transformer. Returns `null` for an empty
 * selection so callers can treat "nothing to ghost" as "no ghost".
 */
export function createTransformGhost(
  base: CpGhostBase,
  style: CpGhostStyle
): CpTransformGhost | null {
  if (base.count === 0) return null;

  const geometry: StrokeGeometry = {
    a: new Float32Array(base.count * 2),
    b: new Float32Array(base.count * 2),
    color: base.color,
    widthMul: new Float32Array(base.count).fill(style.widthMul),
    count: base.count,
  };

  return {
    count: base.count,
    update(matrix) {
      const [m00, m01, m10, m11, tx, ty] = matrix;
      for (let i = 0; i < base.count; i += 1) {
        const x0 = base.a[i * 2];
        const y0 = base.a[i * 2 + 1];
        const x1 = base.b[i * 2];
        const y1 = base.b[i * 2 + 1];
        geometry.a[i * 2] = m00 * x0 + m01 * y0 + tx;
        geometry.a[i * 2 + 1] = m10 * x0 + m11 * y0 + ty;
        geometry.b[i * 2] = m00 * x1 + m01 * y1 + tx;
        geometry.b[i * 2 + 1] = m10 * x1 + m11 * y1 + ty;
      }
      return geometry;
    },
  };
}

function countSelected(total: number, selectedIds: ReadonlySet<number>): number {
  let count = 0;
  for (let i = 1; i <= total; i += 1) if (selectedIds.has(i)) count += 1;
  return count;
}

function allocateBase(count: number): CpGhostBase {
  return {
    a: new Float32Array(count * 2),
    b: new Float32Array(count * 2),
    color: new Float32Array(count * 4),
    count,
  };
}

function writeColor(target: Float32Array, index: number, rgba: Rgba, alpha: number): void {
  target[index * 4] = rgba[0];
  target[index * 4 + 1] = rgba[1];
  target[index * 4 + 2] = rgba[2];
  target[index * 4 + 3] = rgba[3] * alpha;
}
