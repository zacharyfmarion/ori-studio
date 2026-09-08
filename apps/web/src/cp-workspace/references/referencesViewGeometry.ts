/**
 * The pure pieces of `ReferencesCpView`: what the camera frames, what a click
 * hits, and how a step's overlay becomes GPU geometry. Kept DOM- and GL-free so
 * the id conversions and the vertex-before-crease rule are unit-tested rather
 * than hoped for.
 */
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { Point } from '../../lib/geometry';
import { cpModelToSvg, cpVertexId } from '../../lib/creasePatternViewport';
import type { UserBounds } from '../renderer/camera';
import type {
  FillGeometry,
  ModelPoint,
  PointGeometry,
  Rgba,
  StrokeGeometry,
} from '../renderer/types';
import { VERTEX_RADIUS_FACTOR } from '../adapters/cpPointsToScene';
import { previewGroupsToStrokes, type PreviewStrokeGroup } from '../renderer/previewStrokes';
import type { LineHitIndex } from '../picking/lineHitIndex';
import { dashRulerAlong } from './stepDiagramGeometry';
import type {
  ModelBounds,
  ReferencesGhostKind,
  ReferencesGhostSegment,
  ReferencesMarker,
} from './referencesStepGeometry';

/**
 * What the view lets the user pick. Ids follow the editor's conventions so the
 * rest of the workspace speaks one language: a crease is its **1-based** line
 * id (the hit index and `CpSelectionStyle` both count from 1), a vertex is its
 * **0-based** index into `vertexPointsFromTransport(geometry)` — the order the
 * point buffer draws in and `CpPointSelection.vertexIdx` highlights by.
 */
export type ReferencesPick =
  | { kind: 'line'; id: number }
  | { kind: 'vertex'; idx: number; point: Point };

/**
 * The camera's framing target: every crease endpoint, in SVG user space. Null
 * for an empty transport. The transport equivalent of `cpContentBounds` for a
 * surface that draws creases and nothing else.
 */
export function transportUserBounds(
  geometry: CpGeometryTransport,
  /** 1-based crease ids to measure; omit for the whole document. */
  ids: ReadonlySet<number> | null = null
): UserBounds | null {
  const endpoints = geometry.segEndpoints;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let has = false;
  for (let i = 0; i + 1 < endpoints.length; i += 2) {
    // Two coordinates per endpoint, four per segment: the segment this endpoint
    // belongs to is `i >> 2`, and its 1-based id is one more.
    if (ids !== null && !ids.has((i >> 2) + 1)) continue;
    const u = cpModelToSvg({ x: endpoints[i], y: endpoints[i + 1] });
    if (!Number.isFinite(u.x) || !Number.isFinite(u.y)) continue;
    if (u.x < minX) minX = u.x;
    if (u.y < minY) minY = u.y;
    if (u.x > maxX) maxX = u.x;
    if (u.y > maxY) maxY = u.y;
    has = true;
  }
  return has ? { minX, minY, maxX, maxY } : null;
}

/** Model-space bounds → SVG user bounds (the camera's space), through the paper affine. */
export function modelBoundsToUser(bounds: ModelBounds): UserBounds {
  const corners = [
    cpModelToSvg({ x: bounds.minX, y: bounds.minY }),
    cpModelToSvg({ x: bounds.maxX, y: bounds.minY }),
    cpModelToSvg({ x: bounds.minX, y: bounds.maxY }),
    cpModelToSvg({ x: bounds.maxX, y: bounds.maxY }),
  ];
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}

export interface ReferencesHitIndexes {
  /** Zero-length segments at every vertex, id = vertex index + 1. */
  vertices: LineHitIndex;
  /** Every crease, id = segment index + 1. */
  lines: LineHitIndex;
}

/**
 * What a click at `point` (model space) picks: a vertex within `vertexRadius`
 * before a crease within `lineRadius`, because a crease's nearest point is its
 * perpendicular foot, which sits on top of its own endpoints — asked the other
 * way round, no vertex would ever be reachable. Both indexes report 1-based
 * ids; the vertex id is converted back to the buffer index here so the
 * boundary is the only place that arithmetic lives.
 */
export function resolveReferencesPick(
  indexes: ReferencesHitIndexes,
  vertices: readonly Point[],
  point: ModelPoint,
  vertexRadius: number,
  lineRadius: number
): ReferencesPick | null {
  const vertexId = indexes.vertices.query(point.x, point.y, vertexRadius);
  if (vertexId > 0) {
    const idx = vertexId - 1;
    const at = vertices[idx];
    if (at) return { kind: 'vertex', idx, point: at };
  }
  const lineId = indexes.lines.query(point.x, point.y, lineRadius);
  if (lineId > 0) return { kind: 'line', id: lineId };
  return null;
}

/** The three colours a step overlay is drawn in, resolved by the view from the theme. */
export interface ReferencesOverlayColors {
  folded: Rgba;
  input: Rgba;
  /** The mark a step constructs — ink, not a hue: it is a point, not a crease. */
  mark: Rgba;
  /** A crease's own ink, by direction. `new` and `unfolded` pick from these. */
  mountain: Rgba;
  valley: Rgba;
  unassigned: Rgba;
  /** How much of its ink the uncreased part of a fold keeps. */
  unfoldedAlpha: number;
}

/**
 * Ghost lines as preview strokes: folded-so-far creases dashed and muted,
 * inputs and the new crease solid in their own colours. Grouped by kind so one
 * geometry carries all three; null when there is nothing to draw, which the
 * renderer reads as "clear the preview channel".
 */
export function ghostSegmentsToStrokes(
  ghosts: readonly ReferencesGhostSegment[],
  colors: ReferencesOverlayColors
): StrokeGeometry | null {
  if (ghosts.length === 0) return null;
  const groups: PreviewStrokeGroup[] = [];
  const inkOf = (ghost: ReferencesGhostSegment): Rgba =>
    ghost.direction === 'mountain'
      ? colors.mountain
      : ghost.direction === 'valley'
        ? colors.valley
        : colors.unassigned;
  const byInk = (kind: ReferencesGhostKind, alpha: number) => {
    for (const ink of ['mountain', 'valley', 'unassigned'] as const) {
      const segments = ghosts.filter(
        (g) => g.kind === kind && (g.direction ?? 'unassigned') === ink
      );
      if (!segments.length) continue;
      const color = inkOf(segments[0]);
      groups.push({
        segments,
        color: alpha === 1 ? color : withAlpha(color, alpha),
        dashed: false,
      });
    }
  };
  const folded = ghosts.filter((g) => g.kind === 'folded');
  const inputs = ghosts.filter((g) => g.kind === 'input');
  // Faintest first: the part of the fold that is not creased sits under
  // everything, including the parts that are.
  byInk('unfolded', colors.unfoldedAlpha);
  if (folded.length) groups.push({ segments: folded, color: colors.folded, dashed: true });
  if (inputs.length) groups.push({ segments: inputs, color: colors.input, dashed: false });
  byInk('new', 1);
  return previewGroupsToStrokes(groups);
}

/** Screen radius of an input ring and of the new mark's disc, CSS px. */
export const REFERENCES_INPUT_RING_RADIUS_CSS = 7;
export const REFERENCES_NEW_MARK_RADIUS_CSS = 4.5;

/**
 * Markers as overlay points: inputs as rings (transparent fill, coloured
 * stroke), the new mark as a filled disc. Null when there are none.
 */
export function markersToOverlayPoints(
  markers: readonly ReferencesMarker[],
  colors: Pick<ReferencesOverlayColors, 'input' | 'mark'>
): PointGeometry | null {
  const count = markers.length;
  if (count === 0) return null;
  const center = new Float32Array(count * 2);
  const radius = new Float32Array(count);
  const screenSpace = new Float32Array(count).fill(1);
  const fill = new Float32Array(count * 4);
  const stroke = new Float32Array(count * 4);
  markers.forEach((marker, i) => {
    center[i * 2] = marker.at.x;
    center[i * 2 + 1] = marker.at.y;
    const color = marker.kind === 'new' ? colors.mark : colors.input;
    radius[i] = marker.kind === 'new' ? REFERENCES_NEW_MARK_RADIUS_CSS : REFERENCES_INPUT_RING_RADIUS_CSS;
    stroke.set(color, i * 4);
    fill.set(marker.kind === 'new' ? color : [color[0], color[1], color[2], 0], i * 4);
  });
  return { center, radius, screenSpace, fill, stroke, count };
}

/**
 * The picked vertex, and the vertices a step names, as overlay points.
 *
 * They ride the overlay channel rather than the crease-point layer because that
 * layer carries a whole-layer `pointOpacity` — the vertex crowding ramp — and on
 * a dense pattern it fades to zero. Picking a vertex is this workspace's primary
 * interaction, so the mark for the one that *was* picked has to survive the fade
 * that makes the pattern readable. Same CSS radius as an ordinary vertex dot, so
 * nothing changes on a sparse pattern where the layer is at full opacity.
 */
export function highlightedVerticesToOverlayPoints(
  points: readonly Point[],
  color: Rgba,
  pointSize: number
): PointGeometry | null {
  const count = points.length;
  if (count === 0) return null;
  const center = new Float32Array(count * 2);
  const radius = new Float32Array(count).fill(VERTEX_RADIUS_FACTOR * pointSize);
  const screenSpace = new Float32Array(count).fill(1);
  const fill = new Float32Array(count * 4);
  const stroke = new Float32Array(count * 4);
  points.forEach((point, i) => {
    center[i * 2] = point.x;
    center[i * 2 + 1] = point.y;
    fill.set(color, i * 4);
    stroke.set(color, i * 4);
  });
  return { center, radius, screenSpace, fill, stroke, count };
}

/** Two overlay-point uploads as one buffer; null when both are empty. */
export function concatOverlayPoints(
  a: PointGeometry | null,
  b: PointGeometry | null
): PointGeometry | null {
  if (!a) return b;
  if (!b) return a;
  const count = a.count + b.count;
  const join = (x: Float32Array, y: Float32Array): Float32Array => {
    const out = new Float32Array(x.length + y.length);
    out.set(x, 0);
    out.set(y, x.length);
    return out;
  };
  return {
    center: join(a.center, b.center),
    radius: join(a.radius, b.radius),
    screenSpace: join(a.screenSpace, b.screenSpace),
    fill: join(a.fill, b.fill),
    stroke: join(a.stroke, b.stroke),
    count,
  };
}

/** The movement below which a press-and-release counts as a click, CSS px. */
export const REFERENCES_CLICK_MOVE_THRESHOLD_CSS = 4;

/** Whether a pointer that went down at `press` and came up at `release` clicked. */
export function isClick(
  press: { x: number; y: number },
  release: { x: number; y: number },
  threshold = REFERENCES_CLICK_MOVE_THRESHOLD_CSS
): boolean {
  return Math.hypot(release.x - press.x, release.y - press.y) < threshold;
}

/** What a step does to each of the document's creases. */
export interface ReferencesCreaseVisibility {
  /**
   * Ids drawn thicker: the creases the active step makes.
   *
   * Emphasis by *width*, not by an accent hue. The step's creases were once
   * recoloured to `--cp-reference-new` through the adapter's `selection`
   * channel, which threw away the mountain/valley ink the Edit canvas gives
   * them — so the one thing the folder needs to know about a crease, which way
   * it folds, was the thing the highlight erased.
   */
  emphasis?: ReadonlySet<number> | null;
  /** Width multiplier for an emphasised crease. */
  emphasisWidth?: number;
  /**
   * Which way each crease was *folded*, by the step that made it.
   *
   * Not the pattern's own assignment: a step folds one line one way (plan D20),
   * and a line whose creases disagree with each other would otherwise go back
   * to reading red here and blue there the moment the step stopped being
   * active. It stays the way it was made, for the rest of the sequence.
   *
   * The rule that decides this lives with the other visibility rules; the view
   * turns it into a colour, because the palette is the view's.
   */
  directions?: ReadonlyMap<number, 'mountain' | 'valley'> | null;
  /**
   * The ink a folded crease takes, by direction, overriding the crease's own.
   *
   * Resolved by the view from {@link ReferencesCreaseVisibility.directions}.
   */
  ink?: {
    mountain: readonly [number, number, number, number];
    valley: readonly [number, number, number, number];
  } | null;
  /**
   * The 1-based ids drawn at all. `null` means every crease — the sheet is not
   * being read step by step, so nothing is held back.
   */
  visible: ReadonlySet<number> | null;
  /** Ids drawn faintly: made by an earlier step, or simply not this step's. */
  dimmed: ReadonlySet<number> | null;
  /**
   * The sheet's border creases, which are always drawn.
   *
   * Carried so the point layer can tell them apart: the outline is the paper
   * rather than one of the folds, and a dot at every place a crease will one
   * day meet it is a giveaway and a crowd.
   */
  borderLineIds?: ReadonlySet<number> | null;
  /** Multiplier on a dimmed crease's alpha. */
  dimAlpha: number;
}

/**
 * The document's creases as one step of a sequence sees them: what has been
 * folded so far, with this step's own creases at full strength.
 *
 * An alpha pass over the finished stroke buffer rather than another channel on
 * `cpGeometryStrokesToScene`. That adapter is parity-gated byte-for-byte against
 * `cpSnapshotToScene` (its own doc comment calls that the Phase 2 gate), so a
 * fourth id-set option there would have to be added to both and kept in step for
 * a treatment only this workspace wants. Alpha is also exactly the right knob:
 * hidden is alpha 0, dimmed is a fraction, and the buffer is already per-segment
 * RGBA.
 *
 * `count` may exceed the document's segment count — the adapter appends a
 * direction-hint overlay stroke per hinted crease, past the creases, with no way
 * back to the id it belongs to. Those are dropped wholesale while a filter is
 * on: a hint is an editing affordance about a crease whose direction is
 * undecided, and it has no business outliving the crease it annotates in a
 * read-only diagram.
 */
export function applyCreaseVisibility(
  strokes: StrokeGeometry,
  segmentCount: number,
  visibility: ReferencesCreaseVisibility
): StrokeGeometry {
  const {
    visible,
    dimmed,
    dimAlpha,
    emphasis = null,
    emphasisWidth = 1,
    directions = null,
    ink = null,
  } = visibility;
  const filters =
    visible !== null ||
    (dimmed !== null && dimmed.size > 0) ||
    (emphasis !== null && emphasis.size > 0) ||
    (directions !== null && directions.size > 0 && ink !== null);
  if (!filters) return strokes;
  const color = new Float32Array(strokes.color);
  const widthMul = new Float32Array(strokes.widthMul);
  // A crease is split into a segment per crossing, and each one restarts its
  // dash — so a dashed line reads as a row of unrelated dashes with a reset at
  // every vertex. Giving collinear segments a shared parameterisation makes
  // them dash as the one line they are. It is measured along the line's own
  // axis from the origin, so no two segments have to know about each other.
  const a = new Float32Array(strokes.a);
  const b = new Float32Array(strokes.b);
  const dashPhase = new Float32Array(strokes.count);
  for (let i = 0; i < strokes.count; i += 1) {
    if (i >= segmentCount) {
      color[i * 4 + 3] = 0;
      continue;
    }
    const id = i + 1;
    if (visible !== null && !visible.has(id)) {
      color[i * 4 + 3] = 0;
      continue;
    }
    // The direction the fold was made in, for every crease a step has made —
    // not only the active one. Alpha is left alone: it carries the build-up.
    const folded = directions?.get(id);
    if (folded && ink) {
      const rgba = folded === 'mountain' ? ink.mountain : ink.valley;
      color[i * 4] = rgba[0];
      color[i * 4 + 1] = rgba[1];
      color[i * 4 + 2] = rgba[2];
    }
    if (emphasis !== null && emphasis.has(id)) {
      widthMul[i] *= emphasisWidth;
      continue;
    }
    if (dimmed !== null && dimmed.has(id)) color[i * 4 + 3] *= dimAlpha;
  }
  for (let i = 0; i < strokes.count; i += 1) {
    const ruler = dashRulerAlong(a[i * 2], a[i * 2 + 1], b[i * 2], b[i * 2 + 1]);
    a[i * 2] = ruler.ax;
    a[i * 2 + 1] = ruler.ay;
    b[i * 2] = ruler.bx;
    b[i * 2 + 1] = ruler.by;
    dashPhase[i] = ruler.phase;
  }
  return { ...strokes, a, b, color, widthMul, dashPhase };
}

/**
 * The vertices touched by a set of creases, as indices into
 * `vertexPointsFromTransport`'s output.
 *
 * Keyed through `cpVertexId`, which is the same 1e-9 quantisation that function
 * de-duplicates by. Keyed on the raw floats instead, a vertex whose crease
 * carries a different sub-1e-9 coordinate than the first-seen one would miss
 * its own bucket and vanish.
 *
 * One implementation for two questions that must not be able to disagree:
 * which vertices belong to the sheet in scope, and which of them the steps so
 * far have actually made. They differ in one respect only, and it is an
 * argument: see `dropCollinear`.
 */
export function verticesOfLines(
  geometry: CpGeometryTransport,
  vertices: readonly Point[],
  lineIds: ReadonlySet<number>,
  options: { dropCollinear?: boolean } = {}
): Set<number> {
  const index = new Map<string, number>();
  vertices.forEach((point, i) => index.set(cpVertexId(point), i));
  const endpoints = geometry.segEndpoints;
  const kept = new Set<number>();
  // Directions of the creases meeting each vertex, so a point where a line
  // merely changes colour can be told from one where creases actually cross.
  const meeting = new Map<number, { x: number; y: number }[]>();
  for (const id of lineIds) {
    const base = (id - 1) * 4;
    if (base < 0 || base + 3 >= endpoints.length) continue;
    const dx = endpoints[base + 2] - endpoints[base];
    const dy = endpoints[base + 3] - endpoints[base + 1];
    const length = Math.hypot(dx, dy) || 1;
    const direction = { x: dx / length, y: dy / length };
    for (const at of [
      index.get(cpVertexId({ x: endpoints[base], y: endpoints[base + 1] })),
      index.get(cpVertexId({ x: endpoints[base + 2], y: endpoints[base + 3] })),
    ]) {
      if (at === undefined) continue;
      kept.add(at);
      const seen = meeting.get(at);
      if (seen) seen.push(direction);
      else meeting.set(at, [direction]);
    }
  }
  // A vertex where one straight line simply continues is not a landmark. The
  // pattern splits a crease wherever its assignment changes, and the plan folds
  // the whole line one way (plan D20) — so those splits are invisible in the
  // fold and a dot there marks nothing the folder can use.
  //
  // Only for *drawing*. It is still a real point of the pattern, and asking
  // "how do I get here" is the question the workspace exists to answer, so the
  // set that scopes picking keeps it.
  if (options.dropCollinear) {
    for (const [at, directions] of meeting) {
      if (directions.length === 2 && collinear(directions[0], directions[1])) kept.delete(at);
    }
  }
  return kept;
}

/** Whether two unit directions lie along one line, either way round. */
function collinear(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x * b.y - a.y * b.x) <= COLLINEAR_SINE;
}

/**
 * How far from straight two creases may be and still count as one line.
 *
 * The document's own merge tolerance is far tighter than this; the slack is for
 * a pattern whose coordinates arrived through a lossy file, where a line's two
 * halves can differ by a hair.
 */
const COLLINEAR_SINE = 1e-6;

/**
 * The paper as a filled shape: the sheet's outline, triangulated.
 *
 * Taken as the convex hull of the border creases' endpoints rather than by
 * walking the loop — a rectangle's hull *is* its outline, whichever order the
 * document happens to store its edges in, and the planner refuses anything that
 * is not a rectangle. Returns null when there is no border to fill.
 */
export function sheetFillGeometry(
  geometry: CpGeometryTransport,
  borderLineIds: ReadonlySet<number> | null,
  color: Rgba
): FillGeometry | null {
  if (!borderLineIds || borderLineIds.size === 0) return null;
  const endpoints = geometry.segEndpoints;
  const corners: Point[] = [];
  for (const id of borderLineIds) {
    const base = (id - 1) * 4;
    if (base < 0 || base + 3 >= endpoints.length) continue;
    corners.push({ x: endpoints[base], y: endpoints[base + 1] });
    corners.push({ x: endpoints[base + 2], y: endpoints[base + 3] });
  }
  const hull = convexHull(corners);
  if (hull.length < 3) return null;

  // Fan from the first vertex: a convex polygon needs nothing cleverer.
  const triangles = hull.length - 2;
  const position = new Float32Array(triangles * 6);
  const colors = new Float32Array(triangles * 12);
  for (let i = 0; i < triangles; i += 1) {
    const trio = [hull[0], hull[i + 1], hull[i + 2]];
    trio.forEach((point, k) => {
      position[i * 6 + k * 2] = point.x;
      position[i * 6 + k * 2 + 1] = point.y;
      colors.set(color, i * 12 + k * 4);
    });
  }
  return { position, color: colors, count: triangles * 3 };
}

/** Andrew's monotone chain, counter-clockwise. */
function convexHull(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (source: readonly Point[]) => {
    const out: Point[] = [];
    for (const p of source) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** `color` with its alpha scaled — for the uncreased part of a fold. */
function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], color[3] * alpha];
}
