/**
 * Centralized browser-storage layer. Every persisted preference and piece of UI
 * state goes through here so the app has a single namespace, a single guard for
 * unavailable/throwing storage (SSR, Safari private mode, disabled cookies), and
 * one place that lists every key it uses.
 *
 * Domain stores keep their own semantics on top of these primitives — the layout
 * store scopes keys per workspace/variant and version-gates them; the shortcut
 * store carries a version field inside its value. This module only owns the safe
 * read/write/serialize plumbing they share.
 */

export const STORAGE_NAMESPACE = 'oristudio';

/**
 * Every storage key the app uses, without the namespace prefix. Compose the full
 * key with {@link storageKey}. `layout`/`layoutVersion` are base names the layout
 * store extends with a scope (e.g. `oristudio:layout:design`).
 */
export const STORAGE_KEYS = {
  theme: 'theme',
  shortcuts: 'shortcuts',
  locale: 'locale',
  showWelcomeOnStartup: 'show-welcome-on-startup',
  foldWarning: 'fold-warning',
  cpToolRailGroups: 'cp-tool-rail-groups',
  layout: 'layout',
  layoutVersion: 'layout-version',
  tutorialProgress: 'tutorial-progress',
} as const;

/** Build a namespaced key: `storageKey('layout', 'design') → 'oristudio:layout:design'`. */
export function storageKey(...parts: string[]): string {
  return [STORAGE_NAMESPACE, ...parts].join(':');
}

/**
 * The `Storage` object, or `null` when it is unavailable — server-side rendering,
 * or a browser that throws on access. Callers fall back to their own defaults
 * when this is `null`, so persistence degrades silently instead of crashing.
 */
function getLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readString(key: string): string | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore write failures (quota exceeded, restricted context).
  }
}

export function removeKey(key: string): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore.
  }
}

/** Read and parse a JSON value, returning `fallback` when absent or malformed. */
export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeString(key, JSON.stringify(value));
}

/** Read a boolean, returning `fallback` when the key is absent. */
export function readBoolean(key: string, fallback: boolean): boolean {
  const raw = readString(key);
  if (raw === null) return fallback;
  return raw === 'true';
}

export function writeBoolean(key: string, value: boolean): void {
  writeString(key, value ? 'true' : 'false');
}
