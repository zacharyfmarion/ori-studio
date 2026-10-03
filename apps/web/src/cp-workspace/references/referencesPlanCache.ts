/**
 * The plan cache's record: what a saved plan is keyed on, what it holds, and
 * how it is packed into a project file.
 *
 * A plan cannot be recomputed on reopen and expected to come out the same.
 * The planner stops on wall-clock budgets, so the same sheet can plan to a
 * different order on a slower machine, or on the same one twice; and six
 * settings change it. So a plan the reader has read is kept, with the file,
 * and shown again as it was — while it is still *this* sheet's plan. The key
 * is how that is known, and any part of it disagreeing throws the plan away:
 * nothing here is ever migrated (`implementation-plans/references-persistence.md`).
 *
 * Pure, apart from loading `fflate` on demand: no React, no store.
 */
import { APP_VERSION } from '../../constants/release';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { SEG_ATTR_STRIDE } from '../../engine/oristudioCpGeometry';
import type { PrecreasePlanResult } from './precreasePlan';
import type { PrecreaseSequence, PrecreaseStep } from './precreaseSequence';
import type { ModelBounds } from './referencesStepGeometry';

/**
 * The shape of a cached plan's payload — `PrecreaseSequence` and
 * `PrecreasePlanResult` as this build reads them.
 *
 * **Bump it when either changes in a way a plan saved before cannot be read
 * as**: a field renamed, removed, or newly required. A field added as
 * optional needs no bump — an older plan simply lacks it, as every plan from
 * before it did.
 */
export const REFERENCES_PLAN_WIRE_VERSION = 1;

/**
 * Which planner made a plan: the workspace version (the crate's own
 * `version.workspace`) and the payload's wire version.
 *
 * Deliberately not the commit. The web app deploys on every merge to main, and
 * a key that moved with each deploy would replan every reopen — exactly what
 * the cache exists to stop. A planner improvement reaches a saved plan at the
 * next release instead.
 */
export const REFERENCES_PLANNER_BUILD = `oristudio-precrease@${APP_VERSION}+wire${REFERENCES_PLAN_WIRE_VERSION}`;

/** The four settings that change a plan itself, rather than how it is shown. */
export interface ReferencesPlanSettings {
  precreaseGrid: boolean;
  gridWhereNeeded: boolean;
  allowDanglingFolds: boolean;
  mergeSymmetricSteps: boolean;
}

/** The sheet a plan is for, and the creases it was made from. */
export interface ReferencesPlanSheetKey {
  /** Where the sheet is, model space (`sheetBounds`): which sheet's entry this is. */
  bounds: ModelBounds;
  /** {@link sheetFingerprint} of the creases inside it: whether it is still this plan's. */
  fingerprint: string;
}

/**
 * Everything a plan depends on, apart from the clock: the planner, the
 * settings, and the sheet's creases with their document numbering.
 *
 * Exported as a small, stable value so a step taken from a plan elsewhere (a
 * diagram) can record which plan it came from, and tell later whether the
 * plan on screen is still that one — compare with {@link referencesPlanCacheKeyId}.
 */
export interface ReferencesPlanCacheKey {
  /** {@link REFERENCES_PLANNER_BUILD} when the plan was made. */
  planner: string;
  settings: ReferencesPlanSettings;
  sheet: ReferencesPlanSheetKey;
}

/** Why a cached plan was not the one wanted — or that it was. */
export type ReferencesPlanCacheOutcome =
  | 'hit'
  | 'planner_changed'
  | 'settings_changed'
  | 'sheet_changed';

/** One planned sheet, as the cache keeps it. Its geometry in model space is not kept: it is derived. */
export interface ReferencesCachedPlan {
  /** The run, without what is re-derived on restore: the sequence (it is `plain`), the revision and the component id. */
  result: Omit<PrecreasePlanResult, 'sequence' | 'computedAtRevision' | 'component'>;
  plain: PrecreaseSequence;
  hoisted: PrecreaseSequence;
  /** How long the whole run took, both orders mapped — `ReferencesPlanRecord.durationMs`. */
  durationMs: number;
}

/** One entry of the plan cache, as a project file holds it. */
export interface ReferencesPlanCacheEntryV1 {
  key: ReferencesPlanCacheKey;
  /**
   * The reader's chosen ways (`referencesWays`), a `waySignature` by the
   * plan's own `line_id`. Kept beside the payload rather than in it, so
   * switching a way never re-encodes the plan; and kept with the plan rather
   * than with the reader's state, because both sides of it name the planner's
   * own ids, which mean something only against this plan.
   */
  ways: Record<string, string>;
  /** `base64(gzip(JSON.stringify(ReferencesCachedPlan)))`. */
  payload: string;
}

/** The plan cache, as a project file holds it (`artifacts.references`). */
export interface ReferencesPlanCacheV1 {
  v: 1;
  /** Most recently viewed first. */
  entries: ReferencesPlanCacheEntryV1[];
}

/**
 * The most payload a file carries: about a megabyte, a few of the largest
 * sheets measured (iguana_24's worst is 199 KB) and every sheet of most
 * documents (all eleven of the crane's are 91 KB).
 */
export const REFERENCES_PLAN_CACHE_MAX_CHARS = 1024 * 1024;

/**
 * How far past its box a segment may reach and still count as the sheet's:
 * a millionth of the sheet. A border crease's ends sit on the outline's
 * corners, and the slack keeps the last bit of rounding from dropping one.
 * Reaching too far only takes in a neighbour's crease, which can only throw a
 * plan away more often, never keep a wrong one.
 */
const SHEET_BOUNDS_SLACK = 1e-6;

/**
 * The creases a sheet's plan was made from, as one value: for every segment
 * inside `bounds`, its document index, the exact bits of its endpoints, and its
 * colour — exactly what `precreaseInputFromTransport` hands the planner.
 *
 * Index-sensitive on purpose. A plan names creases by document index
 * (`cp_line_ids`), so deleting one crease in *another* sheet shifts every id an
 * otherwise identical plan holds; a fingerprint blind to the numbering would
 * keep a plan that highlights the wrong creases. And it needs no frames
 * analysis — only the box — so a file being saved can drop the plans its own
 * creases can never match again.
 */
export function sheetFingerprint(geometry: CpGeometryTransport, bounds: ModelBounds): string {
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-12);
  const slack = size * SHEET_BOUNDS_SLACK;
  const minX = bounds.minX - slack;
  const minY = bounds.minY - slack;
  const maxX = bounds.maxX + slack;
  const maxY = bounds.maxY + slack;
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;

  const ends = geometry.segEndpoints;
  const attr = geometry.segAttr;
  const scratch = new DataView(new ArrayBuffer(8));
  // cyrb53: two 32-bit lanes, mixed together at the end into 53 bits.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const mix = (word: number) => {
    h1 = Math.imul(h1 ^ word, 2654435761);
    h2 = Math.imul(h2 ^ word, 1597334677);
  };
  const mixDouble = (value: number) => {
    scratch.setFloat64(0, value, true);
    mix(scratch.getUint32(0, true));
    mix(scratch.getUint32(4, true));
  };
  let count = 0;
  for (let index = 0; index * 4 + 3 < ends.length; index += 1) {
    const base = index * 4;
    const ax = ends[base];
    const ay = ends[base + 1];
    const bx = ends[base + 2];
    const by = ends[base + 3];
    if (!inside(ax, ay) || !inside(bx, by)) continue;
    count += 1;
    mix(index);
    mixDouble(ax);
    mixDouble(ay);
    mixDouble(bx);
    mixDouble(by);
    mix(attr[index * SEG_ATTR_STRIDE] ?? 0);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `${count}:${hash.toString(16)}`;
}

/** The key for a plan of the sheet at `bounds`, made now, under `settings`. */
export function referencesPlanCacheKey(
  geometry: CpGeometryTransport,
  bounds: ModelBounds,
  settings: ReferencesPlanSettings
): ReferencesPlanCacheKey {
  return {
    planner: REFERENCES_PLANNER_BUILD,
    settings: {
      precreaseGrid: settings.precreaseGrid,
      gridWhereNeeded: settings.gridWhereNeeded,
      allowDanglingFolds: settings.allowDanglingFolds,
      mergeSymmetricSteps: settings.mergeSymmetricSteps,
    },
    sheet: { bounds: { ...bounds }, fingerprint: sheetFingerprint(geometry, bounds) },
  };
}

/**
 * Whether a plan made under `made` is the plan wanted under `wanted`. "Only
 * where needed" says nothing without a grid, so with the grid off a plan made
 * under either value of it is the plan wanted.
 */
export function samePlanSettings(made: ReferencesPlanSettings, wanted: ReferencesPlanSettings): boolean {
  return (
    made.precreaseGrid === wanted.precreaseGrid &&
    (!wanted.precreaseGrid || made.gridWhereNeeded === wanted.gridWhereNeeded) &&
    made.allowDanglingFolds === wanted.allowDanglingFolds &&
    made.mergeSymmetricSteps === wanted.mergeSymmetricSteps
  );
}

/**
 * Whether a cached plan is the one wanted, and if not, which part of the key
 * said no. Both keys are for the same sheet — the caller found the entry by
 * its bounds.
 */
export function comparePlanCacheKeys(
  cached: ReferencesPlanCacheKey,
  wanted: ReferencesPlanCacheKey
): ReferencesPlanCacheOutcome {
  if (cached.planner !== wanted.planner) return 'planner_changed';
  if (!samePlanSettings(cached.settings, wanted.settings)) return 'settings_changed';
  if (cached.sheet.fingerprint !== wanted.sheet.fingerprint) return 'sheet_changed';
  return 'hit';
}

/**
 * The key as one string: equal exactly when two keys name the same plan.
 * What a step taken from a plan records, to say later whether the plan on
 * screen is still the one it came from.
 */
export function referencesPlanCacheKeyId(key: ReferencesPlanCacheKey): string {
  const s = key.settings;
  const flags = [s.precreaseGrid, s.precreaseGrid && s.gridWhereNeeded, s.allowDanglingFolds, s.mergeSymmetricSteps]
    .map((flag) => (flag ? '1' : '0'))
    .join('');
  const { minX, minY, maxX, maxY } = key.sheet.bounds;
  return `${key.planner}|${flags}|${minX},${minY},${maxX},${maxY}|${key.sheet.fingerprint}`;
}

/** A step keeping only the witness the web reads (`chosenWitness`). */
function trimStep(step: PrecreaseStep): PrecreaseStep {
  if (step.chosen === null) return step.witnesses.length === 0 ? step : { ...step, witnesses: [] };
  const chosen = step.witnesses[step.chosen];
  if (step.witnesses.length === 1 && step.chosen === 0) return step;
  return chosen ? { ...step, witnesses: [chosen], chosen: 0 } : { ...step, witnesses: [], chosen: null };
}

/**
 * A sequence as the cache keeps it.
 *
 * Every witness but the chosen one goes — they were half the bytes, and
 * nothing reads them; a step's other ways keep their own. And the run's
 * `elapsed_ms` is zeroed: it is the one field that made two identical plans
 * differ byte for byte, and nothing shows it.
 */
export function trimSequenceForCache(sequence: PrecreaseSequence): PrecreaseSequence {
  return {
    ...sequence,
    steps: sequence.steps.map(trimStep),
    diagnostics: { ...sequence.diagnostics, elapsed_ms: 0 },
  };
}

/** A planned sheet, as the cache keeps it. */
export function cachedPlanOf(
  result: PrecreasePlanResult,
  hoisted: PrecreaseSequence,
  durationMs: number
): ReferencesCachedPlan {
  const { sequence, computedAtRevision: _revision, component: _component, ...rest } = result;
  return {
    result: rest,
    plain: trimSequenceForCache(sequence),
    hoisted: trimSequenceForCache(hoisted),
    durationMs,
  };
}

type Fflate = typeof import('fflate');
let fflate: Promise<Fflate> | null = null;

/**
 * `fflate`, loaded on first use: nothing else on the way to a plan needs it.
 * A failed load is forgotten, so the next save tries again — after a deploy an
 * old tab's chunk is gone, and that is no reason to never cache again.
 */
function loadFflate(): Promise<Fflate> {
  fflate ??= import('fflate').catch((error: unknown) => {
    fflate = null;
    throw error;
  });
  return fflate;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/**
 * A plan, packed for a project file. Gzipped, because nested as pretty JSON
 * the crane's plans alone would have tripled its file; `mtime` 0, so the same
 * plan always packs to the same text and re-saving a file changes nothing.
 */
export async function encodeCachedPlan(plan: ReferencesCachedPlan): Promise<string> {
  const { gzipSync, strToU8 } = await loadFflate();
  return bytesToBase64(gzipSync(strToU8(JSON.stringify(plan)), { mtime: 0 }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSequence(value: unknown): value is PrecreaseSequence {
  return isRecord(value) && Array.isArray(value.steps) && isRecord(value.totals) && isRecord(value.diagnostics);
}

/**
 * A packed plan, or null when it is not one this build can read — damaged,
 * or written by a build whose payload this one does not know. Null is a
 * replan, never an error: the cache is disposable.
 */
export async function decodeCachedPlan(payload: string): Promise<ReferencesCachedPlan | null> {
  try {
    const { gunzipSync, strFromU8 } = await loadFflate();
    const value: unknown = JSON.parse(strFromU8(gunzipSync(base64ToBytes(payload))));
    if (!isRecord(value) || !isRecord(value.result)) return null;
    if (typeof value.result.stopReason !== 'string' || !isRecord(value.result.info)) return null;
    if (!isSequence(value.plain) || !isSequence(value.hoisted)) return null;
    if (typeof value.durationMs !== 'number') return null;
    return value as unknown as ReferencesCachedPlan;
  } catch {
    return null;
  }
}
