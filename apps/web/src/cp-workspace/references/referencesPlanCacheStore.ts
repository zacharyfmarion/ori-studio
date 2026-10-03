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
  REFERENCES_PLANNER_BUILD,
  sheetFingerprint,
  type ReferencesCachedPlan,
  type ReferencesPlanCacheKey,
  type ReferencesPlanCacheOutcome,
  type ReferencesPlanCacheV1,
} from './referencesPlanCache';
import { sameSheetBounds } from './referencesSheets';

interface CacheEntry {
  key: ReferencesPlanCacheKey;
  ways: Record<string, string>;
  /** Null while the plan is still being packed; see `pending`. */
  payload: string | null;
}

interface CacheState {
  loadSerial: number | null;
  /** Most recently viewed first. */
  entries: CacheEntry[];
  /** Plans still being packed, for a save to wait on. */
  pending: Set<Promise<void>>;
}

let state: CacheState = { loadSerial: null, entries: [], pending: new Set() };

/** The entries of document `loadSerial`, starting afresh when the table holds another's. */
function entriesOf(loadSerial: number): CacheEntry[] {
  if (state.loadSerial !== loadSerial) {
    state = { loadSerial, entries: [], pending: new Set() };
  }
  return state.entries;
}

function indexOfSheet(entries: readonly CacheEntry[], key: ReferencesPlanCacheKey): number {
  return entries.findIndex((entry) => sameSheetBounds(entry.key.sheet.bounds, key.sheet.bounds));
}

/** Most recent first, as many as fit under the cap; an entry still packing costs nothing yet. */
function capped(entries: readonly CacheEntry[]): CacheEntry[] {
  const kept: CacheEntry[] = [];
  let total = 0;
  for (const entry of entries) {
    const size = entry.payload?.length ?? 0;
    if (total + size > REFERENCES_PLAN_CACHE_MAX_CHARS) continue;
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
    entries: (cache?.entries ?? []).map((entry) => ({
      key: entry.key,
      ways: { ...entry.ways },
      payload: entry.payload,
    })),
    pending: new Set(),
  };
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
      if (owner === state) state.entries = capped(state.entries);
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
 * when the sheet has no entry, or none packed yet. A sheet whose entry is not
 * the plan wanted loses it — it can never be wanted again, and the replan that
 * follows takes its place — and a hit becomes the most recently viewed.
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
  entries.splice(at, 1);
  if (outcome !== 'hit') return { outcome };
  entries.unshift(entry);
  return { outcome, payload: entry.payload, ways: { ...entry.ways } };
}

/** The sheet's plan could not be read after all: forget it. */
export function forgetReferencesPlan(loadSerial: number, key: ReferencesPlanCacheKey): void {
  const entries = entriesOf(loadSerial);
  const at = indexOfSheet(entries, key);
  if (at >= 0) entries.splice(at, 1);
}

/** The reader chose a way: keep the choices with the plan they name. */
export function setReferencesPlanWays(
  loadSerial: number,
  key: ReferencesPlanCacheKey,
  ways: Record<string, string>
): void {
  const entries = entriesOf(loadSerial);
  const entry = entries[indexOfSheet(entries, key)];
  if (entry && comparePlanCacheKeys(entry.key, key) === 'hit') entry.ways = { ...ways };
}

/**
 * The cache to write with document `loadSerial`'s creases, or null for none.
 *
 * Waits for plans still being packed. Drops what can never be a hit again:
 * an entry from another planner, and one whose sheet's creases, as they are
 * being saved, are not the ones it was planned from. Then the cap.
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
  const live = owner.entries.filter(
    (entry) =>
      entry.payload !== null &&
      entry.key.planner === REFERENCES_PLANNER_BUILD &&
      entry.key.sheet.fingerprint === sheetFingerprint(geometry, entry.key.sheet.bounds)
  );
  const entries = capped(live).map((entry) => ({
    key: entry.key,
    ways: { ...entry.ways },
    payload: entry.payload ?? '',
  }));
  return entries.length > 0 ? { v: 1, entries } : null;
}

/** For tests: forget everything. */
export function resetReferencesPlanCacheForTests(): void {
  state = { loadSerial: null, entries: [], pending: new Set() };
}
