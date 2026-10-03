import {
  trackDiagramPicturePosed,
  type DiagramPoseAction as TrackedPoseAction,
} from '../../analytics';
import { ensureCpSegmentationArtifacts } from '../../cp-workspace/cpSegmentationArtifacts';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import {
  foldedFigureHandleEpoch,
  releaseFoldedFigureHandle,
  retainFoldedFigureHandle,
} from '../../cp-workspace/folded/foldedFigureHandles';
import type {
  OristudioCpFolded3dAuxLines,
  OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  beginStepCapture,
  captureFailure,
  endStepCapture,
  runStepFold,
  stepCaptureRuntime,
  type DiagramCaptureOutcome,
  type StepCaptureStart,
} from '../../store/workspaceStore/diagramCapture';
import { stepIndex, type DiagramCpSource } from '../document/diagramDocument';
import { storedCpSource } from '../document/diagramFile';
import { chooseStepCreases, creasesFingerprint, type StepCreases } from './captureCreases';
import { CaptureSessionClosedError, createCaptureSession, type CaptureSession } from './captureSession';
import { creasesThumbnail } from './captureThumbnail';
import { abandonOnEngineLoss } from './engineLoss';
import { poseLinkedStep, type LinkedPoseRequest } from './linkedPose';
import { captureKind, sayCaptureOutcome } from './stepCaptureActions';

/** How long the 3D view must rest before its camera is captured: one orbit, one undo step. */
export const ORBIT_SETTLE_MS = 450;

const TRACKED: Record<LinkedPoseRequest['verb'], TrackedPoseAction> = {
  'show-crease-pattern': 'show_crease_pattern',
  'show-folded': 'show_folded',
  'rotate-left': 'rotate_left',
  'rotate-right': 'rotate_right',
  'turn-over': 'turn_over',
  'next-solution': 'next_solution',
  'view-top': 'view_top',
  'view-front': 'view_front',
  'view-iso': 'view_iso',
  reset: 'reset',
  orbit: 'orbit',
  'rotate-to': 'rotate_to',
};

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
  /** The live 3D fold, once held; null when let go. */
  spatial: (view: DiagramPoseSpatialView | null, key: string | null) => void;
  /** Whether the held flat fold has another layer order; null when unknown. */
  hasNextSolution: (hasNext: boolean | null, key: string) => void;
}

/** Which creases a step's fold is of: its scope and their fingerprint. */
export function linkedFoldKey(stepId: string, source: Pick<DiagramCpSource, 'scope' | 'fingerprint'>): string {
  return JSON.stringify([stepId, source.scope, source.fingerprint]);
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
  run: (request: LinkedPoseRequest) => Promise<void>;
  /** The 3D view moved: capture it once it rests, if it is not where the step already is. */
  orbit: (camera: FoldedFigureCamera, stored: FoldedFigureCamera | null) => void;
  /** Fold a step shown in 3D for its live view. */
  prepareSpatial: () => Promise<void>;
  /** An undo or redo: stop what is still folding for a source the step no longer has. */
  historyMoved: () => void;
  /** The crease pattern replaced: its handle went with it. */
  documentReplaced: () => void;
  /** The engine is gone: forget the fold without freeing it, since its slots are reused. */
  engineLost: () => void;
  dispose: () => void;
}

const store = { get: useWorkspaceStore.getState, set: useWorkspaceStore.setState };

export function createPoseController(stepId: string, listener: PoseControllerListener): PoseController {
  let start: StepCaptureStart | null = null;
  let orbitTimer: ReturnType<typeof setTimeout> | null = null;
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

  /** Run kernel work as this step's capture: marked capturing, its fold stoppable. */
  const capturing = async <T>(
    work: (begun: StepCaptureStart, linked: DiagramCpSource) => Promise<T>
  ): Promise<T | DiagramCaptureOutcome | null> => {
    const linked = currentLinkedSource(stepId);
    if (!linked) return null;
    const begun = beginStepCapture(store, stepId);
    if ('status' in begun) return begun;
    start = begun;
    try {
      return await work(begun, linked);
    } catch (error) {
      // The detail closed, or a newer verb took over, while this folded.
      if (error instanceof CaptureSessionClosedError) return { status: 'discarded' };
      return captureFailure(error);
    } finally {
      start = null;
      endStepCapture(store, stepId);
    }
  };

  const creasesFor = async (begun: StepCaptureStart, linked: DiagramCpSource) => {
    const document = begun.cp.document;
    const segmentation = await abandonOnEngineLoss(ensureCpSegmentationArtifacts(document));
    return { document, segmentation, choice: chooseStepCreases(document, linked.scope, segmentation) };
  };

  const run = async (request: LinkedPoseRequest): Promise<void> => {
    const outcome = await capturing(async (begun, linked): Promise<DiagramCaptureOutcome> => {
      const { document, segmentation, choice } = await creasesFor(begun, linked);
      if (choice.status !== 'found') return choice;
      const result = await abandonOnEngineLoss(
        poseLinkedStep(
          session,
          { document, creases: choice.creases, render: linked.render, style: begun.style },
          request
        )
      );
      if (result.status === 'refused') return result;
      const source = linkedSource(linked, choice.creases, document, segmentation, result.render);
      const committed = await useWorkspaceStore
        .getState()
        .commitDiagramCapture(begun, { source, picture: result.picture }, 'Adjust pose');
      if (!committed) return { status: 'discarded' };
      if (committed.changed) trackDiagramPicturePosed(TRACKED[request.verb], captureKind(result.render));
      const key = linkedFoldKey(stepId, source);
      listener.hasNextSolution(result.hasNextSolution ?? null, key);
      if (result.spatial) listener.spatial({ model: result.spatial.fold.render, aux: result.spatial.aux }, key);
      return {
        status: 'captured',
        changed: committed.changed,
        render: result.render,
        noLayerOrder: result.noLayerOrder,
        tooDetailed: committed.tooDetailed,
      };
    });
    if (!outcome || !('status' in outcome)) return;
    // Only what is news: a see-through fold says so as it is first folded.
    const repeated = outcome.status === 'captured' && outcome.noLayerOrder && request.verb !== 'show-folded';
    if (!repeated) sayCaptureOutcome(outcome);
  };

  const cancelOrbit = () => {
    if (orbitTimer) clearTimeout(orbitTimer);
    orbitTimer = null;
  };

  return {
    run,

    orbit(camera, stored) {
      cancelOrbit();
      if (!stored || sameCamera(camera, stored)) return;
      orbitTimer = setTimeout(() => {
        orbitTimer = null;
        void run({ verb: 'orbit', camera });
      }, ORBIT_SETTLE_MS);
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
              fingerprint: creasesFingerprint(choice.creases, linked.render),
            })
          );
        }
        return null;
      });
    },

    historyMoved() {
      cancelOrbit();
      useWorkspaceStore.getState().stopDiagramCapture(stepId);
    },

    documentReplaced() {
      cancelOrbit();
      useWorkspaceStore.getState().stopDiagramCapture(stepId);
      session.dispose();
      listener.spatial(null, null);
    },

    engineLost() {
      cancelOrbit();
      session.forget();
      listener.spatial(null, null);
    },

    dispose() {
      cancelOrbit();
      // Its own fold, if one is still searching: the detail it was for is gone.
      if (start) useWorkspaceStore.getState().stopDiagramCapture(stepId);
      session.dispose();
    },
  };
}

/** The step's source, if it is still in the diagram and linked. */
function currentLinkedSource(stepId: string): DiagramCpSource | null {
  const { diagram } = useWorkspaceStore.getState();
  const step = diagram?.steps[stepIndex(diagram, stepId)];
  return step && !step.unknown && step.source?.kind === 'cp' ? step.source : null;
}

/** The step's source after a pose: the same scope, its creases fingerprinted as the new render shows them. */
function linkedSource(
  previous: DiagramCpSource,
  creases: StepCreases,
  document: Parameters<typeof creasesThumbnail>[0],
  segmentation: Parameters<typeof creasesThumbnail>[2],
  render: DiagramCpSource['render']
): DiagramCpSource {
  const stored = storedCpSource({
    kind: 'cp',
    scope: previous.scope,
    fingerprint: creasesFingerprint(creases, render),
    thumbnail: creasesThumbnail(document, creases, segmentation),
    render,
  });
  if (!stored) throw new Error('The pose made a link the file cannot read');
  return stored;
}

export function sameCamera(a: FoldedFigureCamera, b: FoldedFigureCamera): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  if (!close(a.yaw, b.yaw) || !close(a.pitch, b.pitch) || !close(a.zoom, b.zoom)) return false;
  if (!a.orient || !b.orient) return !a.orient && !b.orient;
  return a.orient.every((value, index) => close(value, b.orient![index]!));
}
