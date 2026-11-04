import type { Point } from '../../lib/geometry';
import type { PaperSide } from '../../lib/paper/paperScene';
import { boundsOf, foldUnitToUser } from './foldCanvasGeometry';

type Sheet = readonly (readonly [number, number])[];

/**
 * Turn left to right about the sheet's midpoint, including off-origin polygons.
 * The surface uses this same map to paint every model channel and unproject
 * pointer events, so picks and overlays remain in the original sheet frame.
 */
export function foldCpModelToUser(sheet: Sheet, side: PaperSide): (point: Point) => Point {
  if (side === 'front') return foldUnitToUser;
  const bounds = boundsOf(sheet.map(([x, y]) => ({ x, y })));
  const sumX = bounds ? bounds.minX + bounds.maxX : 0;
  return ({ x, y }) => foldUnitToUser({ x: sumX - x, y });
}

/** The crease's assignment as seen from this side; flat creases and borders keep their roles. */
export function foldCpViewedColor(color: string, side: PaperSide): string {
  if (side === 'front') return color;
  return color === 'Red1' ? 'Blue2' : color === 'Blue2' ? 'Red1' : color;
}
