/**
 * The Layer order dialog on a Diagram step
 * (`implementation-plans/layer-order-dialog.md`, row H7): the Step pane's
 * Edit… and the Picture section's Review… (D14) open it on the step's flat
 * fold — Review… on the one a step shown another way would show — and an
 * Apply commits the order it hands back, as one undo step.
 *
 * - **Opening is a user action**, so it may fold (approach 5): the step's
 *   creases are folded as a capture folds them, as a visible, stoppable run,
 *   for what the dialog analyses — the source the kernel folded, and the
 *   paper scene it draws — and the figure is freed. Nothing is folded on
 *   render or selection; what the pane shows at rest is the record's.
 * - **The request** is the step's: its source, its sheet (the pattern the
 *   crease-pattern pane shows alone), its record in the crease
 *   pattern's coordinates (through the step's paper frame), and the
 *   Diagram's look — the diagram's style as its steps are painted, the step's
 *   turn and side, no spread, and Edit's view's line style and width for the
 *   crease pattern (D18). With no record, the scene it shows, at
 *   the kernel's layer order the step shows, so the dialog opens on the order
 *   the step draws.
 * - **Only `applied` writes an order** (D16): the order is folded as the
 *   dialog analysed it (`fold_with_order`) and committed with its record, as
 *   a capture is, one undo step, in the turn the dialog's Rotate left it at.
 *   An `unchanged` that turned it captures the step's flat fold again at that
 *   turn, its record carried, one undo step of its own; `cancelled`, `busy`
 *   and `unavailable` write nothing.
 */
import { toast } from 'sonner';
import { ensureCpSheetIndex } from '../../cp-workspace/sheets/cpSheetIndex';
import { resolveFoldRoute } from '../../cp-workspace/folded/foldRoute';
import { layerOrderRegionOf } from '../../cp-workspace/regions/layerOrderRegion';
import i18n from '../../i18n';
import { openLayerOrderDialog } from '../../layer-order/dialog/layerOrderDialogGateway';
import { lineContentFingerprint } from '../../lib/creaseFingerprint';
import {
  DEFAULT_ORISTUDIO_CP_LINE_STYLE,
  DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  type OristudioCpViewportOptions,
} from '../../lib/creasePatternViewport';
import type {
  LayerOrderApplied,
  LayerOrderLook,
  LayerOrderRegion,
  LayerOrderRequest,
  LayerOrderRequestSurface,
} from '../../lib/layerOrder/layerOrderRequest';
import { layerOrderRecordToSource, type PaperFrame } from '../../lib/layerOrder/paperFrame';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  beginStepCapture,
  captureFailure,
  endStepCapture,
  runStepFold,
  type DiagramCaptureOutcome,
  type StepCaptureStart,
} from '../../store/workspaceStore/diagramCapture';
import {
  isLockedStep,
  renderToShowAs,
  spreadStartsFor,
  stepById,
  stepNumber,
  type DiagramCpRender,
  type DiagramCpSource,
  type DiagramStyle,
} from '../document/diagramDocument';
import { DIAGRAM_STYLE_POLICY, diagramScenePaintStyle } from '../pictures/diagramPaperStyle';
import { chooseStepCreases, knownCreasesOf } from './captureCreases';
import { captureModel } from './captureFolded';
import { stepFoldSource, stepLayerOrderOf, type StepFoldSource, type StepLayerOrder } from './captureLayerOrder';
import { abandonOnEngineLoss } from './engineLoss';
import { layerOrderOf, sayCaptureOutcome } from './stepCaptureActions';

const store = { get: useWorkspaceStore.getState, set: useWorkspaceStore.setState };

/** The undo step an Apply makes, from the Step pane or from Pose (H8). */
export const APPLY_LAYER_ORDER_LABEL = 'Change layer order';

/** The undo step an Apply that only turned the step makes: a pose's, as Rotate in Pose makes it. */
const TURN_STEP_LABEL = 'Adjust pose';

/**
 * The Diagram's look for a step (approach 3, D18): its paper as a folded
 * step is painted, read through the Diagram's policy, the step's turn and
 * side (the request's model's too), no X-ray; and the crease pattern's lines
 * as Edit's view draws them, whatever the host. Its spread is the dialog's to
 * leave out.
 */
export function diagramStepLayerOrderLook(
  style: DiagramStyle,
  render: FlatRender,
  view: Pick<OristudioCpViewportOptions, 'lineStyle' | 'lineWidth'>
): LayerOrderLook {
  return {
    style: diagramScenePaintStyle(style, false),
    policy: DIAGRAM_STYLE_POLICY,
    turnDeg: render.rotationDeg,
    side: render.side,
    xray: false,
    lineStyle: view.lineStyle ?? DEFAULT_ORISTUDIO_CP_LINE_STYLE,
    lineWidth: view.lineWidth ?? DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  };
}

/** A flat fold's pose, as a step keeps it. */
export type FlatRender = Extract<DiagramCpRender, { mode: 'folded-flat' }>;

/** Where the dialog was asked from: the Step pane's Layer order row, or its flag's Review… (D14). */
export type DiagramStepLayerOrderVia = 'edit' | 'review';

/**
 * The flat fold the dialog opens on for a step: the one it shows; for one
 * shown as its crease pattern or simulated — a flagged step's Review… — the
 * pose its folded way last had (D19), or a new flat pose, as Show as Folded
 * would draw it. None for one shown in 3D, whose creases fold in 3D, or a
 * saved Defox view.
 */
export function flatPoseOf(stepId: string, linked: DiagramCpSource): FlatRender | null {
  if (linked.render.mode === 'folded-flat') return linked.render;
  if (linked.render.mode === 'folded-3d' || linked.render.mode === 'defox') return null;
  const { diagram } = store.get();
  const target = renderToShowAs(linked, 'folded', diagram ? spreadStartsFor(diagram, stepId).any : undefined);
  return target.mode === 'folded-flat'
    ? target
    : { mode: 'folded-flat', side: target.mode === 'folded-3d' ? target.side : 'front', rotationDeg: 0, foldCase: 1 };
}

/** The step and pattern a request was made from: an Apply onto anything else commits nothing. */
export interface StepLayerOrderGuard {
  loadId: number;
  revision: number;
  /** The pattern's lines, fingerprinted. */
  content: string;
}

/** A request made for a step: what the dialog opens on, and what its Apply is checked against. */
export interface StepLayerOrderOpening {
  request: LayerOrderRequest;
  frame: PaperFrame;
  /** The flat pose the dialog was opened on, which an Apply captures the step in. */
  render: FlatRender;
  guard: StepLayerOrderGuard;
}

/** The guard for a request made in this capture: the step and pattern as they are as it runs. */
export function stepLayerOrderGuard(start: StepCaptureStart): StepLayerOrderGuard {
  return { loadId: start.guard.loadId, revision: start.guard.revision, content: lineContentFingerprint(start.cp.document) };
}

/** Whether the step is still linked, and it and the pattern are as they were when `guard` was taken. */
export function stillOpenedOn(stepId: string, guard: StepLayerOrderGuard): boolean {
  const now = store.get();
  const step = now.diagram ? stepById(now.diagram, stepId) : null;
  const document = now.oristudioCpDocument?.document;
  if (step?.source?.kind !== 'cp' || !document) return false;
  return now.diagramLoadId === guard.loadId && step.revision === guard.revision && lineContentFingerprint(document) === guard.content;
}

/**
 * The request for a step's flat fold in `render`, as `folded` was read from
 * it: which host asked (`surface`: the Step pane's `diagram_step`, or
 * `pose`), its source, its record in the crease pattern's coordinates
 * (through the step's paper frame), the Diagram's look with `view`'s crease
 * lines (the crease pattern's viewport), and its name. With no record, the
 * scene it shows, so the dialog opens on the order the step draws; with one,
 * the dialog restores it. `region` is the step's sheet, out of every pattern
 * the document holds (`layerOrderRegionOf`): the crease-pattern pane shows it
 * alone, as the step's crease-pattern picture does.
 */
export function stepLayerOrderRequest(
  stepId: string,
  surface: Extract<LayerOrderRequestSurface, 'diagram_step' | 'pose'>,
  style: DiagramStyle,
  view: Pick<OristudioCpViewportOptions, 'lineStyle' | 'lineWidth'>,
  render: FlatRender,
  folded: StepFoldSource,
  saved: StepLayerOrder | null,
  region: LayerOrderRegion
): LayerOrderRequest {
  const diagram = store.get().diagram;
  const number = diagram ? stepNumber(diagram, stepId) : null;
  return {
    surface,
    source: folded.source,
    region,
    record: saved ? layerOrderRecordToSource(saved.record, folded.frame) : null,
    look: diagramStepLayerOrderLook(style, render, view),
    ...(saved || !folded.scene ? {} : { shown: folded.scene }),
    ...(number !== null ? { name: i18n.t('panels:diagram.layerOrder.stepName', 'Step {{number}}', { number }) } : {}),
  };
}

/** A step whose creases fold in 3D now, asked for its layer order: said, and nothing opens. */
export function sayStepFoldsIn3d(): void {
  toast.message(
    i18n.t(
      'toasts:diagram.layerOrder.folds3d',
      'This step’s creases fold in 3D now, and layer order works on flat folds. Refresh the step to see it.'
    )
  );
}

/** Fold the step's creases for the dialog, as a stoppable run, and build its request; or why it cannot open. */
async function openingFor(
  stepId: string,
  linked: DiagramCpSource,
  render: FlatRender
): Promise<StepLayerOrderOpening | DiagramCaptureOutcome | 'spatial'> {
  const start = beginStepCapture(store, stepId);
  if ('status' in start) return start;
  try {
    const document = start.cp.document;
    const sheets = await abandonOnEngineLoss(ensureCpSheetIndex(document));
    const choice = chooseStepCreases(document, linked.scope, sheets, knownCreasesOf(linked));
    if (choice.status !== 'found') return choice;
    const route = resolveFoldRoute(document, choice.creases.foldLineIds);
    if (route.kind === 'none') return { status: 'missing' };
    if (route.kind === 'spatial') return 'spatial';
    const saved = stepLayerOrderOf(linked.layerOrder);
    // With no record the dialog opens on the order the step draws: the kernel's, at the step's case.
    const folded = await runStepFold(store, start, 'diagram-capture', (runtime) =>
      stepFoldSource(runtime, route.lineIds, captureModel(document, render.side), saved ? 1 : render.foldCase)
    );
    return {
      request: stepLayerOrderRequest(
        stepId,
        'diagram_step',
        start.style,
        store.get().oristudioCpViewport,
        render,
        folded,
        saved,
        layerOrderRegionOf(document, choice.creases)
      ),
      frame: folded.frame,
      render,
      guard: stepLayerOrderGuard(start),
    };
  } catch (error) {
    return captureFailure(error);
  } finally {
    endStepCapture(store, stepId);
  }
}

/**
 * Commit an order the dialog applied: folded as it was analysed, into the
 * step's picture in the flat pose the dialog was opened on — a step shown
 * another way comes back folded, which is what was being shown — with its
 * record, as one undo step; onto the step and pattern it was opened on, or
 * not at all. An order the kernel cannot draw writes nothing (D3).
 */
async function applyToStep(
  stepId: string,
  opening: StepLayerOrderOpening,
  applied: LayerOrderApplied,
  turnDeg?: number
): Promise<boolean> {
  if (!stillOpenedOn(stepId, opening.guard)) return false;
  const now = store.get();
  const step = now.diagram ? stepById(now.diagram, stepId) : null;
  if (step?.source?.kind !== 'cp') return false;
  const outcome = await now.captureDiagramStep(stepId, {
    scope: step.source.scope,
    known: knownCreasesOf(step.source),
    // Turned as the dialog's Rotate left it, in the same undo step.
    render: turnedFlatRender(opening.render, turnDeg),
    kind: 'diagram-capture',
    label: APPLY_LAYER_ORDER_LABEL,
    layerOrderApplied: { applied, frame: opening.frame },
  });
  sayCaptureOutcome(outcome);
  return outcome.status === 'captured';
}

/** A flat pose turned to the dialog's `turnDeg`, clockwise as a step's `rotationDeg` is; as it was with none. */
export function turnedFlatRender(render: FlatRender, turnDeg: number | undefined): FlatRender {
  return turnDeg === undefined ? render : { ...render, rotationDeg: ((turnDeg % 360) + 360) % 360 };
}

/**
 * The flat pose a step shows, turned to `turnDeg`: what an Apply that only
 * turned it (`unchanged` with a turn) captures it in. Null for a step that
 * shows no flat fold — a Review… on a step shown another way — whose picture
 * the dialog's turn is not of, so it is left as it is.
 */
export function stepTurnedRender(stepId: string, turnDeg: number): FlatRender | null {
  const { diagram } = store.get();
  const step = diagram ? stepById(diagram, stepId) : null;
  const render = step?.source?.kind === 'cp' ? step.source.render : null;
  return render?.mode === 'folded-flat' ? turnedFlatRender(render, turnDeg) : null;
}

/**
 * An Apply that only turned the step's flat fold: captured again in its pose
 * turned so, its record carried (as a Refresh carries it), as one undo step
 * labelled as a pose; onto the step and pattern it was opened on, or not at
 * all.
 */
async function turnStep(stepId: string, opening: StepLayerOrderOpening, turnDeg: number): Promise<boolean> {
  if (!stillOpenedOn(stepId, opening.guard)) return false;
  const render = stepTurnedRender(stepId, turnDeg);
  const now = store.get();
  const step = now.diagram ? stepById(now.diagram, stepId) : null;
  if (!render || step?.source?.kind !== 'cp') return false;
  const outcome = await now.captureDiagramStep(stepId, {
    scope: step.source.scope,
    known: knownCreasesOf(step.source),
    render,
    kind: 'diagram-capture',
    label: TURN_STEP_LABEL,
    ...layerOrderOf(step.source),
  });
  sayCaptureOutcome(outcome);
  return outcome.status === 'captured';
}

/**
 * Open the Layer order dialog on a linked step and commit an Apply: from the
 * Step pane's Edit…, on the flat fold the step shows; or from its flag's
 * Review… (D14), whatever it is shown as while its creases fold flat, on the
 * flat fold it would show. Whether it applied an order.
 */
export async function openDiagramStepLayerOrder(stepId: string, via: DiagramStepLayerOrderVia = 'edit'): Promise<boolean> {
  const state = store.get();
  const step = state.diagram ? stepById(state.diagram, stepId) : null;
  if (!step || isLockedStep(step) || state.diagramReadOnly || step.source?.kind !== 'cp') return false;
  const linked = step.source;
  // Edit… is the Layer order row's, which only a flat fold has.
  if (via === 'edit' && linked.render.mode !== 'folded-flat') return false;
  const render = flatPoseOf(stepId, linked);
  if (!render) return false;
  const opening = await openingFor(stepId, linked, render);
  if (opening === 'spatial') {
    sayStepFoldsIn3d();
    return false;
  }
  if (!('request' in opening)) {
    sayCaptureOutcome(opening);
    return false;
  }
  // From the flag's Review…: the dialog opens on the rows that need attention (D14).
  const outcome = await openLayerOrderDialog(via === 'review' ? { ...opening.request, review: true } : opening.request);
  if (outcome.kind === 'unchanged' && outcome.turnDeg !== undefined) await turnStep(stepId, opening, outcome.turnDeg);
  if (outcome.kind !== 'applied') return false;
  return applyToStep(stepId, opening, outcome.applied, outcome.turnDeg);
}
