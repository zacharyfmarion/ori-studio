import { ANALYTICS_EVENTS } from './events';
import { track } from './runtime';

/**
 * A property of a selected canvas object was changed from the Properties pane.
 *
 * Fired once per recorded change by the sheet host — inside the discrete
 * commit, the draft commit, the continuous `end` and a reset — never per input
 * event. `objectKind` is the kind table's key and `property` the field id,
 * both enums by construction; never a value, colour, angle or text.
 */
export function trackCanvasObjectPropertyChanged(input: {
  objectKind: string;
  property: string;
}): void {
  track(ANALYTICS_EVENTS.canvasObjectPropertyChanged, {
    object_kind: input.objectKind,
    property: input.property,
  });
}
