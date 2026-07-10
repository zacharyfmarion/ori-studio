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
import { Circle, Grid2X2, Layers, Tag, Waypoints } from 'lucide-react';
import type { OristudioBpDocumentState } from '../../engine/oristudioBpTypes';
import {
  bpLinkedSelection,
  bpSelectionSize,
  toggleBpEdgeSelection,
  toggleBpVertexSelection,
} from '../../lib/oristudioBpSelection';
import {
  bpTreeLeafCircleRadius,
  bpTreePaperRect,
  bpTreePointToSvg,
  bpTreeShadowRect,
  bpTreeVertexLabel,
  constrainBpTreePoint,
  getBpTreeWorldRect,
  svgToBpTreePoint,
} from '../../lib/bpTreeViewport';
import { formatNumber, type Point } from '../../lib/geometry';
import { type BpTreeViewLayerKey, type BpTreeViewLayers } from '../../lib/oristudioBpViewportSettings';
import {
  clientPointToDesignWorld,
  getViewportFitScale,
} from '../../lib/designViewport';
import { registerViewportShortcutExecutor, setActiveShortcutViewportSurface } from '../../keyboard/shortcutRuntime';
import type { ViewportShortcutId } from '../../keyboard/shortcuts';
import { useBpLongPressInspector } from '../../hooks/useBpLongPressInspector';
import {
  formatViewportZoom,
  isTreeViewportKeyboardActivation,
  viewportRectToViewBox,
  viewportSizeFromElement,
} from '../../lib/treeViewportPrimitives';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { IconButton } from '../ui/IconButton';
import {
  isViewportInteractiveTarget,
  ViewportToolbar,
  ViewportToolbarSeparator,
} from './ViewportToolbar';

const LAYER_OPTIONS: { key: BpTreeViewLayerKey; label: string; icon: ReactNode }[] = [
  { key: 'leafCircles', label: 'Leaf radii', icon: <Circle size={13} /> },
  { key: 'labels', label: 'Labels', icon: <Tag size={13} /> },
];

const BP_TREE_DRAG_START_THRESHOLD_PX = 4;

function BpTreeViewportToolbar({
  zoomPercent,
  layers,
  onLayerChange,
  zoomIn,
  zoomOut,
  fitToView,
  setZoomLevel,
}: {
  zoomPercent: number;
  layers: BpTreeViewLayers;
  onLayerChange: (layer: BpTreeViewLayerKey, visible: boolean) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
  setZoomLevel: (scale: number) => void;
}) {
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
      ariaLabel="Box Pleat tree viewport controls"
      zoomPercent={zoomPercent}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      fitToView={fitToView}
      setZoomLevel={setZoomLevel}
    >
      <ViewportToolbarSeparator />
      <div className="viewport-toolbar__menu-anchor" ref={layersMenuRef}>
        <IconButton
          size="sm"
          variant="toolbar"
          title="Layers"
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
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </ViewportToolbar>
  );
}

export function BpTreePanel({ document }: { document: OristudioBpDocumentState }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const [dragging, setDragging] = useState<{
    id: number;
    start: Point;
    clientStart: Point;
    loc: Point;
    moved: boolean;
  } | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [spacePressed, setSpacePressed] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const scheduleLongPressInspector = useBpLongPressInspector();
  const layers = useSettingsStore((state) => state.bpTreeLayers);
  const setLayer = useSettingsStore((state) => state.setBpTreeLayer);
  const selectOristudioBp = useWorkspaceStore((state) => state.selectOristudioBp);
  const moveOristudioBpTreeVertex = useWorkspaceStore((state) => state.moveOristudioBpTreeVertex);
  const setOristudioBpActiveSurface = useWorkspaceStore(
    (state) => state.setOristudioBpActiveSurface
  );
  const tree = document.snapshot.tree;
  const linkedSelection = useMemo(
    () => bpLinkedSelection(document.selection, document),
    [document]
  );
  const paperRect = useMemo(() => bpTreePaperRect(tree.sheet), [tree.sheet]);
  const shadowRect = useMemo(() => bpTreeShadowRect(tree.sheet), [tree.sheet]);
  const vertexLocations = useMemo(() => {
    if (!dragging) return undefined;
    return new Map([[dragging.id, dragging.loc]]);
  }, [dragging]);
  const worldRect = useMemo(
    () => getBpTreeWorldRect(tree, { vertexLocations }),
    [tree, vertexLocations]
  );
  const findVertex = useCallback(
    (id: number) => tree.vertices.find((vertex) => vertex.id === id),
    [tree.vertices]
  );
  const displayLoc = useCallback(
    (id: number, loc: Point) => vertexLocations?.get(id) ?? loc,
    [vertexLocations]
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
    return getViewportFitScale(viewport, worldRect);
  }, [getViewportSize, worldRect]);

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

  const clearSelection = useCallback(() => {
    if (bpSelectionSize(document.selection) > 0) selectOristudioBp({ kind: 'bp-tree' });
  }, [document.selection, selectOristudioBp]);

  const onCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget || spacePressed) return;
    clearSelection();
  };

  const onPaperPointerDown = (event: PointerEvent<SVGRectElement>) => {
    if (event.button !== 0 || spacePressed) return;
    clearSelection();
  };

  const onEdgePointerDown = (event: PointerEvent<SVGGElement>, edgeId: number) => {
    if (event.button !== 0 || spacePressed) return;
    event.stopPropagation();
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
      loc: vertex.loc,
      moved: false,
    });
  };

  const onVertexKeyDown = (event: ReactKeyboardEvent<SVGCircleElement>, vertexId: number) => {
    if (!isTreeViewportKeyboardActivation(event)) return;
    event.preventDefault();
    event.stopPropagation();
    selectOristudioBp(
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleBpVertexSelection(document.selection, vertexId)
        : { kind: 'bp-vertex', id: vertexId }
    );
  };

  const onVertexPointerMove = (event: PointerEvent<SVGCircleElement>, vertexId: number) => {
    if (dragging?.id !== vertexId) return;
    event.stopPropagation();
    const loc = constrainBpTreePoint(eventToTreePoint(event), tree.sheet);
    setHoverPoint(loc);
    const dx = loc.x - dragging.start.x;
    const dy = loc.y - dragging.start.y;
    const clientDx = event.clientX - dragging.clientStart.x;
    const clientDy = event.clientY - dragging.clientStart.y;
    const worldMoved = Math.hypot(dx, dy) > 0;
    const clientMoved = Math.hypot(clientDx, clientDy) >= BP_TREE_DRAG_START_THRESHOLD_PX;
    setDragging({
      id: vertexId,
      start: dragging.start,
      clientStart: dragging.clientStart,
      loc,
      moved: dragging.moved || (clientMoved && worldMoved),
    });
  };

  const finishDrag = (event: PointerEvent<SVGCircleElement>, vertexId: number) => {
    if (dragging?.id !== vertexId) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const loc = dragging.loc;
    const moved = dragging.moved;
    setDragging(null);
    if (moved) void moveOristudioBpTreeVertex(vertexId, loc, false);
  };

  const onCanvasPointerMove = (event: PointerEvent<SVGSVGElement>) => {
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
      }}
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
            aria-label="Box Pleat tree canvas"
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerLeave={() => setHoverPoint(null)}
          >
            <rect
              className="paper-shadow"
              x={shadowRect.x}
              y={shadowRect.y}
              width={shadowRect.width}
              height={shadowRect.height}
              rx="6"
            />
            <rect
              className="paper bp-tree-sheet"
              x={paperRect.x}
              y={paperRect.y}
              width={paperRect.width}
              height={paperRect.height}
            />
            <rect
              className="paper-hit-area"
              x={paperRect.x}
              y={paperRect.y}
              width={paperRect.width}
              height={paperRect.height}
              onPointerDown={onPaperPointerDown}
            />
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
                  aria-label={`Select BP edge ${edge.id}, length ${formatNumber(edge.length, 2)}`}
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
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                  />
                  {layers.labels && (
                    <text className="edge-label bp-tree-edge-label" x={(p1.x + p2.x) / 2 + 8} y={(p1.y + p2.y) / 2 - 8}>
                      {formatNumber(edge.length, 2)}
                    </text>
                  )}
                </g>
              );
            })}
            {tree.vertices.map((vertex) => {
              const point = bpTreePointToSvg(displayLoc(vertex.id, vertex.loc), tree.sheet, paperRect);
              const active = linkedSelection.vertices.has(vertex.id);
              const radius = vertex.isLeaf ? bpTreeLeafCircleRadius(tree, vertex.id, paperRect) : 0;
              const label = bpTreeVertexLabel(vertex);
              return (
                <g key={vertex.id}>
                  {vertex.isLeaf && layers.leafCircles && (
                    <circle className="leaf-radius bp-tree-leaf-radius" cx={point.x} cy={point.y} r={radius} />
                  )}
                  <circle
                    className={[
                      'tree-node',
                      'bp-tree-node',
                      vertex.isRoot ? 'bp-tree-node--root' : '',
                      active ? 'tree-node--selected' : '',
                    ].join(' ')}
                    data-leaf={vertex.isLeaf || undefined}
                    cx={point.x}
                    cy={point.y}
                    r={vertex.isLeaf ? 7 : 8}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select BP ${vertex.isLeaf ? 'leaf ' : ''}vertex ${vertex.id}${
                      label ? `, ${label}` : ''
                    }`}
                    onPointerDown={(event) => onVertexPointerDown(event, vertex.id)}
                    onPointerMove={(event) => onVertexPointerMove(event, vertex.id)}
                    onPointerUp={(event) => finishDrag(event, vertex.id)}
                    onPointerCancel={(event) => finishDrag(event, vertex.id)}
                    onKeyDown={(event) => onVertexKeyDown(event, vertex.id)}
                  />
                  {layers.labels && label && (
                    <text className="node-label bp-tree-node-label" x={point.x + 11} y={point.y + 4}>
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
        zoomIn={() => transformRef.current?.zoomIn(0.35, 120)}
        zoomOut={() => transformRef.current?.zoomOut(0.35, 120)}
        fitToView={() => fitToView()}
        setZoomLevel={setZoomLevel}
      />
      <div className="design-status-readout">
        <span>{formatViewportZoom(zoomPercent / 100)}</span>
        {hoverPoint && (
          <span>
            {formatNumber(hoverPoint.x, 3)}, {formatNumber(hoverPoint.y, 3)}
          </span>
        )}
      </div>
      <div className="design-legend bp-tree-legend">
        <span><Circle size={13} /> {tree.vertices.filter((vertex) => vertex.isLeaf).length}</span>
        <span><Waypoints size={13} /> {tree.edges.length}</span>
        <span><Grid2X2 size={13} /> {tree.sheet.width} x {tree.sheet.height}</span>
      </div>
    </div>
  );
}
