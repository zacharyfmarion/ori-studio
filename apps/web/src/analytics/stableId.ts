/**
 * The anonymous, locally-generated id we pass to `posthog.identify()`.
 *
 * It is a random UUID, stored only in this browser's localStorage — never
 * derived from anything about the user, never sent anywhere except as PostHog's
 * distinct id. Opting out clears it (see {@link clearStableId}); opting back in
 * mints a fresh one, so the two sessions are not linkable.
 */

import { readString, removeKey, storageKey, STORAGE_KEYS, writeString } from '../lib/storage';

const STABLE_ID_KEY = storageKey(STORAGE_KEYS.analyticsId);

function createRandomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-crypto fallback below.
  }
  // Only reached when Web Crypto is unavailable. Not cryptographically strong,
  // but this id is an opaque anonymous handle, not a secret.
  return `ori-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Return the stored id, creating and persisting one on first use. */
export function getOrCreateStableId(): string {
  const existing = readString(STABLE_ID_KEY);
  if (existing) return existing;
  const id = createRandomId();
  writeString(STABLE_ID_KEY, id);
  return id;
}

/** Forget the id (called on opt-out so re-opting-in is a fresh identity). */
export function clearStableId(): void {
  removeKey(STABLE_ID_KEY);
}

/** The stored id without creating one — for tests and diagnostics. */
export function peekStableId(): string | null {
  return readString(STABLE_ID_KEY);
}
