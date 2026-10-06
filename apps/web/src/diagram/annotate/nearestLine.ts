/**
 * The line a press is on (15b, Revision 2): the line of the picture, or one
 * drawn on it, nearest a press within reach — what the Angle Bisector picks,
 * and what Equal Divisions divides with a click. One module for both, so
 * what one tool takes the other would too.
 *
 * A picture's lines come in pieces: a crease pattern's rim is split wherever
 * a crease meets it, and a flat fold's faces each bring their own edges. A
 * mark that divides a line divides all of it, so `whole` runs the piece under
 * the press on through every piece that continues it along the same line, end
 * to end, to its furthest ends.
 *
 * Pure: no DOM, no store.
 */
import type { IndexedSegment } from '../../cp-workspace/picking/lineHitIndex';
import type { DiagramAsset, DiagramStep, DiagramStyle } from '../document/diagramDocument';
import type { PickedLine } from './angleBisector';
import type { PicturePoint } from './annotationModel';
import { alongLine, distanceTo, pictureGeometry, PICTURE_POINT_EPSILON, type PictureGeometry } from './pictureGeometry';
import { annotationsOf, drawnLines } from './pictureSnap';

/**
 * The line of `step`'s picture, or drawn on it, nearest `at` within `within`
 * (picture units); null for none. With `whole`, the piece found run on
 * through the pieces that continue it ({@link wholeLine}).
 */
export function nearestLine(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle | undefined,
  at: PicturePoint,
  within: number,
  { whole = false }: { whole?: boolean } = {}
): PickedLine | null {
  const geometry = pictureGeometry(step, assets, style);
  const drawn = drawnLines(annotationsOf(step, {}));
  let best: { segment: IndexedSegment; distance: number } | null = null;
  for (const segment of [...geometry.segmentIndex.segmentsNear(at[0], at[1], within), ...drawn]) {
    const distance = distanceTo(at, segment);
    if (distance > within || (best && distance >= best.distance)) continue;
    best = { segment, distance };
  }
  if (!best) return null;
  const { segment } = best;
  if (!whole) return { a: [segment.a.x, segment.a.y], b: [segment.b.x, segment.b.y] };
  return wholeLine(segment, geometry, drawn);
}

/**
 * `seed` run on at each end through every line that continues it — one that
 * lies along it and reaches its end, starting there or running through it,
 * as a flat fold's faces lay their edges one over another — to its furthest
 * ends: the picture's pieces of one line, and the lines drawn on it.
 */
export function wholeLine(seed: IndexedSegment, geometry: PictureGeometry, drawn: readonly IndexedSegment[]): PickedLine {
  const dx = seed.b.x - seed.a.x;
  const dy = seed.b.y - seed.a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return { a: [seed.a.x, seed.a.y], b: [seed.b.x, seed.b.y] };
  const along = (point: { x: number; y: number }) => ((point.x - seed.a.x) * dx + (point.y - seed.a.y) * dy) / length;
  const near = (point: PicturePoint) => [
    ...geometry.segmentIndex.segmentsNear(point[0], point[1], PICTURE_POINT_EPSILON),
    ...drawn.filter((segment) => distanceTo(point, segment) <= PICTURE_POINT_EPSILON),
  ];
  /** The far end of a run from `end`, going the way `sign` says along the seed. */
  const runOn = (end: PicturePoint, sign: 1 | -1): PicturePoint => {
    let reached = end;
    let reach = sign * along({ x: end[0], y: end[1] });
    // Each step goes further along, so it ends; the cap is for a picture no build draws.
    for (let steps = 0; steps < 10_000; steps += 1) {
      let next: PicturePoint | null = null;
      for (const segment of near(reached)) {
        if (!alongLine(seed, segment)) continue;
        for (const end of [segment.a, segment.b]) {
          const further = sign * along(end);
          if (further > reach + PICTURE_POINT_EPSILON) {
            reach = further;
            next = [end.x, end.y];
          }
        }
      }
      if (!next) return reached;
      reached = next;
    }
    return reached;
  };
  return { a: runOn([seed.a.x, seed.a.y], -1), b: runOn([seed.b.x, seed.b.y], 1) };
}
