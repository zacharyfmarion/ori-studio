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
  ReferencesPlanSettings,
} from './referencesPlanCache';
import type {
  ReferencesCardLocator,
  ReferencesReaderStateV1,
  ReferencesSheetLocator,
} from './referencesReaderState';
import type { ModelBounds } from './referencesStepGeometry';

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

function sheetLocatorOf(value: unknown): ReferencesSheetLocator | null {
  if (!isRecord(value)) return null;
  const bounds = boundsOf(value.bounds);
  return bounds ? { bounds } : null;
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

const BOOLEAN_SETTINGS = [
  'includeApproximate',
  'precreaseGrid',
  'gridWhereNeeded',
  'allowDanglingFolds',
  'mergeSymmetricSteps',
] as const satisfies readonly (keyof ReferencesSettings)[];

function settingsOf(value: unknown): Partial<ReferencesSettings> {
  if (!isRecord(value)) return {};
  const settings: Partial<ReferencesSettings> = {};
  if (isFiniteNumber(value.candidateCount)) settings.candidateCount = value.candidateCount;
  for (const name of BOOLEAN_SETTINGS) {
    const setting = value[name];
    if (typeof setting === 'boolean') settings[name] = setting;
  }
  return settings;
}

function modeOf(value: unknown): ReferencesMode {
  return value === 'sequence' ? 'sequence' : 'find';
}

/**
 * The reader state a file holds, or null for none — absent, as in every file
 * written before it existed, or not a record this build can read.
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

function planSettingsOf(value: unknown): ReferencesPlanSettings | null {
  if (!isRecord(value)) return null;
  const { precreaseGrid, gridWhereNeeded, allowDanglingFolds, mergeSymmetricSteps } = value;
  if (
    typeof precreaseGrid !== 'boolean' ||
    typeof gridWhereNeeded !== 'boolean' ||
    typeof allowDanglingFolds !== 'boolean' ||
    typeof mergeSymmetricSteps !== 'boolean'
  ) {
    return null;
  }
  return { precreaseGrid, gridWhereNeeded, allowDanglingFolds, mergeSymmetricSteps };
}

function cacheKeyOf(value: unknown): ReferencesPlanCacheKey | null {
  if (!isRecord(value) || typeof value.planner !== 'string' || !isRecord(value.sheet)) return null;
  const settings = planSettingsOf(value.settings);
  const bounds = boundsOf(value.sheet.bounds);
  const fingerprint = value.sheet.fingerprint;
  if (!settings || !bounds || typeof fingerprint !== 'string') return null;
  return { planner: value.planner, settings, sheet: { bounds, fingerprint } };
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
  return key ? { key, ways: waysOf(value.ways), payload: value.payload } : null;
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
