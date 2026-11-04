import type { ConnectedSpreadView } from '../../layer-spread/view';
import {
  spreadTracking,
  trackDiagramPicturePosed,
  type DiagramPoseAction as TrackedPoseAction,
} from '../../analytics';
import type { LayerOrderAttention } from '../../lib/layerOrder/layerOrderRecord';
import { ensureCpSheetIndex, peekCpSheetIndex } from '../../cp-workspace/sheets/cpSheetIndex';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import type { LayerSpreadOptions, SpreadKind } from '../../cp-workspace/folded/foldedLayerSpread';
import type { SpreadSlider } from '../../cp-workspace/folded/layerSpreadControls';
import { withSpreadField } from '../../cp-workspace/folded/layerSpreadSettings';
import {
  foldedFigureHandleEpoch,
  releaseFoldedFigureHandle,
  retainFoldedFigureHandle,
} from '../../cp-workspace/folded/foldedFigureHandles';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFolded3dAuxLines,
  OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  beginStepCapture,
  captureFailure,
  endStepCapture,
  layerOrderResolver,
  runStepFold,
  sameAttention,
  stepCaptureRuntime,
  storeSheetPaper,
  storeSimulateFlat,
  type DiagramCaptureOutcome,
  type StepCaptureStart,
} from '../../store/workspaceStore/diagramCapture';
import { resolveFoldRoute } from '../../cp-workspace/folded/foldRoute';
import { layerOrderRegionOf } from '../../cp-workspace/regions/layerOrderRegion';
import { openLayerOrderDialog } from '../../layer-order/dialog/layerOrderDialogGateway';
import {
  solutionPressOf,
  solutionsHeldForReview,
  type LayerOrderSolutionPress,
} from '../../layer-order/host/solutionCursorTable';
import { foldCancellationAvailable } from '../../lib/foldCancellation';
import type { LayerOrderRequestSurface } from '../../lib/layerOrder/layerOrderRequest';
import { layerOrderRecordToSource } from '../../lib/layerOrder/paperFrame';
import { captureModel, withSheetPaper } from './captureFolded';
import {
  LayerOrderNotShownError,
  layerOrderDigestOf,
  layerOrderSummaryOf,
  routed3dLayerOrder,
  stepFoldSource,
  stepLayerOrderOf,
  type StepFoldSource,
} from './captureLayerOrder';
import {
  creasePatternSide,
  creasesFlipped,
  spreadStartsFor,
  stepById,
  type DiagramCpRender,
  type DiagramCpSource,
  type DiagramScenePicture,
} from '../document/diagramDocument';
import { storedCpSource } from '../document/diagramFile';
import { isRelativeFingerprint } from '../../cp-workspace/regions/regionIdentity';
import {
  chooseStepCreases,
  creasesFingerprint,
  creasesMatch,
  followedScope,
  knownCreasesOf,
  type StepCreases,
} from './captureCreases';
import {
  CaptureSessionClosedError,
  createCaptureSession,
  type CaptureSession,
  type FlatFoldState,
  type HeldLayerOrder,
} from './captureSession';
import { creasesThumbnail } from './captureThumbnail';
import { abandonOnEngineLoss } from './engineLoss';
import { linkStatus } from './linkStatus';
import { lightingChanged } from '../pictures/lighting';
import { poseLinkedStep, type FlatSolutions, type LinkedPoseRequest } from './linkedPose';
import { captureKind, sayCaptureOutcome, sayStepSolutionPress, trackStepLayerOrderAttention } from './stepCaptureActions';
import { beginStepSolutionStep, dropStepSolutionCursor } from './stepSolutionCursor';
import {
  APPLY_LAYER_ORDER_LABEL,
  flatPoseOf,
  sayStepFoldsIn3d,
  stepLayerOrderGuard,
  stepLayerOrderRequest,
  stepTurnedRender,
  stillOpenedOn,
  turnedFlatRender,
  type DiagramStepLayerOrderVia,
  type FlatRender,
  type StepLayerOrderGuard,
  type StepLayerOrderOpening,
} from './stepLayerOrderActions';

/** The undo step a pose makes. */
const POSE_LABEL = 'Adjust pose';

/**
 * The undo step a constrained step's ‹ or › makes (H9): the words a
 * constrained figure's step has in Edit (`foldedFigureVerbs.ts`), so both
 * hosts' histories read the same.
 */
const SOLUTION_STEP_LABELS = { next: 'Show another solution', previous: 'Show previous solution' } as const;

/** How a pose is committed: whether it is counted as one, its undo step's label, and who hears what it committed. */
interface PoseOptions {
  current?: () => boolean;
  tracked?: boolean;
  label?: string;
  landed?: (source: DiagramCpSource) => void;
}

/** Who asked Pose for the Layer order dialog: its own Edit order…, or the Step pane beside it. */
export type PoseLayerOrderSurface = Extract<LayerOrderRequestSurface, 'pose' | 'diagram_step'>;

/** How long the 3D view must rest before its camera is captured: one orbit, one undo step. */
export const ORBIT_SETTLE_MS = 450;

/**
 * The verbs counted as `diagram picture posed`: every pose but an order the
 * Layer order dialog applied, which the dialog counts as its own (H8).
 */
export type TrackedPoseVerb = Exclude<LinkedPoseRequest['verb'], 'layer-order'>;

const TRACKED: Record<TrackedPoseVerb, TrackedPoseAction> = {
  'show-crease-pattern': 'show_crease_pattern',
  'show-folded': 'show_folded',
  'show-simulated': 'show_simulated',
  'rotate-left': 'rotate_left',
  'rotate-right': 'rotate_right',
  'turn-over': 'turn_over',
  'next-solution': 'next_solution',
  'previous-solution': 'previous_solution',
  'view-top': 'view_top',
  reset: 'reset',
  orbit: 'orbit',
  'spread-presentation': 'spread_presentation',
  'rotate-to': 'rotate_to',
  upright: 'upright',
  simulate: 'simulate',
  // On, or off when the verb left none (`trackPose`).
  'spread-layers': 'spread_on',
  'spread-kind': 'spread_kind',
  'spread-amount': 'spread_amount',
  'spread-direction': 'spread_direction',
  'spread-keep': 'spread_keep',
  'spread-skew': 'spread_skew',
  'spread-axis': 'spread_axis',
  'spread-reveal': 'spread_reveal',
  'spread-reveal-axis': 'spread_reveal',
  // A crease pattern's paper on the colour of one side: not a turn-over (Zach, 2026-10-06).
  'paper-side': 'paper_side',
  // On, or off when the verb left them unflipped (`trackPose`).
  'flip-creases': 'flip_creases_on',
};

/** The verbs that spread a flat fold's layers: they say how it is spread after them. */
const SPREAD_VERBS: ReadonlySet<LinkedPoseRequest['verb']> = new Set([
  'spread-layers',
  'spread-kind',
  'spread-amount',
  'spread-direction',
  'spread-keep',
  'spread-skew',
  'spread-axis',
  'spread-reveal',
  'spread-reveal-axis',
]);

/**
 * A pose that changed the step's picture, counted: by its verb — Spread
 * Layers as on or off by what it left — and for a spread verb that left the
 * layers spread, how: its kind, the amount bucketed, and a depth spread's
 * direction or an affine one's layer held still, skew and axis (bucketed). A
 * turn-over says the side it left showing, and a crease pattern's paper side
 * the side whose colour it chose. Flip creases is counted as on or off by
 * what it left, as Spread Layers is. A Fold step's pose is counted the same
 * way (`foldStepActions.ts`), by the render it was captured in. A step through
 * the solutions that fit a step's layer constraints, rather than the kernel's
 * orders, says so (`constrained`, H9).
 */
export function trackPose(
  verb: TrackedPoseVerb,
  render: DiagramCpRender,
  { constrained = false }: { constrained?: boolean } = {}
): void {
  const spread = render.mode === 'folded-flat' ? render.spread : undefined;
  const action =
    verb === 'spread-layers' && !spread
      ? 'spread_off'
      : verb === 'flip-creases' && !(render.mode === 'crease-pattern' && creasesFlipped(render))
        ? 'flip_creases_off'
        : TRACKED[verb];
  const how = SPREAD_VERBS.has(verb) && spread ? spreadTracking(spread) : undefined;
  const side = verb === 'turn-over' || verb === 'paper-side' ? renderSide(render) : undefined;
  trackDiagramPicturePosed(action, captureKind(render), {
    ...(how ? { spread: how } : {}),
    ...(side ? { side } : {}),
    ...(constrained ? { constrained: true } : {}),
  });
}

/** The side of the paper a render shows; none for a simulation, which has no side. */
function renderSide(render: DiagramCpRender): 'front' | 'back' | undefined {
  if (render.mode === 'crease-pattern') return creasePatternSide(render);
  return render.mode === 'simulated' || render.mode === 'defox' ? undefined : render.side;
}

/** The sliders a spread is dragged by: its amount, and an affine one's skew and axis (`layerSpreadControls.ts`). */
export type { SpreadSlider };

/**
 * A slider at a value: what a drag shows before it is committed. An amount
 * says which kind of spread it was dragged on — a share of the model by
 * depth, τ for an affine one — so it is dropped on a spread switched to the
 * other kind while it waits; a skew and an axis are an affine spread's alone.
 */
export type SpreadSlide =
  | { slider: 'reveal'; value: [number, number] }
  | { slider: 'amount'; kind: SpreadKind; value: number }
  | { slider: 'skew' | 'axis' | 'reveal-x' | 'reveal-y'; value: number };

/** Whether a slider is one of `spread`'s: an amount of its kind, a skew or an axis of an affine one. */
function slideFits(spread: LayerSpreadOptions, slide: SpreadSlide): boolean {
  return slide.slider === 'amount' ? slide.kind === spread.kind : slide.slider.startsWith('reveal') ? spread.kind === 'connected' : spread.kind === 'affine';
}

/** The verb that commits a slide. */
function slideRequest(slide: SpreadSlide) {
  switch (slide.slider) {
    case 'reveal': return { verb: 'spread-reveal', reveal: slide.value } as const;
    case 'reveal-x': return { verb: 'spread-reveal-axis', axis: 0, value: slide.value } as const;
    case 'reveal-y': return { verb: 'spread-reveal-axis', axis: 1, value: slide.value } as const;
    case 'amount':
      return { verb: 'spread-amount', amount: slide.value, kind: slide.kind } as const;
    case 'skew':
      return { verb: 'spread-skew', skew: slide.value } as const;
    case 'axis':
      return { verb: 'spread-axis', axisDeg: slide.value } as const;
  }
}

/** A spread with a slide applied, as the picture previews it: one of the other kind is left as it is. */
export function withSlide(spread: LayerSpreadOptions, slide: SpreadSlide): LayerSpreadOptions {
  return withSpreadField(spread, slideRequest(slide));
}

/** The verbs a slide commits as: a preview stays up under them until the newest lands. */
const SLIDE_VERBS: ReadonlySet<LinkedPoseRequest['verb']> = new Set(['spread-amount', 'spread-skew', 'spread-axis', 'spread-reveal', 'spread-reveal-axis']);

/** Discrete changes need a replacement picture; live gestures already show their new pose while capturing. */
export function poseCaptureBlocksViewport(verb: LinkedPoseRequest['verb']): boolean {
  return !SLIDE_VERBS.has(verb) && verb !== 'orbit' && verb !== 'simulate';
}

/** Where Pose's simulator came to rest, and the model there. */
export type SimulatedRest = Omit<Extract<LinkedPoseRequest, { verb: 'simulate' }>, 'verb'>;

/**
 * A spread shown before it is committed — under a drag of one of its
 * sliders — and the step's picture with it, drawn from the fold the session
 * holds; null while no fold is held to draw it from.
 */
export interface SpreadPreview {
  /** The slider dragged, and where to. */
  slide: SpreadSlide;
  /**
   * Every slide the step's spread does not hold yet, oldest first: the one
   * being committed, those waiting for it, and the newest, `slide`. The
   * spread shown is the step's own with each applied in turn, so a slider let
   * go keeps its value while another is dragged.
   */
  slides: SpreadSlide[];
  spread: LayerSpreadOptions;
  picture: DiagramScenePicture | null;
}

/** The 3D fold the live view draws, held by the session. */
export interface DiagramPoseSpatialView {
  model: OristudioCpFolded3dRenderModel;
  aux: OristudioCpFolded3dAuxLines | null;
}

/**
 * What a controller tells its view as it learns it. Each fact comes with the
 * {@link linkedFoldKey} of the creases it was learnt from, so a view shows it
 * only while the step still links to them: a Relink or an undo moves the step
 * to other creases, and the fold held for the old ones is not theirs.
 */
export interface PoseControllerListener {
  connected?: (view: ConnectedSpreadView | null, key: string | null) => void;
  /** The live 3D fold, once held; null when let go. */
  spatial: (view: DiagramPoseSpatialView | null, key: string | null) => void;
  /** The held flat fold's layer orders as the search knows them; null when unknown. */
  solutions: (solutions: FlatSolutions | null, key: string) => void;
  /**
   * The held flat fold's mirror axes, unturned — empty for a fold with no
   * symmetry, which Upright cannot stand; null for a picture not folded flat.
   */
  mirrorAxes: (axes: readonly number[] | null, key: string) => void;
  /** A spread previewed before it is committed; null when the preview ends. */
  preview: (preview: SpreadPreview | null, key: string | null) => void;
}

/**
 * Which fold a step's facts are of: its creases — their scope and
 * fingerprint — and the layer order it is drawn in (H7), the record's or
 * none, so what was learnt of a fold in a record's order (its one solution)
 * is not shown for the kernel's enumeration once an undo takes the record
 * back, nor the other way round. The record goes in as a digest of its text
 * (`layerOrderDigestOf`), so the key stays short however large the record,
 * and is built as often as a spread's sliders move.
 */
export function linkedFoldKey(
  stepId: string,
  source: Pick<DiagramCpSource, 'scope' | 'fingerprint' | 'layerOrder'>
): string {
  const layerOrder = source.layerOrder === undefined ? null : layerOrderDigestOf(source.layerOrder);
  return JSON.stringify([stepId, source.scope, source.fingerprint, layerOrder]);
}

/**
 * Pose for one linked step (D4, D5), bound to the store: each verb captured
 * and committed as one undo step, as an upload's pose verbs are, so there is
 * never a pose waiting to be captured and every way out of the detail is the
 * same. Between verbs the fold is held open by a capture session.
 *
 * React-free: `useDiagramLinkedPose` makes one per open step and disposes it.
 */
export interface PoseController {
  /**
   * `tracked: false` for a verb counted by its own surface — Show as from the
   * Step pane or a card, which `diagram step shown as` counts — so it is not
   * also counted as a pose.
   */
  run: (request: LinkedPoseRequest, options?: { tracked?: boolean; current?: () => boolean }) => Promise<void>;
  /** The 3D view moved: capture it once it rests, if it is not where the step already is. */
  orbit: (camera: FoldedFigureCamera, stored: FoldedFigureCamera | null) => void;
  /**
   * Pose's simulator came to rest (D19): capture the model where it is, if
   * that is not the picture the step already has — another fold % or camera,
   * creases changed since, or another light. Nothing for a step no longer
   * shown Simulated: the rest was of a view it has left.
   */
  simulate: (rest: SimulatedRest) => Promise<void>;
  /**
   * Whether a rest at this pose would be captured now: the step is shown
   * Simulated, and the pose is not the picture it has, or that picture is out
   * of date. Asked before a rest's scene is drawn, so a rest that would be
   * dropped costs the worker nothing.
   */
  wantsRest: (pose: Pick<SimulatedRest, 'foldPercent' | 'view'>) => boolean;
  /** Fold a step shown in 3D for its live view. */
  prepareSpatial: () => Promise<void>;
  prepareConnected: () => Promise<void>;
  /**
   * Show the step's flat fold with one slider of its spread at this value,
   * the rest its own, before it is committed — a drag: drawn from the fold
   * the session holds, with no call to the kernel, or once one is held (the
   * first preview folds it).
   */
  previewSpread: (slide: SpreadSlide) => void;
  /**
   * Commit the slide previewed — the end of a drag, or a key — as one undo
   * step. The newest of each slider wins: one waits while another is
   * captured, and a newer one of the same slider takes its place. The
   * preview ends once it lands, unless a newer one was asked for meanwhile.
   */
  commitSpread: () => Promise<void>;
  /**
   * Open the Layer order dialog on the step's flat fold, as Pose holds it
   * (H8), and commit an Apply: Edit order… and the Step pane's Edit… on the
   * flat fold the step shows; `review`, its flag's Review… (D14), on the flat
   * fold it would show. The fold held is what the dialog analyses, read with
   * no fold of its own (`sourceToEdit`). An Apply replaces it with a new one
   * in the applied order (`fold_with_order`), and writes the record on the
   * step's source in the flat pose it was opened on, one undo step ("Change
   * layer order", as the Step pane's), turned as the dialog's Rotate left
   * it. An `unchanged` that turned the step's flat fold turns it by Rotate's
   * own verb (`rotate-to`); `cancelled`, `busy` and `unavailable` write
   * nothing, and so does an Apply onto a step or pattern
   * that changed while it was open. `surface` is who asked, for the dialog's
   * events: `pose`, Pose's own Edit order…; `diagram_step`, the Step pane's
   * Edit… or Review… on the step open here. Whether it applied an order.
   */
  editLayerOrder: (via?: DiagramStepLayerOrderVia, surface?: PoseLayerOrderSurface) => Promise<boolean>;
  /**
   * An undo or redo: stop what is still folding for a source the step no
   * longer has, and let go of a held fold in a layer order the step's record
   * no longer has (H8).
   */
  historyMoved: () => void;
  /** The crease pattern replaced: its handle went with it. */
  documentReplaced: () => void;
  /** The engine is gone: forget the fold without freeing it, since its slots are reused. */
  engineLost: () => void;
  dispose: (options?: {flushOrbit?:boolean}) => void;
}

const store = { get: useWorkspaceStore.getState, set: useWorkspaceStore.setState };

export function createPoseController(stepId: string, listener: PoseControllerListener): PoseController {
  let start: StepCaptureStart | null = null;
  let orbitTimer: ReturnType<typeof setTimeout> | null = null;
  let nextOrbit: {camera:FoldedFigureCamera;loadId:number} | null = null;
  let orbiting: Promise<void> | null = null;
  let orbitGeneration = 0;
  /** The simulator's rests: the one being captured, and the newest waiting for it. */
  let simulating: Promise<void> | null = null;
  let nextRest: SimulatedRest | null = null;
  /**
   * The creases, of which crease pattern, the session's flat fold was last
   * posed for: what a preview may be drawn from. The session checks its side,
   * layer order and the pattern; this, that the step still links to them.
   */
  let heldFor: { key: string; document: OristudioCpDocumentSnapshot } | null = null;
  /**
   * The newest slide previewed, and how many have been: a commit ends the
   * preview only if none came after. Only the slider dragged: the rest of the
   * spread is the step's own, whatever a verb made it since the drag began.
   */
  let previewing: SpreadSlide | null = null;
  let previews = 0;
  /** Gone with its detail: nothing folds or commits for it again. */
  let disposed = false;
  /** A fold held for a preview, while it folds. */
  let holding: Promise<unknown> | null = null;
  /** This controller's own capture in flight: a spread commit waits for it rather than being refused as busy. */
  let own: Promise<unknown> | null = null;
  /** The spread commits: the one being captured, and the newest of each slider waiting for it. */
  let spreading: Promise<void> | null = null;
  let committing: { slide: SpreadSlide; revision: number | undefined } | null = null;
  const waiting = new Map<SpreadSlider | 'reveal', SpreadSlide>();
  const session: CaptureSession = createCaptureSession({
    search: (work) => {
      if (!start) throw new Error('A pose fold ran outside a capture');
      return runStepFold(store, start, 'diagram-capture', work);
    },
    runtime: () => {
      if (!start) throw new Error('A pose read ran outside a capture');
      return stepCaptureRuntime(start);
    },
    retain: retainFoldedFigureHandle,
    release: releaseFoldedFigureHandle,
    epoch: foldedFigureHandleEpoch,
  });

  /**
   * Run kernel work as this step's capture: marked capturing, its fold
   * stoppable. Only a capture that began is this controller's own — one
   * refused as busy leaves `own` to the capture that is running.
   */
  const capturing = <T>(
    work: (begun: StepCaptureStart, linked: DiagramCpSource) => Promise<T>,
    blocksPose = false
  ): Promise<T | DiagramCaptureOutcome | null> => {
    if (disposed) return Promise.resolve(null);
    const linked = currentLinkedSource(stepId);
    if (!linked) return Promise.resolve(null);
    const begun = beginStepCapture(store, stepId, blocksPose);
    if ('status' in begun) return Promise.resolve(begun);
    const task = (async (): Promise<T | DiagramCaptureOutcome | null> => {
      start = begun;
      try {
        return await work(begun, linked);
      } catch (error) {
        // The detail closed, or a newer verb took over, while this folded.
        if (error instanceof CaptureSessionClosedError) return { status: 'discarded' };
        // The step's layer order could not be drawn: it keeps its picture, its record flagged (D10).
        if (error instanceof LayerOrderNotShownError) return keepLayerOrder(begun, error);
        return captureFailure(error);
      } finally {
        start = null;
        endStepCapture(store, stepId);
        // Closed while this ran: a fold it began after the session was let
        // go is held as current, so let go of it too.
        if (disposed) session.dispose();
      }
    })();
    own = task;
    const settled = () => {
      if (own === task) own = null;
    };
    task.then(settled, settled);
    return task;
  };

  const creasesFor = async (begun: StepCaptureStart, linked: DiagramCpSource) => {
    const document = begun.cp.document;
    const sheets = await abandonOnEngineLoss(ensureCpSheetIndex(document));
    const choice = chooseStepCreases(document, linked.scope, sheets, knownCreasesOf(linked));
    if (choice.status !== 'found') return { document, choice };
    // A crease-pattern pose fills the sheet's paper: its faces' rim, holes and all.
    const store = { get: useWorkspaceStore.getState, set: useWorkspaceStore.setState };
    const creases = await abandonOnEngineLoss(withSheetPaper(choice.creases, storeSheetPaper(store)));
    return { document, choice: { ...choice, creases } };
  };

  /**
   * Pose the step from these creases of this pattern, inside a capture, and
   * commit what it draws as one undo step: what every pose comes to once its
   * creases are chosen. `label` is its undo step's ("Adjust pose" unless
   * said); `landed`, told the source just committed, before anything else
   * hears of it.
   */
  const posed = async (
    begun: StepCaptureStart,
    linked: DiagramCpSource,
    document: OristudioCpDocumentSnapshot,
    creases: StepCreases,
    request: LinkedPoseRequest,
    options: PoseOptions
  ): Promise<DiagramCaptureOutcome> => {
    const result = await abandonOnEngineLoss(
      poseLinkedStep(
        session,
        {
          document,
          creases,
          render: linked.render,
          remembered: linked.remembered,
          style: begun.style,
          simulateFlat: storeSimulateFlat({ get: useWorkspaceStore.getState, set: useWorkspaceStore.setState }),
          spreadStart: spreadStartsOf(stepId),
          layerOrder: heldLayerOrderOf(linked),
        },
        request
      )
    );
    if (result.status === 'refused' || result.status === 'unavailable' || result.status === 'order-refused') {
      return result;
    }
    const source = linkedSource(linked, creases, document, result.render, result.layerOrder);
    const committed = await useWorkspaceStore
      .getState()
      .commitDiagramCapture(begun, { source, picture: result.picture }, options.label ?? POSE_LABEL);
    if (!committed) return { status: 'discarded' };
    options.landed?.(source);
    if (committed.changed && options.tracked !== false && request.verb !== 'layer-order') {
      trackPose(request.verb, result.render);
    }
    // Said once, as the step comes to need a look or its reason changes; a turn of a flagged step says nothing new.
    const attention = newAttention(linked, source);
    if (attention) trackStepLayerOrderAttention(attention);
    const key = linkedFoldKey(stepId, source);
    // What a preview may draw from: the flat fold just posed, of these creases.
    heldFor = result.render.mode === 'folded-flat' ? { key, document } : null;
    listener.solutions(result.solutions ?? null, key);
    listener.mirrorAxes(result.mirrorAxes ?? null, key);
    if (result.spatial) listener.spatial({ model: result.spatial.fold.render, aux: result.spatial.aux }, key);
    return {
      status: 'captured',
      changed: committed.changed,
      render: result.render,
      noLayerOrder: result.noLayerOrder,
      ...(committed.spreadFailed ? { spreadFailed: committed.spreadFailed } : {}),
      tooDetailed: committed.tooDetailed,
      flagged: attention,
    };
  };

  /**
   * Run a pose as one capture, and say how it went: `opened`, for an order
   * the Layer order dialog applied, is the step and pattern it was opened on,
   * and an Apply onto anything else commits nothing; `label`, its undo step's
   * ("Adjust pose" unless said).
   */
  const pose = async (
    request: LinkedPoseRequest,
    options: PoseOptions & { opened?: StepLayerOrderGuard } = {}
  ): Promise<DiagramCaptureOutcome | null> => {
    // Any other verb makes a picture the preview was not drawn over — a drag
    // that ended where it began commits nothing and would leave one up.
    if (!SLIDE_VERBS.has(request.verb)) endPreview();
    const outcome = await capturing(async (begun, linked): Promise<DiagramCaptureOutcome> => {
      begun.guard.current = options?.current;
      // Shown another way since the simulator came to rest: an undo, or a verb.
      if (request.verb === 'simulate' && linked.render.mode !== 'simulated') return { status: 'discarded' };
      if (options.opened && !stillOpenedOn(stepId, options.opened)) return { status: 'discarded' };
      const { document, choice } = await creasesFor(begun, linked);
      if (choice.status !== 'found') return choice;
      return posed(begun, linked, document, choice.creases, request, options);
    }, poseCaptureBlocksViewport(request.verb));
    // A drag begun while this verb captured was drawn over the spread before
    // it: drawn again over the one it left, or taken down if that has none.
    if (!SLIDE_VERBS.has(request.verb)) showPreview(false);
    if (!outcome || !('status' in outcome)) return null;
    // Only what is news: a see-through fold says so as it is first folded.
    const repeated = outcome.status === 'captured' && outcome.noLayerOrder && request.verb !== 'show-folded';
    if (!repeated) sayCaptureOutcome(outcome);
    return outcome;
  };

  /**
   * ‹ or › on a constrained flat step (H9, D9): on through the solutions
   * that fit its record, in the stepper's fixed order, on the host engine's
   * cursor (`stepSolutionCursor.ts`), never through the kernel's enumeration,
   * which knows nothing of the constraints. One capture, as every pose is,
   * whichever surface pressed (the Step pane, Pose's toolbar): the step's
   * creases chosen; the cursor made on the first press, from the fold held in
   * the record's order — or, holding none, the creases folded and freed, as
   * Edit order… reads them — or kept from the press before; stepped, its
   * Stop the capture's; and an order it moved to folded as an Apply's is
   * (`fold_with_order`, a new held fold), committed with its record as one
   * undo step under the label a constrained figure's step has in Edit. A
   * press that moves nothing writes nothing and says why when that is news.
   * A step no longer constrained, or whose creases fold in 3D now, takes the
   * verb as any pose does.
   */
  const stepSolution = async (verb: 'next-solution' | 'previous-solution', tries = 0): Promise<void> => {
    const direction = verb === 'next-solution' ? 'next' : 'previous';
    endPreview();
    const outcome = await capturing(
      async (begun, linked): Promise<DiagramCaptureOutcome | { press: LayerOrderSolutionPress }> => {
        const { document, choice } = await creasesFor(begun, linked);
        if (choice.status !== 'found') return choice;
        const lineIds = choice.creases.foldLineIds;
        const route = resolveFoldRoute(document, lineIds);
        const saved = stepLayerOrderOf(linked.layerOrder);
        if (!saved || linked.render.mode !== 'folded-flat' || route.kind === 'spatial') {
          return posed(begun, linked, document, choice.creases, { verb }, {});
        }
        if (route.kind === 'none') return { status: 'missing' };
        // As Edit's figures wait (`foldedFigureActions.ts`), and the pager says why: its record needs a look
        // since an edit (D14), or its pattern changed since it was captured, so the solutions of the fold it
        // shows are not its creases' until a Refresh.
        if (solutionsHeldForReview(saved.record.attention)) return { press: { status: 'blocked' } };
        // `linkStatus`'s rule for `stale`: a step that kept no fingerprint has nothing to say it changed from.
        const known = knownCreasesOf(linked);
        if (known.fingerprint !== null && !creasesMatch(choice.creases, known)) return { press: { status: 'blocked' } };
        const render = linked.render;
        const turn = beginStepSolutionStep(stepId, linked, { loadId: begun.guard.loadId, document, lineIds });
        try {
          // The engine's half can always be stopped, since stopping it terminates its worker; a fold of
          // the creases to open the cursor on, only where the kernel's cancel transport reaches.
          const answer = await runStepFold(
            store,
            begun,
            'diagram-capture',
            (runtime, stop, controls) =>
              turn.step({
                direction,
                signal: stop,
                tries,
                open: async () => {
                  if (session.holdsFlat(document, lineIds, saved.json)) {
                    const held = await session.heldFlatSource();
                    return { source: held.source, record: layerOrderRecordToSource(saved.record, held.frame), frame: held.frame };
                  }
                  controls.stoppable(foldCancellationAvailable());
                  const folded = await stepFoldSource(runtime, lineIds, captureModel(document, render.side));
                  controls.stoppable(true);
                  return {
                    source: folded.source,
                    record: layerOrderRecordToSource(saved.record, folded.frame),
                    frame: folded.frame,
                  };
                },
              }),
            { stoppable: true }
          );
          const frame = turn.frame();
          if (answer.outcome !== 'moved' || !frame) {
            // Undone, redone, relinked or deleted while it ran: nothing to say about a step that has moved on.
            if (currentLinkedSource(stepId) !== linked) return { press: { status: 'stopped' } };
            // As every host's press says it (`solutionCursorTable.ts`): an end is proved (E9), and Keep
            // trying after a timeout goes on from what it proved.
            return { press: answer.outcome === 'moved' ? { status: 'stopped' } : solutionPressOf(answer) };
          }
          const landed = await posed(
            begun,
            linked,
            document,
            choice.creases,
            { verb: 'layer-order', render, applied: answer.applied, frame },
            {
              tracked: false,
              label: SOLUTION_STEP_LABELS[direction],
              landed: (source) => turn.landed(source.layerOrder ?? ''),
            }
          );
          if (landed.status === 'captured' && landed.changed) trackPose(verb, landed.render, { constrained: true });
          return landed;
        } finally {
          turn.end(store.get());
        }
      }
    );
    showPreview(false);
    if (!outcome) return;
    // Keep trying asks again with the same direction, on the same worker, with longer limits.
    if ('press' in outcome) sayStepSolutionPress(outcome.press, () => void stepSolution(verb, tries + 1), tries);
    // As `pose` says it: a see-through fold says so only as it is first folded.
    else if (!(outcome.status === 'captured' && outcome.noLayerOrder)) sayCaptureOutcome(outcome);
  };

  const run = async (request: LinkedPoseRequest, options?: PoseOptions): Promise<void> => {
    if (request.verb !== 'orbit') cancelOrbit();
    // A constrained flat step's ‹ › step through the solutions that fit its record (H9).
    if ((request.verb === 'next-solution' || request.verb === 'previous-solution') && isConstrainedFlat(stepId)) {
      await stepSolution(request.verb);
      return;
    }
    await pose(request, options);
  };

  /**
   * What the Layer order dialog opens on (H8). With no record: the flat fold
   * the session holds, held first if it holds none — the kernel's at the
   * step's case — read with no fold of its own. With a record: the fold held
   * in its order, when the session holds one now; otherwise the creases folded
   * at the first case and freed, as the Step pane reads them (H7), for the
   * dialog restores a record itself — restoring it here too would ask the host
   * engine twice before the dialog opened, and fold a third time on a clash.
   */
  const sourceToEdit = async (
    begun: StepCaptureStart,
    document: OristudioCpDocumentSnapshot,
    lineIds: readonly number[],
    render: FlatRender,
    linked: DiagramCpSource
  ): Promise<StepFoldSource> => {
    const layerOrder = heldLayerOrderOf(linked);
    if (layerOrder && !session.holdsFlat(document, lineIds, layerOrder.order.json)) {
      return runStepFold(store, begun, 'diagram-capture', (runtime) =>
        stepFoldSource(runtime, lineIds, captureModel(document, render.side))
      );
    }
    // Held already for a record (no restore, at most a turn of its model), or the kernel's fold of the case.
    await session.flat(document, lineIds, render.side, render.foldCase, undefined, layerOrder);
    return session.heldFlatSource();
  };

  const editLayerOrder = async (
    via: DiagramStepLayerOrderVia = 'edit',
    surface: PoseLayerOrderSurface = 'pose'
  ): Promise<boolean> => {
    endPreview();
    const opening = await capturing(
      async (begun, linked): Promise<StepLayerOrderOpening | DiagramCaptureOutcome | 'spatial'> => {
        // Edit… is a flat fold's (D13); Review… opens on the flat fold the step would show (D14).
        if (via === 'edit' && linked.render.mode !== 'folded-flat') return { status: 'discarded' };
        const render = flatPoseOf(stepId, linked);
        if (!render) return { status: 'discarded' };
        const { document, choice } = await creasesFor(begun, linked);
        if (choice.status !== 'found') return choice;
        const lineIds = choice.creases.foldLineIds;
        const route = resolveFoldRoute(document, lineIds);
        if (route.kind === 'none') return { status: 'missing' };
        if (route.kind === 'spatial') return 'spatial';
        const folded = await abandonOnEngineLoss(sourceToEdit(begun, document, lineIds, render, linked));
        return {
          request: stepLayerOrderRequest(
            stepId,
            surface,
            begun.style,
            store.get().oristudioCpViewport,
            render,
            folded,
            stepLayerOrderOf(linked.layerOrder),
            layerOrderRegionOf(document, choice.creases)
          ),
          frame: folded.frame,
          render,
          guard: stepLayerOrderGuard(begun),
        };
      }
    );
    if (opening === 'spatial') {
      sayStepFoldsIn3d();
      return false;
    }
    if (!opening) return false;
    if ('status' in opening) {
      sayCaptureOutcome(opening);
      return false;
    }
    // An undo or a capture moved the step while it was read: the dialog would open on what it no longer is.
    if (disposed || !stillOpenedOn(stepId, opening.guard)) return false;
    // The capture is over before the dialog opens: nothing is held busy while it is up.
    const outcome = await openLayerOrderDialog(opening.request);
    // Only turned: Rotate's own verb, on the flat fold the step shows; counted by the dialog, not as a pose.
    if (outcome.kind === 'unchanged' && outcome.turnDeg !== undefined && stepTurnedRender(stepId, outcome.turnDeg)) {
      await pose({ verb: 'rotate-to', degrees: outcome.turnDeg }, { tracked: false, opened: opening.guard });
    }
    if (outcome.kind !== 'applied') return false;
    // One undo step, named as the Step pane's Apply names it, turned as the dialog left it; counted by the
    // dialog, not as a pose.
    const render = turnedFlatRender(opening.render, outcome.turnDeg);
    const applied = await pose(
      { verb: 'layer-order', applied: outcome.applied, frame: opening.frame, render },
      { tracked: false, opened: opening.guard, label: APPLY_LAYER_ORDER_LABEL }
    );
    return applied?.status === 'captured';
  };

  /**
   * Let go of a fold held in an order the step's record no longer has — an
   * Apply undone, or redone — rather than keep it until the next verb folds
   * again (H8). Never under this controller's own capture, which may be
   * reading that fold as the undo lands (a turn's picture, Edit order…'s
   * source): its kernel calls would meet a freed handle. Once it is over, the
   * record the step has then decides.
   */
  const releaseStaleHold = () => {
    if (disposed) return;
    // After this capture, and any that began as it ended.
    if (own) {
      void own.then(releaseStaleHold, releaseStaleHold);
      return;
    }
    if (session.releaseUnlessIn(currentLinkedSource(stepId)?.layerOrder ?? null)) heldFor = null;
  };

  const wantsRest = (pose: Pick<SimulatedRest, 'foldPercent' | 'view'>): boolean => {
    const linked = currentLinkedSource(stepId);
    if (linked?.render.mode !== 'simulated') return false;
    return !sameSimulatedPose(linked.render, pose) || needsRecapture(stepId, linked);
  };

  const cancelOrbit = () => {
    orbitGeneration++;
    if (orbitTimer) clearTimeout(orbitTimer);
    orbitTimer = null;
    nextOrbit = null;
  };

  /**
   * The step's flat fold with a spread, from the fold the session holds: the
   * picture, or null when it cannot be drawn cheaply (past the budget, or a
   * fold with no layer order) — the commit draws it — or undefined when no
   * fold of these creases is held.
   */
  const drawPreview = (spread: LayerSpreadOptions): DiagramScenePicture | null | undefined => {
    const linked = currentLinkedSource(stepId);
    const document = useWorkspaceStore.getState().oristudioCpDocument?.document;
    if (linked?.render.mode !== 'folded-flat' || !document) return null;
    if (heldFor?.key !== linkedFoldKey(stepId, linked) || heldFor.document !== document) return undefined;
    const { side, foldCase, rotationDeg } = linked.render;
    const layerOrder = linked.layerOrder ?? null;
    const drawn = session.heldFlatPicture({ document, side, foldCase, layerOrder }, rotationDeg, spread);
    if (!drawn) return undefined;
    return drawn.kind === 'picture' && drawn.picture.kind === 'scene' ? drawn.picture : null;
  };

  /**
   * Tell the view the newest preview — the slider dragged to, the rest of the
   * step's own spread as it is — and fold for it, once, when nothing is held
   * to draw it from. A step whose spread went off meanwhile, or became one the
   * slider is not of — a skew on a depth spread, an amount of the other kind —
   * has nothing to preview.
   */
  const showPreview = (hold: boolean) => {
    const linked = currentLinkedSource(stepId);
    if (previewing === null || !linked) return;
    const stored = linked.render.mode === 'folded-flat' ? linked.render.spread : undefined;
    if (!stored || !slideFits(stored, previewing)) {
      endPreview();
      return;
    }
    const slide = previewing;
    // The slide being committed while it can still land: begun at the step's
    // revision as it is (`commitStepCapture`), not one an undo took back.
    const landing = committing && committing.revision === stepRevision(stepId) ? [committing.slide] : [];
    const slides = [...landing, ...waiting.values(), slide];
    const spread = slides.reduce(withSlide, stored);
    const picture = spread.kind === 'connected' ? null : drawPreview(spread);
    listener.preview({ slide, slides, spread, picture: picture ?? null }, linkedFoldKey(stepId, linked));
    if (picture === undefined && hold) holdForPreview();
  };

  /** Fold the step's flat fold and read it, for previews to draw from: a capture with nothing to commit. */
  const holdForPreview = () => {
    holding ??= capturing(async (begun, linked) => {
      if (linked.render.mode !== 'folded-flat') return null;
      const { document, choice } = await creasesFor(begun, linked);
      if (choice.status !== 'found') return null;
      const { side, foldCase, rotationDeg } = linked.render;
      const layerOrder = heldLayerOrderOf(linked);
      try {
        await abandonOnEngineLoss(session.flat(document, choice.creases.foldLineIds, side, foldCase, undefined, layerOrder));
      } catch (error) {
        // Not drawn in its order: no preview, and nothing kept for a drag; the verb it ends in keeps it.
        if (error instanceof LayerOrderNotShownError) return null;
        throw error;
      }
      await abandonOnEngineLoss(session.flatPicture(rotationDeg));
      heldFor = { key: linkedFoldKey(stepId, linked), document };
      return null;
    }).then(() => {
      holding = null;
      // Drawn now, if it can be; never folded for again.
      showPreview(false);
    });
  };

  const endPreview = () => {
    if (previewing === null) return;
    previewing = null;
    listener.preview(null, null);
  };

  const drainOrbit=():Promise<void>=> {
    orbiting??=(async()=>{
      await null;
      try {
        while(nextOrbit && !orbitTimer) {
          while(own)await own;
          if (orbitTimer) break;
          const next=nextOrbit;nextOrbit=null;
          if(!next||disposed)break;
          if(next.loadId!==useWorkspaceStore.getState().diagramLoadId)continue;
          const generation = orbitGeneration;
          await run({verb:'orbit',camera:next.camera}, { current: () => generation === orbitGeneration && !disposed });
        }
      } finally {orbiting=null;}
    })();
    return orbiting;
  };
  const dispose=()=>{
    disposed=true;cancelOrbit();waiting.clear();heldFor=null;endPreview();
    dropStepSolutionCursor(stepId);
    if(start)useWorkspaceStore.getState().stopDiagramCapture(stepId);
    session.dispose();
  };

  return {
    run,

    editLayerOrder,

    orbit(camera, stored) {
      cancelOrbit();
      if (!stored || sameCamera(camera, stored) || disposed) return;
      nextOrbit={camera,loadId:useWorkspaceStore.getState().diagramLoadId};
      orbitTimer=setTimeout(()=>{orbitTimer=null;void drainOrbit();},ORBIT_SETTLE_MS);
    },

    wantsRest,

    simulate(rest) {
      // One rest at a time, the newest waiting: a rest that came after the
      // one being captured is what the view shows, so it must not be refused
      // as busy and lose to it.
      nextRest = rest;
      simulating ??= (async () => {
        // Held before the first rest is looked at, so a rest that needs no
        // capture cannot finish — and let `simulating` go — before it is set.
        await null;
        try {
          while (nextRest) {
            const next = nextRest;
            nextRest = null;
            if (!wantsRest(next)) continue;
            await run({ verb: 'simulate', ...next });
          }
        } finally {
          simulating = null;
        }
      })();
      return simulating;
    },

    previewSpread(slide) {
      if (disposed) return;
      previewing = slide;
      previews += 1;
      showPreview(true);
    },

    commitSpread() {
      if (previewing === null || disposed) return Promise.resolve();
      waiting.set(previewing.slider, previewing);
      const asked = previews;
      spreading ??= (async () => {
        await null;
        try {
          for (;;) {
            // Its own capture first — a fold a preview asked for, a verb — rather than refused as busy.
            while (own) await own;
            // Read after the wait: an undo, a new document, a lost engine or
            // the detail closing takes back the values that were waiting.
            const next = waiting.entries().next();
            if (next.done || disposed) break;
            const [slider, slide] = next.value;
            waiting.delete(slider);
            committing = { slide, revision: stepRevision(stepId) };
            try {
              await run(slideRequest(slide));
            } finally {
              committing = null;
            }
            // Redrawn on the spread it landed in, under a slider still held.
            if (previewing !== null) showPreview(false);
          }
        } finally {
          spreading = null;
        }
      })();
      return spreading.then(() => {
        if (previews === asked) endPreview();
      });
    },

    async prepareConnected() {
      // Switching from a legacy spread can still be committing its picture.
      // Prepare the live view after that capture, instead of losing it as busy.
      while (own) await own;
      await capturing(async (begun, linked) => {
        if (linked.render.mode !== 'folded-flat') return null;
        const {document, choice} = await creasesFor(begun, linked);
        if (choice.status !== 'found') return null;
        try {
          await abandonOnEngineLoss(session.flat(document, choice.creases.foldLineIds, linked.render.side, linked.render.foldCase,
            undefined, heldLayerOrderOf(linked)));
        } catch (error) {
          // Keep the saved picture when its order cannot be restored, just as a legacy preview does.
          if (error instanceof LayerOrderNotShownError) return null;
          throw error;
        }
        const view = await abandonOnEngineLoss(session.connectedView());
        listener.connected?.(view, linkedFoldKey(stepId, linked) + ':' + linked.render.side + ':' + linked.render.foldCase);
        heldFor = {key: linkedFoldKey(stepId, linked), document};
        return null;
      });
    },

    async prepareSpatial() {
      await capturing(async (begun, linked) => {
        const { document, choice } = await creasesFor(begun, linked);
        if (choice.status !== 'found') return null;
        const held = await abandonOnEngineLoss(session.spatial(document, choice.creases.foldLineIds));
        // A refusal leaves the captured picture to look at; a verb will say why.
        if (held.kind !== 'refused') {
          listener.spatial(
            { model: held.fold.render, aux: held.aux },
            linkedFoldKey(stepId, {
              scope: linked.scope,
              // The step's own fingerprint while its creases match it (a `cs1:`
              // one included): the key the live view is looked for by.
              fingerprint: creasesMatch(choice.creases, knownCreasesOf(linked))
                ? linked.fingerprint
                : creasesFingerprint(choice.creases, linked.render),
              layerOrder: linked.layerOrder,
            })
          );
        }
        return null;
      });
    },

    historyMoved() {
      cancelOrbit();
      // A rest still waiting is of the view before the undo.
      nextRest = null;
      useWorkspaceStore.getState().stopDiagramCapture(stepId);
      // Heard before the undo or redo runs, which may be of another step: the
      // slides waiting and the drag shown are of a pose it takes back only if
      // it moves this step, as the slide being committed is (`committing`).
      const revision = stepRevision(stepId);
      queueMicrotask(() => {
        if (disposed || stepRevision(stepId) === revision) return;
        waiting.clear();
        endPreview();
        releaseStaleHold();
      });
    },

    documentReplaced() {
      cancelOrbit();
      nextRest = null;
      waiting.clear();
      heldFor = null;
      endPreview();
      useWorkspaceStore.getState().stopDiagramCapture(stepId);
      session.dispose();
      listener.spatial(null, null);
      listener.connected?.(null, null);
    },

    engineLost() {
      cancelOrbit();
      nextRest = null;
      waiting.clear();
      heldFor = null;
      endPreview();
      session.forget();
      listener.spatial(null, null);
      listener.connected?.(null, null);
    },

    dispose(options) {
      if(options?.flushOrbit&&(nextOrbit||orbiting)) {
        if(orbitTimer)clearTimeout(orbitTimer);orbitTimer=null;
        void drainOrbit().finally(dispose);
      } else dispose();
    },
  };
}

/** The spreads this step's flat fold starts from: the nearest earlier steps', else the defaults (13g). */
function spreadStartsOf(stepId: string) {
  const { diagram } = useWorkspaceStore.getState();
  return diagram ? spreadStartsFor(diagram, stepId) : undefined;
}

/** The step's source, if it is still in the diagram and linked. */
/** The step's revision: what a capture begun now is guarded by. */
function stepRevision(stepId: string): number | undefined {
  const { diagram } = useWorkspaceStore.getState();
  return diagram ? stepById(diagram, stepId)?.revision : undefined;
}

function currentLinkedSource(stepId: string): DiagramCpSource | null {
  const { diagram } = useWorkspaceStore.getState();
  const step = diagram ? stepById(diagram, stepId) : null;
  return step && !step.unknown && step.source?.kind === 'cp' ? step.source : null;
}

/** Whether the step is shown folded flat in a layer order its record keeps, as this build reads it (H9). */
function isConstrainedFlat(stepId: string): boolean {
  const linked = currentLinkedSource(stepId);
  return linked?.render.mode === 'folded-flat' && stepLayerOrderOf(linked.layerOrder) !== null;
}

/** Whether a rest is where the step's simulated picture already is, to well under a slider's step. */
function sameSimulatedPose(
  render: Extract<DiagramCpSource['render'], { mode: 'simulated' }>,
  rest: Pick<SimulatedRest, 'foldPercent' | 'view'>
): boolean {
  return Math.abs(render.foldPercent - rest.foldPercent) < SAME_FOLD_PERCENT && sameCamera(render.view, rest.view);
}

/** Fold % closer than this is one pose: the 0.1 a pose is stored to, halved. */
const SAME_FOLD_PERCENT = 0.05;

/**
 * Whether a step's picture is not of its pattern as it is now, or not in the
 * diagram's light: what Pose again is for (D19). Unknown — the sheet index
 * not ready — is not out of date: a capture would find out no more.
 */
function needsRecapture(stepId: string, linked: DiagramCpSource): boolean {
  const { diagram, oristudioCpDocument } = useWorkspaceStore.getState();
  const step = diagram ? stepById(diagram, stepId) : null;
  if (!diagram || !step) return false;
  const document = oristudioCpDocument?.document ?? null;
  const status = linkStatus(linked, document, peekCpSheetIndex(document));
  return status === 'stale' || (status === 'current' && lightingChanged(step, diagram.style));
}

/**
 * The step's source after a pose: the same scope — or its sheet where it moved
 * to — its creases fingerprinted as the new render shows them. A pose of a
 * step that keeps a fingerprint from before (`cs1:`) keeps it while its
 * creases still match it and the render takes it over the same lines: a turn
 * is not a new picture, and its annotations carry. Show as, Refresh and
 * Relink write the relative one.
 */
function linkedSource(
  previous: DiagramCpSource,
  creases: StepCreases,
  document: OristudioCpDocumentSnapshot,
  render: DiagramCpSource['render'],
  shown?: FlatFoldState['layerOrder']
): DiagramCpSource {
  const sameLines = (previous.render.mode === 'crease-pattern') === (render.mode === 'crease-pattern');
  const keep = !isRelativeFingerprint(previous.fingerprint) && sameLines && creasesMatch(creases, knownCreasesOf(previous));
  const layerOrder = layerOrderAfterPose(previous, render, shown);
  const stored = storedCpSource({
    kind: 'cp',
    scope: followedScope(previous.scope, creases),
    fingerprint: keep ? previous.fingerprint : creasesFingerprint(creases, render),
    thumbnail: creasesThumbnail(document, creases),
    render,
    ...(layerOrder !== undefined ? { layerOrder } : {}),
  });
  if (!stored) throw new Error('The pose made a link the file cannot read');
  return stored;
}

/**
 * The step's layer order record after a pose (H7): the record of the order
 * a flat pose drew; for a pose in 3D, kept, waiting for its creases to fold
 * flat again (D13); for any other way of showing it, as it was. A pose never
 * drops it — Reset Pose included.
 */
function layerOrderAfterPose(
  previous: DiagramCpSource,
  render: DiagramCpSource['render'],
  shown: FlatFoldState['layerOrder'] | undefined
): string | undefined {
  if (shown) return shown.order.json;
  const kept = stepLayerOrderOf(previous.layerOrder);
  if (!kept) return previous.layerOrder;
  return render.mode === 'folded-3d' ? routed3dLayerOrder(kept).json : kept.json;
}

/** The step's layer order, for its held flat fold to be drawn in: its record and the host engine; null for none. */
function heldLayerOrderOf(linked: DiagramCpSource): HeldLayerOrder | null {
  const order = stepLayerOrderOf(linked.layerOrder);
  return order ? { order, resolve: layerOrderResolver() } : null;
}

/** What a pose left the step's record needing, when that is new: it came to need a look, or for another reason. */
function newAttention(before: DiagramCpSource, after: DiagramCpSource): LayerOrderAttention | null {
  const was = layerOrderSummaryOf(before)?.attention ?? null;
  const is = layerOrderSummaryOf(after)?.attention ?? null;
  return is && !sameAttention(was, is) ? is : null;
}

/**
 * A pose whose fold was not drawn in the step's layer order: kept back
 * (D10), the step keeps its picture and its record is flagged, one undo step;
 * the host engine not there, or a Stop, keeps nothing at all.
 */
function keepLayerOrder(begun: StepCaptureStart, error: LayerOrderNotShownError): DiagramCaptureOutcome {
  const { why } = error;
  if (!why) return { status: 'stopped' };
  if (why.kind === 'lost') return { status: 'layer-order-lost', offline: why.cause === 'load' };
  const committed = useWorkspaceStore.getState().commitDiagramLayerOrder(begun, why.layerOrder.json, POSE_LABEL);
  if (!committed) return { status: 'discarded' };
  if (committed.changed) trackStepLayerOrderAttention(why.attention);
  return { status: 'needs-attention', attention: why.attention, changed: committed.changed };
}

export function sameCamera(a: FoldedFigureCamera, b: FoldedFigureCamera): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  if (!close(a.yaw, b.yaw) || !close(a.pitch, b.pitch) || !close(a.zoom, b.zoom)) return false;
  if (!a.orient || !b.orient) return !a.orient && !b.orient;
  return a.orient.every((value, index) => close(value, b.orient![index]!));
}
