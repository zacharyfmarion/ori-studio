/**
 * "Show this region in Edit", asked for from a surface the crease-pattern
 * canvas is not on — the Diagram's Open in Edit. The canvas may not be mounted
 * when it is asked, so the request is latched here and taken by the canvas on
 * its first frame with a viewport to frame in, through the same framing rule
 * as a jump to a diagnostic (`frameUserCameraOnBounds`). A canvas that is
 * mounted draws only on demand, so a request also asks it for a frame.
 *
 * The newest request wins; taking one clears it.
 */
import type { FoldedSourceBounds } from '../../engine/oristudioCpTypes';

let pending: FoldedSourceBounds | null = null;
const listeners = new Set<() => void>();

export function requestCpRegionFocus(bounds: FoldedSourceBounds): void {
  pending = { ...bounds };
  for (const listener of [...listeners]) listener();
}

/** Hear a request as it is made: a mounted canvas draws, and takes it. Returns the unsubscribe. */
export function subscribeCpRegionFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The region waiting to be framed, if any; taking it clears it. */
export function takeCpRegionFocus(): FoldedSourceBounds | null {
  const taken = pending;
  pending = null;
  return taken;
}
