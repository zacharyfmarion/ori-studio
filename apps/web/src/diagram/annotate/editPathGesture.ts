/**
 * What Edit Path's drags do to a fold arrow (decision 3), as data: a node
 * moved, a handle turned, a segment bent — each by how far the pointer has
 * travelled from where it took hold, with Shift and Alt as Affinity has them.
 * The canvas previews one on every move and commits the same once, as it
 * lands (`useAnnotateCanvas`).
 *
 * Pure: no DOM, no store, no React.
 */
import { cubicPoint } from '../../lib/cubicBezier';
import type { DiagramArrowShapeGesture } from '../../analytics/events';
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import type { PathGripPart } from './annotationHit';
import { pathCubics, type PicturePoint } from './annotationModel';
import {
  bendPathSegment,
  constrainHandleAngle,
  constrainToEighths,
  movePathHandle,
  movePathNode,
  pathNodesOf,
  setPathNodeType,
} from './annotationPath';

/** The keys held as a drag moves. */
export interface PathModifiers {
  /** A node along 0°, 45° or 90° from where it was; a handle in 15° steps about its node. */
  shift: boolean;
  /** A smooth node's handle dragged alone: the node made a corner. */
  alt: boolean;
}

/**
 * Where the part a press took hold of is: a node, a handle, or the point on
 * the curve at `t`. A drag moves it by the pointer's travel, so a press a
 * little off it does not make it jump to the pointer. Null when the arrow
 * has no such part.
 */
export function pathGripAnchor(annotation: KnownDiagramAnnotation, grip: PathGripPart): PicturePoint | null {
  const nodes = pathNodesOf(annotation);
  if (!nodes) return null;
  switch (grip.part) {
    case 'node':
      return nodes[grip.node]?.at ?? null;
    case 'handle':
      return nodes[grip.node]?.[grip.side] ?? null;
    case 'segment': {
      const cubic = pathCubics(nodes)[grip.segment];
      if (!cubic) return null;
      const [x, y] = cubicPoint(cubic, grip.t);
      return [x, y];
    }
  }
}

/**
 * The arrow a drag makes of `annotation`: the part at `anchor` moved by
 * `travel`.
 * - A node goes with its handles; Shift keeps it to the eight directions
 *   45° apart from where it started.
 * - A handle goes where it is dragged: a smooth node's other handle turns to
 *   stay in line, keeping its own length; with Alt the node is made a corner
 *   first, and the other stays put. Shift turns it in 15° steps about its
 *   node, its length the drag's.
 * - The curve bends so the point taken hold of follows the pointer.
 */
export function dragPath(
  annotation: KnownDiagramAnnotation,
  grip: PathGripPart,
  anchor: PicturePoint,
  travel: PicturePoint,
  modifiers: PathModifiers
): KnownDiagramAnnotation {
  switch (grip.part) {
    case 'node': {
      const [dx, dy] = modifiers.shift ? constrainToEighths(travel) : travel;
      return movePathNode(annotation, grip.node, [anchor[0] + dx, anchor[1] + dy]);
    }
    case 'handle': {
      const node = pathNodesOf(annotation)?.[grip.node]?.at;
      if (!node) return annotation;
      const dragged: PicturePoint = [anchor[0] + travel[0], anchor[1] + travel[1]];
      const point = modifiers.shift ? constrainHandleAngle(node, dragged) : dragged;
      const base = modifiers.alt ? setPathNodeType(annotation, grip.node, 'corner') : annotation;
      return movePathHandle(base, grip.node, grip.side, point);
    }
    case 'segment':
      return bendPathSegment(annotation, grip.segment, grip.t, [anchor[0] + travel[0], anchor[1] + travel[1]]);
  }
}

/** A drag's undo step, and the gesture it counts as when it shapes an arc for the first time. */
export function pathDragEdit(grip: PathGripPart): { label: string; gesture: DiagramArrowShapeGesture } {
  switch (grip.part) {
    case 'node':
      return { label: 'Move node', gesture: 'drag_node' };
    case 'handle':
      return { label: 'Move handle', gesture: 'drag_handle' };
    case 'segment':
      return { label: 'Bend curve', gesture: 'bend' };
  }
}
