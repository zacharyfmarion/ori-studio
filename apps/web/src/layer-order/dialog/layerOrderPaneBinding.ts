/**
 * The inspector's model in the panes' terms (`implementation-plans/layer-order-dialog.md`,
 * row U10): what U8's `LayerOrderPanes` is handed — the view, the faces
 * marked by role, the order to draw — read from U9's selectors
 * (`model/layerOrderSelectors.ts`). The panes know nothing of the sentence or
 * the list; this is where the model's roles become theirs.
 *
 * - **What follows the pointer** is a face pointed at on a pane, or a builder
 *   slot's or a constraint row's faces: the slot's (every picked object, for
 *   the object slot) and the row's light as a row's do, the face under the
 *   pointer as the one pointed at.
 * - **Undecided** spots are read only while the view's switch is on: on a
 *   large figure they are a walk over every spot.
 * - **D19:** the face the host's order puts inside a fold lights as a row's
 *   faces do, and the fold's crease along its line, while nothing else is
 *   lit or while the notice is pointed at.
 *
 * Pure: no React, no store, no engine.
 */
import type { LayerFace } from '../engine/faceIndex';
import type { LayerSidesStacks } from '../model/layerOrderEngineFacts';
import { displayedStacks, openNotice, openSpotsOf, paneMarks } from '../model/layerOrderSelectors';
import type { LayerOrderDialogState, LayerView } from '../model/layerOrderState';
import type { LayerFaceMarks, LayerPanesView } from '../panes/layerPaneMarks';

const NO_FACES: readonly LayerFace[] = [];
const NO_SPOTS = { front: [], back: [] } as const;

/** The panes' view: the model's side, X-ray and turn, and its Undecided switch. */
export function layerOrderPanesView(view: LayerView): LayerPanesView {
  return { side: view.side, xray: view.xray, undecided: view.openSpots, turnDeg: view.turnDeg };
}

/** The face D19's notice names, lit while nothing else is: the one the host's order puts inside a fold. */
export function noticeFaces(state: LayerOrderDialogState): readonly LayerFace[] {
  const notice = openNotice(state);
  if (notice?.key !== 'host_order_cant_fold' || notice.face === null) return NO_FACES;
  return [notice.face];
}

/** The crease D19's notice names, as the two faces it joins: lit with its face. */
export function noticeCrease(state: LayerOrderDialogState): readonly [LayerFace, LayerFace] | null {
  const notice = openNotice(state);
  return notice?.key === 'host_order_cant_fold' ? notice.crease : null;
}

/**
 * The faces the panes mark, by role, for `state`. `noticeLit` is whether the
 * D19 notice is pointed at, which lights its faces whatever else is marked.
 */
export function layerOrderFaceMarks(state: LayerOrderDialogState, noticeLit = false): LayerFaceMarks {
  const marks = paneMarks(state);
  const { hover } = state;
  const slotLit = hover.slot !== null ? marks.lit : NO_FACES;
  const pointed = hover.slot === null && hover.row === null ? (marks.lit[0] ?? null) : null;
  const quiet =
    state.sentence.subject === null && hover.face === null && hover.row === null && hover.slot === null && marks.danger.length === 0;
  const noticeShown = noticeLit || quiet;
  const notice = noticeShown ? noticeFaces(state) : NO_FACES;
  const row = Array.from(new Set([...marks.rowFaces, ...slotLit, ...notice]));
  return {
    picking: marks.active,
    pickable: marks.pickable,
    subject: marks.subject,
    objects: marks.picked,
    pointed,
    row,
    clash: marks.danger,
    clashStrong: marks.dangerStrong,
    changed: marks.changed,
    flash: marks.flash,
    undecided: state.view.openSpots ? { front: openSpotsOf(state, 'front'), back: openSpotsOf(state, 'back') } : NO_SPOTS,
    crease: noticeShown ? noticeCrease(state) : null,
  };
}

/** The order the folded pane draws: a fitting preview's, else the order on screen; null before the open. */
export function layerOrderPanesStacks(state: LayerOrderDialogState): LayerSidesStacks | null {
  return displayedStacks(state);
}
