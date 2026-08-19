import type { ModelPoint, PointGeometry, Rgba } from '../renderer/types';

/** SVG editable radii, in user units: `calc(var(--cp-point-size) * N)`. */
const POINT_RADIUS_FACTOR = 2;
export const VERTEX_RADIUS_FACTOR = 1.6;

export interface CpPointStyle {
  /** `--cp-point-size` value (default 1). */
  pointSize: number;
  pointFill: Rgba;
  pointStroke: Rgba;
  vertexFill: Rgba;
  vertexStroke: Rgba;
  circleStroke: Rgba;
}

/** A circle-packing circle: centre plus radius already in SVG user units. */
export interface CpCircleInput {
  center: ModelPoint;
  radius: number;
}

/** Transparent fill for circles — they render as stroked rings only. */
const TRANSPARENT: Rgba = [0, 0, 0, 0];

/**
 * Selected instances (by their index within each group) are drawn in `color`.
 * Vertices have no entry — they are derived line endpoints, not selectable.
 */
export interface CpPointSelection {
  pointIdx: ReadonlySet<number>;
  circleIdx: ReadonlySet<number>;
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
  selection?: CpPointSelection,
): PointGeometry {
  const count = points.length + vertices.length + circles.length;
  const center = new Float32Array(count * 2);
  const radius = new Float32Array(count);
  // 1 = constant screen-size marker, 0 = scales with zoom. Points and vertices
  // are markers (their radius is a CSS-px size); circles are real geometry.
  const screenSpace = new Float32Array(count);
  const fill = new Float32Array(count * 4);
  const stroke = new Float32Array(count * 4);

  const write = (i: number, p: ModelPoint, r: number, screen: number, f: Rgba, s: Rgba): void => {
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

  const sel = selection?.color;
  for (let i = 0; i < points.length; i++) {
    const on = selection?.pointIdx.has(i);
    write(
      i,
      points[i],
      pointRadius,
      1,
      on && sel ? sel : style.pointFill,
      on && sel ? sel : style.pointStroke,
    );
  }
  const vertexOffset = points.length;
  for (let j = 0; j < vertices.length; j++) {
    // Vertices are derived line endpoints, never selected — always base style.
    write(vertexOffset + j, vertices[j], vertexRadius, 1, style.vertexFill, style.vertexStroke);
  }
  const circleOffset = vertexOffset + vertices.length;
  for (let k = 0; k < circles.length; k++) {
    const on = selection?.circleIdx.has(k);
    write(
      circleOffset + k,
      circles[k].center,
      circles[k].radius,
      0,
      TRANSPARENT,
      on && sel ? sel : style.circleStroke,
    );
  }

  return { center, radius, screenSpace, fill, stroke, count };
}
