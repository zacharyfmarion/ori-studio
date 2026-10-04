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
import {
  DEFAULT_SIMULATED_VIEW,
  renderToShowAs,
  type DiagramCpRender,
  type DiagramCpSource,
  type DiagramSimulatedView,
  type DiagramStyle,
} from '../document/diagramDocument';
import type { StepCreases } from './captureCreases';
import {
  captureCreasePattern,
  captureSimulated,
  defaultCaptureCamera,
  flatStill,
  type CapturedPicture,
  type SimulateFlat,
  type StillScene,
} from './captureFolded';
import type { CaptureSession, SpatialHold } from './captureSession';

/**
 * A verb, an orbit of the 3D view ending at a camera, a turn typed in degrees
 * (D5's angle field) for a crease pattern or a flat fold, or Pose's simulator
 * come to rest (D19): its model where the solver holds it, at a fold %, from a
 * camera.
 */
export type LinkedPoseRequest =
  | { verb: DiagramLinkedPoseActionId }
  | { verb: 'orbit'; camera: FoldedFigureCamera }
  | { verb: 'rotate-to'; degrees: number }
  | { verb: 'simulate'; foldPercent: number; view: DiagramSimulatedView; still: StillScene };

export type LinkedPoseResult =
  | {
      status: 'posed';
      render: DiagramCpRender;
      picture: CapturedPicture;
      noLayerOrder: boolean;
      /** For a flat fold: how many layer orders are found, and whether another can be searched for. */
      solutions?: FlatSolutions;
      /** For a 3D fold: what the live view draws. */
      spatial?: SpatialHold;
    }
  | { status: 'refused'; refusal: OristudioCpFold3dRefusal }
  /** Shown as Simulated, and the region has no model the simulator can fold. */
  | { status: 'unavailable' };

/** A flat fold's layer orders as the search knows them: how many found, and whether there may be more. */
export interface FlatSolutions {
  discovered: number;
  hasNext: boolean;
  /** It has none: its layers could not be put in order, and it shows see-through. */
  none: boolean;
}

export interface LinkedPoseInput {
  document: OristudioCpDocumentSnapshot;
  creases: StepCreases;
  render: DiagramCpRender;
  /** The poses the step remembers for its other ways of showing (D19). */
  remembered?: DiagramCpSource['remembered'];
  style: DiagramStyle;
  /** The simulator, for showing the pattern Simulated (D19). */
  simulateFlat?: SimulateFlat;
}

/** Straight down at the paper. */
const VIEW_TOP: FoldedFigureCamera = { yaw: 0, pitch: 0, zoom: 1 };
/** Along the paper, from the front edge. */
const VIEW_FRONT: FoldedFigureCamera = { yaw: 0, pitch: -Math.PI / 2, zoom: 1 };

export async function poseLinkedStep(
  session: CaptureSession,
  { document, creases, render, remembered, style, simulateFlat }: LinkedPoseInput,
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
    move?: 'turn-over' | 'next-solution',
    knownCases?: number
  ): Promise<LinkedPoseResult> => {
    // Another layer order is a search of the held fold; one already found, a jump to it.
    let state = await session.flat(document, creases.foldLineIds, side, foldCase, knownCases);
    if (move === 'turn-over') state = await session.turnOver();
    if (move === 'next-solution') state = await session.nextSolution();
    const picture = await session.flatPicture(rotationDeg);
    return {
      status: 'posed',
      render: { mode: 'folded-flat', side: state.side, rotationDeg, foldCase: state.foldCase },
      picture,
      noLayerOrder: state.noLayerOrder,
      solutions: { discovered: state.discovered, hasNext: state.hasNext, none: state.noLayerOrder },
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

  /**
   * The folded form in the pose it last had (D19), by the route its creases
   * take now: a remembered 3D view for creases that fold flat now starts flat,
   * and a remembered flat fold for creases that fold in 3D starts in 3D.
   */
  const foldedAsRemembered = (): Promise<LinkedPoseResult> => {
    const target = renderToShowAs({ render, remembered }, 'folded');
    if (target.mode === 'folded-flat' && !spatialRoute) {
      return flat(target.side, target.rotationDeg, target.foldCase);
    }
    if (target.mode === 'folded-3d' && spatialRoute) return spatial(target.camera, target.side);
    return folded(target.mode === 'folded-flat' ? target.rotationDeg : 0);
  };

  /**
   * The simulator's model from a camera: flat, the one fold % a picture is
   * taken at outside Pose, unless Pose's live solver is handed in (D19).
   */
  const simulated = async (
    view: DiagramSimulatedView,
    foldPercent = 0,
    still = flatStill(simulateFlat, creases)
  ): Promise<LinkedPoseResult> => {
    const picture = await captureSimulated(still, view, style);
    if (!picture) return { status: 'unavailable' };
    return { status: 'posed', render: { mode: 'simulated', foldPercent, view }, picture, noLayerOrder: false };
  };

  if (request.verb === 'simulate') {
    // Nothing folded to keep: the simulator has its own model.
    session.dispose();
    return simulated(request.view, request.foldPercent, request.still);
  }
  const { verb } = request;
  if (verb === 'show-simulated') {
    // Nothing folded to keep: the simulator has its own model.
    session.dispose();
    const target = renderToShowAs({ render, remembered }, 'simulated');
    return simulated(target.mode === 'simulated' ? target.view : DEFAULT_SIMULATED_VIEW);
  }
  if (verb === 'show-crease-pattern') {
    // Nothing folded to keep: let the kernel have its memory back.
    session.dispose();
    const target = renderToShowAs({ render, remembered }, 'crease-pattern');
    return creasePattern(target.mode === 'crease-pattern' ? target.rotationDeg : 0);
  }
  if (render.mode === 'simulated') {
    switch (verb) {
      case 'show-folded':
        return foldedAsRemembered();
      case 'reset':
        return simulated(DEFAULT_SIMULATED_VIEW);
      default:
        return simulated(render.view);
    }
  }
  if (render.mode === 'crease-pattern') {
    switch (verb) {
      case 'show-folded':
        return foldedAsRemembered();
      case 'rotate-left':
        return creasePattern(turned(render.rotationDeg, -POSE_ROTATION_STEP_DEG));
      case 'rotate-right':
        return creasePattern(turned(render.rotationDeg, POSE_ROTATION_STEP_DEG));
      case 'rotate-to':
        return creasePattern(turned(request.verb === 'rotate-to' ? request.degrees : render.rotationDeg, 0));
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
      case 'rotate-to':
        return flat(side, turned(request.verb === 'rotate-to' ? request.degrees : rotationDeg, 0), foldCase);
      case 'turn-over':
        // Turned over where it lies, as paper is: what shows now is the
        // mirror of what showed, so its turn runs the other way.
        return flat(side, turned(-rotationDeg, 0), foldCase, 'turn-over');
      case 'next-solution':
        return flat(side, rotationDeg, foldCase, 'next-solution');
      case 'previous-solution':
        // The order it leaves exists, though a fold opened fresh to go back has not found it.
        return flat(side, rotationDeg, Math.max(1, foldCase - 1), undefined, foldCase);
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
