import { foldAngleInk } from '../foldAngle/foldAngleRamp';
import { directionHintInk, HINT_MOUNTAIN, HINT_VALLEY, hintColorName } from '../foldAngle/directionHintInk';
import type { OristudioCpFoldAngleDisplay } from '../../lib/creasePatternViewport';
import type { OristudioCpFoldDirectionHint } from '../../engine/oristudioCpTypes';
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
  /**
   * Which way this crease folded before its angle was forgotten. Mirrors
   * `seg_attr`'s fifth slot on the transport so both builders stay
   * byte-identical — see `fold_direction_hint` on the kernel's `LineSegment`.
   *
   * Typed from the engine's union rather than restating it: this interface is a
   * structural subset of `OristudioCpLineSegment` on purpose (it keeps the
   * scene builders free of the engine's full segment shape), but the *values*
   * must not be free to drift.
   */
  fold_direction_hint?: OristudioCpFoldDirectionHint;
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
 * 1-based line ids the active tool is drawing a *replacement* for, which the
 * document must therefore stop drawing.
 *
 * The sibling of {@link CpTransformPreview}: a move-drag shifts the real strokes
 * so "the originals leave with them", and this does the same for a tool whose
 * preview occupies the same place as the crease it would change. Without it the
 * preview lies on top of the original — a dashed stroke over a solid one in a
 * different colour, which is harder to read than either alone.
 *
 * Hidden by leaving the colour at zero alpha rather than by dropping the segment
 * from the buffers. The arrays are indexed by segment, so removing one would
 * shift every id after it, and those ids are what the selection and transform
 * sets are keyed on.
 *
 * **Purely visual.** The hit index is built from the document independently of
 * these buffers, so a replaced crease is still there to click, select and draw
 * over.
 */
export type CpReplacedLines = ReadonlySet<number>;


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
  foldAngle?: CpFoldAngleStyle,
  replaced?: CpReplacedLines
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
  const hintAppearanceCache = new Map<number, CpLineAppearance>();

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

    let appearance = appearanceCache.get(seg.color);
    if (!appearance) {
      appearance = appearanceFor(seg.color);
      appearanceCache.set(seg.color, appearance);
    }
    let rgba =
      foldAngle === undefined
        ? appearance.color
        : foldAngleInk(appearance.color, seg.fold_magnitude, foldAngle);
    // Must match `cpGeometryToScene`'s hint branch exactly; the two are pinned
    // byte-for-byte against each other.
    const hint =
      seg.fold_direction_hint === 'Mountain'
        ? HINT_MOUNTAIN
        : seg.fold_direction_hint === 'Valley'
          ? HINT_VALLEY
          : 0;
    const hintName = hintColorName(hint);
    if (hintName) {
      let directionAppearance = hintAppearanceCache.get(hint);
      if (!directionAppearance) {
        directionAppearance = appearanceFor(hintName);
        hintAppearanceCache.set(hint, directionAppearance);
      }
      rgba = directionHintInk(directionAppearance.color, appearance.color);
    }
    color[i * 4] = rgba[0];
    color[i * 4 + 1] = rgba[1];
    color[i * 4 + 2] = rgba[2];
    color[i * 4 + 3] = rgba[3];
    dashSlot[i] = appearance.dashSlot;
  }

  return { strokes: { a, b, color, widthMul, count, dashPatterns, dashSlot } };
}
