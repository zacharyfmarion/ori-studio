import type { PlotRect, Point } from '../lib/geometry';

/**
 * The mapping between tree coordinates and the SVG the editor draws into, plus
 * the rule for where a tree point is allowed to be.
 *
 * This is where the box-pleat sheet stops leaking. BP builds a frame from its
 * sheet — the paper it measures flap lengths against, and which clamps the
 * drawing — while a surface whose tree is not drawn on any paper builds an
 * unbounded one. The editor itself never learns which it has.
 */
export interface TreeFrame {
  /** Tree space → SVG space. */
  toSvg(point: Point): Point;
  /** SVG space → tree space. Constrained, so a click outside lands inside. */
  fromSvg(point: Point): Point;
  /** The nearest allowed tree point. Identity on an unbounded frame. */
  constrain(point: Point): Point;
  /**
   * Whether a tree point is allowed at all.
   *
   * The predicate form of {@link constrain}, and the one a drag uses: a gesture
   * is stopped at the boundary as a whole, rather than each vertex being clamped
   * onto it, which would silently deform a rigid subtree swung against the edge.
   */
  contains(point: Point): boolean;
  /**
   * SVG units per one tree unit.
   *
   * Drives the camera's opening zoom and converts screen-pixel tolerances into
   * tree units, so a snap band is the width it looks.
   */
  unitSvg: number;
  /** World bounds the camera frames, in SVG units. */
  worldRect: PlotRect;
  /**
   * Where a point is allowed to be, in SVG units — {@link contains} as a rect,
   * for the scene to draw.
   *
   * It lives on the frame so the box that is drawn and the box that is enforced
   * are one fact. A gesture stopping dead at an edge the surface never drew is
   * indistinguishable from a broken editor, and a second copy of the bound
   * maintained beside the scene would eventually disagree with this one.
   *
   * Not the same as {@link worldRect}: the world is what the camera frames, and
   * a paper-backed surface pads it out past the sheet.
   */
  boundsRect: PlotRect;
}

export interface CenteredFrameOptions {
  /** SVG units per tree unit. */
  unitSvg: number;
  /** Half the drawing area's width, in tree units. */
  halfExtent: number;
}

/**
 * A frame for a tree that sits on no paper: a fixed square of drawing room
 * centred on the tree's origin, with y up.
 *
 * **Fixed** is the load-bearing word. A world that grew with its content meant
 * the SVG element resized under a camera transform that did not, so every added
 * node nudged the whole drawing on screen — the view moving as a side effect of
 * an edit, which is never what anyone wants. A constant world is the only shape
 * that cannot do that: the camera fits it once and nothing an edit does touches
 * it again.
 *
 * It is also what lets the mirror line span the view, since the line is drawn to
 * the edges of a box that no longer moves.
 *
 * y is flipped to match the paper-backed frame, so both surfaces agree that "up
 * on screen" is "+y in the tree" — otherwise the same drag rule would rotate the
 * two in opposite directions.
 */
export function createCenteredTreeFrame(options: CenteredFrameOptions): TreeFrame {
  const { unitSvg, halfExtent } = options;
  const half = halfExtent * unitSvg;
  const square: PlotRect = { x: -half, y: -half, width: half * 2, height: half * 2 };
  const inside = (value: number) => Math.min(halfExtent, Math.max(-halfExtent, value));
  return {
    toSvg: (point) => ({ x: point.x * unitSvg, y: -point.y * unitSvg }),
    fromSvg: (point) => ({ x: inside(point.x / unitSvg), y: inside(-point.y / unitSvg) }),
    constrain: (point) => ({ x: inside(point.x), y: inside(point.y) }),
    contains: (point) =>
      Math.abs(point.x) <= halfExtent + 1e-9 && Math.abs(point.y) <= halfExtent + 1e-9,
    unitSvg,
    worldRect: square,
    // On a surface with no paper the two coincide: there is nothing outside the
    // drawing area worth framing.
    boundsRect: square,
  };
}

export interface CenteredFitOptions {
  /** SVG units per tree unit. Must match the frame's. */
  unitSvg: number;
  /** Closest the camera will open, as a half-width in tree units. */
  minHalfSpan: number;
  /** Room left around the outermost point, in tree units. */
  padding: number;
}

/**
 * What the camera should frame inside a centred world: the drawing, squared and
 * centred on the origin.
 *
 * A centred frame's world is deliberately much larger than any tree drawn in it,
 * so fitting the world would open every document uselessly far out. Fitting the
 * drawing instead is what lets the drawing area be generous without the opening
 * zoom paying for it.
 *
 * Squared *about the origin* is the load-bearing part, and the reason this is
 * not simply the tree's bounding box. The viewport centres the world, so a fit
 * rect centred anywhere else would set the zoom for one region and point the
 * camera at another — a tree grown out to one side would open half off-screen.
 * Centred on the origin, the rect is exactly what the camera will show.
 */
export function centeredTreeFitRect(
  points: readonly Point[],
  options: CenteredFitOptions
): PlotRect {
  const { unitSvg, minHalfSpan, padding } = options;
  let halfSpan = minHalfSpan;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    halfSpan = Math.max(halfSpan, Math.abs(point.x) + padding, Math.abs(point.y) + padding);
  }
  const half = halfSpan * unitSvg;
  return { x: -half, y: -half, width: half * 2, height: half * 2 };
}
