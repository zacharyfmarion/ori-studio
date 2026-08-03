import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { FlipHorizontal2, Minus, Plus, Tag, Unlink } from 'lucide-react';
import type {
  OristudioBpDocumentState,
  OristudioBpTreeEdge,
} from '../../engine/oristudioBpTypes';
import {
  bpLinkedSelection,
  toggleBpEdgeSelection,
  toggleBpVertexSelection,
} from '../../lib/oristudioBpSelection';
import {
  bpTreePaperRect,
  bpTreePointToSvg,
  bpTreeUnitToSvg,
  constrainBpTreePoint,
  getBpTreeWorldRect,
  svgToBpTreePoint,
} from '../../lib/bpTreeViewport';
import { bpDefaultFlapLabel } from '../../lib/bpFlapLabel';
import { hasPassedDragThreshold } from '../../lib/pointerGesture';
import { formatNumber, type Point } from '../../lib/geometry';
import {
  BpTreeScene,
  DOT_SIZES,
  SYMMETRY_GHOST_PX,
  SYMMETRY_LANE_PX,
} from './BpTreeScene';
import {
  bpTreeDragUpdates,
  translatePoints,
  unitLeafLocation,
} from '../../lib/bpTreeAuthoring';
import {
  mirrorBpTreeVertexId,
  BP_TREE_SYMMETRY_TOLERANCE,
} from '../../lib/bpTreeSymmetry';
import {
  reflectPointAcrossSymmetryAxis,
  snapPointToSymmetryAxis,
} from '../../lib/symmetryGeometry';
import { useBpTreeSymmetry } from '../../hooks/useBpTreeSymmetry';
import { type BpTreeViewLayerKey, type BpTreeViewLayers } from '../../lib/oristudioBpViewportSettings';
import { clientPointToDesignWorld } from '../../lib/designViewport';
import { setActiveShortcutViewportSurface } from '../../keyboard/shortcutRuntime';
import { useBpLongPressInspector } from '../../hooks/useBpLongPressInspector';
import { useEventCallback } from '../../hooks/useEventCallback';
import {
  useViewportSurface,
  VIEWPORT_PINCH_ZOOM,
  VIEWPORT_WHEEL_ZOOM,
} from '../../hooks/useViewportSurface';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { IconButton } from '../ui/IconButton';
import { BpNameEditor } from './BpNameEditor';
import {
  isViewportInteractiveTarget,
  ViewportLayerMenu,
  ViewportToolbar,
  ViewportToolbarSeparator,
} from './ViewportToolbar';

const LAYER_OPTIONS: { key: BpTreeViewLayerKey; icon: ReactNode }[] = [
  { key: 'labels', icon: <Tag size={13} /> },
];

/** Localized BP-tree layer label. Literal `t()` calls keep the keys extractable. */
function bpTreeLayerLabel(t: TFunction, key: BpTreeViewLayerKey): string {
  switch (key) {
    case 'labels':
      return t('panels:bpTree.layerLabels', 'Labels');
    default:
      return key;
  }
}


// Default so a unit-length edge is ~this many screen pixels. Node dots and
// labels are drawn at fixed screen sizes (counter-scaled by the zoom) so they
// stay small relative to the geometry at any zoom.
const TARGET_UNIT_PX = 56;

function BpTreeViewportToolbar({
  zoomPercent,
  layers,
  onLayerChange,
  symmetryEnabled,
  onSymmetryToggle,
  canUnpair,
  onUnpair,
  zoomIn,
  zoomOut,
  fitToView,
  setZoomLevel,
}: {
  zoomPercent: number;
  layers: BpTreeViewLayers;
  onLayerChange: (layer: BpTreeViewLayerKey, visible: boolean) => void;
  symmetryEnabled: boolean;
  onSymmetryToggle: () => void;
  canUnpair: boolean;
  onUnpair: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
  setZoomLevel: (scale: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <ViewportToolbar
      ariaLabel={t('panels:bpTree.viewportControls', 'Box Pleat tree viewport controls')}
      zoomPercent={zoomPercent}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      fitToView={fitToView}
      setZoomLevel={setZoomLevel}
    >
      <ViewportToolbarSeparator />
      <IconButton
        size="sm"
        variant="toolbar"
        title={
          symmetryEnabled
            ? t('panels:bpTree.mirrorDrawOn', 'Mirror draw (on)')
            : t('panels:bpTree.mirrorDraw', 'Mirror draw')
        }
        isActive={symmetryEnabled}
        onClick={onSymmetryToggle}
      >
        <FlipHorizontal2 size={14} />
      </IconButton>
      {canUnpair && (
        <IconButton
          size="sm"
          variant="toolbar"
          title={t('panels:bpTree.unpair', 'Unpair from mirror')}
          onClick={onUnpair}
        >
          <Unlink size={14} />
        </IconButton>
      )}
      <ViewportToolbarSeparator />
      <ViewportLayerMenu
        title={t('panels:bpTree.layers', 'Layers')}
        options={LAYER_OPTIONS.map((option) => ({
          ...option,
          label: bpTreeLayerLabel(t, option.key),
        }))}
        visible={layers}
        onChange={onLayerChange}
      />
    </ViewportToolbar>
  );
}

/**
 * Contextual editor for a selected tree edge's length. BP flap/river lengths are
 * the tree edge lengths, and the engine enforces a minimum of 1.
 *
 * `edge.maxLength` clamps the field but is deliberately not shown. It is not a
 * design constraint -- it is BP Studio's `MAX_TREE_HEIGHT` overflow guard
 * (`ceil(8192 * sqrt(2))`, the longest span of a max-size sheet) less the depth
 * the branch already spends, so it reads as a meaningless five-digit number.
 * Upstream passes it to the number field's `max` and never renders it either;
 * see `third_party/box-pleating-studio/src/app/vue/panel/edge.vue`.
 */
function BpTreeEdgeLengthEditor({
  edge,
  onSetLength,
  onEscape,
}: {
  edge: OristudioBpTreeEdge;
  onSetLength: (length: number) => void;
  onEscape?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => formatNumber(edge.length, 2));
  useEffect(() => {
    setDraft(formatNumber(edge.length, 2));
  }, [edge.id, edge.length]);

  const max = edge.maxLength;
  const commit = (value: number) => {
    if (!Number.isFinite(value)) {
      setDraft(formatNumber(edge.length, 2));
      return;
    }
    const clamped = Math.min(max ?? value, Math.max(1, value));
    if (clamped !== edge.length) onSetLength(clamped);
    else setDraft(formatNumber(edge.length, 2));
  };

  return (
    <div
      className="bp-tree-edge-editor"
      role="group"
      aria-label={t('panels:bpTree.edgeLengthGroup', 'Length of edge {{from}} to {{to}}', {
        from: edge.vertices[0],
        to: edge.vertices[1],
      })}
    >
      <span className="bp-tree-edge-editor__title">
        {t('panels:bpTree.edgeTitle', 'Edge {{from}}–{{to}}', {
          from: edge.vertices[0],
          to: edge.vertices[1],
        })}
      </span>
      <span className="bp-tree-edge-editor__label">{t('panels:bpTree.length', 'Length')}</span>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:bpTree.decreaseLength', 'Decrease length')}
        disabled={edge.length <= 1}
        onClick={() => commit(Math.round(edge.length) - 1)}
      >
        <Minus size={14} />
      </IconButton>
      <input
        className="bp-tree-edge-editor__input"
        type="number"
        min={1}
        max={max ?? undefined}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(Number.parseFloat(draft))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit(Number.parseFloat(draft));
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(formatNumber(edge.length, 2));
            event.currentTarget.blur();
            onEscape?.();
          }
        }}
      />
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:bpTree.increaseLength', 'Increase length')}
        disabled={max !== null && edge.length >= max}
        onClick={() => commit(Math.round(edge.length) + 1)}
      >
        <Plus size={14} />
      </IconButton>
    </div>
  );
}

export function BpTreePanel({ document }: { document: OristudioBpDocumentState }) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<{
    id: number;
    start: Point;
    clientStart: Point;
    moved: boolean;
    preview: Map<number, Point>;
  } | null>(null);
  const paperDownRef = useRef<{ clientX: number; clientY: number; point: Point } | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const scheduleLongPressInspector = useBpLongPressInspector();
  const layers = useSettingsStore((state) => state.bpTreeLayers);
  const setLayer = useSettingsStore((state) => state.setBpTreeLayer);
  const selectOristudioBp = useWorkspaceStore((state) => state.selectOristudioBp);
  const selection = useWorkspaceStore((state) => state.oristudioBpSelection);
  const clearSelection = useWorkspaceStore((state) => state.clearOristudioBpSelection);
  const moveOristudioBpTreeVertices = useWorkspaceStore(
    (state) => state.moveOristudioBpTreeVertices
  );
  const addOristudioBpTreeLeaf = useWorkspaceStore((state) => state.addOristudioBpTreeLeaf);
  const setOristudioBpTreeEdgeLength = useWorkspaceStore(
    (state) => state.setOristudioBpTreeEdgeLength
  );
  const renameOristudioBpVertex = useWorkspaceStore((state) => state.renameOristudioBpVertex);
  const setOristudioBpActiveSurface = useWorkspaceStore(
    (state) => state.setOristudioBpActiveSurface
  );
  const symmetry = useWorkspaceStore((state) => state.oristudioBpSymmetry);
  const addOristudioBpTreeLeafWithSymmetry = useWorkspaceStore(
    (state) => state.addOristudioBpTreeLeafWithSymmetry
  );
  const moveOristudioBpTreeVerticesWithSymmetry = useWorkspaceStore(
    (state) => state.moveOristudioBpTreeVerticesWithSymmetry
  );
  const tree = document.snapshot.tree;
  const selectedVertexId = selection.kind === 'bp-vertex' ? selection.id : null;
  // The edge selected by clicking a tree segment — drives the length editor.
  const selectedEdge = useMemo(() => {
    const id = selection.kind === 'bp-edge' ? selection.id : null;
    if (id === null) return null;
    return tree.edges.find((edge) => edge.id === id) ?? null;
  }, [selection, tree.edges]);
  // The selected leaf vertex (a flap) — drives the name editor. Only leaves are
  // nameable: internal vertices are rivers, which aren't worth labeling.
  const selectedFlapVertex = useMemo(() => {
    if (selectedVertexId === null) return null;
    const vertex = tree.vertices.find((v) => v.id === selectedVertexId) ?? null;
    return vertex?.isLeaf ? vertex : null;
  }, [selectedVertexId, tree.vertices]);

  // Parent/children maps rooted at the tree root, for rotate-around-parent drags.
  const topology = useMemo(() => {
    const adjacency = new Map<number, number[]>();
    for (const vertex of tree.vertices) adjacency.set(vertex.id, []);
    for (const edge of tree.edges) {
      const [a, b] = edge.vertices;
      adjacency.get(a)?.push(b);
      adjacency.get(b)?.push(a);
    }
    const parent = new Map<number, number | null>();
    const children = new Map<number, number[]>();
    const root = tree.rootVertexId;
    if (root !== null) {
      parent.set(root, null);
      children.set(root, []);
      const queue = [root];
      while (queue.length > 0) {
        const current = queue.shift() as number;
        for (const neighbor of adjacency.get(current) ?? []) {
          if (parent.has(neighbor)) continue;
          parent.set(neighbor, current);
          children.set(neighbor, []);
          children.get(current)?.push(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return { parent, children };
  }, [tree.vertices, tree.edges, tree.rootVertexId]);

  // Vertex locations by id — the lookup the drag rule works from.
  const vertexLocationsById = useMemo(
    () => new Map(tree.vertices.map((vertex) => [vertex.id, vertex.loc] as const)),
    [tree.vertices]
  );

  const subtreeOf = useCallback(
    (id: number): number[] => {
      const out: number[] = [];
      const stack = [id];
      while (stack.length > 0) {
        const current = stack.pop() as number;
        out.push(current);
        for (const child of topology.children.get(current) ?? []) stack.push(child);
      }
      return out;
    },
    [topology]
  );
  // The vertex a canvas click attaches a new leaf to. This is exactly the
  // selected vertex — with no fallback to the root, so a tree opens inert and
  // clearing the selection disarms adding, and the hover ghost and the click
  // can't disagree about where the leaf would land.
  const addAnchorId = selectedVertexId;
  const linkedSelection = useMemo(
    () => bpLinkedSelection(selection, document),
    [selection, document]
  );
  const paperRect = useMemo(() => bpTreePaperRect(tree.sheet), [tree.sheet]);
  const vertexLocations = useMemo(() => dragging?.preview, [dragging]);
  // Fit to the committed tree bounds only (not the drag preview) so the camera
  // stays put while a flap rotates. Tight padding keeps a unit edge large.
  const worldRect = useMemo(
    () => getBpTreeWorldRect(tree, { contentOnly: true, padding: 12 }),
    [tree]
  );

  // Open at a fixed readable scale (1 tree unit ≈ TARGET_UNIT_PX) rather than
  // filling the pane with a tiny tree; the shared surface only zooms further out
  // when the tree no longer fits at that scale.
  const maxFitScale = TARGET_UNIT_PX / bpTreeUnitToSvg(tree.sheet);
  const {
    containerRef,
    transformRef,
    zoomPercent,
    spacePressed,
    zoomIn,
    zoomOut,
    fitToView,
    setZoomLevel,
    onInit,
    onTransformed,
  } = useViewportSurface({
    surface: 'tree',
    worldRect,
    fitKey: `${document.handle}:${document.source.filename}`,
    maxFitScale,
  });

  // Convert a target screen-pixel size into SVG units at the current zoom, so
  // dots/labels keep a constant on-screen size regardless of zoom.
  const svgPerScreenPx = Math.max(0.02, zoomPercent / 100);
  const chromePx = useCallback((px: number) => px / svgPerScreenPx, [svgPerScreenPx]);
  // Half the visible snap band, in tree units. A tip landing inside it snaps onto
  // the axis — so this is derived from the band's *drawn* width, keeping what the
  // user sees and what the click does the same thing at every zoom.
  const symmetryAxisTolerance =
    chromePx(SYMMETRY_LANE_PX) / 2 / bpTreeUnitToSvg(tree.sheet, paperRect);

  const findVertex = useCallback(
    (id: number) => tree.vertices.find((vertex) => vertex.id === id),
    [tree.vertices]
  );
  const symmetryView = useBpTreeSymmetry(tree, paperRect);

  // Ghost preview of the leaf a click would add (and its mirror), mirroring what
  // addOristudioBpTreeLeafWithSymmetry will do: an on-axis tip is a single centred
  // leaf; otherwise it reflects onto the parent's mirror.
  const symmetryHoverPreview = useMemo(() => {
    if (!symmetry.enabled || dragging || !hoverPoint) return null;
    const parentId = addAnchorId;
    if (parentId === null) return null;
    const parent = findVertex(parentId);
    if (!parent) return null;
    const axis = { loc: symmetry.loc, angle: symmetry.angle };
    const axisTolerance = symmetryAxisTolerance;
    const tip = constrainBpTreePoint(unitLeafLocation(parent.loc, hoverPoint), tree.sheet);
    const snap = snapPointToSymmetryAxis(tip, axis, axisTolerance);
    const primaryTip = snap.point;
    let mirror: { from: Point; to: Point } | null = null;
    let unresolved = false;
    if (!snap.snapped) {
      const mirrorParentId = mirrorBpTreeVertexId(
        tree,
        symmetry.pairs,
        axis,
        parentId,
        BP_TREE_SYMMETRY_TOLERANCE
      );
      const mirrorParent = mirrorParentId != null ? findVertex(mirrorParentId) : undefined;
      if (mirrorParent) {
        mirror = { from: mirrorParent.loc, to: reflectPointAcrossSymmetryAxis(primaryTip, axis) };
      } else {
        unresolved = true;
      }
    }
    return {
      primary: { from: parent.loc, to: primaryTip },
      mirror,
      snapped: snap.snapped,
      unresolved,
    };
  }, [
    symmetry.enabled,
    symmetry.loc,
    symmetry.angle,
    symmetry.pairs,
    dragging,
    hoverPoint,
    addAnchorId,
    symmetryAxisTolerance,
    tree,
    findVertex,
  ]);

  const symmetryGhost = useMemo(() => {
    if (!symmetryHoverPreview) return null;
    const seg = (from: Point, to: Point) => ({
      from: bpTreePointToSvg(from, tree.sheet, paperRect),
      to: bpTreePointToSvg(to, tree.sheet, paperRect),
    });
    const primary = seg(symmetryHoverPreview.primary.from, symmetryHoverPreview.primary.to);
    const mirror = symmetryHoverPreview.mirror
      ? seg(symmetryHoverPreview.mirror.from, symmetryHoverPreview.mirror.to)
      : null;
    return (
      <g className="symmetry-ghost">
        <line
          className={[
            'symmetry-ghost-edge',
            symmetryHoverPreview.unresolved ? 'symmetry-ghost-edge--unresolved' : '',
          ].join(' ')}
          style={{ strokeWidth: chromePx(SYMMETRY_GHOST_PX) }}
          x1={primary.from.x}
          y1={primary.from.y}
          x2={primary.to.x}
          y2={primary.to.y}
        />
        <circle
          className="symmetry-ghost-node"
          data-snapped={symmetryHoverPreview.snapped || undefined}
          cx={primary.to.x}
          cy={primary.to.y}
          r={chromePx(DOT_SIZES.leafPx)}
        />
        {mirror && (
          <>
            <line
              className="symmetry-ghost-edge"
              style={{ strokeWidth: chromePx(SYMMETRY_GHOST_PX) }}
              x1={mirror.from.x}
              y1={mirror.from.y}
              x2={mirror.to.x}
              y2={mirror.to.y}
            />
            <circle
              className="symmetry-ghost-node"
              cx={mirror.to.x}
              cy={mirror.to.y}
              r={chromePx(DOT_SIZES.leafPx)}
            />
          </>
        )}
      </g>
    );
    // `chromePx` is derived fresh each render; the camera scale it closes over is
    // the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symmetryHoverPreview, tree.sheet, paperRect, svgPerScreenPx]);

  // Set an edge's length and keep the tree length-faithful: re-place the child
  // vertex at `length` units from its parent along the current direction, and
  // translate the child's whole subtree by the same delta so nothing detaches.
  const setEdgeLength = useCallback(
    async (edge: OristudioBpTreeEdge, length: number) => {
      const [a, b] = edge.vertices;
      const childId = topology.parent.get(a) === b ? a : b;
      const parentId = childId === a ? b : a;
      const child = findVertex(childId);
      const parent = findVertex(parentId);
      if (!child || !parent) {
        await setOristudioBpTreeEdgeLength(edge.vertices, length);
        return;
      }
      const target = unitLeafLocation(parent.loc, child.loc, length);
      const subtreePairs = subtreeOf(childId).flatMap((id) => {
        const vertex = findVertex(id);
        return vertex ? [[id, vertex.loc] as const] : [];
      });
      const moved = translatePoints(child.loc, target, subtreePairs);
      const updates = [...moved].map(([id, loc]) => ({ id, loc }));
      // One call → the slice runs length + reposition as a single undo entry.
      await setOristudioBpTreeEdgeLength(edge.vertices, length, updates);
    },
    [topology, findVertex, subtreeOf, setOristudioBpTreeEdgeLength]
  );

  // Escape drops the selection and returns the keyboard to the canvas. Nothing in
  // the tree stays selected, so the contextual length/name editors close too.
  const dismissSelection = useCallback(() => {
    clearSelection();
    containerRef.current?.focus();
  }, [clearSelection, containerRef]);

  const eventToTreePoint = useCallback(
    (event: PointerEvent): Point => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const worldPoint = clientPointToDesignWorld(
        { x: event.clientX, y: event.clientY },
        svg.getBoundingClientRect(),
        worldRect
      );
      return svgToBpTreePoint(worldPoint, tree.sheet, paperRect);
    },
    [paperRect, tree.sheet, worldRect]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      // The contextual editors fire their own Escape (revert, then clear via
      // onEscape), so only handle the canvas case here.
      if (event.key === 'Escape' && !isViewportInteractiveTarget(event.target)) {
        event.preventDefault();
        dismissSelection();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [dismissSelection, containerRef]);

  const onCanvasAddPointerDown = (event: PointerEvent<Element>) => {
    if (event.button !== 0 || spacePressed || isViewportInteractiveTarget(event.target)) {
      paperDownRef.current = null;
      return;
    }
    paperDownRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      point: constrainBpTreePoint(eventToTreePoint(event), tree.sheet),
    };
  };

  const onCanvasAddPointerUp = (event: PointerEvent<Element>) => {
    const down = paperDownRef.current;
    paperDownRef.current = null;
    if (!down || event.button !== 0 || spacePressed) return;
    const dragged = hasPassedDragThreshold(
      { x: down.clientX, y: down.clientY },
      { x: event.clientX, y: event.clientY }
    );
    if (dragged) return;
    // A plain click on the sheet adds a unit-length leaf to the selected vertex,
    // pointing toward the click. With nothing selected there's no anchor, so the
    // click just falls through.
    const parentId = addAnchorId;
    if (parentId === null) return;
    const parent = findVertex(parentId);
    if (!parent) return;
    const loc = constrainBpTreePoint(unitLeafLocation(parent.loc, down.point), tree.sheet);
    if (symmetry.enabled) {
      void addOristudioBpTreeLeafWithSymmetry(parentId, loc, symmetryAxisTolerance);
    } else void addOristudioBpTreeLeaf(parentId, loc);
  };

  const onEdgePointerDown = useEventCallback((event: PointerEvent<SVGGElement>, edgeId: number) => {
    if (event.button !== 0 || spacePressed) return;
    event.stopPropagation();
    // Clicking an edge selects it — cancel the pending canvas "add leaf" gesture
    // that the capture-phase handler armed (edges, unlike vertices, don't capture
    // the pointer, so pointerup would otherwise reach onCanvasAddPointerUp).
    paperDownRef.current = null;
    selectOristudioBp(
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleBpEdgeSelection(selection, edgeId)
        : { kind: 'bp-edge', id: edgeId }
    );
    scheduleLongPressInspector(event);
  });

  const onVertexPointerDown = useEventCallback((event: PointerEvent<SVGCircleElement>, vertexId: number) => {
    if (event.button !== 0 || spacePressed) return;
    event.stopPropagation();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      selectOristudioBp(toggleBpVertexSelection(selection, vertexId));
      return;
    }
    selectOristudioBp({ kind: 'bp-vertex', id: vertexId });
    scheduleLongPressInspector(event);
    const vertex = findVertex(vertexId);
    if (!vertex) return;
    // A vertex on the mirror line is its own mirror. Dragging it off would break
    // that silently, so while mirror draw is on it stays put. Cancel the pending
    // canvas "add leaf" gesture the capture-phase handler armed: declining the
    // drag means no pointer capture, so pointerup would otherwise reach the
    // canvas and read this click as "add a leaf here".
    if (symmetryView.isOnAxis(vertexId)) {
      paperDownRef.current = null;
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging({
      id: vertexId,
      start: vertex.loc,
      clientStart: { x: event.clientX, y: event.clientY },
      moved: false,
      preview: new Map(),
    });
  });

  // Pointer capture retargets the rest of the gesture to the grabbed dot, which
  // sits inside this container — so the drag listens here rather than on every
  // dot. One pair of listeners for the pane instead of two per vertex.
  const onDragPointerMove = (event: PointerEvent<Element>) => {
    if (!dragging) return;
    const vertexId = dragging.id;
    const target = constrainBpTreePoint(eventToTreePoint(event), tree.sheet);
    setHoverPoint(target);
    const moved = bpTreeDragUpdates({
      vertexId,
      parentId: topology.parent.get(vertexId) ?? null,
      vertices: vertexLocationsById,
      subtreeIds: subtreeOf(vertexId),
      start: dragging.start,
      target,
    });
    const preview = new Map<number, Point>();
    for (const [id, loc] of moved) preview.set(id, constrainBpTreePoint(loc, tree.sheet));
    const clientMoved = hasPassedDragThreshold(dragging.clientStart, {
      x: event.clientX,
      y: event.clientY,
    });
    setDragging({
      id: vertexId,
      start: dragging.start,
      clientStart: dragging.clientStart,
      moved: dragging.moved || clientMoved,
      preview,
    });
  };

  /** Ends a drag if one is running. Answers whether it consumed the pointerup. */
  const finishDrag = (): boolean => {
    if (!dragging) return false;
    const { moved, preview } = dragging;
    setDragging(null);
    // A press on a dot arms the canvas "add leaf" gesture in the capture phase.
    // Grabbing a dot means this pointerup ends a drag, not a click on the paper,
    // so disarm it — otherwise releasing without moving would add a leaf.
    paperDownRef.current = null;
    if (moved && preview.size > 0) {
      const updates = [...preview.entries()].map(([id, loc]) => ({ id, loc }));
      if (symmetry.enabled) void moveOristudioBpTreeVerticesWithSymmetry(updates, false);
      else void moveOristudioBpTreeVertices(updates, false);
    }
    return true;
  };

  const onCanvasPointerMove = (event: PointerEvent<Element>) => {
    if (dragging) {
      onDragPointerMove(event);
      return;
    }
    // Track hover across the whole clickable pane — clicks commit anywhere on the
    // canvas (via the container), not just over the content-sized SVG, so the mirror
    // ghost must follow the cursor there too. Skip the toolbar/editor chrome.
    if (isViewportInteractiveTarget(event.target)) {
      setHoverPoint(null);
      return;
    }
    setHoverPoint(eventToTreePoint(event));
  };

  const onCanvasPointerUp = (event: PointerEvent<Element>) => {
    if (finishDrag()) return;
    onCanvasAddPointerUp(event);
  };

  return (
    <div
      ref={containerRef}
      className="panel-body design-panel__body bp-tree-panel__body"
      data-space-pan={spacePressed || undefined}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        setActiveShortcutViewportSurface('tree');
        setOristudioBpActiveSurface('tree');
        if (!isViewportInteractiveTarget(event.target)) containerRef.current?.focus();
        onCanvasAddPointerDown(event);
      }}
      onPointerMove={onCanvasPointerMove}
      onPointerLeave={() => setHoverPoint(null)}
      onPointerUp={onCanvasPointerUp}
      onPointerCancel={() => finishDrag()}
    >
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.05}
        maxScale={30}
        centerOnInit
        limitToBounds={false}
        wheel={VIEWPORT_WHEEL_ZOOM}
        panning={{
          velocityDisabled: true,
          wheelPanning: true,
          allowMiddleClickPan: true,
          allowLeftClickPan: spacePressed,
        }}
        pinch={VIEWPORT_PINCH_ZOOM}
        doubleClick={{ disabled: true }}
        onInit={onInit}
        onTransformed={onTransformed}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: 'fit-content', height: 'fit-content' }}
        >
          <BpTreeScene
            svgRef={svgRef}
            tree={tree}
            paperRect={paperRect}
            worldRect={worldRect}
            layers={layers}
            selectedVertices={linkedSelection.vertices}
            selectedEdges={linkedSelection.edges}
            chromePx={chromePx}
            previewLocs={vertexLocations}
            symmetryAxisLine={symmetryView.axisLine}
            symmetryPairs={symmetryView.pairs}
            overlay={symmetryGhost}
            onEdgePointerDown={onEdgePointerDown}
            onVertexPointerDown={onVertexPointerDown}
          />
        </TransformComponent>
      </TransformWrapper>
      <BpTreeViewportToolbar
        zoomPercent={zoomPercent}
        layers={layers}
        onLayerChange={setLayer}
        symmetryEnabled={symmetryView.enabled}
        onSymmetryToggle={symmetryView.toggle}
        canUnpair={selectedVertexId !== null && symmetryView.partnerOf(selectedVertexId) !== null}
        onUnpair={() => selectedVertexId !== null && symmetryView.unpair(selectedVertexId)}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        fitToView={() => fitToView()}
        setZoomLevel={setZoomLevel}
      />
      {selectedEdge && (
        <BpTreeEdgeLengthEditor
          edge={selectedEdge}
          onSetLength={(length) => void setEdgeLength(selectedEdge, length)}
          onEscape={dismissSelection}
        />
      )}
      {selectedFlapVertex && (
        <BpNameEditor
          key={selectedFlapVertex.id}
          title={t('panels:bpTree.flapTitle', 'Flap {{id}}', {
            id: bpDefaultFlapLabel(selectedFlapVertex.id),
          })}
          name={selectedFlapVertex.name}
          placeholder={bpDefaultFlapLabel(selectedFlapVertex.id)}
          ariaLabel={t('panels:bpTree.flapNameAria', 'Name of flap {{id}}', {
            id: bpDefaultFlapLabel(selectedFlapVertex.id),
          })}
          onRename={(name) => void renameOristudioBpVertex(selectedFlapVertex.id, name)}
          onEscape={dismissSelection}
        />
      )}
    </div>
  );
}
