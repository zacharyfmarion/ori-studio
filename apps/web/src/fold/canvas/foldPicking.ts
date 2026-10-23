/**
 * Picking and snapping on Fold's own geometry (plan D13), for both panes.
 *
 * Everything here is tier 1 of D14's interaction cost: asked once a frame
 * under a moving pointer, on the main thread, from data cached per state —
 * the scene's subfaces and creases and the engine's landmarks, each indexed
 * once ({@link foldPickIndex}) — never a call to the engine.
 *
 * - **The folded pane** picks in the scene frame. The topmost face and the
 *   stack under the pointer come from the scene's subfaces (the overlay's
 *   cells, every face over each, top first). Points snap to the engine's
 *   point landmarks — corners, crease crossings and marks, with the sheet
 *   point that names each — and to the midpoints of its segment landmarks;
 *   lines to the segment landmarks' visible parts. A landmark nothing shows
 *   is not there to click. Where several layers' points lie together, a
 *   click takes the one on the paper on top there.
 * - **The crease-pattern pane** picks in sheet coordinates: the crease
 *   pattern's vertices and marks, the crease marks' ends and crossings, and
 *   its creases by Fold's edge ids, in a `LineHitIndex` over the scene's
 *   `creases[]`.
 * - **A spread folded pane** (`FoldPaneSpreadMap`) is picked where it is
 *   drawn: each target indexed where the spread puts it — a point once per
 *   sheet point the viewer sees there, since points that lie together on
 *   the folded paper part when it is spread — and a free point read off the
 *   face drawn on top. A pick still carries where it lies unspread, which is
 *   what a step stores and what the paper lies flat on once picking starts.
 *
 * A pick carries what a step stores — sheet points, an edge's sheet ends —
 * and where to draw it on both panes. Not `nearestCpSnapTarget` (Edit's
 * Oriedita parity) and not the Diagram's picture snap, which recovers points
 * without provenance.
 *
 * Pure: no React, no store, no engine.
 */
import { LineHitIndex, type IndexedSegment } from '../../cp-workspace/picking/lineHitIndex';
import type { Point } from '../../lib/geometry';
import type { FoldRef, SheetPoint } from '../document/foldSequenceDocument';
import type { FoldIsometry, FoldLandmarks, FoldPointSource, FoldScene, FoldSegmentLandmark } from '../engine/foldEngineWire';
import {
  applyIsometry,
  boundsOf,
  insideConvex,
  invertIsometry,
  toPair,
  toPoint,
  type Bounds,
} from './foldCanvasGeometry';
import type { FoldStepSnap } from '../tools/foldToolRegistry';
import type { FoldPaneSpreadMap } from './foldPaneSpreadMap';

/** Which pane a pick was made on. */
export type FoldPaneId = 'folded' | 'crease-pattern';

/**
 * Where a point lands: a landmark's kind — a crease mark's end, or where one
 * crosses a crease or another mark, among them — an edge's middle, or a free
 * point (Alt).
 */
export type FoldPointProvenance =
  | 'vertex'
  | 'crossing'
  | 'mark'
  | 'crease-mark-end'
  | 'crease-mark-crossing'
  | 'midpoint'
  | 'free'
  /** A point on a folded edge between its landmarks: where a swivel's creases may meet ({@link resolveFoldEdgePoint}). */
  | 'fold';

/** A point reference: what an axiom input stores, and where it is drawn. */
export interface FoldPointPick {
  kind: 'point';
  /** Where it was picked. Omitted by programmatic references; never saved. */
  pane?: FoldPaneId;
  provenance: FoldPointProvenance;
  /** The sheet point that names it: what a step stores. */
  sheet: SheetPoint;
  /** The Divide-line mark it is, when it is one: its id rides along for the sentence. */
  mark: string | null;
  /** Where it is in the folded pane's scene frame; null when it is on no face (cannot be). */
  scene: Point | null;
  /**
   * The folded edge it lies on, strictly between that crease's ends, when a
   * swivel's first click took it there: its creases meet on that edge
   * ({@link resolveFoldEdgePoint}). Absent for every other point.
   */
  fold?: FoldSegmentPick;
  /** The exact meeting point was chosen, rather than a fold on which the engine locates it. */
  foldLocation?: 'given';
}

/** A line reference: an edge, a fold or a crease, by its sheet ends. */
export interface FoldSegmentPick {
  kind: 'segment';
  /** Where it was picked, when a tool asks (Repeat's drawn axis); omitted otherwise, never saved. */
  pane?: FoldPaneId;
  /** Fold's edge id; negative local pick identity for a crease mark. */
  edge: number;
  /** A flat line beside the face graph, stored by its sheet stretch. */
  creaseMark?: true;
  /** A raw edge of the paper, a fold (a bend of the folded form), or a flat crease. */
  segment: FoldSegmentLandmark['kind'];
  sheet: readonly [SheetPoint, SheetPoint];
  /** Its image in the folded pane's scene frame. */
  scene: readonly [Point, Point];
}

/** A point clicked as it is: a free line's end. */
export interface FoldFreePick {
  kind: 'free';
  /** The pane it was clicked on. */
  pane: FoldPaneId;
  /** Where it is in the folded pane's scene frame: the line runs through it there. */
  scene: Point;
  /**
   * The sheet point under it: where it was clicked on the crease-pattern
   * pane, the top face's point on the folded pane; null off the paper, where
   * a free line's end may lie.
   */
  sheet: SheetPoint | null;
}

export type FoldPick = FoldPointPick | FoldSegmentPick | FoldFreePick;

/** What a pointer is over on a pane: the raw point, and what a click there would take. */
export interface FoldHit {
  pane: FoldPaneId;
  /** In the pane's own frame: the scene frame on the folded pane, sheet coordinates on the other. */
  at: Point;
  /** Null for bare paper, or nothing a click would take. */
  pick: FoldPick | null;
  /**
   * On the folded pane while a woven section is shown: the interval of it
   * under the pointer, whose stack the layer picker shows (`wovenIntervalAt`).
   */
  interval?: number;
  /** With Repeat in hand: the symmetry axis under the pointer, by its index among the verified ones (`repeatAxisAt`). */
  repeatAxis?: number;
}

/**
 * The same thing under the pointer as a frame ago: by identity, or for a free
 * pick by position. Bare paper is the same hit wherever on it the pointer is,
 * over the same interval of a woven section: nothing drawn follows it there
 * (a click reads the point afresh), so a move across it re-renders nothing, as
 * a move along one crease does not.
 */
export function sameFoldHit(a: FoldHit, b: FoldHit): boolean {
  if (a.pane !== b.pane || a.repeatAxis !== b.repeatAxis) return false;
  if (a.pick === null || b.pick === null) return a.pick === b.pick && a.interval === b.interval;
  return samePick(a.pick, b.pick);
}

export function samePick(a: FoldPick, b: FoldPick): boolean {
  if (a.kind === 'segment') return b.kind === 'segment' && a.edge === b.edge;
  if (a.kind === 'point') {
    return b.kind === 'point' && a.sheet[0] === b.sheet[0] && a.sheet[1] === b.sheet[1] &&
      a.provenance === b.provenance && a.foldLocation === b.foldLocation && a.pane === b.pane;
  }
  return (
    b.kind === 'free' &&
    a.pane === b.pane &&
    a.scene.x === b.scene.x &&
    a.scene.y === b.scene.y &&
    a.sheet?.[0] === b.sheet?.[0] &&
    a.sheet?.[1] === b.sheet?.[1]
  );
}

/** A pick as an axiom input (plan D6): a sheet point, a mark's resolved point, or an edge by its ends. */
export function pickRef(pick: FoldPointPick | FoldSegmentPick): FoldRef {
  if (pick.kind === 'segment') return { kind: 'edge', a: pick.sheet[0], b: pick.sheet[1] };
  return pick.mark !== null ? { kind: 'mark', at: pick.sheet, mark: pick.mark } : { kind: 'point', at: pick.sheet };
}

// ---------------------------------------------------------------------------
// The index

/** A Divide-line mark's points, as the landmark query took them, with the mark each came from. */
export interface FoldMarkPoint {
  at: SheetPoint;
  mark: string;
}

interface IndexedSubface {
  polygon: Point[];
  box: Bounds;
  stack: readonly number[];
}

interface PointCandidate {
  provenance: FoldPointProvenance;
  sheet: SheetPoint;
  mark: string | null;
  /** Where a click finds it: in the pane's frame, as the pane draws it. */
  at: Point;
  /** Where it lies in the scene frame, unspread, when the folded pane draws it elsewhere. */
  scene?: Point;
}

/** One pane's targets, indexed. */
interface PaneIndex {
  points: PointCandidate[];
  pointHits: LineHitIndex;
  segments: FoldSegmentPick[];
  /** Per segment, the stretches of it the pane shows (where a click finds it): what a line crossing it meets. */
  portions: readonly (readonly [Point, Point][])[];
  /** By indexed id − 1: the segment each indexed portion belongs to. */
  portionOf: number[];
  segmentHits: LineHitIndex;
  /**
   * The crease marks, each part of one on a face (the folded pane's, as the
   * viewer sees it) with the stretches the pane shows: not a line a fold can
   * be located along, but what a partial precrease's points snap to where
   * its line crosses one.
   */
  creaseMarks: readonly FoldCreaseMarkPart[];
}

/** A crease mark's part on one face: its sheet ends, its ends in the pane's frame, and what the pane shows of it. */
export interface FoldCreaseMarkPart {
  sheet: readonly [SheetPoint, SheetPoint];
  at: readonly [Point, Point];
  portions: readonly [Point, Point][];
}

export interface FoldPickIndex {
  scene: FoldScene;
  /** Model frame → scene, and back. */
  toScene: (model: Point) => Point;
  toModel: (scene: Point) => Point;
  subfaces: IndexedSubface[];
  folded: PaneIndex;
  creasePattern: PaneIndex;
  /** How the folded pane draws the paper when its layers are spread; null when it draws the scene as it is. */
  spread: FoldPaneSpreadMap | null;
}

const POINT_PRIORITY: Readonly<Record<FoldPointSource['kind'], FoldPointProvenance>> = {
  vertex: 'vertex',
  crossing: 'crossing',
  mark: 'mark',
  crease_mark_end: 'crease-mark-end',
  crease_mark_crossing: 'crease-mark-crossing',
};

function pointIndex(points: readonly PointCandidate[]): LineHitIndex {
  return new LineHitIndex(points.map((point, k): IndexedSegment => ({ id: k + 1, a: point.at, b: point.at })));
}

/** The visible stretches of a segment landmark — or a crease mark's part — along it from `a` (its `at[0]`) to `b`. */
function visiblePortions(segment: Pick<FoldSegmentLandmark, 'visible'>, a: Point, b: Point): [Point, Point][] {
  const at = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return segment.visible.flatMap(([from, to]) => (to - from > 1e-9 ? [[at(from), at(to)] as [Point, Point]] : []));
}

/** Each segment's portions, indexed: `portionOf` says which segment an indexed id is part of. */
function segmentIndex(portions: readonly [Point, Point][][]): { hits: LineHitIndex; portionOf: number[] } {
  const indexed: IndexedSegment[] = [];
  const portionOf: number[] = [];
  portions.forEach((list, segment) => {
    for (const [a, b] of list) {
      // Every portion its own id: the index skips an id it has seen, so two
      // portions sharing one would hide the nearer behind the first found.
      indexed.push({ id: indexed.length + 1, a, b });
      portionOf.push(segment);
    }
  });
  return { hits: new LineHitIndex(indexed), portionOf };
}

/**
 * Where a sheet point is in the scene frame: through the transform of a face
 * whose sheet outline holds it. A point on a crease is on two faces, whose
 * transforms agree there.
 */
export function sheetToScene(scene: FoldScene, sheet: SheetPoint, epsilon = 1e-7): Point | null {
  const face = sheetFaceAt(scene, sheet, epsilon);
  const transform = face === null ? undefined : scene.face_transforms[face];
  return transform ? applyIsometry(transform, toPoint(sheet)) : null;
}

/** The first face whose paper holds a sheet point, with a transform to place it by; null off the sheet. */
export function sheetFaceAt(scene: FoldScene, sheet: SheetPoint, epsilon = 1e-7): number | null {
  const p = toPoint(sheet);
  for (const [face, { points }] of scene.faces.entries()) {
    const outline = points.map((vertex) => scene.sheet_points[vertex]);
    if (outline.some((corner) => corner === undefined)) continue;
    if (!insideConvex(outline as Point[], p, epsilon)) continue;
    if (scene.face_transforms[face]) return face;
  }
  return null;
}

/** The faces over a point of the scene, top first; empty off the paper. */
function stackAt(subfaces: readonly IndexedSubface[], p: Point, epsilon = 0): readonly number[] {
  for (const subface of subfaces) {
    const { box } = subface;
    if (p.x < box.minX - epsilon || p.x > box.maxX + epsilon || p.y < box.minY - epsilon || p.y > box.maxY + epsilon) {
      continue;
    }
    if (insideConvex(subface.polygon, p, epsilon)) return subface.stack;
  }
  return [];
}

/** Two drawn points the pane cannot tell apart: one target, the first named. */
const SAME_DRAWN = 1e-9;

/** Two sheet points that name the same paper. */
const SAME_SHEET = 1e-7;

/**
 * The folded pane's point targets for one landmark: where the viewer sees it,
 * one per sheet point the viewer sees there, the first the viewer sees first
 * (vertices first, then crossings, then marks: the engine's order). Folded,
 * they lie together, and {@link onTopAtEachSpot} keeps the one on the paper on
 * top. Spread, each is a target of its own where the spread draws it — a
 * corner of one layer and a crease of another, together on the folded paper,
 * are apart on the spread picture.
 */
function landmarkTargets(
  landmark: NonNullable<FoldLandmarks['points']>[number],
  at: Point,
  marks: readonly FoldMarkPoint[],
  spread: FoldPaneSpreadMap | null
): PointCandidate[] {
  const candidate = (source: FoldPointSource): PointCandidate => ({
    provenance: POINT_PRIORITY[source.kind],
    sheet: source.sheet,
    mark: source.kind === 'mark' ? (marks[source.mark]?.mark ?? null) : null,
    at,
  });
  const first = landmark.sources.find((each) => each.visible) ?? landmark.sources[0];
  if (!first) return [];
  const seen = [first, ...landmark.sources.filter((each) => each.visible && each !== first)];
  const targets: PointCandidate[] = [];
  for (const source of seen) {
    if (!spread) {
      if (!targets.some((target) => sameSheet(target.sheet, source.sheet))) targets.push(candidate(source));
      continue;
    }
    const drawn = spread.sheet(source.sheet) ?? at;
    if (targets.some((target) => Math.hypot(target.at.x - drawn.x, target.at.y - drawn.y) <= SAME_DRAWN)) continue;
    targets.push({ ...candidate(source), at: drawn, scene: at });
  }
  return targets;
}

function sameSheet(a: SheetPoint, b: SheetPoint): boolean {
  return Math.abs(a[0] - b[0]) <= SAME_SHEET && Math.abs(a[1] - b[1]) <= SAME_SHEET;
}

/**
 * The folded pane's point targets with one kept at each spot: of the sheet
 * points that lie together there — a corner of the flap on top and the
 * layer under it showing past that corner, say — the one on the paper the
 * viewer sees on top, by the stacks of the cells around the spot: one is
 * above another where a cell holds both and lists its face first. Where no
 * cell holds both, the earlier stays (the engine's order, then the edges'
 * middles). The spread pane parts such points, so it never asks this.
 */
function onTopAtEachSpot(points: readonly PointCandidate[], scene: FoldScene, subfaces: readonly IndexedSubface[]): PointCandidate[] {
  const spots = new Map<string, number[]>();
  points.forEach((point, k) => {
    const key = `${Math.round(point.at.x / SAME_SHEET)},${Math.round(point.at.y / SAME_SHEET)}`;
    const spot = spots.get(key);
    if (spot) spot.push(k);
    else spots.set(key, [k]);
  });
  const paper = paperOf(scene, subfaces);
  const kept: PointCandidate[] = [];
  for (const spot of spots.values()) {
    const here = spot.map((k) => points[k]!);
    const [first] = here;
    if (!first) continue;
    if (here.every((point) => sameSheet(point.sheet, first.sheet))) {
      kept.push(...here);
      continue;
    }
    const top = paper.at(first.at).order(here.map((point) => point.sheet))[0] ?? 0;
    const sheet = here[top]!.sheet;
    kept.push(...here.filter((point) => sameSheet(point.sheet, sheet)));
  }
  return kept;
}

/** How the paper stacks at a spot of the folded scene: which of its sheet points lie there, and which lies above which. */
interface PaperAtSpot {
  /** Every sheet point the paper has there, one per layer, as the cells around the spot list their faces. */
  sheets: () => SheetPoint[];
  /**
   * Indices into `sheets`, the paper on top first: one is above another
   * where a cell around the spot holds both and lists its face first. Where
   * no cell holds both, the earlier comes first.
   */
  order: (sheets: readonly SheetPoint[]) => number[];
}

/** The scene's paper, asked about spot by spot ({@link PaperAtSpot}), each face's inverse taken once. */
function paperOf(scene: FoldScene, subfaces: readonly IndexedSubface[]): { at: (at: Point) => PaperAtSpot } {
  const inverses: (FoldIsometry | null)[] = [];
  // The face's sheet point at a spot of the scene: one of its corners exactly, where it is one.
  const sheetOf = (face: number, at: Point): SheetPoint | null => {
    if (inverses[face] === undefined) {
      const transform = scene.face_transforms[face];
      inverses[face] = transform ? invertIsometry(transform) : null;
    }
    const back = inverses[face];
    if (!back) return null;
    const sheet = toPair(applyIsometry(back, at));
    for (const vertex of scene.faces[face]?.points ?? []) {
      const corner = scene.sheet_points[vertex];
      if (corner && sameSheet(toPair(corner), sheet)) return toPair(corner);
    }
    return sheet;
  };
  return {
    at: (at) => {
      const cells = subfaces.filter(
        ({ box, polygon }) =>
          at.x >= box.minX - SAME_SHEET &&
          at.x <= box.maxX + SAME_SHEET &&
          at.y >= box.minY - SAME_SHEET &&
          at.y <= box.maxY + SAME_SHEET &&
          insideConvex(polygon, at, SAME_SHEET)
      );
      return {
        sheets: () => {
          const sheets: SheetPoint[] = [];
          for (const { stack } of cells) {
            for (const face of stack) {
              const sheet = sheetOf(face, at);
              if (sheet && !sheets.some((each) => sameSheet(each, sheet))) sheets.push(sheet);
            }
          }
          return sheets;
        },
        order: (sheets) => {
          // Per sheet point, per cell: how deep its paper lies in the cell's stack, top 0; Infinity where the cell does not hold it.
          const depths = sheets.map((point) =>
            cells.map(({ stack }) => {
              const k = stack.findIndex((face) => {
                const sheet = sheetOf(face, at);
                return sheet !== null && sameSheet(sheet, point);
              });
              return k < 0 ? Infinity : k;
            })
          );
          const above = (a: number, b: number) =>
            cells.some((_, cell) => depths[a]![cell]! < depths[b]![cell]! && depths[b]![cell]! < Infinity);
          const left = sheets.map((_, k) => k);
          const order: number[] = [];
          while (left.length > 0) {
            let top = 0;
            for (let k = 1; k < left.length; k += 1) {
              if (above(left[k]!, left[top]!) && !above(left[top]!, left[k]!)) top = k;
            }
            order.push(...left.splice(top, 1));
          }
          return order;
        },
      };
    },
  };
}

/**
 * Every other sheet point that lies where `sheet` does on the folded paper,
 * the paper on top there first: what a point a step refused as staying put
 * can be swapped for, the same spot on another layer. Empty off the paper.
 */
export function sheetPointsTogether(index: FoldPickIndex, sheet: SheetPoint): SheetPoint[] {
  const at = sheetToScene(index.scene, sheet);
  if (!at) return [];
  const spot = paperOf(index.scene, index.subfaces).at(at);
  const sheets = spot.sheets();
  return spot
    .order(sheets)
    .map((k) => sheets[k]!)
    .filter((each) => !sameSheet(each, sheet));
}

/**
 * Index a state's targets, once per scene and landmarks: what every pointer
 * move over either pane reads. With `spread`, the folded pane's targets are
 * indexed where the spread draws them (see the module notes).
 */
export function foldPickIndex(
  scene: FoldScene,
  landmarks: FoldLandmarks | null,
  marks: readonly FoldMarkPoint[],
  spread: FoldPaneSpreadMap | null = null
): FoldPickIndex {
  const view = scene.view_transform;
  const back = invertIsometry(view);
  const toScene = (model: Point) => applyIsometry(view, model);
  const toModel = (point: Point) => applyIsometry(back, point);
  const subfaces = scene.subfaces.map(({ polygon, faces_top_to_bottom }) => ({
    polygon: polygon.map((p) => ({ x: p.x, y: p.y })),
    box: boundsOf(polygon) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    stack: faces_top_to_bottom,
  }));

  // --- The folded pane: the engine's landmarks, as the viewer sees them.
  const foldedPoints: PointCandidate[] = [];
  for (const landmark of landmarks?.points ?? []) {
    if (!landmark.visible) continue;
    foldedPoints.push(...landmarkTargets(landmark, toScene(toPoint(landmark.at)), marks, spread));
  }
  const foldedSegments: FoldSegmentPick[] = [];
  const foldedPortions: [Point, Point][][] = [];
  for (const segment of landmarks?.segments ?? []) {
    const a = toScene(toPoint(segment.at[0]));
    const b = toScene(toPoint(segment.at[1]));
    const sheet: [SheetPoint, SheetPoint] = [segment.sheet.a, segment.sheet.b];
    // Found where the pane draws it: the segment where the spread puts its ends.
    const [p, q] = spread ? spread.segment(sheet, [a, b]) : [a, b];
    const portions = visiblePortions(segment, p, q);
    if (portions.length === 0) continue;
    foldedSegments.push({ kind: 'segment', edge: segment.edge, segment: segment.kind, sheet, scene: [a, b] });
    foldedPortions.push(portions);
    // An edge's middle, where the viewer sees it: a landmark the engine's
    // points do not list, named by the sheet point half way along.
    if (segment.visible.some(([from, to]) => from <= 0.5 && to >= 0.5)) {
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      foldedPoints.push({
        provenance: 'midpoint',
        sheet: [(segment.sheet.a[0] + segment.sheet.b[0]) / 2, (segment.sheet.a[1] + segment.sheet.b[1]) / 2],
        mark: null,
        ...(spread ? { at: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, scene: middle } : { at: middle }),
      });
    }
  }
  const foldedMarks: FoldCreaseMarkPart[] = [];
  for (const part of landmarks?.crease_marks ?? []) {
    const a = toScene(toPoint(part.at[0]));
    const b = toScene(toPoint(part.at[1]));
    const sheet: [SheetPoint, SheetPoint] = [part.sheet.a, part.sheet.b];
    const [p, q] = spread ? spread.segment(sheet, [a, b]) : [a, b];
    const portions = visiblePortions(part, p, q);
    if (portions.length > 0) {
      foldedMarks.push({ sheet, at: [p, q], portions });
      foldedSegments.push({ kind: 'segment', edge: -foldedMarks.length, creaseMark: true, segment: 'crease', sheet, scene: [a, b] });
      foldedPortions.push(portions);
    }
  }
  const folded = segmentIndex(foldedPortions);
  const foldedTargets = spread ? foldedPoints : onTopAtEachSpot(foldedPoints, scene, subfaces);

  // --- The crease-pattern pane: the sheet, every crease and vertex on it.
  const cpPoints: PointCandidate[] = [];
  const seenVertex = new Set<number>();
  const cpSegments: FoldSegmentPick[] = [];
  const cpPortions: [Point, Point][][] = [];
  for (const crease of scene.creases) {
    for (const [k, vertex] of crease.vertices.entries()) {
      if (seenVertex.has(vertex)) continue;
      seenVertex.add(vertex);
      const at = k === 0 ? crease.from : crease.to;
      cpPoints.push({ provenance: 'vertex', sheet: toPair(at), mark: null, at: { x: at.x, y: at.y } });
    }
    const sheet: [SheetPoint, SheetPoint] = [toPair(crease.from), toPair(crease.to)];
    const a = sheetToScene(scene, sheet[0]);
    const b = sheetToScene(scene, sheet[1]);
    if (!a || !b) continue;
    cpSegments.push({
      kind: 'segment',
      edge: crease.id,
      segment: crease.kind === 'border' ? 'raw_edge' : crease.kind === 'fold' ? 'bend' : 'crease',
      sheet,
      scene: [a, b],
    });
    cpPortions.push([[crease.from, crease.to]]);
    cpPoints.push({
      provenance: 'midpoint',
      sheet: [(sheet[0][0] + sheet[1][0]) / 2, (sheet[0][1] + sheet[1][1]) / 2],
      mark: null,
      at: { x: (crease.from.x + crease.to.x) / 2, y: (crease.from.y + crease.to.y) / 2 },
    });
  }
  for (const mark of marks) {
    cpPoints.push({ provenance: 'mark', sheet: mark.at, mark: mark.mark, at: toPoint(mark.at) });
  }
  // The crease marks: each one whole on the sheet, its ends and where it
  // crosses a crease or another mark points to snap to, hidden or not — the
  // crease pattern shows every layer.
  const cpMarks: FoldCreaseMarkPart[] = (scene.crease_marks ?? []).map((mark) => {
    const at: [Point, Point] = [
      { x: mark.from.x, y: mark.from.y },
      { x: mark.to.x, y: mark.to.y },
    ];
    return { sheet: [toPair(mark.from), toPair(mark.to)], at, portions: [at] };
  });
  // Pick the stretch carried by one face. A mark can bend across several
  // faces, so its full sheet segment does not necessarily locate one line.
  let markPick = 0;
  for (const mark of scene.crease_marks ?? []) {
    for (const piece of mark.pieces) {
      const transform = scene.face_transforms[piece.face];
      if (!transform) continue;
      const inverse = invertIsometry(transform);
      const sheet: [SheetPoint, SheetPoint] = [toPair(applyIsometry(inverse, piece.from)), toPair(applyIsometry(inverse, piece.to))];
      const [a, b] = [piece.from, piece.to];
      cpSegments.push({ kind: 'segment', edge: --markPick, creaseMark: true, segment: 'crease', sheet, scene: [a, b] });
      cpPortions.push([[toPoint(sheet[0]), toPoint(sheet[1])]]);
    }
  }
  const seenMarkPoint = new Set<string>();
  for (const landmark of landmarks?.points ?? []) {
    for (const source of landmark.sources) {
      if (source.kind !== 'crease_mark_end' && source.kind !== 'crease_mark_crossing') continue;
      const key = `${source.sheet[0]},${source.sheet[1]}`;
      if (seenMarkPoint.has(key)) continue;
      seenMarkPoint.add(key);
      cpPoints.push({ provenance: POINT_PRIORITY[source.kind], sheet: source.sheet, mark: null, at: toPoint(source.sheet) });
    }
  }
  const cp = segmentIndex(cpPortions);

  return {
    scene,
    toScene,
    toModel,
    subfaces,
    folded: {
      points: foldedTargets,
      pointHits: pointIndex(foldedTargets),
      segments: foldedSegments,
      portions: foldedPortions,
      portionOf: folded.portionOf,
      segmentHits: folded.hits,
      creaseMarks: foldedMarks,
    },
    creasePattern: {
      points: cpPoints,
      pointHits: pointIndex(cpPoints),
      segments: cpSegments,
      portions: cpPortions,
      portionOf: cp.portionOf,
      segmentHits: cp.hits,
      creaseMarks: cpMarks,
    },
    spread,
  };
}

// ---------------------------------------------------------------------------
// Queries

/** The faces under a point of the folded pane, top first: the topmost face is the first. */
export function foldStackAt(index: FoldPickIndex, scene: Point): readonly number[] {
  return stackAt(index.subfaces, scene);
}

/**
 * The sheet point of the top face under a point of the folded pane: where a
 * free point on the paper, a mark made by a pick or a depth seed is anchored.
 * Null off the paper.
 */
export function topSheetPointAt(index: FoldPickIndex, scene: Point): SheetPoint | null {
  const top = stackAt(index.subfaces, scene, 1e-9)[0];
  if (top === undefined) return null;
  const transform = index.scene.face_transforms[top];
  if (!transform) return null;
  return toPair(applyIsometry(invertIsometry(transform), scene));
}

/** Hit radii, in the pane's frame. */
export interface FoldHitRadii {
  point: number;
  line: number;
}

function pointPick(index: FoldPickIndex, onFolded: boolean, candidate: PointCandidate): FoldPointPick {
  return {
    kind: 'point',
    pane: onFolded ? 'folded' : 'crease-pattern',
    provenance: candidate.provenance,
    sheet: candidate.sheet,
    mark: candidate.mark,
    scene: onFolded ? (candidate.scene ?? candidate.at) : sheetToScene(index.scene, candidate.sheet),
  };
}

/**
 * The paper under a point of the folded pane as the pane draws it: where it
 * lies in the scene frame, and the sheet point it is — the face on top
 * there, read back through the spread when the pane draws one. Null off the
 * paper.
 */
function paperUnder(index: FoldPickIndex, at: Point): { scene: Point; sheet: SheetPoint } | null {
  if (index.spread) return index.spread.under(at);
  const sheet = topSheetPointAt(index, at);
  return sheet ? { scene: at, sheet } : null;
}

/** How a click resolves (`resolveFoldPick`): its step's snap, and what a line click may take. */
export interface FoldPickRule {
  snap: FoldStepSnap;
  /** Snap a free-line endpoint to point targets, with raw-click fallback. */
  snapFree?: boolean;
  /** Whether a line click takes the paper's raw edge, or only folds and creases. */
  edges: boolean;
  /** Alt held, or its latch: any point of the paper. */
  free: boolean;
  /** The kinds of line a line click takes, in place of `edges`: a petal fold's hinge is a precrease, a swivel's edge no flat crease. */
  kinds?: readonly FoldSegmentPick['segment'][];
  /** A line click's own test of each line in reach: a swivel's target is never parallel to its edge. */
  accept?: (segment: FoldSegmentPick) => boolean;
}

/**
 * What a click at `at` on `pane` takes for a click that snaps by `snap`:
 * the nearest point landmark, or with `free` held any point of the paper; the
 * nearest line (a fold or a crease only, unless `edges`; only `kinds`, when
 * given, and only one `accept` takes); or the point itself.
 */
export function resolveFoldPick(
  index: FoldPickIndex,
  pane: FoldPaneId,
  at: Point,
  radii: FoldHitRadii,
  { snap, snapFree, edges, free, kinds, accept }: FoldPickRule
): FoldPick | null {
  const onFolded = pane === 'folded';
  const targets = onFolded ? index.folded : index.creasePattern;
  switch (snap) {
    case 'free': {
      if (snapFree && !free) {
        const hit = targets.pointHits.query(at.x, at.y, radii.point);
        const candidate = hit > 0 ? targets.points[hit - 1] : undefined;
        if (candidate) {
          const snapped = pointPick(index, onFolded, candidate);
          if (snapped.scene) return { kind: 'free', pane, scene: snapped.scene, sheet: snapped.sheet };
        }
      }
      if (onFolded) {
        // Off the paper a free line's end lies where it is clicked: no spread reaches there.
        const under = paperUnder(index, at);
        return { kind: 'free', pane, scene: under?.scene ?? at, sheet: under?.sheet ?? null };
      }
      const sheet = toPair(at);
      const scene = sheetToScene(index.scene, sheet);
      return scene ? { kind: 'free', pane, scene, sheet } : null;
    }
    case 'point':
    case 'crease':
    case 'candidate': {
      if (free) {
        // Alt (or its latch): the point under the pointer, on the paper.
        if (onFolded) {
          const under = paperUnder(index, at);
          return under ? { kind: 'point', pane, provenance: 'free', sheet: under.sheet, mark: null, scene: under.scene } : null;
        }
        const sheet = insideSheet(index, at);
        return sheet ? { kind: 'point', pane, provenance: 'free', sheet, mark: null, scene: sheetToScene(index.scene, sheet) } : null;
      }
      const hit = targets.pointHits.query(at.x, at.y, radii.point);
      const candidate = hit > 0 ? targets.points[hit - 1] : undefined;
      return candidate ? pointPick(index, onFolded, candidate) : null;
    }
    case 'crease-required': {
      const hits = targets.segmentHits.segmentsNear(at.x, at.y, radii.line);
      let best: FoldSegmentPick | null = null;
      let bestDistance = Infinity;
      for (const portion of hits) {
        const segment = targets.segments[targets.portionOf[portion.id - 1] ?? -1];
        if (!segment) continue;
        if (kinds ? !kinds.includes(segment.segment) : !edges && segment.segment === 'raw_edge') continue;
        if (accept && !accept(segment)) continue;
        const distance = distanceToSegment(at, portion.a, portion.b);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = segment;
        }
      }
      return best;
    }
  }
}

/** How far inside a folded crease's ends a point on it is kept: the engine takes one strictly inside. */
const FOLD_END_MARGIN = 1e-3;

/** Whether a sheet point lies on a segment's sheet stretch, strictly inside its ends. */
function insideSheetSegment([a, b]: readonly [SheetPoint, SheetPoint], p: SheetPoint): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return false;
  const off = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / length;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (length * length);
  return off <= 1e-7 && t > FOLD_END_MARGIN && t < 1 - FOLD_END_MARGIN;
}

/**
 * A swivel's first click near a folded edge (a bend): the creases may meet
 * on it, where the line halfway between the edge that moves and its target
 * crosses it. A point landmark in reach that lies on a folded edge, strictly
 * between its crease's ends, says so (`fold`); with none in reach, the point
 * of the nearest folded edge under the pointer, kept inside its crease's
 * ends (provenance `fold`). `point` is what the click would take otherwise
 * (`resolveFoldPick`): returned as it is when it is no point on a folded
 * edge, and when no folded edge is in reach. With the free-point key held
 * the canvas asks with no `point`: a folded edge in reach still takes the
 * click, and only off one does the key put a pivot anywhere.
 */
export function resolveFoldEdgePoint(
  index: FoldPickIndex,
  pane: FoldPaneId,
  at: Point,
  radii: FoldHitRadii,
  point: FoldPick | null,
  locateMeetingPoint = false
): FoldPick | null {
  const onFolded = pane === 'folded';
  const targets = onFolded ? index.folded : index.creasePattern;
  const bends = targets.segments.filter((segment) => segment.segment === 'bend');
  if (point?.kind === 'point') {
    const fold = bends.find((segment) => insideSheetSegment(segment.sheet, point.sheet));
    if (fold) return { ...point, fold, ...(locateMeetingPoint ? { foldLocation: 'given' as const } : {}) };
    // A located hinge can use a reference on another layer. Preserve its
    // exact image, but anchor the operation to the folded edge's material.
    // Only an exact coincidence qualifies; the hit radius must not shift
    // a snapped landmark to a nearby fold.
    if (locateMeetingPoint && onFolded && point.scene) {
      for (const segment of bends) {
        const [a, b] = segment.scene;
        const dx = b.x - a.x, dy = b.y - a.y;
        const length2 = dx * dx + dy * dy;
        if (length2 <= 0 || distanceToSegment(point.scene, a, b) > 1e-8) continue;
        const t = ((point.scene.x - a.x) * dx + (point.scene.y - a.y) * dy) / length2;
        if (t <= FOLD_END_MARGIN || t >= 1 - FOLD_END_MARGIN) continue;
        const [p, q] = segment.sheet;
        return {
          ...point,
          provenance: 'fold',
          sheet: [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])],
          mark: null,
          fold: segment,
          foldLocation: 'given',
        };
      }
    }
    return point;
  }
  if (point) return point;
  let best: { segment: FoldSegmentPick; distance: number } | null = null;
  for (const portion of targets.segmentHits.segmentsNear(at.x, at.y, radii.line)) {
    const segment = targets.segments[targets.portionOf[portion.id - 1] ?? -1];
    if (segment?.segment !== 'bend') continue;
    const distance = distanceToSegment(at, portion.a, portion.b);
    if (!best || distance < best.distance) best = { segment, distance };
  }
  if (!best) return null;
  const { segment } = best;
  // Where the pane draws it: the scene, or under a spread where the spread
  // puts its ends; on the crease-pattern pane, the sheet.
  const [p, q] = onFolded
    ? index.spread
      ? index.spread.segment(segment.sheet, segment.scene)
      : segment.scene
    : [toPoint(segment.sheet[0]), toPoint(segment.sheet[1])];
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const length2 = dx * dx + dy * dy;
  if (!(length2 > 0)) return null;
  const raw = ((at.x - p.x) * dx + (at.y - p.y) * dy) / length2;
  const t = Math.min(1 - FOLD_END_MARGIN * 2, Math.max(FOLD_END_MARGIN * 2, raw));
  const [a, b] = segment.sheet;
  const sheet: SheetPoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const [s, e] = segment.scene;
  const scene = { x: s.x + (e.x - s.x) * t, y: s.y + (e.y - s.y) * t };
  return { kind: 'point', pane, provenance: 'fold', sheet, mark: null, scene, fold: segment,
    ...(locateMeetingPoint ? { foldLocation: 'given' as const } : {}) };
}

/** A sheet point on the crease-pattern pane, when it is on the sheet. */
function insideSheet(index: FoldPickIndex, at: Point): SheetPoint | null {
  return sheetToScene(index.scene, toPair(at)) ? toPair(at) : null;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
