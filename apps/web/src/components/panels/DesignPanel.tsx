import { selectDesignMethod, selectDesignViewportFitRequestId, selectOristudioBpDocument, selectProject, selectSelection, selectSymmetryAuthoringPairs } from '../../store/workspaceStore/designTabs';
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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import {
  Axis3d,
  Circle,
  CircleDot,
  Plus,
  SlidersHorizontal,
  Tag,
  Waypoints,
} from 'lucide-react';
import {
  registerViewportShortcutExecutor,
  setActiveShortcutViewportSurface,
} from '../../keyboard/shortcutRuntime';
import type { ViewportShortcutId } from '../../keyboard/shortcuts';
import { formatNumber, paperToSvg, type Point } from '../../lib/geometry';
import { treeDotPx, type TreeDotSizes } from '../../lib/treeNodeDot';
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
import { DesignAttributionFooter } from '../DesignAttributionFooter';
import { BpTreePanel } from './BpTreePanel';
import { IconButton } from '../ui/IconButton';
import { SurfaceLoading } from '../ui/SurfaceLoading';
import {
  isViewportInteractiveTarget,
  ViewportToolbar,
  viewportLayerItems,
  viewportSymmetryItems,
  type ViewportToolbarGroupSpec,
} from './ViewportToolbar';

const DOT_SIZES: TreeDotSizes = { leafPx: 7, branchPx: 8 };

const LAYER_OPTIONS: { key: DesignViewLayerKey; icon: ReactNode }[] = [
  { key: 'paths', icon: <Waypoints size={13} /> },
  { key: 'leafCircles', icon: <Circle size={13} /> },
  { key: 'labels', icon: <Tag size={13} /> },
  { key: 'symmetry', icon: <Axis3d size={13} /> },
];

/** Localized design-view layer label. Literal `t()` calls keep the keys extractable. */
function designLayerLabel(t: TFunction, key: DesignViewLayerKey): string {
  switch (key) {
    case 'paths':
      return t('panels:design.layerPaths', 'Paths');
    case 'leafCircles':
      return t('panels:design.layerCircles', 'Circles');
    case 'labels':
      return t('panels:design.layerLabels', 'Labels');
    case 'symmetry':
      return t('panels:design.layerSymmetry', 'Symmetry');
    default:
      return key;
  }
}

function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

function viewBox(rect: { x: number; y: number; width: number; height: number }): string {
  return `${rect.x} ${rect.y} ${rect.width} ${rect.height}`;
}

function designSymmetryStatusLabel(t: TFunction, mode: SymmetrySelectValue) {
  if (mode === 'none') return t('panels:design.symmetryStatusOff', 'Off');
  if (mode === 'book') return t('panels:design.symmetryStatusBook', 'Book');
  if (mode === 'diagonal') return t('panels:design.symmetryStatusDiagonal', 'Diagonal');
  return t('panels:design.symmetryStatusCustom', 'Custom axis');
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
  onLayerChange: (layer: DesignViewLayerKey, visible: boolean) => void;
  onSymmetryEnabledChange: (enabled: boolean) => void;
  onSymmetryPreset: (preset: SymmetryPreset) => void;
  onFlipSymmetryPreset: () => void;
  onCustomSymmetryChange: (update: { symAngle?: number; symLoc?: Point }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
  setZoomLevel: (scale: number) => void;
}

function DesignSymmetryOptionsButton({
  symmetryMode,
  symmetryAngle,
  symmetryLoc,
  paperWidth,
  paperHeight,
  nextSymmetryPresetLabel,
  onSymmetryPreset,
  onFlipSymmetryPreset,
  onCustomSymmetryChange,
}: {
  symmetryMode: SymmetrySelectValue;
  symmetryAngle: number;
  symmetryLoc: Point;
  paperWidth: number;
  paperHeight: number;
  nextSymmetryPresetLabel: string | null;
  onSymmetryPreset: (preset: SymmetryPreset) => void;
  onFlipSymmetryPreset: () => void;
  onCustomSymmetryChange: (update: { symAngle?: number; symLoc?: Point }) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const statusLabel = designSymmetryStatusLabel(t, symmetryMode);
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
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:design.symmetryOptions', 'Symmetry options')}
        isActive={open}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal size={14} />
      </IconButton>
      {open && (
        <div
          className="viewport-toolbar__dropdown symmetry-menu__panel"
          role="menu"
          aria-label={t('panels:design.symmetryControls', 'Design symmetry controls')}
        >
          <div className="symmetry-menu__header">
            <span>{t('panels:design.symmetry', 'Symmetry')}</span>
            <span>{statusLabel}</span>
          </div>
          <div className="symmetry-menu__section-label">{t('panels:design.preset', 'Preset')}</div>
          <div className="symmetry-menu__preset-grid">
            <button
              type="button"
              className="symmetry-menu__preset"
              data-active={symmetryMode === 'book' ? true : undefined}
              onClick={() => onSymmetryPreset('book')}
            >
              {t('panels:design.presetBook', 'Book')}
            </button>
            <button
              type="button"
              className="symmetry-menu__preset"
              data-active={symmetryMode === 'diagonal' ? true : undefined}
              onClick={() => onSymmetryPreset('diagonal')}
            >
              {t('panels:design.presetDiag', 'Diag')}
            </button>
          </div>
          <button
            type="button"
            className="symmetry-menu__item"
            disabled={!canFlipPreset}
            onClick={onFlipSymmetryPreset}
          >
            <span>
              {nextSymmetryPresetLabel
                ? t('panels:design.flipToPreset', 'Flip to {{preset}}', { preset: nextSymmetryPresetLabel })
                : t('panels:design.flipPresetAxis', 'Flip preset axis')}
            </span>
          </button>
          <div className="symmetry-menu__section-label">{t('panels:design.axis', 'Axis')}</div>
          <SymmetryNumberField
            label={t('panels:design.axisAngle', 'Angle')}
            value={symmetryAngle}
            step={1}
            ariaLabel={t('panels:design.axisAngleAria', 'Design symmetry angle')}
            onCommit={(symAngle) => onCustomSymmetryChange({ symAngle })}
          />
          <SymmetryNumberField
            label={t('panels:design.axisX', 'X')}
            value={symmetryLoc.x}
            min={0}
            max={paperWidth}
            step={0.01}
            ariaLabel={t('panels:design.axisXAria', 'Design symmetry axis X')}
            onCommit={(x) => onCustomSymmetryChange({ symLoc: { ...symmetryLoc, x } })}
          />
          <SymmetryNumberField
            label={t('panels:design.axisY', 'Y')}
            value={symmetryLoc.y}
            min={0}
            max={paperHeight}
            step={0.01}
            ariaLabel={t('panels:design.axisYAria', 'Design symmetry axis Y')}
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
  onLayerChange,
  onSymmetryEnabledChange,
  onSymmetryPreset,
  onFlipSymmetryPreset,
  onCustomSymmetryChange,
  zoomIn,
  zoomOut,
  fitToView,
  setZoomLevel,
}: DesignViewportToolbarProps) {
  const { t } = useTranslation();

  const groups: ViewportToolbarGroupSpec[] = [
    {
      id: 'symmetry',
      items: [
        ...viewportSymmetryItems({
          enabled: symmetryMode !== 'none',
          label: t('panels:design.symmetryToolbar', 'Symmetry'),
          title: t('panels:design.symmetryButton', 'Design symmetry'),
          onToggle: () => onSymmetryEnabledChange(symmetryMode === 'none'),
        }),
        {
          kind: 'node',
          id: 'symmetry-options',
          // Stays a popover on every pointer: presets, an angle and a position
          // are a form, and a form has no menu-item shape.
          node: (
            <DesignSymmetryOptionsButton
              symmetryMode={symmetryMode}
              symmetryAngle={symmetryAngle}
              symmetryLoc={symmetryLoc}
              paperWidth={paperWidth}
              paperHeight={paperHeight}
              nextSymmetryPresetLabel={nextSymmetryPresetLabel}
              onSymmetryPreset={onSymmetryPreset}
              onFlipSymmetryPreset={onFlipSymmetryPreset}
              onCustomSymmetryChange={onCustomSymmetryChange}
            />
          ),
        },
      ],
    },
    {
      id: 'layers',
      items: viewportLayerItems({
        title: t('panels:design.layers', 'Layers'),
        options: LAYER_OPTIONS.map((option) => ({
          ...option,
          label: designLayerLabel(t, option.key),
        })),
        visible: layers,
        onChange: onLayerChange,
      }),
    },
  ];

  return (
    <ViewportToolbar
      ariaLabel={t('panels:design.viewportControls', 'Design viewport controls')}
      zoomPercent={zoomPercent}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      fitToView={fitToView}
      setZoomLevel={setZoomLevel}
      groups={groups}
    />
  );
}

/**
 * The design canvas: one kind's primary pane, for the tab that declared it.
 *
 * Neither the tab strip nor the method chooser is here. The strip spans the whole
 * Design workspace (see `WorkspaceShell`) and the chooser is the state of a tab
 * that has *no* kind, so it has no panes at all — `DesignPaneLayout` owns both.
 *
 * Remounted per design, because its dock is: two designs never share a viewport,
 * a hover, or a drag.
 */
export function DesignPanel() {
  const { t } = useTranslation();
  const designMethod = useWorkspaceStore(selectDesignMethod);
  const oristudioBpDocument = useWorkspaceStore((state) => selectOristudioBpDocument(state));
  const oristudioBpError = useWorkspaceStore((state) => state.oristudioBpError);
  const ensureBoxPleatProject = useWorkspaceStore((state) => state.ensureBoxPleatProject);

  // Self-provision the box-pleat surface: entering `/design/bp` without a BP
  // document (a direct deep link / reload) seeds a starter project so the surface
  // stands alone, mirroring the Edit canvas. No-op once a document exists.
  useEffect(() => {
    if (designMethod === 'box-pleat' && !oristudioBpDocument && !oristudioBpError) {
      void ensureBoxPleatProject();
    }
  }, [designMethod, oristudioBpDocument, oristudioBpError, ensureBoxPleatProject]);

  if (designMethod === 'box-pleat') {
    if (oristudioBpDocument) {
      return (
        <section className="panel-shell design-panel bp-tree-panel">
          <BpTreePanel document={oristudioBpDocument} />
        </section>
      );
    }
    // Box-pleat chosen but the BP worker hasn't produced the document yet — show
    // a loading state (gated on the BP worker) instead of flashing the tree
    // editor. On failure, fall through to the tree editor's error surface.
    if (!oristudioBpError) {
      return (
        <section className="panel-shell design-panel">
          <SurfaceLoading
            label={t('panels:design.preparingBoxPleatEditor', 'Preparing the box-pleat editor…')}
          />
        </section>
      );
    }
  }
  return <TreeMakerDesignPanel />;
}

function TreeMakerDesignPanel() {
  const { t } = useTranslation();
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
  const project = useWorkspaceStore((state) => selectProject(state));
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const selection = useWorkspaceStore((state) => selectSelection(state));
  const symmetryAuthoringPairs = useWorkspaceStore((state) => selectSymmetryAuthoringPairs(state));
  const select = useWorkspaceStore((state) => state.select);
  const addNodeAt = useWorkspaceStore((state) => state.addNodeAt);
  const addNodeWithSymmetry = useWorkspaceStore((state) => state.addNodeWithSymmetry);
  const moveNode = useWorkspaceStore((state) => state.moveNode);
  const moveNodeWithSymmetry = useWorkspaceStore((state) => state.moveNodeWithSymmetry);
  const setSymmetry = useWorkspaceStore((state) => state.setSymmetry);
  const projectLoadId = useWorkspaceStore((state) => state.projectLoadId);
  const designViewportFitRequestId = useWorkspaceStore(
    (state) => selectDesignViewportFitRequestId(state)
  );
  // Symmetry is one decision, so `project.hasSymmetry` is the only thing that
  // says whether node edits mirror. There is no separate mirror-editing mode to
  // fall out of step with the document.
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
    if (project.hasSymmetry) {
      const pairedNode = findMirrorNodeId(project, symmetryAuthoringPairs, dragging.id);
      if (pairedNode) {
        locations.set(pairedNode, reflectPointAcrossSymmetryAxis(dragging.loc, symmetryAxis));
      }
    }
    return locations;
  }, [dragging, project, symmetryAuthoringPairs, symmetryAxis]);
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
    if (!project.hasSymmetry || selection.kind !== 'node' || !hoverPoint) return null;
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
  }, [hoverPoint, project, selection, symmetryAuthoringPairs, symmetryAxis]);

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

  // Camera only. Every other viewport verb is declined so the chord reaches the
  // scope that owns it -- Delete belongs to `edit.delete`, which deletes the
  // selected tree parts.
  const handleViewportShortcut = useCallback(
    (id: ViewportShortcutId): boolean => {
      switch (id) {
        case 'viewport.zoomIn':
          transformRef.current?.zoomIn(0.35, 120);
          return true;
        case 'viewport.zoomOut':
          transformRef.current?.zoomOut(0.35, 120);
          return true;
        case 'viewport.fit':
          fitToView();
          return true;
        case 'viewport.actualSize':
          setActualSize();
          return true;
        default:
          return false;
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
      if (!enabled) {
        setSymmetryModeOverride(null);
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
      project.hasSymmetry,
      project.paper.height,
      project.paper.symAngle,
      project.paper.symLoc,
      project.paper.width,
      setSymmetry,
    ]
  );

  const applyDesignSymmetryPreset = useCallback(
    (preset: SymmetryPreset) => {
      const option = symmetryOptionForPreset(preset, project.paper.symAngle);
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
      setSymmetry,
    ]
  );

  const flipDesignSymmetryPreset = useCallback(() => {
    if (!nextSymmetryPresetOption || !presetSymmetryMode) return;
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
    setSymmetry,
  ]);

  const updateDesignCustomSymmetry = useCallback(
    (update: { symAngle?: number; symLoc?: Point }) => {
      setSymmetryModeOverride('custom');
      setLayers((current) => setDesignLayerVisibility(current, 'symmetry', true));
      void setSymmetry({ hasSymmetry: true, ...update });
    },
    [setSymmetry]
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
    if (project.hasSymmetry) void addNodeWithSymmetry(loc, connectTo);
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
      if (project.hasSymmetry) void moveNodeWithSymmetry(nodeId, loc);
      else void moveNode(nodeId, loc);
    }
  };

  const onCanvasPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    setHoverPoint(eventToPaper(event));
  };

  if (!engineReady) {
    // The tree editor runs on the treemaker engine; show its own loading state
    // while that WASM comes up (no global overlay gates this surface).
    return (
      <section className="panel-shell design-panel">
        <SurfaceLoading label={t('panels:design.preparingTreeEditor', 'Preparing the tree editor…')} />
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
              aria-label={t('panels:design.canvas', 'Tree design canvas')}
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
                  {/* Symmetry on means node edits snap to the line, so the
                      tolerance lane is drawn whenever the axis is. */}
                  <line
                    className="symmetry-snap-lane"
                    x1={symmetryLine.x1}
                    y1={symmetryLine.y1}
                    x2={symmetryLine.x2}
                    y2={symmetryLine.y2}
                  />
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
                      <strong>{t('panels:design.emptyStateTitle', 'Sketch the tree behind your design')}</strong>
                      <span>
                        {t(
                          'panels:design.emptyStateBody',
                          'Use branches for the flaps, limbs, and features the folded base needs.'
                        )}
                      </span>
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
                const dotPx = treeDotPx(DOT_SIZES, node.isLeaf, active);
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
                      r={dotPx}
                      onPointerDown={(event) => onNodePointerDown(event, node.id)}
                      onPointerMove={(event) => onNodePointerMove(event, node.id)}
                      onPointerUp={(event) => finishDrag(event, node.id)}
                      onPointerCancel={(event) => finishDrag(event, node.id)}
                    />
                    {layers.labels && (
                      <text className="node-label" x={point.x + dotPx + 3} y={point.y + 4}>
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
          onLayerChange={setLayer}
          onSymmetryEnabledChange={setDesignSymmetryEnabled}
          onSymmetryPreset={applyDesignSymmetryPreset}
          onFlipSymmetryPreset={flipDesignSymmetryPreset}
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
          <span><CircleDot size={13} /> {t('panels:design.legendTerminal', 'Terminal')}</span>
          <span><Waypoints size={13} /> {t('panels:design.legendActivePath', 'Active path')}</span>
          <span><Plus size={13} /> {t('panels:design.legendScale', 'Scale {{value}}', { value: formatNumber(project.scale, 3) })}</span>
        </div>
      </div>
      <DesignAttributionFooter method="tree" />
    </section>
  );
}
