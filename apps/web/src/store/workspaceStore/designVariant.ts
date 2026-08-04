import type { WorkflowTarget } from '../../lib/sampleProject';
import type { DesignLayoutVariant } from '../layoutStore';

/**
 * Which method the Design workspace is authoring with, or `'none'` when the user
 * has not picked one and the method chooser is what Design should show.
 *
 * One field, because the two it replaced — `pendingDesignChoice` plus
 * `workflowTarget` — could contradict each other. "No method chosen" while a
 * box-pleat design is loaded was a representable state, and reaching it (by
 * routing to bare `/design`) put the chooser on top of a design that was already
 * open, where picking a method replaced it with a blank one. A single field with
 * three states cannot express that.
 */
export type DesignMethod = WorkflowTarget | 'none';

/**
 * The Design layout variant for a method. Total, and takes the one field, so it
 * cannot disagree with the state it describes.
 */
export function designLayoutVariant(method: DesignMethod): DesignLayoutVariant {
  return method === 'none' ? 'nux' : method;
}
