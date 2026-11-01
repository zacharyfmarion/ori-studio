/**
 * What a press on the Layer order dialog's panes takes, and the events the
 * panes send for it (`implementation-plans/layer-order-dialog.md`, row U8;
 * D6's tap equivalents).
 *
 * - **A hit** is a face: on the crease pattern, the face whose ring holds the
 *   point; on the folded paper, the face on top of the spot under it, in the
 *   order on screen (the stack hit index, `stackHitIndex.ts`). Off the paper,
 *   none.
 * - **The events** carry the face, the pane it came from (the inspector
 *   model's pick origin, `pattern` or `folded`) and how it came: by a
 *   pointer, or a finger's tap. A tap has no hover before it, so its
 *   inspector stands the tap in for both: it shows the face's hint and picks
 *   it (D6). Inert faces are picked too; what a pick does with one is the
 *   inspector's.
 * - **A double tap fits** both panes (D6, `Round4-Phone`): a second tap soon
 *   after and near the first is the fit, and picks nothing; the first one
 *   has already picked.
 *
 * Pure: no React, no store, no engine.
 */
import type { LayerFace } from '../engine/faceIndex';

/** A pane, by the pick origin the inspector model records. */
export type LayerPaneId = 'pattern' | 'folded';

/** How a pick or a hover came: a mouse or a pen's pointer, or a finger. */
export type LayerPaneInput = 'pointer' | 'tap';

/** What a press on a pane takes. */
export interface LayerPaneHit {
  readonly pane: LayerPaneId;
  readonly face: LayerFace;
  /** The spot it was taken on, on the folded paper; null on the crease pattern. */
  readonly spot: number | null;
}

export function sameLayerPaneHit(a: LayerPaneHit, b: LayerPaneHit): boolean {
  return a.pane === b.pane && a.face === b.face && a.spot === b.spot;
}

/** A face picked on a pane. */
export interface LayerPaneFacePick {
  readonly face: LayerFace;
  readonly origin: LayerPaneId;
  readonly input: LayerPaneInput;
}

/** The face under the pointer, or a finger, on a pane: null once there is none. */
export interface LayerPaneFaceHover {
  readonly face: LayerFace | null;
  readonly origin: LayerPaneId;
  readonly input: LayerPaneInput;
}

/** A click or a tap on a pane where there is no paper. */
export interface LayerPaneGroundPick {
  readonly origin: LayerPaneId;
  readonly input: LayerPaneInput;
}

/** What the panes tell the inspector: U10 dispatches each to its model. */
export interface LayerPanesEvents {
  readonly onFacePicked?: (pick: LayerPaneFacePick) => void;
  readonly onFaceHovered?: (hover: LayerPaneFaceHover) => void;
  readonly onEmptyPaper?: (pick: LayerPaneGroundPick) => void;
  /** The flash `n` has faded (1.6 s after it began). */
  readonly onFlashEnded?: (n: number) => void;
  /**
   * The faces on offer `pane` leaves unlettered at its zoom, since no chip of
   * theirs fits (D7's addition), ascending: told when they change, so the hint
   * can say to zoom in.
   */
  readonly onUnlettered?: (pane: LayerPaneId, faces: readonly LayerFace[]) => void;
  /**
   * The folded pane's Rotate Left or Right: 15° anticlockwise or clockwise as
   * seen. Left out, the folded pane's bar offers no Rotate.
   */
  readonly onTurn?: (direction: 'left' | 'right') => void;
}

/** A pointer type as the events name it: a finger taps; a mouse and a pen point. */
export function paneInputOf(pointerType: string): LayerPaneInput {
  return pointerType === 'touch' ? 'tap' : 'pointer';
}

/** One tap's end: when and where, page px. */
export interface LayerPaneTap {
  readonly at: number;
  readonly x: number;
  readonly y: number;
}

/** The longest gap between two taps of a double tap, ms. */
export const DOUBLE_TAP_MS = 300;
/** The farthest apart two taps of a double tap land, CSS px. */
export const DOUBLE_TAP_SLOP_PX = 24;

/** Whether `next` makes a double tap with `previous`. */
export function isDoubleTap(previous: LayerPaneTap | null, next: LayerPaneTap): boolean {
  if (!previous) return false;
  const gap = next.at - previous.at;
  return gap >= 0 && gap <= DOUBLE_TAP_MS && Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_SLOP_PX;
}

/** The flash's one fade, ms (Round3:172-176). */
export const LAYER_PANE_FLASH_MS = 1600;
