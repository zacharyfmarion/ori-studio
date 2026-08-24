import { useSyncExternalStore } from 'react';
import type { MediaHost } from './pointerSurface';

/**
 * Whether this viewport is phone-shaped, and should therefore lay out as a phone
 * app: bottom tabs, no side rails, one toolbar row.
 *
 * Deliberately **not** `platform/mobileSurface`. That module asks whether the app
 * should *refuse to open* here, which is a product decision and which exempts the
 * Tauri shell — so `isPhoneSurface()` is `false` in a native build whatever the
 * viewport says, and a layout gated on it would hand a 393px screen the desktop
 * chrome. This module asks only about the viewport, the same way
 * `platform/pointerSurface` asks only about the pointer, and answers the same on
 * every runtime.
 *
 * The query itself is shared with the gate, which re-exports this constant: the
 * two questions differ in what they do with the answer, not in what a phone is,
 * and two thresholds would drift.
 *
 * Pointer-coarse **and** a phone-sized viewport, rather than size alone: a
 * desktop user who drags their window narrow can still hit a 24px target with a
 * mouse, so they keep the rails. That is the same trade the tool rail's own
 * breakpoints already make (`theme.css`, the `max-width: 720px` pair).
 *
 * The real question is **the shorter side**, not the width, so the query asks
 * about both and the comma ORs them. Width alone answers correctly only in
 * portrait: a 16 Pro Max in landscape is 956x440, and a width-only test would
 * give it a 50px workspace rail plus a 152px tool rail on a screen 440px tall —
 * spending the scarcest dimension it has.
 *
 * 600px because one number separates both dimensions cleanly and there is a wide
 * gap to sit in. Every phone's short side is at most ~440 (the 16 Pro Max, in
 * either orientation); every iPad's short side is at least 744 (the mini; 768 on
 * older models). Landing near the middle of 440-744 means neither a future
 * slightly-larger phone nor a future slightly-smaller tablet reclassifies on a
 * point release.
 *
 * The boundary also has to fall where no device stands, because `max-width` is
 * inclusive: it was 820px, and a base iPad in portrait is *exactly* 820
 * (measured on an iPad A16 simulator), so the cheapest iPad was told it was a
 * phone by one pixel. A threshold no shipping device can equal cannot lose that
 * way.
 *
 * Known consequence: an iPad in a narrow Split View (~507px) lays out as a
 * phone. That is the right answer — at 507px the two rails leave 305px of canvas
 * — and it is strictly better than what the *gate* does with the same device,
 * which is to block it.
 *
 * CSS cannot import this, so the string appears again in `App.css` and
 * `theme.css`, each under a banner naming this constant. `phoneLayout.test.ts`
 * reads both files and fails if either drifts.
 */
export const PHONE_MEDIA_QUERY =
  '(pointer: coarse) and (max-width: 600px), (pointer: coarse) and (max-height: 600px)';

function defaultHost(): MediaHost | null {
  if (typeof window === 'undefined') return null;
  if (typeof window.matchMedia !== 'function') return null;
  return window;
}

/**
 * True on a phone-shaped touch viewport.
 *
 * A host that cannot answer media queries — jsdom without a stub, any
 * non-browser — answers `false`, so anything headless lays out as a desktop
 * rather than collapsing to the phone chrome.
 */
export function isPhoneLayout(host: MediaHost | null = defaultHost()): boolean {
  return host?.matchMedia(PHONE_MEDIA_QUERY).matches ?? false;
}

// --- Reactive binding -------------------------------------------------------

function subscribe(onChange: () => void): () => void {
  const query = defaultHost()?.matchMedia(PHONE_MEDIA_QUERY);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

function readSnapshot(): boolean {
  return isPhoneLayout();
}

/**
 * Reactive {@link isPhoneLayout}.
 *
 * The viewport changes under a live app more often than the pointer does — a
 * rotation, a Split View drag, a resized desktop window — so anything gated on
 * it follows rather than sampling once at mount.
 */
export function useIsPhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, readSnapshot, () => false);
}
