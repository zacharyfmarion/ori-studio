import { paperSceneToFoldedGeometry } from '../../cp-workspace/adapters/cpFoldedToScene';
import type { FillGeometry } from '../../cp-workspace/renderer/types';
import type { Point } from '../../lib/geometry';
import type { PaperSide } from '../../lib/paper/paperScene';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { boundsOf, foldUnitToUser } from './foldCanvasGeometry';

type Sheet = readonly (readonly [number, number])[];

/** The actual sheet outline, in model coordinates, for the renderer's sheet-fill channel. */
export function foldCpSheetFill(sheet: Sheet, style: PaperStyle, side: PaperSide): FillGeometry | null {
  const bounds = boundsOf(sheet.map(([x, y]) => ({ x, y })));
  if (!bounds || sheet.length < 3) return null;
  return paperSceneToFoldedGeometry(
    {
      bounds,
      sheet: Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY),
      items: [{ kind: 'face', face: 0, side, rings: [sheet.map(([x, y]) => [x, y])], shade: 1, hidden: false }],
    },
    style,
    { policy: PAPER_STYLE_POLICIES.fold }
  ).fills;
}

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
