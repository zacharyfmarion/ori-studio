/**
 * Marking a device as belonging to someone who works on Ori Studio, so the
 * project's "filter out internal and test users" setting can drop it.
 *
 * Analytics here is anonymous — no login, no email — so PostHog's usual
 * "exclude @company.com" has nothing to match on, and the stable id is
 * re-minted whenever storage is cleared, so a list of ids goes stale. The
 * device is marked instead: open the app once with `?internal=1` and the flag
 * persists; from then on every event carries the super property
 * `internal_user: true`, which the project setting excludes with
 * `internal_user is not set`. `?internal=0` clears it. The parameter is
 * consumed before the router or PostHog see the URL, so it neither lingers in
 * the address bar nor leaks into a share link.
 *
 * Deliberately not the SDK's own `$internal_or_test_user`. That is a *person*
 * property the SDK sets by hostname, and its default pattern matched the
 * desktop app's `tauri://localhost` origin, which put every Mac desktop user in
 * the "test users" cohort. The hostname heuristic is switched off in
 * `initializePostHog` for that reason, and this flag is an event property so
 * the filter reads the same on every surface.
 */

import { readBoolean, removeKey, storageKey, STORAGE_KEYS, writeBoolean } from '../lib/storage';

const INTERNAL_USER_KEY = storageKey(STORAGE_KEYS.analyticsInternalUser);

/** The query parameter that sets (`1`) or clears (`0`) the flag. */
export const INTERNAL_USER_QUERY_PARAM = 'internal';

/** The pieces of `window.location` / `window.history` this reads and rewrites. */
export interface InternalUserFlagSource {
  location: { pathname: string; search: string; hash: string };
  history: { state: unknown; replaceState(data: unknown, unused: string, url?: string): void };
}

function defaultSource(): InternalUserFlagSource | null {
  if (typeof window === 'undefined') return null;
  return { location: window.location, history: window.history };
}

/** Whether this device has been marked as internal. */
export function isInternalUser(): boolean {
  return readBoolean(INTERNAL_USER_KEY, false);
}

/**
 * Apply and strip `?internal=…` from the current URL, returning the resulting
 * flag. Any other value of the parameter is ignored but still stripped, so a
 * typo does not end up in a share link either.
 */
export function consumeInternalUserFlag(source: InternalUserFlagSource | null = defaultSource()): boolean {
  if (!source) return isInternalUser();
  const params = new URLSearchParams(source.location.search);
  const value = params.get(INTERNAL_USER_QUERY_PARAM);
  if (value === null) return isInternalUser();

  if (value === '1' || value === 'true') writeBoolean(INTERNAL_USER_KEY, true);
  else if (value === '0' || value === 'false') removeKey(INTERNAL_USER_KEY);

  params.delete(INTERNAL_USER_QUERY_PARAM);
  const search = params.toString();
  const url = `${source.location.pathname}${search ? `?${search}` : ''}${source.location.hash}`;
  try {
    source.history.replaceState(source.history.state, '', url);
  } catch {
    // A history that refuses the rewrite (a sandboxed frame) still gets the flag.
  }
  return isInternalUser();
}

/**
 * The super property for a marked device, and nothing at all otherwise — the
 * project filter is `is not set`, so an explicit `false` would be a second
 * value to keep in step with it for no gain.
 */
export function getInternalUserProperties(): Record<string, unknown> {
  return isInternalUser() ? { internal_user: true } : {};
}
