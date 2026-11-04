/**
 * "Layer order…" on an Edit folded figure (`implementation-plans/layer-order-dialog.md`,
 * row H3): open the Layer order dialog on the fold the figure shows, and
 * commit its Apply as one undo entry.
 *
 * - **On the press, never before.** The fold is read (or, for a figure
 *   reopened from a file, made: `prepareOristudioCpFigureLayerOrder`) only
 *   now, and the dialog's code and its worker only load when it opens
 *   (`layerOrderDialogGateway.ts`). When the fold can't be made, the dialog
 *   still opens, on the source and the record: it restores the record itself
 *   and says why in its own frames. Only an engine that never loaded at all
 *   is a toast, the one the gateway says (`sayLayerOrderUnavailable`).
 * - **One door.** The dialog is reached through its gateway alone, which
 *   answers every open; only `applied` writes an order. `unchanged`,
 *   `cancelled`, `busy` and `unavailable` leave the figure and the history as
 *   they were, but for the dialog's Rotate: an Apply that turned the folded
 *   figure turns the figure on the canvas to match.
 * - **One undo entry.** Apply runs inside the folded layer's bracket, so it
 *   lands as "Set layer order", its turn with it — or, when it only turned
 *   the figure, as "Rotate folded form", the Rotation row's; or as nothing,
 *   when it changed nothing.
 *
 * React-free, as the figure's other verbs are (`foldedFigureVerbs.ts`), so the
 * toolbar, the context menu and the Properties pane run the same one.
 */
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import {
  openLayerOrderDialog,
  prefetchLayerOrderDialog,
  type LayerOrderDialogOutcome,
} from '../../layer-order/dialog/layerOrderDialogGateway';
import { sayLayerOrderUnavailable } from '../../layer-order/engine/layerOrderLoadFailure';
import { EDIT_PAPER_FRAME, layerOrderRecordToSource } from '../../lib/layerOrder/paperFrame';
import type {
  LayerOrderApplied,
  LayerOrderLook,
  LayerOrderRegion,
  LayerOrderRequest,
} from '../../lib/layerOrder/layerOrderRequest';
import { layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import { degreesToRadians, radiansToDegrees, wrapDegrees } from '../../lib/angleUnits';
import {
  DEFAULT_ORISTUDIO_CP_LINE_STYLE,
  DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  type OristudioCpLineStyle,
} from '../../lib/creasePatternViewport';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type {
  OristudioCpFigureLayerOrderOpening,
  OristudioCpFigureLayerOrderRefold,
  WorkspaceState,
} from '../../store/workspaceStore/types';
import { effectiveObjectPaperStyle } from '../paper/objectPaperStyle';
import { layerOrderRegionOfLines } from '../regions/layerOrderRegion';
import { foldedFigureGesture } from './foldedFigureGesture';
import { reselectFoldableLineIds } from './foldedFigureStaleness';
import { foldedFigureLayerOrderDialogRecord } from './foldedFigureLayerOrderState';
import { refoldFoldedFigure } from './foldedFigureVerbs';
import { foldPressMoved, markFoldPress, type FoldPress } from './foldPress';
import { sayLayerOrderPressRefusal } from './layerOrderPressToasts';

/** How a press ended: the dialog's answer, or that it never opened. */
export type FoldedFigureLayerOrderPress = LayerOrderDialogOutcome['kind'] | 'not-opened';

/** Where it was pressed: Layer order… (the toolbar, the menu, the row's Edit…), or the flag's Review… (D14). */
export type FoldedFigureLayerOrderVia = 'edit' | 'review';

/** What the Edit canvas adds to a figure's look: the app's display style, how far the canvas is turned, its creases' pen. */
export interface EditFigureView {
  /** The app's display style: what a figure shows for a field it does not pin. */
  display: PaperStyle;
  /** The Edit camera's view rotation, in radians, clockwise on screen (`renderer/camera.ts`). */
  cameraRotation: number;
  /** The line style and width Edit's view draws creases in (`oristudioCpViewport`). */
  lineStyle: OristudioCpLineStyle;
  lineWidth: number;
}

/** Edit's view of the canvas, as `state` holds it. */
export function editFigureView(state: WorkspaceState): EditFigureView {
  return {
    display: useSettingsStore.getState().paperStyle.display,
    cameraRotation: state.oristudioCpCamera?.rotation ?? 0,
    lineStyle: state.oristudioCpViewport.lineStyle ?? DEFAULT_ORISTUDIO_CP_LINE_STYLE,
    lineWidth: state.oristudioCpViewport.lineWidth ?? DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  };
}

/**
 * What the dialog opens on for `figure`, from the fold its kernel answered
 * (`opening`) and the canvas it is on (`view`):
 *
 * - **the source** that fold folded, with the model the figure folds with;
 * - **its record**, its points in the crease pattern's coordinates (Edit's
 *   frame is the crease pattern's own);
 * - **Edit's look** (approach 3, D18): the figure's effective paper style
 *   (`effectiveObjectPaperStyle`), read through the flat figure's policy;
 *   on the side the figure shows, turned as the canvas shows it — the
 *   figure's own rotation and the canvas's — with X-ray on when the figure
 *   is drawn see-through (Transparent3), and the creases in Edit's line
 *   style and width;
 * - **what it shows** (`shown`), so the dialog opens on the order on the
 *   canvas (D19); left out when no fold could show it, and the dialog
 *   restores the record itself;
 * - **the figure's name**, and the surface for the dialog's analytics;
 * - **that its Apply also refolds it** (`applyRefolds`), when its creases
 *   changed since the fold and the source is them as they are now (D12);
 * - **the sheet it was folded from** (`region`, {@link foldedFigureRegion}),
 *   which the crease-pattern pane shows alone.
 */
export function foldedFigureLayerOrderRequest(
  figure: OristudioCpFoldedFigureEntry,
  opening: Extract<OristudioCpFigureLayerOrderOpening, { status: 'ready' }>,
  view: EditFigureView,
  region: LayerOrderRegion | null = null
): LayerOrderRequest {
  // Its own, or one a reload detached, shown for review (never folded with).
  const record = foldedFigureLayerOrderDialogRecord(figure);
  return {
    surface: 'edit_figure',
    source: layerOrderSourceOf(opening.source, opening.model),
    ...(region ? { region } : {}),
    record: record ? layerOrderRecordToSource(record, EDIT_PAPER_FRAME) : null,
    look: editFigureLook(view, {
      style: effectiveObjectPaperStyle(figure, view.display),
      rotation: figure.placement.rotation,
      model: figure.snapshot?.model ?? opening.model,
      xray: figure.displayStyle === 'Transparent3',
    }),
    ...(opening.shown ? { shown: opening.shown } : {}),
    name: figure.title,
    // Opened on creases that changed since the fold: its Apply refolds it too (D12).
    ...(opening.refold ? { applyRefolds: true } : {}),
  };
}

/**
 * The sheet figure `figure` was folded from, in `document`: the one holding
 * the creases its refold would fold, reselected from its provenance box as
 * the opening reselects them (`reselectFoldableLineIds`), or the ids it
 * folded for a figure from before boxes. Null when they lie on no one sheet.
 */
export function foldedFigureRegion(
  document: OristudioCpDocumentSnapshot | null | undefined,
  figure: Pick<OristudioCpFoldedFigureEntry, 'sourceBounds' | 'sourceLineIds'>
): Promise<LayerOrderRegion | null> {
  if (!document) return Promise.resolve(null);
  const lineIds = figure.sourceBounds
    ? reselectFoldableLineIds(document, figure.sourceBounds)
    : (figure.sourceLineIds ?? []);
  return layerOrderRegionOfLines(document, lineIds);
}

/**
 * Edit's look for a flat figure on the canvas `view` (D18): drawn in `style`
 * through the flat figure's policy, on the side its `model` shows, turned by
 * its own `rotation` and the canvas's, see-through when `xray`, its creases in
 * Edit's line style and width. A figure "Layer order…" opens on, or the one
 * "Fold with layer order…" will make.
 */
export function editFigureLook(
  view: EditFigureView,
  figure: { style: PaperStyle; rotation: number; model: Pick<OristudioCpFoldedFigureModel, 'state'>; xray: boolean }
): LayerOrderLook {
  return {
    style: figure.style,
    policy: PAPER_STYLE_POLICIES['folded-flat'],
    // Both turn the paper clockwise on screen by their angle, as a Diagram
    // step's `rotationDeg` does: the figure on the canvas, the canvas on the screen.
    turnDeg: wrapDegrees(radiansToDegrees(figure.rotation + view.cameraRotation)),
    // The kernel's back pass; Both and Transparent are views of the front.
    side: figure.model.state === 'Back1' ? 'back' : 'front',
    xray: figure.xray,
    lineStyle: view.lineStyle,
    lineWidth: view.lineWidth,
  };
}

/**
 * The figure rotation, radians, that shows a figure turned `turnDeg`
 * clockwise on screen on a canvas turned `cameraRotation`: the look's turn
 * ({@link editFigureLook}) solved for the figure's own.
 */
export function figureRotationForTurn(turnDeg: number, cameraRotation: number): number {
  return degreesToRadians(turnDeg) - cameraRotation;
}

/**
 * Turn figure `id` to the dialog's `turnDeg` on Edit's canvas as it is now
 * (Rotate in the Layer order dialog), with no undo entry of its own: the
 * caller's bracket takes it. Whether the figure was there to turn.
 */
export function turnFoldedFigureTo(id: string, turnDeg: number): boolean {
  const state = useWorkspaceStore.getState();
  if (!state.oristudioCpFoldedFigures.some((figure) => figure.id === id)) return false;
  const rotation = figureRotationForTurn(turnDeg, editFigureView(state).cameraRotation);
  state.setOristudioCpFoldedFigurePlacement(id, { rotation });
  return true;
}

/**
 * Open the Layer order dialog on figure `id`, and commit its Apply. Answers
 * how the press ended; every way but `applied` leaves the figure as it was.
 */
export async function openFoldedFigureLayerOrder(
  id: string,
  t: TFunction,
  { via = 'edit' }: { via?: FoldedFigureLayerOrderVia } = {}
): Promise<FoldedFigureLayerOrderPress> {
  const store = useWorkspaceStore;
  const figure = store.getState().oristudioCpFoldedFigures.find((entry) => entry.id === id);
  if (!figure) return 'not-opened';
  // What the press found open: Apply writes only onto the same document's figure (`foldPress.ts`).
  const press = markFoldPress(store.getState());
  // The dialog's code, while the fold is read or made: loads, never spawns.
  prefetchLayerOrderDialog();
  const opening = await store.getState().prepareOristudioCpFigureLayerOrder(id);
  if (opening.status !== 'ready') {
    // An engine that never loaded is said once, as the dialog's gateway says
    // it, an error; a kernel failure has said itself, an error too. Every
    // other way out is no fault, and is a message or nothing.
    if (opening.reason === 'unavailable') sayLayerOrderUnavailable(t);
    // Its creases changed, and fold in 3D now: there is no flat order to open on (D13).
    if (opening.reason === 'spatial') {
      toast.message(
        t(
          'toasts:layerOrder.folds3d',
          'This figure’s creases fold in 3D now, and layer order works on flat folds. Refold it to see it.'
        )
      );
    }
    return 'not-opened';
  }
  try {
    // The crease pattern it came from, out of however many the canvas holds.
    const region = await foldedFigureRegion(store.getState().oristudioCpDocument?.document, figure);
    const state = store.getState();
    // A crease edited or another document opened while the fold was read or
    // made: its Apply would be refused, so the dialog does not open.
    if (foldPressMoved(press, state)) {
      sayLayerOrderPressRefusal('moved', t);
      return 'not-opened';
    }
    const shown = state.oristudioCpFoldedFigures.find((entry) => entry.id === id) ?? figure;
    const request = foldedFigureLayerOrderRequest(shown, opening, editFigureView(state), region);
    // From the flag's Review…: the dialog opens on the rows that need attention (D14).
    const outcome = await openLayerOrderDialog(via === 'review' ? { ...request, review: true } : request);
    if (outcome.kind === 'applied') {
      await applyFoldedFigureLayerOrder(id, outcome.applied, press, t, opening.refold, outcome.turnDeg);
    }
    // A stale figure with no record, its Apply untouched: the order a plain
    // Refold draws (the dialog opened on it), so the Apply is that Refold (D12),
    // on the crease pattern the press found, as any Apply.
    if (outcome.kind === 'unchanged' && opening.refold && request.record === null) {
      if (foldPressMoved(press, store.getState())) sayLayerOrderPressRefusal('moved', t);
      else await refoldFoldedFigure(id, t);
    }
    // Only turned: the turn is the Apply's one entry, as the Rotation row's is (a refold before it has its own).
    if (outcome.kind === 'unchanged' && outcome.turnDeg !== undefined) {
      await turnFoldedFigureAsEntry(id, outcome.turnDeg, press, t);
    }
    return outcome.kind;
  } finally {
    await opening.release();
  }
}

/**
 * Commit an Apply on figure `id` as one undo entry, "Set layer order": a new
 * fold with the chosen order, the fold before kept by the entry, so an undo
 * shows the order it draws. The bracket holds that fold until the entry has
 * taken it (`foldedFigureGesture.ts`). Nothing, and why, when the crease
 * pattern changed or was replaced since `press`. With `refold`, the dialog
 * was opened on creases that changed since the fold (D12), and the one
 * entry is the figure's refold too: "Refold with layer order". With
 * `turnDeg`, the dialog's Rotate turned it: the figure lands turned so, in
 * the same entry.
 */
export async function applyFoldedFigureLayerOrder(
  id: string,
  applied: LayerOrderApplied,
  press: FoldPress,
  t: TFunction,
  refold?: OristudioCpFigureLayerOrderRefold,
  turnDeg?: number
): Promise<boolean> {
  const done = await foldedFigureGesture.run(
    'verb',
    refold
      ? t('panels:creasePattern.refoldWithLayerOrderAction', 'Refold with layer order')
      : t('panels:creasePattern.setLayerOrderAction', 'Set layer order'),
    async () => {
      const landed = await useWorkspaceStore
        .getState()
        .applyOristudioCpFigureLayerOrder(id, applied, press, refold ? { refold } : undefined);
      if (landed && turnDeg !== undefined) turnFoldedFigureTo(id, turnDeg);
      return landed;
    }
  );
  // Refused because the creases moved since the press: no fault, so a message.
  if (done === false && foldPressMoved(press, useWorkspaceStore.getState())) sayLayerOrderPressRefusal('moved', t);
  return done === true;
}

/**
 * An Apply that only turned figure `id` (`unchanged` with a turn): one undo
 * entry, "Rotate folded form", as the Rotation row's. Nothing, and why, when
 * the crease pattern changed or was replaced since `press`, as any Apply.
 */
export async function turnFoldedFigureAsEntry(id: string, turnDeg: number, press: FoldPress, t: TFunction): Promise<boolean> {
  if (foldPressMoved(press, useWorkspaceStore.getState())) {
    sayLayerOrderPressRefusal('moved', t);
    return false;
  }
  const done = await foldedFigureGesture.run(
    'verb',
    t('panels:creasePattern.rotateFoldedForm', 'Rotate folded form'),
    async () => turnFoldedFigureTo(id, turnDeg)
  );
  return done === true;
}
