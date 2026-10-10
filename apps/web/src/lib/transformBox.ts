/**
 * A turned, centred box and the handles that scale and turn it: the pure part
 * of a selected object's transform box, shared by the Edit canvas's objects
 * (reference images, text boxes, suppression regions and folded figures,
 * `cp-workspace/CanvasObjectOverlay.tsx`) and the Diagram's stars, eyes and
 * shapes (`diagram/annotate/transformGrips.ts`), so the two canvases cannot
 * drift apart.
 *
 * It knows no camera and no crease pattern: everything is in one space, the
 * object's own. Each canvas projects it, draws its own chrome from
 * {@link transformHandles}, and takes its own presses.
 *
 * Kept DOM-free so it is unit-testable.
 */
import { TOUCH_TARGET_PX } from '../platform/pointerSurface';

export interface Vec2 {
  x: number;
  y: number;
}

/** A rotated, centred box — the transform shared by every manipulable object. */
export interface TransformBox {
  center: Vec2;
  width: number;
  height: number;
  rotation: number;
}

/** The eight resize handles, by compass position on the (unrotated) box. */
export type TransformResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** The four corners, where a scale handle and a turn handle each sit. */
export type TransformCorner = 'nw' | 'ne' | 'se' | 'sw';

/** The four corner handles — the only ones offered for aspect-locked objects. */
export const CORNER_RESIZE_HANDLES: readonly TransformResizeHandle[] = ['nw', 'ne', 'se', 'sw'];

/** Local-axis signs of a handle's dragged point: 0 = that axis is fixed (edge). */
export const HANDLE_SIGNS: Record<TransformResizeHandle, { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }> = {
  nw: { sx: -1, sy: -1 },
  n: { sx: 0, sy: -1 },
  ne: { sx: 1, sy: -1 },
  e: { sx: 1, sy: 0 },
  se: { sx: 1, sy: 1 },
  s: { sx: 0, sy: 1 },
  sw: { sx: -1, sy: 1 },
  w: { sx: -1, sy: 0 },
};

/** Minimum extent (object units) so a resize can't collapse the box. */
export const MIN_BOX_EXTENT = 1e-4;

/** A scale handle's square, in screen px. */
export const TRANSFORM_HANDLE_SIZE_PX = 8;
/** A turn handle's radius, in screen px: a square's half and one more. */
export const TRANSFORM_ROTATE_HANDLE_RADIUS_PX = TRANSFORM_HANDLE_SIZE_PX / 2 + 1;
/** How far out from each corner a turn handle sits, along the line from the centre, in screen px. */
export const TRANSFORM_ROTATE_OFFSET_PX = 18;
/** The width of the box's outline and of each handle's stroke, in screen px. */
export const TRANSFORM_STROKE_PX = 1.5;
/** The step Shift holds a turn to: 15°. */
export const TRANSFORM_ROTATION_SNAP_RADIANS = Math.PI / 12;

/** A box's handles as one kind of pointer needs them, in screen px. */
export interface TransformHandleSizes {
  /** A scale square's side. */
  square: number;
  /** A turn handle's radius. */
  turnRadius: number;
  /** How far out from each corner its turn handle sits, along the line from the box's middle. */
  rotateOffset: number;
  /**
   * The radius of the round target round each handle, out from the box, where
   * a press takes the handle though it misses it as drawn; 0 where only the
   * handle as drawn does. Never inside the box: the object is there, and a
   * press on it moves it.
   */
  target: number;
}

/**
 * The handles for a mouse and for a finger (Diagram Revision 3, 18d
 * follow-up). A mouse's are the Edit canvas's from before the box was
 * shared, unchanged. A finger's are sized by the app's touch target
 * ({@link TOUCH_TARGET_PX}, `--touch-target`), as every control is on a
 * coarse pointer: each handle takes a press within half a target of it, and
 * a turn handle sits a whole target out from its corner, so the two targets
 * meet and never overlap — a finger a little wide of a corner takes the
 * square, where 18 px apart it took the turn. Drawn half as large again, as
 * Edit Path's nodes are for a finger.
 */
export const TRANSFORM_HANDLE_SIZES: { readonly fine: TransformHandleSizes; readonly coarse: TransformHandleSizes } = {
  fine: {
    square: TRANSFORM_HANDLE_SIZE_PX,
    turnRadius: TRANSFORM_ROTATE_HANDLE_RADIUS_PX,
    rotateOffset: TRANSFORM_ROTATE_OFFSET_PX,
    target: 0,
  },
  coarse: { square: 12, turnRadius: 12 / 2 + 1, rotateOffset: TOUCH_TARGET_PX, target: TOUCH_TARGET_PX / 2 },
};

/** The handles for the pointer in hand: a finger's on a coarse pointer, else a mouse's. */
export function transformHandleSizes(coarse: boolean): TransformHandleSizes {
  return coarse ? TRANSFORM_HANDLE_SIZES.coarse : TRANSFORM_HANDLE_SIZES.fine;
}

export interface TransformResizeResult {
  center: Vec2;
  width: number;
  height: number;
}

/**
 * The four corners of a rotated, centred box in object space, in order
 * TL, TR, BR, BL (in the box's local frame, before rotation).
 */
export function boxCornersModel(box: TransformBox): [Vec2, Vec2, Vec2, Vec2] {
  const hw = box.width / 2;
  const hh = box.height / 2;
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const corner = (dx: number, dy: number): Vec2 => ({
    x: box.center.x + dx * cos - dy * sin,
    y: box.center.y + dx * sin + dy * cos,
  });
  return [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
}

/** How a resize is held: the opposite corner or edge (the default), or the box's centre. */
export interface ResizeOptions {
  /**
   * Scale about the centre: the dragged handle moves and the opposite one
   * moves as far the other way, so the centre stays put. A star or an eye on
   * the Diagram, which names the point it sits on (R3-29b A), and a shape with
   * Alt (R3-29c A). The Edit canvas never passes it.
   */
  aboutCentre?: boolean;
  /**
   * The range each side is held to as the drag goes, the held corner or edge
   * staying put — a box kept in its proportions held as a whole while it can
   * be — in place of {@link MIN_BOX_EXTENT} alone: a Diagram shape's
   * (R3-30b A). The Edit canvas never passes it.
   */
  sides?: { min: number; max: number };
}

/**
 * Resize a box by dragging one of its eight handles to `pointerModel`, keeping
 * the opposite corner/edge anchored — or, with `aboutCentre`, the centre.
 * Pure — returns the new centre + extent.
 *
 * With `aspectLock` the box keeps its proportions: a corner drag takes the
 * larger of the two axis ratios, and an *edge* drag scales both axes from the
 * one axis it controls. (Before aspect lock became the default for images, edge
 * handles ignored the flag entirely, which read as the lock silently failing.)
 */
export function resizeAnnotationBox(
  box: TransformBox,
  handle: TransformResizeHandle,
  pointerModel: Vec2,
  aspectLock = false,
  { aboutCentre = false, sides }: ResizeOptions = {}
): TransformResizeResult {
  const { sx, sy } = HANDLE_SIGNS[handle];
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const u: Vec2 = { x: cos, y: sin }; // local +x (right) in object space
  const v: Vec2 = { x: -sin, y: cos }; // local +y (down) in object space
  const hw = box.width / 2;
  const hh = box.height / 2;

  // Anchor = the opposite corner/edge, fixed during the drag; or the centre.
  const anchorLocalX = aboutCentre ? 0 : -sx * hw;
  const anchorLocalY = aboutCentre ? 0 : -sy * hh;
  const anchor: Vec2 = {
    x: box.center.x + u.x * anchorLocalX + v.x * anchorLocalY,
    y: box.center.y + u.y * anchorLocalX + v.y * anchorLocalY,
  };
  const dx = pointerModel.x - anchor.x;
  const dy = pointerModel.y - anchor.y;
  // Extent along each local axis; about the centre the pointer sets half of it.
  const reach = aboutCentre ? 2 : 1;
  const du = (dx * u.x + dy * u.y) * reach;
  const dv = (dx * v.x + dy * v.y) * reach;

  let width = sx !== 0 ? Math.abs(du) : box.width;
  let height = sy !== 0 ? Math.abs(dv) : box.height;

  if (aspectLock) {
    // The scale factor comes from whichever axes the handle actually drives:
    // both for a corner, the single controlled axis for an edge.
    const ratios: number[] = [];
    if (sx !== 0 && box.width > 0) ratios.push(Math.abs(du) / box.width);
    if (sy !== 0 && box.height > 0) ratios.push(Math.abs(dv) / box.height);
    if (ratios.length > 0) {
      let scale = Math.max(...ratios);
      if (sides && box.width > 0 && box.height > 0) {
        // Held as a whole, so it keeps its proportions, where its range allows both sides one scale.
        const least = Math.max(sides.min / box.width, sides.min / box.height);
        const most = Math.min(sides.max / box.width, sides.max / box.height);
        if (least <= most) scale = Math.min(most, Math.max(least, scale));
      }
      width = box.width * scale;
      height = box.height * scale;
    }
  }

  const [least, most] = sides ? [Math.max(sides.min, MIN_BOX_EXTENT), sides.max] : [MIN_BOX_EXTENT, Infinity];
  width = Math.min(most, Math.max(width, least));
  height = Math.min(most, Math.max(height, least));

  if (aboutCentre) return { center: { x: box.center.x, y: box.center.y }, width, height };

  // The centre sits half the new extent from the anchor along the drag direction
  // on active axes. Under aspect lock an edge handle also changes the *passive*
  // axis, and that growth is shared either side of the anchor — the anchored
  // edge stays put, so the centre shifts by half the passive delta.
  const signU = du >= 0 ? 1 : -1;
  const signV = dv >= 0 ? 1 : -1;
  const offX = sx !== 0 ? (signU * width) / 2 : 0;
  const offY = sy !== 0 ? (signV * height) / 2 : 0;
  return {
    center: {
      x: anchor.x + u.x * offX + v.x * offY,
      y: anchor.y + u.y * offX + v.y * offY,
    },
    width,
    height,
  };
}

/**
 * How an object's resize treats its aspect ratio, and whether Shift escapes it.
 *
 * - `always` — proportional, no escape. A folded figure has no meaningful
 *   non-uniform scale (its placement carries a single scalar), so stretching it
 *   is not a thing the model can express.
 * - `default-on` — proportional, Shift frees it. Reference images: distorting a
 *   photo is the rare intent, so it costs a modifier.
 * - `default-off` — free, Shift locks it. Text boxes: the content reflows to the
 *   width, so dragging width and height independently is the normal intent.
 */
export type AspectLockPolicy = 'always' | 'default-on' | 'default-off';

/** Resolve whether a resize should keep proportions, given the live modifier. */
export function resizeAspectLock(policy: AspectLockPolicy, shiftKey: boolean): boolean {
  switch (policy) {
    case 'always':
      return true;
    case 'default-on':
      return !shiftKey;
    case 'default-off':
      return shiftKey;
  }
}

/** Snap an angle (radians) to the nearest multiple of `step` radians. */
export function snapAngle(angle: number, step: number): number {
  return Math.round(angle / step) * step;
}

/**
 * How far `model` lies from the box's rotated rectangle, in model units: 0
 * on or inside it, else the straight distance to its nearest edge or corner.
 */
export function boxDistanceModel(box: TransformBox, model: Vec2): number {
  // Transform the point into the box's local (unrotated, centred) frame.
  const dx = model.x - box.center.x;
  const dy = model.y - box.center.y;
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const outX = Math.max(0, Math.abs(dx * cos + dy * sin) - box.width / 2);
  const outY = Math.max(0, Math.abs(-dx * sin + dy * cos) - box.height / 2);
  return Math.hypot(outX, outY);
}

/** True if `model` lies inside the box's rotated rectangle. */
export function boxContainsModelPoint(box: TransformBox, model: Vec2): boolean {
  return boxDistanceModel(box, model) === 0;
}

/** Where a selected box's handles sit: its scale squares, and a turn handle out from each corner. */
export interface TransformHandles {
  /** The scale squares' centres: eight, nw round to w, or the four corners only. */
  scale: { handle: TransformResizeHandle; at: Vec2 }[];
  /** The turn handles' centres, one out from each corner, nw, ne, se, sw. */
  rotate: { corner: TransformCorner; at: Vec2 }[];
}

/**
 * The handles of a box whose corners, TL, TR, BR and BL as
 * {@link boxCornersModel} gives them, are drawn at `corners` — in whatever
 * space the canvas draws its chrome in, so a box seen through a flipped or
 * stretched camera keeps its handles on its drawn corners and edges. A scale
 * square at each corner and at each edge's middle, or, with `cornersOnly`, at
 * the corners alone; a turn handle `rotateOffset` out from each corner along
 * the line from the box's middle, "Affinity-style". The one place the layout
 * is decided: the Edit canvas's `SelectionHandles` and the Diagram's
 * `TransformBoxSelection` both draw from it.
 */
export function transformHandles(
  corners: readonly Vec2[],
  { cornersOnly, rotateOffset }: { cornersOnly: boolean; rotateOffset: number }
): TransformHandles {
  const [tl, tr, br, bl] = corners as readonly [Vec2, Vec2, Vec2, Vec2];
  const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const center = { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 };
  const all: TransformHandles['scale'] = [
    { handle: 'nw', at: tl },
    { handle: 'n', at: mid(tl, tr) },
    { handle: 'ne', at: tr },
    { handle: 'e', at: mid(tr, br) },
    { handle: 'se', at: br },
    { handle: 's', at: mid(br, bl) },
    { handle: 'sw', at: bl },
    { handle: 'w', at: mid(bl, tl) },
  ];
  const scale = cornersOnly ? all.filter((point) => CORNER_RESIZE_HANDLES.includes(point.handle)) : all;
  const outward = (corner: Vec2): Vec2 => {
    const dx = corner.x - center.x;
    const dy = corner.y - center.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: corner.x + (dx / len) * rotateOffset, y: corner.y + (dy / len) * rotateOffset };
  };
  const rotate: TransformHandles['rotate'] = [
    { corner: 'nw', at: outward(tl) },
    { corner: 'ne', at: outward(tr) },
    { corner: 'se', at: outward(br) },
    { corner: 'sw', at: outward(bl) },
  ];
  return { scale, rotate };
}

/** A box's handle a press took hold of: a scale square, or a corner's turn handle. */
export type TransformHandleHit = { kind: 'scale'; handle: TransformResizeHandle } | { kind: 'rotate'; corner: TransformCorner };

/**
 * Which of a box's handles, laid out at `handles` and drawn at `sizes`, a
 * press at `at` takes — in the space the handles are laid out in, with `px`
 * of it to one screen px: the nearest one the press is on as drawn (a square
 * upright on the screen, a turn handle round), or, with the press outside the
 * box, the nearest within its target ({@link TransformHandleSizes.target}) or
 * the pointer's `reach`, whichever is further; a square where a square and a
 * turn handle are as near. Inside the box only a handle as drawn takes a
 * press: the object is there. Null off them all. The one rule both canvases
 * press by: the Diagram's `transformGripAt`, and the Edit canvas's touch
 * targets.
 */
export function transformHandleAt(
  handles: TransformHandles,
  at: Vec2,
  { sizes, inside, px = 1, reach = 0 }: { sizes: TransformHandleSizes; inside: boolean; px?: number; reach?: number }
): TransformHandleHit | null {
  const outward = Math.max(reach, sizes.target * px);
  let best: { hit: TransformHandleHit; distance: number } | null = null;
  const consider = (hit: TransformHandleHit, centre: Vec2, onIt: boolean) => {
    const distance = Math.hypot(at.x - centre.x, at.y - centre.y);
    if (!onIt && (inside || distance > outward)) return;
    if (best === null || distance < best.distance) best = { hit, distance };
  };
  const half = (sizes.square / 2) * px;
  for (const { handle, at: centre } of handles.scale) {
    consider({ kind: 'scale', handle }, centre, Math.max(Math.abs(at.x - centre.x), Math.abs(at.y - centre.y)) <= half);
  }
  for (const { corner, at: centre } of handles.rotate) {
    consider({ kind: 'rotate', corner }, centre, Math.hypot(at.x - centre.x, at.y - centre.y) <= sizes.turnRadius * px);
  }
  return best === null ? null : (best as { hit: TransformHandleHit }).hit;
}
