import type { Aabb } from '../picking/lineHitIndex';
import type { AnnotationBox } from '../annotations/annotationTransform';

/**
 * Where to park something new next to the crease pattern: as far left as it will
 * go on the right-hand side, without landing on anything already there.
 *
 * Extracted so folded figures and inline simulation windows pack by one rule
 * rather than two that drift. Both park to the right of the creases they came
 * from and align their top edges, so repeated ones read as a row.
 *
 * Deliberately unit-agnostic. Folded figures work in SVG user coordinates and
 * inline simulations in crease-pattern model coordinates; the two are related by
 * a positive affine map, so "right" and "top" mean the same thing in each and
 * the packing is identical as long as one caller stays in one space.
 */

/** The edges a parked object lines up against. */
export interface BesideAnchor {
  right: number;
  top: number;
}

/**
 * Gap between the crease pattern and what is parked beside it, and between
 * neighbours in the row. In SVG user units, where the paper square is 400 wide.
 */
export const CANVAS_OBJECT_GAP = 48;

/**
 * First-fit position for a `width` x `height` box in the horizontal band that
 * starts at `anchor.top`.
 *
 * Only blockers sharing that band can displace it: one parked above or below is
 * simply not in the way, and treating it as if it were is what flings a new
 * object far off to the right. The band is then scanned left to right for the
 * first slot wide enough, rather than jumping past everything — so a hole left
 * by a deleted object gets reused and the row does not grow forever.
 */
export function firstFreeSlotBeside(options: {
  anchor: BesideAnchor;
  width: number;
  height: number;
  gap: number;
  blockers: readonly Aabb[];
}): { left: number; top: number } {
  const { anchor, width, height, gap, blockers } = options;
  const top = anchor.top;
  const bottom = top + height;

  const inBand = blockers
    .filter((aabb) => aabb.minY - gap < bottom && aabb.maxY + gap > top)
    .sort((a, b) => a.minX - b.minX);

  let left = anchor.right + gap;
  for (const blocker of inBand) {
    if (blocker.maxX + gap <= left) continue; // already behind us
    if (blocker.minX - gap >= left + width) break; // the slot fits here
    left = blocker.maxX + gap; // overlaps: move past it and re-check
  }

  return { left, top };
}

/**
 * Axis-aligned bounds of a rotated box, taken over its corners so a turned
 * object is fully enclosed.
 */
export function boxAabb(box: AnnotationBox): Aabb {
  const hw = box.width / 2;
  const hh = box.height / 2;
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [dx, dy] of [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ] as const) {
    const x = box.center.x + dx * cos - dy * sin;
    const y = box.center.y + dx * sin + dy * cos;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}
