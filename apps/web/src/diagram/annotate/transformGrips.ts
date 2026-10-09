/**
 * The transform box on the Annotate canvas (Diagram Revision 3): a selected
 * star — and the eye and the shapes, as they come — scaled and turned by
 * handles, as an image is on the Edit canvas (Zach, 2026-10-08: "ui should be
 * like the UI when you select an image in the edit canvas").
 *
 * The box's math and its handles' layout are `lib/transformBox.ts`'s, which
 * the Edit canvas draws from too; this is the Diagram's side of it, in
 * picture units: which marks have a box and where it is
 * ({@link transformBoxOf}), which handle a press takes ({@link transformGripAt})
 * and what a drag of one makes of the mark ({@link transformDragged}). The
 * canvas draws the box (`TransformBoxSelection`) and takes the presses
 * (`useAnnotateCanvas`) as it does every other grip.
 *
 * Pure: no DOM, no store, no React.
 */
import {
  DIAGRAM_STAR_INK,
} from '../../cp-workspace/references/diagram/diagramInk';
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  TRANSFORM_HANDLE_SIZE_PX,
  TRANSFORM_ROTATE_HANDLE_RADIUS_PX,
  TRANSFORM_ROTATE_OFFSET_PX,
  TRANSFORM_ROTATION_SNAP_RADIANS,
  boxContainsModelPoint,
  boxCornersModel,
  resizeAnnotationBox,
  snapAngle,
  transformHandles,
  type TransformBox,
  type TransformCorner,
  type TransformHandles,
  type TransformResizeHandle,
  type TransformResizeResult,
} from '../../lib/transformBox';
import {
  glyphAngle,
  glyphAngleOf,
  glyphScaleOf,
  withGlyphAngle,
  withGlyphScale,
  type PicturePoint,
} from './annotationModel';
import { INK_UNITS } from './canvasInk';

/** A transform box's handle a press took hold of: a scale square, or a corner's turn handle. */
export type TransformHandle =
  | { kind: 'scale'; handle: TransformResizeHandle }
  | { kind: 'rotate'; corner: TransformCorner };

/**
 * The smallest a glyph's box is drawn, in screen px (R3-30c B): a 3 mm star
 * at a zoom that draws it smaller still gets a box its four 8 px squares
 * stand clear of, about its centre. The glyph itself is not changed.
 */
export const MIN_GLYPH_BOX_PX = 24;

/**
 * A mark with a transform box, as the box and the Rotation row see it: where
 * the box is, whether it keeps its proportions, its turn, and how a resize
 * and a turn are written back into the mark. Each kind with a box says all
 * of it ({@link boxedMarkOf}), so a kind given one — the eye (18c), shapes
 * (18d), whose box is a `size` and whose turn is within [0, 180) — cannot
 * have a drag or a typed Rotation write another kind's fields.
 */
export interface BoxedMark {
  /** Its box in picture units, at the ink it was asked at. */
  box: TransformBox;
  /** Corners only, and one scale (R3-29a A), as a folded figure's on the Edit canvas (`aspectLock: 'always'`). */
  keepsProportions: boolean;
  /** Its turn in degrees clockwise on the page, as the Rotation row reads it. */
  degrees: number;
  /** The mark with its box, drawn as `drawn`, resized to `next` (picture units), held to its range. */
  resized(drawn: TransformBox, next: TransformResizeResult): KnownDiagramAnnotation;
  /** The mark turned to `degrees` clockwise on the page, as a drag or the Rotation row turns it. */
  turned(degrees: number): KnownDiagramAnnotation;
}

/**
 * A mark as its transform box sees it, at the canvas's ink (`ink`, picture
 * units to one ink); null for a mark that keeps its grips: every other kind.
 * A switch, so a new kind has to say whether it has a box, and a kind that
 * has one, how it is resized and turned.
 */
export function boxedMarkOf(annotation: KnownDiagramAnnotation, ink: number = INK_UNITS): BoxedMark | null {
  switch (annotation.kind) {
    case 'star':
      return boxedStar(annotation, ink);
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'pleat-arrow':
    case 'push-arrow':
    case 'white-arrow':
    case 'turn-over':
    case 'rotate':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
    case 'solid-line':
    case 'label':
    case 'circle':
    case 'right-angle':
    case 'callout':
    case 'angle-mark':
    case 'divisions':
    case 'close-up':
    case 'zoom':
      return null;
  }
}

/**
 * A star's box: the square its tips reach, `scale` times its print size,
 * turned by its own angle. Resized, one `scale` (R3-29a A) by as much as its
 * box grew, held to `GLYPH_SCALE`; turned, its `angle` within
 * [0, 360). Each kept as {@link kept} says.
 */
function boxedStar(annotation: KnownDiagramAnnotation, ink: number): BoxedMark {
  const scale = glyphScaleOf(annotation);
  const degrees = glyphAngleOf(annotation);
  const side = 2 * DIAGRAM_STAR_INK.radius * scale * ink;
  const [x, y] = annotation.from;
  return {
    box: { center: { x, y }, width: side, height: side, rotation: (degrees * Math.PI) / 180 },
    keepsProportions: true,
    degrees,
    resized: (drawn, next) => withGlyphScale(annotation, kept(scale * (next.width / drawn.width), SCALE_PRECISION)),
    // Into [0, 360) before it is kept, so a turn past upright is not written with a wrap's rounding in it.
    turned: (to) => withGlyphAngle(annotation, kept(glyphAngle(to), ANGLE_PRECISION)),
  };
}

/**
 * A mark's transform box in picture units, as it is drawn at the canvas's
 * ink (`ink`, picture units to one ink); null for a mark that keeps its
 * grips ({@link boxedMarkOf}).
 */
export function transformBoxOf(annotation: KnownDiagramAnnotation, ink: number = INK_UNITS): TransformBox | null {
  return boxedMarkOf(annotation, ink)?.box ?? null;
}

/** Whether a mark shows the transform box when it is selected, in place of grips. */
export function hasTransformBox(annotation: KnownDiagramAnnotation): boolean {
  return boxedMarkOf(annotation) !== null;
}

/**
 * A mark's box as the canvas draws it with `px` picture units to one screen
 * px: its own, but a glyph's never under {@link MIN_GLYPH_BOX_PX} across,
 * about its centre (R3-30c B). Null for a mark with no box.
 */
export function drawnTransformBox(annotation: KnownDiagramAnnotation, px: number): TransformBox | null {
  const boxed = boxedMarkOf(annotation);
  if (!boxed || !boxed.keepsProportions) return boxed?.box ?? null;
  const { box } = boxed;
  const floor = MIN_GLYPH_BOX_PX * px;
  return box.width >= floor ? box : { ...box, width: floor, height: floor };
}

/**
 * Where a selected mark's handles are drawn, in picture units, with `px`
 * picture units to one screen px: the box's corners, its scale squares —
 * corners only where it keeps its proportions — and its turn handles
 * {@link TRANSFORM_ROTATE_OFFSET_PX} out from each corner. The layout the
 * Edit canvas draws, from the same code (`transformHandles`).
 */
export function transformBoxHandles(
  annotation: KnownDiagramAnnotation,
  px: number
): { box: TransformBox; corners: [PicturePoint, PicturePoint, PicturePoint, PicturePoint]; handles: TransformHandles } | null {
  const boxed = boxedMarkOf(annotation);
  const box = drawnTransformBox(annotation, px);
  if (!boxed || !box) return null;
  const corners = boxCornersModel(box);
  const handles = transformHandles(corners, { cornersOnly: boxed.keepsProportions, rotateOffset: TRANSFORM_ROTATE_OFFSET_PX * px });
  return { box, corners: corners.map(({ x, y }): PicturePoint => [x, y]) as [PicturePoint, PicturePoint, PicturePoint, PicturePoint], handles };
}

/**
 * Which of a selected mark's handles a press at `point` takes, with `px`
 * picture units to one screen px and `reach` how near a press must be, in
 * picture units (a mouse's or a finger's): the nearest square or turn handle
 * the press is on as it is drawn, or, out from the box, within `reach` of; a
 * square where the two are as near. Inside the box only a handle as drawn
 * takes a press: the glyph is there, and a press on it moves it — a finger's
 * 18 px reach is more than a corner's 17 px from the middle of a box at its
 * 24 px floor, and a mouse's took a star's lower tips (18b review). Null off
 * them, and for a mark with no box.
 */
export function transformGripAt(
  annotation: KnownDiagramAnnotation,
  point: PicturePoint,
  { px, reach }: { px: number; reach: number }
): TransformHandle | null {
  const drawn = transformBoxHandles(annotation, px);
  if (!drawn) return null;
  const outside = !boxContainsModelPoint(drawn.box, { x: point[0], y: point[1] });
  let best: { grip: TransformHandle; distance: number } | null = null;
  const consider = (grip: TransformHandle, at: { x: number; y: number }, onIt: boolean) => {
    const distance = Math.hypot(point[0] - at.x, point[1] - at.y);
    if (!onIt && !(outside && distance <= reach)) return;
    if (best === null || distance < best.distance) best = { grip, distance };
  };
  // A square as it is drawn, upright on the screen; a turn handle, round.
  const half = (TRANSFORM_HANDLE_SIZE_PX / 2) * px;
  for (const { handle, at } of drawn.handles.scale) {
    consider({ kind: 'scale', handle }, at, Math.max(Math.abs(point[0] - at.x), Math.abs(point[1] - at.y)) <= half);
  }
  for (const { corner, at } of drawn.handles.rotate) {
    consider({ kind: 'rotate', corner }, at, Math.hypot(point[0] - at.x, point[1] - at.y) <= TRANSFORM_ROTATE_HANDLE_RADIUS_PX * px);
  }
  return best === null ? null : (best as { grip: TransformHandle }).grip;
}

/** The angle a point makes about a centre, in radians, clockwise on the y-down page. */
function pointerAngle(centre: PicturePoint, point: PicturePoint): number {
  return Math.atan2(point[1] - centre[1], point[0] - centre[0]);
}

/**
 * What a drag of a transform handle makes of the mark it was pressed on, from
 * `start` to `at` in picture units, with `px` picture units to one screen px
 * as the press was made. A scale square resizes its box about its centre,
 * keeping its proportions (R3-29a A, R3-29b A) — a star stays on the point it
 * names — as the square is drawn out by the pointer's travel since it took
 * hold, so a press off the square's middle does not jump the mark (18b
 * review). A turn handle turns it as far as the pointer has turned about its
 * centre since it took hold, and with `shift` to the nearest 15° (R3-28 A).
 * What each writes is the mark's kind's ({@link boxedMarkOf}). The mark as it
 * was where it does not change.
 */
export function transformDragged(
  original: KnownDiagramAnnotation,
  handle: TransformHandle,
  start: PicturePoint,
  at: PicturePoint,
  { px, shift }: { px: number; shift: boolean }
): KnownDiagramAnnotation {
  const boxed = boxedMarkOf(original);
  const drawn = transformBoxHandles(original, px);
  if (!boxed || !drawn) return original;
  const { box } = drawn;
  const centre: PicturePoint = [box.center.x, box.center.y];
  if (handle.kind === 'rotate') {
    const turned = boxed.degrees * (Math.PI / 180) + pointerAngle(centre, at) - pointerAngle(centre, start);
    const angle = shift ? snapAngle(turned, TRANSFORM_ROTATION_SNAP_RADIANS) : turned;
    return boxed.turned((angle * 180) / Math.PI);
  }
  // The square where it is drawn, moved as far as the pointer has; as the box is drawn, so a box at its floor grows by as much as the pointer pulls it.
  const square = drawn.handles.scale.find((each) => each.handle === handle.handle)?.at ?? { x: start[0], y: start[1] };
  const pulled = { x: square.x + at[0] - start[0], y: square.y + at[1] - start[1] };
  return boxed.resized(box, resizeAnnotationBox(box, handle.handle, pulled, boxed.keepsProportions, { aboutCentre: true }));
}

/**
 * What a turn and a scale are kept to, dragged or typed: a hundredth of a
 * degree, as the Rotation row reads it, and a thousandth of the print size —
 * a micron on a 1.5 mm star — so a file is not written to seventeen places
 * (a typed 12.345 comes wrapped as 12.345000000000027), and a drag back to
 * where it began writes what was there.
 */
const ANGLE_PRECISION = 0.01;
const SCALE_PRECISION = 0.001;

function kept(value: number, step: number): number {
  // Written to the step's places, and never as −0.
  return Number((Math.round(value / step) * step).toFixed(6)) + 0;
}
