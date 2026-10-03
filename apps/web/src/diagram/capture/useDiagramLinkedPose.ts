import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerCanvasSessionEnder } from '../../cp-workspace/canvasObjects/canvasSessions';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import { onEngineLost } from '../../engines/engineHost';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  buildDiagramLinkedPoseActions,
  type DiagramLinkedPoseAction,
} from '../actions/diagramLinkedPoseActions';
import type { DiagramStep } from '../document/diagramDocument';
import { createPoseController, type DiagramPoseSpatialView } from './poseController';

export type { DiagramPoseSpatialView };

export interface DiagramLinkedPose {
  actions: DiagramLinkedPoseAction[];
  /** The live 3D fold, for a step shown in 3D once it is folded; null otherwise. */
  spatial: DiagramPoseSpatialView | null;
  /** The 3D view moved: captured once it rests. */
  onCamera: (camera: FoldedFigureCamera) => void;
}

/**
 * Pose for a step linked to the crease pattern, while its detail is open
 * (`poseController.ts`): its verbs, and its live 3D fold. One controller per
 * open step, let go when the step changes or the detail closes; it hears an
 * undo or redo, the crease pattern being replaced and the engine being lost.
 * Null for a step that is not linked.
 */
export function useDiagramLinkedPose(step: DiagramStep | null): DiagramLinkedPose | null {
  const { t } = useTranslation();
  const source = step && !step.unknown && step.source?.kind === 'cp' ? step.source : null;
  const stepId = source ? step!.id : null;
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const busy = useWorkspaceStore((state) => stepId !== null && Object.hasOwn(state.diagramCaptures, stepId));
  const [spatial, setSpatial] = useState<{ stepId: string; view: DiagramPoseSpatialView } | null>(null);
  const [hasNext, setHasNext] = useState<{ stepId: string; value: boolean | null } | null>(null);

  const controller = useMemo(
    () =>
      stepId === null
        ? null
        : createPoseController(stepId, {
            spatial: (view) => setSpatial(view ? { stepId, view } : null),
            hasNextSolution: (value) => setHasNext({ stepId, value }),
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
  const view = showsSpatial && spatial?.stepId === stepId ? spatial.view : null;
  useEffect(() => {
    if (controller && showsSpatial && !view) void controller.prepareSpatial();
  }, [controller, showsSpatial, view]);

  const storedCamera = source?.render.mode === 'folded-3d' ? source.render.camera : null;
  const onCamera = useCallback(
    (camera: FoldedFigureCamera) => controller?.orbit(camera, storedCamera),
    [controller, storedCamera]
  );

  const render = source?.render ?? null;
  const hasNextSolution = hasNext?.stepId === stepId ? hasNext.value : null;
  const actions = useMemo(
    () =>
      render && controller
        ? buildDiagramLinkedPoseActions(
            { render, readOnly, busy, hasNextSolution },
            { t, pose: (verb) => void controller.run({ verb }) }
          )
        : [],
    [render, readOnly, busy, hasNextSolution, t, controller]
  );

  if (!source) return null;
  return { actions, spatial: view, onCamera };
}
