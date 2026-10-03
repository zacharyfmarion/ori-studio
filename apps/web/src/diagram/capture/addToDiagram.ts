import { toast } from 'sonner';
import { trackDiagramStepAdded, type DiagramStepAddedSource } from '../../analytics';
import { DEFAULT_FOLDED_3D_CAMERA, type FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import { folded3dAuxLinesOf } from '../../cp-workspace/folded/folded3dAuxLines';
import { folded3dRenderModel } from '../../cp-workspace/folded/folded3dRenderModels';
import { folded3dSceneStyleKey } from '../../cp-workspace/folded/folded3dScene';
import { folded3dFigureScene } from '../../cp-workspace/folded/folded3dStoredScene';
import { isFoldedFigureReady } from '../../cp-workspace/folded/foldedFigureActions';
import { foldedFigureCurrentCase } from '../../cp-workspace/folded/foldedFigureState';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import i18n from '../../i18n';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  captureNewLinkedStep,
  keptPicture,
  type DiagramCaptureOutcome,
} from '../../store/workspaceStore/diagramCapture';
import {
  DEFAULT_DIAGRAM_STYLE,
  stepIndex,
  type DiagramCpRender,
  type DiagramCpScope,
  type DiagramCpSource,
} from '../document/diagramDocument';
import { storedCpSource } from '../document/diagramFile';
import { diagramPaperStyle } from '../pictures/diagramPaperStyle';
import { chooseStepCreases } from './captureCreases';
import { storeScene } from './captureFolded';
import { creasesThumbnail } from './captureThumbnail';
import { sayCaptureOutcome } from './stepCaptureActions';

const store = { get: useWorkspaceStore.getState, set: useWorkspaceStore.setState };

/**
 * Add a pattern selected in Edit to the diagram, as a crease-pattern step
 * (D2): after the diagram's selected step, or at the end. Edit stays where it
 * is; a toast says which step it became, with Open diagram. The new step's id,
 * or null when nothing was added.
 */
export async function addPatternToDiagram(segment: CpSegment): Promise<string | null> {
  const { outcome, stepId } = await captureNewLinkedStep(store, {
    scope: { kind: 'segment', region: regionReferenceFor(segment) },
    render: { mode: 'crease-pattern', rotationDeg: 0 },
    label: 'Add to diagram',
  });
  return finish(outcome, stepId, 'crease_pattern', 'edit_toolbar');
}

/** Whether a folded figure can be added: it records the box it was folded from. */
export function canAddFigureToDiagram(figure: OristudioCpFoldedFigureEntry): boolean {
  return Boolean(figure.sourceBounds && figure.sourceFingerprint);
}

/**
 * Add a folded figure from Edit to the diagram, linked to the box it was
 * folded from and posed as it is shown there: its side, its rotation on the
 * canvas and its layer order, or its 3D camera. The picture is built through
 * the capture, never copied from Edit or by changing its figure:
 *
 * - a live 3D figure is drawn from its render model, at its camera and in the
 *   diagram's light, with no kernel work, and keeps the figure's fingerprint,
 *   so a figure already out of date in Edit comes in out of date;
 * - any other — a flat figure, or one reopened from a file and not folded
 *   since — is folded again from its box, a visible, stoppable run, from the
 *   pattern as it is now.
 */
export async function addFigureToDiagram(figure: OristudioCpFoldedFigureEntry): Promise<string | null> {
  if (!figure.sourceBounds || !figure.sourceFingerprint) return null;
  const scope: DiagramCpScope = { kind: 'figure-bounds', bounds: figure.sourceBounds };
  const label = 'Add to diagram';

  if (figure.folded3d) {
    const render: DiagramCpRender = { mode: 'folded-3d', camera: figureCamera(figure), side: 'front' };
    const model = figure.handle == null ? null : folded3dRenderModel(figure.handle);
    if (!model || !isFoldedFigureReady(figure)) {
      const { outcome, stepId } = await captureNewLinkedStep(store, { scope, render, label });
      return finish(outcome, stepId, 'cp_3d', 'folded_figure');
    }
    const state = store.get();
    const style = state.diagram?.style ?? DEFAULT_DIAGRAM_STYLE;
    const drawn = diagramPaperStyle(style);
    const scene = folded3dFigureScene(
      {
        camera: render.camera,
        displayStyle: 'Paper5',
        folded3d: figure.folded3d,
        frameRadius: figure.frameRadius ?? undefined,
      },
      model,
      { style: drawn, space: 'document', markHidden: true, aux: folded3dAuxLinesOf(figure.handle) }
    );
    if (!scene) {
      const { outcome, stepId } = await captureNewLinkedStep(store, { scope, render, label });
      return finish(outcome, stepId, 'cp_3d', 'folded_figure');
    }
    const captured = storeScene(scene, null, folded3dSceneStyleKey(drawn));
    const kept = await keptPicture(captured, render, style);
    const source = linkedSource(scope, figure.sourceFingerprint, render);
    const stepId = source
      ? state.addLinkedDiagramStep({ source, ...kept }, { loadId: state.diagramLoadId, label })
      : null;
    return finish(
      stepId
        ? { status: 'captured', changed: true, render, noLayerOrder: false, tooDetailed: kept.asset !== undefined }
        : { status: 'discarded' },
      stepId,
      'cp_3d',
      'folded_figure'
    );
  }

  const render: DiagramCpRender = {
    mode: 'folded-flat',
    side: figure.snapshot?.model.state === 'Back1' ? 'back' : 'front',
    rotationDeg: placementDegrees(figure.placement.rotation),
    foldCase: Math.max(1, foldedFigureCurrentCase(figure)),
  };
  const { outcome, stepId } = await captureNewLinkedStep(store, { scope, render, label });
  return finish(outcome, stepId, 'cp_folded', 'folded_figure');
}

/** A figure's link: its box, its own fingerprint, the pattern's thumbnail now, and its pose. */
function linkedSource(scope: DiagramCpScope, fingerprint: string, render: DiagramCpRender): DiagramCpSource | null {
  const document = store.get().oristudioCpDocument?.document;
  const choice = document ? chooseStepCreases(document, scope, null) : null;
  const thumbnail =
    document && choice?.status === 'found'
      ? creasesThumbnail(document, choice.creases, null)
      : { viewBox: '0 0 100 100', strokes: [] };
  return storedCpSource({ kind: 'cp', scope, fingerprint, thumbnail, render });
}

function figureCamera(figure: OristudioCpFoldedFigureEntry): FoldedFigureCamera {
  const camera = figure.camera ?? DEFAULT_FOLDED_3D_CAMERA;
  return camera.orient
    ? { yaw: camera.yaw, pitch: camera.pitch, zoom: camera.zoom, orient: [...camera.orient] as FoldedFigureCamera['orient'] }
    : { yaw: camera.yaw, pitch: camera.pitch, zoom: camera.zoom };
}

/** A placement's rotation (radians, clockwise on screen) as a step's: degrees within one turn. */
function placementDegrees(radians: number): number {
  const degrees = (radians * 180) / Math.PI;
  return Number(((((degrees % 360) + 360) % 360)).toPrecision(12)) % 360;
}

/** Count the add, say what became of it, and offer the way to it. */
function finish(
  outcome: DiagramCaptureOutcome,
  stepId: string | null,
  source: DiagramStepAddedSource,
  via: 'edit_toolbar' | 'folded_figure'
): string | null {
  if (stepId === null) {
    sayCaptureOutcome(outcome);
    return null;
  }
  trackDiagramStepAdded(source, via);
  const diagram = useWorkspaceStore.getState().diagram;
  const number = diagram ? stepIndex(diagram, stepId) + 1 : 0;
  const t = i18n.t;
  toast.success(t('toasts:diagram.addedAsStep', 'Added as step {{number}}', { number }), {
    action: {
      label: t('toasts:diagram.openDiagram', 'Open diagram'),
      onClick: () => openDiagramAt(stepId),
    },
  });
  if (outcome.status === 'captured' && (outcome.noLayerOrder || outcome.tooDetailed)) sayCaptureOutcome(outcome);
  return stepId;
}

/** The Diagram, on this step. */
function openDiagramAt(stepId: string): void {
  useWorkspaceStore.getState().selectDiagramStep(stepId);
  useLayoutStore.getState().activateWorkspace('diagram');
}
