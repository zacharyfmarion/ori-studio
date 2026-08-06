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
}

export interface UnboundedFrameOptions {
  /** SVG units per tree unit. */
  unitSvg: number;
  /** SVG point that tree-space origin maps to. */
  origin: Point;
  worldRect: PlotRect;
}

/**
 * A frame for a tree that sits on no paper: a plain scale about an origin, with
 * y up, and nothing to clamp against.
 *
 * y is flipped to match the paper-backed frame, so both surfaces agree that "up
 * on screen" is "+y in the tree" — otherwise the same drag rule would rotate the
 * two in opposite directions.
 */
export function createUnboundedTreeFrame(options: UnboundedFrameOptions): TreeFrame {
  const { unitSvg, origin, worldRect } = options;
  return {
    toSvg: (point) => ({ x: origin.x + point.x * unitSvg, y: origin.y - point.y * unitSvg }),
    fromSvg: (point) => ({ x: (point.x - origin.x) / unitSvg, y: (origin.y - point.y) / unitSvg }),
    constrain: (point) => point,
    contains: () => true,
    unitSvg,
    worldRect,
  };
}
