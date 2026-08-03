/**
 * Which CP tool settings survive a reload, and what a valid stored value is.
 *
 * Tool options are per-session by default. A designer who works in 22.5 degrees
 * should not re-pick it every time they open the app, but most of the struct is
 * genuinely per-use, so persistence is **opt-in**: only the keys named in
 * {@link PERSISTED_CP_TOOL_OPTIONS} are written or read back.
 *
 * # Opting in and validating are the same act
 *
 * A registry entry *is* the key's validator, so a param cannot be persisted
 * without stating what a valid value looks like. That matters because the value
 * comes back from `localStorage`: user-editable, and stale across any release
 * that changes a range. A `readJson` cast alone would put an arbitrary number
 * where the tool expects `1..=64`.
 *
 * # The exclusions are the point
 *
 * Two options are per-invocation, and persisting them would be actively wrong:
 *
 * - `candidateIndex` — which candidate was picked last time is meaningless
 *   against a different vertex's candidates, and would silently pre-select the
 *   wrong one.
 * - `textContent` — the text typed for one annotation would pre-fill the next.
 *
 * A blanket "serialise the options struct" ships both bugs, which is why the
 * default here is *not persisted* and the list grows one line at a time.
 *
 * # No version field
 *
 * Deliberate, and the same choice `measurePreferences` made. Per-key validation
 * beats versioning for a bag of independent scalars: an unknown key is ignored, a
 * missing key falls back to its default, and a key whose valid range changed
 * falls back **alone**. A version bump is all-or-nothing and would discard every
 * good value to fix one bad one.
 */
import { STORAGE_KEYS, readJson, storageKey, writeJson } from './storage';
import {
  DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
  type OristudioCpToolOptions,
} from './oristudioCpToolSettings';

const KEY = storageKey(STORAGE_KEYS.cpToolOptions);

/**
 * A validator: the stored value when it is usable, `null` to fall back to the
 * default for that key alone.
 */
type Validator<K extends keyof OristudioCpToolOptions> = (
  value: unknown
) => OristudioCpToolOptions[K] | null;

type Registry = {
  [K in keyof OristudioCpToolOptions]?: Validator<K>;
};

function integerIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function finiteIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * The opted-in set, deliberately small. Each later addition is one line, added
 * when someone asks for it.
 *
 * Reasonable candidates left ephemeral for now: `divisionCount`,
 * `divisionRatio`, `polygonCorners`, `parallelWidth`, the custom line types, and
 * `customCircleColor`.
 */
export const PERSISTED_CP_TOOL_OPTIONS: Registry = {
  // The most "how I work" setting in the editor, and the complaint that
  // motivated persistence at all.
  angleSystemDivider: (value) => integerIn(value, 0, 64),
  // Pairs with the divider — restoring one without the other is a half-restored
  // state, where the tool claims a custom system whose angles reverted.
  angleSystemAngles: (value) => {
    if (!Array.isArray(value) || value.length !== 6) return null;
    const angles = value.map((entry) => finiteIn(entry, -360, 360));
    return angles.every((angle): angle is number => angle !== null)
      ? (angles as OristudioCpToolOptions['angleSystemAngles'])
      : null;
  },
  // Fix Inaccurate's tolerance, and the two flags that are meaningless apart
  // from it.
  fixPrecision: (value) => finiteIn(value, Number.MIN_VALUE, 1000),
  fixPrecisionUseBp: boolean,
  fixPrecisionUse22_5: boolean,
};

/** The opted-in keys, for callers that need to reason about the set. */
export function persistedCpToolOptionKeys(): (keyof OristudioCpToolOptions)[] {
  return Object.keys(PERSISTED_CP_TOOL_OPTIONS) as (keyof OristudioCpToolOptions)[];
}

/** Whether a tool option is one that survives a reload. */
export function isPersistedCpToolOption(key: keyof OristudioCpToolOptions): boolean {
  return key in PERSISTED_CP_TOOL_OPTIONS;
}

/**
 * The stored options merged over the defaults.
 *
 * Every key is validated independently, so one unusable value costs only itself.
 */
export function readCpToolOptions(): OristudioCpToolOptions {
  const stored = readJson<unknown>(KEY, null);
  const options = { ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS };
  if (typeof stored !== 'object' || stored === null) return options;

  const record = stored as Record<string, unknown>;
  for (const key of persistedCpToolOptionKeys()) {
    if (!(key in record)) continue;
    // The registry is keyed by the same union, so the validator and the slot
    // agree by construction; TypeScript cannot see that through the index.
    const validate = PERSISTED_CP_TOOL_OPTIONS[key] as Validator<typeof key> | undefined;
    const value = validate?.(record[key]);
    if (value === null || value === undefined) continue;
    (options[key] as unknown) = value;
  }
  return options;
}

/**
 * Write the opted-in keys, and only those.
 *
 * Values are validated on the way out as well as in. A control with a bad clamp
 * would otherwise write a value this module then refuses to read back, which
 * presents as a setting that silently forgets itself.
 */
export function writeCpToolOptions(options: OristudioCpToolOptions): void {
  const stored: Record<string, unknown> = {};
  for (const key of persistedCpToolOptionKeys()) {
    const validate = PERSISTED_CP_TOOL_OPTIONS[key] as Validator<typeof key> | undefined;
    const value = validate?.(options[key]);
    if (value === null || value === undefined) continue;
    stored[key] = value;
  }
  writeJson(KEY, stored);
}

/**
 * `options` with the given keys back at their defaults — what the panel's reset
 * commits.
 */
export function resetCpToolOptions(
  options: OristudioCpToolOptions,
  keys: readonly (keyof OristudioCpToolOptions)[]
): OristudioCpToolOptions {
  const next = { ...options };
  for (const key of keys) {
    (next[key] as unknown) = DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS[key];
  }
  return next;
}

/** Whether any of `keys` differs from its default. */
export function hasNonDefaultCpToolOptions(
  options: OristudioCpToolOptions,
  keys: readonly (keyof OristudioCpToolOptions)[]
): boolean {
  return keys.some(
    (key) =>
      JSON.stringify(options[key]) !== JSON.stringify(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS[key])
  );
}
