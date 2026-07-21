import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { FlipHorizontal2, Layers, Minus, Plus, Tag } from 'lucide-react';
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
  bpTreeVertexLabel,
  constrainBpTreePoint,
  getBpTreeWorldRect,
  svgToBpTreePoint,
} from '../../lib/bpTreeViewport';
import { formatNumber, type Point } from '../../lib/geometry';
import { rotatePointsAround, translatePoints, unitLeafLocation } from '../../lib/bpTreeAuthoring';
import {
  bpTreeSymmetryDefaultLoc,
  mirrorBpTreeVertexId,
  BP_TREE_SYMMETRY_TOLERANCE,
} from '../../lib/bpTreeSymmetry';
import {
  reflectPointAcrossSymmetryAxis,
  snapPointToSymmetryAxis,
} from '../../lib/symmetryGeometry';
import { type BpTreeViewLayerKey, type BpTreeViewLayers } from '../../lib/oristudioBpViewportSettings';
import {
  clientPointToDesignWorld,
  getViewportFitScale,
} from '../../lib/designViewport';
import { registerViewportShortcutExecutor, setActiveShortcutViewportSurface } from '../../keyboard/shortcutRuntime';
import type { ViewportShortcutId } from '../../keyboard/shortcuts';
import { useBpLongPressInspector } from '../../hooks/useBpLongPressInspector';
import {
  isTreeViewportKeyboardActivation,
  viewportRectToViewBox,
  viewportSizeFromElement,
} from '../../lib/treeViewportPrimitives';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { IconButton } from '../ui/IconButton';
import { BpNameEditor } from './BpNameEditor';
import {
  isViewportInteractiveTarget,
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

const BP_TREE_DRAG_START_THRESHOLD_PX = 4;

// The rendered symmetry snap-lane width in SVG units — keep in sync with the CSS
// `.symmetry-snap-lane { stroke-width }`. A leaf tip landing anywhere inside this
// band snaps onto the axis as a single centred leaf (matches what the user sees).
const SYMMETRY_AXIS_BAND_SVG = 18;

// Default so a unit-length edge is ~this many screen pixels. Node dots and
// labels are drawn at fixed screen sizes (counter-scaled by the zoom) so they
// stay small relative to the geometry at any zoom.
const TARGET_UNIT_PX = 56;
const NODE_DOT_PX = 5;
const LEAF_DOT_PX = 4;
const NODE_LABEL_PX = 12;

function BpTreeViewportToolbar({
  zoomPercent,
  layers,
  onLayerChange,
  symmetryEnabled,
  onSymmetryToggle,
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
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
  setZoomLevel: (scale: number) => void;
}) {
  const { t } = useTranslation();
  const [layersOpen, setLayersOpen] = useState(false);
  const layersMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!layersOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (layersMenuRef.current?.contains(target)) return;
      setLayersOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [layersOpen]);

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
      <ViewportToolbarSeparator />
      <div className="viewport-toolbar__menu-anchor" ref={layersMenuRef}>
        <IconButton
          size="sm"
          variant="toolbar"
          title={t('panels:bpTree.layers', 'Layers')}
          isActive={layersOpen}
          onClick={() => setLayersOpen((open) => !open)}
        >
          <Layers size={14} />
        </IconButton>
        {layersOpen && (
          <div className="design-layer-menu" role="menu">
            {LAYER_OPTIONS.map((option) => (
              <label key={option.key} className="design-layer-option">
                <input
                  type="checkbox"
                  checked={layers[option.key]}
                  onChange={(event) => onLayerChange(option.key, event.target.checked)}
                />
                <span className="design-layer-option__icon">{option.icon}</span>
                <span>{bpTreeLayerLabel(t, option.key)}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </ViewportToolbar>
  );
}

/**
 * Contextual editor for a selected tree edge's length. BP flap/river lengths are
 * the tree edge lengths, and the engine enforces a minimum of 1 and a
 * geometry-derived maximum (`edge.maxLength`).
 */
function BpTreeEdgeLengthEditor({
  edge,
  onSetLength,
}: {
  edge: OristudioBpTreeEdge;
  onSetLength: (length: number) => void;
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
      {max !== null && (
        <span className="bp-tree-edge-editor__max">
          {t('panels:bpTree.max', 'max {{value}}', { value: formatNumber(max, 2) })}
        </span>
      )}
    </div>
  );
}

export function BpTreePanel({ document }: { document: OristudioBpDocumentState }) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const [dragging, setDragging] = useState<{
    id: number;
    start: Point;
    clientStart: Point;
    moved: boolean;
    preview: Map<number, Point>;
  } | null>(null);
  const paperDownRef = useRef<{ clientX: number; clientY: number; point: Point } | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [spacePressed, setSpacePressed] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const scheduleLongPressInspector = useBpLongPressInspector();
  const layers = useSettingsStore((state) => state.bpTreeLayers);
  const setLayer = useSettingsStore((state) => state.setBpTreeLayer);
  const selectOristudioBp = useWorkspaceStore((state) => state.selectOristudioBp);
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
  const setOristudioBpSymmetry = useWorkspaceStore((state) => state.setOristudioBpSymmetry);
  const addOristudioBpTreeLeafWithSymmetry = useWorkspaceStore(
    (state) => state.addOristudioBpTreeLeafWithSymmetry
  );
  const moveOristudioBpTreeVerticesWithSymmetry = useWorkspaceStore(
    (state) => state.moveOristudioBpTreeVerticesWithSymmetry
  );
  const tree = document.snapshot.tree;
  const selectedVertexId = document.selection.kind === 'bp-vertex' ? document.selection.id : null;
  // The edge selected by clicking a tree segment — drives the length editor.
  const selectedEdge = useMemo(() => {
    const id = document.selection.kind === 'bp-edge' ? document.selection.id : null;
    if (id === null) return null;
    return tree.edges.find((edge) => edge.id === id) ?? null;
  }, [document.selection, tree.edges]);
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
  const linkedSelection = useMemo(
    () => bpLinkedSelection(document.selection, document),
    [document]
  );
  const paperRect = useMemo(() => bpTreePaperRect(tree.sheet), [tree.sheet]);
  const vertexLocations = useMemo(() => dragging?.preview, [dragging]);
  // Fit to the committed tree bounds only (not the drag preview) so the camera
  // stays put while a flap rotates. Tight padding keeps a unit edge large.
  const worldRect = useMemo(
    () => getBpTreeWorldRect(tree, { contentOnly: true, padding: 12 }),
    [tree]
  );

  // Convert a target screen-pixel size into SVG units at the current zoom, so
  // dots/labels keep a constant on-screen size regardless of zoom.
  const svgPerScreenPx = Math.max(0.02, zoomPercent / 100);
  const chromePx = (px: number) => px / svgPerScreenPx;
  const findVertex = useCallback(
    (id: number) => tree.vertices.find((vertex) => vertex.id === id),
    [tree.vertices]
  );
  const displayLoc = useCallback(
    (id: number, loc: Point) => vertexLocations?.get(id) ?? loc,
    [vertexLocations]
  );

  // --- Symmetry (mirror-draw) -------------------------------------------------
  // A tree isn't drawn on the paper, so there's nothing to orient a mirror line
  // against — symmetry is a plain on/off toggle with a vertical axis (angle 90,
  // mirror left/right) centred on the sheet.
  const handleToggleSymmetry = useCallback(() => {
    if (symmetry.enabled) {
      setOristudioBpSymmetry({ enabled: false });
      return;
    }
    setOristudioBpSymmetry({
      enabled: true,
      loc: bpTreeSymmetryDefaultLoc(tree.sheet),
      angle: 90,
    });
  }, [setOristudioBpSymmetry, tree.sheet, symmetry.enabled]);

  // The mirror line clipped to the sheet, in SVG coords.
  const symmetryAxisLine = useMemo(() => {
    if (!symmetry.enabled) return null;
    const w = Math.max(1, tree.sheet.width);
    const h = Math.max(1, tree.sheet.height);
    const rad = (symmetry.angle * Math.PI) / 180;
    const dir = { x: Math.cos(rad), y: Math.sin(rad) };
    const hits: Point[] = [];
    const push = (p: Point) => {
      if (p.x >= -1e-6 && p.x <= w + 1e-6 && p.y >= -1e-6 && p.y <= h + 1e-6) hits.push(p);
    };
    if (Math.abs(dir.x) > 1e-9) {
      for (const bx of [0, w]) {
        const t = (bx - symmetry.loc.x) / dir.x;
        push({ x: bx, y: symmetry.loc.y + t * dir.y });
      }
    }
    if (Math.abs(dir.y) > 1e-9) {
      for (const by of [0, h]) {
        const t = (by - symmetry.loc.y) / dir.y;
        push({ x: symmetry.loc.x + t * dir.x, y: by });
      }
    }
    if (hits.length < 2) return null;
    // Take the two most distant intersection points.
    let a = hits[0];
    let b = hits[1];
    let best = -1;
    for (let i = 0; i < hits.length; i += 1) {
      for (let j = i + 1; j < hits.length; j += 1) {
        const d = Math.hypot(hits[i].x - hits[j].x, hits[i].y - hits[j].y);
        if (d > best) {
          best = d;
          a = hits[i];
          b = hits[j];
        }
      }
    }
    const p1 = bpTreePointToSvg(a, tree.sheet, paperRect);
    const p2 = bpTreePointToSvg(b, tree.sheet, paperRect);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }, [symmetry.enabled, symmetry.angle, symmetry.loc, tree.sheet, paperRect]);

  // Ghost preview of the leaf a click would add (and its mirror), mirroring what
  // addOristudioBpTreeLeafWithSymmetry will do: an on-axis tip is a single centred
  // leaf; otherwise it reflects onto the parent's mirror.
  const symmetryHoverPreview = useMemo(() => {
    if (!symmetry.enabled || dragging || !hoverPoint) return null;
    const parentId = selectedVertexId ?? tree.rootVertexId;
    if (parentId === null) return null;
    const parent = findVertex(parentId);
    if (!parent) return null;
    const axis = { loc: symmetry.loc, angle: symmetry.angle };
    const axisTolerance = SYMMETRY_AXIS_BAND_SVG / 2 / bpTreeUnitToSvg(tree.sheet, paperRect);
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
    selectedVertexId,
    tree,
    paperRect,
    findVertex,
  ]);

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

  const getViewportSize = useCallback(() => viewportSizeFromElement(containerRef.current), []);

  const computeFitScale = useCallback(() => {
    const viewport = getViewportSize();
    if (!viewport) return 1;
    // Default to a fixed, readable scale (1 tree unit ≈ TARGET_UNIT_PX on
    // screen) rather than filling the pane with a tiny tree. Only zoom OUT (via
    // getViewportFitScale) once the tree is too big to fit at that scale.
    const targetScale = TARGET_UNIT_PX / bpTreeUnitToSvg(tree.sheet);
    return getViewportFitScale(viewport, worldRect, undefined, targetScale);
  }, [getViewportSize, worldRect, tree.sheet]);

  const fitToView = useCallback(
    (animationTime = 180) => {
      transformRef.current?.centerView(computeFitScale(), animationTime);
    },
    [computeFitScale]
  );

  const setActualSize = useCallback(() => {
    transformRef.current?.centerView(1, 160);
  }, []);

  const setZoomLevel = useCallback((scale: number) => {
    transformRef.current?.centerView(scale, 160);
  }, []);

  const handleViewportShortcut = useCallback(
    (id: ViewportShortcutId) => {
      switch (id) {
        case 'viewport.zoomIn':
          transformRef.current?.zoomIn(0.35, 120);
          break;
        case 'viewport.zoomOut':
          transformRef.current?.zoomOut(0.35, 120);
          break;
        case 'viewport.fit':
          fitToView();
          break;
        case 'viewport.actualSize':
          setActualSize();
          break;
      }
    },
    [fitToView, setActualSize]
  );

  useEffect(
    () => registerViewportShortcutExecutor('tree', handleViewportShortcut),
    [handleViewportShortcut]
  );

  const fitKey = `${document.handle}:${document.source.filename}`;
  const lastFittedKeyRef = useRef<string | null>(null);
  const fitLoadedDocument = useCallback(
    (animationTime = 0) => {
      if (lastFittedKeyRef.current === fitKey) return true;
      const container = containerRef.current;
      if (!container || !transformRef.current || container.clientWidth <= 0 || container.clientHeight <= 0) {
        return false;
      }
      transformRef.current.centerView(computeFitScale(), animationTime);
      lastFittedKeyRef.current = fitKey;
      return true;
    },
    [computeFitScale, fitKey]
  );
  const fitLoadedDocumentRef = useRef(fitLoadedDocument);
  useEffect(() => {
    fitLoadedDocumentRef.current = fitLoadedDocument;
  }, [fitLoadedDocument]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => fitLoadedDocumentRef.current(0));
    return () => cancelAnimationFrame(frame);
  }, [fitKey]);

  // Re-fit when the tree grows or shrinks (adding/deleting nodes), but not while
  // rotating (which keeps the node count the same) so it doesn't fight a drag.
  const vertexCount = tree.vertices.length;
  const prevVertexCountRef = useRef(vertexCount);
  useEffect(() => {
    if (prevVertexCountRef.current === vertexCount) return undefined;
    prevVertexCountRef.current = vertexCount;
    const frame = requestAnimationFrame(() => fitToView());
    return () => cancelAnimationFrame(frame);
  }, [vertexCount, fitToView]);

  useEffect(() => {
    const container = containerRef.current;
    let frame = requestAnimationFrame(() => fitLoadedDocumentRef.current(0));
    const observer =
      typeof ResizeObserver === 'undefined' || !container
        ? null
        : new ResizeObserver(() => {
            if (lastFittedKeyRef.current !== fitKey) {
              cancelAnimationFrame(frame);
              frame = requestAnimationFrame(() => fitLoadedDocumentRef.current(0));
            }
          });

    if (observer && container) observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [fitKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      const interactive = isViewportInteractiveTarget(event.target);
      if (event.key === ' ' && !interactive) {
        event.preventDefault();
        setSpacePressed(true);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') setSpacePressed(false);
    };
    const clearSpace = () => setSpacePressed(false);

    container.addEventListener('keydown', onKeyDown);
    container.addEventListener('keyup', onKeyUp);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearSpace);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      container.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearSpace);
    };
  }, []);

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
    const movedPx = Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY);
    if (movedPx >= BP_TREE_DRAG_START_THRESHOLD_PX) return;
    // A plain click on the sheet adds a unit-length leaf to the selected vertex
    // (or the root), pointing toward the click.
    const parentId = selectedVertexId ?? tree.rootVertexId;
    if (parentId === null) return;
    const parent = findVertex(parentId);
    if (!parent) return;
    const loc = constrainBpTreePoint(unitLeafLocation(parent.loc, down.point), tree.sheet);
    if (symmetry.enabled) {
      // Match the axis-snap zone to the visible band's half-width, converted from
      // SVG units to tree units at the current sheet scale.
      const axisTolerance =
        SYMMETRY_AXIS_BAND_SVG / 2 / bpTreeUnitToSvg(tree.sheet, paperRect);
      void addOristudioBpTreeLeafWithSymmetry(parentId, loc, axisTolerance);
    } else void addOristudioBpTreeLeaf(parentId, loc);
  };

  const onEdgePointerDown = (event: PointerEvent<SVGGElement>, edgeId: number) => {
    if (event.button !== 0 || spacePressed) return;
    event.stopPropagation();
    // Clicking an edge selects it — cancel the pending canvas "add leaf" gesture
    // that the capture-phase handler armed (edges, unlike vertices, don't capture
    // the pointer, so pointerup would otherwise reach onCanvasAddPointerUp).
    paperDownRef.current = null;
    selectOristudioBp(
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleBpEdgeSelection(document.selection, edgeId)
        : { kind: 'bp-edge', id: edgeId }
    );
    scheduleLongPressInspector(event);
  };

  const onEdgeKeyDown = (event: ReactKeyboardEvent<SVGGElement>, edgeId: number) => {
    if (!isTreeViewportKeyboardActivation(event)) return;
    event.preventDefault();
    event.stopPropagation();
    selectOristudioBp(
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleBpEdgeSelection(document.selection, edgeId)
        : { kind: 'bp-edge', id: edgeId }
    );
  };

  const onVertexPointerDown = (event: PointerEvent<SVGCircleElement>, vertexId: number) => {
    if (event.button !== 0 || spacePressed) return;
    event.stopPropagation();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      selectOristudioBp(toggleBpVertexSelection(document.selection, vertexId));
      return;
    }
    selectOristudioBp({ kind: 'bp-vertex', id: vertexId });
    scheduleLongPressInspector(event);
    const vertex = findVertex(vertexId);
    if (!vertex) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging({
      id: vertexId,
      start: vertex.loc,
      clientStart: { x: event.clientX, y: event.clientY },
      moved: false,
      preview: new Map(),
    });
  };

  const onVertexPointerMove = (event: PointerEvent<SVGCircleElement>, vertexId: number) => {
    if (dragging?.id !== vertexId) return;
    event.stopPropagation();
    const target = constrainBpTreePoint(eventToTreePoint(event), tree.sheet);
    setHoverPoint(target);
    const parentId = topology.parent.get(vertexId) ?? null;
    let moved: Map<number, Point>;
    if (parentId === null) {
      // Root: translate the whole tree rigidly by the drag delta.
      const points = tree.vertices.map((vertex) => [vertex.id, vertex.loc] as const);
      moved = translatePoints(dragging.start, target, points);
    } else {
      // Rotate this vertex and its subtree rigidly around the parent, so every
      // edge keeps its length.
      const pivot = findVertex(parentId)?.loc ?? dragging.start;
      const points = subtreeOf(vertexId)
        .map((id) => findVertex(id))
        .filter((vertex): vertex is NonNullable<typeof vertex> => Boolean(vertex))
        .map((vertex) => [vertex.id, vertex.loc] as const);
      moved = rotatePointsAround(pivot, dragging.start, target, points);
    }
    const preview = new Map<number, Point>();
    for (const [id, loc] of moved) preview.set(id, constrainBpTreePoint(loc, tree.sheet));
    const clientDx = event.clientX - dragging.clientStart.x;
    const clientDy = event.clientY - dragging.clientStart.y;
    const clientMoved = Math.hypot(clientDx, clientDy) >= BP_TREE_DRAG_START_THRESHOLD_PX;
    setDragging({
      id: vertexId,
      start: dragging.start,
      clientStart: dragging.clientStart,
      moved: dragging.moved || clientMoved,
      preview,
    });
  };

  const finishDrag = (event: PointerEvent<SVGCircleElement>, vertexId: number) => {
    if (dragging?.id !== vertexId) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const { moved, preview } = dragging;
    setDragging(null);
    if (moved && preview.size > 0) {
      const updates = [...preview.entries()].map(([id, loc]) => ({ id, loc }));
      if (symmetry.enabled) void moveOristudioBpTreeVerticesWithSymmetry(updates, false);
      else void moveOristudioBpTreeVertices(updates, false);
    }
  };

  const onCanvasPointerMove = (event: PointerEvent<Element>) => {
    // Track hover across the whole clickable pane — clicks commit anywhere on the
    // canvas (via the container), not just over the content-sized SVG, so the mirror
    // ghost must follow the cursor there too. Skip the toolbar/editor chrome.
    if (isViewportInteractiveTarget(event.target)) {
      setHoverPoint(null);
      return;
    }
    setHoverPoint(eventToTreePoint(event));
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
      onPointerUp={onCanvasAddPointerUp}
    >
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.05}
        maxScale={30}
        centerOnInit
        limitToBounds={false}
        wheel={{ step: 0.5, wheelDisabled: true }}
        panning={{
          velocityDisabled: true,
          wheelPanning: true,
          allowMiddleClickPan: true,
          allowLeftClickPan: spacePressed,
        }}
        pinch={{ step: 0.5 }}
        doubleClick={{ disabled: true }}
        onInit={(ref) => {
          transformRef.current = ref;
          requestAnimationFrame(() => fitLoadedDocumentRef.current(0));
        }}
        onTransformed={(_ref, state) => setZoomPercent(Math.round(state.scale * 100))}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: 'fit-content', height: 'fit-content' }}
        >
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
                  className="symmetry-snap-lane"
                  x1={symmetryAxisLine.x1}
                  y1={symmetryAxisLine.y1}
                  x2={symmetryAxisLine.x2}
                  y2={symmetryAxisLine.y2}
                />
                <line
                  className="symmetry-line"
                  x1={symmetryAxisLine.x1}
                  y1={symmetryAxisLine.y1}
                  x2={symmetryAxisLine.x2}
                  y2={symmetryAxisLine.y2}
                />
              </>
            )}
            {symmetryHoverPreview && (
              <g className="symmetry-ghost">
                {(() => {
                  const from = bpTreePointToSvg(symmetryHoverPreview.primary.from, tree.sheet, paperRect);
                  const to = bpTreePointToSvg(symmetryHoverPreview.primary.to, tree.sheet, paperRect);
                  return (
                    <>
                      <line
                        className={[
                          'symmetry-ghost-edge',
                          symmetryHoverPreview.unresolved ? 'symmetry-ghost-edge--unresolved' : '',
                        ].join(' ')}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                      />
                      <circle
                        className="symmetry-ghost-node"
                        data-snapped={symmetryHoverPreview.snapped || undefined}
                        cx={to.x}
                        cy={to.y}
                        r={chromePx(LEAF_DOT_PX)}
                      />
                    </>
                  );
                })()}
                {symmetryHoverPreview.mirror &&
                  (() => {
                    const from = bpTreePointToSvg(symmetryHoverPreview.mirror.from, tree.sheet, paperRect);
                    const to = bpTreePointToSvg(symmetryHoverPreview.mirror.to, tree.sheet, paperRect);
                    return (
                      <>
                        <line
                          className="symmetry-ghost-edge"
                          x1={from.x}
                          y1={from.y}
                          x2={to.x}
                          y2={to.y}
                        />
                        <circle
                          className="symmetry-ghost-node"
                          cx={to.x}
                          cy={to.y}
                          r={chromePx(LEAF_DOT_PX)}
                        />
                      </>
                    );
                  })()}
              </g>
            )}
            {tree.edges.map((edge) => {
              const a = findVertex(edge.vertices[0]);
              const b = findVertex(edge.vertices[1]);
              if (!a || !b) return null;
              const p1 = bpTreePointToSvg(displayLoc(a.id, a.loc), tree.sheet, paperRect);
              const p2 = bpTreePointToSvg(displayLoc(b.id, b.loc), tree.sheet, paperRect);
              const active = linkedSelection.edges.has(edge.id);
              return (
                <g
                  key={edge.id}
                  role="button"
                  tabIndex={0}
                  aria-label={t('panels:bpTree.selectEdge', 'Select BP edge {{id}}, length {{length}}', {
                    id: edge.id,
                    length: formatNumber(edge.length, 2),
                  })}
                  onPointerDown={(event) => onEdgePointerDown(event, edge.id)}
                  onKeyDown={(event) => onEdgeKeyDown(event, edge.id)}
                >
                  <line
                    className={[
                      'tree-edge',
                      'bp-tree-edge',
                      edge.isLeafEdge ? 'bp-tree-edge--leaf' : 'bp-tree-edge--river',
                      active ? 'tree-edge--selected' : '',
                    ].join(' ')}
                    vectorEffect="non-scaling-stroke"
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                  />
                  {layers.labels && edge.isLeafEdge && (
                    <text
                      className="edge-label bp-tree-edge-label"
                      x={(p1.x + p2.x) / 2 + chromePx(6)}
                      y={(p1.y + p2.y) / 2 - chromePx(6)}
                      style={{ fontSize: chromePx(NODE_LABEL_PX) }}
                    >
                      {formatNumber(edge.length, 2)}
                    </text>
                  )}
                </g>
              );
            })}
            {tree.vertices.map((vertex) => {
              const point = bpTreePointToSvg(displayLoc(vertex.id, vertex.loc), tree.sheet, paperRect);
              const active = linkedSelection.vertices.has(vertex.id);
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
                    vectorEffect="non-scaling-stroke"
                    cx={point.x}
                    cy={point.y}
                    r={chromePx(vertex.isLeaf ? LEAF_DOT_PX : NODE_DOT_PX)}
                    // Intentionally not focusable (no role/tabIndex): a focusable
                    // dot draws its own browser focus ring that competes with the
                    // selection highlight and steals focus from the name field, so
                    // typing a name would go nowhere. Selection is by click; the
                    // tree's keyboard nudge/delete live on the container.
                    aria-label={vertexAriaLabel}
                    onPointerDown={(event) => onVertexPointerDown(event, vertex.id)}
                    onPointerMove={(event) => onVertexPointerMove(event, vertex.id)}
                    onPointerUp={(event) => finishDrag(event, vertex.id)}
                    onPointerCancel={(event) => finishDrag(event, vertex.id)}
                  />
                  {layers.labels && vertex.isLeaf && label && (
                    <text
                      className="node-label bp-tree-node-label"
                      x={point.x + chromePx(NODE_DOT_PX + 4)}
                      y={point.y + chromePx(4)}
                      style={{ fontSize: chromePx(NODE_LABEL_PX) }}
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </TransformComponent>
      </TransformWrapper>
      <BpTreeViewportToolbar
        zoomPercent={zoomPercent}
        layers={layers}
        onLayerChange={setLayer}
        symmetryEnabled={symmetry.enabled}
        onSymmetryToggle={handleToggleSymmetry}
        zoomIn={() => transformRef.current?.zoomIn(0.35, 120)}
        zoomOut={() => transformRef.current?.zoomOut(0.35, 120)}
        fitToView={() => fitToView()}
        setZoomLevel={setZoomLevel}
      />
      {selectedEdge && (
        <BpTreeEdgeLengthEditor
          edge={selectedEdge}
          onSetLength={(length) => void setEdgeLength(selectedEdge, length)}
        />
      )}
      {selectedFlapVertex && (
        <BpNameEditor
          key={selectedFlapVertex.id}
          title={t('panels:bpTree.flapTitle', 'Flap {{id}}', { id: selectedFlapVertex.id })}
          name={selectedFlapVertex.name}
          placeholder={`f${selectedFlapVertex.id}`}
          ariaLabel={t('panels:bpTree.flapNameAria', 'Name of flap {{id}}', {
            id: selectedFlapVertex.id,
          })}
          autoFocus
          onRename={(name) => void renameOristudioBpVertex(selectedFlapVertex.id, name)}
        />
      )}
    </div>
  );
}
