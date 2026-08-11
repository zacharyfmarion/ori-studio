import { useEffect, useState } from 'react';

/**
 * The camera scale a layer's windows are currently laid out at, which lags the
 * live one while the camera is moving.
 *
 * Re-rendering twenty windows on every frame of a zoom is what made this
 * expensive: each is a worker render, an ImageBitmap, a postMessage and a
 * composite, and at peak that measured 640 bitmaps a second. Holding the layout
 * still and scaling by transform costs the compositor nothing extra — it is
 * already compositing these layers — and the windows re-render once, when the
 * camera stops.
 *
 * Kept per layer rather than shared between them. The two window layers pass the
 * identical `pxPerModel` and the ratio is scale-invariant, so both settle on the
 * same frame anyway; a shared instance would only add a subscription.
 */

/**
 * How long the camera must hold still before the windows are laid out — and so
 * re-rendered — at its new scale.
 *
 * Short enough that letting go of a zoom feels like it sharpens immediately,
 * long enough that a continuous gesture never crosses it.
 */
const SCALE_SETTLE_MS = 140;

/**
 * How far the transform may stretch a window before waiting for the camera to
 * stop stops being acceptable.
 *
 * Without this, a slow continuous zoom never settles — each frame restarts the
 * timer — and the windows stay soft for as long as it lasts. With it, the worst
 * case is a single octave of upscale, and a fast zoom across the whole range
 * pays a handful of re-layouts instead of one per frame.
 *
 * Asymmetric on purpose: scaling *down* costs no sharpness (the bitmap is
 * supersampled), so only the upscale direction needs bounding.
 */
export const MAX_UNSETTLED_UPSCALE = 2;

export function useSettledScale(pxPerModel: number): number {
  const [settled, setSettled] = useState(pxPerModel);
  useEffect(() => {
    if (pxPerModel === settled) return undefined;
    // Past the stretch limit, do not wait for the gesture to end.
    if (pxPerModel / settled > MAX_UNSETTLED_UPSCALE) {
      setSettled(pxPerModel);
      return undefined;
    }
    const id = window.setTimeout(() => setSettled(pxPerModel), SCALE_SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [pxPerModel, settled]);
  return settled;
}
