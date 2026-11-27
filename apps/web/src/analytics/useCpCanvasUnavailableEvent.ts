import { useEffect } from 'react';
import type { CpRendererStatus } from '../cp-workspace/renderer/webglSupport';
import { ANALYTICS_EVENTS } from './events';
import { track } from './runtime';

/** What the user was shown in place of the canvas. */
type CpCanvasUnavailableState = 'restoring' | 'unsupported';

/** Why, as an enum: the capability gap, or how the context was lost. */
type CpCanvasUnavailableCause =
  | 'lost_while_drawing'
  | 'lost_at_start'
  | 'stopped_responding'
  | 'no_webgl'
  | 'no_instanced_arrays'
  | 'unexpected';

function unavailableEvent(status: CpRendererStatus): {
  state: CpCanvasUnavailableState;
  cause: CpCanvasUnavailableCause;
} {
  if (status.kind === 'context-lost') {
    const cause =
      status.gap === 'context-failed'
        ? 'stopped_responding'
        : status.gap === undefined
          ? 'lost_while_drawing'
          : 'lost_at_start';
    return { state: 'restoring', cause };
  }
  switch (status.gap) {
    case 'no-context':
      return { state: 'unsupported', cause: 'no_webgl' };
    case 'no-instanced-arrays':
      return { state: 'unsupported', cause: 'no_instanced_arrays' };
    case 'context-lost-at-start':
      return { state: 'unsupported', cause: 'lost_at_start' };
    case 'context-failed':
      return { state: 'unsupported', cause: 'stopped_responding' };
    case null:
      return { state: 'unsupported', cause: 'unexpected' };
  }
}

/** Page-wide, not per canvas: several canvases share one starved document. */
const sent = new Set<string>();

/**
 * Emit `cp canvas unavailable` when a crease-pattern canvas shows why it cannot
 * draw. Fired from the view that shows it, so it counts what users were shown.
 *
 * Once per state and cause per page load: a document out of contexts can lose
 * and regain one many times a second, and the question this answers is how many
 * people meet each cause, not how often their browser flickered.
 *
 * Only enums leave: `detail`, which can carry a raw error message, never does.
 */
export function useCpCanvasUnavailableEvent(status: CpRendererStatus): void {
  const { state, cause } = unavailableEvent(status);
  useEffect(() => {
    const key = `${state}:${cause}`;
    if (sent.has(key)) return;
    sent.add(key);
    track(ANALYTICS_EVENTS.cpCanvasUnavailable, { state, cause });
  }, [state, cause]);
}

/** Tests only: forget what was sent, as a fresh page load would. */
export function resetCpCanvasUnavailableEventForTests(): void {
  sent.clear();
}
