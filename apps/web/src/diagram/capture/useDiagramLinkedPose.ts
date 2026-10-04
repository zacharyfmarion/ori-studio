import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerCanvasSessionEnder } from '../../cp-workspace/canvasObjects/canvasSessions';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import { onEngineLost } from '../../engines/engineHost';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  buildDiagramLinkedPoseActions,
  buildDiagramSpreadControls,
  layerOrderLabel,
  SHOW_AS_ACTION,
  type DiagramLinkedPoseAction,
  type DiagramLinkedPoseState,
  type DiagramSpreadControls,
} from '../actions/diagramLinkedPoseActions';
import { withCarriedAnnotations } from '../annotate/annotationCarry';
import {
  clampSpreadAmount,
  showAsOf,
  stepById,
  type DiagramShowAs,
  type DiagramStep,
} from '../document/diagramDocument';
import { publishOpenLinkedPose } from './openLinkedPose';
import {
  createPoseController,
  linkedFoldKey,
  type DiagramPoseSpatialView,
  type SimulatedRest,
  type SpreadPreview,
} from './poseController';

export type { DiagramPoseSpatialView };

/** A flat fold's spread while it is on (Phase 13): what the Step pane shows of it, and its amount's drag. */
export interface DiagramLinkedSpread extends DiagramSpreadControls {
  /** Show the picture at this amount before it is committed: each move of a drag, or a key. */
  previewAmount: (amount: number) => void;
  /** Commit the amount previewed, as one undo step: the end of a drag, or a key. */
  commitAmount: () => void;
  /** Whether a drag may start: not on a diagram that cannot change, nor a picture with no layers. */
  startAmount: () => boolean;
}

export interface DiagramLinkedPose {
  actions: DiagramLinkedPoseAction[];
  /** A flat fold's place among its layer orders ("2 of 5+"), for the pager between its verbs; null otherwise. */
  layerOrder: { count: string; label: string } | null;
  /** The live 3D fold, for a step shown in 3D once it is folded; null otherwise. */
  spatial: DiagramPoseSpatialView | null;
  /** The 3D view moved: captured once it rests. */
  onCamera: (camera: FoldedFigureCamera) => void;
  /** Turn a crease pattern or a flat fold to an angle, in degrees clockwise (D5). */
  rotateTo: (degrees: number) => void;
  /**
   * Show the pattern another way, in the pose that way last had (D19), for a
   * surface beside Pose (the Step pane, a card), which counts it itself.
   * Whether the step now shows it that way.
   */
  showAs: (way: DiagramShowAs) => Promise<boolean>;
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

/**
 * Pose for a step linked to the crease pattern, while its detail is open
 * (`poseController.ts`): its verbs, its live 3D fold, and a flat fold's spread
 * with the preview a drag of its amount shows (Phase 13). One controller per
 * open step, let go when the step changes or the detail closes; it hears an
 * undo or redo, the crease pattern being replaced and the engine being lost.
 * Null for a step that is not linked. What it returns is also published for
 * the Step pane (`openLinkedPose.ts`), so the pane's verbs are this
 * controller's.
 */
export function useDiagramLinkedPose(step: DiagramStep | null): DiagramLinkedPose | null {
  const { t } = useTranslation();
  const source = step && !step.unknown && step.source?.kind === 'cp' ? step.source : null;
  const stepId = source ? step!.id : null;
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const busy = useWorkspaceStore((state) => stepId !== null && Object.hasOwn(state.diagramCaptures, stepId));
  // Each kept with the creases it was learnt from (`linkedFoldKey`): after a
  // Relink or an undo the step links to others, and these are not theirs.
  const [spatial, setSpatial] = useState<{ key: string; view: DiagramPoseSpatialView } | null>(null);
  const [found, setFound] = useState<{ key: string; value: DiagramLinkedPoseState['solutions'] } | null>(null);
  const [previewed, setPreviewed] = useState<{ key: string; value: SpreadPreview } | null>(null);
  const foldKey = useMemo(() => (source && stepId ? linkedFoldKey(stepId, source) : null), [source, stepId]);

  const controller = useMemo(
    () =>
      stepId === null
        ? null
        : createPoseController(stepId, {
            spatial: (view, key) => setSpatial(view && key ? { key, view } : null),
            solutions: (value, key) => setFound({ key, value }),
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
      controller.dispose();
    };
  }, [controller]);

  // A step shown in 3D: fold it for the live view as its detail opens.
  const showsSpatial = source?.render.mode === 'folded-3d';
  const view = showsSpatial && spatial !== null && spatial.key === foldKey ? spatial.view : null;
  useEffect(() => {
    if (controller && showsSpatial && !view) void controller.prepareSpatial();
  }, [controller, showsSpatial, view]);

  const storedCamera = source?.render.mode === 'folded-3d' ? source.render.camera : null;
  const onCamera = useCallback(
    (camera: FoldedFigureCamera) => controller?.orbit(camera, storedCamera),
    [controller, storedCamera]
  );

  const render = source?.render ?? null;
  const solutions = found !== null && found.key === foldKey ? found.value : null;
  // A flat fold drawn as its see-through development has no layers to spread.
  const seeThrough = render?.mode === 'folded-flat' && step?.picture?.kind === 'fixed';
  const poseState = useMemo(
    (): DiagramLinkedPoseState | null => (render ? { render, readOnly, busy, solutions, seeThrough } : null),
    [render, readOnly, busy, solutions, seeThrough]
  );
  const actions = useMemo(
    () =>
      poseState && controller
        ? buildDiagramLinkedPoseActions(poseState, { t, pose: (verb) => void controller.run({ verb }) })
        : [],
    [poseState, t, controller]
  );

  // A drag of the spread's amount, previewed: shown only while the step links to the creases it was drawn from.
  const shownPreview = previewed !== null && previewed.key === foldKey ? previewed.value : null;
  const spread = useMemo((): DiagramLinkedSpread | null => {
    if (!poseState || !controller) return null;
    const controls = buildDiagramSpreadControls(poseState, shownPreview?.spread ?? null, {
      t,
      direction: (toward) => void controller.run({ verb: 'spread-direction', toward }),
    });
    if (!controls) return null;
    return {
      ...controls,
      previewAmount: (amount) => controller.previewSpread({ ...controls.spread, amount: clampSpreadAmount(amount) }),
      commitAmount: () => void controller.commitSpread(),
      startAmount: () => !controls.disabled,
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
  const layerOrder = render ? layerOrderLabel(render, solutions, t) : null;

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

  const pose = useMemo(
    () =>
      source
        ? { actions, layerOrder, spatial: view, onCamera, rotateTo, showAs, simulate, wantsRest, spread, preview }
        : null,
    [source, actions, layerOrder, view, onCamera, rotateTo, showAs, simulate, wantsRest, spread, preview]
  );
  // The Step pane offers these verbs too, through this one controller.
  useEffect(() => publishOpenLinkedPose(stepId, pose), [stepId, pose]);
  useEffect(() => () => publishOpenLinkedPose(null, null), []);
  return pose;
}
