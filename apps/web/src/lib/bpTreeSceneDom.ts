import type { Point } from './geometry';

/**
 * The contract between the BP tree scene and the gestures that move it.
 *
 * The scene is rendered by React from committed document state and then left
 * alone. A drag does not re-render it — it writes SVG attributes straight onto
 * the elements React already produced. For that to work without React, every
 * element that a moving vertex displaces has to say so in the markup: which
 * vertices position it, and how those positions map onto its attributes.
 *
 * Keeping both halves of that contract in this one module is the point. The
 * names are used by exactly two files — the scene that writes them and the
 * writer that reads them — and a silent rename in one would leave dragging
 * looking broken with nothing to point at.
 */

/**
 * Which piece of the mirror-draw ghost an element is.
 *
 * The ghost follows the cursor, so it is positioned the same way the tree is —
 * written, not re-rendered. React draws its four elements once when the ghost is
 * armed and then leaves them alone.
 */
export const BP_TREE_GHOST_PART = 'data-bp-ghost-part';

export type BpTreeGhostPart = 'primary-edge' | 'primary-node' | 'mirror-edge' | 'mirror-node';

/** Where the ghost should be drawn, in SVG coordinates. */
export interface BpTreeGhostGeometry {
  primary: { from: Point; to: Point };
  /** Absent when the tip snapped to the axis, or when no mirror parent resolves. */
  mirror: { from: Point; to: Point } | null;
  snapped: boolean;
  unresolved: boolean;
}

export const BP_TREE_SCENE_ATTR = {
  /** Vertex id positioning the element's first point. */
  p1: 'data-bp-p1',
  /** Vertex id positioning its second point, for the two-ended shapes. */
  p2: 'data-bp-p2',
  /** Which of {@link BpTreeSceneAnchor} this element is. */
  anchor: 'data-bp-anchor',
  /** Constant offset from the anchor point, in SVG units. */
  dx: 'data-bp-dx',
  dy: 'data-bp-dy',
} as const;

/**
 * How an element's attributes derive from its vertex positions.
 *
 * - `node` — a dot at p1 (`cx`/`cy`).
 * - `node-label` — text offset from p1 (`x`/`y`).
 * - `edge` / `pair` — a segment from p1 to p2 (`x1`/`y1`/`x2`/`y2`).
 * - `edge-label` — text offset from the midpoint of p1..p2 (`x`/`y`).
 */
export type BpTreeSceneAnchor = 'node' | 'node-label' | 'edge' | 'edge-label' | 'pair';

/** One element the writer can move, with its contract already parsed. */
export interface BpTreeSceneTarget {
  element: SVGElement;
  anchor: BpTreeSceneAnchor;
  p1: number;
  /** Absent for the one-ended anchors. */
  p2: number | null;
  dx: number;
  dy: number;
}

function readNumber(element: Element, name: string): number | null {
  const raw = element.getAttribute(name);
  if (raw === null) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function readTarget(element: SVGElement): BpTreeSceneTarget | null {
  const anchor = element.getAttribute(BP_TREE_SCENE_ATTR.anchor) as BpTreeSceneAnchor | null;
  if (anchor === null) return null;
  const p1 = readNumber(element, BP_TREE_SCENE_ATTR.p1);
  if (p1 === null) return null;
  return {
    element,
    anchor,
    p1,
    p2: readNumber(element, BP_TREE_SCENE_ATTR.p2),
    dx: readNumber(element, BP_TREE_SCENE_ATTR.dx) ?? 0,
    dy: readNumber(element, BP_TREE_SCENE_ATTR.dy) ?? 0,
  };
}

/**
 * Every element under `root` that any of `movingIds` displaces.
 *
 * One pass over the scene per gesture, not per frame: the result is cached for
 * the life of the drag, which is what keeps a pointer sample proportional to
 * what moved rather than to the size of the tree.
 */
export function collectBpTreeSceneTargets(
  root: ParentNode,
  movingIds: ReadonlySet<number>
): BpTreeSceneTarget[] {
  const targets: BpTreeSceneTarget[] = [];
  for (const element of root.querySelectorAll<SVGElement>(`[${BP_TREE_SCENE_ATTR.anchor}]`)) {
    const target = readTarget(element);
    if (!target) continue;
    if (!movingIds.has(target.p1) && !(target.p2 !== null && movingIds.has(target.p2))) continue;
    targets.push(target);
  }
  return targets;
}

/** Every positioned element under `root`, moving or not. */
export function collectAllBpTreeSceneTargets(root: ParentNode): BpTreeSceneTarget[] {
  const targets: BpTreeSceneTarget[] = [];
  for (const element of root.querySelectorAll<SVGElement>(`[${BP_TREE_SCENE_ATTR.anchor}]`)) {
    const target = readTarget(element);
    if (target) targets.push(target);
  }
  return targets;
}

/**
 * Move the collected elements to where `pointFor` says their vertices now are,
 * in SVG coordinates. A vertex the caller has no position for leaves every
 * element that depends on it untouched, so a partial answer is a partial move
 * rather than a jump to the origin.
 */
export function applyBpTreeScenePositions(
  targets: readonly BpTreeSceneTarget[],
  pointFor: (vertexId: number) => Point | undefined
): void {
  for (const target of targets) {
    const a = pointFor(target.p1);
    if (!a) continue;
    if (target.anchor === 'node') {
      target.element.setAttribute('cx', String(a.x));
      target.element.setAttribute('cy', String(a.y));
      continue;
    }
    if (target.anchor === 'node-label') {
      target.element.setAttribute('x', String(a.x + target.dx));
      target.element.setAttribute('y', String(a.y + target.dy));
      continue;
    }
    const b = target.p2 === null ? undefined : pointFor(target.p2);
    if (!b) continue;
    if (target.anchor === 'edge-label') {
      target.element.setAttribute('x', String((a.x + b.x) / 2 + target.dx));
      target.element.setAttribute('y', String((a.y + b.y) / 2 + target.dy));
      continue;
    }
    target.element.setAttribute('x1', String(a.x));
    target.element.setAttribute('y1', String(a.y));
    target.element.setAttribute('x2', String(b.x));
    target.element.setAttribute('y2', String(b.y));
  }
}

function ghostPart(root: ParentNode, part: BpTreeGhostPart): SVGElement | null {
  return root.querySelector<SVGElement>(`[${BP_TREE_GHOST_PART}="${part}"]`);
}

function setSegment(element: SVGElement | null, from: Point, to: Point): void {
  if (!element) return;
  element.setAttribute('x1', String(from.x));
  element.setAttribute('y1', String(from.y));
  element.setAttribute('x2', String(to.x));
  element.setAttribute('y2', String(to.y));
}

function setShown(element: SVGElement | null, shown: boolean): void {
  if (element) element.style.display = shown ? '' : 'none';
}

/**
 * Move the mirror-draw ghost to `geometry`, or hide it when there is none.
 *
 * Everything variable about the ghost is written here rather than rendered: the
 * two segments, whether the mirror half exists, and the two state marks the
 * stylesheet keys off. That is what lets the pointer move without the pane
 * rendering.
 */
export function applyBpTreeGhost(root: ParentNode, geometry: BpTreeGhostGeometry | null): void {
  const primaryEdge = ghostPart(root, 'primary-edge');
  const primaryNode = ghostPart(root, 'primary-node');
  const mirrorEdge = ghostPart(root, 'mirror-edge');
  const mirrorNode = ghostPart(root, 'mirror-node');
  if (!geometry) {
    for (const element of [primaryEdge, primaryNode, mirrorEdge, mirrorNode]) setShown(element, false);
    return;
  }
  setShown(primaryEdge, true);
  setShown(primaryNode, true);
  setSegment(primaryEdge, geometry.primary.from, geometry.primary.to);
  primaryEdge?.classList.toggle('symmetry-ghost-edge--unresolved', geometry.unresolved);
  if (primaryNode) {
    primaryNode.setAttribute('cx', String(geometry.primary.to.x));
    primaryNode.setAttribute('cy', String(geometry.primary.to.y));
    if (geometry.snapped) primaryNode.setAttribute('data-snapped', 'true');
    else primaryNode.removeAttribute('data-snapped');
  }
  setShown(mirrorEdge, geometry.mirror !== null);
  setShown(mirrorNode, geometry.mirror !== null);
  if (!geometry.mirror) return;
  setSegment(mirrorEdge, geometry.mirror.from, geometry.mirror.to);
  if (mirrorNode) {
    mirrorNode.setAttribute('cx', String(geometry.mirror.to.x));
    mirrorNode.setAttribute('cy', String(geometry.mirror.to.y));
  }
}
