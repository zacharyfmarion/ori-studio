/**
 * Whether the dialog's opening state has run long enough to say that large
 * figures take longer: "Large figures can take up to a minute." under
 * "Working out the layer orders…" (`LayerOrderDialogFrame`).
 *
 * An open and a restore have a minute (`LAYER_ORDER_LIMITS`), and the deepest
 * figures the source admits take most of it. Most figures open in under a
 * second, so the line waits {@link LAYER_ORDER_LONG_OPEN_MS} and never shows
 * on them. It shows only on an open with that minute: Keep trying opens again
 * with a later deadline, which the line would understate.
 */
import { useEffect, useState } from 'react';
import { LAYER_ORDER_LIMITS } from '../engine/layerOrderEngine';
import type { LayerOrderSessionStatus } from './useLayerOrderSession';

/** How long an open runs before the line shows. */
export const LAYER_ORDER_LONG_OPEN_MS = 5_000;

/** Whether `status` is an open with the usual minute, which the line describes. */
function openingWithinAMinute(status: LayerOrderSessionStatus): boolean {
  return (
    status.kind === 'opening' &&
    status.limits.deadlineMs <= Math.max(LAYER_ORDER_LIMITS.open.deadlineMs, LAYER_ORDER_LIMITS.restore.deadlineMs)
  );
}

/**
 * True once the session has been opening for {@link LAYER_ORDER_LONG_OPEN_MS},
 * on an open with the usual minute; false otherwise, and from the start again
 * at each open.
 */
export function useLayerOrderLongOpen(status: LayerOrderSessionStatus): boolean {
  const opening = openingWithinAMinute(status);
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!opening) return;
    const timer = setTimeout(() => setLong(true), LAYER_ORDER_LONG_OPEN_MS);
    return () => {
      clearTimeout(timer);
      setLong(false);
    };
  }, [opening]);
  return opening && long;
}
