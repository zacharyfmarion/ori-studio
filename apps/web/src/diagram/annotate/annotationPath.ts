/**
 * A fold arrow or a white arrow shaped by hand (Edit Path, decision 3): the
 * edits its nodes, handles and segments take, as data.
 *
 * A fold arrow never shaped is an exact arc (`bend`, decision 2). The first
 * edit makes it a path that draws the same curve ({@link arcToPath}), and
 * Reset makes it an arc again ({@link resetPath}). A white arrow is always a
 * path, laid straight, and Reset lays it straight again. Every edit takes the
 * arrow, arc or path, and returns it edited, every point within reach; node
 * and segment numbers count along the path as {@link pathNodesOf} gives it,
 * tail first. A kind that is not shaped (a push, a line, a sign) comes back
 * as it was.
 *
 * Pure: no DOM, no store, no React.
 */
import { cubicPoint, flattenPath, nearestOnPath, pathChordArea, splitCubic } from '../../lib/cubicBezier';
import type { DiagramPathNode, KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  ARROW_BEND,
  MAX_PATH_NODES,
  MIN_ANNOTATION_LENGTH,
  arrowApex,
  arrowShape,
  canBeShaped,
  cleanPath,
  defaultBend,
  handleWithinReach,
  isAlwaysPath,
  isStraightPath,
  movePathNodeTo,
  pathCubics,
  straightPath,
  withPath,
  withinReach,
  type PictureFrame,
  type PicturePoint,
} from './annotationModel';
import { perAnnotation } from './perAnnotation';

const plus = (a: PicturePoint, b: PicturePoint): PicturePoint => [a[0] + b[0], a[1] + b[1]];
const minus = (a: PicturePoint, b: PicturePoint): PicturePoint => [a[0] - b[0], a[1] - b[1]];
const times = (a: PicturePoint, k: number): PicturePoint => [a[0] * k, a[1] * k];
const size = (a: PicturePoint) => Math.hypot(a[0], a[1]);

/** Shorter than this, in picture units, a handle lies on its node and has no direction. */
const ON_NODE = 1e-9;

/**
 * The nodes Edit Path shows for an arrow: its path, or its arc's as the
 * first edit would make it one. Null for a kind that is not shaped. Worked
 * out once per annotation object: the canvas, its hit test and the store's
 * check of the selected node all ask for the same arrow's.
 */
export const pathNodesOf = perAnnotation((annotation): readonly DiagramPathNode[] | null => {
  if (!canBeShaped(annotation.kind)) return null;
  return arcToPath(annotation).path ?? null;
});

/**
 * What an arrow is made of, as Edit Path holds it: whether it is a path yet
 * and how many nodes it shows. A drag, or a selected node, is taken against
 * one; an edit that lands under it and changes either (an undo, Reset, a
 * node added or taken out) leaves it meaning another node, so it is let go.
 */
export interface PathRepresentation {
  shaped: boolean;
  nodes: number;
}

export function pathRepresentation(annotation: KnownDiagramAnnotation): PathRepresentation | null {
  const nodes = pathNodesOf(annotation);
  return nodes && { shaped: annotation.path !== undefined, nodes: nodes.length };
}

export function sameRepresentation(a: PathRepresentation | null, b: PathRepresentation | null): boolean {
  return a !== null && b !== null && a.shaped === b.shaped && a.nodes === b.nodes;
}

/** One handle Edit Path shows: whose node, which side, and where it is. */
export interface PathHandle {
  node: number;
  side: 'in' | 'out';
  at: PicturePoint;
}

/**
 * The handles Edit Path shows with `node` selected (Affinity): the node's
 * own two, and the one of each neighbour that faces it — the four that shape
 * the curve on either side of it. None with no node selected. A handle that
 * lies on its node has no direction to take hold of, and is not shown.
 */
export function visiblePathHandles(path: readonly DiagramPathNode[], node: number | null): PathHandle[] {
  if (node === null || !path[node]) return [];
  const shown: PathHandle[] = [];
  const add = (index: number, side: 'in' | 'out') => {
    const owner = path[index];
    const at = owner?.[side];
    if (owner && at && size(minus(at, owner.at)) > ON_NODE) shown.push({ node: index, side, at });
  };
  add(node - 1, 'out');
  add(node, 'in');
  add(node, 'out');
  add(node + 1, 'in');
  return shown;
}

/**
 * A drag kept to the nearest of the eight directions 45° apart (Shift on a
 * node): its length along that direction, so the press stays under the
 * pointer as nearly as the line allows.
 */
export function constrainToEighths(delta: PicturePoint): PicturePoint {
  const length = size(delta);
  if (!(length > ON_NODE)) return [0, 0];
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(delta[1], delta[0]) / step) * step;
  const unit: PicturePoint = [Math.cos(angle), Math.sin(angle)];
  return times(unit, Math.max(0, delta[0] * unit[0] + delta[1] * unit[1]));
}

/** A handle turned to the nearest 15° about its node (Shift on a handle), its length kept. */
export function constrainHandleAngle(node: PicturePoint, handle: PicturePoint): PicturePoint {
  const arm = minus(handle, node);
  const length = size(arm);
  if (!(length > ON_NODE)) return handle;
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(arm[1], arm[0]) / step) * step;
  return [node[0] + Math.cos(angle) * length, node[1] + Math.sin(angle) * length];
}

/**
 * The arc an arrow was drawn with, as a path that draws it: the sweep
 * θ = 4·atan(2|bend|) cut into ⌈θ / 90°⌉ equal cubics, each node's handles
 * along the circle's tangent, (4/3)·tan(θ / 4n)·r long — within a micron of
 * the arc on a 15 mm arrow at its default bend, and a few on a half circle.
 * Every node smooth, the ends exactly the arrow's. The arrow as it was when
 * it is already a path, or not a fold arrow.
 */
export function arcToPath(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  if (!canBeShaped(annotation.kind)) return annotation;
  const shape = arrowShape(annotation);
  if (shape.kind === 'path') return annotation;
  // A white arrow has no arc: one without its path is the straight one it was laid as.
  if (isAlwaysPath(annotation.kind)) return withPath(annotation, straightPath(annotation.from, annotation.to));
  const nodes = arcNodes(annotation.from, annotation.to, shape.bend);
  return withPath(annotation, cleanPath(nodes) ?? nodes);
}

function arcNodes(from: PicturePoint, to: PicturePoint, bend: number): DiagramPathNode[] {
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const sweep = 4 * Math.atan(2 * Math.abs(bend));
  if (!(chord > ON_NODE) || !(sweep > 1e-9)) return [{ at: [...from] }, { at: [...to] }];
  const pieces = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9));
  const radius = chord / (2 * Math.sin(sweep / 2));
  // The centre is a radius from the arc's top, through the chord's middle.
  const apex = arrowApex(from, to, bend);
  const middle: PicturePoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const inward = minus(middle, apex);
  const centre = plus(apex, times(inward, radius / (size(inward) || 1)));
  const start = Math.atan2(from[1] - centre[1], from[0] - centre[0]);
  // Which way round from the tail passes over the top.
  const toTail = minus(from, centre);
  const toApex = minus(apex, centre);
  const turn = Math.sign(toTail[0] * toApex[1] - toTail[1] * toApex[0]) || 1;
  const step = sweep / pieces;
  const handle = (4 / 3) * Math.tan(step / 4) * radius;
  const nodes: DiagramPathNode[] = [];
  for (let index = 0; index <= pieces; index += 1) {
    const angle = start + turn * step * index;
    // The ends exactly the arrow's, not the circle's rounding of them.
    const onCircle: PicturePoint = [centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)];
    const at: PicturePoint = index === 0 ? [...from] : index === pieces ? [...to] : onCircle;
    const tangent: PicturePoint = [-Math.sin(angle) * turn, Math.cos(angle) * turn];
    nodes.push({
      at,
      ...(index > 0 ? { in: minus(at, times(tangent, handle)) } : {}),
      ...(index < pieces ? { out: plus(at, times(tangent, handle)) } : {}),
    });
  }
  return nodes;
}

/**
 * A shaped arrow made an arc again (Reset): References' 60° arc between its
 * ends, bulging the side the path lies on of its chord — toward the frame's
 * middle, as a new arrow does, for a path that lies on neither. A white
 * arrow, which has no arc, is laid straight between its ends again. One whose
 * ends lie closer than the shortest arrow (a loop) has no arc to go back to
 * that could be drawn or pressed, and stays.
 */
export function resetPath(annotation: KnownDiagramAnnotation, frame: PictureFrame): KnownDiagramAnnotation {
  const { path, ...arc } = annotation;
  if (!path || !canResetPath(annotation)) return annotation;
  const { from, to } = annotation;
  if (isAlwaysPath(annotation.kind)) return withPath(annotation, straightPath(from, to));
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const area = pathChordArea(flattenPath(pathCubics(path), chord * 1e-4));
  // A path on the left of its travel as the page shows it bulges as a positive bend does (`arrowApex`).
  const bend = Math.abs(area) > 1e-6 * chord * chord ? Math.sign(area) * ARROW_BEND : defaultBend(from, to, frame);
  return { ...arc, bend };
}

/**
 * Whether {@link resetPath} has an arc to go back to: a shaped arrow whose
 * ends lie apart — a white arrow's, one not straight already.
 */
export function canResetPath(annotation: KnownDiagramAnnotation): boolean {
  const { from, to, path } = annotation;
  if (path === undefined || Math.hypot(to[0] - from[0], to[1] - from[1]) < MIN_ANNOTATION_LENGTH) return false;
  return !isAlwaysPath(annotation.kind) || !isStraightPath(path);
}

/** The arrow shaped, its nodes edited by `edit`; the arrow as it was when `edit` gives null. */
function shaped(
  annotation: KnownDiagramAnnotation,
  edit: (nodes: readonly DiagramPathNode[]) => DiagramPathNode[] | null
): KnownDiagramAnnotation {
  const path = pathNodesOf(annotation);
  if (!path) return annotation;
  const edited = edit(path);
  if (!edited) return annotation;
  return withPath(annotation, cleanPath(edited) ?? edited);
}

/** A node put at `point`, its handles with it (as far as keeps them within reach). */
export function movePathNode(annotation: KnownDiagramAnnotation, node: number, point: PicturePoint): KnownDiagramAnnotation {
  return shaped(annotation, (path) => (path[node] ? movePathNodeTo(path, node, point) : null));
}

/**
 * The other handle of a smooth node, turned to stay in line with `moved`
 * (on the far side of the node), its own length kept; a corner's stays, and
 * so does a handle on its node, which has no direction to keep.
 */
function alignOpposite(node: DiagramPathNode, side: 'in' | 'out'): DiagramPathNode {
  if (node.type === 'corner') return node;
  const other = side === 'in' ? 'out' : 'in';
  const moved = node[side];
  const opposite = node[other];
  if (!moved || !opposite) return node;
  const away = minus(node.at, moved);
  const length = size(minus(opposite, node.at));
  if (!(size(away) > ON_NODE) || !(length > ON_NODE)) return node;
  return { ...node, [other]: handleWithinReach(node.at, plus(node.at, times(away, length / size(away)))) };
}

/**
 * A handle put at `point`. A smooth node's other handle turns with it,
 * keeping its own length; a corner's does not. The tail has no `in` and the
 * tip no `out`: the arrow as it was.
 */
export function movePathHandle(
  annotation: KnownDiagramAnnotation,
  node: number,
  side: 'in' | 'out',
  point: PicturePoint
): KnownDiagramAnnotation {
  return shaped(annotation, (path) => {
    const at = path[node];
    if (!at || (side === 'in' && node === 0) || (side === 'out' && node === path.length - 1)) return null;
    const moved = alignOpposite({ ...at, [side]: handleWithinReach(at.at, withinReach(point)) }, side);
    return path.map((each, index) => (index === node ? moved : each));
  });
}

/**
 * A segment bent by dragging its curve: the point `t` along it put at
 * `point`. Its two inner handles move along the drag, each by as much as it
 * pulls on that point — the least change of the two that carries the curve
 * there exactly (`b1·o1 + b2·o2 = δ` at least `|o1|² + |o2|²`, b the cubic's
 * weights at `t`), so a press near one end mostly moves that end's handle.
 * A smooth node's other handle turns to stay in line. Very near a node a
 * press takes the node instead, so `t` is well inside in practice; at an end
 * nothing moves.
 */
export function bendPathSegment(
  annotation: KnownDiagramAnnotation,
  segment: number,
  t: number,
  point: PicturePoint
): KnownDiagramAnnotation {
  return shaped(annotation, (path) => {
    const cubic = pathCubics(path)[segment];
    if (!cubic || !(t > 0 && t < 1)) return null;
    const b1 = 3 * t * (1 - t) * (1 - t);
    const b2 = 3 * t * t * (1 - t);
    const weight = b1 * b1 + b2 * b2;
    const delta = minus(withinReach(point), cubicPoint(cubic, t) as PicturePoint);
    const start = path[segment]!;
    const end = path[segment + 1]!;
    const out = handleWithinReach(start.at, plus(start.out ?? start.at, times(delta, b1 / weight)));
    const into = handleWithinReach(end.at, plus(end.in ?? end.at, times(delta, b2 / weight)));
    return path.map((node, index) => {
      if (index === segment) return alignOpposite({ ...node, out }, 'out');
      if (index === segment + 1) return alignOpposite({ ...node, in: into }, 'in');
      return node;
    });
  });
}

/**
 * A node added where `t` cuts a segment (de Casteljau): the curve drawn as it
 * was, the new node smooth between the two halves' handles, the segment's
 * ends keeping their places with shorter handles. Not past
 * {@link MAX_PATH_NODES}, nor at a segment's end.
 */
export function splitPathSegment(annotation: KnownDiagramAnnotation, segment: number, t: number): KnownDiagramAnnotation {
  return shaped(annotation, (path) => {
    const cubic = pathCubics(path)[segment];
    if (!cubic || path.length >= MAX_PATH_NODES || !(t > 1e-6 && t < 1 - 1e-6)) return null;
    const [before, after] = splitCubic(cubic, t);
    const point = (p: readonly [number, number]): PicturePoint => [p[0], p[1]];
    const start = path[segment]!;
    const end = path[segment + 1]!;
    // A handle that lay on its node stays left out: half of nothing is nothing.
    const added: DiagramPathNode = { at: point(before[3]), in: point(before[2]), out: point(after[1]) };
    return [
      ...path.slice(0, segment),
      start.out ? { ...start, out: point(before[1]) } : start,
      added,
      end.in ? { ...end, in: point(after[2]) } : end,
      ...path.slice(segment + 2),
    ];
  });
}

/**
 * A node taken out, its neighbours keeping their outer handles (Affinity,
 * decision 5): the segment that joins them is drawn with the handles they
 * had. An end's neighbour becomes the end, its handle toward the node gone.
 * Null when the arrow has two nodes: deleting one deletes the arrow.
 */
export function deletePathNode(annotation: KnownDiagramAnnotation, node: number): KnownDiagramAnnotation | null {
  const path = pathNodesOf(annotation);
  if (!path || !path[node]) return annotation;
  if (path.length <= 2) return null;
  return shaped(annotation, (nodes) => {
    const kept = nodes.filter((_, index) => index !== node);
    const last = kept.length - 1;
    return kept.map((each, index) => {
      if (index === 0 && each.in) {
        const { in: _gone, ...rest } = each;
        return rest;
      }
      if (index === last && each.out) {
        const { out: _gone, ...rest } = each;
        return rest;
      }
      return each;
    });
  });
}

/**
 * A node made a corner — its handles free of each other — or smooth again:
 * its handles turned into line, each keeping its length, along the mean of
 * their two directions. A handle that lay on the node is drawn out along that
 * line a third of the way to its neighbour, so the node is smooth to see.
 * Only between two others: an end has one handle, and no type to have.
 */
export function setPathNodeType(
  annotation: KnownDiagramAnnotation,
  node: number,
  type: 'smooth' | 'corner'
): KnownDiagramAnnotation {
  return shaped(annotation, (path) => {
    const at = path[node];
    if (!at || node === 0 || node === path.length - 1) return null;
    let edited: DiagramPathNode;
    if (type === 'corner') {
      if (at.type === 'corner') return null;
      edited = { ...at, type: 'corner' };
    } else {
      const { type: _corner, ...smooth } = at;
      edited = smoothNode(smooth, path[node - 1]!.at, path[node + 1]!.at);
    }
    return path.map((each, index) => (index === node ? edited : each));
  });
}

/** Whether a node is a corner; the other type is smooth. */
export function isCornerNode(annotation: KnownDiagramAnnotation, node: number): boolean {
  return pathNodesOf(annotation)?.[node]?.type === 'corner';
}

/** A node's type turned over: a corner made smooth, a smooth node a corner. */
export function togglePathNodeType(annotation: KnownDiagramAnnotation, node: number): KnownDiagramAnnotation {
  return setPathNodeType(annotation, node, isCornerNode(annotation, node) ? 'smooth' : 'corner');
}

function smoothNode(node: DiagramPathNode, previous: PicturePoint, next: PicturePoint): DiagramPathNode {
  const inward = node.in ? minus(node.in, node.at) : ([0, 0] as PicturePoint);
  const outward = node.out ? minus(node.out, node.at) : ([0, 0] as PicturePoint);
  const inLength = size(inward);
  const outLength = size(outward);
  let direction: PicturePoint;
  if (inLength > ON_NODE && outLength > ON_NODE) {
    direction = minus(times(outward, 1 / outLength), times(inward, 1 / inLength));
  } else if (outLength > ON_NODE) direction = outward;
  else if (inLength > ON_NODE) direction = times(inward, -1);
  else direction = minus(next, previous);
  // Handles pointing exactly at each other have no mean: the line through the neighbours instead.
  const along = size(direction) > ON_NODE ? direction : minus(next, previous);
  const unit = times(along, 1 / (size(along) || 1));
  const inSize = inLength > ON_NODE ? inLength : size(minus(node.at, previous)) / 3;
  const outSize = outLength > ON_NODE ? outLength : size(minus(next, node.at)) / 3;
  return {
    ...node,
    in: handleWithinReach(node.at, minus(node.at, times(unit, inSize))),
    out: handleWithinReach(node.at, plus(node.at, times(unit, outSize))),
  };
}

/**
 * Where on an arrow's path a press is nearest: the segment, how far along it
 * (`t`), and how far off. For Edit Path's press on the curve — to bend it or
 * add a node there. Null for a kind that is not shaped.
 */
export function nearestPathPoint(
  annotation: KnownDiagramAnnotation,
  point: PicturePoint
): { segment: number; t: number; distance: number } | null {
  const path = pathNodesOf(annotation);
  if (!path) return null;
  const nearest = nearestOnPath(pathCubics(path), point);
  return nearest && { segment: nearest.segment, t: nearest.t, distance: nearest.distance };
}
