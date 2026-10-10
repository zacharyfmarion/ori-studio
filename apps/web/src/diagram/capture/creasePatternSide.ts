/**
 * The Step pane's Front | Back for a step shown as its crease pattern: the
 * side of the paper whose colour it is drawn on. Choosing the other side
 * fills the paper with that side's colour and changes nothing else — the same
 * lines, turn, mountains and valleys (Zach, 2026-10-06: "I wanted to just
 * change the color of the face and not flip the creases"). It is a pose
 * (`paper-side`), in Pose or not: one undo step, a fingerprint kept as a pose
 * keeps it, the step's marks left where they are and in step with the new
 * picture, counted as the paper's side.
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

/** The side whose colour a step shown as its crease pattern is drawn on; null for any other step. */
function shownSide(stepId: string): 'front' | 'back' | null {
  const { diagram } = useWorkspaceStore.getState();
  const step = diagram ? stepById(diagram, stepId) : null;
  if (!step || isLockedStep(step) || step.source?.kind !== 'cp') return null;
  const { render } = step.source;
  return render.mode === 'crease-pattern' ? creasePatternSide(render) : null;
}

/**
 * Draw a step shown as its crease pattern on the colour of `side`: nothing for
 * the side it is on; otherwise recoloured as one undo step — through the open
 * step's pose controller while it is open in Pose, else through one made for
 * this verb alone and let go once it lands. Whether the step is now on that side.
 */
export async function showCreasePatternSide(stepId: string, side: 'front' | 'back'): Promise<boolean> {
  const shown = shownSide(stepId);
  if (shown === null || useWorkspaceStore.getState().diagramReadOnly) return false;
  if (shown === side) return true;
  const open = openLinkedPoseOf(stepId);
  if (open) return open.setSide(side);
  const controller = createPoseController(stepId, UNWATCHED);
  try {
    await controller.run({ verb: 'paper-side', side });
  } finally {
    controller.dispose();
  }
  return shownSide(stepId) === side;
}
