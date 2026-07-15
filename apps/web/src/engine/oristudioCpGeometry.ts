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

/** Per-segment attribute stride: `[color, active, selected, customized]`. */
export const SEG_ATTR_STRIDE = 4;
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
  /** `[color, active, selected, customized]` per line segment. */
  segAttr: Int32Array;
  /** `[r, g, b]` per line segment (meaningful only when `customized`). */
  segCustomColor: Uint8Array;
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

function activeStateName(code: number): string {
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
      this.transport.segCustomColor
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
  custom: Uint8Array
): OristudioCpLineSegment {
  const e = index * 4;
  const a = index * SEG_ATTR_STRIDE;
  const c = index * 3;
  return {
    a: { x: endpoints[e], y: endpoints[e + 1] },
    b: { x: endpoints[e + 2], y: endpoints[e + 3] },
    color: lineColorName(attr[a]),
    active: activeStateName(attr[a + 1]),
    selected: attr[a + 2],
    customized: attr[a + 3],
    customized_color: rgb(custom, c),
  };
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
