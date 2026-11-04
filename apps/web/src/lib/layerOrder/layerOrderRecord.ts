/**
 * A chosen layer order as a host saves it: the constraints the user built and
 * the order shown at Apply, never a case number
 * (`implementation-plans/layer-order-dialog.md`, approach 6). One record, the
 * same for an Edit figure and a Diagram step, each of which keeps it as one
 * compact JSON string beside its own data.
 *
 * Faces are named by a point inside them on the paper and their area, so a
 * record outlives the face numbering of the fold it was made on: after an
 * edit each face is found again by its point, and a changed area says it was
 * split or merged. Points are in the host's paper frame (`paperFrame.ts`).
 *
 * Read by the rules every document in the project file keeps
 * (`lib/documentFile`): a record of a later version, or with a field or a
 * value this build has no name for, is a newer build's ({@link NEWER}),
 * carried and written back as it came; damage is dropped. A later version
 * that changes what a field means raises `v`.
 *
 * React-free, store-free and engine-free.
 */
import { NEWER, hasNewerKey, isRecord } from '../documentFile';

/** The version this build reads and writes. */
export const LAYER_ORDER_RECORD_VERSION = 1;

/**
 * The most a record may be, as its JSON: approach 6's budget. Apply refuses
 * past it, with the reason; one past it in a file is a newer build's, which
 * may keep more.
 */
export const LAYER_ORDER_RECORD_MAX_BYTES = 1024 * 1024;

/** A point on the paper, in the host's paper frame. */
export type LayerOrderPoint = readonly [x: number, y: number];

/** A face, as a record names it. */
export interface LayerOrderFace {
  /** A point inside the face, on the paper. */
  readonly at: LayerOrderPoint;
  /** The face's area on the paper, above 0: what says it was split or merged after an edit. */
  readonly area: number;
}

/**
 * FOLD's `faceOrders` sign: 1 when the first face lies on the second's front
 * side, -1 when on its back. Relative to the paper, so turning the view over
 * never changes it.
 */
export type LayerOrderSign = 1 | -1;

/** Two of a record's faces, by index into its `faces`, and how the first lies against the second. */
export type LayerOrderPair = readonly [f: number, g: number, sign: LayerOrderSign];

/** Why a record needs looking at, as its host shows it without the engine. */
export type LayerOrderAttentionReason = 'conflict' | 'unresolved' | 'timeout' | 'route-3d' | 'detached';

export const LAYER_ORDER_ATTENTION_REASONS: readonly LayerOrderAttentionReason[] = [
  'conflict',
  'unresolved',
  'timeout',
  'route-3d',
  'detached',
];

export interface LayerOrderAttention {
  readonly reason: LayerOrderAttentionReason;
  /** How many constraints it concerns. */
  readonly count: number;
}

export interface LayerOrderRecord {
  /** The faces the constraints and the order name. */
  readonly faces: readonly LayerOrderFace[];
  /** The constraints, as built, in the order made: `[subject, object, sign]`. */
  readonly constraints: readonly LayerOrderPair[];
  /**
   * The order shown at Apply: only its pairs the creases leave free. The host
   * engine rebuilds the full order from them and the creases.
   */
  readonly order: readonly LayerOrderPair[];
  /** Set after an edit left the record needing a look; absent otherwise. */
  readonly attention?: LayerOrderAttention;
}

/** The part of a record that does not read. */
export type LayerOrderRecordPart = 'record' | 'faces' | 'constraints' | 'order' | 'attention';

/** Why a stored record does not read: not a string, not JSON, no version this build knows, or a part. */
export type LayerOrderRecordDamage = 'not-text' | 'not-json' | 'version' | LayerOrderRecordPart;

/** A stored record read: as this build holds it, with its compact JSON; or damage, which is dropped. */
export type LayerOrderRecordRead =
  | { readonly ok: true; readonly record: LayerOrderRecord; readonly json: string }
  | { readonly ok: false; readonly damage: LayerOrderRecordDamage };

/** A record encoded, or why it cannot be: a part that does not read, or more than the budget. */
export type LayerOrderRecordEncoding =
  | { readonly ok: true; readonly json: string }
  | { readonly ok: false; readonly reason: 'invalid'; readonly part: LayerOrderRecordPart }
  | { readonly ok: false; readonly reason: 'over-budget'; readonly bytes: number; readonly budget: number };

const RECORD_KEYS: ReadonlySet<string> = new Set(['v', 'faces', 'constraints', 'order', 'attention']);
const FACE_KEYS: ReadonlySet<string> = new Set(['at', 'area']);
const ATTENTION_KEYS: ReadonlySet<string> = new Set(['reason', 'count']);

/** A part that does not read, beside a reading and {@link NEWER}. */
interface Damaged {
  readonly damaged: LayerOrderRecordPart;
}

type Reading<T> = T | Damaged | typeof NEWER;

function isDamaged(value: unknown): value is Damaged {
  return isRecord(value) && typeof value.damaged === 'string';
}

/**
 * A stored record: the string a host keeps. A newer build's is {@link NEWER}:
 * a version above this build's, a field or an attention reason it has no name
 * for, or more than {@link LAYER_ORDER_RECORD_MAX_BYTES}. Its JSON comes back
 * as this build writes it, so a record read and written again keeps its bytes.
 */
export function readLayerOrderRecord(value: unknown): LayerOrderRecordRead | typeof NEWER {
  if (typeof value !== 'string') return { ok: false, damage: 'not-text' };
  if (value.length > LAYER_ORDER_RECORD_MAX_BYTES) return NEWER;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, damage: 'not-json' };
  }
  if (!isRecord(parsed)) return { ok: false, damage: 'record' };
  const version = parsed.v;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, damage: 'version' };
  }
  if (version > LAYER_ORDER_RECORD_VERSION) return NEWER;
  const record = recordOf(parsed);
  if (record === NEWER) return NEWER;
  if (isDamaged(record)) return { ok: false, damage: record.damaged };
  return { ok: true, record, json: JSON.stringify(written(record)) };
}

/**
 * A record as one compact string, its fields in a fixed order, or why it
 * cannot be written: a part that does not read as {@link readLayerOrderRecord}
 * reads it, or JSON past {@link LAYER_ORDER_RECORD_MAX_BYTES}. The JSON is
 * numbers and this module's own words, so its length is its size in bytes.
 */
export function encodeLayerOrderRecord(record: LayerOrderRecord): LayerOrderRecordEncoding {
  const checked = recordOf({ v: LAYER_ORDER_RECORD_VERSION, ...record });
  // A field or a reason this build has no name for is one it cannot write.
  if (checked === NEWER) return { ok: false, reason: 'invalid', part: 'record' };
  if (isDamaged(checked)) return { ok: false, reason: 'invalid', part: checked.damaged };
  const json = JSON.stringify(written(checked));
  if (json.length > LAYER_ORDER_RECORD_MAX_BYTES) {
    return { ok: false, reason: 'over-budget', bytes: json.length, budget: LAYER_ORDER_RECORD_MAX_BYTES };
  }
  return { ok: true, json };
}

/** The record as written: `v` first, then each field in the order the type names them. */
function written(record: LayerOrderRecord): Record<string, unknown> {
  return {
    v: LAYER_ORDER_RECORD_VERSION,
    faces: record.faces.map((face) => ({ at: [face.at[0], face.at[1]], area: face.area })),
    constraints: record.constraints.map(pairWritten),
    order: record.order.map(pairWritten),
    ...(record.attention ? { attention: { reason: record.attention.reason, count: record.attention.count } } : {}),
  };
}

function pairWritten([f, g, sign]: LayerOrderPair): LayerOrderPair {
  return [f, g, sign];
}

/**
 * Every field of a version-1 record, checked; the version itself is the
 * caller's. What a newer build wrote is looked for before damage, anywhere in
 * the record: a later build may mean something by what reads here as damage,
 * and its record is carried rather than dropped.
 */
function recordOf(value: Record<string, unknown>): Reading<LayerOrderRecord> {
  if (hasNewerKey(value, RECORD_KEYS)) return NEWER;
  const faces = facesOf(value.faces);
  const attention = value.attention === undefined ? undefined : attentionOf(value.attention);
  if (faces === NEWER || attention === NEWER) return NEWER;
  if (isDamaged(faces)) return faces;
  const constraints = pairsOf(value.constraints, faces.length);
  if (constraints === null) return { damaged: 'constraints' };
  const order = pairsOf(value.order, faces.length);
  if (order === null) return { damaged: 'order' };
  if (isDamaged(attention)) return attention;
  return { faces, constraints, order, ...(attention ? { attention } : {}) };
}

function facesOf(value: unknown): Reading<LayerOrderFace[]> {
  if (!Array.isArray(value)) return { damaged: 'faces' };
  if (value.some((face) => isRecord(face) && hasNewerKey(face, FACE_KEYS))) return NEWER;
  const faces: LayerOrderFace[] = [];
  for (const face of value) {
    if (!isRecord(face)) return { damaged: 'faces' };
    const { at, area } = face;
    if (!Array.isArray(at) || at.length !== 2 || !at.every(isFiniteNumber)) return { damaged: 'faces' };
    if (!isFiniteNumber(area) || area <= 0) return { damaged: 'faces' };
    faces.push({ at: [at[0] as number, at[1] as number], area });
  }
  return faces;
}

/** Pairs of distinct faces among `faceCount`, each with a sign; null when any is not one. */
function pairsOf(value: unknown, faceCount: number): LayerOrderPair[] | null {
  if (!Array.isArray(value)) return null;
  const pairs: LayerOrderPair[] = [];
  const isFace = (index: unknown): index is number =>
    typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < faceCount;
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 3) return null;
    const [f, g, sign] = pair as unknown[];
    if (!isFace(f) || !isFace(g) || f === g || (sign !== 1 && sign !== -1)) return null;
    pairs.push([f, g, sign]);
  }
  return pairs;
}

function attentionOf(value: unknown): Reading<LayerOrderAttention> {
  if (!isRecord(value)) return { damaged: 'attention' };
  const { reason, count } = value;
  // A field or a reason this build has no name for is a newer build's.
  if (hasNewerKey(value, ATTENTION_KEYS)) return NEWER;
  if (typeof reason === 'string' && !(LAYER_ORDER_ATTENTION_REASONS as readonly string[]).includes(reason)) {
    return NEWER;
  }
  if (typeof reason !== 'string') return { damaged: 'attention' };
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return { damaged: 'attention' };
  return { reason: reason as LayerOrderAttentionReason, count };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
