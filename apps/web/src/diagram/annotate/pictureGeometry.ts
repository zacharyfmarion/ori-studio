/**
 * A step's picture as Annotate reads it for snapping and right-angle marks
 * (implementation-plans/diagram-annotate.md, 3 and 4): the points a mark can
 * land on and the lines that meet there, in picture units, indexed once per
 * picture object.
 *
 * What a picture offers depends on what it was drawn from:
 * - a crease-pattern capture: its lines' ends and the paper's rim, whose
 *   corners are the paper's and whose points along a side are where creases
 *   meet it; lines cross unsplit, so crossings are worked out near a point;
 * - a flat fold: every face's ring, corners covered by a layer over them
 *   included (the stored scene keeps whole faces and cannot say what shows),
 *   and each crease's whole ends where a cut left a piece of it;
 * - a 3D or simulated picture: its lines' whole ends, the projections of the
 *   model's vertices — its faces' rings are cut by the painter's tree, so
 *   their corners are not the paper's, and an angle drawn through a camera is
 *   not the paper's angle;
 * - a References step: its model's lines, marks and sheet, through the map
 *   that draws them, which mirrors on the back;
 * - an upload or a fixed picture: nothing — its marks are pixels or markup.
 *
 * Pure: no DOM, no store.
 */
import type { PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { distanceToSegment, LineHitIndex, type IndexedSegment } from '../../cp-workspace/picking/lineHitIndex';
import { sheetCorners } from '../../cp-workspace/references/stepDiagramGeometry';
import type {
  DiagramAsset,
  DiagramScenePicture,
  DiagramStep,
  DiagramStepDiagramPicture,
} from '../document/diagramDocument';
import { stepPictureSource } from '../pictures/paintDiagramStep';
import { stepDiagramToPicture } from '../pictures/paintStepDiagram';
import { storedScene } from '../pictures/pictureFrame';
import type { PicturePoint } from './annotationModel';

/** What a step's picture is, as far as its points and angles go. */
export type PictureGeometryKind = 'crease-pattern' | 'flat-fold' | 'projected' | 'step-diagram' | 'none';

/**
 * What a point of a picture is, for a preview to say: a References mark, a
 * corner of the paper, a vertex where lines meet, or the end of a line that
 * meets nothing there.
 */
export type PicturePointKind = 'point' | 'corner' | 'vertex' | 'end';

export interface PictureVertex {
  at: PicturePoint;
  kind: PicturePointKind;
}

export interface PictureGeometry {
  kind: PictureGeometryKind;
  /**
   * Whether an angle between its lines is drawn as it is on the paper: false
   * for a picture taken through a camera, where a right angle is not square.
   */
  trueAngles: boolean;
  /** Whether two of its lines crossing make a point: its lines are unsplit, so crossings are found near a point. */
  crossings: boolean;
  points: readonly PictureVertex[];
  /** Its lines and edges, each whole — a crease is one segment however many others cross it. */
  segments: readonly IndexedSegment[];
  /** `points` as zero-length segments, each `id` its index. */
  pointIndex: LineHitIndex;
  /** `segments`, each `id` its index. */
  segmentIndex: LineHitIndex;
}

/**
 * How near two points are to be one, in picture units. A stored scene keeps
 * its coordinates to 0.01 px of a sheet hundreds of px across, so one vertex
 * written by two faces can differ by a step of that (about 1e-5 of the
 * frame); five steps is still far under anything a pointer can tell apart.
 */
export const PICTURE_POINT_EPSILON = 5e-5;

/** Which kind a point keeps where two meet: a References mark names it, then the paper's corner. */
const KIND_RANK: Readonly<Record<PicturePointKind, number>> = { point: 3, corner: 2, vertex: 1, end: 0 };

/** A ring point the rim runs straight through (within half a degree) is on a side, not a corner. */
const STRAIGHT_SIN = Math.sin((0.5 * Math.PI) / 180);

const NO_GEOMETRY: PictureGeometry = {
  kind: 'none',
  trueAngles: true,
  crossings: false,
  points: [],
  segments: [],
  pointIndex: new LineHitIndex([]),
  segmentIndex: new LineHitIndex([]),
};

const scenes = new WeakMap<DiagramScenePicture, PictureGeometry>();
const stepDiagrams = new WeakMap<DiagramStepDiagramPicture, PictureGeometry>();

/**
 * A step's picture's geometry, worked out once per picture object — a
 * picture is never changed in place, so one worked out is right for as long
 * as anything holds it. Empty for a step with nothing to read.
 */
export function pictureGeometry(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>
): PictureGeometry {
  const source = stepPictureSource(step, assets);
  switch (source?.kind) {
    case 'scene': {
      const kind = sceneKind(step, source.picture);
      const cached = scenes.get(source.picture);
      // One picture is shown one way; asked another, it is read again rather than misread.
      if (cached?.kind === kind) return cached;
      const scene = storedScene(source.picture);
      const geometry = scene ? sceneGeometry(scene, kind) : { ...NO_GEOMETRY, kind };
      scenes.set(source.picture, geometry);
      return geometry;
    }
    case 'step-diagram': {
      const cached = stepDiagrams.get(source.picture);
      if (cached) return cached;
      const geometry = stepDiagramGeometry(source.picture);
      stepDiagrams.set(source.picture, geometry);
      return geometry;
    }
    case 'asset':
    case 'fixed':
    case undefined:
      return NO_GEOMETRY;
  }
}

/**
 * How a captured scene was drawn: by its linked pattern's render, or — for a
 * scene with no pattern to say — as its painter takes it, a crease pattern,
 * unless it has no paper scale, which only a picture taken through a camera
 * lacks.
 */
function sceneKind(step: DiagramStep, picture: DiagramScenePicture): 'crease-pattern' | 'flat-fold' | 'projected' {
  const { source } = step;
  if (source?.kind === 'cp') {
    switch (source.render.mode) {
      case 'crease-pattern':
        return 'crease-pattern';
      case 'folded-flat':
        return 'flat-fold';
      case 'folded-3d':
      case 'simulated':
        return 'projected';
    }
  }
  return picture.paperScale === null ? 'projected' : 'crease-pattern';
}

function sceneGeometry(scene: PaperScene, kind: 'crease-pattern' | 'flat-fold' | 'projected'): PictureGeometry {
  const { minX, minY, maxX, maxY } = scene.bounds;
  const longer = Math.max(maxX - minX, maxY - minY);
  if (!(longer > 0)) return { ...NO_GEOMETRY, kind };
  // Scene px to picture units: the frame is the scene's bounds (`stepPictureFrame`).
  const toPicture = ([x, y]: ScenePoint): PicturePoint => [(x - minX) / longer, (y - minY) / longer];
  const builder = new GeometryBuilder();
  for (const item of scene.items) {
    if (item.hidden) continue;
    if (item.kind === 'face') {
      // A camera's faces are cut by the painter's tree: their corners are not the paper's.
      if (kind === 'projected') continue;
      for (const ring of item.rings) builder.ring(ring.map(toPicture), kind === 'crease-pattern');
    } else if (item.kind === 'line') {
      // A piece cut where another layer covers it ends at the cut; its crease ends at its vertices.
      const { a, b } = item.whole ?? item;
      builder.line(toPicture(a), toPicture(b));
    }
  }
  return builder.build(kind, {
    trueAngles: kind !== 'projected',
    // The plan's v1: a crease pattern's crossings. A flat fold's whole faces
    // cross where one is buried under another, which the scene cannot tell.
    crossings: kind === 'crease-pattern',
  });
}

function stepDiagramGeometry({ model, mirrored }: DiagramStepDiagramPicture): PictureGeometry {
  const toPicture = stepDiagramToPicture(model, mirrored);
  const builder = new GeometryBuilder();
  builder.ring(sheetCorners(model.sheet).map(toPicture), true);
  for (const primitive of model.primitives) {
    switch (primitive.kind) {
      case 'line':
        // An arrow's shaft is a mark, not a line of the paper.
        if (primitive.style !== 'arrow') builder.line(toPicture(primitive.from), toPicture(primitive.to));
        break;
      case 'point':
        builder.point(toPicture(primitive.at), 'point');
        break;
      default:
        // Arcs, arrows, regions, glyphs and letters are marks on the paper, not of it.
        break;
    }
  }
  return builder.build('step-diagram', { trueAngles: true, crossings: true });
}

/** Points merged where they meet, and the segments between them. */
class GeometryBuilder {
  private readonly points: { at: PicturePoint; kind: PicturePointKind; ends: number }[] = [];
  private readonly cells = new Map<string, number[]>();
  private readonly segments: IndexedSegment[] = [];

  /** A closed ring: its sides, and its points — a rim's corners the paper's when `rim`. */
  ring(ring: readonly PicturePoint[], rim: boolean): void {
    const corners = ring.filter((at, index) => !samePoint(at, ring[(index + 1) % ring.length]!));
    const count = corners.length;
    for (let index = 0; index < count; index += 1) {
      const at = corners[index]!;
      const before = corners[(index + count - 1) % count]!;
      const after = corners[(index + 1) % count]!;
      this.point(at, rim && !runsStraight(before, at, after) ? 'corner' : 'vertex');
      if (count > 1) this.segment(at, after);
    }
  }

  line(a: PicturePoint, b: PicturePoint): void {
    if (samePoint(a, b)) return;
    this.segment(a, b);
    this.point(a, 'end', true);
    this.point(b, 'end', true);
  }

  point(at: PicturePoint, kind: PicturePointKind, end = false): void {
    const found = this.find(at);
    if (found) {
      if (KIND_RANK[kind] > KIND_RANK[found.kind]) found.kind = kind;
      if (end) found.ends += 1;
      return;
    }
    const key = cellKey(at, 0, 0);
    const bucket = this.cells.get(key) ?? [];
    bucket.push(this.points.length);
    this.cells.set(key, bucket);
    this.points.push({ at, kind, ends: end ? 1 : 0 });
  }

  build(
    kind: PictureGeometryKind,
    { trueAngles, crossings }: { trueAngles: boolean; crossings: boolean }
  ): PictureGeometry {
    const segmentIndex = new LineHitIndex(this.segments);
    const points = this.points.map(({ at, kind: pointKind, ends }): PictureVertex => {
      if (pointKind !== 'end') return { at, kind: pointKind };
      // A line's end is a vertex where another line ends or runs on through it.
      const met =
        ends > 1 ||
        segmentIndex
          .segmentsNear(at[0], at[1], PICTURE_POINT_EPSILON)
          .some((segment) => !isEndOf(segment, at));
      return { at, kind: met ? 'vertex' : 'end' };
    });
    const pointIndex = new LineHitIndex(
      points.map(({ at: [x, y] }, id) => ({ id, a: { x, y }, b: { x, y } }))
    );
    return { kind, trueAngles, crossings, points, segments: this.segments, pointIndex, segmentIndex };
  }

  private segment([ax, ay]: PicturePoint, [bx, by]: PicturePoint): void {
    this.segments.push({ id: this.segments.length, a: { x: ax, y: ay }, b: { x: bx, y: by } });
  }

  private find(at: PicturePoint): { at: PicturePoint; kind: PicturePointKind; ends: number } | null {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const index of this.cells.get(cellKey(at, dx, dy)) ?? []) {
          const point = this.points[index]!;
          if (samePoint(point.at, at)) return point;
        }
      }
    }
    return null;
  }
}

function cellKey([x, y]: PicturePoint, dx: number, dy: number): string {
  return `${Math.floor(x / PICTURE_POINT_EPSILON) + dx},${Math.floor(y / PICTURE_POINT_EPSILON) + dy}`;
}

export function samePoint(a: PicturePoint, b: PicturePoint): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= PICTURE_POINT_EPSILON;
}

function isEndOf(segment: IndexedSegment, at: PicturePoint): boolean {
  return samePoint([segment.a.x, segment.a.y], at) || samePoint([segment.b.x, segment.b.y], at);
}

/** Whether a ring goes straight on at `at`, rather than turning a corner. */
function runsStraight(before: PicturePoint, at: PicturePoint, after: PicturePoint): boolean {
  const inX = at[0] - before[0];
  const inY = at[1] - before[1];
  const outX = after[0] - at[0];
  const outY = after[1] - at[1];
  const lengths = Math.hypot(inX, inY) * Math.hypot(outX, outY);
  if (!(lengths > 0)) return false;
  return Math.abs(inX * outY - inY * outX) <= STRAIGHT_SIN * lengths && inX * outX + inY * outY > 0;
}

/**
 * Where two segments cross, away from all four ends — an end on the other
 * segment is already a point of its own — or null where they do not, or run
 * parallel.
 */
export function segmentCrossing(first: IndexedSegment, second: IndexedSegment): PicturePoint | null {
  const rx = first.b.x - first.a.x;
  const ry = first.b.y - first.a.y;
  const sx = second.b.x - second.a.x;
  const sy = second.b.y - second.a.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= 1e-12 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return null;
  const qx = second.a.x - first.a.x;
  const qy = second.a.y - first.a.y;
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  const at: PicturePoint = [first.a.x + t * rx, first.a.y + t * ry];
  if (isEndOf(first, at) || isEndOf(second, at)) return null;
  return at;
}

/** Shortest distance from a point to a segment, in picture units. */
export function distanceTo([x, y]: PicturePoint, segment: IndexedSegment): number {
  return distanceToSegment(x, y, segment.a, segment.b);
}

/**
 * How many of the lines nearest a point are paired for crossings. Any
 * crossing nearer than the farthest of them is on two of them, so the
 * nearest crossings are exact; past that, a picture seen whole at a far zoom
 * would otherwise pair thousands of creases on one move.
 */
const CROSSING_LINES = 64;

/**
 * Crossings within `reach` of a point: of the picture's own lines where it
 * has them ({@link PictureGeometry.crossings}), and of `drawn` — lines drawn
 * on it — with each other and with the picture's, which cross on the page
 * whatever the picture is.
 */
export function crossingsNear(
  geometry: PictureGeometry,
  drawn: readonly IndexedSegment[],
  at: PicturePoint,
  reach: number
): PicturePoint[] {
  const near: { segment: IndexedSegment; drawn: boolean; distance: number }[] = [];
  for (const segment of drawn) {
    const distance = distanceTo(at, segment);
    if (distance <= reach) near.push({ segment, drawn: true, distance });
  }
  if (geometry.crossings || near.length > 0) {
    for (const segment of geometry.segmentIndex.segmentsNear(at[0], at[1], reach)) {
      near.push({ segment, drawn: false, distance: distanceTo(at, segment) });
    }
  }
  if (near.length < 2) return [];
  near.sort((left, right) => left.distance - right.distance);
  const paired = near.slice(0, CROSSING_LINES);
  const found: PicturePoint[] = [];
  paired.forEach((first, i) => {
    for (const second of paired.slice(i + 1)) {
      if (!first.drawn && !second.drawn && !geometry.crossings) continue;
      const crossing = segmentCrossing(first.segment, second.segment);
      if (crossing && Math.hypot(crossing[0] - at[0], crossing[1] - at[1]) <= reach) found.push(crossing);
    }
  });
  return found;
}
