import { memo, useLayoutEffect, type PointerEvent, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { OristudioBpTreeView } from '../../engine/oristudioBpTypes';
import { bpTreePointToSvg, bpTreeVertexLabel } from '../../lib/bpTreeViewport';
import type { bpTreePaperRect } from '../../lib/bpTreeViewport';
import {
  BP_TREE_CHROME_ATTR,
  BP_TREE_GHOST_PART,
  BP_TREE_SCENE_ATTR,
} from '../../lib/bpTreeSceneDom';
import { formatNumber, type PlotRect, type Point } from '../../lib/geometry';
import { treeDotPx, type TreeDotSizes } from '../../lib/treeNodeDot';
import type { BpTreeSymmetryLine } from '../../hooks/useBpTreeSymmetry';
import type { BpTreeViewLayers } from '../../lib/oristudioBpViewportSettings';
import { viewportRectToViewBox } from '../../lib/treeViewportPrimitives';

/**
 * The BP tree drawing.
 *
 * Split out of the panel and memoized because it is the thing that must *not*
 * re-render while a gesture is running. A drag used to re-derive every vertex
 * and edge on every pointer sample — work proportional to the tree rather than
 * to what moved, which is what made large trees unusable. Now React draws the
 * committed tree and the gesture moves the result in place; see
 * `lib/bpTreeSceneDom.ts` for the contract that lets it.
 *
 * So the rule for this component's props: **committed document state only**.
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
export const DOT_SIZES: TreeDotSizes = { leafPx: 6, branchPx: 7 };
export const NODE_LABEL_PX = 12;
export const NODE_SELECTED_STROKE_PX = 3;

/** Offsets of a label from the point it annotates, in screen pixels. */
export const NODE_LABEL_DX_PX = 4;
export const NODE_LABEL_DY_PX = 4;
export const EDGE_LABEL_DX_PX = 6;
export const EDGE_LABEL_DY_PX = -6;

export interface BpTreeSceneProps {
  svgRef: Ref<SVGSVGElement>;
  tree: OristudioBpTreeView;
  paperRect: ReturnType<typeof bpTreePaperRect>;
  worldRect: PlotRect;
  layers: BpTreeViewLayers;
  /** Vertices drawn as selected, including anything linked to the selection. */
  selectedVertices: ReadonlySet<number>;
  selectedEdges: ReadonlySet<number>;
  /** SVG units per screen pixel, for the counter-scaled chrome. */
  chromePx: (px: number) => number;
  /**
   * Live positions during a drag. Transitional: the drag is about to move to
   * imperative writes, at which point this prop — and the re-render per pointer
   * sample that comes with it — goes away.
   */
  previewLocs?: ReadonlyMap<number, Point> | null;
  symmetryAxisLine: BpTreeSymmetryLine | null;
  symmetryPairs: readonly { v1: number; v2: number }[];
  /**
   * Whether the mirror-draw ghost has anything to preview: mirror draw on, with
   * a vertex to hang the new leaf from, and the pointer over the canvas.
   *
   * A flag, not a position. Where the ghost goes changes with every pointer
   * sample and is written by {@link applyBpTreeGhost}; whether it exists at all
   * changes only when the selection or the pointer enters or leaves.
   */
  ghostArmed: boolean;
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

/** Where a vertex sits on screen. Committed position — gestures move the DOM. */
function svgPointOf(
  tree: OristudioBpTreeView,
  paperRect: ReturnType<typeof bpTreePaperRect>,
  loc: Point
): Point {
  return bpTreePointToSvg(loc, tree.sheet, paperRect);
}

export const BpTreeScene = memo(function BpTreeScene({
  svgRef,
  tree,
  paperRect,
  worldRect,
  layers,
  selectedVertices,
  selectedEdges,
  chromePx,
  previewLocs,
  symmetryAxisLine,
  symmetryPairs,
  ghostArmed,
  onRendered,
  onEdgePointerDown,
  onVertexPointerDown,
}: BpTreeSceneProps) {
  const { t } = useTranslation();
  useLayoutEffect(onRendered);
  const vertexById = new Map(tree.vertices.map((vertex) => [vertex.id, vertex] as const));
  const locOf = (id: number, loc: Point) => previewLocs?.get(id) ?? loc;

  return (
    <svg
      ref={svgRef}
      className="design-canvas bp-tree-canvas"
      viewBox={viewportRectToViewBox(worldRect)}
      width={worldRect.width}
      height={worldRect.height}
      style={{ width: worldRect.width, height: worldRect.height }}
      role="img"
      aria-label={t('panels:bpTree.canvas', 'Box Pleat tree canvas')}
    >
      {symmetryAxisLine && (
        <>
          <line
            // No counter-scale: this band *is* the snap zone. Its width in
            // SVG units defines `axisTolerance`, so it has to scale with the
            // drawing — a fixed screen width would show a zone the size of
            // which no longer matches where a tip actually snaps.
            className="symmetry-snap-lane"
            style={{ strokeWidth: chromePx(SYMMETRY_LANE_PX) }}
            {...{ [BP_TREE_CHROME_ATTR.stroke]: SYMMETRY_LANE_PX }}
            x1={symmetryAxisLine.x1}
            y1={symmetryAxisLine.y1}
            x2={symmetryAxisLine.x2}
            y2={symmetryAxisLine.y2}
          />
          <line
            className="symmetry-line"
            style={{ strokeWidth: chromePx(SYMMETRY_LINE_PX) }}
            {...{ [BP_TREE_CHROME_ATTR.stroke]: SYMMETRY_LINE_PX }}
            x1={symmetryAxisLine.x1}
            y1={symmetryAxisLine.y1}
            x2={symmetryAxisLine.x2}
            y2={symmetryAxisLine.y2}
          />
        </>
      )}
      {symmetryPairs.map((pair) => {
        const a = vertexById.get(pair.v1);
        const b = vertexById.get(pair.v2);
        if (!a || !b) return null;
        const p1 = svgPointOf(tree, paperRect, locOf(a.id, a.loc));
        const p2 = svgPointOf(tree, paperRect, locOf(b.id, b.loc));
        return (
          <line
            key={`${pair.v1}:${pair.v2}`}
            className="symmetry-pair-line"
            style={{ strokeWidth: chromePx(SYMMETRY_PAIR_PX) }}
            {...{ [BP_TREE_CHROME_ATTR.stroke]: SYMMETRY_PAIR_PX }}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            {...{
              [BP_TREE_SCENE_ATTR.anchor]: 'pair',
              [BP_TREE_SCENE_ATTR.p1]: pair.v1,
              [BP_TREE_SCENE_ATTR.p2]: pair.v2,
            }}
          />
        );
      })}
      {ghostArmed && (
        <g className="symmetry-ghost">
          <line
            className="symmetry-ghost-edge"
            style={{ strokeWidth: chromePx(SYMMETRY_GHOST_PX), display: 'none' }}
            {...{ [BP_TREE_GHOST_PART]: 'primary-edge', [BP_TREE_CHROME_ATTR.stroke]: SYMMETRY_GHOST_PX }}
          />
          <circle
            className="symmetry-ghost-node"
            r={chromePx(DOT_SIZES.leafPx)}
            style={{ display: 'none' }}
            {...{ [BP_TREE_GHOST_PART]: 'primary-node', [BP_TREE_CHROME_ATTR.radius]: DOT_SIZES.leafPx }}
          />
          <line
            className="symmetry-ghost-edge"
            style={{ strokeWidth: chromePx(SYMMETRY_GHOST_PX), display: 'none' }}
            {...{ [BP_TREE_GHOST_PART]: 'mirror-edge', [BP_TREE_CHROME_ATTR.stroke]: SYMMETRY_GHOST_PX }}
          />
          <circle
            className="symmetry-ghost-node"
            r={chromePx(DOT_SIZES.leafPx)}
            style={{ display: 'none' }}
            {...{ [BP_TREE_GHOST_PART]: 'mirror-node', [BP_TREE_CHROME_ATTR.radius]: DOT_SIZES.leafPx }}
          />
        </g>
      )}
      {tree.edges.map((edge) => {
        const a = vertexById.get(edge.vertices[0]);
        const b = vertexById.get(edge.vertices[1]);
        if (!a || !b) return null;
        const p1 = svgPointOf(tree, paperRect, locOf(a.id, a.loc));
        const p2 = svgPointOf(tree, paperRect, locOf(b.id, b.loc));
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
            aria-label={t('panels:bpTree.selectEdge', 'Select BP edge {{id}}, length {{length}}', {
              id: edge.id,
              length: formatNumber(edge.length, 2),
            })}
            onPointerDown={(event) => onEdgePointerDown(event, edge.id)}
          >
            <line
              className={[
                'tree-edge',
                'bp-tree-edge',
                edge.isLeafEdge ? 'bp-tree-edge--leaf' : 'bp-tree-edge--river',
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
                [BP_TREE_SCENE_ATTR.anchor]: 'edge',
                [BP_TREE_SCENE_ATTR.p1]: a.id,
                [BP_TREE_SCENE_ATTR.p2]: b.id,
                [BP_TREE_CHROME_ATTR.stroke]: active ? EDGE_SELECTED_STROKE_PX : EDGE_STROKE_PX,
              }}
            />
            {layers.labels && edge.isLeafEdge && (
              <text
                className="edge-label bp-tree-edge-label"
                x={(p1.x + p2.x) / 2 + chromePx(EDGE_LABEL_DX_PX)}
                y={(p1.y + p2.y) / 2 + chromePx(EDGE_LABEL_DY_PX)}
                style={{
                  fontSize: chromePx(NODE_LABEL_PX),
                  strokeWidth: chromePx(LABEL_STROKE_PX),
                }}
                {...{
                  [BP_TREE_SCENE_ATTR.anchor]: 'edge-label',
                  [BP_TREE_SCENE_ATTR.p1]: a.id,
                  [BP_TREE_SCENE_ATTR.p2]: b.id,
                  [BP_TREE_SCENE_ATTR.dx]: EDGE_LABEL_DX_PX,
                  [BP_TREE_SCENE_ATTR.dy]: EDGE_LABEL_DY_PX,
                  [BP_TREE_CHROME_ATTR.font]: NODE_LABEL_PX,
                  [BP_TREE_CHROME_ATTR.stroke]: LABEL_STROKE_PX,
                }}
              >
                {formatNumber(edge.length, 2)}
              </text>
            )}
          </g>
        );
      })}
      {tree.vertices.map((vertex) => {
        const point = svgPointOf(tree, paperRect, locOf(vertex.id, vertex.loc));
        const active = selectedVertices.has(vertex.id);
        const dotPx = treeDotPx(DOT_SIZES, vertex.isLeaf, active);
        const label = bpTreeVertexLabel(vertex);
        const vertexAriaLabel = vertex.isLeaf
          ? label
            ? t('panels:bpTree.selectLeafVertexWithLabel', 'Select BP leaf vertex {{id}}, {{label}}', {
                id: vertex.id,
                label,
              })
            : t('panels:bpTree.selectLeafVertex', 'Select BP leaf vertex {{id}}', { id: vertex.id })
          : label
            ? t('panels:bpTree.selectVertexWithLabel', 'Select BP vertex {{id}}, {{label}}', {
                id: vertex.id,
                label,
              })
            : t('panels:bpTree.selectVertex', 'Select BP vertex {{id}}', { id: vertex.id });
        return (
          <g key={vertex.id}>
            <circle
              className={[
                'tree-node',
                'bp-tree-node',
                vertex.isRoot ? 'bp-tree-node--root' : '',
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
              aria-label={vertexAriaLabel}
              onPointerDown={(event) => onVertexPointerDown(event, vertex.id)}
              {...{
                [BP_TREE_SCENE_ATTR.anchor]: 'node',
                [BP_TREE_SCENE_ATTR.p1]: vertex.id,
                [BP_TREE_CHROME_ATTR.stroke]: active ? NODE_SELECTED_STROKE_PX : NODE_STROKE_PX,
                [BP_TREE_CHROME_ATTR.radius]: dotPx,
              }}
            />
            {layers.labels && vertex.isLeaf && label && (
              <text
                className="node-label bp-tree-node-label"
                x={point.x + chromePx(dotPx + NODE_LABEL_DX_PX)}
                y={point.y + chromePx(NODE_LABEL_DY_PX)}
                style={{
                  fontSize: chromePx(NODE_LABEL_PX),
                  strokeWidth: chromePx(LABEL_STROKE_PX),
                }}
                {...{
                  [BP_TREE_SCENE_ATTR.anchor]: 'node-label',
                  [BP_TREE_SCENE_ATTR.p1]: vertex.id,
                  [BP_TREE_SCENE_ATTR.dx]: dotPx + NODE_LABEL_DX_PX,
                  [BP_TREE_SCENE_ATTR.dy]: NODE_LABEL_DY_PX,
                  [BP_TREE_CHROME_ATTR.font]: NODE_LABEL_PX,
                  [BP_TREE_CHROME_ATTR.stroke]: LABEL_STROKE_PX,
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
