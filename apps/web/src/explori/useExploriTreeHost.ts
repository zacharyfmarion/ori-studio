import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useWorkspaceStore } from '../store/workspaceStore';
import { selectExploriDesignOrEmpty } from '../store/workspaceStore/designTabs';
import { centeredTreeFitRect, createCenteredTreeFrame } from '../tree-editor/frame';
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
/**
 * Half the drawing area, in tree units — a 48-unit square.
 *
 * Fixed, and that is the point: a world that grew with the drawing resized the
 * SVG under a camera that did not, so every added node shifted the view. The
 * camera fits this once and no edit can move it again.
 *
 * Fixed is not the same as small, though it used to be: the fit divided the pane
 * by the *whole* world, so a generous drawing area bought an opening zoom nobody
 * wanted, and this was 8. `fitRect` below now sizes the opening zoom from the
 * drawing instead, which leaves this free to be a ceiling on how big a tree can
 * get rather than a compromise with the camera. A drag sets an edge's length as
 * well as its direction, so it is a ceiling on branch length too — 24 is room
 * for a far bigger tree than the archive holds, and raising it further costs
 * only SVG element size.
 */
const HALF_EXTENT = 24;
/**
 * How close the opening camera will get, as a half-width in tree units.
 *
 * A one-node tree has no extent to fit, and a two-node one barely more; without
 * a floor the fit would magnify a stub until the canvas told the user nothing
 * about the scale they are drawing at. 6 units is roughly the old opening view.
 */
const FIT_MIN_HALF_SPAN = 6;
/** Room left around the outermost node when fitting, in tree units. */
const FIT_PADDING = 1;

function exploriTreeCopy(t: TFunction): TreeEditorCopy {
  return {
    canvas: t('panels:explori.canvas', 'Search tree canvas'),
    viewportControls: t('panels:explori.viewportControls', 'Search tree viewport controls'),
    mirrorDraw: t('panels:explori.mirrorDraw', 'Mirror draw'),
    symmetry: t('panels:explori.symmetry', 'Symmetry'),
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

  // Built once: it depends on nothing that an edit changes.
  const frame = useMemo(
    () => createCenteredTreeFrame({ unitSvg: UNIT_SVG, halfExtent: HALF_EXTENT }),
    [],
  );

  // What the camera opens on: the drawing, not the whole drawing area. Recomputed
  // freely on every edit — `fitKey` is what decides when a fit happens, and it is
  // constant here, so this cannot pull the camera out from under an edit. It is
  // read again when the user asks to fit, which is when they want the drawing
  // framed.
  const fitRect = useMemo(
    () =>
      centeredTreeFitRect(
        document.nodes.map((node) => node.loc),
        { unitSvg: UNIT_SVG, minHalfSpan: FIT_MIN_HALF_SPAN, padding: FIT_PADDING },
      ),
    [document.nodes],
  );

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
    // Corner to corner of the world, which is fixed — so the line spans the whole
    // canvas rather than only as far as the drawing happens to reach.
    const x = frame.toSvg({ x: 0, y: 0 }).x;
    const top = frame.worldRect.y;
    const bottom = frame.worldRect.y + frame.worldRect.height;
    return {
      enabled: document.symmetry.enabled,
      toggle: () => void toggleSymmetry(),
      axis: EXPLORI_SYMMETRY_AXIS,
      // Hidden with the toggle, as box-pleat's is: a mirror line drawn while
      // mirror draw is off describes a rule that is not in force.
      axisLine: document.symmetry.enabled ? { x1: x, y1: top, x2: x, y2: bottom } : null,
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
        // Gated on the toggle, like `isOnAxis` above and like the preview and
        // the commit. Pairings deliberately outlive the toggle, so without this
        // a node paired while mirror draw was on stayed walled off from the
        // centre after it was turned off — and turning it off is precisely how
        // you break a symmetry you no longer want.
        if (!document.symmetry.enabled) return null;
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
      // Constant, so the camera fits once when the pane opens and never again.
      // No node operation may move the view.
      fitKey: 'explori',
      fitRect,
      selection,
      select: (target) => setSelection(target),
      // Clicking a selected node again clears it, which is what disarms adding.
      toggleSelection: (target) =>
        setSelection(
          (target.kind === 'vertex' ? selection.vertexId : selection.edgeId) === target.id
            ? null
            : target,
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
      // The length here is read out of the drawing rather than authored, so the
      // number beside every branch is a readout of what the branch already shows
      // — and a noisy one, since it is a real number that moves on every drag.
      // Node names, which are authored, still draw.
      showEdgeLengths: false,
    }),
    [
      tree,
      frame,
      fitRect,
      t,
      selection,
      setSelection,
      addLeaf,
      moveNodes,
      setEdgeLength,
      renameNode,
      symmetry,
      labels,
    ],
  );
}
