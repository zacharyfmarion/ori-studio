import type { ModelPoint, PointGeometry, Rgba } from '../renderer/types';

/** SVG editable radii, in user units: `calc(var(--cp-point-size) * N)`. */
const POINT_RADIUS_FACTOR = 2;
export const VERTEX_RADIUS_FACTOR = 1.6;
/**
 * A pinned vertex draws larger as well as differently coloured.
 *
 * Colour alone is not enough at the sizes these render at: the dots are a couple
 * of CSS px across at the default point size, and at fit zoom over a dense
 * pattern a hue change on something that small is easy to miss entirely. Size is
 * the channel that survives being zoomed out, which is exactly when the user is
 * looking for "did that pin take".
 */
export const PINNED_VERTEX_RADIUS_FACTOR = 2.6;

export interface CpPointStyle {
  /** `--cp-point-size` value (default 1). */
  pointSize: number;
  pointFill: Rgba;
  pointStroke: Rgba;
  vertexFill: Rgba;
  vertexStroke: Rgba;
  circleStroke: Rgba;
  /**
   * A pinned vertex's ink — the theme's warning hue, not the selection accent.
   *
   * The accent is already spoken for here: it is the Move Vertex grab
   * highlight, and a pin drawn in it would be indistinguishable from "the
   * cursor is over this one". A pin is also a *lasting* state rather than a
   * hover, so it wants a colour of its own. Warning-amber rather than an
   * assignable crease hue because those are fully allocated
   * (`lib/oristudioCpPalette.ts`) — but a vertex dot is not crease ink, so it
   * carries no reading as an assignment the way a recoloured crease would.
   */
  pinnedFill: Rgba;
  pinnedStroke: Rgba;
}

/** A circle-packing circle: centre plus radius already in SVG user units. */
export interface CpCircleInput {
  center: ModelPoint;
  radius: number;
}

/** Transparent fill for circles — they render as stroked rings only. */
const TRANSPARENT: Rgba = [0, 0, 0, 0];

/**
 * Highlighted instances (by their index within each group) are drawn in `color`.
 *
 * Points and circles are here because they are *selectable*. Vertices are here
 * for a different reason: they are derived line endpoints and still not
 * selectable, but the Move Vertex tool makes them **draggable**, and the one
 * under the cursor has to say so before the press. Draggable is not selectable —
 * nothing puts a vertex in `oristudioCpSelection`.
 */
export interface CpPointSelection {
  pointIdx: ReadonlySet<number>;
  circleIdx: ReadonlySet<number>;
  /**
   * Indices into `vertices` to draw highlighted — the grab target under the
   * cursor. Optional because every caller but the vertex drag has none.
   */
  vertexIdx?: ReadonlySet<number>;
  /**
   * Indices into `vertices` the user has **pinned**: held by the solver and by
   * every transform, and drawn in {@link CpPointStyle.pinnedFill} so that is
   * visible without hovering.
   *
   * Ranked *below* {@link vertexIdx} where a vertex is both, because the grab
   * highlight answers "what will this press do", which is the more urgent
   * question — and on a pinned vertex the answer is "nothing", which the tool
   * says with its cursor.
   */
  pinnedIdx?: ReadonlySet<number>;
  color: Rgba;
}

/**
 * Build instanced point geometry from crease points, vertices, and circles. The
 * point program renders each as a disc + straddling outline, so circles are just
 * transparent-fill instances (a ring at the radius). Pure: colours and sizes are
 * injected so this stays testable without the DOM/theme.
 *
 * Order in the buffer: points, then vertices, then circles.
 */
export function cpPointsToScene(
  points: readonly ModelPoint[],
  vertices: readonly ModelPoint[],
  circles: readonly CpCircleInput[],
  style: CpPointStyle,
  selection?: CpPointSelection
): PointGeometry {
  const count = points.length + vertices.length + circles.length;
  const center = new Float32Array(count * 2);
  const radius = new Float32Array(count);
  // 1 = constant screen-size marker, 0 = scales with zoom. Points and vertices
  // are markers (their radius is a CSS-px size); circles are real geometry.
  const screenSpace = new Float32Array(count);
  const fill = new Float32Array(count * 4);
  const stroke = new Float32Array(count * 4);

  const write = (
    i: number,
    p: ModelPoint,
    r: number,
    screen: number,
    f: Rgba,
    s: Rgba
  ): void => {
    center[i * 2] = p.x;
    center[i * 2 + 1] = p.y;
    radius[i] = r;
    screenSpace[i] = screen;
    fill[i * 4] = f[0];
    fill[i * 4 + 1] = f[1];
    fill[i * 4 + 2] = f[2];
    fill[i * 4 + 3] = f[3];
    stroke[i * 4] = s[0];
    stroke[i * 4 + 1] = s[1];
    stroke[i * 4 + 2] = s[2];
    stroke[i * 4 + 3] = s[3];
  };

  const pointRadius = style.pointSize * POINT_RADIUS_FACTOR;
  const vertexRadius = style.pointSize * VERTEX_RADIUS_FACTOR;
  const pinnedRadius = style.pointSize * PINNED_VERTEX_RADIUS_FACTOR;

  const sel = selection?.color;
  for (let i = 0; i < points.length; i++) {
    const on = selection?.pointIdx.has(i);
    write(i, points[i], pointRadius, 1, on && sel ? sel : style.pointFill, on && sel ? sel : style.pointStroke);
  }
  const vertexOffset = points.length;
  for (let j = 0; j < vertices.length; j++) {
    // A vertex is never *selected*. It can be the Move Vertex tool's grab target
    // (`vertexIdx`), and it can be pinned (`pinnedIdx`) — two different claims,
    // so two sets rather than one flag.
    const on = selection?.vertexIdx?.has(j);
    const pinned = selection?.pinnedIdx?.has(j);
    const fill = on && sel ? sel : pinned ? style.pinnedFill : style.vertexFill;
    const stroke = on && sel ? sel : pinned ? style.pinnedStroke : style.vertexStroke;
    write(vertexOffset + j, vertices[j], pinned ? pinnedRadius : vertexRadius, 1, fill, stroke);
  }
  const circleOffset = vertexOffset + vertices.length;
  for (let k = 0; k < circles.length; k++) {
    const on = selection?.circleIdx.has(k);
    write(circleOffset + k, circles[k].center, circles[k].radius, 0, TRANSPARENT, on && sel ? sel : style.circleStroke);
  }

  return { center, radius, screenSpace, fill, stroke, count };
}
