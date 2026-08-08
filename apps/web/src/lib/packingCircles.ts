/**
 * A design's packed circles, as geometry rather than as pixels.
 *
 * Both design kinds already draw their packing, but each draws it straight into
 * SVG with view-only fudges baked in (a minimum pixel radius, a rounded-rect
 * approximation). "Send to Edit (include circles)" needs the same circles as
 * real numbers on the paper, so the definitions live here and the viewports
 * derive their pixels from them — otherwise the circle you see and the circle
 * you send are two different circles that merely look alike.
 *
 * Every function here returns coordinates in the space of the *file its kind
 * exports*, which is the contract `SendToEditPayload.circles` states. Nothing
 * here converts into the Edit document's space: a loader may move the geometry
 * and only the kernel knows whether it did, so `place_circles` recovers that
 * from the accompanying bounds.
 */

import type { EdgeSnapshot, NodeSnapshot, PaperSettings } from '../engine/types';
import type { OristudioBpFlap, OristudioBpSheet } from '../engine/oristudioBpTypes';
import type { SendToEditCircle } from '../designKinds/types';
import { bpPackingSheetFrame } from './bpPackingViewport';

/**
 * A tree edge's length as the packing actually uses it.
 *
 * `Edge::strained_length()` in the engine — the optimizer's paths are built from
 * these, not from the nominal lengths (`min_tree_length` sums exactly this, and
 * `min_paper_length` is that times the scale). A circle drawn from the nominal
 * length is the wrong size on any design carrying strain.
 */
export function strainedEdgeLength(edge: Pick<EdgeSnapshot, 'length' | 'strain'>): number {
  return edge.length * (1 + edge.strain);
}

/** An edge as this module needs it: which nodes it joins, and how long it is. */
type PackingEdge = Pick<EdgeSnapshot, 'nodes' | 'length' | 'strain'>;

/**
 * A leaf node's circle radius in paper units: the strained length of its own
 * edge, scaled onto the paper.
 *
 * That is the definition the optimizer enforces — two leaves must sit at least
 * `scale × treeDistance` apart, so a leaf's own circle has radius
 * `scale × strainedLength` of the edge that reaches it.
 */
export function leafCirclePaperRadius(
  nodeId: number,
  edges: readonly PackingEdge[],
  scale: number
): number {
  const incident = edges.find((edge) => edge.nodes.includes(nodeId));
  return incident ? strainedEdgeLength(incident) * scale : 0;
}

/**
 * TreeMaker's packing circles, in the coordinate space of its exported FOLD.
 *
 * The FOLD export writes `[x, paper_height - y]` (`Tree::to_fold_document`), so
 * these are flipped to match: a circle has to be in the same space as the
 * creases it annotates, not in the tree's own.
 */
export function treemakerPackingCircles(
  nodes: readonly NodeSnapshot[],
  edges: readonly PackingEdge[],
  paper: Pick<PaperSettings, 'height' | 'scale'>
): SendToEditCircle[] {
  return nodes
    .filter((node) => node.is_leaf)
    .map((node) => ({
      cx: node.loc.x,
      cy: paper.height - node.loc.y,
      r: leafCirclePaperRadius(node.id, edges, paper.scale),
    }))
    .filter((circle) => circle.r > 0);
}

/**
 * Bounds of a TreeMaker FOLD export: the paper, which the CP always spans —
 * `to_fold_document` emits the `FOLD_BORDER` creases along its edges.
 */
export function treemakerFoldBounds(
  paper: Pick<PaperSettings, 'width' | 'height'>
): [number, number, number, number] {
  return [0, 0, paper.width, paper.height];
}

/**
 * Whether a BP flap is a circle at all.
 *
 * A flap with a width or a height is not one: its clearance region is the flap
 * rectangle Minkowski-summed with a disc, i.e. a rounded rectangle. See
 * {@link boxPleatPackingCircles} for why those are skipped rather than
 * approximated.
 */
export function isCircularBpFlap(flap: Pick<OristudioBpFlap, 'width' | 'height'>): boolean {
  return flap.width === 0 && flap.height === 0;
}

/**
 * Box-Pleat's packing circles, in the sheet frame with Y flipped to match the
 * `.cp` export. Pair with {@link boxPleatCpBounds}.
 *
 * **Only radius-only flaps produce one.** A flap with a width or a height has a
 * rounded-rectangle clearance region, and the Edit document cannot draw that:
 * `Circle` carries no start/end angle, there is no arc, rect or path primitive,
 * and `import_add` carries only line segments and circles — so aux polylines
 * cannot ride along either, and real creases would be folds that are not folds.
 *
 * The tempting alternative is exact and still wrong. A rectangle Minkowski-summed
 * with a disc *is* the convex hull of its four corner discs, so four circles would
 * carry the region losslessly — but four overlapping discs is precisely what an
 * invalid packing looks like in the BP pane, so one rounded flap would read as
 * four flaps in conflict. Exact and legible are not the same thing here.
 *
 * The frame, not the raw sheet, is the space: `bpPackingSheetFrame` already
 * encodes what `RectangularGrid`/`DiagonalGrid::transform_matrix` do — a uniform
 * scale about the frame's centre, with Y flipped, including the diagonal
 * diamond's half-cell shift on odd sizes. Working in it means this never has to
 * restate `CP_FULL_WIDTH`, `cpScale`, or either grid's offsets; the kernel
 * measures the scale from the bounds.
 */
export function boxPleatPackingCircles(
  flaps: readonly Pick<OristudioBpFlap, 'anchor' | 'width' | 'height' | 'radius'>[],
  sheet: OristudioBpSheet
): SendToEditCircle[] {
  const frame = bpPackingSheetFrame(sheet);
  return flaps
    .filter((flap) => isCircularBpFlap(flap) && flap.radius > 0)
    .map((flap) => ({
      cx: flap.anchor.x - frame.originX,
      cy: frame.spanY - (flap.anchor.y - frame.originY),
      r: flap.radius,
    }));
}

/**
 * Bounds matching {@link boxPleatPackingCircles}: the sheet frame.
 *
 * The `.cp` export opens with `grid.border_path()` (`get_cp_lines`), and that
 * border's bounding box is the frame — a rectangular sheet fills it, and a
 * diagonal sheet's diamond touches all four of its edges.
 */
export function boxPleatCpBounds(sheet: OristudioBpSheet): [number, number, number, number] {
  const frame = bpPackingSheetFrame(sheet);
  return [0, 0, frame.spanX, frame.spanY];
}
