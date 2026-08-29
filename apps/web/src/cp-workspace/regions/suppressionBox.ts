/**
 * The box a `drag-box` commit describes, in the form a suppression region
 * stores it.
 *
 * The rail tool commits through `dragBoxTool`, which hands over the rectangle's
 * four corners in *model* space, axis-aligned on screen — never a centre and a
 * size. A region, like every other canvas object, is a rotated centred box. This
 * is the one conversion between the two, kept out of the panel because it is
 * geometry with a right answer and out of `annotations/suppressionRegion.ts`
 * because that module is deliberately a leaf (types and validation only, no
 * camera).
 *
 * Rotation comes from the view, not from the corners. Deriving it from the quad
 * would be the same number by construction but would also read a rotation off a
 * degenerate drag, where the corners are collinear and the angle is noise;
 * `uprightRotationForView` is the value that makes the box look square to the
 * person drawing it, and is what every other canvas object placed under a
 * rotated camera already stores.
 */
import { uprightRotationForView } from '../annotations/annotationTransform';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';

interface Vec2 {
  x: number;
  y: number;
}

/**
 * How thin a committed box may be before it counts as no box, as a fraction of
 * its own longer side.
 *
 * Relative, not absolute, because model space is not one scale: a `.cp` document
 * is 400 units across and a detected candidate is the unit square, and an
 * absolute floor would be either meaningless in one or destructive in the other.
 *
 * It has to exist at all because a screen-flat drag under a rotated camera does
 * not round-trip to exactly zero — the corners come back through
 * `unprojectDevicePoint`, so the collapsed side measures ~1e-15 rather than 0.
 * Testing `> 0` therefore admits a region with no visible area, which is the one
 * thing worse than no region: a chip parked over the canvas suppressing nothing.
 */
const DEGENERATE_ASPECT = 1e-9;

/** Whether a committed rectangle has real area at the scale it was drawn. */
function hasArea(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  return Math.min(width, height) > Math.max(width, height) * DEGENERATE_ASPECT;
}

/** A rotated, centred box — the transform a region is created with. */
export interface CpSuppressionBox {
  center: Vec2;
  width: number;
  height: number;
  rotation: number;
}

/**
 * Build the region box a drag-box tool committed, or null if it has no area.
 *
 * Two commit shapes, both produced by `dragBoxTool`:
 *
 * - **Four corners**, when the tool had a view transform. They arrive in
 *   perimeter order from `viewAlignedBoxCorners`, with `[0]→[1]` the
 *   screen-vertical edge and `[1]→[2]` the screen-horizontal one — so the edge
 *   lengths are the box's height and width, and the mean of all four is its
 *   centre.
 * - **Two diagonal corners**, when it had none. Model-axis-aligned, rotation 0.
 *
 * A commit with no area returns null rather than a degenerate region: the drag
 * engine only rejects a zero-*length* gesture, so a drag flat along one screen
 * axis still commits, and a region with no area suppresses nothing while still
 * holding a chip over the canvas. "No area" is {@link DEGENERATE_ASPECT}, not
 * `=== 0` — see there.
 */
export function cpSuppressionBoxFromCommitPoints(
  points: readonly Vec2[],
  view: CpOverlayView | null | undefined
): CpSuppressionBox | null {
  if (points.length >= 4) {
    const [a, b, c, d] = points;
    const width = Math.hypot(c.x - b.x, c.y - b.y);
    const height = Math.hypot(b.x - a.x, b.y - a.y);
    if (!hasArea(width, height)) return null;
    return {
      center: { x: (a.x + b.x + c.x + d.x) / 4, y: (a.y + b.y + c.y + d.y) / 4 },
      width,
      height,
      rotation: uprightRotationForView(view),
    };
  }
  if (points.length >= 2) {
    const [a, b] = points;
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    if (!hasArea(width, height)) return null;
    return {
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      width,
      height,
      rotation: 0,
    };
  }
  return null;
}
