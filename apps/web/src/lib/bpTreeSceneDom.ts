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
