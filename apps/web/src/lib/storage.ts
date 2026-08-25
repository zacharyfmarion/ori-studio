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
  /** What an unmodified scroll does on the crease-pattern canvas: pan or zoom. */
  cpWheelGesture: 'cp-wheel-gesture',
  /** How far the pointer may sit from a snap target, in Oriedita model units. */
  cpSnapRadius: 'cp-snap-radius',
  cpToolRailGroups: 'cp-tool-rail-groups',
  cpMeasure: 'cp-measure',
  cpToolOptions: 'cp-tool-options',
  cpToolHintCollapsed: 'cp-tool-hint-collapsed',
  bpOptimizer: 'bp-optimizer',
  simulatorSettings: 'simulator-settings',
  /** Whether product analytics is enabled (opt-out preference; default true). */
  analyticsEnabled: 'analytics-enabled',
  /** Anonymous, locally-generated stable id used to `identify()` in PostHog. */
  analyticsId: 'analytics-id',
  /**
   * How updates are delivered: automatic, notify-only, or off. Tauri has no
   * delta updates, so every release is a full download — someone on metered or
   * hotel wifi needs a way to stop that without turning off the notice too.
   */
  updateDelivery: 'update-delivery',
  /** A version the user asked not to be reminded about. Cleared by a newer one. */
  updateSkippedVersion: 'update-skipped-version',
  /**
   * The highest version ever *offered*. A manifest naming something lower is
   * refused: minisign proves a payload's integrity, not that it is current, so
   * without this an old-but-validly-signed release could be served indefinitely
   * to hold the fleet back from a fix.
   */
  updateHighestSeenVersion: 'update-highest-seen-version',
  layout: 'layout',
  layoutVersion: 'layout-version',
  shareAuthor: 'share-author',
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

/**
 * Read a number, returning `fallback` when the key is absent or holds anything
 * that is not a finite number. Range is the caller's business — a preference
 * clamps what it reads, so a hand-edited key degrades instead of escaping its
 * own bounds.
 *
 * The empty-string guard is not redundant: `Number('')` and `Number(' ')` are
 * both `0`, which is a plausible-looking value for most of these keys.
 */
export function readNumber(key: string, fallback: number): number {
  const raw = readString(key);
  if (raw === null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function writeNumber(key: string, value: number): void {
  writeString(key, String(value));
}
