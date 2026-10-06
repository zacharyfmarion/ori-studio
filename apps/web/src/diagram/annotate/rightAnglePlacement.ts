/**
 * Putting a right-angle mark down (implementation-plans/diagram-annotate.md,
 * 4; decision 12): hover a corner where two lines leave a vertex at 90° and
 * click, and the mark goes into that angle; or press at a corner and drag
 * into the angle — the drag squared into a right angle at the corner when it
 * points into one, Shift holding it to 45° steps otherwise. A click where no
 * right angle is found puts the mark down all the same, at the corner the
 * press snapped to, opening into a right angle there if it has one, else
 * toward the picture's middle. The corner snaps as 14d's points do; ⌘ (Ctrl)
 * puts it down where the pointer is, and squares nothing.
 *
 * What there is to square to is `rightAngles.ts`'s: a 3D or simulated
 * picture's own lines give none (a projected right angle is not drawn
 * square), so there the corner alone snaps. The mark is drawn into its angle
 * off the vertex (Revision 2), so a press finds the vertex from anywhere over
 * the mark its click would put down, not only near the vertex: the hover's
 * ghost lies under the pointer, and a click there marks that angle.
 *
 * Pure: no DOM, no store.
 */
import { DIAGRAM_RIGHT_ANGLE_INK } from '../../cp-workspace/references/diagram/diagramInk';
import { placePoint, type PlacedPoint, type SnapContext } from './annotateSnap';
import { DEFAULT_RIGHT_ANGLE_DIAGONAL, MIN_ANNOTATION_LENGTH, type PictureFrame, type PicturePoint } from './annotationModel';
import { INK_UNITS } from './canvasInk';
import { pictureSnapTarget } from './pictureSnap';
import { rightAngleCorner, rightAnglesAt, type RightAngleCorner } from './rightAngles';

/**
 * Where a press with the right-angle tool puts the corner, and the way a
 * click there opens the mark: into the right angle the pointer is in, when
 * it is in one (`opens`, and the corner is that angle's vertex); otherwise
 * the corner is the point the press snapped to, and `opens` is null.
 */
export interface RightAngleStart extends PlacedPoint {
  opens: PicturePoint | null;
}

const snapOptions = (context: SnapContext) => ({ annotations: context.annotations, style: context.style });

/**
 * How far past its vertex a right-angle mark is drawn on the canvas, in
 * picture units: its square's far corner, along the diagonal.
 */
export const RIGHT_ANGLE_FOOTPRINT = (DIAGRAM_RIGHT_ANGLE_INK.inset + DIAGRAM_RIGHT_ANGLE_INK.side) * Math.SQRT2 * INK_UNITS;

/**
 * The corner a press at `point` puts a right-angle mark in, and the way it
 * opens if the press was in a right angle (decision 12) — near its vertex,
 * or over the mark a click there puts down ({@link RIGHT_ANGLE_FOOTPRINT}).
 * With snapping off or ⌘ held (`free`), where the pointer is, opening no
 * way yet.
 */
export function placeRightAngle(context: SnapContext, point: PicturePoint, { free }: { free: boolean }): RightAngleStart {
  if (context.enabled && !free && context.radius > 0) {
    const corner = rightAngleCorner(context.step, context.assets, point, context.radius, {
      ...snapOptions(context),
      footprint: RIGHT_ANGLE_FOOTPRINT,
    });
    if (corner) {
      // The vertex, as the snap would report it: a point of the picture, a line's end, a crossing.
      const found = pictureSnapTarget(context.step, context.assets, corner.at, context.radius, snapOptions(context));
      const kind = found && found.at[0] === corner.at[0] && found.at[1] === corner.at[1] ? found.kind : 'vertex';
      return { at: [corner.at[0], corner.at[1]], target: { at: [corner.at[0], corner.at[1]], kind }, opens: corner.diagonal };
    }
  }
  return { ...placePoint(context, point, { free }), opens: null };
}

/**
 * The way a mark whose corner is `corner` opens when it is clicked down
 * rather than dragged: the way the press found (`opens`); else into the
 * right angle at the corner nearest the way toward the picture's middle;
 * else that way itself, held to the nearest diagonal, so the square sits
 * upright.
 */
export function clickedOpening(
  context: SnapContext,
  start: RightAngleStart,
  frame: PictureFrame,
  { free }: { free: boolean }
): PicturePoint {
  if (start.opens) return start.opens;
  return squaredOpening(context, start.at, towardMiddle(start.at, frame), { free });
}

/**
 * The way a mark drawn from `corner` toward `pointer` opens: into the right
 * angle at the corner the pointer is in, when there is one (snapping on, ⌘
 * not held); else toward the pointer, Shift holding it to the nearest 45°.
 * Null while the pointer is nearer the corner than the shortest drag: a
 * click, which opens as {@link clickedOpening} says.
 */
export function draggedOpening(
  context: SnapContext,
  corner: PicturePoint,
  pointer: PicturePoint,
  { free, shift }: { free: boolean; shift: boolean }
): PicturePoint | null {
  const dx = pointer[0] - corner[0];
  const dy = pointer[1] - corner[1];
  const length = Math.hypot(dx, dy);
  if (!(length >= MIN_ANNOTATION_LENGTH)) return null;
  const toward: PicturePoint = [dx / length, dy / length];
  if (context.enabled && !free) {
    const into = rightAnglesAt(context.step, context.assets, corner, snapOptions(context)).find((square) =>
      inside(square, toward)
    );
    if (into) return [into.diagonal[0], into.diagonal[1]];
  }
  return shift ? nearestEighth(toward) : toward;
}

/**
 * The way a mark moved to `corner` opens: into the right angle there whose
 * diagonal is nearest the way it opened, when the corner has one (snapping
 * on, ⌘ not held) — so a mark moved to another corner sits square in it —
 * else as it opened.
 */
export function squaredOpening(
  context: SnapContext,
  corner: PicturePoint,
  opening: PicturePoint,
  { free }: { free: boolean }
): PicturePoint {
  if (!context.enabled || free) return opening;
  let best: PicturePoint | null = null;
  let nearest = -Infinity;
  for (const square of rightAnglesAt(context.step, context.assets, corner, snapOptions(context))) {
    const along = square.diagonal[0] * opening[0] + square.diagonal[1] * opening[1];
    if (along > nearest) {
      nearest = along;
      best = [square.diagonal[0], square.diagonal[1]];
    }
  }
  return best ?? opening;
}

/** Whether a unit direction lies in a right angle's sector: within 45° of its diagonal, a hair over for the edges. */
function inside(square: RightAngleCorner, direction: PicturePoint): boolean {
  return square.diagonal[0] * direction[0] + square.diagonal[1] * direction[1] >= Math.SQRT1_2 - 1e-9;
}

/** A unit direction held to the nearest of the eight 45° ones. */
function nearestEighth([x, y]: PicturePoint): PicturePoint {
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(y, x) / step) * step;
  return [Math.cos(angle), Math.sin(angle)];
}

/**
 * The diagonal from `corner` nearest the way toward the frame's middle — a
 * mark opening into the picture — or the default way, up and to the right,
 * from the middle itself.
 */
export function towardMiddle(corner: PicturePoint, frame: PictureFrame): PicturePoint {
  const dx = frame.width / 2 - corner[0];
  const dy = frame.height / 2 - corner[1];
  if (dx === 0 && dy === 0) return [DEFAULT_RIGHT_ANGLE_DIAGONAL[0], DEFAULT_RIGHT_ANGLE_DIAGONAL[1]];
  // A diagonal's signs: toward the middle on each axis, and on one the middle is level with, the default's.
  const sx = dx === 0 ? Math.sign(DEFAULT_RIGHT_ANGLE_DIAGONAL[0]) : Math.sign(dx);
  const sy = dy === 0 ? Math.sign(DEFAULT_RIGHT_ANGLE_DIAGONAL[1]) : Math.sign(dy);
  return [sx * Math.SQRT1_2, sy * Math.SQRT1_2];
}
