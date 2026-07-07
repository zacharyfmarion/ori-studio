import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import {
  Axis3d,
  Circle,
  CircleDot,
  FileQuestionMark,
  FileText,
  FlipHorizontal2,
  FolderOpen,
  Layers,
  Plus,
  ScanLine,
  Tag,
  Waypoints,
} from 'lucide-react';
import { handleMenuAction } from '../../commands/menuActions';
import {
  registerViewportShortcutExecutor,
  setActiveShortcutViewportSurface,
} from '../../keyboard/shortcutRuntime';
import type { ViewportShortcutId } from '../../keyboard/shortcuts';
import { formatNumber, paperToSvg, type Point } from '../../lib/geometry';
import {
  DEFAULT_DESIGN_VIEW_LAYERS,
  DESIGN_PAPER_RECT,
  DESIGN_PAPER_SHADOW_RECT,
  type ViewportSize,
  clientPointToPaper,
  getCenteredDesignTransform,
  getDesignWorldRect,
  getViewportFitScale,
  leafCircleRadius,
  setDesignLayerVisibility,
  type DesignViewLayerKey,
  type DesignViewLayers,
} from '../../lib/designViewport';
import {
  isEdgeSelected,
  isNodeSelected,
  isPathSelected,
  selectionSize,
  toggleEdgeSelection,
  toggleNodeSelection,
} from '../../lib/selection';
import {
  nextSymmetryOption,
  paperCenter,
  symmetryOptionForPreset,
  symmetrySelectValueForState,
  type SymmetryPreset,
  type SymmetrySelectValue,
} from '../../lib/symmetryPresets';
import {
  findMirrorNodeId,
  reflectPointAcrossSymmetryAxis,
  snapPointToSymmetryAxis,
  symmetryAxisForProject,
  symmetrySide,
} from '../../lib/symmetryAuthoring';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Toggle } from '../ui/Toggle';
import {
  isViewportInteractiveTarget,
  ViewportToolbar,
  ViewportToolbarSeparator,
} from './ViewportToolbar';

const LAYER_OPTIONS: { key: DesignViewLayerKey; label: string; icon: ReactNode }[] = [
  { key: 'paths', label: 'Paths', icon: <Waypoints size={13} /> },
  { key: 'leafCircles', label: 'Circles', icon: <Circle size={13} /> },
  { key: 'labels', label: 'Labels', icon: <Tag size={13} /> },
  { key: 'symmetry', label: 'Symmetry', icon: <Axis3d size={13} /> },
];

function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

function viewBox(rect: { x: number; y: number; width: number; height: number }): string {
  return `${rect.x} ${rect.y} ${rect.width} ${rect.height}`;
}

function designSymmetryToolbarLabel(mode: SymmetrySelectValue, mirrorMode: boolean) {
  if (mirrorMode) return 'Mirror';
  if (mode === 'none') return 'Sym';
  if (mode === 'book') return 'Book';
  if (mode === 'diagonal') return 'Diag';
  return 'Custom';
}

function designSymmetryStatusLabel(mode: SymmetrySelectValue, mirrorMode: boolean) {
  if (mirrorMode) return 'Mirroring';
  if (mode === 'none') return 'Off';
  if (mode === 'book') return 'Book';
  if (mode === 'diagonal') return 'Diagonal';
  return 'Custom axis';
}

function SymmetryNumberField({
  label,
  value,
  min,
  max,
  step,
  ariaLabel,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step: number;
  ariaLabel: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const lowerBounded = min === undefined ? parsed : Math.max(min, parsed);
    const next = max === undefined ? lowerBounded : Math.min(max, lowerBounded);
    if (Math.abs(next - value) > 0.000_001) onCommit(next);
    setDraft(String(next));
  };

  return (
    <label className="symmetry-menu__field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

interface DesignViewportToolbarProps {
  zoomPercent: number;
  layers: DesignViewLayers;
  symmetryMode: SymmetrySelectValue;
  symmetryAngle: number;
  symmetryLoc: Point;
  paperWidth: number;
  paperHeight: number;
  nextSymmetryPresetLabel: string | null;
  mirrorMode: boolean;
  onLayerChange: (layer: DesignViewLayerKey, visible: boolean) => void;
  onSymmetryEnabledChange: (enabled: boolean) => void;
  onSymmetryPreset: (preset: SymmetryPreset) => void;
  onFlipSymmetryPreset: () => void;
  onMirrorModeChange: (enabled: boolean) => void;
  onCustomSymmetryChange: (update: { symAngle?: number; symLoc?: Point }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
  setZoomLevel: (scale: number) => void;
}

function DesignSymmetryMenuButton({
  symmetryMode,
  symmetryAngle,
  symmetryLoc,
  paperWidth,
  paperHeight,
  showAxis,
  mirrorMode,
  nextSymmetryPresetLabel,
  onSymmetryEnabledChange,
  onShowAxisChange,
  onSymmetryPreset,
  onFlipSymmetryPreset,
  onMirrorModeChange,
  onCustomSymmetryChange,
}: {
  symmetryMode: SymmetrySelectValue;
  symmetryAngle: number;
  symmetryLoc: Point;
  paperWidth: number;
  paperHeight: number;
  showAxis: boolean;
  mirrorMode: boolean;
  nextSymmetryPresetLabel: string | null;
  onSymmetryEnabledChange: (enabled: boolean) => void;
  onShowAxisChange: (visible: boolean) => void;
  onSymmetryPreset: (preset: SymmetryPreset) => void;
  onFlipSymmetryPreset: () => void;
  onMirrorModeChange: (enabled: boolean) => void;
  onCustomSymmetryChange: (update: { symAngle?: number; symLoc?: Point }) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const toolbarLabel = designSymmetryToolbarLabel(symmetryMode, mirrorMode);
  const statusLabel = designSymmetryStatusLabel(symmetryMode, mirrorMode);
  const canFlipPreset = symmetryMode === 'book' || symmetryMode === 'diagonal';

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div className="viewport-toolbar__menu-anchor design-symmetry-menu" ref={menuRef}>
      <button
        type="button"
        className="viewport-toolbar__symmetry-button"
        data-active={symmetryMode !== 'none' || mirrorMode ? true : undefined}
        aria-label="Design symmetry"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <FlipHorizontal2 size={14} />
        <span>{toolbarLabel}</span>
      </button>
      {open && (
        <div
          className="viewport-toolbar__dropdown symmetry-menu__panel"
          role="menu"
          aria-label="Design symmetry controls"
        >
          <div className="symmetry-menu__header">
            <span>Symmetry</span>
            <span>{statusLabel}</span>
          </div>
          <div className="symmetry-menu__toggle-row">
            <div className="symmetry-menu__toggle-copy">
              <span>Enable symmetry</span>
              <small>Define the tree mirror line</small>
            </div>
            <Toggle
              checked={symmetryMode !== 'none'}
              onChange={onSymmetryEnabledChange}
              aria-label="Enable design symmetry"
            />
          </div>
          <div className="symmetry-menu__toggle-row">
            <div className="symmetry-menu__toggle-copy">
              <span>Show axis</span>
              <small>Display the mirror line</small>
            </div>
            <Toggle
              checked={showAxis}
              onChange={onShowAxisChange}
              aria-label="Show design symmetry axis"
            />
          </div>
          <div className="symmetry-menu__toggle-row">
            <div className="symmetry-menu__toggle-copy">
              <span>Mirror nodes</span>
              <small>Reflect new node edits</small>
            </div>
            <Toggle
              checked={mirrorMode}
              onChange={onMirrorModeChange}
              aria-label="Mirror design node edits"
            />
          </div>
          <div className="symmetry-menu__section-label">Preset</div>
          <div className="symmetry-menu__preset-grid">
            <button
              type="button"
              className="symmetry-menu__preset"
              data-active={symmetryMode === 'book' ? true : undefined}
              onClick={() => onSymmetryPreset('book')}
            >
              Book
            </button>
            <button
              type="button"
              className="symmetry-menu__preset"
              data-active={symmetryMode === 'diagonal' ? true : undefined}
              onClick={() => onSymmetryPreset('diagonal')}
            >
              Diag
            </button>
          </div>
          <button
            type="button"
            className="symmetry-menu__item"
            disabled={!canFlipPreset}
            onClick={onFlipSymmetryPreset}
          >
            <span>{nextSymmetryPresetLabel ? `Flip to ${nextSymmetryPresetLabel}` : 'Flip preset axis'}</span>
          </button>
          <div className="symmetry-menu__section-label">Axis</div>
          <SymmetryNumberField
            label="Angle"
            value={symmetryAngle}
            step={1}
            ariaLabel="Design symmetry angle"
            onCommit={(symAngle) => onCustomSymmetryChange({ symAngle })}
          />
          <SymmetryNumberField
            label="X"
            value={symmetryLoc.x}
            min={0}
            max={paperWidth}
            step={0.01}
            ariaLabel="Design symmetry axis X"
            onCommit={(x) => onCustomSymmetryChange({ symLoc: { ...symmetryLoc, x } })}
          />
          <SymmetryNumberField
            label="Y"
            value={symmetryLoc.y}
            min={0}
            max={paperHeight}
            step={0.01}
            ariaLabel="Design symmetry axis Y"
            onCommit={(y) => onCustomSymmetryChange({ symLoc: { ...symmetryLoc, y } })}
          />
        </div>
      )}
    </div>
  );
}

function DesignViewportToolbar({
  zoomPercent,
  layers,
  symmetryMode,
  symmetryAngle,
  symmetryLoc,
  paperWidth,
  paperHeight,
  nextSymmetryPresetLabel,
  mirrorMode,
  onLayerChange,
  onSymmetryEnabledChange,
  onSymmetryPreset,
  onFlipSymmetryPreset,
  onMirrorModeChange,
  onCustomSymmetryChange,
  zoomIn,
  zoomOut,
  fitToView,
  setZoomLevel,
}: DesignViewportToolbarProps) {
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
      ariaLabel="Design viewport controls"
      zoomPercent={zoomPercent}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      fitToView={fitToView}
      setZoomLevel={setZoomLevel}
    >
      <ViewportToolbarSeparator />
      <DesignSymmetryMenuButton
        symmetryMode={symmetryMode}
        symmetryAngle={symmetryAngle}
        symmetryLoc={symmetryLoc}
        paperWidth={paperWidth}
        paperHeight={paperHeight}
        showAxis={layers.symmetry}
        mirrorMode={mirrorMode}
        nextSymmetryPresetLabel={nextSymmetryPresetLabel}
        onSymmetryEnabledChange={onSymmetryEnabledChange}
        onShowAxisChange={(visible) => onLayerChange('symmetry', visible)}
        onSymmetryPreset={onSymmetryPreset}
        onFlipSymmetryPreset={onFlipSymmetryPreset}
        onMirrorModeChange={onMirrorModeChange}
        onCustomSymmetryChange={onCustomSymmetryChange}
      />
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

export function DesignPanel() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const [dragging, setDragging] = useState<{
    id: number;
    start: Point;
    loc: Point;
    moved: boolean;
  } | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [layers, setLayers] = useState<DesignViewLayers>(DEFAULT_DESIGN_VIEW_LAYERS);
  const [spacePressed, setSpacePressed] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [symmetryModeOverride, setSymmetryModeOverride] = useState<SymmetrySelectValue | null>(null);
  const project = useWorkspaceStore((state) => state.project);
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const documentMode = useWorkspaceStore((state) => state.documentMode);
  const importedCreasePattern = useWorkspaceStore((state) => state.importedCreasePattern);
  const selection = useWorkspaceStore((state) => state.selection);
  const toolMode = useWorkspaceStore((state) => state.toolMode);
  const symmetryAuthoringPairs = useWorkspaceStore((state) => state.symmetryAuthoringPairs);
  const select = useWorkspaceStore((state) => state.select);
  const addNodeAt = useWorkspaceStore((state) => state.addNodeAt);
  const addNodeWithSymmetry = useWorkspaceStore((state) => state.addNodeWithSymmetry);
  const moveNode = useWorkspaceStore((state) => state.moveNode);
  const moveNodeWithSymmetry = useWorkspaceStore((state) => state.moveNodeWithSymmetry);
  const setToolMode = useWorkspaceStore((state) => state.setToolMode);
  const setSymmetry = useWorkspaceStore((state) => state.setSymmetry);
  const setActiveEditingSurface = useWorkspaceStore((state) => state.setActiveEditingSurface);
  const projectLoadId = useWorkspaceStore((state) => state.projectLoadId);
  const designViewportFitRequestId = useWorkspaceStore(
    (state) => state.designViewportFitRequestId
  );
  const mirrorMode = toolMode === 'symmetry';
  const inferredSymmetryMode = symmetrySelectValueForState({
    hasSymmetry: project.hasSymmetry,
    symAngle: project.paper.symAngle,
    symLoc: project.paper.symLoc,
    paperWidth: project.paper.width,
    paperHeight: project.paper.height,
  });
  const symmetryMode = project.hasSymmetry ? (symmetryModeOverride ?? inferredSymmetryMode) : 'none';
  const presetSymmetryMode = symmetryMode === 'book' || symmetryMode === 'diagonal' ? symmetryMode : null;
  const activePresetOption = presetSymmetryMode
    ? symmetryOptionForPreset(presetSymmetryMode, project.paper.symAngle)
    : null;
  const nextSymmetryPresetOption = activePresetOption ? nextSymmetryOption(activePresetOption) : null;
  const symmetryAxis = useMemo(() => symmetryAxisForProject(project), [project]);
  const showEmptyState = engineReady && project.nodes.length === 0 && project.edges.length === 0;

  useEffect(() => {
    setSymmetryModeOverride(null);
  }, [projectLoadId]);

  const nodeLocations = useMemo(() => {
    if (!dragging) return undefined;
    const locations = new Map([[dragging.id, dragging.loc]]);
    if (mirrorMode && project.hasSymmetry) {
      const pairedNode = findMirrorNodeId(project, symmetryAuthoringPairs, dragging.id);
      if (pairedNode) {
        locations.set(pairedNode, reflectPointAcrossSymmetryAxis(dragging.loc, symmetryAxis));
      }
    }
    return locations;
  }, [dragging, mirrorMode, project, symmetryAuthoringPairs, symmetryAxis]);
  const worldRect = useMemo(
    () => getDesignWorldRect(project, layers, { nodeLocations }),
    [layers, nodeLocations, project]
  );

  const findNode = (id: number) => project.nodes.find((node) => node.id === id);
  const displayLoc = (id: number, loc: Point) => nodeLocations?.get(id) ?? loc;

  const symmetryLine = useMemo(() => {
    const center = paperToSvg(project.paper.symLoc, DESIGN_PAPER_RECT);
    const angle = (project.paper.symAngle * Math.PI) / 180;
    const span = Math.hypot(worldRect.width, worldRect.height);
    return {
      x1: center.x - Math.cos(angle) * span,
      y1: center.y + Math.sin(angle) * span,
      x2: center.x + Math.cos(angle) * span,
      y2: center.y - Math.sin(angle) * span,
    };
  }, [project.paper.symAngle, project.paper.symLoc, worldRect]);

  const symmetryHoverPreview = useMemo(() => {
    if (!mirrorMode || !project.hasSymmetry || selection.kind !== 'node' || !hoverPoint) return null;
    const parent = project.nodes.find((node) => node.id === selection.id);
    if (!parent) return null;
    const snapped = snapPointToSymmetryAxis(hoverPoint, symmetryAxis);
    const parentSide = symmetrySide(parent.loc, symmetryAxis);
    const pairedParentId = findMirrorNodeId(project, symmetryAuthoringPairs, parent.id);
    const pairedParent = pairedParentId
      ? project.nodes.find((node) => node.id === pairedParentId)
      : null;
    const shouldMirror = !snapped.snapped && (parentSide === 0 || pairedParent);
    return {
      primary: { from: parent.loc, to: snapped.point },
      mirror:
        shouldMirror && (parentSide === 0 || pairedParent)
          ? {
              from: parentSide === 0 ? parent.loc : pairedParent!.loc,
              to: reflectPointAcrossSymmetryAxis(snapped.point, symmetryAxis),
            }
          : null,
      snapped: snapped.snapped,
      unresolved: !snapped.snapped && parentSide !== 0 && !pairedParent,
    };
  }, [hoverPoint, mirrorMode, project, selection, symmetryAuthoringPairs, symmetryAxis]);

  const eventToPaper = useCallback(
    (event: PointerEvent): Point => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      return clientPointToPaper(
        { x: event.clientX, y: event.clientY },
        svg.getBoundingClientRect(),
        worldRect
      );
    },
    [worldRect]
  );

  const getViewportSize = useCallback((): ViewportSize | null => {
    const viewport = containerRef.current;
    if (!viewport) return null;
    return {
      width: viewport.clientWidth || viewport.offsetWidth,
      height: viewport.clientHeight || viewport.offsetHeight,
    };
  }, []);

  const computeFitScale = useCallback(() => {
    const viewport = getViewportSize();
    if (!viewport) return 1;
    return getViewportFitScale(viewport, worldRect);
  }, [getViewportSize, worldRect]);

  const fitPaperToView = useCallback(
    (animationTime = 180) => {
      const viewport = getViewportSize();
      if (!viewport) return;
      const transform = getCenteredDesignTransform(viewport, worldRect, DESIGN_PAPER_RECT);
      transformRef.current?.setTransform(
        transform.positionX,
        transform.positionY,
        transform.scale,
        animationTime
      );
    },
    [getViewportSize, worldRect]
  );

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

  const lastFittedProjectLoadIdRef = useRef<number | null>(null);
  const lastHandledFitRequestRef = useRef(0);
  useLayoutEffect(() => {
    if (designViewportFitRequestId === 0) return undefined;
    if (lastHandledFitRequestRef.current === designViewportFitRequestId) return undefined;
    lastHandledFitRequestRef.current = designViewportFitRequestId;
    lastFittedProjectLoadIdRef.current = projectLoadId;

    fitPaperToView(0);
    const frame = requestAnimationFrame(() => fitPaperToView(0));
    return () => cancelAnimationFrame(frame);
  }, [designViewportFitRequestId, fitPaperToView, projectLoadId]);

  const fitLoadedProject = useCallback(
    (animationTime = 0) => {
      if (lastFittedProjectLoadIdRef.current === projectLoadId) return true;
      const container = containerRef.current;
      if (!container || !transformRef.current || container.clientWidth <= 0 || container.clientHeight <= 0) {
        return false;
      }
      transformRef.current.centerView(computeFitScale(), animationTime);
      lastFittedProjectLoadIdRef.current = projectLoadId;
      return true;
    },
    [computeFitScale, projectLoadId]
  );

  const fitLoadedProjectRef = useRef(fitLoadedProject);
  useEffect(() => {
    fitLoadedProjectRef.current = fitLoadedProject;
  }, [fitLoadedProject]);

  useEffect(() => {
    const container = containerRef.current;
    let frame = requestAnimationFrame(() => fitLoadedProjectRef.current(0));
    const observer =
      typeof ResizeObserver === 'undefined' || !container
        ? null
        : new ResizeObserver(() => {
            if (lastFittedProjectLoadIdRef.current !== projectLoadId) {
              cancelAnimationFrame(frame);
              frame = requestAnimationFrame(() => fitLoadedProjectRef.current(0));
            }
          });

    if (observer && container) {
      observer.observe(container);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [projectLoadId]);

  const setLayer = useCallback((layer: DesignViewLayerKey, visible: boolean) => {
    setLayers((current) => setDesignLayerVisibility(current, layer, visible));
  }, []);

  const setDesignSymmetryEnabled = useCallback(
    (enabled: boolean) => {
      setActiveEditingSurface('tree');
      if (!enabled) {
        setSymmetryModeOverride(null);
        if (mirrorMode) setToolMode('select');
        void setSymmetry({ hasSymmetry: false });
        return;
      }
      setSymmetryModeOverride(null);
      setLayers((current) => setDesignLayerVisibility(current, 'symmetry', true));
      void setSymmetry({
        hasSymmetry: true,
        symAngle: project.hasSymmetry ? project.paper.symAngle : 90,
        symLoc: project.hasSymmetry
          ? project.paper.symLoc
          : paperCenter(project.paper.width, project.paper.height),
      });
    },
    [
      mirrorMode,
      project.hasSymmetry,
      project.paper.height,
      project.paper.symAngle,
      project.paper.symLoc,
      project.paper.width,
      setActiveEditingSurface,
      setSymmetry,
      setToolMode,
    ]
  );

  const applyDesignSymmetryPreset = useCallback(
    (preset: SymmetryPreset) => {
      const option = symmetryOptionForPreset(preset, project.paper.symAngle);
      setActiveEditingSurface('tree');
      setSymmetryModeOverride(preset);
      setLayers((current) => setDesignLayerVisibility(current, 'symmetry', true));
      void setSymmetry({
        hasSymmetry: true,
        symAngle: option.angle,
        symLoc: paperCenter(project.paper.width, project.paper.height),
      });
    },
    [
      project.paper.height,
      project.paper.symAngle,
      project.paper.width,
      setActiveEditingSurface,
      setSymmetry,
    ]
  );

  const flipDesignSymmetryPreset = useCallback(() => {
    if (!nextSymmetryPresetOption || !presetSymmetryMode) return;
    setActiveEditingSurface('tree');
    setSymmetryModeOverride(presetSymmetryMode);
    setLayers((current) => setDesignLayerVisibility(current, 'symmetry', true));
    void setSymmetry({
      hasSymmetry: true,
      symAngle: nextSymmetryPresetOption.angle,
      symLoc: paperCenter(project.paper.width, project.paper.height),
    });
  }, [
    nextSymmetryPresetOption,
    presetSymmetryMode,
    project.paper.height,
    project.paper.width,
    setActiveEditingSurface,
    setSymmetry,
  ]);

  const setDesignMirrorMode = useCallback(
    (enabled: boolean) => {
      setActiveEditingSurface('tree');
      if (!enabled) {
        setToolMode('select');
        return;
      }
      if (!project.hasSymmetry) {
        setSymmetryModeOverride(null);
        void setSymmetry({
          hasSymmetry: true,
          symAngle: 90,
          symLoc: paperCenter(project.paper.width, project.paper.height),
        });
      }
      setLayers((current) => setDesignLayerVisibility(current, 'symmetry', true));
      setToolMode('symmetry');
    },
    [
      project.hasSymmetry,
      project.paper.height,
      project.paper.width,
      setActiveEditingSurface,
      setSymmetry,
      setToolMode,
    ]
  );

  const updateDesignCustomSymmetry = useCallback(
    (update: { symAngle?: number; symLoc?: Point }) => {
      setActiveEditingSurface('tree');
      setSymmetryModeOverride('custom');
      setLayers((current) => setDesignLayerVisibility(current, 'symmetry', true));
      void setSymmetry({ hasSymmetry: true, ...update });
    },
    [setActiveEditingSurface, setSymmetry]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      const interactive = isViewportInteractiveTarget(event.target);
      if (event.key === ' ' && !interactive) {
        event.preventDefault();
        setSpacePressed(true);
        return;
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

  const onPaperPointerDown = (event: PointerEvent<SVGRectElement>) => {
    if (event.button !== 0 || spacePressed) return;
    if (selection.kind !== 'node' && selectionSize(selection) > 0) {
      select({ kind: 'tree' });
      return;
    }
    const connectTo = selection.kind === 'node' ? selection.id : undefined;
    const loc = eventToPaper(event);
    if (mirrorMode) void addNodeWithSymmetry(loc, connectTo);
    else void addNodeAt(loc, connectTo);
  };

  const onCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget || spacePressed) return;
    if (selectionSize(selection) > 0) select({ kind: 'tree' });
  };

  const onNodePointerDown = (event: PointerEvent<SVGCircleElement>, nodeId: number) => {
    if (event.button !== 0 || spacePressed) return;
    event.stopPropagation();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      select(toggleNodeSelection(selection, nodeId));
      return;
    }
    select({ kind: 'node', id: nodeId });
    const node = findNode(nodeId);
    if (!node) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging({ id: nodeId, start: node.loc, loc: node.loc, moved: false });
  };

  const onNodePointerMove = (event: PointerEvent<SVGCircleElement>, nodeId: number) => {
    if (dragging?.id !== nodeId) return;
    event.stopPropagation();
    const loc = eventToPaper(event);
    setHoverPoint(loc);
    const dx = loc.x - dragging.start.x;
    const dy = loc.y - dragging.start.y;
    setDragging({
      id: nodeId,
      start: dragging.start,
      loc,
      moved: dragging.moved || Math.hypot(dx, dy) > 0.003,
    });
  };

  const finishDrag = (event: PointerEvent<SVGCircleElement>, nodeId: number) => {
    if (dragging?.id !== nodeId) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const loc = dragging.loc;
    const moved = dragging.moved;
    setDragging(null);
    if (moved) {
      if (mirrorMode) void moveNodeWithSymmetry(nodeId, loc);
      else void moveNode(nodeId, loc);
    }
  };

  const onCanvasPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    setHoverPoint(eventToPaper(event));
  };

  if (documentMode === 'crease-pattern') {
    return (
      <section className="panel-shell design-panel">
        <div className="panel-body document-mode-empty">
          <div className="document-mode-empty__icon" aria-hidden="true">
            <FileQuestionMark size={30} />
          </div>
          <span className="document-mode-empty__message">
            {importedCreasePattern
              ? (
                <>
                  <span className="document-mode-empty__filename">
                    {importedCreasePattern.source.filename}
                  </span>{' '}
                  is an imported crease pattern without an editable tree.
                </>
              )
              : (
                'This document does not have an editable tree.'
              )}
          </span>
          <div className="document-mode-empty__actions">
            <Button size="sm" variant="primary" onClick={() => void handleMenuAction('view.edit')}>
              <ScanLine size={14} />
              Edit CP
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleMenuAction('file.new')}>
              <FileText size={14} />
              New Tree
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleMenuAction('file.open')}>
              <FolderOpen size={14} />
              Open
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel-shell design-panel">
      <div
        ref={containerRef}
        className="panel-body design-panel__body"
        data-space-pan={spacePressed || undefined}
        tabIndex={-1}
        onPointerDownCapture={(event) => {
          setActiveShortcutViewportSurface('tree');
          setActiveEditingSurface('tree');
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
            requestAnimationFrame(() => fitLoadedProjectRef.current(0));
          }}
          onTransformed={(_ref, state) => setZoomPercent(Math.round(state.scale * 100))}
        >
          <TransformComponent
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{ width: 'fit-content', height: 'fit-content' }}
          >
            <svg
              ref={svgRef}
              className="design-canvas"
              viewBox={viewBox(worldRect)}
              width={worldRect.width}
              height={worldRect.height}
              style={{ width: worldRect.width, height: worldRect.height }}
              role="img"
              aria-label="Tree design canvas"
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerLeave={() => setHoverPoint(null)}
            >
              <rect
                className="paper-shadow"
                x={DESIGN_PAPER_SHADOW_RECT.x}
                y={DESIGN_PAPER_SHADOW_RECT.y}
                width={DESIGN_PAPER_SHADOW_RECT.width}
                height={DESIGN_PAPER_SHADOW_RECT.height}
                rx="6"
              />
              <rect
                className="paper"
                x={DESIGN_PAPER_RECT.x}
                y={DESIGN_PAPER_RECT.y}
                width={DESIGN_PAPER_RECT.width}
                height={DESIGN_PAPER_RECT.height}
              />
              <rect
                className="paper-hit-area"
                x={DESIGN_PAPER_RECT.x}
                y={DESIGN_PAPER_RECT.y}
                width={DESIGN_PAPER_RECT.width}
                height={DESIGN_PAPER_RECT.height}
                onPointerDown={onPaperPointerDown}
              />
              {project.hasSymmetry && layers.symmetry && (
                <>
                  {mirrorMode && (
                    <line
                      className="symmetry-snap-lane"
                      x1={symmetryLine.x1}
                      y1={symmetryLine.y1}
                      x2={symmetryLine.x2}
                      y2={symmetryLine.y2}
                    />
                  )}
                  <line
                    className="symmetry-line"
                    x1={symmetryLine.x1}
                    y1={symmetryLine.y1}
                    x2={symmetryLine.x2}
                    y2={symmetryLine.y2}
                  />
                </>
              )}
              {showEmptyState && (
                <foreignObject
                  className="design-empty-state"
                  x={DESIGN_PAPER_RECT.x}
                  y={DESIGN_PAPER_RECT.y}
                  width={DESIGN_PAPER_RECT.width}
                  height={DESIGN_PAPER_RECT.height}
                >
                  <div className="design-empty-state__inner" role="note">
                    <div className="design-empty-state__copy">
                      <strong>Sketch the tree behind your design</strong>
                      <span>Use branches for the flaps, limbs, and features the folded base needs.</span>
                    </div>
                  </div>
                </foreignObject>
              )}
              {symmetryHoverPreview && (
                <g className="symmetry-ghost">
                  {(() => {
                    const p1 = paperToSvg(symmetryHoverPreview.primary.from, DESIGN_PAPER_RECT);
                    const p2 = paperToSvg(symmetryHoverPreview.primary.to, DESIGN_PAPER_RECT);
                    return (
                      <>
                        <line
                          className={[
                            'symmetry-ghost-edge',
                            symmetryHoverPreview.unresolved ? 'symmetry-ghost-edge--unresolved' : '',
                          ].join(' ')}
                          x1={p1.x}
                          y1={p1.y}
                          x2={p2.x}
                          y2={p2.y}
                        />
                        <circle
                          className="symmetry-ghost-node"
                          data-snapped={symmetryHoverPreview.snapped || undefined}
                          cx={p2.x}
                          cy={p2.y}
                          r="7"
                        />
                      </>
                    );
                  })()}
                  {symmetryHoverPreview.mirror &&
                    (() => {
                      const p1 = paperToSvg(symmetryHoverPreview.mirror.from, DESIGN_PAPER_RECT);
                      const p2 = paperToSvg(symmetryHoverPreview.mirror.to, DESIGN_PAPER_RECT);
                      return (
                        <>
                          <line
                            className="symmetry-ghost-edge"
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                          />
                          <circle className="symmetry-ghost-node" cx={p2.x} cy={p2.y} r="7" />
                        </>
                      );
                    })()}
                </g>
              )}
              {layers.paths &&
                project.paths.map((path) => {
                  const a = findNode(path.nodes[0]);
                  const b = findNode(path.nodes[1]);
                  if (!a || !b) return null;
                  const p1 = paperToSvg(displayLoc(a.id, a.loc), DESIGN_PAPER_RECT);
                  const p2 = paperToSvg(displayLoc(b.id, b.loc), DESIGN_PAPER_RECT);
                  const className = !path.isLeaf
                    ? 'tree-path tree-path--internal'
                    : path.isActive
                      ? 'tree-path tree-path--active'
                      : path.isFeasible
                        ? 'tree-path tree-path--feasible'
                        : 'tree-path tree-path--bad';
                  const conditioned = path.isConditioned ? 'tree-path--conditioned' : '';
                  const active = isPathSelected(selection, path.id);
                  return (
                    <line
                      key={path.id}
                      className={`${className} ${conditioned} ${active ? 'tree-path--selected' : ''}`}
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      onPointerDown={(event) => {
                        if (spacePressed) return;
                        event.stopPropagation();
                        select({ kind: 'path', id: path.id });
                      }}
                    />
                  );
                })}
              {project.edges.map((edge) => {
                const a = findNode(edge.nodes[0]);
                const b = findNode(edge.nodes[1]);
                if (!a || !b) return null;
                const p1 = paperToSvg(displayLoc(a.id, a.loc), DESIGN_PAPER_RECT);
                const p2 = paperToSvg(displayLoc(b.id, b.loc), DESIGN_PAPER_RECT);
                const active = isEdgeSelected(selection, edge.id);
                return (
                  <g
                    key={edge.id}
                    onPointerDown={(event) => {
                      if (spacePressed) return;
                      event.stopPropagation();
                      select(
                        event.shiftKey || event.metaKey || event.ctrlKey
                          ? toggleEdgeSelection(selection, edge.id)
                          : { kind: 'edge', id: edge.id }
                      );
                    }}
                  >
                    <line
                      className={[
                        'tree-edge',
                        edge.isConditioned ? 'tree-edge--conditioned' : '',
                        active ? 'tree-edge--selected' : '',
                      ].join(' ')}
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                    />
                    {layers.labels && (
                      <text className="edge-label" x={(p1.x + p2.x) / 2 + 8} y={(p1.y + p2.y) / 2 - 8}>
                        {formatNumber(edge.length, 2)}
                      </text>
                    )}
                  </g>
                );
              })}
              {project.nodes.map((node) => {
                const point = paperToSvg(displayLoc(node.id, node.loc), DESIGN_PAPER_RECT);
                const active = isNodeSelected(selection, node.id);
                const radius = node.isLeaf ? leafCircleRadius(project, node.id) : 0;
                return (
                  <g key={node.id}>
                    {node.isLeaf && layers.leafCircles && (
                      <circle className="leaf-radius" cx={point.x} cy={point.y} r={radius} />
                    )}
                    <circle
                      className={[
                        'tree-node',
                        node.isConditioned ? 'tree-node--conditioned' : '',
                        active ? 'tree-node--selected' : '',
                      ].join(' ')}
                      data-leaf={node.isLeaf || undefined}
                      cx={point.x}
                      cy={point.y}
                      r={node.isLeaf ? 7 : 8}
                      onPointerDown={(event) => onNodePointerDown(event, node.id)}
                      onPointerMove={(event) => onNodePointerMove(event, node.id)}
                      onPointerUp={(event) => finishDrag(event, node.id)}
                      onPointerCancel={(event) => finishDrag(event, node.id)}
                    />
                    {layers.labels && (
                      <text className="node-label" x={point.x + 11} y={point.y + 4}>
                        {node.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </TransformComponent>
        </TransformWrapper>
        <DesignViewportToolbar
          zoomPercent={zoomPercent}
          layers={layers}
          symmetryMode={symmetryMode}
          symmetryAngle={project.paper.symAngle}
          symmetryLoc={project.paper.symLoc}
          paperWidth={project.paper.width}
          paperHeight={project.paper.height}
          nextSymmetryPresetLabel={nextSymmetryPresetOption?.label ?? null}
          mirrorMode={mirrorMode}
          onLayerChange={setLayer}
          onSymmetryEnabledChange={setDesignSymmetryEnabled}
          onSymmetryPreset={applyDesignSymmetryPreset}
          onFlipSymmetryPreset={flipDesignSymmetryPreset}
          onMirrorModeChange={setDesignMirrorMode}
          onCustomSymmetryChange={updateDesignCustomSymmetry}
          zoomIn={() => transformRef.current?.zoomIn(0.35, 120)}
          zoomOut={() => transformRef.current?.zoomOut(0.35, 120)}
          fitToView={() => fitToView()}
          setZoomLevel={setZoomLevel}
        />
        <div className="design-status-readout">
          <span>{formatZoom(zoomPercent / 100)}</span>
          {hoverPoint && (
            <span>
              {formatNumber(hoverPoint.x, 3)}, {formatNumber(hoverPoint.y, 3)}
            </span>
          )}
        </div>
        <div className="design-legend">
          <span><CircleDot size={13} /> Terminal</span>
          <span><Waypoints size={13} /> Active path</span>
          <span><Plus size={13} /> Scale {formatNumber(project.scale, 3)}</span>
        </div>
      </div>
    </section>
  );
}
