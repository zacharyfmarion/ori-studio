import { useSyncExternalStore } from 'react';
import { isPhoneLayout, PHONE_MEDIA_QUERY } from './phoneLayout';
import { getRuntimeSurface } from './runtime';

/**
 * Whether this is a phone-shaped *browser* session, for the handful of places
 * that need to know the device rather than the viewport.
 *
 * There used to be a gate here as well: a phone was refused the workspaces
 * outright and offered an "Open App (unoptimized on mobile)" escape hatch that
 * set a persisted override. Every reason for it is gone — the canvas has a
 * multi-touch arbiter, the panels have a phone layout, the design panes show one
 * at a time and the chrome fits — so a phone now follows the same routing and
 * the same startup preference as everything else. What is left is a fact about
 * the device, with no policy attached.
 *
 * The split from `platform/phoneLayout` survives the gate, and is not tidiness:
 * the Tauri exemption below is false for the desktop shell, so a *layout* asking
 * this question would give a native build the wrong chrome.
 */
export { PHONE_MEDIA_QUERY };

/**
 * `window`, when it can answer media queries. jsdom without a stub, and any
 * non-browser host, get `null` and are treated as "not a phone".
 */
function mediaHost(): Window | null {
  if (typeof window === 'undefined') return null;
  if (typeof window.matchMedia !== 'function') return null;
  return window;
}

/**
 * True on a phone-sized touch device the gate applies to.
 *
 * The Tauri shell short-circuits to `false` before any media query runs. It has
 * no address bar and runs on a memory router, so a gate misfiring there would
 * strand the user on `/welcome` with no way back. It still *lays out* as a phone
 * when the viewport says so — that is `isPhoneLayout`'s question, and the split
 * between the two is the whole reason this module no longer owns the query.
 */
export function isPhoneSurface(): boolean {
  if (getRuntimeSurface() === 'desktop') return false;
  return isPhoneLayout(mediaHost());
}

// --- Reactive bindings ------------------------------------------------------

const listeners = new Set<() => void>();
let phoneQuery: MediaQueryList | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * One media-query listener for however many hooks are mounted, installed with
 * the first subscriber and removed with the last.
 */
function subscribe(onChange: () => void): () => void {
  if (listeners.size === 0) {
    phoneQuery = mediaHost()?.matchMedia(PHONE_MEDIA_QUERY) ?? null;
    phoneQuery?.addEventListener('change', notify);
  }
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size > 0) return;
    phoneQuery?.removeEventListener('change', notify);
    phoneQuery = null;
  };
}

/** Reactive {@link isPhoneSurface}, for layout that follows the viewport. */
export function useIsPhoneSurface(): boolean {
  return useSyncExternalStore(subscribe, isPhoneSurface, () => false);
}
