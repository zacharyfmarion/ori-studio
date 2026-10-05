/**
 * The Step pane's Front | Back for a step shown as its crease pattern: the
 * side of the paper it is seen from. Choosing the other side turns the
 * pattern over where it lies (`turnCreasePatternOver`) — Pose's own
 * `turn-over` verb on a crease pattern — so it is the pose Pose makes, in Pose
 * or not: one undo step, a fingerprint kept as a pose keeps it, the step's
 * marks mirrored with the picture, counted as a turn-over.
 *
 * Store-bound, React-free.
 */
import { useWorkspaceStore } from '../../store/workspaceStore';
import { creasePatternSide, isLockedStep, stepById } from '../document/diagramDocument';
import { openLinkedPoseOf } from './openLinkedPose';
import { createPoseController, type PoseControllerListener } from './poseController';

/** A controller's listener for a verb no view watches: a crease pattern folds nothing to show. */
const UNWATCHED: PoseControllerListener = {
  spatial: () => {},
  solutions: () => {},
  mirrorAxes: () => {},
  preview: () => {},
};

/** The side a step shown as its crease pattern is seen from; null for any other step. */
function shownSide(stepId: string): 'front' | 'back' | null {
  const { diagram } = useWorkspaceStore.getState();
  const step = diagram ? stepById(diagram, stepId) : null;
  if (!step || isLockedStep(step) || step.source?.kind !== 'cp') return null;
  const { render } = step.source;
  return render.mode === 'crease-pattern' ? creasePatternSide(render) : null;
}

/**
 * Show a step shown as its crease pattern from `side`: nothing for the side it
 * shows; otherwise turned over as one undo step — through the open step's
 * pose controller while it is open in Pose, else through one made for this
 * verb alone and let go once it lands. Whether the step now shows that side.
 */
export async function showCreasePatternSide(stepId: string, side: 'front' | 'back'): Promise<boolean> {
  const shown = shownSide(stepId);
  if (shown === null || useWorkspaceStore.getState().diagramReadOnly) return false;
  if (shown === side) return true;
  const open = openLinkedPoseOf(stepId);
  if (open) return open.setSide(side);
  const controller = createPoseController(stepId, UNWATCHED);
  try {
    await controller.run({ verb: 'turn-over' });
  } finally {
    controller.dispose();
  }
  return shownSide(stepId) === side;
}
