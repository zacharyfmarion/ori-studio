import { useEffect, useRef } from 'react';
import { ANALYTICS_EVENTS } from './events';
import { track } from './runtime';

/**
 * Emit `diagram outdated shape shown` each time Pose shows a Simulated step's
 * picture because this build cannot put its saved shape back: from the view
 * that shows it, so the count is of what the user saw, once per showing.
 * No properties: whether this happens at all is the question.
 */
export function useDiagramOutdatedShapeEvent(shown: boolean): void {
  const wasShownRef = useRef(false);
  useEffect(() => {
    if (shown && !wasShownRef.current) track(ANALYTICS_EVENTS.diagramOutdatedShapeShown);
    wasShownRef.current = shown;
  }, [shown]);
}
