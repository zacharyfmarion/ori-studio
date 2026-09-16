/**
 * The numeric stdin protocol of the ReferenceFinder core.
 *
 * `main.cpp` is a REPL over numbers: it pulls every input with `Module.get()`,
 * prints lines through `Module.print`, and delimits commands with a bare
 * `Ready`. The startup command is the 24-number database configuration read by
 * `readDbSettings()`; after `Ready` each query is one vector read by
 * `readSearchSettings()` plus the target coordinates. Just before every `Ready`
 * the core calls `Module.clear()`, dropping anything still queued — so exactly
 * one command may be in flight at a time (the worker enforces this).
 *
 * This module is pure: encoders, line classifiers, and the database key. It
 * never touches the module.
 */
import type { RawSolution } from './solution';

/**
 * Everything the core reads at startup that shapes the database. The whole
 * object is the cache-key material (see {@link databaseKey}); two workers with
 * different settings hold different databases and give different answers.
 *
 * Coordinates are ReferenceFinder's: bottom-left origin, y up, `width × height`.
 */
export interface ReferenceFinderDatabaseSettings {
  width: number;
  height: number;
  /** Highest rank built. 6 is upstream's shipped default (~2 s, ~200 MB). */
  maxRank: number;
  maxLines: number;
  maxMarks: number;
  /**
   * Seven slots in priority order; each is an axiom number 1–7, or 0 to
   * disable the slot. Upstream's default `[2, 3, 7, 6, 5, 4, 1]`.
   */
  axiomPriority: readonly number[];
  /** Quantise references onto the division grid below (forced on above rank 5). */
  useDivision: boolean;
  numX: number;
  numY: number;
  numA: number;
  numD: number;
  /** Lines that would make a flap thinner than this aspect ratio are skipped. */
  minAspectRatio: number;
  /** Fold lines meeting a reference at `|sin θ|` below this are skipped. */
  minAngleSine: number;
  /** Prefer references a folder can see (an edge mark or edge line among the inputs). */
  visibility: boolean;
}

/** Upstream's shipped defaults on a unit square. */
export const DEFAULT_DATABASE_SETTINGS: ReferenceFinderDatabaseSettings = {
  width: 1,
  height: 1,
  maxRank: 6,
  maxLines: 600000,
  maxMarks: 600000,
  axiomPriority: [2, 3, 7, 6, 5, 4, 1],
  useDivision: true,
  numX: 5000,
  numY: 5000,
  numA: 5000,
  numD: 5000,
  minAspectRatio: 0.1,
  minAngleSine: 0.342,
  visibility: true,
};

/** Number of values `readDbSettings()` consumes with no seed marks or lines. */
export const DATABASE_SETTINGS_LENGTH = 24;

/**
 * Per-query settings, read by `readSearchSettings()`.
 *
 * The planner-grade defaults differ from upstream's UI: a `goodEnoughError` of
 * `0.005` sorts a rank-3 approximation above an exact rank-4 solution, and
 * `count` 1 then loses the exact one entirely. At `1e-9` exact hits rank first.
 */
export interface ReferenceFinderQuerySettings {
  goodEnoughError: number;
  count: number;
  /** `sLineWorstCaseError`: 1 scores a line by its worst-case endpoint error, 0 by the average. */
  worstCase: number;
}

export const DEFAULT_QUERY_SETTINGS: ReferenceFinderQuerySettings = {
  goodEnoughError: 1e-9,
  count: 5,
  worstCase: 1,
};

/** A solution is exact when its error is at or below this (measured exact hits carry 1e-8..1e-17). */
export const EXACT_ERROR = 1e-9;

export type ReferenceFinderProtocolErrorReason =
  | 'invalid_settings'
  | 'invalid_query'
  | 'malformed_line';

/** A settings object or a module line that cannot be encoded or read. */
export class ReferenceFinderProtocolError extends Error {
  readonly code = 'reference_finder_protocol';

  constructor(
    readonly reason: ReferenceFinderProtocolErrorReason,
    message: string
  ) {
    super(message);
    this.name = 'ReferenceFinderProtocolError';
  }
}

function requireFinite(name: string, value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ReferenceFinderProtocolError('invalid_settings', `${name} must be a finite number`);
  }
  return value;
}

function requirePositive(name: string, value: number): number {
  if (requireFinite(name, value) <= 0) {
    throw new ReferenceFinderProtocolError('invalid_settings', `${name} must be positive`);
  }
  return value;
}

function requireCount(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ReferenceFinderProtocolError(
      'invalid_settings',
      `${name} must be a non-negative integer`
    );
  }
  return value;
}

/**
 * The 24 numbers `readDbSettings()` reads, in its order: useDatabase (0 — we
 * never use the IndexedDB cache; a fresh worker is a fresh build), forceRebuild
 * (0), width, height, maxRank, maxLines, maxMarks, seven axiom slots,
 * useDivision, numX, numY, numA, numD, minAspectRatio, minAngleSine,
 * visibility, then the seed counts (0 marks, 0 lines — seeding changes answers
 * and disables the database cache, and is out of V1).
 */
export function encodeDatabaseSettings(settings: ReferenceFinderDatabaseSettings): number[] {
  if (settings.axiomPriority.length !== 7) {
    throw new ReferenceFinderProtocolError(
      'invalid_settings',
      `axiomPriority must have 7 slots, got ${settings.axiomPriority.length}`
    );
  }
  for (const axiom of settings.axiomPriority) {
    if (!Number.isInteger(axiom) || axiom < 0 || axiom > 7) {
      throw new ReferenceFinderProtocolError(
        'invalid_settings',
        `axiomPriority slots must be 0 (disabled) or an axiom 1-7, got ${axiom}`
      );
    }
  }
  const encoded = [
    0,
    0,
    requirePositive('width', settings.width),
    requirePositive('height', settings.height),
    requireCount('maxRank', settings.maxRank),
    requireCount('maxLines', settings.maxLines),
    requireCount('maxMarks', settings.maxMarks),
    ...settings.axiomPriority,
    settings.useDivision ? 1 : 0,
    requireCount('numX', settings.numX),
    requireCount('numY', settings.numY),
    requireCount('numA', settings.numA),
    requireCount('numD', settings.numD),
    requireFinite('minAspectRatio', settings.minAspectRatio),
    requireFinite('minAngleSine', settings.minAngleSine),
    settings.visibility ? 1 : 0,
    0,
    0,
  ];
  if (encoded.length !== DATABASE_SETTINGS_LENGTH) {
    throw new ReferenceFinderProtocolError(
      'invalid_settings',
      `encoded ${encoded.length} values, expected ${DATABASE_SETTINGS_LENGTH}`
    );
  }
  return encoded;
}

function encodeQuerySettings(settings: ReferenceFinderQuerySettings): number[] {
  if (!Number.isFinite(settings.goodEnoughError) || settings.goodEnoughError < 0) {
    throw new ReferenceFinderProtocolError(
      'invalid_query',
      'goodEnoughError must be a non-negative number'
    );
  }
  if (!Number.isInteger(settings.count) || settings.count < 1) {
    throw new ReferenceFinderProtocolError('invalid_query', 'count must be a positive integer');
  }
  if (settings.worstCase !== 0 && settings.worstCase !== 1) {
    throw new ReferenceFinderProtocolError('invalid_query', 'worstCase must be 0 or 1');
  }
  return [settings.goodEnoughError, settings.count, settings.worstCase];
}

function requireCoordinate(name: string, value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ReferenceFinderProtocolError('invalid_query', `${name} must be a finite number`);
  }
  return value;
}

/**
 * How far outside the paper a mark may land and still be taken as on it.
 *
 * Comfortably above the round-off a model → sheet → unit projection accumulates
 * (a few ULP of 1, so ~1e-16) and far below the planner's own `TOL`, so nothing
 * a user could see moves.
 */
export const PAPER_SNAP_TOLERANCE = 1e-9;

/**
 * A mark coordinate snapped onto `[0, extent]`.
 *
 * `ReferenceFinder::ValidateMark` bounds the paper with `ap.y < 0 || ap.y >
 * sPaper.mHeight` and **no epsilon** (`ReferenceFinder.cpp:358`), and only the
 * point command is validated — `ValidateLine` checks distinctness alone. So a
 * mark one ULP outside is a hard refusal ("y coordinate should lie between 0 and
 * 1") while the same overshoot on a line query passes unnoticed. A vertex reaches
 * us through a chain of projections and a division, so landing a few ULP outside
 * a sheet it is genuinely on the edge of is ordinary arithmetic, not bad input.
 *
 * Beyond {@link PAPER_SNAP_TOLERANCE} the value is passed through untouched: a
 * mark that really is off the paper should get the core's own error rather than
 * a silently relocated answer.
 *
 * The mirror of `extendToSheet`'s clamp, which has done this on the way *out*
 * since the bridge landed; this is the missing counterpart on the way in.
 */
export function snapMarkToPaper(value: number, extent: number): number {
  if (value < 0) return value >= -PAPER_SNAP_TOLERANCE ? 0 : value;
  if (value > extent) return value <= extent + PAPER_SNAP_TOLERANCE ? extent : value;
  return value;
}

/** Command 1: `[1, goodEnoughError, count, worstCase, x, y]`. */
export function encodePointQuery(
  x: number,
  y: number,
  settings: ReferenceFinderQuerySettings = DEFAULT_QUERY_SETTINGS
): number[] {
  return [1, ...encodeQuerySettings(settings), requireCoordinate('x', x), requireCoordinate('y', y)];
}

/** Command 2: `[2, goodEnoughError, count, worstCase, x1, y1, x2, y2]`. */
export function encodeLineQuery(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  settings: ReferenceFinderQuerySettings = DEFAULT_QUERY_SETTINGS
): number[] {
  return [
    2,
    ...encodeQuerySettings(settings),
    requireCoordinate('x1', x1),
    requireCoordinate('y1', y1),
    requireCoordinate('x2', x2),
    requireCoordinate('y2', y2),
  ];
}

/** What the database build prints as it goes, and once more when it is done. */
export interface ReferenceFinderProgress {
  rank: number;
  lines: number;
  marks: number;
}

/** Progress line `{"rank": n, "lines": n, "marks": n}` (from `ConsoleDatabaseProgress`), or null. */
export function parseProgressLine(line: string): ReferenceFinderProgress | null {
  if (!line.startsWith('{"rank"')) return null;
  const parsed = parseJsonObject(line);
  if (
    !parsed ||
    typeof parsed.rank !== 'number' ||
    typeof parsed.lines !== 'number' ||
    typeof parsed.marks !== 'number'
  ) {
    throw new ReferenceFinderProtocolError('malformed_line', `unreadable progress line: ${line}`);
  }
  return { rank: parsed.rank, lines: parsed.lines, marks: parsed.marks };
}

/** The command delimiter. Exactly `Ready`; the banner and progress lines never match. */
export function isReadyLine(line: string): boolean {
  return line === 'Ready';
}

/**
 * A solution line — an object with `solution`, `err`, `rank`, `steps` and
 * `diagrams` — or null for anything else the core prints (the version banner,
 * `Initializing using …`, progress). Only lines starting with `{` are
 * considered; a `{` line that is not a solution or progress object is an error,
 * because it means the wire shape changed under us.
 */
export function parseSolutionLine(line: string): RawSolution | null {
  if (!line.startsWith('{')) return null;
  if (line.startsWith('{"rank"')) return null;
  const parsed = parseJsonObject(line);
  if (
    !parsed ||
    !Array.isArray(parsed.solution) ||
    typeof parsed.err !== 'number' ||
    typeof parsed.rank !== 'number' ||
    !Array.isArray(parsed.steps) ||
    !Array.isArray(parsed.diagrams)
  ) {
    throw new ReferenceFinderProtocolError('malformed_line', `unreadable solution line: ${line}`);
  }
  return parsed as unknown as RawSolution;
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    throw new ReferenceFinderProtocolError('malformed_line', `not JSON: ${line}`);
  }
}

/**
 * A stable string of every build-time setting, sheet size at 1e-6 precision.
 *
 * Two settings objects with the same key would build byte-identical databases,
 * so the key names a worker in the runtime's registry and prefixes every entry
 * in the solution cache. The constant zeros (useDatabase, forceRebuild, seeds)
 * are not part of it; the version tag is, so a change to this encoding
 * invalidates old keys rather than colliding with them.
 */
export function databaseKey(settings: ReferenceFinderDatabaseSettings): string {
  const size = (value: number) => String(Math.round(value * 1e6) / 1e6);
  return [
    'rf1',
    `w=${size(settings.width)}`,
    `h=${size(settings.height)}`,
    `rank=${settings.maxRank}`,
    `lines=${settings.maxLines}`,
    `marks=${settings.maxMarks}`,
    `ax=${settings.axiomPriority.join(',')}`,
    `div=${settings.useDivision ? 1 : 0}`,
    `nx=${settings.numX}`,
    `ny=${settings.numY}`,
    `na=${settings.numA}`,
    `nd=${settings.numD}`,
    `ar=${settings.minAspectRatio}`,
    `sin=${settings.minAngleSine}`,
    `vis=${settings.visibility ? 1 : 0}`,
  ].join('|');
}

/** A stable string of the per-query settings, for cache keys. */
export function querySettingsKey(settings: ReferenceFinderQuerySettings): string {
  return `e=${settings.goodEnoughError}|n=${settings.count}|wc=${settings.worstCase}`;
}
