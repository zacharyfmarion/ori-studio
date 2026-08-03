import { foldAngleInk } from '../foldAngle/foldAngleRamp';
import type { OristudioCpFoldAngleDisplay } from '../../lib/creasePatternViewport';
import type { ModelPoint, Rgba, StrokeGeometry } from '../renderer/types';
import type { CpLineAppearance } from './cpLineStyle';

/**
 * How a non-180 crease shows its angle: which channel carries it, and the hue
 * the `color` mode ramps toward.
 *
 * Passed as one value so the two builders take a single fold-angle argument
 * rather than drifting apart a parameter at a time. Omitting it disables the
 * treatment entirely, which no production caller does — it exists so the parity
 * gate can compare encoded output against untouched ink.
 */
export interface CpFoldAngleStyle {
  display: OristudioCpFoldAngleDisplay;
  anchor: Rgba;
}

/**
 * How a crease's line colour is painted: the active line style's ink and dash
 * slot for it. Injected so the scene builders stay pure (no DOM/theme).
 */
export type CpLineAppearanceFor = (color: string) => CpLineAppearance;

/** The dash-pattern table {@link CpLineAppearanceFor}'s slots index into. */
export type CpDashPatterns = readonly (readonly number[])[];

/** Minimal structural shape of a crease-pattern line segment we consume. */
export interface CpLineSegmentInput {
  a: ModelPoint;
  b: ModelPoint;
  color: string;
  /**
   * `|ρ|` in kernel storage units; absent for a classic ±180 crease. Mirrors
   * `segFoldMagnitude` on the transport so both builders stay byte-identical.
   */
  fold_magnitude?: number;
}

/** Selection highlighting: 1-based line ids, their colour, and width multiplier. */
export interface CpSelectionStyle {
  selected: ReadonlySet<number>;
  color: Rgba;
  widthMul: number;
}

/**
 * Model→model affine, row-major: `[m00, m01, m10, m11, tx, ty]`, applied as
 *
 *   x' = m00 * x + m01 * y + tx
 *   y' = m10 * x + m11 * y + ty
 *
 * A pure translation is `[1, 0, 0, 1, dx, dy]`, whose apply reduces to `x + dx`
 * exactly (the `0 * y` term contributes no rounding), so translation previews stay
 * bit-for-bit what the delta-only code produced.
 */
export type CpAffineMatrix = readonly [number, number, number, number, number, number];

/** The identity-with-translation matrix for a live move-drag's `delta`. */
export function translationMatrix(delta: ModelPoint): CpAffineMatrix {
  return [1, 0, 0, 1, delta.x, delta.y];
}

/** Apply {@link CpAffineMatrix} to a model point. */
export function applyAffine(m: CpAffineMatrix, x: number, y: number): ModelPoint {
  return { x: m[0] * x + m[1] * y + m[4], y: m[2] * x + m[3] * y + m[5] };
}

/**
 * A live transform gesture: draw these 1-based line ids through `matrix` instead of
 * at their stored coordinates. Covers both the selection move-drag (a translation)
 * and the four-point move/copy tools (a similarity).
 */
export interface CpTransformPreview {
  ids: ReadonlySet<number>;
  matrix: CpAffineMatrix;
}

/**
 * Convert crease-pattern line segments into GPU-ready stroke geometry. Pure: the
 * per-colour resolution is injected so this stays testable without the DOM/theme.
 * Selected lines (1-based ids, matching the SVG's index+1) are recoloured and
 * widened — and drawn solid, because the selection replaces the crease's own ink
 * rather than underlaying it as Oriedita does, so a dashed selection would read
 * as broken geometry. When `move` is given, the named lines are drawn through its
 * matrix — this is how an in-progress move-drag or transform tool previews the
 * real strokes.
 */
export function cpSnapshotToScene(
  lineSegments: readonly CpLineSegmentInput[],
  appearanceFor: CpLineAppearanceFor,
  dashPatterns: CpDashPatterns,
  selection?: CpSelectionStyle,
  move?: CpTransformPreview,
  /** See {@link cpGeometryStrokesToScene}; kept in step for the parity gate. */
  foldAngle?: CpFoldAngleStyle
): { strokes: StrokeGeometry } {
  const count = lineSegments.length;
  const a = new Float32Array(count * 2);
  const b = new Float32Array(count * 2);
  const color = new Float32Array(count * 4);
  const widthMul = new Float32Array(count).fill(1);
  const dashSlot = new Float32Array(count);

  // Memoise appearance lookups — a dense CP has thousands of segments but only a
  // handful of distinct assignments.
  const appearanceCache = new Map<string, CpLineAppearance>();

  const m = move?.matrix;

  for (let i = 0; i < count; i++) {
    const seg = lineSegments[i];
    const moved = m !== undefined && move !== undefined && move.ids.has(i + 1);
    if (moved) {
      a[i * 2] = m[0] * seg.a.x + m[1] * seg.a.y + m[4];
      a[i * 2 + 1] = m[2] * seg.a.x + m[3] * seg.a.y + m[5];
      b[i * 2] = m[0] * seg.b.x + m[1] * seg.b.y + m[4];
      b[i * 2 + 1] = m[2] * seg.b.x + m[3] * seg.b.y + m[5];
    } else {
      a[i * 2] = seg.a.x;
      a[i * 2 + 1] = seg.a.y;
      b[i * 2] = seg.b.x;
      b[i * 2 + 1] = seg.b.y;
    }

    if (selection && selection.selected.has(i + 1)) {
      const c = selection.color;
      color[i * 4] = c[0];
      color[i * 4 + 1] = c[1];
      color[i * 4 + 2] = c[2];
      color[i * 4 + 3] = c[3];
      widthMul[i] = selection.widthMul;
      continue;
    }

    let appearance = appearanceCache.get(seg.color);
    if (!appearance) {
      appearance = appearanceFor(seg.color);
      appearanceCache.set(seg.color, appearance);
    }
    const rgba =
      foldAngle === undefined
        ? appearance.color
        : foldAngleInk(appearance.color, seg.fold_magnitude, foldAngle);
    color[i * 4] = rgba[0];
    color[i * 4 + 1] = rgba[1];
    color[i * 4 + 2] = rgba[2];
    color[i * 4 + 3] = rgba[3];
    dashSlot[i] = appearance.dashSlot;
  }

  return { strokes: { a, b, color, widthMul, count, dashPatterns, dashSlot } };
}
