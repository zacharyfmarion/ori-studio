/**
 * What a Pose verb does to a linked step's picture (D5): the new render, and
 * the picture taken in it, from the creases its scope chooses today. The fold
 * is the session's, held between verbs; a crease-pattern pose folds nothing.
 *
 * Store-free and React-free: the session and the creases are passed in.
 */
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFold3dRefusal,
} from '../../engine/oristudioCpTypes';
import {
  antipodalCamera,
  type FoldedFigureCamera,
} from '../../cp-workspace/folded/folded3dCamera';
import { resolveFoldRoute } from '../../cp-workspace/folded/foldRoute';
import {
  POSE_ROTATION_STEP_DEG,
  type DiagramLinkedPoseActionId,
} from '../actions/diagramLinkedPoseActions';
import type { DiagramCpRender, DiagramStyle } from '../document/diagramDocument';
import type { StepCreases } from './captureCreases';
import {
  captureCreasePattern,
  defaultCaptureCamera,
  type CapturedPicture,
} from './captureFolded';
import type { CaptureSession, SpatialHold } from './captureSession';

/** A verb, or an orbit of the 3D view ending at a camera. */
export type LinkedPoseRequest =
  | { verb: DiagramLinkedPoseActionId }
  | { verb: 'orbit'; camera: FoldedFigureCamera };

export type LinkedPoseResult =
  | {
      status: 'posed';
      render: DiagramCpRender;
      picture: CapturedPicture;
      noLayerOrder: boolean;
      /** For a flat fold: whether another layer order can be searched for. */
      hasNextSolution?: boolean;
      /** For a 3D fold: what the live view draws. */
      spatial?: SpatialHold;
    }
  | { status: 'refused'; refusal: OristudioCpFold3dRefusal };

export interface LinkedPoseInput {
  document: OristudioCpDocumentSnapshot;
  creases: StepCreases;
  render: DiagramCpRender;
  style: DiagramStyle;
}

/** Straight down at the paper. */
const VIEW_TOP: FoldedFigureCamera = { yaw: 0, pitch: 0, zoom: 1 };
/** Along the paper, from the front edge. */
const VIEW_FRONT: FoldedFigureCamera = { yaw: 0, pitch: -Math.PI / 2, zoom: 1 };

export async function poseLinkedStep(
  session: CaptureSession,
  { document, creases, render, style }: LinkedPoseInput,
  request: LinkedPoseRequest
): Promise<LinkedPoseResult> {
  const spatialRoute = resolveFoldRoute(document, creases.foldLineIds).kind === 'spatial';

  const creasePattern = (rotationDeg: number): LinkedPoseResult => ({
    status: 'posed',
    render: { mode: 'crease-pattern', rotationDeg },
    picture: captureCreasePattern(document, creases, rotationDeg),
    noLayerOrder: false,
  });

  const flat = async (
    side: 'front' | 'back',
    rotationDeg: number,
    foldCase: number,
    move?: 'turn-over' | 'next-solution'
  ): Promise<LinkedPoseResult> => {
    let state = await session.flat(document, creases.foldLineIds, side, foldCase);
    if (move === 'turn-over') state = await session.turnOver();
    if (move === 'next-solution') state = await session.nextSolution();
    const picture = await session.flatPicture(rotationDeg);
    return {
      status: 'posed',
      render: { mode: 'folded-flat', side: state.side, rotationDeg, foldCase: state.foldCase },
      picture,
      noLayerOrder: state.noLayerOrder,
      hasNextSolution: state.hasNext,
    };
  };

  const spatial = async (camera: FoldedFigureCamera, side: 'front' | 'back'): Promise<LinkedPoseResult> => {
    const held = await session.spatial(document, creases.foldLineIds);
    if (held.kind === 'refused') return { status: 'refused', refusal: held.refusal };
    return {
      status: 'posed',
      render: { mode: 'folded-3d', camera, side },
      picture: session.spatialPicture(camera, style),
      noLayerOrder: false,
      spatial: held,
    };
  };

  /** The folded form the creases fold into, turned as the crease pattern was. */
  const folded = (rotationDeg: number) =>
    spatialRoute ? spatial(defaultCaptureCamera('front'), 'front') : flat('front', rotationDeg, 1);

  const { verb } = request;
  if (verb === 'show-crease-pattern') {
    // Nothing folded to keep: let the kernel have its memory back.
    session.dispose();
    return creasePattern(render.mode === 'folded-3d' ? 0 : render.rotationDeg);
  }
  if (render.mode === 'crease-pattern') {
    switch (verb) {
      case 'show-folded':
        return folded(render.rotationDeg);
      case 'rotate-left':
        return creasePattern(turned(render.rotationDeg, -POSE_ROTATION_STEP_DEG));
      case 'rotate-right':
        return creasePattern(turned(render.rotationDeg, POSE_ROTATION_STEP_DEG));
      case 'reset':
        return creasePattern(0);
      default:
        // A folded verb on a crease pattern: there is nothing folded to move.
        return creasePattern(render.rotationDeg);
    }
  }
  // The creases now fold the other way — a partial fold added or taken away
  // since the step was posed — and each folder refuses the other's creases.
  if ((render.mode === 'folded-3d') !== spatialRoute) {
    return folded(render.mode === 'folded-flat' ? render.rotationDeg : 0);
  }
  if (render.mode === 'folded-flat') {
    const { side, rotationDeg, foldCase } = render;
    switch (verb) {
      case 'show-folded':
        return flat(side, rotationDeg, foldCase);
      case 'rotate-left':
        return flat(side, turned(rotationDeg, -POSE_ROTATION_STEP_DEG), foldCase);
      case 'rotate-right':
        return flat(side, turned(rotationDeg, POSE_ROTATION_STEP_DEG), foldCase);
      case 'turn-over':
        return flat(side, rotationDeg, foldCase, 'turn-over');
      case 'next-solution':
        return flat(side, rotationDeg, foldCase, 'next-solution');
      case 'reset':
        return flat('front', 0, 1);
      default:
        return flat(side, rotationDeg, foldCase);
    }
  }
  const { camera, side } = render;
  const fromSide = (view: FoldedFigureCamera) => (side === 'back' ? antipodalCamera(view) : view);
  switch (verb) {
    case 'orbit':
      return spatial(request.verb === 'orbit' ? request.camera : camera, side);
    case 'turn-over':
      return spatial(antipodalCamera(camera), side === 'back' ? 'front' : 'back');
    case 'view-top':
      return spatial(fromSide(VIEW_TOP), side);
    case 'view-front':
      return spatial(fromSide(VIEW_FRONT), side);
    case 'view-iso':
      return spatial(defaultCaptureCamera(side), side);
    case 'reset':
      return spatial(defaultCaptureCamera('front'), 'front');
    default:
      return spatial(camera, side);
  }
}

/** A rotation turned by `delta` degrees, within one turn. */
function turned(rotationDeg: number, delta: number): number {
  return (((rotationDeg + delta) % 360) + 360) % 360;
}
