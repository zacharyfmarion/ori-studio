/**
 * The open document's plan cache: one entry per sheet planned, read from the
 * file on open, added to as plans land, written back on save.
 *
 * A module side table, like `referencesResults` and for the same reasons — the
 * payloads are large, and nothing re-renders on them. It answers only to the
 * document it was filled for: every call names the document's load serial,
 * and a call for another one finds the table empty and starts it afresh, so a
 * new or imported document can never be shown a plan of the last one.
 *
 * Entries are kept packed (`encodeCachedPlan`) from the moment a plan lands:
 * the size of each is what the cap is measured in, and a save then has
 * nothing left to do but write them.
 */
import { reportError } from '../../monitoring';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import {
  comparePlanCacheKeys,
  encodeCachedPlan,
  REFERENCES_PLAN_CACHE_MAX_CHARS,
  samePlanSheet,
  sheetFingerprint,
  type ReferencesCachedPlan,
  type ReferencesPlanCacheKey,
  type ReferencesPlanCacheOutcome,
  type ReferencesPlanCacheV1,
} from './referencesPlanCache';
import { precreaseInputFromTransport } from './sheetFrames';

interface CacheEntry {
  key: ReferencesPlanCacheKey;
  ways: Record<string, string>;
  /** Null while the plan is still being packed; see `pending`. */
  payload: string | null;
  /** Fields of a file's entry this build does not know, written back as read. */
  rest?: Record<string, unknown>;
}

interface CacheState {
  loadSerial: number | null;
  /** Most recently viewed first. */
  entries: CacheEntry[];
  /** Plans still being packed, for a save to wait on. */
  pending: Set<Promise<void>>;
}

let state: CacheState = { loadSerial: null, entries: [], pending: new Set() };

/**
 * Bumped whenever what {@link referencesPlanCacheListing} answers can have
 * changed — a plan packed, forgotten or given new ways, a file's cache
 * installed, the table started afresh — for a reader outside the References
 * panel (the Diagram's References browser) to list it again.
 */
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Be told when the cache's listing can have changed; returns the way to stop. */
export function subscribeReferencesPlanCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A number that changes whenever the listing can have: a snapshot for `useSyncExternalStore`. */
export function referencesPlanCacheVersion(): number {
  return version;
}

/** The entries of document `loadSerial`, starting afresh when the table holds another's. */
function entriesOf(loadSerial: number): CacheEntry[] {
  if (state.loadSerial !== loadSerial) {
    state = { loadSerial, entries: [], pending: new Set() };
    changed();
  }
  return state.entries;
}

/** A cached plan as a reader outside References sees it: packed, with the ways chosen in it. */
export interface ReferencesPlanCacheListing {
  key: ReferencesPlanCacheKey;
  /** The way chosen at each step with alternatives, by line id. */
  ways: Readonly<Record<string, string>>;
  payload: string;
}

/**
 * Every packed plan of document `loadSerial`, read without touching the
 * table: nothing is reordered, and a call for another document finds nothing
 * rather than starting the table afresh. Plans of any planner and any
 * creases — the caller says which it can show.
 */
export function referencesPlanCacheListing(loadSerial: number): ReferencesPlanCacheListing[] {
  if (state.loadSerial !== loadSerial) return [];
  return state.entries.flatMap((entry) =>
    entry.payload === null ? [] : [{ key: entry.key, ways: { ...entry.ways }, payload: entry.payload }]
  );
}

/** A sheet's slot: one entry per box and frame, whichever planner made it. */
function indexOfSheet(entries: readonly CacheEntry[], key: ReferencesPlanCacheKey): number {
  return entries.findIndex((entry) => samePlanSheet(entry.key.sheet, key.sheet));
}

/**
 * The most recently viewed entries that fit under the cap together, in order:
 * the first that does not fit ends the list, so a plan the reader looked at is
 * never dropped to keep an older one. An entry too large ever to fit is skipped
 * rather than ending it; one still packing costs nothing yet.
 */
function capped(entries: readonly CacheEntry[]): CacheEntry[] {
  const kept: CacheEntry[] = [];
  let total = 0;
  for (const entry of entries) {
    const size = entry.payload?.length ?? 0;
    if (size > REFERENCES_PLAN_CACHE_MAX_CHARS) continue;
    if (total + size > REFERENCES_PLAN_CACHE_MAX_CHARS) break;
    total += size;
    kept.push(entry);
  }
  return kept;
}

/**
 * The cache a file was opened with. Replaces whatever the table held: a file
 * is a new document, whatever it holds.
 */
export function installReferencesPlanCache(
  cache: ReferencesPlanCacheV1 | null,
  loadSerial: number
): void {
  state = {
    loadSerial,
    entries: (cache?.entries ?? []).map(({ key, ways, payload, ...rest }) => ({
      key,
      ways: { ...ways },
      payload,
      rest,
    })),
    pending: new Set(),
  };
  changed();
}

/**
 * A plan has landed: keep it as its sheet's entry, the most recently viewed,
 * in place of any plan the sheet had. Packed in the background — a plan that
 * cannot be packed is simply not kept, and the sheet replans next time.
 */
export function rememberReferencesPlan(
  loadSerial: number,
  key: ReferencesPlanCacheKey,
  plan: ReferencesCachedPlan
): void {
  const entries = entriesOf(loadSerial);
  const at = indexOfSheet(entries, key);
  if (at >= 0) entries.splice(at, 1);
  const entry: CacheEntry = { key, ways: {}, payload: null };
  entries.unshift(entry);
  const owner = state;
  const packing = encodeCachedPlan(plan)
    .then((payload) => {
      entry.payload = payload;
      if (owner === state) {
        state.entries = capped(state.entries);
        changed();
      }
    })
    .catch((error: unknown) => {
      reportError(error, { surface: 'references:plan-cache' });
      const index = owner.entries.indexOf(entry);
      if (index >= 0) owner.entries.splice(index, 1);
    })
    .finally(() => {
      owner.pending.delete(packing);
    });
  owner.pending.add(packing);
}

/** What a lookup found for a sheet: the entry and whether it is the plan wanted. */
export type ReferencesPlanCacheLookup =
  | { outcome: 'hit'; payload: string; ways: Record<string, string> }
  | { outcome: Exclude<ReferencesPlanCacheOutcome, 'hit'> };

/**
 * The cached plan for the sheet `key` names, if it is the plan wanted; null
 * when the sheet has no entry, or none packed yet. A hit becomes the most
 * recently viewed.
 *
 * A miss leaves the entry where it is. It may be another build's plan — the
 * desktop release's, say, in a file the web app is reading — which that build
 * can still show; and the replan that follows a miss takes its slot anyway.
 */
export function lookupReferencesPlan(
  loadSerial: number,
  key: ReferencesPlanCacheKey
): ReferencesPlanCacheLookup | null {
  const entries = entriesOf(loadSerial);
  const at = indexOfSheet(entries, key);
  if (at < 0) return null;
  const entry = entries[at];
  if (entry.payload === null) return null;
  const outcome = comparePlanCacheKeys(entry.key, key);
  if (outcome !== 'hit') return { outcome };
  entries.splice(at, 1);
  entries.unshift(entry);
  return { outcome, payload: entry.payload, ways: { ...entry.ways } };
}

/**
 * The sheet's plan could not be read after all: forget it. Only in the
 * document it came from — a late answer about the last document must not
 * start this one's table afresh.
 */
export function forgetReferencesPlan(loadSerial: number, key: ReferencesPlanCacheKey): void {
  if (state.loadSerial !== loadSerial) return;
  const at = indexOfSheet(state.entries, key);
  if (at < 0) return;
  state.entries.splice(at, 1);
  changed();
}

/** The reader chose a way: keep the choices with the plan they name, in that plan's document. */
export function setReferencesPlanWays(
  loadSerial: number,
  key: ReferencesPlanCacheKey,
  ways: Record<string, string>
): void {
  if (state.loadSerial !== loadSerial) return;
  const entries = state.entries;
  const entry = entries[indexOfSheet(entries, key)];
  if (entry && comparePlanCacheKeys(entry.key, key) === 'hit') {
    entry.ways = { ...ways };
    changed();
  }
}

/**
 * The cache to write with document `loadSerial`'s creases, or null for none.
 *
 * Waits for plans still being packed. Drops what no build could ever show
 * again: an entry whose sheet's creases, as they are being saved, are not the
 * ones it was planned from. Another planner's entry is kept when it passes
 * that — it is that build's plan, for when the file goes back to it — and one
 * whose fingerprint this build cannot recompute (another algorithm, by its
 * prefix) is kept for that build to judge. Then the cap, which sinks whatever
 * nobody views to the end and off it.
 */
export async function referencesPlanCacheForSave(
  loadSerial: number,
  geometry: CpGeometryTransport | null
): Promise<ReferencesPlanCacheV1 | null> {
  // No creases to check the entries against, no entries: one this save could
  // not vouch for is one a reopen might show against the wrong creases.
  if (state.loadSerial !== loadSerial || !geometry) return null;
  const owner = state;
  await Promise.all([...owner.pending]);
  if (state !== owner) return null;
  const input = precreaseInputFromTransport(geometry);
  const live = owner.entries.filter((entry) => {
    if (entry.payload === null) return false;
    const fingerprint = sheetFingerprint(input, entry.key.sheet.bounds);
    const comparable = fingerprintAlgorithm(entry.key.sheet.fingerprint) === fingerprintAlgorithm(fingerprint);
    return !comparable || entry.key.sheet.fingerprint === fingerprint;
  });
  const entries = capped(live).map((entry) => ({
    ...entry.rest,
    key: entry.key,
    ways: { ...entry.ways },
    payload: entry.payload ?? '',
  }));
  return entries.length > 0 ? { v: 1, entries } : null;
}

/** The algorithm a fingerprint names in its prefix (`keyDigest`). */
function fingerprintAlgorithm(fingerprint: string): string {
  return fingerprint.slice(0, fingerprint.indexOf(':') + 1);
}

/** For tests: forget everything. */
export function resetReferencesPlanCacheForTests(): void {
  state = { loadSerial: null, entries: [], pending: new Set() };
  changed();
}
