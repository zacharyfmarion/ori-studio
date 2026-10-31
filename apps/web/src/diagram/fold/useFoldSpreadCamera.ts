import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerCanvasSessionEnder } from '../../cp-workspace/canvasObjects/canvasSessions';
import {
  antipodalCamera,
  DEFAULT_FOLDED_3D_CAMERA,
  type FoldedFigureCamera,
} from '../../cp-workspace/folded/folded3dCamera';
import { withSpreadCamera, type SpreadPresentation } from '../../layer-spread/presentation';
import type { SimulatorViewHandle } from '../../simulator/simulatorViewRegistry';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { buildDiagramLinkedPoseActions } from '../actions/diagramLinkedPoseActions';
import { sameCamera } from '../capture/poseController';
import { settledTask } from '../capture/settledTask';
import { stepById, type DiagramStep } from '../document/diagramDocument';
import { presentDiagramFoldStep, spreadDiagramFoldStep } from './foldStepActions';

function idle(stepId: string): Promise<void> {
  if (!useWorkspaceStore.getState().diagramCaptures[stepId]) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useWorkspaceStore.subscribe((state) => {
      if (!state.diagramCaptures[stepId]) {
        off();
        resolve();
      }
    });
  });
}

/** Camera-only Pose behavior for a Fold-derived picture. The Fold sequence
 * remains head-on; only this Diagram step owns a perspective presentation. */
export function useFoldSpreadCamera(step: DiagramStep | null, live: boolean) {
  const { t } = useTranslation();
  const source = step?.source?.kind === 'fold-step' ? step.source : null;
  const flat = source?.render.mode === 'folded-flat' ? source.render : null;
  const id = source ? step!.id : null;
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const busy = useWorkspaceStore((state) => id !== null && !!state.diagramCaptures[id]);
  const blocked = readOnly || !!step?.unknown || !!step?.annotations.some((a) => a.unknown !== undefined);
  const [view, setView] = useState<SimulatorViewHandle | null>(null);
  const registerLiveView = useCallback((next: SimulatorViewHandle) => {
    setView(next);
    return () => setView((was) => (was === next ? null : was));
  }, []);
  const queue = useMemo(() => {
    const loadId = useWorkspaceStore.getState().diagramLoadId;
    return settledTask<SpreadPresentation>(async (value, current) => {
      if (!id) return;
      await idle(id);
      const state = useWorkspaceStore.getState();
      const stored = state.diagram ? stepById(state.diagram, id)?.source : null;
      // The inspector and live viewport have distinct hook lifetimes. A mode
      // change in the inspector must invalidate the viewport's queued orbit.
      if (
        current() &&
        state.diagramLoadId === loadId &&
        stored?.kind === 'fold-step' &&
        stored.render.mode === 'folded-flat' &&
        stored.render.presentation?.kind === 'perspective'
      ) {
        await presentDiagramFoldStep(id, value, current);
      }
    });
  }, [id]);
  useEffect(() => {
    if (!live) return;
    const off = registerCanvasSessionEnder(() => queue.cancel());
    return () => {
      off();
      void queue.flush();
    };
  }, [queue, live]);
  const onCamera = useCallback(
    (camera: FoldedFigureCamera) => {
      if (
        !live ||
        blocked ||
        flat?.presentation?.kind !== 'perspective'
      )
        return;
      if (sameCamera(camera, flat.presentation.camera)) {
        queue.cancel();
        return;
      }
      queue.offer(withSpreadCamera(flat.presentation, camera));
    },
    [live, blocked, flat, queue],
  );
  const actions = useMemo(() => {
    if (!id || !flat || flat.spread?.kind !== 'connected' || flat.presentation?.kind !== 'perspective') return null;
    const presentation = flat.presentation;
    return buildDiagramLinkedPoseActions(
      { render: flat, readOnly: blocked, busy, solutions: null, seeThrough: false, liveView: !!view },
      {
        t,
        setUpright: () => view?.setUpright(),
        pose: (verb) => {
          queue.cancel();
          if (verb === 'spread-layers') {
            void spreadDiagramFoldStep(id, { verb });
            return;
          }
          const camera =
            verb === 'turn-over'
              ? antipodalCamera(presentation.camera)
              : verb === 'view-top'
                ? { yaw: 0, pitch: 0, zoom: 1 }
                : DEFAULT_FOLDED_3D_CAMERA;
          void presentDiagramFoldStep(id, withSpreadCamera(presentation, camera));
        },
      },
    ).filter((action) => !action.id.startsWith('show-'));
  }, [id, flat, blocked, busy, view, t, queue]);
  return { onCamera, registerLiveView, actions, cancelCamera: queue.cancel };
}
