import { memo, useLayoutEffect, type PointerEvent, type Ref } from 'react';
import {
  TREE_CHROME_ATTR,
  TREE_GHOST_PART,
  TREE_SCENE_ATTR,
  treeChromeDash,
} from './sceneDom';
import type { PlotRect, Point } from '../lib/geometry';
import { treeDotPx, type TreeDotSizes } from '../lib/treeNodeDot';
import { viewportRectToViewBox } from '../lib/treeViewportPrimitives';
import type { TreeEditorCopy, TreeSymmetryPair, TreeViewLayers } from './host';
import type { TreeLengthRule } from './lengths';
import type { EditableTree, EditableTreeVertex } from './model';

/**
 * The tree drawing.
 *
 * Split out of the panel and memoized because it is the thing that must *not*
 * re-render while a gesture is running. A drag used to re-derive every vertex
 * and edge on every pointer sample — work proportional to the tree rather than
 * to what moved, which is what made large trees unusable. Now React draws the
 * committed tree and the gesture moves the result in place; see `sceneDom.ts`
 * for the contract that lets it.
 *
 * So the rule for this component's props: **committed model state only**.
 * Anything that changes during a gesture belongs on the imperative side.
 */

// Stroke widths in screen pixels, counter-scaled against the camera so the
// drawing keeps its proportions as you zoom. `non-scaling-stroke` cannot do this:
// it only defends against the SVG's own viewBox, not the pan/zoom wrapper's CSS
// transform.
//
// These must be applied as inline *styles*, not presentation attributes: SVG
// presentation attributes lose to any author CSS rule, and theme.css sets
// `stroke-width` on these same classes. An attribute here is silently ignored —
// which is exactly how the lines went on scaling while the numbers looked right.
//
// This applies to *chrome* only. A mark that stands for a distance in the model
// — the symmetry snap lane, whose width is the snap tolerance — must scale with
// the drawing instead, or it stops depicting the thing it measures.
export const EDGE_STROKE_PX = 7;
export const EDGE_SELECTED_STROKE_PX = 9;
export const NODE_STROKE_PX = 2;
export const SYMMETRY_LINE_PX = 2;
export const SYMMETRY_LANE_PX = 18;
export const LABEL_STROKE_PX = 3;
export const SYMMETRY_GHOST_PX = 3;
export const SYMMETRY_PAIR_PX = 1.5;
export const BOUNDS_STROKE_PX = 1.5;

// Dash patterns, in screen pixels, for the same reason and by the same mechanism
// as the widths above — see `treeChromeDash`. They live here rather than in
// theme.css because a stylesheet cannot express "in screen pixels", and a
// `stroke-dasharray` rule left there would sit under the inline style doing
// nothing.
export const SYMMETRY_GHOST_DASH_PX = [6, 6];
export const SYMMETRY_PAIR_DASH_PX = [2, 6];
export const DOT_SIZES: TreeDotSizes = { leafPx: 6, branchPx: 7 };
export const NODE_LABEL_PX = 12;
export const NODE_SELECTED_STROKE_PX = 3;

/** Offsets of a label from the point it annotates, in screen pixels. */
export const NODE_LABEL_DX_PX = 4;
export const NODE_LABEL_DY_PX = 4;
export const EDGE_LABEL_DX_PX = 6;
export const EDGE_LABEL_DY_PX = -6;

export interface TreeSceneProps {
  svgRef: Ref<SVGSVGElement>;
  tree: EditableTree;
  /** Tree space → SVG space, from the surface's frame. */
  toSvg: (point: Point) => Point;
  worldRect: PlotRect;
  /**
   * Where the surface allows a node to be, drawn so the limit is visible before
   * it is hit. A drag stops dead at this edge; unmarked, that is indistinguishable
   * from an editor that has stopped responding.
   */
  boundsRect: PlotRect;
  layers: TreeViewLayers;
  /** Vertices drawn as selected, including anything linked to the selection. */
  selectedVertices: ReadonlySet<number>;
  selectedEdges: ReadonlySet<number>;
  /** SVG units per screen pixel, for the counter-scaled chrome. */
  chromePx: (px: number) => number;
  symmetryPairs: readonly TreeSymmetryPair[];
  /**
   * Whether the mirror-draw ghost has anything to preview: mirror draw on, with
   * a vertex to hang the new leaf from, and the pointer over the canvas.
   *
   * A flag, not a position. Where the ghost goes changes with every pointer
   * sample and is written by `applyTreeGhost`; whether it exists at all changes
   * only when the selection or the pointer enters or leaves.
   */
  ghostArmed: boolean;
  /** Surface-scoped CSS prefix, e.g. `bp-tree` → `.bp-tree-node`. */
  classPrefix: string;
  copy: TreeEditorCopy;
  lengths: TreeLengthRule;
  /** Whether to draw each edge's length beside it. */
  showEdgeLengths: boolean;
  labelOf: (vertex: EditableTreeVertex) => string;
  /**
   * Called after every commit of this scene.
   *
   * Gestures cache element lookups into the rendered SVG, and those caches are
   * only stale when React has redrawn it. Letting the scene say so keeps the
   * invalidation from drifting away from what actually causes a redraw, which a
   * hand-maintained dependency list beside the memo would eventually do.
   */
  onRendered: () => void;
  onEdgePointerDown: (event: PointerEvent<SVGGElement>, edgeId: number) => void;
  onVertexPointerDown: (event: PointerEvent<SVGCircleElement>, vertexId: number) => void;
}

export const TreeScene = memo(function TreeScene({
  svgRef,
  tree,
  toSvg,
  worldRect,
  boundsRect,
  layers,
  selectedVertices,
  selectedEdges,
  chromePx,
  symmetryPairs,
  ghostArmed,
  classPrefix,
  copy,
  lengths,
  showEdgeLengths,
  labelOf,
  onRendered,
  onEdgePointerDown,
  onVertexPointerDown,
}: TreeSceneProps) {
  useLayoutEffect(onRendered);
  const vertexById = new Map(tree.vertices.map((vertex) => [vertex.id, vertex] as const));

  return (
    <svg
      ref={svgRef}
      className={`design-canvas ${classPrefix}-canvas`}
      viewBox={viewportRectToViewBox(worldRect)}
      width={worldRect.width}
      height={worldRect.height}
      style={{ width: worldRect.width, height: worldRect.height }}
      role="img"
      aria-label={copy.canvas}
    >
      <rect
        className={`tree-bounds ${classPrefix}-bounds`}
        style={{ strokeWidth: chromePx(BOUNDS_STROKE_PX) }}
        {...{ [TREE_CHROME_ATTR.stroke]: BOUNDS_STROKE_PX }}
        x={boundsRect.x}
        y={boundsRect.y}
        width={boundsRect.width}
        height={boundsRect.height}
      />
      {symmetryPairs.map((pair) => {
        const a = vertexById.get(pair.v1);
        const b = vertexById.get(pair.v2);
        if (!a || !b) return null;
        const p1 = toSvg(a.loc);
        const p2 = toSvg(b.loc);
        return (
          <line
            key={`${pair.v1}:${pair.v2}`}
            className="symmetry-pair-line"
            style={{
              strokeWidth: chromePx(SYMMETRY_PAIR_PX),
              strokeDasharray: treeChromeDash(SYMMETRY_PAIR_DASH_PX, chromePx),
            }}
            {...{
              [TREE_CHROME_ATTR.stroke]: SYMMETRY_PAIR_PX,
              [TREE_CHROME_ATTR.dash]: SYMMETRY_PAIR_DASH_PX.join(' '),
            }}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            {...{
              [TREE_SCENE_ATTR.anchor]: 'pair',
              [TREE_SCENE_ATTR.p1]: pair.v1,
              [TREE_SCENE_ATTR.p2]: pair.v2,
            }}
          />
        );
      })}
      {ghostArmed && (
        <g className="symmetry-ghost">
          <line
            className="symmetry-ghost-edge"
            style={{
              strokeWidth: chromePx(SYMMETRY_GHOST_PX),
              strokeDasharray: treeChromeDash(SYMMETRY_GHOST_DASH_PX, chromePx),
              display: 'none',
            }}
            {...{
              [TREE_GHOST_PART]: 'primary-edge',
              [TREE_CHROME_ATTR.stroke]: SYMMETRY_GHOST_PX,
              [TREE_CHROME_ATTR.dash]: SYMMETRY_GHOST_DASH_PX.join(' '),
            }}
          />
          <circle
            className="symmetry-ghost-node"
            r={chromePx(DOT_SIZES.leafPx)}
            style={{ display: 'none' }}
            {...{ [TREE_GHOST_PART]: 'primary-node', [TREE_CHROME_ATTR.radius]: DOT_SIZES.leafPx }}
          />
          <line
            className="symmetry-ghost-edge"
            style={{
              strokeWidth: chromePx(SYMMETRY_GHOST_PX),
              strokeDasharray: treeChromeDash(SYMMETRY_GHOST_DASH_PX, chromePx),
              display: 'none',
            }}
            {...{
              [TREE_GHOST_PART]: 'mirror-edge',
              [TREE_CHROME_ATTR.stroke]: SYMMETRY_GHOST_PX,
              [TREE_CHROME_ATTR.dash]: SYMMETRY_GHOST_DASH_PX.join(' '),
            }}
          />
          <circle
            className="symmetry-ghost-node"
            r={chromePx(DOT_SIZES.leafPx)}
            style={{ display: 'none' }}
            {...{ [TREE_GHOST_PART]: 'mirror-node', [TREE_CHROME_ATTR.radius]: DOT_SIZES.leafPx }}
          />
        </g>
      )}
      {tree.edges.map((edge) => {
        const a = vertexById.get(edge.vertices[0]);
        const b = vertexById.get(edge.vertices[1]);
        if (!a || !b) return null;
        const p1 = toSvg(a.loc);
        const p2 = toSvg(b.loc);
        const active = selectedEdges.has(edge.id);
        return (
          <g
            key={edge.id}
            // Intentionally not focusable (no role/tabIndex), matching the
            // node dots: the browser draws its own focus ring around the
            // group's box — which spans the edge *and* its length label —
            // so a click wrapped the edge in a capsule instead of just
            // highlighting it. Selection is by click; the tree's keyboard
            // actions live on the container.
            aria-label={copy.selectEdge(edge.id, lengths.format(edge.length))}
            onPointerDown={(event) => onEdgePointerDown(event, edge.id)}
          >
            <line
              className={[
                'tree-edge',
                `${classPrefix}-edge`,
                edge.isLeafEdge ? `${classPrefix}-edge--leaf` : `${classPrefix}-edge--river`,
                active ? 'tree-edge--selected' : '',
              ].join(' ')}
              style={{
                strokeWidth: chromePx(active ? EDGE_SELECTED_STROKE_PX : EDGE_STROKE_PX),
              }}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              {...{
                [TREE_SCENE_ATTR.anchor]: 'edge',
                [TREE_SCENE_ATTR.p1]: a.id,
                [TREE_SCENE_ATTR.p2]: b.id,
                [TREE_CHROME_ATTR.stroke]: active ? EDGE_SELECTED_STROKE_PX : EDGE_STROKE_PX,
              }}
            />
            {showEdgeLengths && layers.labels && edge.isLeafEdge && (
              <text
                className={`edge-label ${classPrefix}-edge-label`}
                x={(p1.x + p2.x) / 2 + chromePx(EDGE_LABEL_DX_PX)}
                y={(p1.y + p2.y) / 2 + chromePx(EDGE_LABEL_DY_PX)}
                style={{
                  fontSize: chromePx(NODE_LABEL_PX),
                  strokeWidth: chromePx(LABEL_STROKE_PX),
                }}
                {...{
                  [TREE_SCENE_ATTR.anchor]: 'edge-label',
                  [TREE_SCENE_ATTR.p1]: a.id,
                  [TREE_SCENE_ATTR.p2]: b.id,
                  [TREE_SCENE_ATTR.dx]: EDGE_LABEL_DX_PX,
                  [TREE_SCENE_ATTR.dy]: EDGE_LABEL_DY_PX,
                  [TREE_CHROME_ATTR.font]: NODE_LABEL_PX,
                  [TREE_CHROME_ATTR.stroke]: LABEL_STROKE_PX,
                }}
              >
                {lengths.format(edge.length)}
              </text>
            )}
          </g>
        );
      })}
      {tree.vertices.map((vertex) => {
        const point = toSvg(vertex.loc);
        const active = selectedVertices.has(vertex.id);
        const dotPx = treeDotPx(DOT_SIZES, vertex.isLeaf, active);
        const label = labelOf(vertex);
        return (
          <g key={vertex.id}>
            <circle
              className={[
                'tree-node',
                `${classPrefix}-node`,
                vertex.isRoot ? `${classPrefix}-node--root` : '',
                active ? 'tree-node--selected' : '',
              ].join(' ')}
              data-leaf={vertex.isLeaf || undefined}
              // An inline style, not a presentation attribute, and so it
              // beats theme.css — which is why the selected ring has to be
              // widened here rather than in the stylesheet.
              style={{
                strokeWidth: chromePx(active ? NODE_SELECTED_STROKE_PX : NODE_STROKE_PX),
              }}
              cx={point.x}
              cy={point.y}
              r={chromePx(dotPx)}
              // Intentionally not focusable (no role/tabIndex): a focusable
              // dot draws its own browser focus ring that competes with the
              // selection highlight and steals focus from the name field, so
              // typing a name would go nowhere. Selection is by click; the
              // tree's keyboard nudge/delete live on the container.
              aria-label={copy.selectVertex(vertex.id, label, vertex.isLeaf)}
              onPointerDown={(event) => onVertexPointerDown(event, vertex.id)}
              {...{
                [TREE_SCENE_ATTR.anchor]: 'node',
                [TREE_SCENE_ATTR.p1]: vertex.id,
                [TREE_CHROME_ATTR.stroke]: active ? NODE_SELECTED_STROKE_PX : NODE_STROKE_PX,
                [TREE_CHROME_ATTR.radius]: dotPx,
              }}
            />
            {layers.labels && vertex.isLeaf && label && (
              <text
                className={`node-label ${classPrefix}-node-label`}
                x={point.x + chromePx(dotPx + NODE_LABEL_DX_PX)}
                y={point.y + chromePx(NODE_LABEL_DY_PX)}
                style={{
                  fontSize: chromePx(NODE_LABEL_PX),
                  strokeWidth: chromePx(LABEL_STROKE_PX),
                }}
                {...{
                  [TREE_SCENE_ATTR.anchor]: 'node-label',
                  [TREE_SCENE_ATTR.p1]: vertex.id,
                  [TREE_SCENE_ATTR.dx]: dotPx + NODE_LABEL_DX_PX,
                  [TREE_SCENE_ATTR.dy]: NODE_LABEL_DY_PX,
                  [TREE_CHROME_ATTR.font]: NODE_LABEL_PX,
                  [TREE_CHROME_ATTR.stroke]: LABEL_STROKE_PX,
                }}
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
});
