import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { track } from '../analytics';
import { ANALYTICS_EVENTS } from '../analytics/events';

/**
 * Say that the model's up was set, and count it.
 *
 * A toast rather than something on the button, because this verb is **invisible
 * by construction**: the whole contract of `setUpright` is that the picture does
 * not move at the moment of the press — only the axis a later drag will spin
 * about changes. So the press has nothing to show for itself until the user
 * drags again, and without this it reads as a dead button.
 *
 * Shared by all three surfaces that offer the verb — the Simulate workspace's
 * view pane, an inline simulation window's toolbar, and a 3D folded figure —
 * because three copies of "toast, then track" is how one of them quietly ends up
 * saying something different, or saying nothing.
 *
 * No properties on the event: an orientation is a measured value about someone's
 * design, which the privacy contract keeps out of analytics.
 */
export function announceUprightSet(t: TFunction): void {
  toast.success(
    t('toasts:upright.set', 'Up direction set — drag to turn around it')
  );
  track(ANALYTICS_EVENTS.modelUprightSet);
}
