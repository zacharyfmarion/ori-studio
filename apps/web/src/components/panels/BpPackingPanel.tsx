import { selectOristudioBpSelection, selectOristudioBpViewportFitRequestId } from '../../store/workspaceStore/designTabs';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  Grid2X2,
  Minus,
  Plus,
  Route,
  Ruler,
  SquareDashed,
  Tag,
  TriangleAlert,
  Unlink,
  Waypoints,
} from 'lucide-react';
import type {
  OristudioBpDiagnostic,
  OristudioBpDevice,
  OristudioBpDocumentState,
  OristudioBpFlap,
  OristudioBpGraphicPrimitive,
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
  toggleBpDeviceSelection,
  toggleBpFlapSelection,
  toggleBpInvalidJunctionSelection,
  toggleBpRiverSelection,
} from '../../lib/oristudioBpSelection';
import {
  bpArcPathThickness,
  bpArcPathToSvgPath,
  bpPackingFlapClearanceRect,
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
import { BP_MAX_SHEET_SIZE, bpSteppedSheetSize } from '../../lib/bpSheetSize';
import { bpDefaultFlapLabel, bpFlapLabel } from '../../lib/bpFlapLabel';
import { unitLeafLocation } from '../../lib/bpTreeAuthoring';
import { hasPassedDragThreshold } from '../../lib/pointerGesture';
import { useBpPackingDragRequests } from '../../hooks/useBpPackingDragRequests';
import {
  useBpPackingSymmetry,
  type BpPackingSymmetryView,
} from '../../hooks/useBpPackingSymmetry';
import { BpPackingSymmetryMenu } from './BpPackingSymmetryMenu';
import { type Point } from '../../lib/geometry';
import {
  isBpPackingLayerVisible,
  type BpPackingViewLayerKey,
  type BpPackingViewLayers,
} from '../../lib/oristudioBpViewportSettings';
import { clientPointToDesignWorld } from '../../lib/designViewport';
import { setActiveShortcutViewportSurface } from '../../keyboard/shortcutRuntime';
import { useBpLongPressInspector } from '../../hooks/useBpLongPressInspector';
import {
  useViewportSurface,
  VIEWPORT_PINCH_ZOOM,
  VIEWPORT_WHEEL_ZOOM,
} from '../../hooks/useViewportSurface';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { IconButton } from '../ui/IconButton';
import { BpFlapEditor } from './BpFlapEditor';
import {
  isViewportInteractiveTarget,
  ViewportLayerMenu,
  ViewportToolbar,
  ViewportToolbarSeparator,
} from './ViewportToolbar';

type BpPackingNudgeDirection = 'up' | 'down' | 'left' | 'right';

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
  { key: 'clearance', icon: <Circle size={13} /> },
  { key: 'rivers', icon: <Route size={13} /> },
  { key: 'hinges', icon: <Waypoints size={13} /> },
  { key: 'ridges', icon: <Waypoints size={13} /> },
  { key: 'axisParallels', icon: <Waypoints size={13} /> },
  { key: 'conflicts', icon: <TriangleAlert size={13} /> },
  { key: 'labels', icon: <Tag size={13} /> },
  { key: 'outsidePaper', icon: <SquareDashed size={13} /> },
];

/** Localized BP-packing layer label. Literal `t()` calls keep the keys extractable. */
function bpPackingLayerLabel(t: TFunction, key: BpPackingViewLayerKey): string {
  switch (key) {
    case 'grid':
      return t('panels:bpPacking.layerGrid', 'Grid');
    case 'flaps':
      return t('panels:bpPacking.layerFlaps', 'Flaps');
    case 'clearance':
      return t('panels:bpPacking.layerClearance', 'Circles');
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
    case 'outsidePaper':
      return t('panels:bpPacking.layerOutsidePaper', 'Outside paper');
    default:
      return key;
  }
}

function viewBox(rect: { x: number; y: number; width: number; height: number }): string {
  return `${rect.x} ${rect.y} ${rect.width} ${rect.height}`;
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
  selection: OristudioBpSelection,
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
  selection: OristudioBpSelection,
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
  canGrowSheet,
  canShrinkSheet,
  sheet,
  setSheet,
  symmetry,
  zoomIn,
  zoomOut,
  fitToView,
  setZoomLevel,
}: {
  zoomPercent: number;
  layers: BpPackingViewLayers;
  onLayerChange: (layer: BpPackingViewLayerKey, visible: boolean) => void;
  canGrowSheet: boolean;
  canShrinkSheet: boolean;
  sheet: OristudioBpSheet;
  setSheet: (gridType: OristudioBpSheetKind, width: number, height: number) => void;
  symmetry: BpPackingSymmetryView;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
  setZoomLevel: (scale: number) => void;
}) {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetMenuRef = useRef<HTMLDivElement | null>(null);

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
        title={t('panels:bpPacking.growSheet', 'Increase Grid Size')}
        onClick={() => setSheet(sheet.kind, sheet.width + 1, sheet.height + 1)}
        disabled={!canGrowSheet}
      >
        <Plus size={14} />
      </IconButton>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:bpPacking.shrinkSheet', 'Decrease Grid Size')}
        onClick={() => setSheet(sheet.kind, sheet.width - 1, sheet.height - 1)}
        disabled={!canShrinkSheet}
      >
        <Minus size={14} />
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
      <BpPackingSymmetryMenu symmetry={symmetry} />
      {symmetry.unpairableId !== null && (
        <IconButton
          size="sm"
          variant="toolbar"
          title={t('panels:bpPacking.unpair', 'Unpair from mirror')}
          onClick={() => symmetry.unpair(symmetry.unpairableId as number)}
        >
          <Unlink size={14} />
        </IconButton>
      )}
      <ViewportToolbarSeparator />
      <ViewportLayerMenu
        title={t('panels:bpPacking.layers', 'Layers')}
        options={LAYER_OPTIONS.map((option) => ({
          ...option,
          label: bpPackingLayerLabel(t, option.key),
        }))}
        visible={layers}
        onChange={onLayerChange}
      />
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
  const [flapDragging, setFlapDragging] = useState<BpPackingDragState | null>(null);
  const [marquee, setMarquee] = useState<BpPackingMarqueeState | null>(null);
  const [deviceDragging, setDeviceDragging] = useState<BpPackingDeviceDragState | null>(null);
  const scheduleLongPressInspector = useBpLongPressInspector();
  const layers = useSettingsStore((state) => state.bpPackingLayers);
  const setLayer = useSettingsStore((state) => state.setBpPackingLayer);
  const selectOristudioBp = useWorkspaceStore((state) => state.selectOristudioBp);
  const selection = useWorkspaceStore((state) => selectOristudioBpSelection(state));
  const clearSelection = useWorkspaceStore((state) => state.clearOristudioBpSelection);
  const setOristudioBpActiveSurface = useWorkspaceStore(
    (state) => state.setOristudioBpActiveSurface
  );
  // Every flap move in this pane goes through the mirrored actions, which fall
  // back to the plain ones when mirror draw is off. Whether a move carries a
  // partner is the store's question; the pane just moves flaps.
  const moveFlap = useWorkspaceStore((state) => state.moveOristudioBpLayoutFlapWithSymmetry);
  const moveFlaps = useWorkspaceStore((state) => state.moveOristudioBpLayoutFlapsWithSymmetry);
  const resizeOristudioBpLayoutFlap = useWorkspaceStore(
    (state) => state.resizeOristudioBpLayoutFlap
  );
  const setOristudioBpTreeEdgeLength = useWorkspaceStore(
    (state) => state.setOristudioBpTreeEdgeLength
  );
  const renameOristudioBpVertex = useWorkspaceStore((state) => state.renameOristudioBpVertex);
  const moveOristudioBpDevice = useWorkspaceStore((state) => state.moveOristudioBpDevice);
  const switchOristudioBpStretchConfig = useWorkspaceStore(
    (state) => state.switchOristudioBpStretchConfig
  );
  const switchOristudioBpStretchPattern = useWorkspaceStore(
    (state) => state.switchOristudioBpStretchPattern
  );
  const setOristudioBpLayoutSheet = useWorkspaceStore(
    (state) => state.setOristudioBpLayoutSheet
  );
  const packing = document.snapshot.packing;
  const linkedSelection = useMemo(
    () => bpLinkedSelection(selection, document),
    [selection, document]
  );
  // The stretch whose device/pattern is currently selected. Selecting a device
  // links its stretch (bpLinkedSelection.addDevice -> addStretch), so a single
  // linked stretch drives the config/pattern navigation controls. The snapshot
  // carries the config/pattern counts for every derived stretch, so no
  // completion round-trip is needed before the controls work.
  const activeStretch = useMemo(() => {
    const ids = [...linkedSelection.stretches];
    if (ids.length !== 1) return null;
    return packing.stretches.find((stretch) => stretch.id === ids[0]) ?? null;
  }, [linkedSelection, packing.stretches]);
  // Render the engine's actual recompute, not a partial optimistic overlay.
  // Each drag step drives the engine (dragging=true) and the returned snapshot
  // re-renders, so flaps, creases, junctions, and stretches always move together
  // — matching Box Pleating Studio's Core-driven update. (Perf can be tuned
  // later; correctness first.)
  const displayPacking = packing;
  // The single selected flap, if exactly one flap is selected — the contextual
  // name editor only appears for a single flap (matches the edge-length editor).
  const singleSelectedFlap = useMemo(() => {
    const id = selection.kind === 'bp-flap' ? selection.id : null;
    if (id === null) return null;
    return packing.flaps.find((flap) => flap.id === id) ?? null;
  }, [selection, packing.flaps]);
  // A flap's radius is the length of its dual leaf edge in the tree, so radius
  // editing routes through the edge-length action. Find that edge (there is only
  // one — a flap's vertex is a leaf); when it is missing the radius field hides.
  const tree = document.snapshot.tree;
  const singleSelectedFlapEdge = useMemo(() => {
    if (!singleSelectedFlap) return null;
    const vertexId = singleSelectedFlap.vertexId;
    return (
      tree.edges.find(
        (edge) => edge.vertices[0] === vertexId || edge.vertices[1] === vertexId
      ) ?? null
    );
  }, [singleSelectedFlap, tree.edges]);
  // Sheet "diameter" caps every dimension (matches BP Studio's flap panel max).
  const flapMaxDimension = Math.max(packing.sheet.width, packing.sheet.height);
  // Set the flap's radius by changing its leaf edge length, repositioning the
  // leaf so the tree stays length-faithful (the subtree of a leaf is just the
  // leaf). Reuses the same single-undo edge-length path as the tree inspector.
  const setSelectedFlapRadius = useCallback(
    (length: number): Promise<boolean> => {
      if (!singleSelectedFlap || !singleSelectedFlapEdge) return Promise.resolve(false);
      const edge = singleSelectedFlapEdge;
      const leafId = singleSelectedFlap.vertexId;
      const [a, b] = edge.vertices;
      const parentId = a === leafId ? b : a;
      const leaf = tree.vertices.find((vertex) => vertex.id === leafId);
      const parent = tree.vertices.find((vertex) => vertex.id === parentId);
      if (!leaf || !parent) {
        return setOristudioBpTreeEdgeLength(edge.vertices, length);
      }
      const target = unitLeafLocation(parent.loc, leaf.loc, length);
      return setOristudioBpTreeEdgeLength(edge.vertices, length, [{ id: leafId, loc: target }]);
    },
    [singleSelectedFlap, singleSelectedFlapEdge, tree.vertices, setOristudioBpTreeEdgeLength]
  );
  const paperRect = useMemo(() => bpPackingPaperRect(packing.sheet), [packing.sheet]);
  const shadowRect = useMemo(() => bpPackingShadowRect(packing.sheet), [packing.sheet]);
  // A diagonal sheet is the square rotated 45° into a diamond; render the paper,
  // shadow, and hit-area as polygons rather than the axis-aligned rects used for a
  // rectangular grid.
  const isDiagonalSheet = packing.sheet.kind === 'diagonal';
  const canGrowSheet = useMemo(
    () => bpSteppedSheetSize(packing.sheet, packing.flaps, true) !== null,
    [packing]
  );
  const canShrinkSheet = useMemo(
    () => bpSteppedSheetSize(packing.sheet, packing.flaps, false) !== null,
    [packing]
  );
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
  const worldRect = useMemo(
    () => getBpPackingWorldRect(displayPacking, { cropToSheet: !layers.outsidePaper }),
    [displayPacking, layers.outsidePaper]
  );
  const viewportFitRequestId = useWorkspaceStore(
    (state) => selectOristudioBpViewportFitRequestId(state)
  );

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
    surface: 'bp-editor',
    worldRect,
    // The fit-request id makes an optimize mint a fresh key, so its result gets
    // framed; ordinary edits keep the same key and leave the camera alone.
    fitKey: `${document.handle}:${document.source.filename}:packing:${viewportFitRequestId}`,
  });
  const gridLines = useMemo(() => bpPackingGridLines(packing.sheet, paperRect), [paperRect, packing.sheet]);
  const unit = useMemo(() => bpPackingUnitToSvg(packing.sheet, paperRect), [packing.sheet, paperRect]);
  const nudgeableFlaps = useMemo(
    () => selectedNudgeFlaps(selection, packing.flaps),
    [selection, packing.flaps]
  );
  const nudgeableDevice = useMemo(
    () => selectedNudgeDevice(selection, packing.devices),
    [selection, packing.devices]
  );
  const selectedFlapIds = useMemo(
    () => nudgeableFlaps.map((flap) => flap.id),
    [nudgeableFlaps]
  );
  const symmetry = useBpPackingSymmetry(tree, packing.sheet, paperRect, selectedFlapIds);
  const packingAlerts = useMemo(
    () => bpPackingAlertDiagnostics(document.snapshot.diagnostics),
    [document.snapshot.diagnostics]
  );
  const conflictVisuals = useMemo(() => {
    const thicknessPx = (thickness: number | null): number | null =>
      thickness === null ? null : thickness * unit * (zoomPercent / 100);
    return packing.invalidJunctions.map((junction) => ({
        junction,
        active: linkedSelection.invalidJunctions.has(junction.id),
        paths: junction.paths.map((path) => ({
          d: bpArcPathToSvgPath(path, packing.sheet, paperRect),
          strokeWidth: conflictStrokeWidth(
            // Rendered thickness: grid units → SVG units → screen pixels.
            thicknessPx(bpArcPathThickness(path)),
            // Screen pixels per grid cell: SVG user units scaled by the camera.
            unit * (zoomPercent / 100)
          ),
        })),
    }));
  }, [
      linkedSelection.invalidJunctions,
      packing.invalidJunctions,
      packing.sheet,
      paperRect,
      unit,
      // The stroke is in screen pixels, so it has to be recomputed as you zoom.
      zoomPercent,
    ]
  );
  const sheetClipId = useId();
  /**
   * Crop to the sheet, the way Box Pleating Studio does.
   *
   * Upstream masks every geometry layer to the sheet border — shade, edge,
   * hinge, ridge, axis-parallels, junction (`client/shared/layers.ts`) — so a
   * flap pushed past the edge is simply cut off. Only the flap dots, the labels
   * and the sheet itself escape the mask, which is why those render outside this
   * group here too. `outsidePaper` lifts the crop; upstream has no equivalent.
   */
  const sheetClipPath = layers.outsidePaper ? undefined : `url(#${sheetClipId})`;
  const flapsClipId = useId();

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


  const nudgeSelection = useCallback(
    (direction: BpPackingNudgeDirection) => {
      const flaps = selectedNudgeFlaps(selection, packing.flaps);
      const reference = flaps[0];
      const vector = BP_PACKING_NUDGE_VECTORS[direction];
      if (!reference) {
        const device = selectedNudgeDevice(selection, packing.devices);
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
      if (ids.length > 1) void moveFlaps(ids, loc, false);
      else void moveFlap(reference.id, loc, false);
      return true;
    },
    [
      selection,
      moveOristudioBpDevice,
      moveFlap,
      moveFlaps,
      packing.devices,
      packing.flaps,
      packing.sheet,
    ]
  );

  const dragRequests = useBpPackingDragRequests({
    moveFlap,
    moveFlaps,
    moveDevice: moveOristudioBpDevice,
  });


  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = bpPackingNudgeDirectionFromKey(event.key);
      if (!direction || isViewportInteractiveTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (nudgeSelection(direction)) event.preventDefault();
    };
    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [nudgeSelection, containerRef]);

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
        baseFlaps: additive ? bpSelectedFlapIds(selection) : [],
        active: false,
      });
    },
    [spacePressed, eventToWorldPoint, selection]
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
      selectOristudioBp(toggleBpFlapSelection(selection, flapId));
      return;
    }
    const flap = packing.flaps.find((candidate) => candidate.id === flapId);
    if (!flap) return;
    const dragIds = selectedFlapDragIds(selection, flapId, packing.flaps);
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
    dragRequests.beginFlapDrag();
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
    const dx = loc.x - flapDragging.start.x;
    const dy = loc.y - flapDragging.start.y;
    const worldMoved = Math.hypot(dx, dy) > 0;
    const clientMoved = hasPassedDragThreshold(flapDragging.clientStart, {
      x: event.clientX,
      y: event.clientY,
    });
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
    if (moved) dragRequests.queueFlapDrag({ ids: flapDragging.ids, loc });
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
      dragRequests.flushFlapDrag({ ids, loc });
    }
  };

  // A river is selected by pressing its own contour (see onPrimitivePointerDown),
  // the way a flap is grabbed by its footprint. It used to also carry a padded
  // rect over its whole bounding box, left from when that box was the focusable
  // target: it swallowed presses meant for the creases, gadgets and paper inside
  // the river, and drew a ring around the geometry once selected.
  const onRiverPointerDown = (event: PointerEvent<SVGGElement>, riverId: number) => {
    if (event.button !== 0 || spacePressed) return;
    event.stopPropagation();
    selectOristudioBp(
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleBpRiverSelection(selection, riverId)
        : { kind: 'bp-river', id: riverId }
    );
    scheduleLongPressInspector(event);
  };

  const onConflictPointerDown = (event: PointerEvent<SVGGElement>, id: string) => {
    if (event.button !== 0 || spacePressed) return;
    event.stopPropagation();
    selectOristudioBp(
      event.shiftKey || event.metaKey || event.ctrlKey
        ? toggleBpInvalidJunctionSelection(selection, id)
        : { kind: 'bp-invalid-junction', id }
    );
    scheduleLongPressInspector(event);
  };

  const onPrimitivePointerDown = (event: PointerEvent<SVGGElement>, primitive: OristudioBpGraphicPrimitive) => {
    const deviceInfo = deviceInfoFromPrimitiveId(primitive.id, document);
    if (deviceInfo !== null) {
      if (event.button !== 0 || spacePressed) return;
      event.stopPropagation();
      const device = packing.devices.find((candidate) => candidate.id === deviceInfo.deviceId);
      selectOristudioBp(
        event.shiftKey || event.metaKey || event.ctrlKey
          ? toggleBpDeviceSelection(selection, deviceInfo.deviceId)
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
      dragRequests.beginDeviceDrag();
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
    const worldMoved = Math.hypot(constrained.vector.x, constrained.vector.y) > 0;
    const clientMoved = hasPassedDragThreshold(deviceDragging.clientStart, {
      x: event.clientX,
      y: event.clientY,
    });
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
      dragRequests.queueDeviceDrag({
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
    if (moved) dragRequests.flushDeviceDrag(update);
  };

  const onCanvasPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (marquee && marquee.pointerId === event.pointerId) {
      updateMarquee(event, marquee);
    }
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
            onClick={onSelectionCycleClick}
          >
            <defs>
              {/*
                * A conflict lives inside the flaps it belongs to, so nothing in
                * that layer may paint outside one. Its outline stroke is centred
                * on the region's edge — and that edge *is* the flap circle — so
                * without this half the stroke renders outside the flap and reads
                * as the conflict being in the wrong place.
                */}
              <clipPath id={flapsClipId}>
                {packing.flaps.map((flap) => {
                  const shape = bpPackingFlapClearanceRect(flap, packing.sheet, paperRect);
                  return (
                    <rect
                      key={flap.id}
                      x={shape.x}
                      y={shape.y}
                      width={shape.width}
                      height={shape.height}
                      rx={shape.radius}
                    />
                  );
                })}
              </clipPath>
              <clipPath id={sheetClipId}>
                {isDiagonalSheet ? (
                  <polygon points={sheetPolygonPoints} />
                ) : (
                  <rect
                    x={paperRect.x}
                    y={paperRect.y}
                    width={paperRect.width}
                    height={paperRect.height}
                  />
                )}
              </clipPath>
            </defs>
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
            {symmetry.axisLine && (
              // Clipped to the sheet so a diagonal sheet's line stops at the
              // diamond rather than running out to its bounding square.
              <g className="bp-packing-symmetry" clipPath={`url(#${sheetClipId})`} aria-hidden="true">
                <line
                  className="symmetry-line"
                  x1={symmetry.axisLine.x1}
                  y1={symmetry.axisLine.y1}
                  x2={symmetry.axisLine.x2}
                  y2={symmetry.axisLine.y2}
                />
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
            <g clipPath={sheetClipPath}>
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
                  />
                ) : null
              )}
            </g>
            {layers.conflicts && (
              // Conflict fills sit *under* the creases, rivers and flaps, so an
              // overlap never hides the geometry you need in order to fix it.
              // (Box Pleating Studio draws its `Layer.junction` above them; on
              // our canvas the fill obscured the creases, so this deviates
              // deliberately.) Clipped to the sheet and non-interactive — the
              // hit targets are a separate group below the flap hits.
              <g className="bp-packing-conflicts" clipPath={sheetClipPath} aria-hidden="true">
                <g clipPath={`url(#${flapsClipId})`}>
                  {conflictVisuals.map((visual) => (
                    <g
                      key={visual.junction.id}
                      className={
                        visual.active
                          ? 'bp-packing-conflict-group bp-packing-conflict--selected'
                          : 'bp-packing-conflict-group'
                      }
                    >
                      {visual.paths.map((path, index) => (
                        <path
                          key={`${visual.junction.id}:${index}`}
                          className="bp-packing-conflict"
                          d={path.d}
                          strokeWidth={path.strokeWidth}
                        />
                      ))}
                    </g>
                  ))}
                </g>
              </g>
            )}
            {layers.conflicts && (
              // Hit targets only — the conflict graphics render above the flaps (see
              // below), but the click targets stay under the flap hits so a flap
              // stays selectable where a conflict region overlaps it.
              // Not focusable, like every other target in this canvas: the
              // browser's focus ring would sit over the geometry being grabbed.
              <g className="bp-packing-conflict-hits">
                {conflictVisuals.map((visual) => (
                  <g
                    key={visual.junction.id}
                    data-bp-select={`conflict:${visual.junction.id}`}
                    aria-label={t('panels:bpPacking.selectConflict', 'Select BP conflict {{id}}: {{message}}', {
                      id: visual.junction.id,
                      message: visual.junction.message,
                    })}
                    onPointerDown={(event) => onConflictPointerDown(event, visual.junction.id)}
                  >
                    {visual.paths.map((path, index) => (
                      <path
                        key={`${visual.junction.id}:${index}`}
                        className="bp-packing-conflict-hit"
                        d={path.d}
                      />
                    ))}
                  </g>
                ))}
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
                  const clearance = layers.clearance
                    ? bpPackingFlapClearanceRect(flap, packing.sheet, paperRect)
                    : null;
                  const active = linkedSelection.flaps.has(flap.id);
                  // Marking the partner is what makes a mirrored move legible
                  // before the drag rather than a surprise during it.
                  const partner = symmetry.partnerIds.has(flap.id);
                  return (
                    <g
                      key={flap.id}
                      className={
                        [
                          active ? 'bp-packing-flap--selected' : '',
                          partner ? 'bp-packing-flap--mirror' : '',
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                      aria-hidden="true"
                    >
                      <g clipPath={sheetClipPath}>
                        {layers.clearance && clearance && (
                          <rect
                            className="bp-packing-flap-clearance"
                            x={clearance.x}
                            y={clearance.y}
                            width={clearance.width}
                            height={clearance.height}
                            rx={clearance.radius}
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
                      </g>
                      {layers.dots && <circle className="bp-packing-flap-dot" cx={center.x} cy={center.y} r={4} />}
                      {layers.labels && (
                        <text className="bp-packing-label" x={center.x + 7} y={center.y - 7}>
                          {bpFlapLabel(flap.id, flap.name)}
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
                    // Parity with BP Studio: the whole flap drags, not just its
                    // centre. Its hit target is the filled hinge contour, which
                    // for a box-pleat flap is the same footprint the clearance
                    // circle draws — so take it from that one definition rather
                    // than deriving a second. Sizing from the anchor rect alone
                    // left only a dot to grab, since a unit flap's rect is empty.
                    const footprint = bpPackingFlapClearanceRect(flap, packing.sheet, paperRect);
                    const hitWidth = Math.max(footprint.width, BP_PACKING_FLAP_HIT_MIN_PX);
                    const hitHeight = Math.max(footprint.height, BP_PACKING_FLAP_HIT_MIN_PX);
                    return (
                      <rect
                        key={flap.id}
                        className="bp-packing-flap-hit"
                        x={center.x - hitWidth / 2}
                        y={center.y - hitHeight / 2}
                        width={hitWidth}
                        height={hitHeight}
                        rx={Math.min(6, hitWidth / 2, hitHeight / 2)}
                        // Not focusable: the browser draws its own ring around
                        // the target's box, which sits over the flap and blocks
                        // the drag. Selection is by pointer; the pane's keyboard
                        // actions (nudge) live on the container.
                        data-bp-select={`flap:${flap.id}`}
                        aria-label={
                          // `{{id}}` carries the flap's letter label, so what's
                          // spoken matches what's drawn on the canvas.
                          flap.name
                            ? t('panels:bpPacking.selectFlapWithName', 'Select BP flap {{id}}, {{name}}', {
                                id: bpDefaultFlapLabel(flap.id),
                                name: flap.name,
                              })
                            : t('panels:bpPacking.selectFlap', 'Select BP flap {{id}}', {
                                id: bpDefaultFlapLabel(flap.id),
                              })
                        }
                        onPointerDown={(event) => onFlapPointerDown(event, flap.id)}
                        onPointerMove={(event) => onFlapPointerMove(event, flap)}
                        onPointerUp={(event) => finishFlapDrag(event, flap)}
                        onPointerCancel={(event) => finishFlapDrag(event, flap)}
                      />
                    );
                  })}
              </g>
            )}
            <g clipPath={sheetClipPath}>
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
                  />
                ) : null
              )}
            </g>
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
        canGrowSheet={canGrowSheet}
        canShrinkSheet={canShrinkSheet}
        sheet={packing.sheet}
        setSheet={(gridType, width, height) =>
          void setOristudioBpLayoutSheet(gridType, width, height)
        }
        symmetry={symmetry}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        fitToView={() => fitToView()}
        setZoomLevel={setZoomLevel}
      />
      <BpPackingDPad
        enabled={nudgeableFlaps.length > 0 || nudgeableDevice !== null}
        onNudge={nudgeSelection}
      />
      {singleSelectedFlap && (
        <BpFlapEditor
          key={singleSelectedFlap.id}
          flap={singleSelectedFlap}
          namePlaceholder={bpDefaultFlapLabel(singleSelectedFlap.id)}
          nameAriaLabel={t('panels:bpPacking.flapNameAria', 'Name of flap {{id}}', {
            id: bpDefaultFlapLabel(singleSelectedFlap.id),
          })}
          sheet={packing.sheet}
          maxDimension={flapMaxDimension}
          radiusValue={singleSelectedFlapEdge?.length ?? singleSelectedFlap.radius}
          radiusMax={singleSelectedFlapEdge?.maxLength ?? null}
          radiusEditable={singleSelectedFlapEdge !== null}
          onRename={(name) => void renameOristudioBpVertex(singleSelectedFlap.vertexId, name)}
          onResize={(width, height) =>
            resizeOristudioBpLayoutFlap(singleSelectedFlap.id, width, height)
          }
          onRadius={setSelectedFlapRadius}
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
}: {
  primitive: OristudioBpGraphicPrimitive;
  document: OristudioBpDocumentState;
  linkedSelection: OristudioBpLinkedSelection;
  paperRect: { x: number; y: number; width: number; height: number };
  onPointerDown: (event: PointerEvent<SVGGElement>, primitive: OristudioBpGraphicPrimitive) => void;
  onPointerMove: (event: PointerEvent<SVGGElement>, primitive: OristudioBpGraphicPrimitive) => void;
  onPointerUp: (event: PointerEvent<SVGGElement>, primitive: OristudioBpGraphicPrimitive) => void;
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
  // Labelled but not focusable — see the flap hit rects. A focus ring here
  // would sit over the very geometry the user is trying to grab.
  const labelProps = ariaLabel
    ? {
        'aria-label': ariaLabel,
        'data-bp-select': primitiveSelectToken(primitive, document),
      }
    : {};
  if (primitive.kind === 'line') {
    const [a, b] = primitive.points.map((point) => bpPackingPointToSvg(point, sheet, paperRect));
    return (
      <g
        className={className}
        {...labelProps}
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
        {...labelProps}
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
        {...labelProps}
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
        {...labelProps}
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
      {...labelProps}
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
  if (flapId !== null) {
    return t('panels:bpPacking.selectFlap', 'Select BP flap {{id}}', {
      id: bpDefaultFlapLabel(flapId),
    });
  }
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

/**
 * Smallest a conflict region may render before it needs help to be seen, in
 * screen pixels.
 */
const MIN_CONFLICT_VISIBLE_PX = 2.5;

/**
 * Stroke width for a conflict outline, in screen pixels — 0 for anything already
 * thick enough to read as a filled shape.
 *
 * Box Pleating Studio strokes the outline when `narrowness` (the ratio of the
 * arcs' anchor span to their chord) falls under a threshold, at width
 * `2 / narrowness` (`Junction.$draw`). That ratio is a proxy for "this is too
 * thin to see"; we measure the thing itself, because the stroke has a cost the
 * ratio can't account for.
 *
 * The cost: the stroke is centred on the region's outline, and that outline's
 * outer edge *is* the flap circle. Clipping it to the flap (which is what keeps
 * it from painting outside) then truncates it at the region's tips, blunting
 * points that should be sharp. So stroke only what would otherwise be invisible,
 * and only by enough to reach that floor.
 */
function conflictStrokeWidth(thicknessPx: number | null, cellPx: number): number {
  if (thicknessPx === null || thicknessPx >= MIN_CONFLICT_VISIBLE_PX) return 0;
  return Math.min(MIN_CONFLICT_VISIBLE_PX - thicknessPx, cellPx);
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
  selection: OristudioBpSelection,
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
