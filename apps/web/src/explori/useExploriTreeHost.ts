import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PlotRect, Point } from '../lib/geometry';
import { useWorkspaceStore } from '../store/workspaceStore';
import { selectExploriDesignOrEmpty } from '../store/workspaceStore/designTabs';
import { createUnboundedTreeFrame } from '../tree-editor/frame';
import type { TreeEditorCopy, TreeEditorHost, TreeSymmetryHost } from '../tree-editor/host';
import { CONTINUOUS_LENGTHS } from '../tree-editor/lengths';
import type { TreeSelectionView } from '../tree-editor/model';
import { exploriEditableTree } from './document';
import {
  EXPLORI_SYMMETRY_AXIS,
  EXPLORI_SYMMETRY_TOLERANCE,
  explicitExploriPairId,
  exploriMirrorHeldIds,
  mirrorExploriNodeId,
} from './symmetry';

/**
 * The ExplOri surface, as the tree editor needs to see it.
 *
 * The whole point of the Phase 0 extraction: this file is what "reuse the
 * box-pleat tree editor" costs. No sheet, no engine, no grid — a scale, a set of
 * intents over plain JSON, and a length rule that admits 1.37.
 */

/** SVG units per tree unit. Same readable scale the box-pleat tree opens at. */
const UNIT_SVG = 56;
const WORLD_PADDING = 60;
/**
 * Smallest span the world may have, in SVG units.
 *
 * A one-node tree has no extent at all, and a two-node one has almost none —
 * without a floor the camera would zoom to absurdity on the first click.
 */
const MIN_WORLD_EXTENT = 6 * UNIT_SVG;
/**
 * How much the world must grow before the camera reframes, in SVG units.
 *
 * Coarse on purpose: a refit is a jump, and one per drawn branch would be worse
 * than a drawing that briefly overflows.
 */
const FIT_STEP = 3 * UNIT_SVG;

function exploriTreeCopy(t: TFunction): TreeEditorCopy {
  return {
    canvas: t('panels:explori.canvas', 'Search tree canvas'),
    viewportControls: t('panels:explori.viewportControls', 'Search tree viewport controls'),
    mirrorDraw: t('panels:explori.mirrorDraw', 'Mirror draw'),
    mirrorDrawOn: t('panels:explori.mirrorDrawOn', 'Mirror draw (on)'),
    unpair: t('panels:explori.unpair', 'Unpair from mirror'),
    layers: t('panels:explori.layers', 'Layers'),
    layerLabels: t('panels:explori.layerLabels', 'Labels'),
    length: t('panels:explori.length', 'Length'),
    decreaseLength: t('panels:explori.decreaseLength', 'Shorten'),
    increaseLength: t('panels:explori.increaseLength', 'Lengthen'),
    edgeTitle: (from, to) => t('panels:explori.edgeTitle', 'Branch {{from}}–{{to}}', { from, to }),
    edgeLengthGroup: (from, to) =>
      t('panels:explori.edgeLengthGroup', 'Length of branch {{from}} to {{to}}', { from, to }),
    selectEdge: (id, length) =>
      t('panels:explori.selectEdge', 'Select branch {{id}}, length {{length}}', { id, length }),
    selectVertex: (id, label) =>
      label
        ? t('panels:explori.selectNodeWithLabel', 'Select node {{id}}, {{label}}', { id, label })
        : t('panels:explori.selectNode', 'Select node {{id}}', { id }),
    nameTitle: (label) => t('panels:explori.nodeTitle', 'Node {{id}}', { id: label }),
    nameAria: (label) => t('panels:explori.nodeNameAria', 'Name of node {{id}}', { id: label }),
  };
}

/**
 * World bounds that hug the drawing.
 *
 * Content bounds rather than a fixed box around the origin: a tree grows away
 * from its root rather than around it, so a box centred on the root puts the
 * drawing in one corner and leaves the opposite one permanently empty.
 */
function worldRectFor(points: readonly Point[], toSvg: (point: Point) => Point): PlotRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    const svg = toSvg(point);
    minX = Math.min(minX, svg.x);
    minY = Math.min(minY, svg.y);
    maxX = Math.max(maxX, svg.x);
    maxY = Math.max(maxY, svg.y);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const halfWidth = Math.max((maxX - minX) / 2 + WORLD_PADDING, MIN_WORLD_EXTENT / 2);
  const halfHeight = Math.max((maxY - minY) / 2 + WORLD_PADDING, MIN_WORLD_EXTENT / 2);
  return {
    x: centerX - halfWidth,
    y: centerY - halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
  };
}

export function useExploriTreeHost(): TreeEditorHost {
  const { t } = useTranslation();
  const design = useWorkspaceStore((state) => selectExploriDesignOrEmpty(state));
  const document = design.document;
  const setSelection = useWorkspaceStore((state) => state.setExploriTreeSelection);
  const addLeaf = useWorkspaceStore((state) => state.addExploriLeaf);
  const moveNodes = useWorkspaceStore((state) => state.moveExploriNodes);
  const renameNode = useWorkspaceStore((state) => state.renameExploriNode);
  const setEdgeLength = useWorkspaceStore((state) => state.setExploriEdgeLength);
  const toggleSymmetry = useWorkspaceStore((state) => state.toggleExploriSymmetry);
  const unpairNode = useWorkspaceStore((state) => state.unpairExploriNode);
  // Labels are a view preference with no reason to outlive the pane, unlike
  // box-pleat's, which is shared with its packing view through settings.
  const [labels, setLabels] = useState(true);

  const tree = useMemo(() => exploriEditableTree(document), [document]);

  const frame = useMemo(() => {
    const origin = { x: 0, y: 0 };
    const toSvg = (point: Point) => ({
      x: origin.x + point.x * UNIT_SVG,
      y: origin.y - point.y * UNIT_SVG,
    });
    return createUnboundedTreeFrame({
      unitSvg: UNIT_SVG,
      origin,
      worldRect: worldRectFor(
        document.nodes.map((node) => node.loc),
        toSvg
      ),
    });
  }, [document.nodes]);

  const selection = useMemo<TreeSelectionView>(() => {
    const target = design.selection;
    return {
      vertexId: target?.kind === 'vertex' ? target.id : null,
      edgeId: target?.kind === 'edge' ? target.id : null,
      vertices: new Set(target?.kind === 'vertex' ? [target.id] : []),
      edges: new Set(target?.kind === 'edge' ? [target.id] : []),
    };
  }, [design.selection]);

  const symmetry = useMemo<TreeSymmetryHost>(() => {
    const svgOf = (point: Point) => frame.toSvg(point);
    // Clipped to the world the camera frames, so the line ends where the
    // drawing does rather than running off into space.
    const top = { x: svgOf({ x: 0, y: 0 }).x, y: frame.worldRect.y };
    const bottom = { x: top.x, y: frame.worldRect.y + frame.worldRect.height };
    return {
      enabled: document.symmetry.enabled,
      toggle: () => void toggleSymmetry(),
      axis: EXPLORI_SYMMETRY_AXIS,
      // Drawn whether or not the toggle is on: the line is where the pairs
      // already are, and hiding it would leave the segments joining them
      // pointing at nothing.
      axisLine: { x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y },
      pairs: document.symmetry.pairs,
      partnerOf: (nodeId) => explicitExploriPairId(document.symmetry.pairs, nodeId),
      resolveMirrorOf: (nodeId) => mirrorExploriNodeId(document, nodeId),
      isOnAxis: (nodeId) => {
        if (!document.symmetry.enabled) return false;
        const loc = document.nodes.find((node) => node.id === nodeId)?.loc;
        return !!loc && Math.abs(loc.x) <= EXPLORI_SYMMETRY_TOLERANCE;
      },
      unpair: (nodeId) => void unpairNode(nodeId),
      dragMirror: (movedIds) => {
        const heldIds = exploriMirrorHeldIds(document, movedIds);
        return heldIds.size === 0
          ? null
          : { axis: EXPLORI_SYMMETRY_AXIS, heldIds, clearance: EXPLORI_SYMMETRY_TOLERANCE };
      },
    };
  }, [document, frame, toggleSymmetry, unpairNode]);

  return useMemo<TreeEditorHost>(
    () => ({
      tree,
      frame,
      lengths: CONTINUOUS_LENGTHS,
      copy: exploriTreeCopy(t),
      classPrefix: 'explori-tree',
      surface: 'tree',
      // Refit when the drawing outgrows the frame, not on every edit.
      //
      // Box-pleat can key this on the document alone because its world is a
      // fixed sheet; a search tree has no sheet and grows without bound, so a
      // camera that fit once would let the drawing wander off the pane. Bucketing
      // the world's extent refits exactly when it no longer fits, and leaves the
      // camera alone for every edit that happens within the frame.
      fitKey: `explori:${Math.round(frame.worldRect.width / FIT_STEP)}x${Math.round(
        frame.worldRect.height / FIT_STEP
      )}`,
      selection,
      select: (target) => setSelection(target),
      // Clicking a selected node again clears it, which is what disarms adding.
      toggleSelection: (target) =>
        setSelection(
          (target.kind === 'vertex' ? selection.vertexId : selection.edgeId) === target.id
            ? null
            : target
        ),
      clearSelection: () => setSelection(null),
      addLeaf: async (parentId, loc, axisTolerance) => {
        await addLeaf(parentId, loc, axisTolerance);
      },
      moveVertices: async (updates) => {
        await moveNodes(updates);
      },
      setEdgeLength: async (lengths, repositions) => {
        const change = lengths[0];
        if (!change) return;
        await setEdgeLength(change.edgeId, change.length, repositions);
      },
      renameVertex: async (nodeId, name) => {
        await renameNode(nodeId, name);
      },
      labelOf: (vertex) => vertex.name,
      defaultLabelOf: (vertex) => `${vertex.id}`,
      // Every node can carry a name here: an interior node of a search tree is a
      // river, and naming it is as useful as naming a flap.
      isNameable: () => true,
      symmetry,
      layers: { labels },
      setLayer: (_layer, visible) => setLabels(visible),
    }),
    [
      tree,
      frame,
      t,
      selection,
      setSelection,
      addLeaf,
      moveNodes,
      setEdgeLength,
      renameNode,
      symmetry,
      labels,
    ]
  );
}
