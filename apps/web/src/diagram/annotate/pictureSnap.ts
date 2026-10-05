/**
 * Where a mark put down near a point lands (implementation-plans/
 * diagram-annotate.md, 3; Q9): the nearest point of the picture within the
 * snap radius — a vertex, a line's end, a corner of the paper, a References
 * mark, a crossing of two lines — or of the step's other annotations, so an
 * arrow lands on a circle and a line meets a line. Nothing within the radius
 * leaves the mark where it was put.
 *
 * The radius comes in picture units: the canvas turns Edit's snap setting
 * (Q10) into them at its zoom, as it does its hit reach.
 *
 * Pure: no DOM, no store.
 */
import type { IndexedSegment } from '../../cp-workspace/picking/lineHitIndex';
import {
  isKnownAnnotation,
  type DiagramAnnotation,
  type DiagramAsset,
  type DiagramStep,
  type DiagramStyle,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import type { PicturePoint } from './annotationModel';
import {
  crossingsNear,
  pictureGeometry,
  PICTURE_POINT_EPSILON,
  type PicturePointKind,
} from './pictureGeometry';

/** What a snap landed on, for its preview to show. */
export type SnapTargetKind = PicturePointKind | 'crossing' | 'annotation';

export interface SnapTarget {
  at: PicturePoint;
  kind: SnapTargetKind;
}

export interface SnapOptions {
  /** The step's annotations as the canvas holds them now; the step's own when left out. */
  annotations?: readonly DiagramAnnotation[];
  /** An annotation never snapped to: the one being drawn or dragged, which would find itself. */
  ignore?: string;
  /** The diagram's style, which says whether the picture's aux lines are drawn; all are read without one. */
  style?: DiagramStyle;
}

/**
 * Which kind a target is reported as where two lie on one point: the
 * picture's own before a crossing worked out from it, and both before an
 * annotation, which was most likely snapped there in the first place.
 */
const TARGET_RANK: Readonly<Record<SnapTargetKind, number>> = {
  point: 5,
  corner: 4,
  vertex: 3,
  end: 2,
  crossing: 1,
  annotation: 0,
};

/**
 * The point near `point` a mark snaps to within `radius`, both in picture
 * units; null when nothing is that near.
 */
export function pictureSnapTarget(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  point: PicturePoint,
  radius: number,
  options: SnapOptions = {}
): SnapTarget | null {
  if (!(radius > 0)) return null;
  const geometry = pictureGeometry(step, assets, options.style);
  const annotations = annotationsOf(step, options);
  const candidates: SnapTarget[] = [];
  const vertex = geometry.points[geometry.pointIndex.query(point[0], point[1], radius)];
  if (vertex) candidates.push(vertex);
  for (const annotation of annotations) {
    for (const at of annotationSnapPoints(annotation)) candidates.push({ at, kind: 'annotation' });
  }
  for (const at of crossingsNear(geometry, drawnLines(annotations), point, radius)) {
    candidates.push({ at, kind: 'crossing' });
  }

  let best: SnapTarget | null = null;
  let bestDistance = radius;
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.at[0] - point[0], candidate.at[1] - point[1]);
    if (distance > radius) continue;
    // Two targets on one point are one: the better kind of it is reported.
    const tie = best !== null && Math.abs(distance - bestDistance) <= PICTURE_POINT_EPSILON;
    if (best === null || (tie ? TARGET_RANK[candidate.kind] > TARGET_RANK[best.kind] : distance < bestDistance)) {
      // A copy: what the caller does with it never reaches the picture's cache.
      best = { at: [candidate.at[0], candidate.at[1]], kind: candidate.kind };
      bestDistance = distance;
    }
  }
  return best;
}

/** The known annotations a snap reads, less the one it is ignoring. */
export function annotationsOf(step: DiagramStep, { annotations, ignore }: SnapOptions): KnownDiagramAnnotation[] {
  return (annotations ?? step.annotations).filter(
    (annotation): annotation is KnownDiagramAnnotation =>
      isKnownAnnotation(annotation) && annotation.id !== ignore
  );
}

/**
 * The points of an annotation another snaps to (Q9): an arrow's or a line's
 * two ends, where a line meets another, a circle's centre, which an arrow
 * lands on, and the corner a right angle marks.
 */
export function annotationSnapPoints(annotation: KnownDiagramAnnotation): readonly PicturePoint[] {
  switch (annotation.kind) {
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'push-arrow':
    case 'white-arrow':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
      return [annotation.from, annotation.to];
    case 'circle':
    case 'right-angle':
      return [annotation.from];
    case 'turn-over':
    case 'rotate':
    case 'label':
      // A sign or a letter is put beside what it names, never on it.
      return [];
    default: {
      // Every kind says what it offers: a new one is a compile error here.
      const _unsaid: never = annotation.kind;
      return [];
    }
  }
}

/**
 * The lines drawn on a picture by its annotations, which meet and cross as
 * its own lines do — on any picture, an upload's included.
 */
export function drawnLines(annotations: readonly KnownDiagramAnnotation[]): IndexedSegment[] {
  const lines: IndexedSegment[] = [];
  for (const annotation of annotations) {
    switch (annotation.kind) {
      case 'valley-line':
      case 'mountain-line':
      case 'hidden-line': {
        const [ax, ay] = annotation.from;
        const [bx, by] = annotation.to;
        lines.push({ id: lines.length, a: { x: ax, y: ay }, b: { x: bx, y: by } });
        break;
      }
      default:
        break;
    }
  }
  return lines;
}
