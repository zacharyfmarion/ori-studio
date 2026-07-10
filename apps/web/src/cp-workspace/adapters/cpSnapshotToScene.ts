import type { ModelPoint, Rgba, StrokeGeometry } from '../renderer/types';

/** Minimal structural shape of a crease-pattern line segment we consume. */
export interface CpLineSegmentInput {
  a: ModelPoint;
  b: ModelPoint;
  color: string;
}

/**
 * Convert crease-pattern line segments into GPU-ready stroke geometry. Pure: the
 * per-colour resolution is injected so this stays testable without the DOM/theme.
 */
export function cpSnapshotToScene(
  lineSegments: readonly CpLineSegmentInput[],
  colorFor: (color: string) => Rgba
): { strokes: StrokeGeometry } {
  const count = lineSegments.length;
  const a = new Float32Array(count * 2);
  const b = new Float32Array(count * 2);
  const color = new Float32Array(count * 4);
  const widthMul = new Float32Array(count).fill(1);

  // Memoise colour lookups — a dense CP has thousands of segments but only a
  // handful of distinct assignments.
  const colorCache = new Map<string, Rgba>();

  for (let i = 0; i < count; i++) {
    const seg = lineSegments[i];
    a[i * 2] = seg.a.x;
    a[i * 2 + 1] = seg.a.y;
    b[i * 2] = seg.b.x;
    b[i * 2 + 1] = seg.b.y;

    let rgba = colorCache.get(seg.color);
    if (!rgba) {
      rgba = colorFor(seg.color);
      colorCache.set(seg.color, rgba);
    }
    color[i * 4] = rgba[0];
    color[i * 4 + 1] = rgba[1];
    color[i * 4 + 2] = rgba[2];
    color[i * 4 + 3] = rgba[3];
  }

  return { strokes: { a, b, color, widthMul, count } };
}
