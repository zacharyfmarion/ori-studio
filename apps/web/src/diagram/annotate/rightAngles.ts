/**
 * Right-angle corners in a step's picture (implementation-plans/
 * diagram-annotate.md, 4; Q12): where two lines leaving a vertex meet at 90°,
 * for a right-angle mark to be put in with one click.
 *
 * A corner is made of **rays**, not lines: a crease that ends at a vertex
 * leaves it one way, one that runs on through it leaves it two. The rays at a
 * vertex cut the plane round it into sectors, and a sector is a right angle
 * when its two rays are 90° apart (±1°) with no ray between them — so a box
 * pleat's eight-way vertex has none, and a paper corner's reflex side, 270°
 * of it, is never one. Which sector is meant is the one the pointer is in, as
 * seen from the vertex nearest it; too near the vertex to tell, it is none.
 *
 * A picture taken through a camera (3D, simulated) offers no right angles of
 * its own: a right angle on the paper is not drawn square there. Lines drawn
 * on any picture by its annotations do, since they are drawn on the page.
 *
 * Pure: no DOM, no store.
 */
import type { IndexedSegment } from '../../cp-workspace/picking/lineHitIndex';
import type { DiagramAsset, DiagramStep } from '../document/diagramDocument';
import type { PicturePoint } from './annotationModel';
import {
  crossingsNear,
  distanceTo,
  pictureGeometry,
  PICTURE_POINT_EPSILON,
  type PictureGeometry,
} from './pictureGeometry';
import { annotationsOf, drawnLines, type SnapOptions } from './pictureSnap';

export interface RightAngleCorner {
  /** The vertex. */
  at: PicturePoint;
  /**
   * The two rays' unit directions, in the order the angle sweeps from one to
   * the other: clockwise on the page (picture units are y down).
   */
  legs: [PicturePoint, PicturePoint];
  /** The unit direction halfway between them, into the angle: where a mark's `to` lies. */
  diagonal: PicturePoint;
}

/** How far from square a right angle may be drawn, in degrees. */
export const RIGHT_ANGLE_TOLERANCE_DEG = 1;

/**
 * Rays this close in direction are one: a crease drawn over an edge, or the
 * same ring side of a stack of layers, a stored step's rounding apart.
 */
const SAME_RAY_DEG = 0.5;

/**
 * How far a ray must reach from its vertex to be one: a line ending a step's
 * rounding off the vertex, which the search for lines there also finds, ends
 * there rather than leaving it the short way.
 */
const RAY_MIN_LENGTH = 4 * PICTURE_POINT_EPSILON;

/** The share of the radius round a vertex where the pointer says nothing about which way. */
const DEAD_ZONE_SHARE = 0.25;

const DEGREE = Math.PI / 180;
const TURN = 2 * Math.PI;

/**
 * The right angle the pointer is in at the vertex nearest it within
 * `radius`, both in picture units; null when that vertex has none there, the
 * pointer is within `deadZone` of it (a quarter of the radius when left out),
 * or no vertex is that near.
 */
export function rightAngleCorner(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  point: PicturePoint,
  radius: number,
  options: SnapOptions & { deadZone?: number } = {}
): RightAngleCorner | null {
  if (!(radius > 0)) return null;
  const geometry = pictureGeometry(step, assets);
  const drawn = drawnLines(annotationsOf(step, options));
  const vertex = nearestVertex(geometry, drawn, point, radius);
  if (!vertex) return null;
  const dx = point[0] - vertex[0];
  const dy = point[1] - vertex[1];
  if (Math.hypot(dx, dy) <= (options.deadZone ?? radius * DEAD_ZONE_SHARE)) return null;
  const rays = raysAt(geometry, drawn, vertex);
  if (rays.length < 2) return null;
  const pointing = angleOf(dx, dy);
  // The sector the pointer is in begins at the last ray at or before it, going round.
  const after = rays.findIndex((ray) => ray > pointing);
  const start = after <= 0 ? rays.length - 1 : after - 1;
  return cornerOf(vertex, rays[start]!, rays[(start + 1) % rays.length]!);
}

/** Every right angle with its corner at `at`, in the order its sectors go round. */
export function rightAnglesAt(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  at: PicturePoint,
  options: SnapOptions = {}
): RightAngleCorner[] {
  const geometry = pictureGeometry(step, assets);
  const rays = raysAt(geometry, drawnLines(annotationsOf(step, options)), at);
  if (rays.length < 2) return [];
  const corners: RightAngleCorner[] = [];
  rays.forEach((ray, index) => {
    const corner = cornerOf(at, ray, rays[(index + 1) % rays.length]!);
    if (corner) corners.push(corner);
  });
  return corners;
}

/**
 * The vertex nearest a point within `radius`: a point of the picture where
 * its angles are true, an end of a drawn line, or a crossing.
 */
function nearestVertex(
  geometry: PictureGeometry,
  drawn: readonly IndexedSegment[],
  point: PicturePoint,
  radius: number
): PicturePoint | null {
  const candidates: PicturePoint[] = [];
  if (geometry.trueAngles) {
    const vertex = geometry.points[geometry.pointIndex.query(point[0], point[1], radius)];
    if (vertex) candidates.push(vertex.at);
  }
  for (const { a, b } of drawn) candidates.push([a.x, a.y], [b.x, b.y]);
  candidates.push(...crossingsNear(geometry, drawn, point, radius));
  let best: PicturePoint | null = null;
  let bestDistance = radius;
  for (const at of candidates) {
    const distance = Math.hypot(at[0] - point[0], at[1] - point[1]);
    if (distance <= bestDistance) {
      best = [at[0], at[1]];
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The directions of the rays leaving `at`, as angles in [0, 2π) going round,
 * one per direction: from each line ending there, one; from each running on
 * through it, two.
 */
function raysAt(geometry: PictureGeometry, drawn: readonly IndexedSegment[], at: PicturePoint): number[] {
  const lines = drawn.filter((segment) => distanceTo(at, segment) <= PICTURE_POINT_EPSILON);
  if (geometry.trueAngles) lines.push(...geometry.segmentIndex.segmentsNear(at[0], at[1], PICTURE_POINT_EPSILON));
  const angles: number[] = [];
  for (const { a, b } of lines) {
    // An end this near is the line's end at the vertex, not a way out of it.
    if (Math.hypot(a.x - at[0], a.y - at[1]) > RAY_MIN_LENGTH) angles.push(angleOf(a.x - at[0], a.y - at[1]));
    if (Math.hypot(b.x - at[0], b.y - at[1]) > RAY_MIN_LENGTH) angles.push(angleOf(b.x - at[0], b.y - at[1]));
  }
  angles.sort((left, right) => left - right);
  const rays: number[] = [];
  for (const angle of angles) {
    const last = rays[rays.length - 1];
    if (last === undefined || angle - last > SAME_RAY_DEG * DEGREE) rays.push(angle);
  }
  // Round the turn: the last ray and the first may be one.
  if (rays.length > 1 && rays[0]! + TURN - rays[rays.length - 1]! <= SAME_RAY_DEG * DEGREE) rays.pop();
  return rays;
}

/** The corner from the ray at `from` round to the one at `to`, when that is a right angle. */
function cornerOf(at: PicturePoint, from: number, to: number): RightAngleCorner | null {
  const sweep = (((to - from) % TURN) + TURN) % TURN;
  if (Math.abs(sweep - Math.PI / 2) > RIGHT_ANGLE_TOLERANCE_DEG * DEGREE) return null;
  const middle = from + sweep / 2;
  return {
    at,
    legs: [
      [Math.cos(from), Math.sin(from)],
      [Math.cos(to), Math.sin(to)],
    ],
    diagonal: [Math.cos(middle), Math.sin(middle)],
  };
}

/** A direction's angle in [0, 2π), y down: clockwise on the page from the +x axis. */
function angleOf(dx: number, dy: number): number {
  const angle = Math.atan2(dy, dx);
  return angle < 0 ? angle + TURN : angle;
}
