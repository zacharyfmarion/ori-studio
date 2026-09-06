/**
 * The pure pieces of `ReferencesCpView`: what the camera frames, what a click
 * hits, and how a step's overlay becomes GPU geometry. Kept DOM- and GL-free so
 * the id conversions and the vertex-before-crease rule are unit-tested rather
 * than hoped for.
 */
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { Point } from '../../lib/geometry';
import { cpModelToSvg } from '../../lib/creasePatternViewport';
import type { UserBounds } from '../renderer/camera';
import type { ModelPoint, PointGeometry, Rgba, StrokeGeometry } from '../renderer/types';
import { VERTEX_RADIUS_FACTOR } from '../adapters/cpPointsToScene';
import { previewGroupsToStrokes, type PreviewStrokeGroup } from '../renderer/previewStrokes';
import type { LineHitIndex } from '../picking/lineHitIndex';
import type { ModelBounds, ReferencesGhostSegment, ReferencesMarker } from './referencesStepGeometry';

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
export function transportUserBounds(geometry: CpGeometryTransport): UserBounds | null {
  const endpoints = geometry.segEndpoints;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let has = false;
  for (let i = 0; i + 1 < endpoints.length; i += 2) {
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
  new: Rgba;
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
  const folded = ghosts.filter((g) => g.kind === 'folded');
  const inputs = ghosts.filter((g) => g.kind === 'input');
  const made = ghosts.filter((g) => g.kind === 'new');
  if (folded.length) groups.push({ segments: folded, color: colors.folded, dashed: true });
  if (inputs.length) groups.push({ segments: inputs, color: colors.input, dashed: false });
  if (made.length) groups.push({ segments: made, color: colors.new, dashed: false });
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
  colors: Pick<ReferencesOverlayColors, 'input' | 'new'>
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
    const color = marker.kind === 'new' ? colors.new : colors.input;
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
