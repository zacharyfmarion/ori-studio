/**
 * The plan cache's record: what a saved plan is keyed on, what it holds, and
 * how it is packed into a project file.
 *
 * A plan cannot be recomputed on reopen and expected to come out the same.
 * The planner stops on wall-clock budgets, so the same sheet can plan to a
 * different order on a slower machine, or on the same one twice; and four
 * settings change it. So a plan the reader has read is kept, with the file,
 * and shown again as it was — while it is still *this* sheet's plan, made by
 * *this* planner. The key is how that is known, and any part of it
 * disagreeing means a replan: nothing here is ever migrated
 * (`implementation-plans/references-persistence.md`).
 *
 * Pure, apart from loading `fflate` on demand: no React, no store.
 */
import { APP_VERSION } from '../../constants/release';
import { plannerSourceDigest } from '../../lib/appBuildInfo';
import { keyDigest } from '../../lib/keyDigest';
import { segmentOverlapsBounds } from '../folded/foldedFigureStaleness';
import type { PrecreasePlanResult } from './precreasePlan';
import type { PrecreaseSequence, PrecreaseStep } from './precreaseSequence';
import {
  REFERENCES_PLAN_SETTING_KEYS,
  planSettingsOf,
  type ReferencesPlanSettings,
} from './referencesSettingsFields';
import { sameSheetBounds, sameSheetFrame } from './referencesSheets';
import type { ModelBounds } from './referencesStepGeometry';
import type { PrecreaseFrame, PrecreaseInput } from './sheetFrames';

export type { ReferencesPlanSettings } from './referencesSettingsFields';

/**
 * A version for the cache's whole contents, bumped by hand: to throw away
 * every plan saved so far for a reason the planner digest cannot see.
 * Ordinarily it never moves — a change to the planner, to the loop that drives
 * it, to ReferenceFinder or to this file's envelope already changes
 * {@link REFERENCES_PLANNER_BUILD} through the digest.
 */
export const REFERENCES_PLAN_WIRE_VERSION = 1;

/**
 * Which planner made a plan: the version, a digest of every source that
 * decides a plan (`plannerSourceDigest`: the precrease crate and bridge, the
 * loop and its ReferenceFinder queries, ReferenceFinder, the wire types and
 * this file — `PLANNER_SOURCES` in vite.config.ts), and the hand-bumped
 * version above.
 *
 * The digest is what does the work. The web app deploys on every merge to
 * main, the version moves only at release, and changes that alter what a plan
 * *means* have landed between releases — which creases a plan folds, how a
 * rotated sheet is framed, when a run stops — so a key on the version alone
 * would have shown plans those changes made wrong, or fed a renderer a shape
 * it no longer reads. Keyed on the sources, a saved plan is shown only by a
 * build that would have made it; any other build replans, and the reader's
 * own state (`referencesReaderState`) still comes back.
 */
export const REFERENCES_PLANNER_BUILD = `oristudio-precrease@${APP_VERSION}+src.${plannerSourceDigest()}+wire${REFERENCES_PLAN_WIRE_VERSION}`;

/** The sheet a plan is for, and the creases it was made from. */
export interface ReferencesPlanSheetKey {
  /** Where the sheet is, model space (`sheetBounds`). */
  bounds: ModelBounds;
  /**
   * How the sheet is framed: the frame the plan's coordinates are mapped
   * through when it is shown. With the bounds, which sheet's entry this is —
   * two sheets can share a box (a square and the diamond on its midpoints) and
   * never a frame.
   */
  frame: PrecreaseFrame;
  /** {@link sheetFingerprint} of the creases on it: whether it is still this plan's. */
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
 * How far past its box a crease may reach and still be fingerprinted as the
 * sheet's, as a share of the sheet's longer side: twice the planner's own
 * `SNAP_RADIUS` (2e-3, `crates/oristudio-precrease/src/tol.rs`).
 *
 * The planner assigns a crease to a sheet with that much slack when the
 * border is only nearly rectangular (`components.rs`), and names it in the
 * plan, so the fingerprint has to see at least that far — at 1e-6 a recoloured
 * crease overshooting the border by a fifth of a percent left the fingerprint
 * as it was, and the cached plan drew it the old way. Reaching further only
 * takes in a neighbour's crease, which can only cost a replan, never keep a
 * wrong plan.
 */
const SHEET_FINGERPRINT_PAD = 4e-3;

/** The algorithm, named in every value (`keyDigest`). */
const SHEET_FINGERPRINT_PREFIX = 'ps1:';

/**
 * Every field of the planner's input, which the fingerprint covers. A field
 * added to `PrecreaseInput` does not compile here until the fingerprint covers
 * it too — a plan depends on everything the planner is handed.
 */
const _FINGERPRINTED = { segments: true, colors: true } as const satisfies Record<
  keyof PrecreaseInput,
  true
>;

/**
 * The creases a sheet's plan was made from, as one value: for every crease of
 * the planner's input (`precreaseInputFromTransport`) that reaches into the
 * sheet's box, its document index, its endpoints and its colour, through the
 * digest the folded-figure fingerprint uses.
 *
 * Index-sensitive, unlike `foldedSourceFingerprint`, on purpose. A plan names
 * creases by document index (`cp_line_ids`), so deleting one crease in
 * *another* sheet shifts every id an otherwise identical plan holds; an
 * order-independent fingerprint would keep a plan that highlights the wrong
 * creases. And it needs no frames analysis — only the box — so a file being
 * saved can drop the plans its own creases can never match again.
 */
export function sheetFingerprint(input: PrecreaseInput, bounds: ModelBounds): string {
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-12);
  const pad = size * SHEET_FINGERPRINT_PAD;
  const box = {
    minX: bounds.minX - pad,
    minY: bounds.minY - pad,
    maxX: bounds.maxX + pad,
    maxY: bounds.maxY + pad,
  };
  const { segments, colors } = input;
  const keys: string[] = [];
  for (let index = 0; index * 4 + 3 < segments.length; index += 1) {
    const at = index * 4;
    const a = { x: segments[at], y: segments[at + 1] };
    const b = { x: segments[at + 2], y: segments[at + 3] };
    if (!segmentOverlapsBounds({ a, b }, box)) continue;
    keys.push(`${index}:${a.x},${a.y},${b.x},${b.y}:${colors[index] ?? ''}`);
  }
  return keyDigest(keys, SHEET_FINGERPRINT_PREFIX);
}

/** The sheet a key names: the same box and the same frame. */
export function samePlanSheet(a: ReferencesPlanSheetKey, b: ReferencesPlanSheetKey): boolean {
  return sameSheetBounds(a.bounds, b.bounds) && sameSheetFrame(a.frame, b.frame);
}

/** The key for a plan of the sheet at `bounds`, framed by `frame`, made now, under `settings`. */
export function referencesPlanCacheKey(
  input: PrecreaseInput,
  sheet: { bounds: ModelBounds; frame: PrecreaseFrame },
  settings: ReferencesPlanSettings
): ReferencesPlanCacheKey {
  return {
    planner: REFERENCES_PLANNER_BUILD,
    settings: planSettingsOf(settings),
    sheet: {
      bounds: { ...sheet.bounds },
      frame: {
        origin: [sheet.frame.origin[0], sheet.frame.origin[1]],
        x_axis: [sheet.frame.x_axis[0], sheet.frame.x_axis[1]],
        y_axis: [sheet.frame.y_axis[0], sheet.frame.y_axis[1]],
        width: sheet.frame.width,
        height: sheet.frame.height,
      },
      fingerprint: sheetFingerprint(input, sheet.bounds),
    },
  };
}

/**
 * Whether a plan made under `made` is the plan wanted under `wanted`. "Only
 * where needed" says nothing without a grid, so with the grid off a plan made
 * under either value of it is the plan wanted.
 */
export function samePlanSettings(made: ReferencesPlanSettings, wanted: ReferencesPlanSettings): boolean {
  return REFERENCES_PLAN_SETTING_KEYS.every(
    (key) =>
      made[key] === wanted[key] || (key === 'gridWhereNeeded' && !wanted.precreaseGrid)
  );
}

/**
 * Whether a cached plan is the one wanted, and if not, which part of the key
 * said no. Both keys are for the same box — the caller found the entry by it.
 */
export function comparePlanCacheKeys(
  cached: ReferencesPlanCacheKey,
  wanted: ReferencesPlanCacheKey
): ReferencesPlanCacheOutcome {
  if (cached.planner !== wanted.planner) return 'planner_changed';
  if (!samePlanSettings(cached.settings, wanted.settings)) return 'settings_changed';
  if (!samePlanSheet(cached.sheet, wanted.sheet)) return 'sheet_changed';
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
  const flags = REFERENCES_PLAN_SETTING_KEYS.map((name) =>
    name === 'gridWhereNeeded' && !s.precreaseGrid ? '-' : s[name] ? '1' : '0'
  ).join('');
  const { minX, minY, maxX, maxY } = key.sheet.bounds;
  const { origin, x_axis } = key.sheet.frame;
  return `${key.planner}|${flags}|${minX},${minY},${maxX},${maxY}|${origin.join(',')},${x_axis.join(',')}|${key.sheet.fingerprint}`;
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

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isArray = Array.isArray;

function isPair(value: unknown): boolean {
  return isArray(value) && value.length === 2 && isNumber(value[0]) && isNumber(value[1]);
}

function isLine(value: unknown): boolean {
  return isRecord(value) && isPair(value.n) && isNumber(value.d);
}

function isWitness(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNumber(value.axiom) &&
    isArray(value.inputs) &&
    value.inputs.every((input) => isRecord(input) && typeof input.kind === 'string') &&
    isNumber(value.root)
  );
}

/**
 * The fields of a step that something reads with no fallback: where a stale
 * shape would throw while the panel draws, or say the wrong thing about the
 * fold. A `true` from here is not a proof the plan is this build's — the key's
 * planner digest is that — but a damaged or hand-edited payload stops here
 * rather than in a render.
 */
function isStep(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isNumber(value.id) &&
    isNumber(value.card) &&
    isNumber(value.line_id) &&
    typeof value.kind === 'string' &&
    typeof value.tag === 'string' &&
    isLine(value.line) &&
    isArray(value.segment) &&
    isRecord(value.extent) &&
    typeof value.extent.kind === 'string' &&
    isArray(value.witnesses) &&
    value.witnesses.every(isWitness) &&
    (value.chosen === null || isNumber(value.chosen)) &&
    (value.side === 'front' || value.side === 'back') &&
    typeof value.direction === 'string' &&
    typeof value.exact === 'boolean' &&
    typeof value.marks_exist === 'boolean' &&
    isArray(value.cp_line_ids) &&
    isArray(value.cp_spans) &&
    isArray(value.pressed_on) &&
    isArray(value.made) &&
    isArray(value.unlocks) &&
    isArray(value.missing_marks) &&
    (value.ways === undefined ||
      (isArray(value.ways) &&
        value.ways.every((way) => isRecord(way) && isWitness(way.witness) && typeof way.kind === 'string')))
  );
}

function isSequence(value: unknown): value is PrecreaseSequence {
  return (
    isRecord(value) &&
    typeof value.status === 'string' &&
    isRecord(value.sheet) &&
    isArray(value.steps) &&
    value.steps.every(isStep) &&
    isArray(value.groups) &&
    isRecord(value.totals) &&
    isArray(value.findings) &&
    isArray(value.points) &&
    isArray(value.lines) &&
    isRecord(value.diagnostics)
  );
}

/** `PrecreaseApproximateFinding`: the findings list reads `err` and the rest with no fallback. */
function isApproximateFinding(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNumber(value.finding) &&
    isArray(value.cpLineIds) &&
    isNumber(value.foldCount) &&
    isNumber(value.err) &&
    isNumber(value.rank)
  );
}

function isResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.stopReason === 'string' &&
    isRecord(value.info) &&
    typeof value.partial === 'boolean' &&
    isArray(value.approximate) &&
    value.approximate.every(isApproximateFinding)
  );
}

/**
 * A packed plan, or null when it is not one this build can read — damaged,
 * or not the shape this build reads. Null is a replan, never an error: the
 * cache is disposable.
 */
export async function decodeCachedPlan(payload: string): Promise<ReferencesCachedPlan | null> {
  try {
    const { gunzipSync, strFromU8 } = await loadFflate();
    const value: unknown = JSON.parse(strFromU8(gunzipSync(base64ToBytes(payload))));
    if (!isRecord(value) || !isResult(value.result) || !isNumber(value.durationMs)) return null;
    if (!isSequence(value.plain) || !isSequence(value.hoisted)) return null;
    return value as unknown as ReferencesCachedPlan;
  } catch {
    return null;
  }
}
