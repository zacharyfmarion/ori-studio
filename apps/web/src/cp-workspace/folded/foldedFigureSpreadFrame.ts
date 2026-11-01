/**
 * Where an Edit figure's spread picture is built, and how it is placed on the
 * canvas (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`,
 * "Drawing on Edit's canvas").
 *
 * A flat figure draws its kernel picture through one affine: Edit's paper map
 * (`cpModelToSvg`), then its placement — `c0 + offset + R(rotation)·scale·(p − c0)`
 * about the pivot `c0`, its flat picture's centre (`foldedFigurePivot`). A
 * spread picture splits that affine in two:
 *
 * - **The frame it is built in:** the paper map, then the figure's turn about
 *   the pivot. A spread's reveal is a direction on the screen after the host's
 *   turn (`layer-spread/connectedScene.ts`), so building after the figure's own
 *   Rotation fixes the reveal to the page: a turned figure opens the same way
 *   as an upright one, as its export does, and turning the canvas view — which
 *   is only the camera — never builds it again, let alone solves it again.
 * - **The placement it is drawn through:** the figure's scale about the pivot,
 *   then its offset. A uniform scale and a shift, so a move or a resize is a
 *   new view for the spread pass and never a new picture.
 *
 * With nothing spread the two compose to the flat figure's affine exactly, so
 * the spread picture lies where its snapshot lay, on either side: a figure
 * turned over is the kernel's back pass, in the same coordinates as its
 * snapshot.
 *
 * Pure.
 */

import type { FoldedFigurePlacement } from '../../engine/oristudioCpTypes';
import { cpModelToSvg } from '../../lib/creasePatternViewport';
import type { Point } from '../../lib/geometry';
import type { ScenePoint } from '../../lib/paper/paperScene';

export interface FoldedFigureSpreadFrame {
  /** The point the figure turns and scales about: its flat picture's centre, which a spread never moves. */
  readonly pivot: Point;
  /** The figure's turn, radians, which the picture is built at. */
  readonly rotation: number;
  /** Kernel coordinates to the picture's frame: Edit's paper map, then the turn about the pivot. */
  readonly toScenePx: (point: Point) => ScenePoint;
  /** Picture units per kernel unit: the paper map's, since a turn keeps lengths. */
  readonly scale: number;
}

/** A spread picture's frame to user space: `scale·p + (x, y)`. */
export interface FoldedFigureSpreadPlacement {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

const ORIGIN = cpModelToSvg({ x: 0, y: 0 });
const UNIT = cpModelToSvg({ x: 1, y: 0 });
/** User units per kernel unit of the paper map. */
const PAPER_SCALE = Math.hypot(UNIT.x - ORIGIN.x, UNIT.y - ORIGIN.y);

/** The frame a figure's spread picture is built in: about its pivot, at its turn. */
export function foldedFigureSpreadFrame(pivot: Point, rotation: number): FoldedFigureSpreadFrame {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    pivot,
    rotation,
    scale: PAPER_SCALE,
    toScenePx: (point) => {
      const p = cpModelToSvg(point);
      const dx = p.x - pivot.x;
      const dy = p.y - pivot.y;
      return [pivot.x + cos * dx - sin * dy, pivot.y + sin * dx + cos * dy];
    },
  };
}

/** Whether two frames build the same picture: same pivot, same turn. */
export function sameSpreadFrame(a: FoldedFigureSpreadFrame, b: FoldedFigureSpreadFrame): boolean {
  return a.rotation === b.rotation && a.pivot.x === b.pivot.x && a.pivot.y === b.pivot.y;
}

/**
 * Where a picture built about `pivot` goes in user space for a placement: its
 * scale about the pivot, then its offset. Its turn is in the picture already.
 */
export function foldedFigureSpreadPlacement(
  placement: Pick<FoldedFigurePlacement, 'scale' | 'offset'>,
  pivot: Point
): FoldedFigureSpreadPlacement {
  const { scale, offset } = placement;
  return { scale, x: pivot.x + offset.x - scale * pivot.x, y: pivot.y + offset.y - scale * pivot.y };
}

/**
 * How far a picture built in `frame` reaches from the pivot along the
 * figure's own axes — before its turn and its scale, as the figure's box is
 * measured — over every point `each` visits. What lets the box, the hit area,
 * the toolbar and Fit take in a spread while the pivot stays where it was.
 */
export function spreadReachFromPivot(
  frame: Pick<FoldedFigureSpreadFrame, 'pivot' | 'rotation'>,
  each: (visit: (x: number, y: number) => void) => void
): { halfWidth: number; halfHeight: number } {
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  const { pivot } = frame;
  let halfWidth = 0;
  let halfHeight = 0;
  each((x, y) => {
    const dx = x - pivot.x;
    const dy = y - pivot.y;
    // The turn undone: R(−rotation)·(p − pivot).
    halfWidth = Math.max(halfWidth, Math.abs(cos * dx + sin * dy));
    halfHeight = Math.max(halfHeight, Math.abs(-sin * dx + cos * dy));
  });
  return { halfWidth, halfHeight };
}
