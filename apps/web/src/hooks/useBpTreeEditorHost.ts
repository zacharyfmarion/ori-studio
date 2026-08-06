import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { OristudioBpDocumentState } from '../engine/oristudioBpTypes';
import { bpDefaultFlapLabel } from '../lib/bpFlapLabel';
import {
  bpLinkedSelection,
  toggleBpEdgeSelection,
  toggleBpVertexSelection,
} from '../lib/oristudioBpSelection';
import {
  bpTreePaperRect,
  bpTreePointToSvg,
  bpTreeUnitToSvg,
  bpTreeVertexLabel,
  constrainBpTreePoint,
  getBpTreeWorldRect,
  svgToBpTreePoint,
} from '../lib/bpTreeViewport';
import { useBpLongPressInspector } from './useBpLongPressInspector';
import { useBpTreeSymmetry } from './useBpTreeSymmetry';
import { useSettingsStore } from '../store/settingsStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { selectOristudioBpSelection } from '../store/workspaceStore/designTabs';
import type { TreeEditorCopy, TreeEditorHost } from '../tree-editor/host';
import type { TreeFrame } from '../tree-editor/frame';
import { SNAPPED_LENGTHS } from '../tree-editor/lengths';
import type { TreeSelectionView } from '../tree-editor/model';

/**
 * The box-pleat surface, as the tree editor needs to see it.
 *
 * Every store binding the pane used to hold lives here: the eight actions, the
 * selection union with its flap/river linking, the settings slice, the sheet the
 * coordinates are measured against, and the inspector. The editor gets a tree, a
 * frame, and a set of intents.
 *
 * Default so a unit-length edge is ~this many screen pixels. Node dots and
 * labels are drawn at fixed screen sizes (counter-scaled by the zoom) so they
 * stay small relative to the geometry at any zoom.
 */
const TARGET_UNIT_PX = 56;

/** Localized copy. Literal `t()` calls, so `i18n:extract` can still see them. */
function bpTreeCopy(t: TFunction): TreeEditorCopy {
  return {
    canvas: t('panels:bpTree.canvas', 'Box Pleat tree canvas'),
    viewportControls: t('panels:bpTree.viewportControls', 'Box Pleat tree viewport controls'),
    mirrorDraw: t('panels:bpTree.mirrorDraw', 'Mirror draw'),
    mirrorDrawOn: t('panels:bpTree.mirrorDrawOn', 'Mirror draw (on)'),
    unpair: t('panels:bpTree.unpair', 'Unpair from mirror'),
    layers: t('panels:bpTree.layers', 'Layers'),
    layerLabels: t('panels:bpTree.layerLabels', 'Labels'),
    length: t('panels:bpTree.length', 'Length'),
    decreaseLength: t('panels:bpTree.decreaseLength', 'Decrease length'),
    increaseLength: t('panels:bpTree.increaseLength', 'Increase length'),
    edgeTitle: (from, to) => t('panels:bpTree.edgeTitle', 'Edge {{from}}–{{to}}', { from, to }),
    edgeLengthGroup: (from, to) =>
      t('panels:bpTree.edgeLengthGroup', 'Length of edge {{from}} to {{to}}', { from, to }),
    selectEdge: (id, length) =>
      t('panels:bpTree.selectEdge', 'Select BP edge {{id}}, length {{length}}', { id, length }),
    selectVertex: (id, label, isLeaf) => {
      if (isLeaf) {
        return label
          ? t('panels:bpTree.selectLeafVertexWithLabel', 'Select BP leaf vertex {{id}}, {{label}}', {
              id,
              label,
            })
          : t('panels:bpTree.selectLeafVertex', 'Select BP leaf vertex {{id}}', { id });
      }
      return label
        ? t('panels:bpTree.selectVertexWithLabel', 'Select BP vertex {{id}}, {{label}}', {
            id,
            label,
          })
        : t('panels:bpTree.selectVertex', 'Select BP vertex {{id}}', { id });
    },
    nameTitle: (label) => t('panels:bpTree.flapTitle', 'Flap {{id}}', { id: label }),
    nameAria: (label) => t('panels:bpTree.flapNameAria', 'Name of flap {{id}}', { id: label }),
  };
}

export function useBpTreeEditorHost(document: OristudioBpDocumentState): TreeEditorHost {
  const { t } = useTranslation();
  const tree = document.snapshot.tree;

  const layers = useSettingsStore((state) => state.bpTreeLayers);
  const setLayer = useSettingsStore((state) => state.setBpTreeLayer);
  const selectOristudioBp = useWorkspaceStore((state) => state.selectOristudioBp);
  const selection = useWorkspaceStore((state) => selectOristudioBpSelection(state));
  const clearSelection = useWorkspaceStore((state) => state.clearOristudioBpSelection);
  const addOristudioBpTreeLeaf = useWorkspaceStore((state) => state.addOristudioBpTreeLeaf);
  const setOristudioBpTreeEdgeLength = useWorkspaceStore(
    (state) => state.setOristudioBpTreeEdgeLength
  );
  const renameOristudioBpVertex = useWorkspaceStore((state) => state.renameOristudioBpVertex);
  const setOristudioBpActiveSurface = useWorkspaceStore(
    (state) => state.setOristudioBpActiveSurface
  );
  const addOristudioBpTreeLeafWithSymmetry = useWorkspaceStore(
    (state) => state.addOristudioBpTreeLeafWithSymmetry
  );
  const moveOristudioBpTreeVerticesWithSymmetry = useWorkspaceStore(
    (state) => state.moveOristudioBpTreeVerticesWithSymmetry
  );
  const scheduleLongPressInspector = useBpLongPressInspector();

  const paperRect = useMemo(() => bpTreePaperRect(tree.sheet), [tree.sheet]);
  const symmetryView = useBpTreeSymmetry(tree, paperRect);

  // Fit to the committed tree bounds only (not the drag preview) so the camera
  // stays put while a flap rotates. Tight padding keeps a unit edge large.
  const worldRect = useMemo(
    () => getBpTreeWorldRect(tree, { contentOnly: true, padding: 12 }),
    [tree]
  );

  const frame = useMemo<TreeFrame>(
    () => ({
      toSvg: (point) => bpTreePointToSvg(point, tree.sheet, paperRect),
      fromSvg: (point) => svgToBpTreePoint(point, tree.sheet, paperRect),
      constrain: (point) => constrainBpTreePoint(point, tree.sheet),
      unitSvg: bpTreeUnitToSvg(tree.sheet, paperRect),
      worldRect,
    }),
    [tree.sheet, paperRect, worldRect]
  );

  const selectionView = useMemo<TreeSelectionView>(() => {
    const linked = bpLinkedSelection(selection, document);
    return {
      vertexId: selection.kind === 'bp-vertex' ? selection.id : null,
      edgeId: selection.kind === 'bp-edge' ? selection.id : null,
      vertices: linked.vertices,
      edges: linked.edges,
    };
  }, [selection, document]);

  const symmetryEnabled = symmetryView.enabled;

  return useMemo<TreeEditorHost>(
    () => ({
      tree,
      frame,
      lengths: SNAPPED_LENGTHS,
      copy: bpTreeCopy(t),
      classPrefix: 'bp-tree',
      surface: 'tree',
      fitKey: `${document.handle}:${document.source.filename}`,
      // Open at a fixed readable scale (1 tree unit ≈ TARGET_UNIT_PX) rather than
      // filling the pane with a tiny tree; the shared surface only zooms further
      // out when the tree no longer fits at that scale.
      maxFitScale: TARGET_UNIT_PX / bpTreeUnitToSvg(tree.sheet),
      selection: selectionView,
      select: (target) =>
        selectOristudioBp(
          target.kind === 'vertex'
            ? { kind: 'bp-vertex', id: target.id }
            : { kind: 'bp-edge', id: target.id }
        ),
      toggleSelection: (target) =>
        selectOristudioBp(
          target.kind === 'vertex'
            ? toggleBpVertexSelection(selection, target.id)
            : toggleBpEdgeSelection(selection, target.id)
        ),
      clearSelection,
      addLeaf: async (parentId, loc, axisTolerance) => {
        if (symmetryEnabled) await addOristudioBpTreeLeafWithSymmetry(parentId, loc, axisTolerance);
        else await addOristudioBpTreeLeaf(parentId, loc);
      },
      // Always the mirrored action: it moves nothing extra when the dragged
      // vertices have no partners, and a pair must follow whether or not the user
      // is currently drawing symmetrically.
      moveVertices: async (updates) => {
        await moveOristudioBpTreeVerticesWithSymmetry([...updates], false);
      },
      setEdgeLength: async (lengths, repositions) => {
        const change = lengths[0];
        if (!change) return;
        const edge = tree.edges.find((candidate) => candidate.id === change.edgeId);
        if (!edge) return;
        await setOristudioBpTreeEdgeLength(edge.vertices, change.length, [...repositions]);
      },
      renameVertex: async (vertexId, name) => {
        await renameOristudioBpVertex(vertexId, name);
      },
      labelOf: bpTreeVertexLabel,
      defaultLabelOf: (vertex) => bpDefaultFlapLabel(vertex.id),
      // Only leaves are nameable: internal vertices are rivers, which aren't
      // worth labeling.
      isNameable: (vertex) => vertex.isLeaf,
      symmetry: symmetryView,
      layers,
      setLayer,
      onSurfaceFocused: () => setOristudioBpActiveSurface('tree'),
      onLongPress: scheduleLongPressInspector,
    }),
    [
      tree,
      frame,
      t,
      document.handle,
      document.source.filename,
      selectionView,
      selection,
      selectOristudioBp,
      clearSelection,
      symmetryEnabled,
      addOristudioBpTreeLeafWithSymmetry,
      addOristudioBpTreeLeaf,
      moveOristudioBpTreeVerticesWithSymmetry,
      setOristudioBpTreeEdgeLength,
      renameOristudioBpVertex,
      symmetryView,
      layers,
      setLayer,
      setOristudioBpActiveSurface,
      scheduleLongPressInspector,
    ]
  );
}
