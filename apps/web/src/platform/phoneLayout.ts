import { useContext, useSyncExternalStore } from 'react';
import { isPhoneLayout, PHONE_MEDIA_QUERY } from './phoneLayoutQuery';
import { ServerPhoneSurface } from './serverPhoneSurface';

// The predicate lives in `phoneLayoutQuery.ts`, which imports no React, so the landing
// page's inline head script can ask the same question (see `seo/staticPaintHead.ts`).
export { isPhoneLayout, PHONE_MEDIA_QUERY };

function defaultHost() {
  if (typeof window === 'undefined') return null;
  if (typeof window.matchMedia !== 'function') return null;
  return window;
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
  const server = useContext(ServerPhoneSurface);
  return useSyncExternalStore(subscribe, readSnapshot, () => server);
}
