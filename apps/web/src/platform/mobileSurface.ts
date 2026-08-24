import { useSyncExternalStore } from 'react';
import { readBoolean, storageKey, STORAGE_KEYS, writeBoolean } from '../lib/storage';
import { isPhoneLayout, PHONE_MEDIA_QUERY } from './phoneLayout';
import { getRuntimeSurface } from './runtime';

/**
 * Whether the app should refuse to open a workspace on this device.
 *
 * Ori Studio's surfaces are built for a mouse and a keyboard — the crease-pattern
 * canvas has no touch gestures, and the panels assume a pointer that can hover.
 * On a phone the honest answer is the landing page plus a note saying so, which
 * is what this module decides for the router, the engine boot, and `/welcome`.
 *
 * This is the **gate**, and nothing else. What a phone-shaped viewport *is* — and
 * how the app lays out on one — belongs to `platform/phoneLayout`, which this
 * module composes with a runtime check. Keeping them apart is not tidiness: the
 * exemption below is false for the Tauri shell, so a layout asking *this*
 * question would give a native phone build the desktop chrome.
 */
export { PHONE_MEDIA_QUERY };

const PHONE_OVERRIDE_KEY = storageKey(STORAGE_KEYS.phoneOverride);

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

/** Whether someone took the "open it anyway" link past the desktop-only notice. */
export function hasPhoneOverride(): boolean {
  return readBoolean(PHONE_OVERRIDE_KEY, false);
}

export function setPhoneOverride(value: boolean): void {
  writeBoolean(PHONE_OVERRIDE_KEY, value);
  notify();
}

/**
 * Whether the workspaces are closed on this device: a phone, with nobody having
 * asked to get in anyway.
 *
 * This is the question the router loaders, the engine boot, and `/welcome` all
 * ask — one predicate rather than each of them recombining the two halves.
 */
export function isWorkspaceBlocked(): boolean {
  return isPhoneSurface() && !hasPhoneOverride();
}

// --- Reactive bindings ------------------------------------------------------

const listeners = new Set<() => void>();
let phoneQuery: MediaQueryList | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * One media-query listener for however many hooks are mounted, installed with
 * the first subscriber and removed with the last. `setPhoneOverride` notifies
 * through the same path, so the override — which is localStorage, not an
 * observable — still re-renders whoever is watching.
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

/** Reactive {@link isWorkspaceBlocked}, for choosing what `/welcome` leads with. */
export function useIsWorkspaceBlocked(): boolean {
  return useSyncExternalStore(subscribe, isWorkspaceBlocked, () => false);
}
