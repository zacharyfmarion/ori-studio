import type { LayerOrderFact } from '../layer-order/model/layerOrderAnalytics';
import { ANALYTICS_EVENTS } from './events';
import { track } from './runtime';

const EVENT_OF = {
  'layer order dialog opened': ANALYTICS_EVENTS.layerOrderDialogOpened,
  'layer constraint added': ANALYTICS_EVENTS.layerConstraintAdded,
  'layer constraint blocked': ANALYTICS_EVENTS.layerConstraintBlocked,
  'layer order dialog closed': ANALYTICS_EVENTS.layerOrderDialogClosed,
  'layer constraints need attention': ANALYTICS_EVENTS.layerConstraintsNeedAttention,
  'layer constraints dismissed': ANALYTICS_EVENTS.layerConstraintsDismissed,
} as const satisfies Record<LayerOrderFact['event'], string>;

/**
 * One of the Layer order dialog's events, as its pure model built it
 * (`layer-order/model/layerOrderAnalytics.ts`): the dialog's hook sends the
 * four the dialog reports (opened, a constraint added or blocked, closed) at
 * the moment the model says they happened. The properties are the fact's own,
 * enums and buckets only; nothing is added here.
 */
export function trackLayerOrderFact(fact: LayerOrderFact): void {
  track(EVENT_OF[fact.event], { ...fact.properties });
}

/** Where a host's layer order lives: an Edit figure, an Edit selection, a Diagram step, Pose, Fold's Import CP. */
type LayerOrderSurface = 'edit_figure' | 'edit_pattern' | 'diagram_step' | 'pose' | 'fold_import';

/**
 * A host's saved layer constraints need attention after an edit (spec §10):
 * where, and how many did not hold, bucketed by the Layer order model's own
 * ladder (`needsAttentionFact`, `layer-order/model/layerOrderAnalytics.ts`),
 * so the dialog's and the hosts' buckets agree. Never a face, a point or the
 * count itself.
 */
export function trackLayerConstraintsNeedAttention(properties: {
  surface: LayerOrderSurface;
  broken_count_bucket: string;
}): void {
  track(ANALYTICS_EVENTS.layerConstraintsNeedAttention, properties);
}

/**
 * A record a reload detached from its host, because an older build folded
 * it again, let go with Dismiss rather than reviewed: where, and how many
 * constraints it held, bucketed by the dialog's ladder (`dismissedFact`).
 */
export function trackLayerConstraintsDismissed(properties: {
  surface: LayerOrderSurface;
  constraint_count_bucket: string;
}): void {
  track(ANALYTICS_EVENTS.layerConstraintsDismissed, properties);
}
