import { lineColorName, SEG_ATTR_STRIDE, type CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { Rgba, StrokeGeometry } from '../renderer/types';
import type { CpMovePreview, CpSelectionStyle } from './cpSnapshotToScene';

/**
 * Transport-driven mirror of {@link cpSnapshotToScene}: build GPU stroke geometry
 * for the crease lines straight from the compact {@link CpGeometryTransport}
 * instead of an array of segment objects.
 *
 * It reads endpoints from the flat `segEndpoints` buffer and the per-segment
 * color number from `segAttr`, so a dense pattern no longer allocates a segment
 * object (and two `Point`s) per crease on every frame. The output is
 * byte-identical to `cpSnapshotToScene` for the same document — the f64→f32
 * narrowing happens at the exact same point (assignment into the `Float32Array`),
 * and colors resolve through the same `colorFor` after mapping the color number
 * to its name. This equivalence is the Phase 2 parity gate.
 */
export function cpGeometryStrokesToScene(
  transport: CpGeometryTransport,
  colorFor: (color: string) => Rgba,
  selection?: CpSelectionStyle,
  move?: CpMovePreview
): { strokes: StrokeGeometry } {
  const endpoints = transport.segEndpoints;
  const attr = transport.segAttr;
  const count = endpoints.length / 4;
  const a = new Float32Array(count * 2);
  const b = new Float32Array(count * 2);
  const color = new Float32Array(count * 4);
  const widthMul = new Float32Array(count).fill(1);

  // Memoise colour lookups by color number — a dense CP has thousands of
  // segments but only a handful of distinct assignments.
  const colorCache = new Map<number, Rgba>();

  for (let i = 0; i < count; i++) {
    const e = i * 4;
    const moved = move !== undefined && move.ids.has(i + 1);
    const dx = moved ? move.delta.x : 0;
    const dy = moved ? move.delta.y : 0;
    a[i * 2] = endpoints[e] + dx;
    a[i * 2 + 1] = endpoints[e + 1] + dy;
    b[i * 2] = endpoints[e + 2] + dx;
    b[i * 2 + 1] = endpoints[e + 3] + dy;

    if (selection && selection.selected.has(i + 1)) {
      const c = selection.color;
      color[i * 4] = c[0];
      color[i * 4 + 1] = c[1];
      color[i * 4 + 2] = c[2];
      color[i * 4 + 3] = c[3];
      widthMul[i] = selection.widthMul;
      continue;
    }

    const colorNumber = attr[i * SEG_ATTR_STRIDE];
    let rgba = colorCache.get(colorNumber);
    if (!rgba) {
      rgba = colorFor(lineColorName(colorNumber));
      colorCache.set(colorNumber, rgba);
    }
    color[i * 4] = rgba[0];
    color[i * 4 + 1] = rgba[1];
    color[i * 4 + 2] = rgba[2];
    color[i * 4 + 3] = rgba[3];
  }

  return { strokes: { a, b, color, widthMul, count } };
}
