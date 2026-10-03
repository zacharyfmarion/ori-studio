import { ANALYTICS_EVENTS } from './events';
import type { DiagramStepAddedSource, DiagramStepAddedVia } from './events';
import { track } from './runtime';

/**
 * A step was added to the diagram.
 *
 * Hand-placed because adding a step is a store action reached from several
 * controls, none of which dispatches a `MENU_ACTION_ID`. Enums only: never the
 * instruction, the picture or its name.
 */
export function trackDiagramStepAdded(source: DiagramStepAddedSource, via: DiagramStepAddedVia): void {
  track(ANALYTICS_EVENTS.diagramStepAdded, { source, via });
}
