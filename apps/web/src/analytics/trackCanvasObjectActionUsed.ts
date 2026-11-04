import { ANALYTICS_EVENTS } from './events';
import { track } from './runtime';

/**
 * A verb in the Properties pane's header was pressed for the selected canvas
 * object.
 *
 * Fired once per press by the sheet host. `objectKind` is the kind table's key
 * and `action` the verb's id ('export', 'duplicate', 'delete'), both enums by
 * construction; never anything about the object itself.
 */
export function trackCanvasObjectActionUsed(input: { objectKind: string; action: string }): void {
  track(ANALYTICS_EVENTS.canvasObjectActionUsed, {
    object_kind: input.objectKind,
    action: input.action,
  });
}
