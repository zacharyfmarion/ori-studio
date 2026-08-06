import type { Point } from '../lib/geometry';

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
export const TREE_GHOST_PART = 'data-tree-ghost-part';

export type TreeGhostPart = 'primary-edge' | 'primary-node' | 'mirror-edge' | 'mirror-node';

/** Where the ghost should be drawn, in SVG coordinates. */
export interface TreeGhostGeometry {
  primary: { from: Point; to: Point };
  /** Absent when the tip snapped to the axis, or when no mirror parent resolves. */
  mirror: { from: Point; to: Point } | null;
  snapped: boolean;
  unresolved: boolean;
}

export const TREE_SCENE_ATTR = {
  /** Vertex id positioning the element's first point. */
  p1: 'data-tree-p1',
  /** Vertex id positioning its second point, for the two-ended shapes. */
  p2: 'data-tree-p2',
  /** Which of {@link TreeSceneAnchor} this element is. */
  anchor: 'data-tree-anchor',
  /** Constant offset from the anchor point, in *screen pixels*. */
  dx: 'data-tree-dx',
  dy: 'data-tree-dy',
} as const;

/**
 * Sizes that counter-scale against the camera, in screen pixels.
 *
 * The drawing keeps its proportions as you zoom, which means every stroke
 * width, dot radius and font size is a function of the camera. Rendering that
 * function is what made a zoom step cost a full redraw of the canvas; declaring
 * it lets {@link applyTreeChromeScale} rewrite them all directly instead.
 *
 * They stay inline styles rather than moving to the stylesheet: SVG presentation
 * attributes lose to any author CSS rule, and theme.css already sets
 * `stroke-width` on these classes, so an attribute here would be silently
 * ignored.
 */
export const TREE_CHROME_ATTR = {
  stroke: 'data-tree-stroke-px',
  radius: 'data-tree-r-px',
  font: 'data-tree-font-px',
} as const;

/**
 * How an element's attributes derive from its vertex positions.
 *
 * - `node` — a dot at p1 (`cx`/`cy`).
 * - `node-label` — text offset from p1 (`x`/`y`).
 * - `edge` / `pair` — a segment from p1 to p2 (`x1`/`y1`/`x2`/`y2`).
 * - `edge-label` — text offset from the midpoint of p1..p2 (`x`/`y`).
 */
export type TreeSceneAnchor = 'node' | 'node-label' | 'edge' | 'edge-label' | 'pair';

/** One element the writer can move, with its contract already parsed. */
export interface TreeSceneTarget {
  element: SVGElement;
  anchor: TreeSceneAnchor;
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

function readTarget(element: SVGElement): TreeSceneTarget | null {
  const anchor = element.getAttribute(TREE_SCENE_ATTR.anchor) as TreeSceneAnchor | null;
  if (anchor === null) return null;
  const p1 = readNumber(element, TREE_SCENE_ATTR.p1);
  if (p1 === null) return null;
  return {
    element,
    anchor,
    p1,
    p2: readNumber(element, TREE_SCENE_ATTR.p2),
    dx: readNumber(element, TREE_SCENE_ATTR.dx) ?? 0,
    dy: readNumber(element, TREE_SCENE_ATTR.dy) ?? 0,
  };
}

/**
 * Every element under `root` that any of `movingIds` displaces.
 *
 * One pass over the scene per gesture, not per frame: the result is cached for
 * the life of the drag, which is what keeps a pointer sample proportional to
 * what moved rather than to the size of the tree.
 */
export function collectTreeSceneTargets(
  root: ParentNode,
  movingIds: ReadonlySet<number>
): TreeSceneTarget[] {
  const targets: TreeSceneTarget[] = [];
  for (const element of root.querySelectorAll<SVGElement>(`[${TREE_SCENE_ATTR.anchor}]`)) {
    const target = readTarget(element);
    if (!target) continue;
    if (!movingIds.has(target.p1) && !(target.p2 !== null && movingIds.has(target.p2))) continue;
    targets.push(target);
  }
  return targets;
}

/** Every positioned element under `root`, moving or not. */
export function collectAllTreeSceneTargets(root: ParentNode): TreeSceneTarget[] {
  const targets: TreeSceneTarget[] = [];
  for (const element of root.querySelectorAll<SVGElement>(`[${TREE_SCENE_ATTR.anchor}]`)) {
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
 *
 * Label offsets are held in screen pixels and converted here, so the same call
 * re-places them when the camera scale changes and nothing has moved.
 */
export function applyTreeScenePositions(
  targets: readonly TreeSceneTarget[],
  pointFor: (vertexId: number) => Point | undefined,
  chromePx: (px: number) => number
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
      target.element.setAttribute('x', String(a.x + chromePx(target.dx)));
      target.element.setAttribute('y', String(a.y + chromePx(target.dy)));
      continue;
    }
    const b = target.p2 === null ? undefined : pointFor(target.p2);
    if (!b) continue;
    if (target.anchor === 'edge-label') {
      target.element.setAttribute('x', String((a.x + b.x) / 2 + chromePx(target.dx)));
      target.element.setAttribute('y', String((a.y + b.y) / 2 + chromePx(target.dy)));
      continue;
    }
    target.element.setAttribute('x1', String(a.x));
    target.element.setAttribute('y1', String(a.y));
    target.element.setAttribute('x2', String(b.x));
    target.element.setAttribute('y2', String(b.y));
  }
}

function ghostPart(root: ParentNode, part: TreeGhostPart): SVGElement | null {
  return root.querySelector<SVGElement>(`[${TREE_GHOST_PART}="${part}"]`);
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
export function applyTreeGhost(root: ParentNode, geometry: TreeGhostGeometry | null): void {
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

/** One element's counter-scaled sizes, already parsed out of the markup. */
export interface TreeChromeTarget {
  element: SVGElement;
  strokePx: number | null;
  radiusPx: number | null;
  fontPx: number | null;
}

/**
 * Every element whose size counter-scales against the camera.
 *
 * Collected once per rendered scene and reused across zoom steps — re-reading
 * the markup on each step made a zoom four passes over the whole canvas.
 */
export function collectTreeChromeTargets(root: ParentNode): TreeChromeTarget[] {
  const selector = [
    `[${TREE_CHROME_ATTR.stroke}]`,
    `[${TREE_CHROME_ATTR.radius}]`,
    `[${TREE_CHROME_ATTR.font}]`,
  ].join(',');
  const targets: TreeChromeTarget[] = [];
  for (const element of root.querySelectorAll<SVGElement>(selector)) {
    targets.push({
      element,
      strokePx: readNumber(element, TREE_CHROME_ATTR.stroke),
      radiusPx: readNumber(element, TREE_CHROME_ATTR.radius),
      fontPx: readNumber(element, TREE_CHROME_ATTR.font),
    });
  }
  return targets;
}

/**
 * Rewrite every counter-scaled size for a new camera scale.
 *
 * A zoom step changes nothing about *what* is drawn, only how thick it is — so
 * it has no business re-rendering the canvas. Callers pair this with
 * {@link applyTreeScenePositions}, which re-places the labels whose offsets
 * are counter-scaled too.
 */
export function applyTreeChromeScale(
  targets: readonly TreeChromeTarget[],
  chromePx: (px: number) => number
): void {
  for (const target of targets) {
    if (target.strokePx !== null) target.element.style.strokeWidth = String(chromePx(target.strokePx));
    if (target.radiusPx !== null) target.element.setAttribute('r', String(chromePx(target.radiusPx)));
    if (target.fontPx !== null) target.element.style.fontSize = `${chromePx(target.fontPx)}px`;
  }
}
