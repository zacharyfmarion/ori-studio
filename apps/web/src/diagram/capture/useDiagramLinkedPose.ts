import { useSpatialSpreadAmount, type SpatialSpreadAmount } from './useSpatialSpreadAmount';
import { queueStepPoseEdit } from './stepPoseQueue';
import type { ConnectedSpreadView } from '../../layer-spread/view';
import type { SpreadPresentation } from '../../layer-spread/presentation';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { registerCanvasSessionEnder } from '../../cp-workspace/canvasObjects/canvasSessions';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import { onEngineLost } from '../../engines/engineHost';
import { announceUprightSet } from '../../lib/uprightFeedback';
import type { SimulatorViewHandle } from '../../simulator/simulatorViewRegistry';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  buildDiagramLinkedPoseActions,
  buildDiagramSpreadControls,
  layerOrderLabel,
  SHOW_AS_ACTION,
  solutionPlaceLabel,
  type DiagramLinkedPoseAction,
  type DiagramLinkedPoseState,
  type DiagramLinkedPoseVerb,
  type DiagramSpreadControls,
} from '../actions/diagramLinkedPoseActions';
import {
  buildDiagramPoseLayerOrderEntry,
  type DiagramStepLayerOrderEntry,
} from '../actions/diagramStepLayerOrderActions';
import { layerOrderSummaryOf } from './captureLayerOrder';
import { withCarriedAnnotations } from '../annotate/annotationCarry';
import {
  clampSpreadAmount,
  clampSpreadAxis,
  clampSpreadSkew,
  showAsOf,
  stepById,
  type DiagramShowAs,
  type DiagramStep,
} from '../document/diagramDocument';
import { creasePatternPaperShows, type CreasePatternPaperRequest } from './creasePatternSide';
import { publishOpenLinkedPose } from './openLinkedPose';
import { stepSolutionCursorVersion, stepSolutionPlace, subscribeStepSolutionCursor } from './stepSolutionCursor';
import { useDiagramLinkStatuses } from './useLinkStatus';
import type { DiagramStepLayerOrderVia } from './stepLayerOrderActions';
import {
  createPoseController,
  linkedFoldKey,
  withSlide,
  type DiagramPoseSpatialView,
  type PoseLayerOrderSurface,
  type SimulatedRest,
  type SpreadPreview,
  type SpreadSlider,
} from './poseController';

export type { DiagramPoseSpatialView };

/** A flat fold's spread while it is on (Phase 13): what the Step pane shows of it, and its sliders' drags. */
export interface DiagramLinkedSpread extends DiagramSpreadControls {
  /**
   * Show the picture with a slider at this value — an amount as a fraction,
   * a skew from 0 to 1, an axis in degrees — before it is committed: each
   * move of a drag, or a key.
   */
  preview: (slider: SpreadSlider, value: number) => void;
  previewReveal: (value: [number, number]) => void;
  /** Commit the slide previewed, as one undo step: the end of a drag, or a key. */
  commit: () => void;
  /** Whether a drag may start: not on a diagram that cannot change, nor a picture with no layers. */
  start: () => boolean;
}

export interface DiagramLinkedPose {
  spatialAmount?: SpatialSpreadAmount | null;
  connected: ConnectedSpreadView | null;
  connectedPreparing: boolean;
  connectedSpread: import('@oristudio/layer-spread').ConnectedSpread | null;
  onReveal: (reveal: [number, number]) => void;
  setPresentation: (kind: SpreadPresentation['kind']) => Promise<void>;
  actions: DiagramLinkedPoseAction[];
  /**
   * The step detail's toolbar's verbs: {@link DiagramLinkedPose.actions}, but
   * with no readout between its ‹ and ›, Next Layer Order holds at the last
   * order rather than wrapping round (Round 4, H8).
   */
  toolbar: DiagramLinkedPoseAction[];
  /**
   * A flat fold's place among its layer orders ("2 of 5+"), for the Step
   * pane's pager between its verbs; for a step whose order is a record's
   * (H7), its place among the solutions that fit once a press has asked (H9),
   * and null before; null for any other render.
   */
  layerOrder: { count: string } | null;
  /** The toolbar's Edit order… (H8): the Layer order dialog on the fold Pose holds; null for a step not folded. */
  layerOrderEdit: DiagramStepLayerOrderEntry | null;
  /**
   * Open the Layer order dialog on the fold Pose holds, and commit an Apply
   * (`PoseController.editLayerOrder`): Edit order…'s, and the Step pane's
   * Edit… and Review… while the step is open here, each saying which it is
   * (`surface`). Whether it applied one.
   */
  editLayerOrder: (via?: DiagramStepLayerOrderVia, surface?: PoseLayerOrderSurface) => Promise<boolean>;
  /** The live 3D fold, for a step shown in 3D once it is folded; null otherwise. */
  spatial: DiagramPoseSpatialView | null;
  /** The 3D view moved: captured once it rests. */
  onCamera: (camera: FoldedFigureCamera) => void;
  /**
   * A live view — the 3D one, or the simulator — showing the step, for Set
   * Upright: registered while its viewport is up, and the unregister.
   */
  registerLiveView: (view: SimulatorViewHandle) => () => void;
  /** Turn a crease pattern or a flat fold to an angle, in degrees clockwise (D5). */
  rotateTo: (degrees: number) => void;
  /**
   * Show the pattern another way, in the pose that way last had (D19), for a
   * surface beside Pose (the Step pane, a card), which counts it itself.
   * Whether the step now shows it that way.
   */
  showAs: (way: DiagramShowAs) => Promise<boolean>;
  /**
   * Put a crease pattern's paper on the colour of a side — nothing else about
   * the picture changes — for the Step pane's Front | Back, counted as the
   * paper's side. Whether the step's paper is now that side's colour.
   */
  setSide: (side: 'front' | 'back') => Promise<boolean>;
  /**
   * Turn a crease pattern's Flip creases on or off, on its back — its paper
   * turned over side to side, mirrored and its mountains and valleys swapped
   * — for the Step pane's switch, counted as on or off. Whether it is now as
   * asked; false for a pattern on its front, which has no such field.
   */
  setFlipCreases: (on: boolean) => Promise<boolean>;
  /** Pose's simulator came to rest: captured, if it is not the step's picture already (D19). */
  simulate: (rest: SimulatedRest) => Promise<void>;
  /** Whether a rest at this pose would be captured: asked before its scene is drawn. */
  wantsRest: (pose: Pick<SimulatedRest, 'foldPercent' | 'view'>) => boolean;
  /** A flat fold's spread, for the Step pane, while its layers are spread; null otherwise (Phase 13). */
  spread: DiagramLinkedSpread | null;
  /**
   * The step as a spread being dragged shows it — its picture drawn from the
   * held fold, its annotations carried — for the detail to show in its place;
   * null when nothing is previewed.
   */
  preview: DiagramStep | null;
}

const NO_STEPS: readonly DiagramStep[] = [];

/**
 * Pose for a step linked to the crease pattern, while its detail is open
 * (`poseController.ts`): its verbs, its live 3D fold, and a flat fold's spread
 * with the preview a drag of one of its sliders shows (Phase 13). One controller per
 * open step, let go when the step changes or the detail closes; it hears an
 * undo or redo, the crease pattern being replaced and the engine being lost.
 * Null for a step that is not linked. What it returns is also published for
 * the Step pane (`openLinkedPose.ts`), so the pane's verbs are this
 * controller's.
 */
export function useDiagramLinkedPose(
  step: DiagramStep | null,
  { live = true }: { live?: boolean } = {}
): DiagramLinkedPose | null {
  const { t } = useTranslation();
  const source = step && !step.unknown && step.source?.kind === 'cp' ? step.source : null;
  const stepId = source ? step!.id : null;
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const busy = useWorkspaceStore((state) => stepId !== null && Object.hasOwn(state.diagramCaptures, stepId));
  const blockingCapture = useWorkspaceStore((state) => stepId !== null && state.diagramCaptures[stepId]?.blocksPose === true);
  // Each kept with the creases it was learnt from (`linkedFoldKey`): after a
  // Relink or an undo the step links to others, and these are not theirs.
  const [connected, setConnected] = useState<{key: string; view: ConnectedSpreadView} | null>(null);
  const [spatial, setSpatial] = useState<{ key: string; view: DiagramPoseSpatialView } | null>(null);
  const [found, setFound] = useState<{ key: string; value: DiagramLinkedPoseState['solutions'] } | null>(null);
  const [measured, setMeasured] = useState<{ key: string; value: readonly number[] | null } | null>(null);
  const [previewed, setPreviewed] = useState<{ key: string; value: SpreadPreview } | null>(null);
  const foldKey = useMemo(() => (source && stepId ? linkedFoldKey(stepId, source) : null), [source, stepId]);

  const controller = useMemo(
    () =>
      stepId === null
        ? null
        : createPoseController(stepId, {
            connected: (view, key) => setConnected(view && key ? {key, view} : null),
            spatial: (view, key) => setSpatial(view && key ? { key, view } : null),
            solutions: (value, key) => setFound({ key, value }),
            mirrorAxes: (value, key) => setMeasured({ key, value }),
            preview: (value, key) => setPreviewed(value && key ? { key, value } : null),
          }),
    [stepId]
  );
  useEffect(() => {
    if (!controller) return undefined;
    const unregister = registerCanvasSessionEnder((reason) =>
      reason === 'history' ? controller.historyMoved() : controller.documentReplaced()
    );
    const unlisten = onEngineLost(({ engine }) => {
      if (engine === 'oristudio-cp') controller.engineLost();
    });
    return () => {
      unregister();
      unlisten();
      controller.dispose({flushOrbit:true});
      // Its preview goes with it, even one it could not take back itself.
      setPreviewed(null);
    };
  }, [controller]);

  // A step shown in 3D: fold it for the live view as its detail opens — not
  // for a step only selected on the pages (`live` false), whose verbs fold it
  // when one runs.
  const showsSpatial = source?.render.mode === 'folded-3d';
  const view = showsSpatial && spatial !== null && spatial.key === foldKey ? spatial.view : null;
  useEffect(() => {
    if (controller && live && showsSpatial && !view) void controller.prepareSpatial();
  }, [controller, live, showsSpatial, view]);

  const flat = source?.render.mode === 'folded-flat' ? source.render : null;
  const connectedKey = flat?.spread?.kind === 'connected' ? foldKey + ':' + flat.side + ':' + flat.foldCase : null;
  const connectedView = connectedKey && connected?.key === connectedKey ? connected.view : null;
  const [finishedPreparation, setFinishedPreparation] = useState<string | null>(null);
  useEffect(() => {
    if (!controller || !live || !connectedKey || connectedView) return;
    let current = true;
    setFinishedPreparation(null);
    // The controller reports failures through the capture lifecycle. In either
    // case stop waiting: an unavailable spread must not leave an endless veil.
    const finish = () => { if (current) setFinishedPreparation(connectedKey); };
    void controller.prepareConnected().then(finish, finish);
    return () => { current = false; };
  }, [controller, live, connectedKey, connectedView]);
  // The saved source stays Affine until a switch to Default finishes capturing.
  // Follow the operation from its start, then hand off to live-view preparation.
  const connectedPreparing = !!(live && (blockingCapture || (connectedKey && !connectedView && finishedPreparation !== connectedKey)));
  const onReveal = useCallback((reveal:[number,number]) => {
    if (readOnly || !controller) return;
    controller.previewSpread({ slider: 'reveal', value: reveal });
    void controller.commitSpread();
  },[controller,readOnly]);
  const setPresentation = useCallback((kind: SpreadPresentation['kind']) => {
    if (readOnly || !controller || !stepId) return Promise.resolve();
    return queueStepPoseEdit(stepId, 'presentation', (current) =>
      controller.run({ verb: 'spread-presentation', kind }, { current }));
  }, [controller, readOnly, stepId]);
  const storedCamera = source?.render.mode === 'folded-3d' ? source.render.camera : flat?.presentation?.camera ?? null;
  const onCamera = useCallback(
    (camera: FoldedFigureCamera) => controller?.orbit(camera, storedCamera),
    [controller, storedCamera]
  );

  // The live view Set Upright turns, while one shows: the latest registered, until it goes.
  const [liveView, setLiveView] = useState<SimulatorViewHandle | null>(null);
  const registerLiveView = useCallback((handle: SimulatorViewHandle) => {
    setLiveView(handle);
    return () => setLiveView((was) => (was === handle ? null : was));
  }, []);

  const render = source?.render ?? null;
  const solutions = found !== null && found.key === foldKey ? found.value : null;
  // Whether it is symmetric: its side or layer order never changes that, only other creases.
  const mirrorAxes = measured !== null && measured.key === foldKey ? measured.value : null;
  // A flat fold drawn as its see-through development has no layers to spread.
  const seeThrough = render?.mode === 'folded-flat' && step?.picture?.kind === 'fixed';
  // From the saved source, never the engine: its order is the record's (H7, D9).
  const constrained = source?.layerOrder !== undefined;
  // Where a constrained step stands among the solutions that fit, once a press has asked (H9): read from
  // the solutions cursor's table, which moves without the step changing (an answer after a turn-over, the
  // cursor let go). Nothing at rest: the host never counts (D11).
  const cursorVersion = useSyncExternalStore(subscribeStepSolutionCursor, stepSolutionCursorVersion);
  const place = useMemo(
    () => (constrained && source && stepId !== null ? stepSolutionPlace(stepId, source) : null),
    // The table's version is what `stepSolutionPlace` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [constrained, source, stepId, cursorVersion]
  );
  // What its record says at rest: one that needs a look holds ‹ › until Review… (D10, D14), from saved data.
  const record = layerOrderSummaryOf(source);
  // Its pattern changed since it was captured: ‹ › wait for a Refresh. Asked only of a constrained step,
  // as the Step pane asks it of every linked one (`useDiagramStepLink`).
  const linkedSteps = useMemo(() => (constrained && step ? [step] : NO_STEPS), [constrained, step]);
  const statuses = useDiagramLinkStatuses(linkedSteps);
  const stale = stepId !== null && statuses.get(stepId) === 'stale';
  const poseState = useMemo(
    (): DiagramLinkedPoseState | null =>
      render
        ? {
            render,
            readOnly,
            busy,
            solutions,
            seeThrough,
            mirrorAxes,
            liveView: liveView !== null,
            constrained,
            place,
            record,
            stale,
          }
        : null,
    [render, readOnly, busy, solutions, seeThrough, mirrorAxes, liveView, constrained, place, record, stale]
  );
  const [actions, toolbar] = useMemo(() => {
    if (!poseState || !controller) return [[], []];
    const deps = {
      t,
      pose: (verb: DiagramLinkedPoseVerb) => void controller.run({ verb }),
      // The picture does not move: the view's next rest captures the camera with its new up, as a drag's does.
      setUpright: liveView
        ? () => {
            liveView.setUpright();
            announceUprightSet(t);
          }
        : undefined,
    };
    return [
      buildDiagramLinkedPoseActions(poseState, deps),
      buildDiagramLinkedPoseActions(poseState, deps, { stopsAtLast: true }),
    ];
  }, [poseState, t, controller, liveView]);

  // The toolbar's Edit order…, from the saved source as the Step pane's Edit… is (H7, H8).
  const editLayerOrder = useCallback(
    async (via?: DiagramStepLayerOrderVia, surface?: PoseLayerOrderSurface) =>
      controller !== null && !readOnly ? controller.editLayerOrder(via, surface) : false,
    [controller, readOnly]
  );
  const layerOrderEdit = useMemo(
    () =>
      render
        ? buildDiagramPoseLayerOrderEntry(
            { render, record, readOnly, busy, seeThrough },
            { t, open: () => void editLayerOrder() }
          )
        : null,
    [render, record, readOnly, busy, seeThrough, t, editLayerOrder]
  );

  // A drag of a spread's slider, previewed: shown only while the step links to the creases it was drawn from.
  const shownPreview = previewed !== null && previewed.key === foldKey ? previewed.value : null;
  const spread = useMemo((): DiagramLinkedSpread | null => {
    if (!poseState || !controller) return null;
    const stored = poseState.render.mode === 'folded-flat' ? poseState.render.spread : undefined;
    // The step's own spread with the dragged slider moved: a preview never
    // outlives the spread it was drawn for, nor says how the rest of it is set.
    const shown = stored && shownPreview ? shownPreview.slides.reduce(withSlide, stored) : null;
    const controls = buildDiagramSpreadControls(poseState, shown, {
      t,
      kind: (kind) => void controller.run({ verb: 'spread-kind', kind }),
      direction: (toward) => void controller.run({ verb: 'spread-direction', toward }),
      keep: (keep) => void controller.run({ verb: 'spread-keep', keep }),
    });
    if (!controls) return null;
    const kind = controls.spread.kind;
    return {
      ...controls,
      preview: (slider, value) =>
        controller.previewSpread(
          slider === 'amount'
            ? { slider, kind, value: clampSpreadAmount(kind, value) }
            : { slider, value: slider === 'skew' ? clampSpreadSkew(value) : slider === 'axis' ? clampSpreadAxis(value) : Math.max(-2,Math.min(2,value)) }
        ),
      previewReveal: (value) => controller.previewSpread({ slider: 'reveal', value }),
      commit: () => void controller.commitSpread(),
      start: () => !controls.disabled,
    };
  }, [poseState, shownPreview, t, controller]);
  const assets = useWorkspaceStore((state) => state.diagram?.assets);
  const preview = useMemo((): DiagramStep | null => {
    if (!step || source?.render.mode !== 'folded-flat' || !shownPreview?.picture) return null;
    const render = { ...source.render, spread: shownPreview.spread };
    const shown: DiagramStep = { ...step, source: { ...source, render }, picture: shownPreview.picture };
    // A mark on the top layer stays on it, as it will when the spread is committed.
    return withCarriedAnnotations(step, shown, assets ?? {});
  }, [step, source, shownPreview, assets]);
  // A record's order has no place in the kernel's enumeration: a constrained step reads out where its
  // solutions cursor stands, once a press has asked (H9), and nothing before (D11).
  const layerOrder = render
    ? constrained
      ? solutionPlaceLabel(render, place, t)
      : layerOrderLabel(render, solutions, t)
    : null;

  const rotateTo = useCallback(
    (degrees: number) => {
      if (controller && !busy && !readOnly) void controller.run({ verb: 'rotate-to', degrees });
    },
    [controller, busy, readOnly]
  );

  const showAs = useCallback(
    async (way: DiagramShowAs): Promise<boolean> => {
      if (!controller || readOnly || stepId === null) return false;
      await controller.run({ verb: SHOW_AS_ACTION[way] }, { tracked: false });
      const { diagram } = useWorkspaceStore.getState();
      const now = diagram ? stepById(diagram, stepId) : null;
      return now?.source?.kind === 'cp' && showAsOf(now.source.render) === way;
    },
    [controller, readOnly, stepId]
  );

  /** A crease pattern's paper verb, run unless the step is drawn so already: whether it is after. */
  const drawPaper = useCallback(
    async (request: CreasePatternPaperRequest): Promise<boolean> => {
      if (!controller || readOnly || stepId === null) return false;
      const before = creasePatternPaperShows(stepId, request);
      if (before === null) return false;
      if (!before) await controller.run(request);
      return creasePatternPaperShows(stepId, request) === true;
    },
    [controller, readOnly, stepId]
  );
  const setSide = useCallback((side: 'front' | 'back') => drawPaper({ verb: 'paper-side', side }), [drawPaper]);
  const setFlipCreases = useCallback((on: boolean) => drawPaper({ verb: 'flip-creases', on }), [drawPaper]);

  const simulate = useCallback(
    async (rest: SimulatedRest) => {
      if (controller && !readOnly) await controller.simulate(rest);
    },
    [controller, readOnly]
  );

  const wantsRest = useCallback(
    (rest: Pick<SimulatedRest, 'foldPercent' | 'view'>) => controller !== null && !readOnly && controller.wantsRest(rest),
    [controller, readOnly]
  );

  const spatialAmount = useSpatialSpreadAmount(foldKey, render, controller, readOnly || busy);
  const pose = useMemo(
    () =>
      source
        ? {
            actions,
            toolbar,
            layerOrder,
            layerOrderEdit,
            editLayerOrder,
            spatial: view,
            spatialAmount,
            connected: connectedView,
            connectedPreparing,
            connectedSpread: shownPreview?.spread.kind === 'connected' ? shownPreview.spread : flat?.spread?.kind === 'connected' ? flat.spread : null,
            setPresentation,
            onReveal,
            onCamera,
            registerLiveView,
            rotateTo,
            showAs,
            setSide,
            setFlipCreases,
            simulate,
            wantsRest,
            spread,
            preview,
          }
        : null,
    [
      source,
      actions,
      toolbar,
      layerOrder,
      layerOrderEdit,
      editLayerOrder,
      view,
      spatialAmount,
      connectedView,
      connectedPreparing,
      shownPreview,
      flat,
      setPresentation,
      onReveal,
      onCamera,
      registerLiveView,
      rotateTo,
      showAs,
      setSide,
      setFlipCreases,
      simulate,
      wantsRest,
      spread,
      preview,
    ]
  );
  // The Step pane offers these verbs too, through this one controller.
  useEffect(() => publishOpenLinkedPose(stepId, pose), [stepId, pose]);
  useEffect(() => () => publishOpenLinkedPose(null, null), []);
  return pose;
}
