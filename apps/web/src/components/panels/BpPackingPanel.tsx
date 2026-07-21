import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Grid2X2,
  Layers,
  Route,
  Ruler,
  Tag,
  TriangleAlert,
  Waypoints,
} from 'lucide-react';
import type {
  OristudioBpDiagnostic,
  OristudioBpDevice,
  OristudioBpDocumentState,
  OristudioBpFlap,
  OristudioBpGraphicPrimitive,
  OristudioBpRiver,
  OristudioBpSelection,
  OristudioBpSheet,
  OristudioBpSheetKind,
  OristudioBpStretch,
} from '../../engine/oristudioBpTypes';
import {
  bpFlapSelection,
  bpLinkedSelection,
  type OristudioBpLinkedSelection,
  bpSelectedFlapIds,
  bpSelectionSize,
  toggleBpDeviceSelection,
  toggleBpFlapSelection,
  toggleBpInvalidJunctionSelection,
  toggleBpRiverSelection,
} from '../../lib/oristudioBpSelection';
import {
  bpPackingGridLines,
  bpPackingPaperRect,
  bpPackingPointToSvg,
  bpPackingRectToSvg,
  bpPackingShadowRect,
  bpPackingSheetBorderPoints,
  bpPackingSheetShadowPoints,
  bpPackingSvgToPoint,
  bpPackingUnitToSvg,
  constrainBpPackingFlapGroupTarget,
  getBpPackingWorldRect,
} from '../../lib/bpPackingViewport';
import { formatNumber, type Point } from '../../lib/geometry';
import {
  isBpPackingLayerVisible,
  type BpPackingViewLayerKey,
  type BpPackingViewLayers,
} from '../../lib/oristudioBpViewportSettings';
import {
  clientPointToDesignWorld,
  getViewportFitScale,
  type ViewportSize,
} from '../../lib/designViewport';
import { registerViewportShortcutExecutor, setActiveShortcutViewportSurface } from '../../keyboard/shortcutRuntime';
import type { ViewportShortcutId } from '../../keyboard/shortcuts';
import { useBpLongPressInspector } from '../../hooks/useBpLongPressInspector';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { IconButton } from '../ui/IconButton';
import { BpNameEditor } from './BpNameEditor';
import {
  isViewportInteractiveTarget,
  ViewportToolbar,
  ViewportToolbarSeparator,
} from './ViewportToolbar';

type BpPackingNudgeDirection = 'up' | 'down' | 'left' | 'right';

const BP_MAX_SHEET_SIZE = 8192;
const BP_PACKING_DRAG_START_THRESHOLD_PX = 4;
// Pointer travel before an empty-space drag becomes a rubberband selection,
// matching Box Pleating Studio's SelectionController MOUSE_THRESHOLD.
const BP_PACKING_DRAG_SELECT_THRESHOLD_PX = 5;
// Minimum flap click-target size, in SVG (viewBox) units, so a zero-size point
// flap still has a comfortable center hit region (comparable to a crease's hit
// stroke width).
const BP_PACKING_FLAP_HIT_MIN_PX = 16;
// A repeat click within this many screen pixels of the previous one counts as
// the "same spot" and advances the stacked-object selection cycle.
const BP_PACKING_CYCLE_THRESHOLD_PX = 4;

interface BpRiverVisual {
  river: OristudioBpRiver;
  bounds: { x: number; y: number; width: number; height: number };
}

interface BpPackingDragState {
  id: number;
  ids: number[];
  baseFlaps: OristudioBpFlap[];
  start: Point;
  clientStart: Point;
  /** Offset from the reference flap's anchor to the grab point, in sheet units. */
  grabOffset: Point;
  loc: Point;
  vector: Point;
  moved: boolean;
}

interface BpPackingDragBackendUpdate {
  ids: number[];
  loc: Point;
}

/**
 * Rubberband (box) selection drag. Mirrors Box Pleating Studio's
 * SelectionController.$processDragSelect: after the pointer travels past a
 * small threshold on empty space, flaps whose center lies inside the rectangle
 * become selected. With ctrl/meta the flaps selected before the drag are
 * preserved; otherwise the selection is replaced.
 */
interface BpPackingMarqueeState {
  pointerId: number;
  clientStart: Point;
  /** Rectangle corners in world (SVG) coordinates. */
  startWorld: Point;
  currentWorld: Point;
  additive: boolean;
  baseFlaps: number[];
  active: boolean;
}

interface BpPackingDeviceDragState {
  id: string;
  stretchId: string;
  index: number;
  primitivePrefix: string;
  baseDevice: OristudioBpDevice;
  start: Point;
  clientStart: Point;
  loc: Point;
  vector: Point;
  rangeScalar: [number, number];
  forward: boolean;
  moved: boolean;
}

interface BpPackingDeviceBackendUpdate {
  stretchId: string;
  index: number;
  loc: Point;
}

const BP_PACKING_NUDGE_VECTORS: Record<BpPackingNudgeDirection, Point> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const BP_DPAD_INITIAL_REPEAT_MS = 750;
const BP_DPAD_REPEAT_MS = 150;

const LAYER_OPTIONS: { key: BpPackingViewLayerKey; icon: ReactNode }[] = [
  { key: 'grid', icon: <Grid2X2 size={13} /> },
  { key: 'flaps', icon: <CircleDot size={13} /> },
  { key: 'rivers', icon: <Route size={13} /> },
  { key: 'hinges', icon: <Waypoints size={13} /> },
  { key: 'ridges', icon: <Waypoints size={13} /> },
  { key: 'axisParallels', icon: <Waypoints size={13} /> },
  { key: 'conflicts', icon: <TriangleAlert size={13} /> },
  { key: 'labels', icon: <Tag size={13} /> },
];

/** Localized BP-packing layer label. Literal `t()` calls keep the keys extractable. */
function bpPackingLayerLabel(t: TFunction, key: BpPackingViewLayerKey): string {
  switch (key) {
    case 'grid':
      return t('panels:bpPacking.layerGrid', 'Grid');
    case 'flaps':
      return t('panels:bpPacking.layerFlaps', 'Flaps');
    case 'rivers':
      return t('panels:bpPacking.layerRivers', 'Rivers');
    case 'hinges':
      return t('panels:bpPacking.layerHinges', 'Hinges');
    case 'ridges':
      return t('panels:bpPacking.layerRidges', 'Ridges');
    case 'axisParallels':
      return t('panels:bpPacking.layerAxis', 'Axis');
    case 'conflicts':
      return t('panels:bpPacking.layerConflicts', 'Conflicts');
    case 'labels':
      return t('panels:bpPacking.layerLabels', 'Labels');
    default:
      return key;
  }
}

function viewBox(rect: { x: number; y: number; width: number; height: number }): string {
  return `${rect.x} ${rect.y} ${rect.width} ${rect.height}`;
}

function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

function isKeyboardActivation(event: { key: string }): boolean {
  return event.key === 'Enter' || event.key === ' ';
}

function bpPackingNudgeDirectionFromKey(key: string): BpPackingNudgeDirection | null {
  switch (key) {
    case 'ArrowUp':
    case 'Up':
      return 'up';
    case 'ArrowDown':
    case 'Down':
      return 'down';
    case 'ArrowLeft':
    case 'Left':
      return 'left';
    case 'ArrowRight':
    case 'Right':
      return 'right';
    default:
      return null;
  }
}

function selectedNudgeFlaps(
  selection: OristudioBpDocumentState['selection'],
  flaps: OristudioBpFlap[]
): OristudioBpFlap[] {
  if (selection.kind === 'bp-flap') {
    return flaps.filter((flap) => flap.id === selection.id);
  }
  if (selection.kind === 'bp-multi') {
    const selected = new Set(selection.flaps);
    return flaps.filter((flap) => selected.has(flap.id));
  }
  return [];
}

function selectedNudgeDevice(
  selection: OristudioBpDocumentState['selection'],
  devices: OristudioBpDevice[]
): OristudioBpDevice | null {
  if (selection.kind === 'bp-device') {
    return devices.find((device) => device.id === selection.id) ?? null;
  }
  if (
    selection.kind === 'bp-multi' &&
    selection.vertices.length === 0 &&
    selection.edges.length === 0 &&
    selection.flaps.length === 0 &&
    selection.rivers.length === 0 &&
    selection.stretches.length === 0 &&
    selection.devices.length === 1 &&
    selection.invalidJunctions.length === 0
  ) {
    const id = selection.devices[0];
    return id ? devices.find((device) => device.id === id) ?? null : null;
  }
  return null;
}

function BpSheetSizeInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(BP_MAX_SHEET_SIZE, Math.max(1, parsed));
    if (clamped !== value) onCommit(clamped);
    else setDraft(String(value));
  };
  return (
    <label className="bp-sheet-menu__row">
      <span className="bp-sheet-menu__label">{label}</span>
      <input
        className="bp-sheet-menu__input"
        type="number"
        min={1}
        max={BP_MAX_SHEET_SIZE}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function BpPackingViewportToolbar({
  zoomPercent,
  layers,
  onLayerChange,
  canSubdivide,
  subdivideSheet,
  sheet,
  setSheet,
  zoomIn,
  zoomOut,
  fitToView,
  setZoomLevel,
}: {
  zoomPercent: number;
  layers: BpPackingViewLayers;
  onLayerChange: (layer: BpPackingViewLayerKey, visible: boolean) => void;
  canSubdivide: boolean;
  subdivideSheet: () => void;
  sheet: OristudioBpSheet;
  setSheet: (gridType: OristudioBpSheetKind, width: number, height: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
  setZoomLevel: (scale: number) => void;
}) {
  const { t } = useTranslation();
  const [layersOpen, setLayersOpen] = useState(false);
  const layersMenuRef = useRef<HTMLDivElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetMenuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!sheetOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (sheetMenuRef.current?.contains(target)) return;
      setSheetOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [sheetOpen]);

  return (
    <ViewportToolbar
      ariaLabel={t('panels:bpPacking.viewportControls', 'Box Pleat packing viewport controls')}
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
        title={t('panels:bpPacking.subdivideSheet', 'Subdivide Sheet')}
        onClick={subdivideSheet}
        disabled={!canSubdivide}
      >
        <Grid2X2 size={14} />
      </IconButton>
      <div className="viewport-toolbar__menu-anchor" ref={sheetMenuRef}>
        <IconButton
          size="sm"
          variant="toolbar"
          title={t('panels:bpPacking.sheetSizeGrid', 'Sheet size & grid')}
          isActive={sheetOpen}
          onClick={() => setSheetOpen((open) => !open)}
        >
          <Ruler size={14} />
        </IconButton>
        {sheetOpen && (
          <div className="design-layer-menu bp-sheet-menu" role="menu">
            <div className="bp-sheet-menu__row">
              <span className="bp-sheet-menu__label">{t('panels:bpPacking.grid', 'Grid')}</span>
              <div className="bp-sheet-menu__segment">
                <button
                  type="button"
                  className={sheet.kind === 'rectangular' ? 'is-active' : undefined}
                  onClick={() => setSheet('rectangular', sheet.width, sheet.height)}
                >
                  {t('panels:bpPacking.rect', 'Rect')}
                </button>
                <button
                  type="button"
                  className={sheet.kind === 'diagonal' ? 'is-active' : undefined}
                  onClick={() =>
                    // A diagonal grid is a square placed as a diamond; collapse to one
                    // size (BP Studio averages the current dimensions when converting).
                    setSheet('diagonal', sheet.width, sheet.height)
                  }
                >
                  {t('panels:bpPacking.diagonal', 'Diagonal')}
                </button>
              </div>
            </div>
            {sheet.kind === 'diagonal' ? (
              <BpSheetSizeInput
                label={t('panels:bpPacking.size', 'Size')}
                value={sheet.width}
                onCommit={(s) => setSheet('diagonal', s, s)}
              />
            ) : (
              <>
                <BpSheetSizeInput
                  label={t('panels:bpPacking.width', 'Width')}
                  value={sheet.width}
                  onCommit={(w) => setSheet(sheet.kind, w, sheet.height)}
                />
                <BpSheetSizeInput
                  label={t('panels:bpPacking.height', 'Height')}
                  value={sheet.height}
                  onCommit={(h) => setSheet(sheet.kind, sheet.width, h)}
                />
              </>
            )}
          </div>
        )}
      </div>
      <ViewportToolbarSeparator />
      <div className="viewport-toolbar__menu-anchor" ref={layersMenuRef}>
        <IconButton
          size="sm"
          variant="toolbar"
          title={t('panels:bpPacking.layers', 'Layers')}
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
                <span>{bpPackingLayerLabel(t, option.key)}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </ViewportToolbar>
  );
}

function StretchStepper({
  label,
  index,
  count,
  onStep,
}: {
  label: string;
  index: number;
  count: number;
  onStep: (delta: number) => void;
}) {
  const { t } = useTranslation();
  const disabled = count <= 1;
  return (
    <div className="bp-packing-stretch-nav__stepper">
      <span className="bp-packing-stretch-nav__label">{label}</span>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:bpPacking.previousStepper', 'Previous {{label}}', { label: label.toLowerCase() })}
        disabled={disabled}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft size={14} />
      </IconButton>
      <span className="bp-packing-stretch-nav__count">
        {count > 0 ? `${index + 1}/${count}` : '—'}
      </span>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:bpPacking.nextStepper', 'Next {{label}}', { label: label.toLowerCase() })}
        disabled={disabled}
        onClick={() => onStep(1)}
      >
        <ChevronRight size={14} />
      </IconButton>
    </div>
  );
}

/**
 * Contextual control for cycling a stretch's GOPS configuration and pattern —
 * the "pick a valid crease pattern by hand" navigation. Mirrors BP Studio's
 * Stretch.switchConfig/switchPattern (±1 with wraparound).
 */
function BpPackingStretchNav({
  stretch,
  onSwitchConfig,
  onSwitchPattern,
}: {
  stretch: OristudioBpStretch;
  onSwitchConfig: (delta: number) => void;
  onSwitchPattern: (delta: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="bp-packing-stretch-nav"
      role="group"
      aria-label={t('panels:bpPacking.stretchNav', 'Stretch {{id}} pattern navigation', { id: stretch.id })}
    >
      <span className="bp-packing-stretch-nav__title">
        {t('panels:bpPacking.stretch', 'Stretch {{id}}', { id: stretch.id })}
      </span>
      <StretchStepper
        label={t('panels:bpPacking.config', 'Config')}
        index={stretch.configIndex ?? 0}
        count={stretch.configCount ?? 0}
        onStep={onSwitchConfig}
      />
      <StretchStepper
        label={t('panels:bpPacking.pattern', 'Pattern')}
        index={stretch.patternIndex ?? 0}
        count={stretch.patternCount ?? 0}
        onStep={onSwitchPattern}
      />
      {stretch.patternFound === false && (
        <span className="bp-packing-stretch-nav__warning">
          {t('panels:bpPacking.noValidPattern', 'No valid pattern')}
        </span>
      )}
    </div>
  );
}

function BpPackingDPad({
  enabled,
  onNudge,
}: {
  enabled: boolean;
  onNudge: (direction: BpPackingNudgeDirection) => boolean;
}) {
  const { t } = useTranslation();
  const repeatTimerRef = useRef<number | null>(null);
  const clearRepeat = useCallback(() => {
    if (repeatTimerRef.current !== null) {
      window.clearTimeout(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  }, []);
  const startNudge = useCallback(
    (direction: BpPackingNudgeDirection) => {
      if (!enabled) return;
      clearRepeat();
      onNudge(direction);
      const repeat = () => {
        onNudge(direction);
        repeatTimerRef.current = window.setTimeout(repeat, BP_DPAD_REPEAT_MS);
      };
      repeatTimerRef.current = window.setTimeout(repeat, BP_DPAD_INITIAL_REPEAT_MS);
    },
    [clearRepeat, enabled, onNudge]
  );

  useEffect(() => clearRepeat, [clearRepeat]);
  useEffect(() => {
    window.addEventListener('blur', clearRepeat);
    return () => window.removeEventListener('blur', clearRepeat);
  }, [clearRepeat]);

  return (
    <div className="bp-packing-dpad" data-enabled={enabled || undefined} aria-hidden={!enabled}>
      <DPadButton
        className="bp-packing-dpad__up"
        direction="up"
        label={t('panels:bpPacking.nudgeUp', 'Nudge BP selection up')}
        disabled={!enabled}
        onStart={startNudge}
        onStop={clearRepeat}
      >
        <ArrowUp size={15} />
      </DPadButton>
      <DPadButton
        className="bp-packing-dpad__left"
        direction="left"
        label={t('panels:bpPacking.nudgeLeft', 'Nudge BP selection left')}
        disabled={!enabled}
        onStart={startNudge}
        onStop={clearRepeat}
      >
        <ArrowLeft size={15} />
      </DPadButton>
      <DPadButton
        className="bp-packing-dpad__right"
        direction="right"
        label={t('panels:bpPacking.nudgeRight', 'Nudge BP selection right')}
        disabled={!enabled}
        onStart={startNudge}
        onStop={clearRepeat}
      >
        <ArrowRight size={15} />
      </DPadButton>
      <DPadButton
        className="bp-packing-dpad__down"
        direction="down"
        label={t('panels:bpPacking.nudgeDown', 'Nudge BP selection down')}
        disabled={!enabled}
        onStart={startNudge}
        onStop={clearRepeat}
      >
        <ArrowDown size={15} />
      </DPadButton>
    </div>
  );
}

function DPadButton({
  className,
  direction,
  label,
  disabled,
  onStart,
  onStop,
  children,
}: {
  className: string;
  direction: BpPackingNudgeDirection;
  label: string;
  disabled: boolean;
  onStart: (direction: BpPackingNudgeDirection) => void;
  onStop: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={className}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onStart(direction);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        onStop();
      }}
      onPointerCancel={onStop}
      onPointerLeave={onStop}
    >
      {children}
    </button>
  );
}

export function BpPackingPanel({ document }: { document: OristudioBpDocumentState }) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [spacePressed, setSpacePressed] = useState(false);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [flapDragging, setFlapDragging] = useState<BpPackingDragState | null>(null);
  const [marquee, setMarquee] = useState<BpPackingMarqueeState | null>(null);
  const dragBackendFrameRef = useRef<number | null>(null);
  const dragBackendPendingRef = useRef<BpPackingDragBackendUpdate | null>(null);
  const dragBackendQueueRef = useRef<Promise<void> | null>(null);
  const [deviceDragging, setDeviceDragging] = useState<BpPackingDeviceDragState | null>(null);
  const deviceDragBackendFrameRef = useRef<number | null>(null);
  const deviceDragBackendPendingRef = useRef<BpPackingDeviceBackendUpdate | null>(null);
  const deviceDragBackendQueueRef = useRef<Promise<void> | null>(null);
  const scheduleLongPressInspector = useBpLongPressInspector();
  const layers = useSettingsStore((state) => state.bpPackingLayers);
  const setLayer = useSettingsStore((state) => state.setBpPackingLayer);
  const selectOristudioBp = useWorkspaceStore((state) => state.selectOristudioBp);
  const setOristudioBpActiveSurface = useWorkspaceStore(
    (state) => state.setOristudioBpActiveSurface
  );
  const moveOristudioBpLayoutFlap = useWorkspaceStore((state) => state.moveOristudioBpLayoutFlap);
  const moveOristudioBpLayoutFlaps = useWorkspaceStore((state) => state.moveOristudioBpLayoutFlaps);
  const renameOristudioBpVertex = useWorkspaceStore((state) => state.renameOristudioBpVertex);
  const moveOristudioBpDevice = useWorkspaceStore((state) => state.moveOristudioBpDevice);
  const switchOristudioBpStretchConfig = useWorkspaceStore(
    (state) => state.switchOristudioBpStretchConfig
  );
  const switchOristudioBpStretchPattern = useWorkspaceStore(
    (state) => state.switchOristudioBpStretchPattern
  );
  const completeOristudioBpStretch = useWorkspaceStore(
    (state) => state.completeOristudioBpStretch
  );
  const subdivideOristudioBpLayoutSheet = useWorkspaceStore(
    (state) => state.subdivideOristudioBpLayoutSheet
  );
  const setOristudioBpLayoutSheet = useWorkspaceStore(
    (state) => state.setOristudioBpLayoutSheet
  );
  const packing = document.snapshot.packing;
  const linkedSelection = useMemo(
    () => bpLinkedSelection(document.selection, document),
    [document]
  );
  // The stretch whose device/pattern is currently selected. Selecting a device
  // links its stretch (bpLinkedSelection.addDevice -> addStretch), so a single
  // linked stretch drives the config/pattern navigation controls.
  const activeStretch = useMemo(() => {
    const ids = [...linkedSelection.stretches];
    if (ids.length !== 1) return null;
    return packing.stretches.find((stretch) => stretch.id === ids[0]) ?? null;
  }, [linkedSelection, packing.stretches]);
  // BP Studio computes a stretch's configurations/patterns lazily, on selection
  // (Stretch.$complete). Our snapshot leaves patternCount null until then, so
  // complete the selected stretch once to populate its config/pattern counts and
  // enable the navigation controls. The ref guards against re-completing (and any
  // resulting effect loop) when completion yields no pattern.
  const completedStretchesRef = useRef<Set<string>>(new Set());
  const activeStretchId = activeStretch?.id ?? null;
  const activeStretchPatternCount = activeStretch?.patternCount ?? null;
  useEffect(() => {
    if (activeStretchId === null || activeStretchPatternCount !== null) return;
    if (completedStretchesRef.current.has(activeStretchId)) return;
    completedStretchesRef.current.add(activeStretchId);
    void completeOristudioBpStretch(activeStretchId);
  }, [activeStretchId, activeStretchPatternCount, completeOristudioBpStretch]);
  // Render the engine's actual recompute, not a partial optimistic overlay.
  // Each drag step drives the engine (dragging=true) and the returned snapshot
  // re-renders, so flaps, creases, junctions, and stretches always move together
  // — matching Box Pleating Studio's Core-driven update. (Perf can be tuned
  // later; correctness first.)
  const displayPacking = packing;
  // The single selected flap, if exactly one flap is selected — the contextual
  // name editor only appears for a single flap (matches the edge-length editor).
  const singleSelectedFlap = useMemo(() => {
    const id = document.selection.kind === 'bp-flap' ? document.selection.id : null;
    if (id === null) return null;
    return packing.flaps.find((flap) => flap.id === id) ?? null;
  }, [document.selection, packing.flaps]);
  const paperRect = useMemo(() => bpPackingPaperRect(packing.sheet), [packing.sheet]);
  const shadowRect = useMemo(() => bpPackingShadowRect(packing.sheet), [packing.sheet]);
  // A diagonal sheet is the square rotated 45° into a diamond; render the paper,
  // shadow, and hit-area as polygons rather than the axis-aligned rects used for a
  // rectangular grid.
  const isDiagonalSheet = packing.sheet.kind === 'diagonal';
  const sheetPolygonPoints = useMemo(
    () =>
      bpPackingSheetBorderPoints(packing.sheet, paperRect)
        .map((p) => `${p.x},${p.y}`)
        .join(' '),
    [packing.sheet, paperRect]
  );
  const sheetShadowPolygonPoints = useMemo(
    () =>
      bpPackingSheetShadowPoints(packing.sheet, paperRect)
        .map((p) => `${p.x},${p.y}`)
        .join(' '),
    [packing.sheet, paperRect]
  );
  // The SVG viewBox is derived from the packing bounds, which grow to include a
  // flap's rect and its label. Feeding the live packing during a drag makes the
  // viewBox chase the moving flap, visually shifting/rescaling the whole scene to
  // "keep it in view". Freeze the viewBox while a pointer drag is active so a drag
  // only moves the flap, not the viewport; it re-syncs to live bounds on release.
  const liveWorldRect = useMemo(() => getBpPackingWorldRect(displayPacking), [displayPacking]);
  const isPointerDragging = flapDragging !== null || deviceDragging !== null;
  // While a drag runs, hold the viewBox at its pre-drag bounds. The effect only
  // re-syncs the frozen rect when no drag is active, so at drag start the frozen
  // value is the last committed non-drag rect.
  const [frozenWorldRect, setFrozenWorldRect] = useState(liveWorldRect);
  useEffect(() => {
    if (!isPointerDragging) setFrozenWorldRect(liveWorldRect);
  }, [isPointerDragging, liveWorldRect]);
  const worldRect = isPointerDragging ? frozenWorldRect : liveWorldRect;
  const gridLines = useMemo(() => bpPackingGridLines(packing.sheet, paperRect), [paperRect, packing.sheet]);
  const unit = useMemo(() => bpPackingUnitToSvg(packing.sheet, paperRect), [packing.sheet, paperRect]);
  const riverVisuals = useMemo(
    () => packing.rivers.flatMap((river) => riverVisual(river, document, paperRect, unit) ?? []),
    [document, packing.rivers, paperRect, unit]
  );
  const nudgeableFlaps = useMemo(
    () => selectedNudgeFlaps(document.selection, packing.flaps),
    [document.selection, packing.flaps]
  );
  const nudgeableDevice = useMemo(
    () => selectedNudgeDevice(document.selection, packing.devices),
    [document.selection, packing.devices]
  );
  const packingAlerts = useMemo(
    () => bpPackingAlertDiagnostics(document.snapshot.diagnostics),
    [document.snapshot.diagnostics]
  );

  const eventToPackingPoint = useCallback(
    (event: PointerEvent): Point => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const worldPoint = clientPointToDesignWorld(
        { x: event.clientX, y: event.clientY },
        svg.getBoundingClientRect(),
        worldRect
      );
      // Match Box Pleating Studio: the pointer is rounded to the integer grid
      // (dragController.getCoordinate -> $round) before constraint/movement, so
      // flaps and devices snap to grid cells. The inverse mapping is frame-aware,
      // so a diagonal sheet's rotated coordinate box rounds correctly too.
      const gridPoint = bpPackingSvgToPoint(worldPoint, packing.sheet, paperRect);
      return { x: Math.round(gridPoint.x), y: Math.round(gridPoint.y) };
    },
    [packing.sheet, paperRect, worldRect]
  );

  // Raw pointer position in world (SVG viewBox) coordinates — unrounded, used to
  // draw the rubberband rectangle and hit-test flap centers.
  const eventToWorldPoint = useCallback(
    (event: PointerEvent): Point => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      return clientPointToDesignWorld(
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
    () => registerViewportShortcutExecutor('bp-editor', handleViewportShortcut),
    [handleViewportShortcut]
  );

  const nudgeSelection = useCallback(
    (direction: BpPackingNudgeDirection) => {
      const flaps = selectedNudgeFlaps(document.selection, packing.flaps);
      const reference = flaps[0];
      const vector = BP_PACKING_NUDGE_VECTORS[direction];
      if (!reference) {
        const device = selectedNudgeDevice(document.selection, packing.devices);
        if (!device || !device.rangeScalar || device.forward === null) return false;
        const index = deviceIndexFromId(device.id);
        if (index === null) return false;
        const constrained = constrainBpPackingDeviceTarget(device, device.position, {
          x: device.position.x + vector.x * 2,
          y: device.position.y + vector.y * 2,
        });
        if (constrained.vector.x === 0 && constrained.vector.y === 0) return false;
        void moveOristudioBpDevice(device.stretchId, index, constrained.loc, false);
        return true;
      }
      const { loc, vector: constrainedVector } = constrainBpPackingFlapGroupTarget(
        flaps,
        reference,
        {
          x: reference.anchor.x + vector.x,
          y: reference.anchor.y + vector.y,
        },
        packing.sheet
      );
      if (constrainedVector.x === 0 && constrainedVector.y === 0) return false;
      const ids = flaps.map((flap) => flap.id);
      if (ids.length > 1) void moveOristudioBpLayoutFlaps(ids, loc, false);
      else void moveOristudioBpLayoutFlap(reference.id, loc, false);
      return true;
    },
    [
      document.selection,
      moveOristudioBpDevice,
      moveOristudioBpLayoutFlap,
      moveOristudioBpLayoutFlaps,
      packing.devices,
      packing.flaps,
      packing.sheet,
    ]
  );

  const sendDragBackendUpdate = useCallback(
    (update: BpPackingDragBackendUpdate, draggingUpdate: boolean) => {
      if (update.ids.length === 0) return;
      const run = async () => {
        if (update.ids.length > 1) {
          await moveOristudioBpLayoutFlaps(update.ids, update.loc, draggingUpdate);
          return;
        }
        const id = update.ids[0];
        if (id !== undefined) {
          await moveOristudioBpLayoutFlap(id, update.loc, draggingUpdate);
        }
      };
      const queued = dragBackendQueueRef.current;
      const next = queued ? queued.then(run, run) : run();
      const guarded = next.catch(() => undefined);
      dragBackendQueueRef.current = guarded;
      void guarded.finally(() => {
        if (dragBackendQueueRef.current === guarded) {
          dragBackendQueueRef.current = null;
        }
      });
    },
    [moveOristudioBpLayoutFlap, moveOristudioBpLayoutFlaps]
  );

  const queueDragBackendUpdate = useCallback(
    (update: BpPackingDragBackendUpdate) => {
      dragBackendPendingRef.current = update;
      if (dragBackendFrameRef.current !== null) return;
      dragBackendFrameRef.current = requestAnimationFrame(() => {
        dragBackendFrameRef.current = null;
        const pending = dragBackendPendingRef.current;
        dragBackendPendingRef.current = null;
        if (pending) sendDragBackendUpdate(pending, true);
      });
    },
    [sendDragBackendUpdate]
  );

  const flushDragBackendUpdate = useCallback(
    (update: BpPackingDragBackendUpdate) => {
      if (dragBackendFrameRef.current !== null) {
        cancelAnimationFrame(dragBackendFrameRef.current);
        dragBackendFrameRef.current = null;
      }
      dragBackendPendingRef.current = null;
      sendDragBackendUpdate(update, false);
    },
    [sendDragBackendUpdate]
  );

  const sendDeviceDragBackendUpdate = useCallback(
    (update: BpPackingDeviceBackendUpdate, draggingUpdate: boolean) => {
      const run = async () => {
        await moveOristudioBpDevice(update.stretchId, update.index, update.loc, draggingUpdate);
      };
      const queued = deviceDragBackendQueueRef.current;
      const next = queued ? queued.then(run, run) : run();
      const guarded = next.catch(() => undefined);
      deviceDragBackendQueueRef.current = guarded;
      void guarded.finally(() => {
        if (deviceDragBackendQueueRef.current === guarded) {
          deviceDragBackendQueueRef.current = null;
        }
      });
    },
    [moveOristudioBpDevice]
  );

  const queueDeviceDragBackendUpdate = useCallback(
    (update: BpPackingDeviceBackendUpdate) => {
      deviceDragBackendPendingRef.current = update;
      if (deviceDragBackendFrameRef.current !== null) return;
      deviceDragBackendFrameRef.current = requestAnimationFrame(() => {
        deviceDragBackendFrameRef.current = null;
        const pending = deviceDragBackendPendingRef.current;
        deviceDragBackendPendingRef.current = null;
        if (pending) sendDeviceDragBackendUpdate(pending, true);
      });
    },
    [sendDeviceDragBackendUpdate]
  );

  const flushDeviceDragBackendUpdate = useCallback(
    (update: BpPackingDeviceBackendUpdate) => {
      if (deviceDragBackendFrameRef.current !== null) {
        cancelAnimationFrame(deviceDragBackendFrameRef.current);
        deviceDragBackendFrameRef.current = null;
      }
      deviceDragBackendPendingRef.current = null;
      sendDeviceDragBackendUpdate(update, false);
    },
    [sendDeviceDragBackendUpdate]
  );

  useEffect(
    () => () => {
      if (dragBackendFrameRef.current !== null) {
        cancelAnimationFrame(dragBackendFrameRef.current);
        dragBackendFrameRef.current = null;
      }
      if (deviceDragBackendFrameRef.current !== null) {
        cancelAnimationFrame(deviceDragBackendFrameRef.current);
        deviceDragBackendFrameRef.current = null;
      }
    },
    []
  );

  const fitKey = `${document.handle}:${document.source.filename}:packing`;
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
        return;
      }
      const direction = bpPackingNudgeDirectionFromKey(event.key);
      if (direction && !interactive && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (nudgeSelection(direction)) event.preventDefault();
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
  }, [nudgeSelection]);

  const clearSelection = useCallback(() => {
    if (bpSelectionSize(document.selection) > 0) selectOristudioBp({ kind: 'bp-tree' });
  }, [document.selection, selectOristudioBp]);

  // Begin a potential rubberband selection on empty space. The selection is not
  // cleared yet: a plain click (no drag past the threshold) clears on pointer up,
  // while a drag turns into a marquee. Mirrors BP Studio's flow where clearing
  // happens in $process/$processDragSelect only once the gesture is classified.
  const beginMarquee = useCallback(
    (event: PointerEvent<SVGElement>) => {
      if (event.button !== 0 || spacePressed) return;
      const world = eventToWorldPoint(event);
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      svgRef.current?.setPointerCapture(event.pointerId);
      setMarquee({
        pointerId: event.pointerId,
        clientStart: { x: event.clientX, y: event.clientY },
        startWorld: world,
        currentWorld: world,
        additive,
        baseFlaps: additive ? bpSelectedFlapIds(document.selection) : [],
        active: false,
      });
    },
    [spacePressed, eventToWorldPoint, document.selection]
  );

  const onCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    beginMarquee(event);
  };

  const onPaperPointerDown = (event: PointerEvent<SVGElement>) => {
    beginMarquee(event);
  };

  const updateMarquee = (event: PointerEvent<SVGSVGElement>, current: BpPackingMarqueeState) => {
    const world = eventToWorldPoint(event);
    const movedPx = Math.hypot(
      event.clientX - current.clientStart.x,
      event.clientY - current.clientStart.y
    );
    const active = current.active || movedPx >= BP_PACKING_DRAG_SELECT_THRESHOLD_PX;
    if (active) {
      const minX = Math.min(current.startWorld.x, world.x);
      const maxX = Math.max(current.startWorld.x, world.x);
      const minY = Math.min(current.startWorld.y, world.y);
      const maxY = Math.max(current.startWorld.y, world.y);
      // Select every flap whose CENTER lies in the rectangle (BP Studio hit-tests
      // Flap.$anchor, which is the flap center). Additive drags keep the flaps
      // selected before the gesture began.
      const inRect = packing.flaps
        .filter((flap) => {
          const center = bpPackingPointToSvg(
            {
              x: flap.anchor.x + flap.width / 2,
              y: flap.anchor.y + flap.height / 2,
            },
            packing.sheet,
            paperRect
          );
          return center.x >= minX && center.x <= maxX && center.y >= minY && center.y <= maxY;
        })
        .map((flap) => flap.id);
      selectOristudioBp(bpFlapSelection([...current.baseFlaps, ...inRect]));
    }
    setMarquee({ ...current, currentWorld: world, active });
  };

  const finishMarquee = (event: PointerEvent<SVGSVGElement>) => {
    if (!marquee || marquee.pointerId !== event.pointerId) return;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
    // A press-and-release with no drag is a plain click on empty space → clear.
    if (!marquee.active) clearSelection();
    setMarquee(null);
  };

  // Click-again cycling through stacked selectables (BP Studio $processNext).
  // A plain click's own element already selected the topmost item on pointerdown;
  // here, a repeat click at the same spot advances to the next item underneath.
  // A drag suppresses the click, so cycling only happens on genuine clicks.
  const cycleRef = useRef<{ x: number; y: number; keys: string[]; index: number } | null>(null);
  const onSelectionCycleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button !== 0 || spacePressed || event.shiftKey || event.metaKey || event.ctrlKey) {
      cycleRef.current = null;
      return;
    }
    const stack = bpSelectionStackAt(event.clientX, event.clientY);
    if (stack.length < 2) {
      cycleRef.current = null;
      return;
    }
    const previous = cycleRef.current;
    const sameSpot =
      previous !== null &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <=
        BP_PACKING_CYCLE_THRESHOLD_PX &&
      previous.keys.length === stack.length &&
      previous.keys.every((key, index) => key === stack[index]);
    const index = sameSpot ? (previous.index + 1) % stack.length : 0;
    cycleRef.current = { x: event.clientX, y: event.clientY, keys: stack, index };
    // index 0 is already selected by the clicked element's own pointerdown.
    if (index === 0) return;
    const selection = bpSelectionFromToken(stack[index]);
    if (selection) selectOristudioBp(selection);
  };

  const onFlapPointerDown = (event: PointerEvent<SVGGElement>, flapId: number) => {
    if (event.button !== 0 || spacePressed) return;
    event.stopPropagation();
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      selectOristudioBp(toggleBpFlapSelection(document.selection, flapId));
      return;
    }
    const flap = packing.flaps.find((candidate) => candidate.id === flapId);
    if (!flap) return;
    const dragIds = selectedFlapDragIds(document.selection, flapId, packing.flaps);
    const baseFlaps = dragIds.flatMap((id) => {
      const source = packing.flaps.find((candidate) => candidate.id === id);
      return source ? [source] : [];
    });
    const sourceFlap = baseFlaps.find((candidate) => candidate.id === flapId) ?? flap;
    if (dragIds.length === 1) selectOristudioBp({ kind: 'bp-flap', id: flapId });
    scheduleLongPressInspector(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    // Grab offset = where on the flap you grabbed, relative to its anchor. Kept
    // fixed during the drag so the flap follows the cursor by the grab point,
    // matching Box Pleating Studio (dragController $dragStart -> _dragOffset).
    const grabPoint = eventToPackingPoint(event);
    setFlapDragging({
      id: flapId,
      ids: dragIds,
      baseFlaps,
      start: sourceFlap.anchor,
      clientStart: { x: event.clientX, y: event.clientY },
      grabOffset: { x: grabPoint.x - sourceFlap.anchor.x, y: grabPoint.y - sourceFlap.anchor.y },
      loc: sourceFlap.anchor,
      vector: { x: 0, y: 0 },
      moved: false,
    });
  };

  const onFlapPointerMove = (event: PointerEvent<SVGGElement>, flap: OristudioBpFlap) => {
    if (flapDragging?.id !== flap.id) return;
    event.stopPropagation();
    const sourceFlap = flapDragging.baseFlaps.find((candidate) => candidate.id === flap.id) ?? flap;
    const sourceFlaps = flapDragging.baseFlaps.length > 0 ? flapDragging.baseFlaps : [sourceFlap];
    // Where the anchor should go = cursor minus the grab offset (BP Studio's
    // $moveTo(pt - _dragOffset)), so the flap tracks the cursor by the grab point
    // instead of snapping its corner to the cursor.
    const cursor = eventToPackingPoint(event);
    const target = { x: cursor.x - flapDragging.grabOffset.x, y: cursor.y - flapDragging.grabOffset.y };
    const { loc, vector } = constrainBpPackingFlapGroupTarget(
      sourceFlaps,
      sourceFlap,
      target,
      packing.sheet
    );
    setHoverPoint(loc);
    const dx = loc.x - flapDragging.start.x;
    const dy = loc.y - flapDragging.start.y;
    const clientDx = event.clientX - flapDragging.clientStart.x;
    const clientDy = event.clientY - flapDragging.clientStart.y;
    const worldMoved = Math.hypot(dx, dy) > 0;
    const clientMoved = Math.hypot(clientDx, clientDy) >= BP_PACKING_DRAG_START_THRESHOLD_PX;
    const moved = flapDragging.moved || (clientMoved && worldMoved);
    setFlapDragging({
      id: flap.id,
      ids: flapDragging.ids,
      baseFlaps: flapDragging.baseFlaps,
      start: flapDragging.start,
      clientStart: flapDragging.clientStart,
      grabOffset: flapDragging.grabOffset,
      loc,
      vector,
      moved,
    });
    if (moved) queueDragBackendUpdate({ ids: flapDragging.ids, loc });
  };

  const onFlapKeyDown = (event: ReactKeyboardEvent<SVGGElement>, flapId: number) => {
    if (!isKeyboardActivation(event)) return;
    event.preventDefault();
    event.stopPropagation();
    selectOristudioBp(
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleBpFlapSelection(document.selection, flapId)
        : { kind: 'bp-flap', id: flapId }
    );
  };

  const finishFlapDrag = (event: PointerEvent<SVGGElement>, flap: OristudioBpFlap) => {
    if (flapDragging?.id !== flap.id) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const loc = flapDragging.loc;
    const moved = flapDragging.moved;
    const ids = flapDragging.ids;
    setFlapDragging(null);
    if (moved) {
      flushDragBackendUpdate({ ids, loc });
    }
  };

  const onRiverPointerDown = (event: PointerEvent<SVGGElement>, riverId: number) => {
    if (event.button !== 0 || spacePressed) return;
    event.stopPropagation();
    selectOristudioBp(
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleBpRiverSelection(document.selection, riverId)
        : { kind: 'bp-river', id: riverId }
    );
    scheduleLongPressInspector(event);
  };

  const onRiverKeyDown = (event: ReactKeyboardEvent<SVGGElement>, riverId: number) => {
    if (!isKeyboardActivation(event)) return;
    event.preventDefault();
    event.stopPropagation();
    selectOristudioBp(
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleBpRiverSelection(document.selection, riverId)
        : { kind: 'bp-river', id: riverId }
    );
  };

  const onConflictPointerDown = (event: PointerEvent<SVGGElement>, id: string) => {
    if (event.button !== 0 || spacePressed) return;
    event.stopPropagation();
    selectOristudioBp(
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleBpInvalidJunctionSelection(document.selection, id)
        : { kind: 'bp-invalid-junction', id }
    );
    scheduleLongPressInspector(event);
  };

  const onConflictKeyDown = (event: ReactKeyboardEvent<SVGGElement>, id: string) => {
    if (!isKeyboardActivation(event)) return;
    event.preventDefault();
    event.stopPropagation();
    selectOristudioBp(
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleBpInvalidJunctionSelection(document.selection, id)
        : { kind: 'bp-invalid-junction', id }
    );
  };

  const onPrimitivePointerDown = (event: PointerEvent<SVGGElement>, primitive: OristudioBpGraphicPrimitive) => {
    const deviceInfo = deviceInfoFromPrimitiveId(primitive.id, document);
    if (deviceInfo !== null) {
      if (event.button !== 0 || spacePressed) return;
      event.stopPropagation();
      const device = packing.devices.find((candidate) => candidate.id === deviceInfo.deviceId);
      selectOristudioBp(
        event.shiftKey || event.metaKey || event.ctrlKey
          ? toggleBpDeviceSelection(document.selection, deviceInfo.deviceId)
          : { kind: 'bp-device', id: deviceInfo.deviceId }
      );
      scheduleLongPressInspector(event);
      if (
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        !device ||
        !device.rangeScalar ||
        device.forward === null
      ) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setDeviceDragging({
        id: device.id,
        stretchId: device.stretchId,
        index: deviceInfo.index,
        primitivePrefix: `s${device.stretchId}.${deviceInfo.index}:`,
        baseDevice: device,
        start: eventToPackingPoint(event),
        clientStart: { x: event.clientX, y: event.clientY },
        loc: device.position,
        vector: { x: 0, y: 0 },
        rangeScalar: device.rangeScalar,
        forward: device.forward,
        moved: false,
      });
      return;
    }
    const flapId = flapIdFromPrimitiveId(primitive.id);
    if (flapId !== null) {
      onFlapPointerDown(event, flapId);
      return;
    }
    const riverId = riverIdFromPrimitiveId(primitive.id, document);
    if (riverId !== null) onRiverPointerDown(event, riverId);
  };

  const onPrimitiveKeyDown = (
    event: ReactKeyboardEvent<SVGGElement>,
    primitive: OristudioBpGraphicPrimitive
  ) => {
    if (!isKeyboardActivation(event)) return;
    const deviceInfo = deviceInfoFromPrimitiveId(primitive.id, document);
    const flapId = flapIdFromPrimitiveId(primitive.id);
    const riverId = riverIdFromPrimitiveId(primitive.id, document);
    if (deviceInfo === null && flapId === null && riverId === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (deviceInfo !== null) {
      selectOristudioBp(
        event.shiftKey || event.metaKey || event.ctrlKey
          ? toggleBpDeviceSelection(document.selection, deviceInfo.deviceId)
          : { kind: 'bp-device', id: deviceInfo.deviceId }
      );
      return;
    }
    if (flapId !== null) {
      selectOristudioBp(
        event.shiftKey || event.metaKey || event.ctrlKey
          ? toggleBpFlapSelection(document.selection, flapId)
          : { kind: 'bp-flap', id: flapId }
      );
      return;
    }
    if (riverId !== null) {
      selectOristudioBp(
        event.shiftKey || event.metaKey || event.ctrlKey
          ? toggleBpRiverSelection(document.selection, riverId)
          : { kind: 'bp-river', id: riverId }
      );
    }
  };

  const onPrimitivePointerMove = (
    event: PointerEvent<SVGGElement>,
    primitive: OristudioBpGraphicPrimitive
  ) => {
    if (!deviceDragging || !primitive.id.startsWith(deviceDragging.primitivePrefix)) return;
    event.stopPropagation();
    const constrained = constrainBpPackingDeviceTarget(
      deviceDragging.baseDevice,
      deviceDragging.start,
      eventToPackingPoint(event)
    );
    setHoverPoint(constrained.loc);
    const clientDx = event.clientX - deviceDragging.clientStart.x;
    const clientDy = event.clientY - deviceDragging.clientStart.y;
    const worldMoved = Math.hypot(constrained.vector.x, constrained.vector.y) > 0;
    const clientMoved = Math.hypot(clientDx, clientDy) >= BP_PACKING_DRAG_START_THRESHOLD_PX;
    const moved =
      deviceDragging.moved || (clientMoved && worldMoved);
    setDeviceDragging({
      ...deviceDragging,
      loc: constrained.loc,
      vector: constrained.vector,
      rangeScalar: constrained.rangeScalar,
      moved,
    });
    if (moved) {
      queueDeviceDragBackendUpdate({
        stretchId: deviceDragging.stretchId,
        index: deviceDragging.index,
        loc: constrained.loc,
      });
    }
  };

  const finishDeviceDrag = (
    event: PointerEvent<SVGGElement>,
    primitive: OristudioBpGraphicPrimitive
  ) => {
    if (!deviceDragging || !primitive.id.startsWith(deviceDragging.primitivePrefix)) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const update = {
      stretchId: deviceDragging.stretchId,
      index: deviceDragging.index,
      loc: deviceDragging.loc,
    };
    const moved = deviceDragging.moved;
    setDeviceDragging(null);
    if (moved) flushDeviceDragBackendUpdate(update);
  };

  const onCanvasPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (marquee && marquee.pointerId === event.pointerId) {
      updateMarquee(event, marquee);
      return;
    }
    setHoverPoint(eventToPackingPoint(event));
  };

  return (
    <div
      ref={containerRef}
      className="panel-body design-panel__body bp-packing-panel__body"
      data-space-pan={spacePressed || undefined}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        setActiveShortcutViewportSurface('bp-editor');
        setOristudioBpActiveSurface('packing');
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
            className="design-canvas bp-packing-canvas"
            viewBox={viewBox(worldRect)}
            width={worldRect.width}
            height={worldRect.height}
            style={{ width: worldRect.width, height: worldRect.height }}
            role="img"
            aria-label={t('panels:bpPacking.canvas', 'Box Pleat packing canvas')}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={finishMarquee}
            onPointerCancel={finishMarquee}
            onPointerLeave={() => setHoverPoint(null)}
            onClick={onSelectionCycleClick}
          >
            {isDiagonalSheet ? (
              <polygon className="paper-shadow" points={sheetShadowPolygonPoints} />
            ) : (
              <rect
                className="paper-shadow"
                x={shadowRect.x}
                y={shadowRect.y}
                width={shadowRect.width}
                height={shadowRect.height}
                rx="6"
              />
            )}
            {isDiagonalSheet ? (
              <polygon className="paper bp-packing-sheet" points={sheetPolygonPoints} />
            ) : (
              <rect
                className="paper bp-packing-sheet"
                x={paperRect.x}
                y={paperRect.y}
                width={paperRect.width}
                height={paperRect.height}
              />
            )}
            {layers.grid && (
              <g className="bp-packing-grid" aria-hidden="true">
                {gridLines.map((line) => (
                  <line
                    key={line.id}
                    className={[
                      'bp-packing-grid-line',
                      line.kind === 'major' ? 'bp-packing-grid-line--major' : '',
                      line.kind === 'diagonal' ? 'bp-packing-grid-line--diagonal' : '',
                    ].join(' ')}
                    x1={line.from.x}
                    y1={line.from.y}
                    x2={line.to.x}
                    y2={line.to.y}
                  />
                ))}
              </g>
            )}
            {isDiagonalSheet ? (
              <polygon
                className="paper-hit-area"
                points={sheetPolygonPoints}
                onPointerDown={onPaperPointerDown}
              />
            ) : (
              <rect
                className="paper-hit-area"
                x={paperRect.x}
                y={paperRect.y}
                width={paperRect.width}
                height={paperRect.height}
                onPointerDown={onPaperPointerDown}
              />
            )}
            {displayPacking.graphics.map((primitive) =>
              primitive.layer !== 'device' && isBpPackingLayerVisible(layers, primitive.layer) ? (
                <Primitive
                  key={primitive.id}
                  primitive={primitive}
                  document={document}
                  linkedSelection={linkedSelection}
                  paperRect={paperRect}
                  onPointerDown={onPrimitivePointerDown}
                  onPointerMove={onPrimitivePointerMove}
                  onPointerUp={finishDeviceDrag}
                  onKeyDown={onPrimitiveKeyDown}
                />
              ) : null
            )}
            {layers.rivers && riverVisuals.length > 0 && (
              <g className="bp-packing-rivers">
                {riverVisuals.map((visual) => {
                  const active = linkedSelection.rivers.has(visual.river.id);
                  const pad = Math.max(8, unit * 0.12);
                  return (
                    <g
                      key={visual.river.id}
                      className={active ? 'bp-packing-river--selected' : undefined}
                      role="button"
                      tabIndex={0}
                      data-bp-select={`river:${visual.river.id}`}
                      aria-label={t('panels:bpPacking.selectRiver', 'Select BP river {{id}}, length {{length}}', {
                        id: visual.river.id,
                        length: formatNumber(visual.river.length, 2),
                      })}
                      onPointerDown={(event) => onRiverPointerDown(event, visual.river.id)}
                      onKeyDown={(event) => onRiverKeyDown(event, visual.river.id)}
                    >
                      {layers.selectionShade && active && (
                        <rect
                          className="bp-packing-river-shade"
                          x={visual.bounds.x - pad}
                          y={visual.bounds.y - pad}
                          width={visual.bounds.width + pad * 2}
                          height={visual.bounds.height + pad * 2}
                          rx={Math.min(8, Math.max(2, unit * 0.12))}
                        />
                      )}
                      <rect
                        className="bp-packing-river-hit"
                        x={visual.bounds.x - pad}
                        y={visual.bounds.y - pad}
                        width={visual.bounds.width + pad * 2}
                        height={visual.bounds.height + pad * 2}
                        rx={Math.min(8, Math.max(2, unit * 0.12))}
                      />
                    </g>
                  );
                })}
              </g>
            )}
            {layers.conflicts && (
              <g className="bp-packing-conflicts">
                {packing.invalidJunctions.map((junction) => {
                  const active = linkedSelection.invalidJunctions.has(junction.id);
                  return (
                    <g
                      key={junction.id}
                      className={active ? 'bp-packing-conflict--selected' : undefined}
                      role="button"
                      tabIndex={0}
                      data-bp-select={`conflict:${junction.id}`}
                      aria-label={t('panels:bpPacking.selectConflict', 'Select BP conflict {{id}}: {{message}}', {
                        id: junction.id,
                        message: junction.message,
                      })}
                      onPointerDown={(event) => onConflictPointerDown(event, junction.id)}
                      onKeyDown={(event) => onConflictKeyDown(event, junction.id)}
                    >
                      {junction.polygons.map((polygon, index) => (
                        <polygon
                          key={`${junction.id}:${index}`}
                          className="bp-packing-conflict"
                          points={pointsAttr(polygon.map((point) => bpPackingPointToSvg(point, packing.sheet, paperRect)))}
                        />
                      ))}
                    </g>
                  );
                })}
              </g>
            )}
            {layers.flaps && (
              <g className="bp-packing-flaps">
                {displayPacking.flaps.map((flap) => {
                  const rect = bpPackingRectToSvg(
                    { x: flap.anchor.x, y: flap.anchor.y, width: flap.width, height: flap.height },
                    packing.sheet,
                    paperRect
                  );
                  const center = {
                    x: rect.x + rect.width / 2,
                    y: rect.y + rect.height / 2,
                  };
                  const active = linkedSelection.flaps.has(flap.id);
                  return (
                    <g
                      key={flap.id}
                      className={active ? 'bp-packing-flap--selected' : undefined}
                      aria-hidden="true"
                    >
                      {layers.clearance && (
                        <rect
                          className="bp-packing-flap-clearance"
                          x={center.x - flap.radius * unit}
                          y={center.y - flap.radius * unit}
                          width={flap.radius * unit * 2}
                          height={flap.radius * unit * 2}
                          rx={Math.min(rect.width, rect.height, flap.radius * unit)}
                        />
                      )}
                      <rect
                        className="bp-packing-flap"
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={rect.height}
                        rx={Math.min(6, Math.max(1, unit * 0.08))}
                      />
                      {layers.selectionShade && active && (
                        <rect
                          className="bp-packing-selection-shade"
                          x={rect.x}
                          y={rect.y}
                          width={rect.width}
                          height={rect.height}
                          rx={Math.min(6, Math.max(1, unit * 0.08))}
                        />
                      )}
                      {layers.dots && <circle className="bp-packing-flap-dot" cx={center.x} cy={center.y} r={4} />}
                      {layers.labels && (
                        <text className="bp-packing-label" x={center.x + 7} y={center.y - 7}>
                          {flap.name || flap.id}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            )}
            {layers.flaps && (
              // Flap click targets, above the flap graphics/creases so a flap is
              // selectable at its center (smaller flaps last, so an inner flap wins
              // over an enclosing one). Rendered BELOW the device gadgets that
              // follow: a stretch gadget sits in the river between flaps, never on
              // a flap tip, so the gadget interior should win there.
              <g className="bp-packing-flap-hits">
                {[...displayPacking.flaps]
                  .sort((a, b) => b.radius - a.radius)
                  .map((flap) => {
                    const rect = bpPackingRectToSvg(
                      { x: flap.anchor.x, y: flap.anchor.y, width: flap.width, height: flap.height },
                      packing.sheet,
                      paperRect
                    );
                    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                    const half = Math.max(rect.width, rect.height, BP_PACKING_FLAP_HIT_MIN_PX) / 2;
                    return (
                      <rect
                        key={flap.id}
                        className="bp-packing-flap-hit"
                        x={center.x - half}
                        y={center.y - half}
                        width={half * 2}
                        height={half * 2}
                        rx={Math.min(6, half)}
                        role="button"
                        tabIndex={0}
                        data-bp-select={`flap:${flap.id}`}
                        aria-label={
                          flap.name
                            ? t('panels:bpPacking.selectFlapWithName', 'Select BP flap {{id}}, {{name}}', {
                                id: flap.id,
                                name: flap.name,
                              })
                            : t('panels:bpPacking.selectFlap', 'Select BP flap {{id}}', { id: flap.id })
                        }
                        onPointerDown={(event) => onFlapPointerDown(event, flap.id)}
                        onPointerMove={(event) => onFlapPointerMove(event, flap)}
                        onPointerUp={(event) => finishFlapDrag(event, flap)}
                        onPointerCancel={(event) => finishFlapDrag(event, flap)}
                        onKeyDown={(event) => onFlapKeyDown(event, flap.id)}
                      />
                    );
                  })}
              </g>
            )}
            {displayPacking.graphics.map((primitive) =>
              primitive.layer === 'device' && isBpPackingLayerVisible(layers, primitive.layer) ? (
                <Primitive
                  key={primitive.id}
                  primitive={primitive}
                  document={document}
                  linkedSelection={linkedSelection}
                  paperRect={paperRect}
                  onPointerDown={onPrimitivePointerDown}
                  onPointerMove={onPrimitivePointerMove}
                  onPointerUp={finishDeviceDrag}
                  onKeyDown={onPrimitiveKeyDown}
                />
              ) : null
            )}
            {layers.devices && (
              <g className="bp-packing-device-ranges" aria-hidden="true">
                {displayPacking.devices.map((device) => {
                  if (!device.range) return null;
                  const [from, to] = device.range.map((point) =>
                    bpPackingPointToSvg(point, packing.sheet, paperRect)
                  );
                  const position = bpPackingPointToSvg(device.position, packing.sheet, paperRect);
                  const active =
                    linkedSelection.devices.has(device.id) ||
                    linkedSelection.stretches.has(device.stretchId);
                  const index = deviceIndexFromId(device.id);
                  return (
                    <g
                      key={device.id}
                      className={active ? 'bp-packing-device-range--selected' : undefined}
                    >
                      <line
                        className="bp-packing-device-range"
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                      />
                      <circle
                        className="bp-packing-device-position"
                        cx={position.x}
                        cy={position.y}
                        r={Math.max(3, Math.min(7, unit * 0.09))}
                      />
                      {layers.labels && (
                        <text
                          className="bp-packing-label bp-packing-device-label"
                          x={position.x + 8}
                          y={position.y + 4}
                        >
                          {index === null ? device.stretchId : `d${index + 1}`}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            )}
            {marquee?.active && (
              <rect
                className="bp-packing-marquee"
                x={Math.min(marquee.startWorld.x, marquee.currentWorld.x)}
                y={Math.min(marquee.startWorld.y, marquee.currentWorld.y)}
                width={Math.abs(marquee.currentWorld.x - marquee.startWorld.x)}
                height={Math.abs(marquee.currentWorld.y - marquee.startWorld.y)}
                pointerEvents="none"
              />
            )}
          </svg>
        </TransformComponent>
      </TransformWrapper>
      <BpPackingViewportToolbar
        zoomPercent={zoomPercent}
        layers={layers}
        onLayerChange={setLayer}
        canSubdivide={
          packing.sheet.width * 2 <= BP_MAX_SHEET_SIZE &&
          packing.sheet.height * 2 <= BP_MAX_SHEET_SIZE
        }
        subdivideSheet={() => void subdivideOristudioBpLayoutSheet()}
        sheet={packing.sheet}
        setSheet={(gridType, width, height) =>
          void setOristudioBpLayoutSheet(gridType, width, height)
        }
        zoomIn={() => transformRef.current?.zoomIn(0.35, 120)}
        zoomOut={() => transformRef.current?.zoomOut(0.35, 120)}
        fitToView={() => fitToView()}
        setZoomLevel={setZoomLevel}
      />
      <BpPackingDPad
        enabled={nudgeableFlaps.length > 0 || nudgeableDevice !== null}
        onNudge={nudgeSelection}
      />
      {singleSelectedFlap && (
        <BpNameEditor
          key={singleSelectedFlap.id}
          title={t('panels:bpPacking.flapTitle', 'Flap {{id}}', { id: singleSelectedFlap.id })}
          name={singleSelectedFlap.name}
          placeholder={`f${singleSelectedFlap.id}`}
          ariaLabel={t('panels:bpPacking.flapNameAria', 'Name of flap {{id}}', {
            id: singleSelectedFlap.id,
          })}
          onRename={(name) => void renameOristudioBpVertex(singleSelectedFlap.vertexId, name)}
        />
      )}
      {activeStretch && (
        <BpPackingStretchNav
          stretch={activeStretch}
          onSwitchConfig={(delta) => void switchOristudioBpStretchConfig(activeStretch.id, delta)}
          onSwitchPattern={(delta) => void switchOristudioBpStretchPattern(activeStretch.id, delta)}
        />
      )}
      <BpPackingAlerts
        diagnostics={packingAlerts}
        onActivate={(diagnostic) => {
          if (diagnostic.selection) selectOristudioBp(diagnostic.selection);
        }}
      />
      <div className="design-status-readout">
        <span>{formatZoom(zoomPercent / 100)}</span>
        {hoverPoint && (
          <span>
            {formatNumber(hoverPoint.x, 3)}, {formatNumber(hoverPoint.y, 3)}
          </span>
        )}
      </div>
      <div className="design-legend bp-packing-legend">
        <span><CircleDot size={13} /> {packing.flaps.length}</span>
        <span><Route size={13} /> {packing.rivers.length}</span>
        <span><TriangleAlert size={13} /> {packing.invalidJunctions.length}</span>
        <span><Grid2X2 size={13} /> {t('panels:bpPacking.sheetDimensions', '{{width}} × {{height}}', { width: packing.sheet.width, height: packing.sheet.height })}</span>
      </div>
    </div>
  );
}

function BpPackingAlerts({
  diagnostics,
  onActivate,
}: {
  diagnostics: OristudioBpDiagnostic[];
  onActivate: (diagnostic: OristudioBpDiagnostic) => void;
}) {
  const { t } = useTranslation();
  if (diagnostics.length === 0) return null;
  return (
    <div className="bp-packing-alerts" aria-label={t('panels:bpPacking.warnings', 'Box Pleat packing warnings')}>
      {diagnostics.slice(0, 3).map((diagnostic) => {
        const content = (
          <>
            <TriangleAlert size={14} />
            <span>
              <strong>{bpPackingAlertLabel(diagnostic, t)}</strong>
              <small>{diagnostic.message}</small>
            </span>
          </>
        );
        return diagnostic.selection ? (
          <button
            type="button"
            className="bp-packing-alert"
            data-severity={diagnostic.severity}
            key={diagnostic.id}
            onClick={() => onActivate(diagnostic)}
          >
            {content}
          </button>
        ) : (
          <div
            className="bp-packing-alert"
            data-severity={diagnostic.severity}
            key={diagnostic.id}
            role="status"
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

function Primitive({
  primitive,
  document,
  linkedSelection,
  paperRect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: {
  primitive: OristudioBpGraphicPrimitive;
  document: OristudioBpDocumentState;
  linkedSelection: OristudioBpLinkedSelection;
  paperRect: { x: number; y: number; width: number; height: number };
  onPointerDown: (event: PointerEvent<SVGGElement>, primitive: OristudioBpGraphicPrimitive) => void;
  onPointerMove: (event: PointerEvent<SVGGElement>, primitive: OristudioBpGraphicPrimitive) => void;
  onPointerUp: (event: PointerEvent<SVGGElement>, primitive: OristudioBpGraphicPrimitive) => void;
  onKeyDown: (
    event: ReactKeyboardEvent<SVGGElement>,
    primitive: OristudioBpGraphicPrimitive
  ) => void;
}) {
  const { t } = useTranslation();
  const sheet = document.snapshot.packing.sheet;
  const active =
    primitiveSelectedByFlap(primitive.id, linkedSelection) ||
    primitiveSelectedByRiver(primitive.id, document, linkedSelection) ||
    primitiveSelectedByDevice(primitive.id, document, linkedSelection);
  const className = [
    'bp-packing-primitive',
    `bp-packing-primitive--${primitive.layer}`,
    active ? 'bp-packing-primitive--selected' : '',
  ].join(' ');
  const ariaLabel = primitiveAriaLabel(primitive, document, t);
  const keyboardProps = ariaLabel
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-label': ariaLabel,
        'data-bp-select': primitiveSelectToken(primitive, document),
        onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => onKeyDown(event, primitive),
      }
    : {};
  if (primitive.kind === 'line') {
    const [a, b] = primitive.points.map((point) => bpPackingPointToSvg(point, sheet, paperRect));
    return (
      <g
        className={className}
        {...keyboardProps}
        onPointerDown={(event) => onPointerDown(event, primitive)}
        onPointerMove={(event) => onPointerMove(event, primitive)}
        onPointerUp={(event) => onPointerUp(event, primitive)}
        onPointerCancel={(event) => onPointerUp(event, primitive)}
      >
        <line className="bp-packing-primitive-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        <line className="bp-packing-primitive-hit-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      </g>
    );
  }
  if (primitive.kind === 'polyline') {
    const points = primitive.points.map((point) => bpPackingPointToSvg(point, sheet, paperRect));
    const Element = primitive.closed ? 'polygon' : 'polyline';
    return (
      <g
        className={className}
        {...keyboardProps}
        onPointerDown={(event) => onPointerDown(event, primitive)}
        onPointerMove={(event) => onPointerMove(event, primitive)}
        onPointerUp={(event) => onPointerUp(event, primitive)}
        onPointerCancel={(event) => onPointerUp(event, primitive)}
      >
        <Element className="bp-packing-primitive-polyline" points={pointsAttr(points)} />
        <Element
          className={
            primitive.closed
              ? 'bp-packing-primitive-hit-area'
              : 'bp-packing-primitive-hit-polyline'
          }
          points={pointsAttr(points)}
        />
      </g>
    );
  }
  if (primitive.kind === 'polygon') {
    const points = primitive.points.map((point) => bpPackingPointToSvg(point, sheet, paperRect));
    return (
      <g
        className={className}
        {...keyboardProps}
        onPointerDown={(event) => onPointerDown(event, primitive)}
        onPointerMove={(event) => onPointerMove(event, primitive)}
        onPointerUp={(event) => onPointerUp(event, primitive)}
        onPointerCancel={(event) => onPointerUp(event, primitive)}
      >
        <polygon className="bp-packing-primitive-polygon" points={pointsAttr(points)} />
      </g>
    );
  }
  if (primitive.kind === 'circle') {
    const center = bpPackingPointToSvg(primitive.center, sheet, paperRect);
    const radius = primitive.radius * bpPackingUnitToSvg(sheet, paperRect);
    return (
      <g
        className={className}
        {...keyboardProps}
        onPointerDown={(event) => onPointerDown(event, primitive)}
        onPointerMove={(event) => onPointerMove(event, primitive)}
        onPointerUp={(event) => onPointerUp(event, primitive)}
        onPointerCancel={(event) => onPointerUp(event, primitive)}
      >
        <circle className="bp-packing-primitive-circle" cx={center.x} cy={center.y} r={radius} />
      </g>
    );
  }
  const loc = bpPackingPointToSvg(primitive.loc, sheet, paperRect);
  return (
    <g
      className={className}
      {...keyboardProps}
      onPointerDown={(event) => onPointerDown(event, primitive)}
      onPointerMove={(event) => onPointerMove(event, primitive)}
      onPointerUp={(event) => onPointerUp(event, primitive)}
      onPointerCancel={(event) => onPointerUp(event, primitive)}
    >
      <text className="bp-packing-label" x={loc.x} y={loc.y}>
        {primitive.text}
      </text>
    </g>
  );
}

function primitiveAriaLabel(
  primitive: OristudioBpGraphicPrimitive,
  document: OristudioBpDocumentState,
  t: TFunction
): string | undefined {
  const deviceInfo = deviceInfoFromPrimitiveId(primitive.id, document);
  if (deviceInfo) {
    const stretchId = deviceInfo.deviceId.split(':device:')[0] ?? deviceInfo.deviceId;
    return t('panels:bpPacking.selectDevice', 'Select BP device {{index}} for stretch {{stretchId}}', {
      index: deviceInfo.index + 1,
      stretchId,
    });
  }
  const flapId = flapIdFromPrimitiveId(primitive.id);
  if (flapId !== null) return t('panels:bpPacking.selectFlap', 'Select BP flap {{id}}', { id: flapId });
  const riverId = riverIdFromPrimitiveId(primitive.id, document);
  if (riverId !== null) return t('panels:bpPacking.selectRiverShort', 'Select BP river {{id}}', { id: riverId });
  return undefined;
}

/** The `data-bp-select` token for a crease primitive, used by click-cycling. */
function primitiveSelectToken(
  primitive: OristudioBpGraphicPrimitive,
  document: OristudioBpDocumentState
): string | undefined {
  const deviceInfo = deviceInfoFromPrimitiveId(primitive.id, document);
  if (deviceInfo) return `device:${deviceInfo.deviceId}`;
  const flapId = flapIdFromPrimitiveId(primitive.id);
  if (flapId !== null) return `flap:${flapId}`;
  const riverId = riverIdFromPrimitiveId(primitive.id, document);
  if (riverId !== null) return `river:${riverId}`;
  return undefined;
}

/** Parse a `data-bp-select` token (`kind:id`) into a selection. */
function bpSelectionFromToken(token: string): OristudioBpSelection | null {
  const separator = token.indexOf(':');
  if (separator < 0) return null;
  const kind = token.slice(0, separator);
  const id = token.slice(separator + 1);
  switch (kind) {
    case 'flap':
      return { kind: 'bp-flap', id: Number(id) };
    case 'river':
      return { kind: 'bp-river', id: Number(id) };
    case 'device':
      return { kind: 'bp-device', id };
    case 'conflict':
      return { kind: 'bp-invalid-junction', id };
    default:
      return null;
  }
}

/**
 * The stack of selectable BP entities under a screen point, topmost first and
 * de-duplicated. Repeated clicks at the same point cycle through this stack,
 * matching Box Pleating Studio's SelectionController.$processNext so an item
 * buried under another (a flap tip inside a gadget) can still be reached.
 */
function bpSelectionStackAt(clientX: number, clientY: number): string[] {
  const tokens: string[] = [];
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const owner = element.closest?.('[data-bp-select]');
    const token = owner?.getAttribute('data-bp-select');
    if (token && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

function pointsAttr(points: Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function bpPackingAlertDiagnostics(
  diagnostics: OristudioBpDiagnostic[]
): OristudioBpDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.kind === 'pattern-not-found' ||
      diagnostic.kind === 'unsupported' ||
      diagnostic.kind === 'upstream-gap'
  );
}

function bpPackingAlertLabel(diagnostic: OristudioBpDiagnostic, t: TFunction): string {
  if (diagnostic.kind === 'pattern-not-found') return t('panels:bpPacking.patternNotFound', 'Pattern not found');
  if (diagnostic.kind === 'upstream-gap') return t('panels:bpPacking.upstreamGap', 'Upstream gap');
  return t('panels:bpPacking.unsupportedOperation', 'Unsupported BP operation');
}

function constrainBpPackingDeviceTarget(
  device: OristudioBpDevice,
  start: Point,
  target: Point
): {
  loc: Point;
  vector: Point;
  rangeScalar: [number, number];
} {
  const forward = device.forward ?? true;
  const f = forward ? 1 : -1;
  const range = device.rangeScalar ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  const projected = Math.round(((target.x - start.x) + f * (target.y - start.y)) / 2);
  const dx = clamp(projected, range[0], range[1]);
  const vector = { x: dx, y: f * dx };
  return {
    loc: {
      x: device.position.x + vector.x,
      y: device.position.y + vector.y,
    },
    vector,
    rangeScalar: [range[0] - dx, range[1] - dx],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function selectedFlapDragIds(
  selection: OristudioBpDocumentState['selection'],
  activeId: number,
  flaps: OristudioBpFlap[]
): number[] {
  const available = new Set(flaps.map((flap) => flap.id));
  if (
    selection.kind === 'bp-multi' &&
    selection.flaps.includes(activeId) &&
    selection.flaps.length > 1
  ) {
    return selection.flaps.filter((id) => available.has(id));
  }
  return [activeId];
}

function riverVisual(
  river: OristudioBpRiver,
  document: OristudioBpDocumentState,
  paperRect: { x: number; y: number; width: number; height: number },
  unit: number
): BpRiverVisual | null {
  const sheet = document.snapshot.packing.sheet;
  const points = document.snapshot.packing.graphics
    .filter((primitive) => riverIdFromPrimitiveId(primitive.id, document) === river.id)
    .flatMap((primitive) => primitiveSvgPoints(primitive, sheet, paperRect, unit));
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    river,
    bounds: {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    },
  };
}

function primitiveSvgPoints(
  primitive: OristudioBpGraphicPrimitive,
  sheet: OristudioBpDocumentState['snapshot']['packing']['sheet'],
  paperRect: { x: number; y: number; width: number; height: number },
  unit: number
): Point[] {
  if (primitive.kind === 'line') {
    return primitive.points.map((point) => bpPackingPointToSvg(point, sheet, paperRect));
  }
  if (primitive.kind === 'polyline' || primitive.kind === 'polygon') {
    return primitive.points.map((point) => bpPackingPointToSvg(point, sheet, paperRect));
  }
  if (primitive.kind === 'circle') {
    const center = bpPackingPointToSvg(primitive.center, sheet, paperRect);
    const radius = primitive.radius * unit;
    return [
      { x: center.x - radius, y: center.y - radius },
      { x: center.x + radius, y: center.y + radius },
    ];
  }
  return [bpPackingPointToSvg(primitive.loc, sheet, paperRect)];
}

function flapIdFromPrimitiveId(id: string): number | null {
  const match = /^f(\d+)(?::|$)/.exec(id);
  return match ? Number.parseInt(match[1], 10) : null;
}

function riverIdFromPrimitiveId(id: string, document: OristudioBpDocumentState): number | null {
  const match = /^re(\d+),(\d+)(?::|$)/.exec(id);
  if (!match) return null;
  const vertices = [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)] as const;
  const river = document.snapshot.packing.rivers.find((candidate) => {
    const [a, b] = candidate.vertices;
    return (a === vertices[0] && b === vertices[1]) || (a === vertices[1] && b === vertices[0]);
  });
  return river?.id ?? null;
}

function deviceIdFromPrimitiveId(id: string, document: OristudioBpDocumentState): string | null {
  return deviceInfoFromPrimitiveId(id, document)?.deviceId ?? null;
}

function deviceIndexFromId(id: string): number | null {
  const match = /:device:(\d+)$/.exec(id);
  if (!match) return null;
  const index = Number.parseInt(match[1], 10);
  return Number.isFinite(index) ? index : null;
}

function deviceInfoFromPrimitiveId(
  id: string,
  document: OristudioBpDocumentState
): { deviceId: string; index: number } | null {
  const match = /^s(.+)\.(\d+)(?::|$)/.exec(id);
  if (!match) return null;
  const index = Number.parseInt(match[2], 10);
  const deviceId = `${match[1]}:device:${index}`;
  return document.snapshot.packing.devices.some((device) => device.id === deviceId)
    ? { deviceId, index }
    : null;
}

function primitiveSelectedByFlap(
  id: string,
  linkedSelection: OristudioBpLinkedSelection
): boolean {
  const flapId = flapIdFromPrimitiveId(id);
  return flapId !== null && linkedSelection.flaps.has(flapId);
}

function primitiveSelectedByRiver(
  id: string,
  document: OristudioBpDocumentState,
  linkedSelection: OristudioBpLinkedSelection
): boolean {
  const riverId = riverIdFromPrimitiveId(id, document);
  return riverId !== null && linkedSelection.rivers.has(riverId);
}

function primitiveSelectedByDevice(
  id: string,
  document: OristudioBpDocumentState,
  linkedSelection: OristudioBpLinkedSelection
): boolean {
  const deviceId = deviceIdFromPrimitiveId(id, document);
  return deviceId !== null && linkedSelection.devices.has(deviceId);
}
