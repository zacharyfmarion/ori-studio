/**
 * The ratio of device pixels to CSS pixels every simulator surface draws at.
 *
 * The viewport sizes its drawing buffer by it and the palette scales the crease
 * width by it, so an export that wants to undo either has to read the same
 * number — one function rather than three copies of the expression. Floored at
 * 1: a zoomed-out page reports a ratio below 1, and a drawing buffer smaller
 * than its box is never what anyone wants. 1 off the main thread, where there
 * is no window to ask.
 */
export function simulatorDevicePixelRatio(): number {
  return typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1);
}
