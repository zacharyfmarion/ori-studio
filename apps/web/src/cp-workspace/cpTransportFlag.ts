/**
 * Phase 2 A/B flag for the compact geometry transport.
 *
 * When enabled, the CP render path builds crease strokes from the compact
 * `CpGeometryTransport` (typed arrays) instead of the structured snapshot, and
 * the store fetches that transport per edit alongside the snapshot. Defaults
 * **off** — the structured path is untouched — so a compact-path defect is
 * "fall back to slow," never "wrong."
 *
 * Toggle in the browser console and reload to A/B (the value is read when the
 * render callbacks are built, not reactively):
 *
 *   localStorage.setItem('cp.compactTransport', '1'); // on
 *   localStorage.removeItem('cp.compactTransport');    // off
 */
const STORAGE_KEY = 'cp.compactTransport';

export function isCompactTransportEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
