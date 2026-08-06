import type { WorkflowTarget } from '../../lib/sampleProject';

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
