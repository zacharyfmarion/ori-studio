/**
 * Compact, typed-array geometry transport — the fast counterpart to
 * `document_snapshot`.
 *
 * `document_geometry(handle)` returns a {@link CpGeometryTransport}: the bulk
 * geometry (line/aux segments, points, circles) as flat typed arrays backed by
 * transferable `ArrayBuffer`s, plus a small structured `tail` (title, texts,
 * grid, operation frame, metadata). This module owns the field layout and the
 * accessor that reads it.
 *
 * {@link CpGeometry} exposes iteration and random-access-by-id over the buffers
 * without materializing an object per element (the render/interaction win).
 * {@link decodeCpGeometryToSnapshot} materializes a full
 * {@link OristudioCpDocumentSnapshot} — the shape `document_snapshot` returns —
 * so the compact path can be checked field-for-field against the structured
 * snapshot (the parity gate) and against itself (round-trip identity).
 *
 * The number↔name tables here are the TS mirror of the kernel's
 * `LineColor::number()`/`from_number()` and `ActiveState` discriminants; they
 * are the single reason the two paths agree on `color`/`active` strings, so they
 * must stay in lockstep with the Rust enums.
 */
import type { Point } from '../lib/geometry';
import { FOLD_MAGNITUDE_CLASSIC, foldDirectionHintFromCode } from '../lib/foldAngle';
import type {
  OristudioCpCircle,
  OristudioCpDocumentSnapshot,
  OristudioCpGridMetadata,
  OristudioCpLineColor,
  OristudioCpLineSegment,
  OristudioCpModel,
  OristudioCpOperationFrame,
  OristudioCpRgbColor,
  OristudioCpTextElement,
} from './oristudioCpTypes';

/**
 * Per-segment integer attributes: colour, active, selected, customized, and the
 * fold-direction hint (0 none, 1 mountain, 2 valley).
 *
 * OCG3 widened this from 4. Must stay in lockstep with `SEG_ATTR_STRIDE` in
 * `crates/oristudio-cp/src/geometry_transport.rs` — the magic bump is what stops
 * a stale decoder misreading rather than failing.
 */
export const SEG_ATTR_STRIDE = 5;
/** Per-circle attribute stride: `[color, customized]`. */
export const CIRCLE_ATTR_STRIDE = 2;

/** Low-count / non-numeric document remainder (mirrors the kernel `CompactTail`). */
export interface CpGeometryTail {
  title?: string | null;
  texts: OristudioCpTextElement[];
  grid: OristudioCpGridMetadata;
  operation_frame: OristudioCpOperationFrame;
  metadata: Record<string, unknown>;
}

/** Raw transport as returned by `document_geometry` (typed arrays + tail). */
export interface CpGeometryTransport {
  /** `[ax, ay, bx, by]` per line segment. */
  segEndpoints: Float64Array;
  /** `[color, active, selected, customized, foldDirectionHint]` per line segment. */
  segAttr: Int32Array;
  /** `[r, g, b]` per line segment (meaningful only when `customized`). */
  segCustomColor: Uint8Array;
  /**
   * Fold magnitude per line segment in kernel storage units, with
   * `FOLD_MAGNITUDE_CLASSIC` for a classic ±180 crease.
   *
   * **Empty when no segment carries one** — the case for every
   * Oriedita-compatible document. Empty means all-classic, not all-zero.
   * May be absent entirely when talking to an older kernel.
   */
  segFoldMagnitude?: Uint32Array;
  auxEndpoints: Float64Array;
  auxAttr: Int32Array;
  auxCustomColor: Uint8Array;
  /** `[x, y]` per standalone point. */
  pointCoords: Float64Array;
  /** `[x, y, r]` per circle. */
  circleData: Float64Array;
  /** `[color, customized]` per circle. */
  circleAttr: Int32Array;
  /** `[r, g, b]` per circle. */
  circleCustomColor: Uint8Array;
  tail: CpGeometryTail;
}

/** Mirror of `LineColor::number()` — the authoritative int→name mapping. */
const LINE_COLOR_BY_NUMBER: Record<number, OristudioCpLineColor> = {
  [-2]: 'Angle',
  [-1]: 'None',
  0: 'Black0',
  1: 'Red1',
  2: 'Blue2',
  3: 'Cyan3',
  4: 'Orange4',
  5: 'Magenta5',
  6: 'Green6',
  7: 'Yellow7',
  8: 'Purple8',
  9: 'Other9',
  10: 'Grey10',
};

/** Mirror of the `ActiveState` discriminants (`decode` maps unknown → `Inactive0`). */
const ACTIVE_STATE_BY_NUMBER: Record<number, string> = {
  0: 'Inactive0',
  1: 'ActiveA1',
  2: 'ActiveB2',
  3: 'ActiveBoth3',
};

/** Map a kernel line-color number to its snapshot name (mirrors `LineColor::from_number`). */
export function lineColorName(code: number): OristudioCpLineColor {
  const name = LINE_COLOR_BY_NUMBER[code];
  if (name === undefined) {
    throw new Error(`unknown line color number ${code}`);
  }
  return name;
}

/** Map a kernel active-state number to its snapshot name, as a decode does. */
export function activeStateName(code: number): string {
  return ACTIVE_STATE_BY_NUMBER[code] ?? 'Inactive0';
}

function rgb(data: Uint8Array, offset: number): OristudioCpRgbColor {
  return { red: data[offset], green: data[offset + 1], blue: data[offset + 2] };
}

/**
 * Random-access / iterable view over a {@link CpGeometryTransport}.
 *
 * Reads the flat buffers on demand; nothing is materialized up front. Line and
 * aux segments are addressed by their 1-based ids (matching the kernel/`replace`
 * conventions) as well as 0-based indices.
 */
export class CpGeometry {
  constructor(private readonly transport: CpGeometryTransport) {}

  get lineSegmentCount(): number {
    return this.transport.segEndpoints.length / 4;
  }

  get auxLineSegmentCount(): number {
    return this.transport.auxEndpoints.length / 4;
  }

  get pointCount(): number {
    return this.transport.pointCoords.length / 2;
  }

  get circleCount(): number {
    return this.transport.circleData.length / 3;
  }

  get tail(): CpGeometryTail {
    return this.transport.tail;
  }

  /** Line segment by 0-based index. */
  lineSegment(index: number): OristudioCpLineSegment {
    return readSegment(
      index,
      this.transport.segEndpoints,
      this.transport.segAttr,
      this.transport.segCustomColor,
      this.transport.segFoldMagnitude
    );
  }

  /** Line segment by 1-based id (`id === index + 1`). */
  lineSegmentById(id: number): OristudioCpLineSegment {
    return this.lineSegment(id - 1);
  }

  auxLineSegment(index: number): OristudioCpLineSegment {
    return readSegment(
      index,
      this.transport.auxEndpoints,
      this.transport.auxAttr,
      this.transport.auxCustomColor
    );
  }

  point(index: number): Point {
    const base = index * 2;
    return { x: this.transport.pointCoords[base], y: this.transport.pointCoords[base + 1] };
  }

  circle(index: number): OristudioCpCircle {
    const { circleData, circleAttr, circleCustomColor } = this.transport;
    const d = index * 3;
    const a = index * CIRCLE_ATTR_STRIDE;
    const c = index * 3;
    return {
      x: circleData[d],
      y: circleData[d + 1],
      r: circleData[d + 2],
      color: lineColorName(circleAttr[a]),
      customized: circleAttr[a + 1],
      customized_color: rgb(circleCustomColor, c),
    };
  }

  *lineSegments(): IterableIterator<OristudioCpLineSegment> {
    for (let i = 0; i < this.lineSegmentCount; i += 1) {
      yield this.lineSegment(i);
    }
  }

  *auxLineSegments(): IterableIterator<OristudioCpLineSegment> {
    for (let i = 0; i < this.auxLineSegmentCount; i += 1) {
      yield this.auxLineSegment(i);
    }
  }

  *points(): IterableIterator<Point> {
    for (let i = 0; i < this.pointCount; i += 1) {
      yield this.point(i);
    }
  }

  *circles(): IterableIterator<OristudioCpCircle> {
    for (let i = 0; i < this.circleCount; i += 1) {
      yield this.circle(i);
    }
  }
}

function readSegment(
  index: number,
  endpoints: Float64Array,
  attr: Int32Array,
  custom: Uint8Array,
  foldMagnitude?: Uint32Array
): OristudioCpLineSegment {
  const e = index * 4;
  const a = index * SEG_ATTR_STRIDE;
  const c = index * 3;
  const segment: OristudioCpLineSegment = {
    a: { x: endpoints[e], y: endpoints[e + 1] },
    b: { x: endpoints[e + 2], y: endpoints[e + 3] },
    color: lineColorName(attr[a]),
    active: activeStateName(attr[a + 1]),
    selected: attr[a + 2],
    customized: attr[a + 3],
    customized_color: rgb(custom, c),
  };
  // Absent array, or the classic sentinel, both mean "full ±180 by colour" —
  // and the field is left off entirely so a classic segment is structurally
  // identical to what it was before fold angles existed.
  const raw = foldMagnitude?.[index];
  if (raw !== undefined && raw !== FOLD_MAGNITUDE_CLASSIC) {
    segment.fold_magnitude = raw;
  }
  // OCG3's fifth attribute slot. Set only when hinted, for the same structural
  // reason as `fold_magnitude` above — an unhinted segment must decode to
  // exactly what it did before hints existed, or the parity gate trips on every
  // document.
  const hint = foldDirectionHintFromCode(attr[a + 4]);
  if (hint !== undefined) {
    segment.fold_direction_hint = hint;
  }
  return segment;
}

/**
 * Deduplicate crease **line-segment** endpoints into unique vertex positions
 * (for drawing the vertex dots) straight from the compact transport — the
 * transport-driven mirror of `getCpVertexPoints`. Same quantization (1e-9) and
 * same first-seen push order, so it produces an identical `Point[]`, but reads
 * the flat `segEndpoints` buffer instead of an array of segment objects (a hot
 * path on dense patterns: tens of thousands of segments, rerun every edit).
 *
 * Aux segments are intentionally excluded, exactly as `getCpVertexPoints` does.
 */
export function vertexPointsFromTransport(transport: CpGeometryTransport): Point[] {
  const endpoints = transport.segEndpoints;
  const count = endpoints.length / 4;
  const seen = new Map<number, Set<number>>();
  const points: Point[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = i * 4;
    for (let k = 0; k < 2; k += 1) {
      const x = endpoints[base + k * 2];
      const y = endpoints[base + k * 2 + 1];
      const qx = Math.round(x * 1e9);
      const qy = Math.round(y * 1e9);
      let column = seen.get(qx);
      if (!column) {
        column = new Set<number>();
        seen.set(qx, column);
      }
      if (!column.has(qy)) {
        column.add(qy);
        points.push({ x, y });
      }
    }
  }
  return points;
}

/**
 * Materialize a full {@link OristudioCpDocumentSnapshot} from the compact
 * transport — the exact shape `document_snapshot` returns. Cold-path / test use:
 * the parity and round-trip gates compare this against the structured snapshot.
 */
export function decodeCpGeometryToSnapshot(
  transport: CpGeometryTransport
): OristudioCpDocumentSnapshot {
  const geometry = new CpGeometry(transport);
  const model: OristudioCpModel = {
    line_segments: [...geometry.lineSegments()],
    circles: [...geometry.circles()],
    points: [...geometry.points()],
    aux_line_segments: [...geometry.auxLineSegments()],
    texts: transport.tail.texts,
    grid: transport.tail.grid,
  };
  return snapshotOfModel(model, transport);
}

function snapshotOfModel(
  model: OristudioCpModel,
  transport: CpGeometryTransport
): OristudioCpDocumentSnapshot {
  const snapshot: OristudioCpDocumentSnapshot = {
    crease_pattern: model,
    operation_frame: transport.tail.operation_frame,
    metadata: transport.tail.metadata,
  };
  if (transport.tail.title !== undefined && transport.tail.title !== null) {
    snapshot.title = transport.tail.title;
  }
  return snapshot;
}

/** The keys a lazy model decodes on first read, in `decodeCpGeometryToSnapshot`'s order. */
const LAZY_MODEL_KEYS = ['line_segments', 'circles', 'points', 'aux_line_segments'] as const;
type LazyModelKey = (typeof LAZY_MODEL_KEYS)[number];

interface LazyModelState {
  /**
   * The transport the model's lines are answered from without decoding; null
   * once any of its arrays has been assigned, when they are no longer its.
   */
  transport: CpGeometryTransport | null;
  /** Each array as decoded (or assigned) so far. */
  values: Partial<Record<LazyModelKey, unknown>>;
}

/**
 * Every lazily decoded model ({@link lazyCpDocumentSnapshot}) and where it
 * stands. Keyed on the model rather than the snapshot, so a snapshot copied
 * with a new title or metadata (`{ ...document, title }`) keeps reading its
 * lines from the typed arrays.
 */
const lazyModels = new WeakMap<OristudioCpModel, LazyModelState>();

function decodeModelField(transport: CpGeometryTransport, key: LazyModelKey) {
  const geometry = new CpGeometry(transport);
  switch (key) {
    case 'line_segments':
      return [...geometry.lineSegments()];
    case 'circles':
      return [...geometry.circles()];
    case 'points':
      return [...geometry.points()];
    case 'aux_line_segments':
      return [...geometry.auxLineSegments()];
  }
}

function lazyModel(
  transport: CpGeometryTransport,
  values: LazyModelState['values'] = {}
): OristudioCpModel {
  const model = {} as OristudioCpModel;
  const state: LazyModelState = { transport, values };
  for (const key of LAZY_MODEL_KEYS) {
    Object.defineProperty(model, key, {
      enumerable: true,
      configurable: true,
      get() {
        if (!(key in state.values)) state.values[key] = decodeModelField(transport, key);
        return state.values[key];
      },
      set(value: unknown) {
        // Arrays written here are no longer the transport's, so nothing may
        // answer for the model from it again.
        state.transport = null;
        state.values[key] = value;
      },
    });
  }
  model.texts = transport.tail.texts;
  model.grid = transport.tail.grid;
  lazyModels.set(model, state);
  return model;
}

/**
 * The document a {@link CpGeometryTransport} holds, as an
 * {@link OristudioCpDocumentSnapshot} whose four bulk arrays — line segments,
 * circles, points and aux line segments — are decoded from the transport the
 * first time each is read, and are the same arrays from then on.
 *
 * This is what the store holds after every kernel command. Decoding is what a
 * whole snapshot costs: on a canvas of 489k creases, ~150 ms and 131 MiB of
 * objects, for every edit, undo and redo. Nothing on that path needs them any
 * more. The canvas, hit testing, snapping, bounds and the crease fingerprints
 * read the typed arrays ({@link cpLineEndpoints}, {@link cpLineSegmentAt},
 * `lib/creaseFingerprint.ts`), so the arrays are built only for what genuinely
 * needs every line as an object: a save, the clipboard, a fold, an export.
 *
 * Indistinguishable from {@link decodeCpGeometryToSnapshot}'s result to a
 * reader: same keys in the same order, so a spread, `structuredClone` or
 * `JSON.stringify` decodes and copies exactly what that would hold (an `.osf`
 * save is byte-identical). A decode reads the transport as it is then, so the
 * `selected` flags a selection writes into it in place (`mirrorSelectedLines`)
 * are what it finds.
 */
export function lazyCpDocumentSnapshot(transport: CpGeometryTransport): OristudioCpDocumentSnapshot {
  return snapshotOfModel(lazyModel(transport), transport);
}

/**
 * The compact transport a document's lines are read from, when it is a
 * {@link lazyCpDocumentSnapshot} (decoded or not); null for a snapshot built any
 * other way, such as a test fixture or a copy with its lines replaced.
 */
export function cpDocumentTransport(
  document: OristudioCpDocumentSnapshot
): CpGeometryTransport | null {
  return lazyModels.get(document.crease_pattern)?.transport ?? null;
}

/**
 * An object that stays the same exactly while the document's lines do — what
 * keying on `crease_pattern.line_segments` meant, without decoding it to get
 * one: the transport behind a lazy snapshot (whose decode is the array), else
 * the array itself.
 */
export function cpDocumentLinesKey(document: OristudioCpDocumentSnapshot): object {
  return cpDocumentTransport(document) ?? document.crease_pattern.line_segments;
}

/**
 * The document's line segments if they exist as objects already — always for a
 * plain snapshot, and for a lazy one once something has read them — else null.
 * Never decodes.
 */
export function cpDecodedLineSegments(
  document: OristudioCpDocumentSnapshot
): OristudioCpLineSegment[] | null {
  const state = lazyModels.get(document.crease_pattern);
  if (!state) return document.crease_pattern.line_segments;
  return 'line_segments' in state.values
    ? (state.values.line_segments as OristudioCpLineSegment[])
    : null;
}

/** How many line segments the document holds. Never decodes. */
export function cpLineSegmentCount(document: OristudioCpDocumentSnapshot): number {
  const decoded = cpDecodedLineSegments(document);
  if (decoded) return decoded.length;
  const transport = cpDocumentTransport(document);
  return transport
    ? transport.segEndpoints.length / 4
    : document.crease_pattern.line_segments.length;
}

/**
 * The line segment with this 1-based id, or undefined past either end — what
 * `document.crease_pattern.line_segments[id - 1]` answers, without decoding
 * the rest. From the transport it is a fresh object on every call; from decoded
 * lines it is the one in the array.
 */
export function cpLineSegmentAt(
  document: OristudioCpDocumentSnapshot,
  id: number
): OristudioCpLineSegment | undefined {
  const decoded = cpDecodedLineSegments(document);
  if (decoded) return decoded[id - 1];
  const transport = cpDocumentTransport(document);
  if (!transport) return document.crease_pattern.line_segments[id - 1];
  if (!Number.isInteger(id) || id < 1 || id > transport.segEndpoints.length / 4) return undefined;
  return new CpGeometry(transport).lineSegment(id - 1);
}

/**
 * Visit every line of the document in id order with its endpoints, colour and
 * 1-based id. Never decodes: for a lazy snapshot not yet decoded it reads the
 * transport, handing every line the same reused `line` object — read it during
 * the call and never keep it.
 */
export function forEachCpLine(
  document: OristudioCpDocumentSnapshot,
  visit: (
    line: Readonly<{ a: Point; b: Point }>,
    color: OristudioCpLineSegment['color'],
    id: number
  ) => void
): void {
  const decoded = cpDecodedLineSegments(document);
  const transport = decoded ? null : cpDocumentTransport(document);
  if (!transport) {
    const lines = decoded ?? document.crease_pattern.line_segments;
    for (let i = 0; i < lines.length; i += 1) visit(lines[i]!, lines[i]!.color, i + 1);
    return;
  }
  const { segEndpoints, segAttr } = transport;
  const line = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
  const count = segEndpoints.length / 4;
  for (let i = 0; i < count; i += 1) {
    line.a.x = segEndpoints[i * 4]!;
    line.a.y = segEndpoints[i * 4 + 1]!;
    line.b.x = segEndpoints[i * 4 + 2]!;
    line.b.y = segEndpoints[i * 4 + 3]!;
    visit(line, lineColorName(segAttr[i * SEG_ATTR_STRIDE]!), i + 1);
  }
}

/** `selected` is the third of a segment's attribute slots. */
export const SEG_SELECTED_SLOT = 2;

/** The 1-based ids of the lines whose `selected` flag is set, in id order. Never decodes. */
export function cpSelectedLineIds(document: OristudioCpDocumentSnapshot): number[] {
  const ids: number[] = [];
  const decoded = cpDecodedLineSegments(document);
  const transport = decoded ? null : cpDocumentTransport(document);
  if (transport) {
    const attr = transport.segAttr;
    const count = transport.segEndpoints.length / 4;
    for (let i = 0; i < count; i += 1) {
      if (attr[i * SEG_ATTR_STRIDE + SEG_SELECTED_SLOT] !== 0) ids.push(i + 1);
    }
    return ids;
  }
  const lines = decoded ?? document.crease_pattern.line_segments;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.selected !== 0) ids.push(i + 1);
  }
  return ids;
}

const endpointsOfLines = new WeakMap<readonly { a: Point; b: Point }[], Float64Array>();

/**
 * `[ax, ay, bx, by]` for each line, in id order, packed like
 * {@link CpGeometryTransport.segEndpoints} — built once per array and cached.
 * The shape the canvas, hit testing and snapping read lines in.
 */
export function cpSegmentEndpoints(segments: readonly { a: Point; b: Point }[]): Float64Array {
  const cached = endpointsOfLines.get(segments);
  if (cached) return cached;
  const endpoints = new Float64Array(segments.length * 4);
  for (let i = 0; i < segments.length; i += 1) {
    const { a, b } = segments[i]!;
    endpoints[i * 4] = a.x;
    endpoints[i * 4 + 1] = a.y;
    endpoints[i * 4 + 2] = b.x;
    endpoints[i * 4 + 3] = b.y;
  }
  endpointsOfLines.set(segments, endpoints);
  return endpoints;
}

/**
 * The endpoints of the line with this 1-based id in a {@link cpSegmentEndpoints}
 * packing, or undefined past either end.
 */
export function packedLineAt(
  endpoints: Float64Array,
  id: number
): { a: Point; b: Point } | undefined {
  if (!Number.isInteger(id) || id < 1 || id > endpoints.length / 4) return undefined;
  const at = (id - 1) * 4;
  return {
    a: { x: endpoints[at]!, y: endpoints[at + 1]! },
    b: { x: endpoints[at + 2]!, y: endpoints[at + 3]! },
  };
}

/**
 * A {@link cpSegmentEndpoints} packing without the lines whose 1-based ids are
 * `excluded`, the rest kept in order — the lines a move-drag snaps to.
 */
export function packedLinesExcept(
  endpoints: Float64Array,
  excluded: readonly number[]
): Float64Array {
  const skip = new Set(excluded);
  const count = endpoints.length / 4;
  let kept = 0;
  for (let i = 0; i < count; i += 1) if (!skip.has(i + 1)) kept += 1;
  const result = new Float64Array(kept * 4);
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    if (skip.has(i + 1)) continue;
    for (let k = 0; k < 4; k += 1) result[at + k] = endpoints[i * 4 + k]!;
    at += 4;
  }
  return result;
}

/**
 * Visit every line of a {@link cpSegmentEndpoints} packing in id order, with
 * its endpoints and 1-based id. `a` and `b` are two objects reused for every
 * line, so a pass over half a million allocates nothing: read them during the
 * call and never keep them.
 */
export function forEachPackedLine(
  endpoints: Float64Array,
  visit: (a: Readonly<Point>, b: Readonly<Point>, id: number) => void
): void {
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  const count = endpoints.length / 4;
  for (let i = 0; i < count; i += 1) {
    a.x = endpoints[i * 4]!;
    a.y = endpoints[i * 4 + 1]!;
    b.x = endpoints[i * 4 + 2]!;
    b.y = endpoints[i * 4 + 3]!;
    visit(a, b, i + 1);
  }
}

/**
 * Every line's endpoints as {@link cpSegmentEndpoints} packs them: the
 * transport's own array for a lazy snapshot, which nothing writes into, and
 * otherwise built from the lines once. Never decodes.
 */
export function cpLineEndpoints(document: OristudioCpDocumentSnapshot): Float64Array {
  return (
    cpDocumentTransport(document)?.segEndpoints ??
    cpSegmentEndpoints(document.crease_pattern.line_segments)
  );
}

/**
 * The document with its texts replaced and everything else shared, still lazy:
 * what `{ ...document, crease_pattern: { ...model, texts } }` means, without
 * the spread decoding every line to copy it.
 */
export function withCpDocumentTexts(
  document: OristudioCpDocumentSnapshot,
  texts: OristudioCpTextElement[]
): OristudioCpDocumentSnapshot {
  const state = lazyModels.get(document.crease_pattern);
  if (!state?.transport) {
    return { ...document, crease_pattern: { ...document.crease_pattern, texts } };
  }
  // Whatever the source already decoded is shared rather than decoded twice;
  // the rest stays lazy.
  const model = lazyModel(state.transport, { ...state.values });
  model.texts = texts;
  return { ...document, crease_pattern: model };
}
