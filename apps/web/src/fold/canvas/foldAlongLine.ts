/**
 * Points along a located line ℓ, on either pane: where a partial precrease's
 * segment ends and a pinch's centre are clicked (`tools/precrease`). The
 * pointer is projected onto ℓ where it lies on the paper, and snaps to the
 * points of ℓ a folder would name — where it crosses a crease, an edge or a
 * crease mark the pane shows, a landmark on it (a corner, a Divide-line mark,
 * a crossing it passes through), where it meets the paper's edge, and the
 * middle of its stretch across the paper — or, with Alt held or latched, takes
 * the point of ℓ under the pointer as it is.
 *
 * - **The folded pane** has ℓ in the scene frame, as the tools located it:
 *   its stretches over the paper, each target named by the sheet point of the
 *   layer the viewer sees there.
 * - **The crease-pattern pane** has ℓ on every face it crosses, taken back to
 *   the sheet: one piece per face, a pinch through two layers being two
 *   places on the sheet. Any of them names a point of ℓ, since the engine
 *   projects a point's image onto ℓ.
 *
 * Tier 1 of D14's interaction cost: built once per located line and state,
 * then asked once a frame under a moving pointer. Pure: no React, no store,
 * no engine.
 */
import type { Point } from '../../lib/geometry';
import type { FoldModelLine, SheetPoint } from '../document/foldSequenceDocument';
import {
  alongLine,
  applyIsometry,
  chordOfConvex,
  insideConvex,
  invertIsometry,
  nearestOnSegment,
  pointOnLine,
  sideOf,
  toPair,
  transformLine,
} from './foldCanvasGeometry';
import {
  sheetToScene,
  topSheetPointAt,
  type FoldHitRadii,
  type FoldPaneId,
  type FoldPickIndex,
  type FoldPointPick,
  type FoldPointProvenance,
} from './foldPicking';

/** A point of ℓ a click snaps to, where the pane draws it, and the sheet point that names it. */
export interface FoldAlongTarget {
  /** In the pane's frame. */
  at: Point;
  provenance: FoldPointProvenance;
  sheet: SheetPoint;
  /** The Divide-line mark it is, when it is one. */
  mark: string | null;
}

/** ℓ on one pane: what of it lies on the paper, and the points of it a click snaps to. */
export interface FoldAlongLine {
  pane: FoldPaneId;
  /** The stretches of ℓ on the paper, in the pane's frame: across the folded form, or on each face of the sheet. */
  pieces: readonly (readonly [Point, Point])[];
  targets: readonly FoldAlongTarget[];
}

/** How far off ℓ, in sheet units, a point still lies on it. */
const ON_LINE = 1e-7;
/** Two targets closer than this are one: the first found names it. */
const SAME_POINT = 1e-7;
/** A stretch of ℓ shorter than this is no paper to click on. */
const MIN_PIECE = 1e-9;

/** Where the segment a–b crosses `line`, as the fraction along a–b; null when it runs along it or misses. */
function crossingFraction(line: FoldModelLine, a: Point, b: Point): number | null {
  const sa = sideOf(line, a);
  const sb = sideOf(line, b);
  if (Math.abs(sa) <= ON_LINE && Math.abs(sb) <= ON_LINE) return null;
  if ((sa > ON_LINE && sb > ON_LINE) || (sa < -ON_LINE && sb < -ON_LINE)) return null;
  const s = sa / (sa - sb);
  return s >= -1e-12 && s <= 1 + 1e-12 ? Math.min(1, Math.max(0, s)) : null;
}

const lerp = (a: Point, b: Point, s: number): Point => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });
const lerpSheet = (a: SheetPoint, b: SheetPoint, s: number): SheetPoint => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];

/** Where `x`, a point of the segment `at`, is along it, as a fraction. */
function fractionAlong(at: readonly [Point, Point], x: Point): number {
  const dx = at[1].x - at[0].x;
  const dy = at[1].y - at[0].y;
  const length2 = dx * dx + dy * dy;
  return length2 > 0 ? ((x.x - at[0].x) * dx + (x.y - at[0].y) * dy) / length2 : 0;
}

/** The targets, the first found of each place kept. */
function distinct(targets: readonly FoldAlongTarget[]): FoldAlongTarget[] {
  const kept: FoldAlongTarget[] = [];
  for (const target of targets) {
    if (kept.some((other) => Math.hypot(other.at.x - target.at.x, other.at.y - target.at.y) <= SAME_POINT)) continue;
    kept.push(target);
  }
  return kept;
}

/** The intervals of ℓ's parameter the convex polygons cover, merged where they touch. */
function coveredIntervals(polygons: readonly (readonly Point[])[], line: FoldModelLine): [number, number][] {
  const spans: [number, number][] = [];
  for (const polygon of polygons) {
    const chord = chordOfConvex(polygon as Point[], line);
    if (chord && chord[1] - chord[0] > MIN_PIECE) spans.push(chord);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of spans) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1] + ON_LINE) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/** ℓ on the folded pane: its stretches over the folded form and the points of it the viewer sees. */
function foldedAlong(index: FoldPickIndex, line: FoldModelLine): FoldAlongLine {
  const intervals = coveredIntervals(
    index.subfaces.map((subface) => subface.polygon),
    line
  );
  const pieces = intervals.map(([from, to]) => [pointOnLine(line, from), pointOnLine(line, to)] as const);
  const onPaper = (point: Point) => {
    const t = alongLine(line, point);
    return intervals.some(([from, to]) => t >= from - ON_LINE && t <= to + ON_LINE);
  };
  const found: FoldAlongTarget[] = [];
  const pane = index.folded;
  // The landmarks on ℓ: corners, crossings, marks and crease marks' ends it passes through, edges' middles.
  for (const point of pane.points) {
    const at = point.scene ?? point.at;
    if (Math.abs(sideOf(line, at)) > ON_LINE || !onPaper(at)) continue;
    found.push({ at, provenance: point.provenance, sheet: point.sheet, mark: point.mark });
  }
  // Where ℓ crosses a crease or an edge the viewer sees, named on that segment's layer.
  pane.segments.forEach((segment, k) => {
    for (const [a, b] of pane.portions[k] ?? []) {
      const s = crossingFraction(line, a, b);
      if (s === null) continue;
      const at = lerp(a, b, s);
      const u = fractionAlong(segment.scene, at);
      found.push({ at, provenance: 'crossing', sheet: lerpSheet(segment.sheet[0], segment.sheet[1], u), mark: null });
    }
  });
  // Where it crosses a crease mark the viewer sees.
  for (const part of pane.creaseMarks) {
    for (const [a, b] of part.portions) {
      const s = crossingFraction(line, a, b);
      if (s === null) continue;
      const at = lerp(a, b, s);
      const u = fractionAlong(part.at, at);
      found.push({ at, provenance: 'crease-mark-crossing', sheet: lerpSheet(part.sheet[0], part.sheet[1], u), mark: null });
    }
  }
  // Where it meets the paper's edge, and the middle of its stretch across the paper.
  const ends = pieces.flatMap(([a, b]) => [a, b]);
  const first = intervals[0];
  const last = intervals[intervals.length - 1];
  const middle = first && last ? pointOnLine(line, (first[0] + last[1]) / 2) : null;
  for (const [at, provenance] of [
    ...ends.map((end) => [end, 'crossing'] as const),
    ...(middle && onPaper(middle) ? [[middle, 'midpoint'] as const] : []),
  ]) {
    const sheet = topSheetPointAt(index, at);
    if (sheet) found.push({ at, provenance, sheet, mark: null });
  }
  return { pane: 'folded', pieces, targets: distinct(found) };
}

/** ℓ on the crease-pattern pane: its piece on each face it crosses, taken back to the sheet, and the points of each. */
function creasePatternAlong(index: FoldPickIndex, line: FoldModelLine): FoldAlongLine {
  const { scene } = index;
  const pieces: (readonly [Point, Point])[] = [];
  const found: FoldAlongTarget[] = [];
  const pane = index.creasePattern;
  // The middle of ℓ's stretch across the folded form: a point of ℓ on every layer under it.
  const across = coveredIntervals(
    index.subfaces.map((subface) => subface.polygon),
    line
  );
  const first = across[0];
  const last = across[across.length - 1];
  const middle = first && last ? pointOnLine(line, (first[0] + last[1]) / 2) : null;
  for (const [face, { points }] of scene.faces.entries()) {
    const transform = scene.face_transforms[face];
    const outline = points.map((vertex) => scene.sheet_points[vertex]);
    if (!transform || outline.some((corner) => corner === undefined)) continue;
    const polygon = outline as Point[];
    const back = invertIsometry(transform);
    const local = transformLine(back, line);
    const chord = chordOfConvex(polygon, local);
    if (!chord || chord[1] - chord[0] <= MIN_PIECE) continue;
    const a = pointOnLine(local, chord[0]);
    const b = pointOnLine(local, chord[1]);
    pieces.push([a, b]);
    const onPiece = (point: Point) => {
      const t = alongLine(local, point);
      return Math.abs(sideOf(local, point)) <= ON_LINE && t >= chord[0] - ON_LINE && t <= chord[1] + ON_LINE;
    };
    // The pattern's own points on it: vertices, crossings, marks, crease marks' ends and crossings, midpoints.
    for (const point of pane.points) {
      if (onPiece(point.at)) found.push({ at: point.at, provenance: point.provenance, sheet: point.sheet, mark: point.mark });
    }
    // Where it crosses a crease mark: inside a face, since a mark bounds none.
    for (const part of pane.creaseMarks) {
      const s = crossingFraction(local, part.at[0], part.at[1]);
      if (s === null) continue;
      const at = lerp(part.at[0], part.at[1], s);
      if (onPiece(at)) found.push({ at, provenance: 'crease-mark-crossing', sheet: toPair(at), mark: null });
    }
    // Its ends, on the face's outline: a crease or the paper's edge.
    for (const end of [a, b]) found.push({ at: end, provenance: 'crossing', sheet: toPair(end), mark: null });
    if (middle) {
      const at = applyIsometry(back, middle);
      if (insideConvex(polygon, at, ON_LINE)) found.push({ at, provenance: 'midpoint', sheet: toPair(at), mark: null });
    }
  }
  return { pane: 'crease-pattern', pieces, targets: distinct(found) };
}

/** ℓ, a line of the scene frame, on `pane` of the state `index` was made for. */
export function foldAlongLine(index: FoldPickIndex, line: FoldModelLine, pane: FoldPaneId): FoldAlongLine {
  return pane === 'folded' ? foldedAlong(index, line) : creasePatternAlong(index, line);
}

/**
 * What a click at `at` on the pane takes along ℓ: the target nearest the
 * point of ℓ under the pointer, or with `free` that point itself. Null off ℓ,
 * beyond the paper, or — not free — away from every target.
 */
export function resolveAlongPick(
  index: FoldPickIndex,
  along: FoldAlongLine,
  at: Point,
  radii: FoldHitRadii,
  free: boolean
): FoldPointPick | null {
  let projected: Point | null = null;
  let nearest = Infinity;
  for (const [a, b] of along.pieces) {
    const q = nearestOnSegment(at, a, b);
    const distance = Math.hypot(at.x - q.x, at.y - q.y);
    if (distance <= radii.line && distance < nearest) {
      nearest = distance;
      projected = q;
    }
  }
  if (!projected) return null;
  const onFolded = along.pane === 'folded';
  const sceneOf = (sheet: SheetPoint, drawn: Point) => (onFolded ? drawn : sheetToScene(index.scene, sheet));
  if (!free) {
    let best: FoldAlongTarget | null = null;
    let bestDistance = Infinity;
    for (const target of along.targets) {
      const distance = Math.hypot(target.at.x - projected.x, target.at.y - projected.y);
      if (distance <= radii.point && distance < bestDistance) {
        bestDistance = distance;
        best = target;
      }
    }
    if (!best) return null;
    return { kind: 'point', provenance: best.provenance, sheet: best.sheet, mark: best.mark, scene: sceneOf(best.sheet, best.at) };
  }
  const sheet = onFolded ? topSheetPointAt(index, projected) : toPair(projected);
  if (!sheet) return null;
  return { kind: 'point', provenance: 'free', sheet, mark: null, scene: sceneOf(sheet, projected) };
}
