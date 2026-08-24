import { foldAngleInk } from '../foldAngle/foldAngleRamp';
import { lineColorName, SEG_ATTR_STRIDE, type CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import {
  appendDirectionHintDash,
  hintColorName,
  isHinted,
  HINT_NONE,
} from '../foldAngle/directionHint';
import type { StrokeGeometry } from '../renderer/types';
import type { CpLineAppearance } from './cpLineStyle';
import type {
  CpDashPatterns,
  CpFoldAngleStyle,
  CpLineAppearanceFor,
  CpReplacedLines,
  CpSelectionStyle,
  CpTransformPreview,
} from './cpSnapshotToScene';

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
 * and colors resolve through the same `appearanceFor` after mapping the color
 * number to its name. This equivalence is the Phase 2 parity gate.
 */
export function cpGeometryStrokesToScene(
  transport: CpGeometryTransport,
  appearanceFor: CpLineAppearanceFor,
  dashPatterns: CpDashPatterns,
  selection?: CpSelectionStyle,
  move?: CpTransformPreview,
  /** How a non-180 crease shows its angle. Omit to disable the treatment. */
  foldAngle?: CpFoldAngleStyle,
  replaced?: CpReplacedLines
): { strokes: StrokeGeometry } {
  const endpoints = transport.segEndpoints;
  const attr = transport.segAttr;
  const count = endpoints.length / 4;
  // Room for one hint overlay per hinted crease, appended after the creases.
  // An upper bound rather than the exact figure: whether a hint *shows* also
  // depends on the selection, the tool preview and the line style, none of which
  // are worth a second lookup here. `count` below is the total actually written.
  let hinted = 0;
  for (let i = 0; i < count; i++) {
    if (isHinted(attr[i * SEG_ATTR_STRIDE + 4] ?? HINT_NONE)) hinted++;
  }
  const total = count + hinted;
  const a = new Float32Array(total * 2);
  const b = new Float32Array(total * 2);
  const color = new Float32Array(total * 4);
  const widthMul = new Float32Array(total).fill(1);
  const dashSlot = new Float32Array(total);
  let overlays = 0;

  // Memoise appearance lookups by color number — a dense CP has thousands of
  // segments but only a handful of distinct assignments.
  const appearanceCache = new Map<number, CpLineAppearance>();
  const hintAppearanceCache = new Map<number, CpLineAppearance>();

  const m = move?.matrix;

  for (let i = 0; i < count; i++) {
    const e = i * 4;
    const moved = m !== undefined && move !== undefined && move.ids.has(i + 1);
    if (moved) {
      a[i * 2] = m[0] * endpoints[e] + m[1] * endpoints[e + 1] + m[4];
      a[i * 2 + 1] = m[2] * endpoints[e] + m[3] * endpoints[e + 1] + m[5];
      b[i * 2] = m[0] * endpoints[e + 2] + m[1] * endpoints[e + 3] + m[4];
      b[i * 2 + 1] = m[2] * endpoints[e + 2] + m[3] * endpoints[e + 3] + m[5];
    } else {
      a[i * 2] = endpoints[e];
      a[i * 2 + 1] = endpoints[e + 1];
      b[i * 2] = endpoints[e + 2];
      b[i * 2 + 1] = endpoints[e + 3];
    }

    // Before the selection branch: a replaced crease must vanish even when it is
    // also selected, which is exactly the case here — the tool's picked creases
    // render selected, and drawing both that and the preview over each other is
    // the muddiness this exists to remove.
    if (replaced !== undefined && replaced.has(i + 1)) continue;

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
    let appearance = appearanceCache.get(colorNumber);
    if (!appearance) {
      appearance = appearanceFor(lineColorName(colorNumber));
      appearanceCache.set(colorNumber, appearance);
    }
    // Applied after the colour-keyed cache: the crease's *direction* is what
    // the cache keys on, and its magnitude is per segment.
    const rgba =
      foldAngle === undefined
        ? appearance.color
        : foldAngleInk(appearance.color, transport.segFoldMagnitude?.[i], foldAngle);
    color[i * 4] = rgba[0];
    color[i * 4 + 1] = rgba[1];
    color[i * 4 + 2] = rgba[2];
    color[i * 4 + 3] = rgba[3];
    dashSlot[i] = appearance.dashSlot;

    // A hinted crease keeps the undecided grey and the undecided dash, and says
    // which way it leaned by taking that dash's alternate marks in its
    // direction's own full-strength colour — a second stroke, appended past the
    // creases so it lands over the marks it replaces. Per segment, and after the
    // cache, for the same reason the fold-angle ramp is: direction is what the
    // cache keys on, and which creases are hinted is not.
    const hint = attr[i * SEG_ATTR_STRIDE + 4] ?? HINT_NONE;
    const hintName = hintColorName(hint);
    if (hintName) {
      let directionAppearance = hintAppearanceCache.get(hint);
      if (!directionAppearance) {
        directionAppearance = appearanceFor(hintName);
        hintAppearanceCache.set(hint, directionAppearance);
      }
      const wrote = appendDirectionHintDash(
        { a, b, color, dashSlot },
        count + overlays,
        a[i * 2],
        a[i * 2 + 1],
        b[i * 2],
        b[i * 2 + 1],
        directionAppearance.color,
        appearance.color
      );
      if (wrote) overlays++;
    }
  }

  return {
    strokes: { a, b, color, widthMul, count: count + overlays, dashPatterns, dashSlot },
  };
}
