/**
 * Reading the References workspace's two records out of a project file: the
 * reader's state (`creasePattern.viewState.references`) and the plan cache
 * (`artifacts.references`).
 *
 * Both drop what they cannot read rather than fail the file, like every other
 * view-state field: a malformed setting leaves that setting as it is, a
 * malformed cache entry is a sheet that replans. Neither is ever worth
 * refusing a project over.
 */
import type { ReferencesMode, ReferencesSettings } from '../../store/workspaceStore/types';
import type { PrecreasePlanLine } from './precreaseSequence';
import type {
  ReferencesPlanCacheEntryV1,
  ReferencesPlanCacheKey,
  ReferencesPlanCacheV1,
} from './referencesPlanCache';
import type {
  ReferencesCardLocator,
  ReferencesReaderStateV1,
  ReferencesSheetLocator,
} from './referencesReaderState';
import {
  REFERENCES_PLAN_SETTING_KEYS,
  REFERENCES_SETTING_FIELDS,
  REFERENCES_SETTING_KEYS,
  type ReferencesPlanSettings,
} from './referencesSettingsFields';
import type { ModelBounds } from './referencesStepGeometry';
import type { PrecreaseFrame } from './sheetFrames';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function boundsOf(value: unknown): ModelBounds | null {
  if (!isRecord(value)) return null;
  const { minX, minY, maxX, maxY } = value;
  if (!isFiniteNumber(minX) || !isFiniteNumber(minY) || !isFiniteNumber(maxX) || !isFiniteNumber(maxY)) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

function pairOf(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value as unknown[];
  return isFiniteNumber(x) && isFiniteNumber(y) ? [x, y] : null;
}

function frameOf(value: unknown): PrecreaseFrame | null {
  if (!isRecord(value)) return null;
  const origin = pairOf(value.origin);
  const xAxis = pairOf(value.x_axis);
  const yAxis = pairOf(value.y_axis);
  const { width, height } = value;
  if (!origin || !xAxis || !yAxis || !isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  return { origin, x_axis: xAxis, y_axis: yAxis, width, height };
}

function sheetLocatorOf(value: unknown): ReferencesSheetLocator | null {
  if (!isRecord(value)) return null;
  const bounds = boundsOf(value.bounds);
  if (!bounds) return null;
  const frame = frameOf(value.frame);
  return frame ? { bounds, frame } : { bounds };
}

function lineOf(value: unknown): PrecreasePlanLine | null {
  if (!isRecord(value) || !Array.isArray(value.n) || value.n.length !== 2) return null;
  const [nx, ny] = value.n as unknown[];
  if (!isFiniteNumber(nx) || !isFiniteNumber(ny) || !isFiniteNumber(value.d)) return null;
  return { n: [nx, ny], d: value.d };
}

function cardLocatorOf(value: unknown): ReferencesCardLocator | null {
  if (!isRecord(value) || !isFiniteNumber(value.index) || value.index < 0) return null;
  const index = Math.floor(value.index);
  if (value.line === null) return { index, line: null };
  const line = lineOf(value.line);
  return line ? { index, line } : null;
}

/** Each setting the file holds with the type it should have; the rest are left as they are. */
function settingsOf(value: unknown): Partial<ReferencesSettings> {
  if (!isRecord(value)) return {};
  const settings: Record<string, number | boolean> = {};
  for (const name of REFERENCES_SETTING_KEYS) {
    const setting = value[name];
    const kind = REFERENCES_SETTING_FIELDS[name].kind;
    if (kind === 'number' ? isFiniteNumber(setting) : typeof setting === 'boolean') {
      settings[name] = setting as number | boolean;
    }
  }
  return settings as Partial<ReferencesSettings>;
}

function modeOf(value: unknown): ReferencesMode {
  return value === 'sequence' ? 'sequence' : 'find';
}

/**
 * The reader state a file holds, or null for none — absent, as in every file
 * written before it existed, or not a record this build can read.
 *
 * Unlike the plan cache, this is the user's, so it is never dropped for being
 * old. A field added later is optional and read here when present; if a
 * change ever needs `v: 2`, this function goes on reading `v: 1` — lifting it
 * into the new shape — rather than starting to return null for every file
 * saved before.
 */
export function validateReferencesReaderState(value: unknown): ReferencesReaderStateV1 | null {
  if (!isRecord(value) || value.v !== 1) return null;
  return {
    v: 1,
    settings: settingsOf(value.settings),
    mode: modeOf(value.mode),
    sheet: sheetLocatorOf(value.sheet),
    landmarksFirst: value.landmarksFirst === true,
    activeCard: cardLocatorOf(value.activeCard),
  };
}

/**
 * Every plan setting, strictly: an entry missing one was made before that
 * setting existed, under whatever the planner then did, and is not a plan
 * for either value of it.
 */
function planSettingsFrom(value: unknown): ReferencesPlanSettings | null {
  if (!isRecord(value)) return null;
  const settings: Record<string, boolean> = {};
  for (const name of REFERENCES_PLAN_SETTING_KEYS) {
    const setting = value[name];
    if (typeof setting !== 'boolean') return null;
    settings[name] = setting;
  }
  return settings as unknown as ReferencesPlanSettings;
}

/**
 * A key, checked for the fields this build reads. Fields it does not know are
 * kept as they were: the entry may be another build's — a newer one's, with a
 * setting this one has never heard of — kept in the file for that build, which
 * must find it as it wrote it.
 */
function cacheKeyOf(value: unknown): ReferencesPlanCacheKey | null {
  if (!isRecord(value) || typeof value.planner !== 'string' || !isRecord(value.sheet)) return null;
  const settings = planSettingsFrom(value.settings);
  const bounds = boundsOf(value.sheet.bounds);
  const frame = frameOf(value.sheet.frame);
  const fingerprint = value.sheet.fingerprint;
  if (!settings || !bounds || !frame || typeof fingerprint !== 'string') return null;
  return {
    ...value,
    planner: value.planner,
    settings: { ...(value.settings as Record<string, unknown>), ...settings },
    sheet: { ...value.sheet, bounds, frame, fingerprint },
  } as ReferencesPlanCacheKey;
}

function waysOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function cacheEntryOf(value: unknown): ReferencesPlanCacheEntryV1 | null {
  if (!isRecord(value) || typeof value.payload !== 'string' || value.payload === '') return null;
  const key = cacheKeyOf(value.key);
  // Unknown fields kept, for the build that wrote them (`cacheKeyOf`).
  return key ? { ...value, key, ways: waysOf(value.ways), payload: value.payload } : null;
}

/**
 * The plan cache a file holds, or null for none. Entries are checked for
 * shape only; whether one is still its sheet's plan is the key's business,
 * once the sheet is looked at, and whether its payload reads is decided when
 * it is opened.
 */
export function validateReferencesPlanCache(value: unknown): ReferencesPlanCacheV1 | null {
  if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.entries)) return null;
  const entries = value.entries
    .map(cacheEntryOf)
    .filter((entry): entry is ReferencesPlanCacheEntryV1 => entry !== null);
  return entries.length > 0 ? { v: 1, entries } : null;
}
