import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
  type SetStateAction,
} from 'react';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import {
  ChevronDown,
  ChevronRight,
  FlipHorizontal,
  FlipHorizontal2,
  FlipVertical,
  GitBranch,
  Grid2X2,
  Magnet,
  Palette,
  RotateCcw,
  RotateCw,
  ScanLine,
} from 'lucide-react';
import {
  registerCpActionShortcutExecutor,
  registerViewportShortcutExecutor,
  setActiveShortcutViewportSurface,
} from '../../keyboard/shortcutRuntime';
import {
  shortcutLabelForAction,
  type ShortcutOverrides,
  type ViewportShortcutId,
} from '../../keyboard/shortcuts';
import type {
  OristudioCpCommandPayload,
  OristudioCpCommandPreview,
  OristudioCpCommandResult,
  OristudioCpCircle,
  OristudioCpCustomLineType,
  OristudioCpDiagnosticEntry,
  OristudioCpDocumentSnapshot,
  OristudioCpLineColor,
  OristudioCpLineSegment,
  OristudioCpRgbColor,
} from '../../engine/oristudioCpTypes';
import { formatNumber, paperToSvg, type Point } from '../../lib/geometry';
import { getViewportFitScale, type ViewportSize } from '../../lib/designViewport';
import {
  cpDiagnosticEntryMessage,
  semanticCpDiagnosticKind,
} from '../../lib/oristudioCpDiagnostics';
import {
  DEFAULT_ORISTUDIO_CP_ACTION_ID,
  ORISTUDIO_CP_LINE_TYPE_ACTIONS,
  cpActionByOperation,
  cpActionById,
  type OristudioCpActionDefinition,
  type OristudioCpActionId,
  type OristudioCpActionInputMode,
  type OristudioCpCommandActionDefinition,
} from '../../lib/oristudioCpActions';
import {
  cpCommandByOperation,
  type OristudioCpCommandDefinition,
} from '../../lib/oristudioCpCommands';
import {
  cancelOristudioCpToolState,
  IDLE_ORISTUDIO_CP_TOOL_STATE,
  transitionOristudioCpToolState,
} from '../../lib/oristudioCpToolState';
import {
  DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
  ORISTUDIO_CP_CUSTOM_LINE_TYPE_OPTIONS,
  ORISTUDIO_CP_RATIO_PRESETS,
  ORISTUDIO_CP_REPLACE_TARGET_LINE_TYPE_OPTIONS,
  cpToolSettingGroupsForCommand,
  evaluateOrieditaRatioExpression,
  formatOrieditaRatioHalf,
  formatOrieditaRatioNumber,
  parseOrieditaRatioHalfInput,
  type OristudioCpRatioExpression,
  type OristudioCpToolOptions,
  type OristudioCpToolSettingGroup,
  ratioExpressionFromHalves,
  ratioHalvesFromExpression,
} from '../../lib/oristudioCpToolSettings';
import {
  instructionsForCpTool,
  type OristudioCpToolInstructions,
} from '../../lib/oristudioCpToolInstructions';
import { cpLineageStatusLabel } from '../../lib/oristudioCpLineage';
import {
  ORISTUDIO_CP_EXTRA_LINE_COLOR_PALETTE,
  cpPaletteEntryForColor,
} from '../../lib/oristudioCpPalette';
import {
  axisFromTwoPoints,
  cpSymmetryAxisLine,
  cpSymmetryPresetAxis,
  nextCpSymmetryPresetAxis,
  reflectedPreviewCircles,
  reflectedPreviewPoints,
  reflectedPreviewSegments,
  shouldMirrorOristudioCpCommandPreview,
  type OristudioCpSymmetryState,
} from '../../lib/oristudioCpSymmetry';
import {
  CP_EDITABLE_CANVAS_RECT,
  CP_EDITABLE_FIT_RECT,
  CP_PAPER_RECT,
  CP_PAPER_SHADOW_RECT,
  CP_WORLD_RECT,
  cpLineAssignmentLabel,
  cpLineColorClass,
  cpSelectionSize,
  cpSvgPointToModel,
  emptyOristudioCpSelection,
  getCpGridLines,
  getCpVertices,
  getOrieditaGridBasis,
  modelPointToCpSvg,
  nearestCpSnapTarget,
  nearestOrieditaDrawPointTarget,
  normalizeOrieditaGridSize,
  ORIEDITA_PAPER_BOUNDS,
  textCoordinate,
  visibleOrieditaGridMetadata,
  type CpModelBounds,
  type CpSnapTarget,
  type CpVertex,
  type OristudioCpSelection,
} from '../../lib/creasePatternViewport';
import {
  cpFramePointToLocal,
  cpLineSelectionFrame,
  cpLineSelectionMoveAnchorPoints,
  rotationAngleFromCenter,
  scaleCpLineSegments,
  selectedCpLineSegments,
  snapRotationDegrees,
  translateCpLineSegments,
  transformCpLineSegments,
  type CpLineSelectionFrame,
  type CpSelectionTransform,
} from '../../lib/creasePatternClipboard';
import type { Selection, TreeProject } from '../../lib/sampleProject';
import {
  isCreaseSelected,
  isFacetSelected,
  selectionSize,
  toggleCreaseSelection,
  toggleFacetSelection,
} from '../../lib/selection';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useShortcutStore } from '../../store/shortcutStore';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Toggle } from '../ui/Toggle';
import { CpToolRail } from './CpToolRail';
import { NextDocumentAction } from './NextDocumentAction';
import {
  isViewportInteractiveTarget,
  ViewportToolbar,
  ViewportToolbarSeparator,
} from './ViewportToolbar';

function creaseClass(fold: string, kind: string, mode: 'mvf' | 'agrh'): string {
  if (mode === 'agrh') return `crease crease--kind-${kind}`;
  return `crease crease--fold-${fold}`;
}

function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

const EMPTY_DIAGNOSTIC_ENTRIES: OristudioCpDiagnosticEntry[] = [];

interface CpDiagnosticHudStatus {
  label: string;
  detail: string | null;
  tone: 'ok' | 'warn' | 'error';
}

function diagnosticEntryFocusPoint(entry: OristudioCpDiagnosticEntry): Point | null {
  const points: Point[] = [];
  if (entry.point) points.push(entry.point);
  for (const segment of entry.segments ?? []) {
    points.push(segment.a, segment.b);
  }
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function diagnosticOperationLabel(operation: string): string {
  switch (operation) {
    case 'CheckCamv':
      return 'CAMV';
    case 'Check1':
      return 'Overlap';
    case 'Check2':
      return 'T-junction';
    case 'Check3':
      return 'Vertex foldability';
    case 'Check4':
      return 'Maekawa/LBL';
    case 'FlatFoldableCheck':
      return 'Boundary';
    default:
      return operation;
  }
}

function pluralizeCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function diagnosticHudStatus(
  result: OristudioCpCommandResult | null | undefined,
  options: { issueOnly?: boolean } = {}
): CpDiagnosticHudStatus | null {
  if (!result || !isDiagnosticResultOperation(result.operation)) return null;
  if (!result?.diagnostics.length) return null;
  const entries = result.diagnostic_entries ?? EMPTY_DIAGNOSTIC_ENTRIES;
  const label = diagnosticOperationLabel(result.operation);
  const errorCount = entries.filter((entry) => entry.severity === 'error').length;
  const warningCount = entries.filter((entry) => entry.severity === 'warning').length;
  const detail =
    entries.length === 1
      ? entries[0]
        ? cpDiagnosticEntryMessage(entries[0])
        : result.diagnostics[0]
      : result.diagnostics[0];

  if (errorCount > 0) {
    return {
      label: `${pluralizeCount(errorCount, `${label} Error`)}`,
      detail,
      tone: 'error',
    };
  }

  if (warningCount > 0) {
    return {
      label: `${pluralizeCount(warningCount, `${label} Warning`)}`,
      detail,
      tone: 'warn',
    };
  }

  if (options.issueOnly) return null;

  return {
    label: `${label} OK`,
    detail,
    tone: 'ok',
  };
}

function isDiagnosticResultOperation(operation: string): boolean {
  return (
    operation === 'Check1' ||
    operation === 'Check2' ||
    operation === 'Check3' ||
    operation === 'Check4' ||
    operation === 'CheckCamv' ||
    operation === 'FlatFoldableCheck'
  );
}

function modelSelectionDistance(
  bounds: CpModelBounds,
  zoomScale = 1
): number {
  const baseDistance =
    (Math.max(bounds.spanX, bounds.spanY) / CP_PAPER_RECT.width) * 8;
  const zoomAdjustedDistance = zoomScale > 1 ? baseDistance / zoomScale : baseDistance;
  return Math.max(
    1e-6,
    zoomAdjustedDistance
  );
}

function cpCommandPayloadDefaults(
  command: OristudioCpCommandDefinition,
  bounds: CpModelBounds,
  gridWidth: number | undefined,
  lineColor: OristudioCpLineColor,
  zoomScale: number,
  toolOptions: OristudioCpToolOptions
): OristudioCpCommandPayload {
  const payload: OristudioCpCommandPayload = {};
  const operationId = command.operationId;

  if ((command.toolSteps?.length ?? 0) > 0 || command.inputMode === 'drag-path') {
    payload.selection_distance = modelSelectionDistance(bounds, zoomScale);
  }

  if (
    operationId === 'CreaseMakeMv' ||
    operationId === 'CreasesAlternateMv' ||
    operationId === 'LengthenCrease' ||
    operationId === 'DrawCreaseFree' ||
    operationId === 'DrawCreaseRestricted' ||
    operationId === 'DrawCreaseSymmetric' ||
    operationId === 'DrawCreaseAngleRestricted' ||
    operationId === 'DrawCreaseAngleRestricted3' ||
    operationId === 'DrawCreaseAngleRestricted5' ||
    operationId === 'SquareBisector' ||
    operationId === 'Inward' ||
    operationId === 'PerpendicularDraw' ||
    operationId === 'SymmetricDraw' ||
    operationId === 'FishBoneDraw' ||
    operationId === 'DoubleSymmetricDraw' ||
    operationId === 'VertexMakeAngularlyFlatFoldable' ||
    operationId === 'FoldableLineInput' ||
    operationId === 'ParallelDraw' ||
    operationId === 'ParallelDrawWidth' ||
    operationId === 'ContinuousSymmetricDraw' ||
    operationId === 'FoldableLineDraw' ||
    operationId === 'Axiom5' ||
    operationId === 'Axiom7' ||
    operationId === 'PolygonSetNoCorners' ||
    operationId === 'DrawBlintz' ||
    operationId === 'DrawFishBase' ||
    operationId === 'DrawDoveBase' ||
    operationId === 'DrawBirdBase' ||
    operationId === 'DrawFrogBase' ||
    operationId === 'VoronoiCreate' ||
    operationId === 'CircleDrawTangentLine'
  ) {
    payload.line_color = lineColor;
  }

  if (
    operationId === 'FishBoneDraw' ||
    operationId === 'VertexMakeAngularlyFlatFoldable' ||
    operationId === 'FoldableLineInput' ||
    operationId === 'FoldableLineDraw'
  ) {
    payload.grid_width = gridWidth;
  }

  if (
    operationId === 'AngleSystem' ||
    operationId === 'DrawCreaseAngleRestricted' ||
    operationId === 'DrawCreaseAngleRestricted3' ||
    operationId === 'DrawCreaseAngleRestricted5'
  ) {
    payload.angle_system_divider = toolOptions.angleSystemDivider;
    payload.angles = toolOptions.angleSystemAngles;
  }

  if (operationId === 'LineSegmentDivision') {
    payload.division_count = toolOptions.divisionCount;
  }

  if (operationId === 'LineSegmentRatioSet') {
    const ratio = evaluateOrieditaRatioExpression(toolOptions.divisionRatio);
    payload.ratio_s = ratio.ratioS;
    payload.ratio_t = ratio.ratioT;
  }

  if (operationId === 'PolygonSetNoCorners') {
    payload.polygon_corners = toolOptions.polygonCorners;
  }

  if (operationId === 'CircleChangeColor') {
    payload.custom_circle_color = toolOptions.customCircleColor;
  }

  if (operationId === 'ParallelDrawWidth') {
    payload.width = toolOptions.parallelWidth;
  }

  if (
    toolOptions.candidateIndex !== null &&
    cpToolSettingGroupsForCommand(command).includes('candidate-choice')
  ) {
    payload.candidate_index = toolOptions.candidateIndex;
  }

  if (operationId === 'ReplaceLineTypeSelect') {
    payload.custom_from_line_type = toolOptions.customFromLineType;
    payload.custom_to_line_type = toolOptions.customToLineType;
  }

  if (operationId === 'DeleteLineTypeSelect') {
    payload.custom_line_type = toolOptions.customLineType;
  }

  if (operationId === 'FixInaccurate') {
    payload.fix_precision = toolOptions.fixPrecision;
    payload.fix_precision_use_bp = toolOptions.fixPrecisionUseBp;
    payload.fix_precision_use_22_5 = toolOptions.fixPrecisionUse22_5;
  }

  return payload;
}

function pointDistanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pointToLineSegmentDistanceSquared(point: Point, segment: OristudioCpLineSegment): number {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return pointDistanceSquared(point, segment.a);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared)
  );
  return pointDistanceSquared(point, {
    x: segment.a.x + dx * t,
    y: segment.a.y + dy * t,
  });
}

function nearestEditableCpLineId(
  document: OristudioCpDocumentSnapshot,
  point: Point,
  maxDistance: number
): number | null {
  const maxDistanceSquared = maxDistance * maxDistance;
  let nearestId: number | null = null;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  document.crease_pattern.line_segments.forEach((segment, index) => {
    const distanceSquared = pointToLineSegmentDistanceSquared(point, segment);
    if (distanceSquared > maxDistanceSquared) return;
    if (distanceSquared < nearestDistanceSquared) {
      nearestId = index + 1;
      nearestDistanceSquared = distanceSquared;
    }
  });
  return nearestId;
}

function isLineClickSelectionOperation(operationId: string | null | undefined): boolean {
  return operationId === 'CreaseSelect' || operationId === 'CreaseUnselect';
}

function isLengthenCreaseOperation(operationId: string | null | undefined): boolean {
  return operationId === 'LengthenCrease' || operationId === 'LengthenCreaseSameColor';
}

function isSquareBisectorOperation(operationId: string | null | undefined): boolean {
  return operationId === 'SquareBisector';
}

function allowsDirectEntitySelection(operationId: string | null | undefined): boolean {
  return operationId === 'CreaseSelect';
}

function shouldPreferPointSnapForStep(
  command: OristudioCpCommandDefinition | null | undefined,
  stepIndex: number
): boolean {
  if (command?.operationId === 'DrawCreaseSymmetric') return true;
  if (command?.operationId === 'DoubleSymmetricDraw') return true;
  const step = command?.toolSteps?.[stepIndex]?.toLowerCase();
  if (!step) return false;
  if (step.includes('crease') || step.includes('line')) return false;
  return (
    step.includes('point') ||
    step.includes('vertex') ||
    step.includes('endpoint') ||
    step.includes('center') ||
    step.includes('radius')
  );
}

function isDefaultSelectionMode(
  state: { activeOperationId: string | null; phase: string },
  pendingPointCount: number,
  pendingPathCount: number
): boolean {
  return (
    state.phase === 'active' &&
    state.activeOperationId === 'CreaseSelect' &&
    pendingPointCount === 0 &&
    pendingPathCount === 0
  );
}

function isRestrictedDrawOperation(operationId: string | null | undefined): boolean {
  return operationId === 'DrawCreaseRestricted';
}

function isReflectSelectionOperation(operationId: string | null | undefined): boolean {
  return operationId === 'DrawCreaseSymmetric';
}

function cpLineTypeStatusLabel(lineColor: OristudioCpLineColor): string {
  return cpPaletteEntryForColor(lineColor)?.statusLabel ?? `Line ${cpLineAssignmentLabel(lineColor)}`;
}

function CpLineTypeToolbar({
  activeLineColor,
  applyDisabled,
  onApplyLineColor,
  onSelectLineColor,
  shortcutOverrides,
}: {
  activeLineColor: OristudioCpLineColor;
  applyDisabled: boolean;
  onApplyLineColor: () => void;
  onSelectLineColor: (lineColor: OristudioCpLineColor) => void;
  shortcutOverrides: ShortcutOverrides;
}) {
  return (
    <div className="cp-line-type-toolbar" aria-label="Active crease line type">
      {ORISTUDIO_CP_LINE_TYPE_ACTIONS.map((action) => {
        const shortcut = shortcutLabelForAction(action.id, shortcutOverrides);
        return (
          <IconButton
            key={action.id}
            size="sm"
            variant="toolbar"
            title={shortcut ? `${action.label} (${shortcut})` : action.label}
            aria-label={action.label}
            className="cp-line-type-toolbar__button"
            data-line-color={action.lineColor}
            isActive={activeLineColor === action.lineColor}
            onClick={() => onSelectLineColor(action.lineColor)}
          >
            <span aria-hidden="true">{action.railLabel}</span>
          </IconButton>
        );
      })}
      <CpLineColorMenuButton
        activeLineColor={activeLineColor}
        onSelectLineColor={onSelectLineColor}
      />
      <IconButton
        size="sm"
        variant="toolbar"
        title={
          applyDisabled
            ? 'Select lines before applying the active line color'
            : 'Apply active line color to selected lines'
        }
        aria-label="Apply active line color"
        className="cp-line-type-toolbar__apply"
        disabled={applyDisabled}
        onClick={onApplyLineColor}
      >
        <Palette size={14} />
      </IconButton>
    </div>
  );
}

function CpLineColorMenuButton({
  activeLineColor,
  onSelectLineColor,
}: {
  activeLineColor: OristudioCpLineColor;
  onSelectLineColor: (lineColor: OristudioCpLineColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activeExtraEntry = ORISTUDIO_CP_EXTRA_LINE_COLOR_PALETTE.find(
    (entry) => entry.lineColor === activeLineColor
  );

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

  const chooseColor = (lineColor: OristudioCpLineColor) => {
    onSelectLineColor(lineColor);
    setOpen(false);
  };

  return (
    <div className="viewport-toolbar__menu-anchor cp-line-color-menu" ref={menuRef}>
      <IconButton
        size="sm"
        variant="toolbar"
        title={activeExtraEntry ? activeExtraEntry.label : 'More line colors'}
        aria-label="More line colors"
        aria-haspopup="menu"
        aria-expanded={open}
        className="cp-line-color-menu__trigger"
        data-line-color={activeExtraEntry?.lineColor}
        isActive={Boolean(activeExtraEntry)}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="cp-line-color-menu__trigger-swatch" aria-hidden="true" />
      </IconButton>
      {open && (
        <div
          className="viewport-toolbar__dropdown cp-line-color-menu__panel"
          role="menu"
          aria-label="Extra line colors"
        >
          {ORISTUDIO_CP_EXTRA_LINE_COLOR_PALETTE.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="cp-line-color-menu__swatch-button"
              data-active={activeLineColor === entry.lineColor ? true : undefined}
              data-line-color={entry.lineColor}
              role="menuitemradio"
              aria-checked={activeLineColor === entry.lineColor}
              aria-label={entry.label}
              onClick={() => chooseColor(entry.lineColor)}
            >
              <span className="cp-line-color-menu__swatch" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CpGridSizeControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const normalizedValue = normalizeOrieditaGridSize(value);
  const [draft, setDraft] = useState(String(normalizedValue));

  useEffect(() => {
    setDraft(String(normalizedValue));
  }, [normalizedValue]);

  const updateDraft = (nextDraft: string) => {
    setDraft(nextDraft);
    const parsed = Number(nextDraft);
    if (!Number.isFinite(parsed)) return;
    const nextValue = normalizeOrieditaGridSize(parsed);
    if (nextValue !== normalizedValue) {
      onChange(nextValue);
    }
  };

  const normalizeDraft = () => {
    const parsed = Number(draft);
    setDraft(
      Number.isFinite(parsed)
        ? String(normalizeOrieditaGridSize(parsed))
        : String(normalizedValue)
    );
  };

  return (
    <input
      className="cp-grid-size-control"
      aria-label="Grid size"
      type="number"
      min={1}
      step={1}
      value={draft}
      onBlur={normalizeDraft}
      onChange={(event) => updateDraft(event.currentTarget.value)}
    />
  );
}

function cpSymmetryToolbarLabel(
  symmetry: OristudioCpSymmetryState,
  axisPicking: boolean,
  axisPickCount: number
) {
  if (axisPicking) return axisPickCount === 0 ? 'Pick 1' : 'Pick 2';
  if (!symmetry.enabled) return 'Sym';
  if (symmetry.preset === 'book') return 'Book';
  if (symmetry.preset === 'diagonal') return 'Diag';
  return 'Custom';
}

function cpSymmetryStatusLabel(symmetry: OristudioCpSymmetryState, axisPicking: boolean) {
  if (axisPicking) return 'Picking';
  if (!symmetry.enabled) return 'Off';
  if (symmetry.preset === 'book') return 'Book';
  if (symmetry.preset === 'diagonal') return 'Diagonal';
  return 'Custom axis';
}

function CpSymmetryMenuButton({
  symmetry,
  axisPicking,
  axisPickCount,
  onPreset,
  onPickAxis,
  onUpdate,
}: {
  symmetry: OristudioCpSymmetryState;
  axisPicking: boolean;
  axisPickCount: number;
  onPreset: (preset: 'book' | 'diagonal') => void;
  onPickAxis: () => void;
  onUpdate: (update: Partial<OristudioCpSymmetryState>) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const customLabel = axisPicking
    ? axisPickCount === 0
      ? 'Pick first'
      : 'Pick second'
    : 'Set custom axis';
  const toolbarLabel = cpSymmetryToolbarLabel(symmetry, axisPicking, axisPickCount);
  const statusLabel = cpSymmetryStatusLabel(symmetry, axisPicking);
  const canFlipPreset = symmetry.preset === 'book' || symmetry.preset === 'diagonal';

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

  const choosePreset = (preset: 'book' | 'diagonal') => {
    onPreset(preset);
    setOpen(false);
  };

  const pickAxis = () => {
    onPickAxis();
    setOpen(false);
  };

  return (
    <div className="viewport-toolbar__menu-anchor cp-symmetry-menu" ref={menuRef}>
      <button
        type="button"
        className="viewport-toolbar__symmetry-button"
        data-active={symmetry.enabled || axisPicking ? true : undefined}
        aria-label="Crease pattern symmetry"
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
          aria-label="Crease pattern symmetry controls"
        >
          <div className="symmetry-menu__header">
            <span>Symmetry</span>
            <span>{statusLabel}</span>
          </div>
          <div className="symmetry-menu__toggle-row">
            <div className="symmetry-menu__toggle-copy">
              <span>Enable symmetry</span>
              <small>Mirror new CP edits</small>
            </div>
            <Toggle
              checked={symmetry.enabled}
              onChange={(enabled) => onUpdate({ enabled, showAxis: true })}
              aria-label="Enable crease pattern symmetry"
            />
          </div>
          <div className="symmetry-menu__toggle-row">
            <div className="symmetry-menu__toggle-copy">
              <span>Show axis</span>
              <small>Display the mirror line</small>
            </div>
            <Toggle
              checked={symmetry.showAxis}
              onChange={(showAxis) => onUpdate({ showAxis })}
              aria-label="Show crease pattern symmetry axis"
            />
          </div>
          <div className="symmetry-menu__toggle-row">
            <div className="symmetry-menu__toggle-copy">
              <span>Mirror selection</span>
              <small>Selection tools include mirrored matches</small>
            </div>
            <Toggle
              checked={symmetry.mirrorSelection}
              onChange={(mirrorSelection) => onUpdate({ mirrorSelection })}
              aria-label="Mirror crease pattern selection"
            />
          </div>
          <div className="symmetry-menu__section-label">Preset</div>
          <div className="symmetry-menu__preset-grid">
            <button
              type="button"
              className="symmetry-menu__preset"
              data-active={symmetry.preset === 'book' && symmetry.enabled ? true : undefined}
              onClick={() => choosePreset('book')}
            >
              Book
            </button>
            <button
              type="button"
              className="symmetry-menu__preset"
              data-active={symmetry.preset === 'diagonal' && symmetry.enabled ? true : undefined}
              onClick={() => choosePreset('diagonal')}
            >
              Diag
            </button>
          </div>
          <button
            type="button"
            className="symmetry-menu__item"
            disabled={!canFlipPreset}
            onClick={() => {
              if (canFlipPreset) choosePreset(symmetry.preset === 'book' ? 'book' : 'diagonal');
            }}
          >
            <span>Flip preset axis</span>
          </button>
          <button
            type="button"
            className="symmetry-menu__item"
            data-active={axisPicking || (symmetry.preset === 'custom' && symmetry.enabled) ? true : undefined}
            onClick={pickAxis}
          >
            <span>{customLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function activeActionInputMode(
  action: OristudioCpActionDefinition | undefined,
  command: OristudioCpCommandDefinition | undefined
): OristudioCpActionInputMode | undefined {
  if (action?.kind === 'command') return action.inputMode ?? action.command.inputMode;
  return command?.inputMode;
}

function cpCommandRequiresContextApply(command: OristudioCpCommandDefinition): boolean {
  if (command.operationId === 'Text') return true;
  if (command.operationId === 'VoronoiCreate') return true;
  if (isSelectionCircleApplyOperation(command.operationId)) return true;
  if ((command.toolSteps?.length ?? 0) > 0) return false;
  return cpToolSettingGroupsForCommand(command).some(
    (group) => group !== 'line-color' && group !== 'line-select-help'
  );
}

function isVariablePointSequenceOperation(
  operationId: OristudioCpCommandDefinition['operationId'] | null | undefined
): boolean {
  return operationId === 'VoronoiCreate';
}

function isTextAnnotationOperation(
  operationId: OristudioCpCommandDefinition['operationId'] | null | undefined
): boolean {
  return operationId === 'Text';
}

function isSelectionCircleApplyOperation(
  operationId: OristudioCpCommandDefinition['operationId'] | null | undefined
): boolean {
  return (
    operationId === 'CircleDrawTangentLine' ||
    operationId === 'CircleDrawInverted' ||
    operationId === 'CircleDrawConcentricSelect' ||
    operationId === 'CircleDrawConcentricTwoCircleSelect'
  );
}

function isCircleTangentPointOperation(
  operationId: OristudioCpCommandDefinition['operationId'] | null | undefined
): boolean {
  return operationId === 'CircleDrawTangentLine';
}

function canPreviewFromSelection(
  command: OristudioCpCommandDefinition | null | undefined,
  selection: OristudioCpSelection
): boolean {
  if (!command) return false;
  switch (command.operationId) {
    case 'CircleDrawTangentLine':
      return selection.circles.length >= 2;
    case 'CircleDrawInverted':
      return selection.circles.length >= 2 || (selection.circles.length >= 1 && selection.lines.length >= 1);
    case 'CircleDrawConcentricSelect':
      return selection.circles.length >= 3;
    case 'CircleDrawConcentricTwoCircleSelect':
      return selection.circles.length >= 2;
    default:
      return false;
  }
}

function contextApplyDisabledForCommand(
  command: OristudioCpCommandDefinition,
  selection: OristudioCpSelection,
  pendingPointCount: number
): boolean {
  switch (command.operationId) {
    case 'VoronoiCreate':
      return pendingPointCount === 0;
    case 'Text':
      return selection.texts.length === 0;
    case 'CircleChangeColor':
      return selection.circles.length === 0 && selection.lines.length === 0;
    case 'CircleDrawTangentLine':
      return selection.circles.length < 2;
    case 'CircleDrawInverted':
      return selection.circles.length < 2 && !(selection.circles.length >= 1 && selection.lines.length >= 1);
    case 'CircleDrawConcentricSelect':
      return selection.circles.length < 3;
    case 'CircleDrawConcentricTwoCircleSelect':
      return selection.circles.length < 2;
    default:
      return false;
  }
}

function isCpLineEventTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-cp-line-id], [data-cp-line-hit-id]') !== null
  );
}

function isCpSelectableEntityEventTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      [
        '[data-cp-line-id]',
        '[data-cp-line-hit-id]',
        '[data-cp-point-id]',
        '[data-cp-circle-id]',
        '[data-cp-text-id]',
        '[data-cp-vertex-id]',
      ].join(', ')
    ) !== null
  );
}

function isCpSelectionTransformEventTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-cp-selection-transform-control]') !== null
  );
}

function cpTextIdFromEventTarget(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest('[data-cp-text-id]');
  const id = element?.getAttribute('data-cp-text-id');
  if (!id) return null;
  const parsed = Number.parseInt(id, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

type CpMeasurementSlotId = 'length1' | 'length2' | 'angle1' | 'angle2' | 'angle3';
type CpMeasurementSlots = Record<CpMeasurementSlotId, number | null>;

interface CpSelectionRotationDrag {
  pointerId: number;
  center: Point;
  startAngleDegrees: number;
  sourceLines: OristudioCpLineSegment[];
  currentAngleDegrees: number;
}

interface CpSelectionMoveDrag {
  pointerId: number;
  startPoint: Point;
  sourceLines: OristudioCpLineSegment[];
  currentDelta: Point;
}

type CpSelectionResizeHandle =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left';

interface CpSelectionResizeDrag {
  pointerId: number;
  frame: CpLineSelectionFrame;
  handle: CpSelectionResizeHandle;
  sourceLines: OristudioCpLineSegment[];
  currentTransform: Extract<CpSelectionTransform, { kind: 'scale' }> | null;
}

interface CpSelectionTransformPreview {
  kind: 'rotate' | 'translate' | 'scale';
  angleDegrees?: number;
  delta?: Point;
  scaleX?: number;
  scaleY?: number;
  snapLabel?: string | null;
  segments: OristudioCpLineSegment[];
  frame: CpLineSelectionFrame;
}

interface CpSelectionResizeHandleSpec {
  id: CpSelectionResizeHandle;
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
  scaleX: boolean;
  scaleY: boolean;
  cursor: 'ew' | 'ns' | 'nwse' | 'nesw';
}

const CP_SELECTION_RESIZE_HANDLES: readonly CpSelectionResizeHandleSpec[] = [
  { id: 'top-left', x: -1, y: 1, scaleX: true, scaleY: true, cursor: 'nwse' },
  { id: 'top', x: 0, y: 1, scaleX: false, scaleY: true, cursor: 'ns' },
  { id: 'top-right', x: 1, y: 1, scaleX: true, scaleY: true, cursor: 'nesw' },
  { id: 'right', x: 1, y: 0, scaleX: true, scaleY: false, cursor: 'ew' },
  { id: 'bottom-right', x: 1, y: -1, scaleX: true, scaleY: true, cursor: 'nwse' },
  { id: 'bottom', x: 0, y: -1, scaleX: false, scaleY: true, cursor: 'ns' },
  { id: 'bottom-left', x: -1, y: -1, scaleX: true, scaleY: true, cursor: 'nesw' },
  { id: 'left', x: -1, y: 0, scaleX: true, scaleY: false, cursor: 'ew' },
];

const CP_SELECTION_RESIZE_HANDLE_BY_ID = new Map(
  CP_SELECTION_RESIZE_HANDLES.map((handle) => [handle.id, handle])
);

const CP_MEASUREMENT_SLOT_LABELS: Record<CpMeasurementSlotId, string> = {
  length1: 'L1',
  length2: 'L2',
  angle1: 'A1',
  angle2: 'A2',
  angle3: 'A3',
};

const CP_MEASUREMENT_SLOT_ORDER: readonly CpMeasurementSlotId[] = [
  'length1',
  'length2',
  'angle1',
  'angle2',
  'angle3',
];

function createEmptyCpMeasurementSlots(): CpMeasurementSlots {
  return {
    length1: null,
    length2: null,
    angle1: null,
    angle2: null,
    angle3: null,
  };
}

function cpMeasurementSlotForOperation(
  operationId: OristudioCpCommandDefinition['operationId'] | null | undefined
): CpMeasurementSlotId | null {
  switch (operationId) {
    case 'DisplayLengthBetweenPoints1':
      return 'length1';
    case 'DisplayLengthBetweenPoints2':
      return 'length2';
    case 'DisplayAngleBetweenThreePoints1':
      return 'angle1';
    case 'DisplayAngleBetweenThreePoints2':
      return 'angle2';
    case 'DisplayAngleBetweenThreePoints3':
      return 'angle3';
    default:
      return null;
  }
}

function isCpMeasurementOperation(
  operationId: OristudioCpCommandDefinition['operationId'] | null | undefined
): boolean {
  return cpMeasurementSlotForOperation(operationId) !== null;
}

function computeCpMeasurementValue(
  operationId: OristudioCpCommandDefinition['operationId'],
  points: readonly Point[]
): number | null {
  const slot = cpMeasurementSlotForOperation(operationId);
  if (!slot) return null;

  if (slot === 'length1' || slot === 'length2') {
    const [a, b] = points;
    if (!a || !b) return null;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  const [a, center, b] = points;
  if (!a || !center || !b) return null;
  const start = Math.atan2(a.y - center.y, a.x - center.x);
  const end = Math.atan2(b.y - center.y, b.x - center.x);
  const degrees = ((end - start) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

function formatCpMeasurementValue(slot: CpMeasurementSlotId, value: number | null): string {
  if (value === null) return '-';
  const precision = slot.startsWith('angle') ? 2 : 3;
  const unit = slot.startsWith('angle') ? ' deg' : '';
  return `${formatNumber(value, precision)}${unit}`;
}

function resizeTransformForPoint(
  frame: CpLineSelectionFrame,
  handleId: CpSelectionResizeHandle,
  point: Point,
  minSpan: number
): Extract<CpSelectionTransform, { kind: 'scale' }> {
  const handle = CP_SELECTION_RESIZE_HANDLE_BY_ID.get(handleId);
  const halfWidth = frame.width / 2;
  const halfHeight = frame.height / 2;
  if (!handle) {
    return {
      kind: 'scale',
      frame,
      anchor: { x: 0, y: 0 },
      scaleX: 1,
      scaleY: 1,
    };
  }

  const local = cpFramePointToLocal(frame, point);
  const anchor = {
    x: handle.scaleX ? -handle.x * halfWidth : 0,
    y: handle.scaleY ? -handle.y * halfHeight : 0,
  };
  const handleLocal = {
    x: handle.x * halfWidth,
    y: handle.y * halfHeight,
  };
  let scaleX = 1;
  let scaleY = 1;
  if (handle.scaleX) {
    const denominator = handleLocal.x - anchor.x;
    if (Math.abs(denominator) > 1e-9) {
      const minScale = minSpan / Math.max(frame.width, 1e-9);
      scaleX = Math.max(minScale, (local.x - anchor.x) / denominator);
    }
  }
  if (handle.scaleY) {
    const denominator = handleLocal.y - anchor.y;
    if (Math.abs(denominator) > 1e-9) {
      const minScale = minSpan / Math.max(frame.height, 1e-9);
      scaleY = Math.max(minScale, (local.y - anchor.y) / denominator);
    }
  }

  return {
    kind: 'scale',
    frame,
    anchor,
    scaleX,
    scaleY,
  };
}

function normalizeSelectionTransformAngle(angleDegrees: number): number {
  const normalized = angleDegrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function CreasePatternPanel() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [spacePressed, setSpacePressed] = useState(false);
  const [cursorModelPoint, setCursorModelPoint] = useState<Point | null>(null);
  const [snapTarget, setSnapTarget] = useState<CpSnapTarget | null>(null);
  const [cpToolState, setCpToolState] = useState(IDLE_ORISTUDIO_CP_TOOL_STATE);
  const [activeCpLineColor, setActiveCpLineColor] = useState<OristudioCpLineColor>('Red1');
  const [cpToolOptions, setCpToolOptions] = useState<OristudioCpToolOptions>(
    DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS
  );
  const [cpToolPoints, setCpToolPoints] = useState<Point[]>([]);
  const [cpToolPath, setCpToolPath] = useState<Point[]>([]);
  const [pendingLengthenLineId, setPendingLengthenLineId] = useState<number | null>(null);
  const [pendingSquareBisectorLineIds, setPendingSquareBisectorLineIds] = useState<number[]>([]);
  const [cpMeasurementSlots, setCpMeasurementSlots] = useState<CpMeasurementSlots>(
    createEmptyCpMeasurementSlots
  );
  const [cpCommandPreview, setCpCommandPreview] = useState<OristudioCpCommandPreview | null>(null);
  const [cpSymmetryAxisPickPoints, setCpSymmetryAxisPickPoints] = useState<Point[] | null>(null);
  const [selectionRotationPreview, setSelectionRotationPreview] =
    useState<CpSelectionTransformPreview | null>(null);
  const [selectionTransformAngleDegrees, setSelectionTransformAngleDegrees] = useState(0);
  const [diagnosticHudExpanded, setDiagnosticHudExpanded] = useState(false);
  const cpPreviewRequestRef = useRef(0);
  const lastFocusedDiagnosticRef = useRef<string | null>(null);
  const defaultCpToolDocumentRef = useRef<string | null>(null);
  const selectionRotateDragRef = useRef<CpSelectionRotationDrag | null>(null);
  const selectionMoveDragRef = useRef<CpSelectionMoveDrag | null>(null);
  const selectionResizeDragRef = useRef<CpSelectionResizeDrag | null>(null);
  const cpToolDragRef = useRef<{
    operationId: OristudioCpCommandDefinition['operationId'];
    actionId: OristudioCpCommandActionDefinition['id'] | null;
    mode: 'drag-line' | 'drag-path' | 'drag-box' | 'text-drag';
    pointerId: number;
    points: Point[];
    replaceSelection?: boolean;
    textId?: number;
  } | null>(null);

  const project = useWorkspaceStore((state) => state.project);
  const status = useWorkspaceStore((state) => state.status);
  const error = useWorkspaceStore((state) => state.error);
  const documentMode = useWorkspaceStore((state) => state.documentMode);
  const importedCreasePattern = useWorkspaceStore((state) => state.importedCreasePattern);
  const oristudioCpDocument = useWorkspaceStore((state) => state.oristudioCpDocument);
  const oristudioCpLineage = useWorkspaceStore((state) => state.oristudioCpLineage);
  const oristudioCpSymmetry = useWorkspaceStore((state) => state.oristudioCpSymmetry);
  const oristudioCpCamvResult = useWorkspaceStore((state) => state.oristudioCpCamvResult);
  const oristudioCpError = useWorkspaceStore((state) => state.oristudioCpError);
  const oristudioCpSelection = useWorkspaceStore((state) => state.oristudioCpSelection);
  const oristudioCpActionRequest = useWorkspaceStore((state) => state.oristudioCpActionRequest);
  const oristudioCpActiveDiagnosticId = useWorkspaceStore(
    (state) => state.oristudioCpActiveDiagnosticId
  );
  const oristudioCpViewport = useWorkspaceStore((state) => state.oristudioCpViewport);
  const projectLoadId = useWorkspaceStore((state) => state.projectLoadId);
  const mode = useWorkspaceStore((state) => state.creaseColorMode);
  const selection = useWorkspaceStore((state) => state.selection);
  const setMode = useWorkspaceStore((state) => state.setCreaseColorMode);
  const select = useWorkspaceStore((state) => state.select);
  const setOristudioCpViewportOption = useWorkspaceStore(
    (state) => state.setOristudioCpViewportOption
  );
  const setOristudioCpGridSize = useWorkspaceStore((state) => state.setOristudioCpGridSize);
  const setOristudioCpSymmetry = useWorkspaceStore((state) => state.setOristudioCpSymmetry);
  const setActiveEditingSurface = useWorkspaceStore((state) => state.setActiveEditingSurface);
  const toggleOristudioCpLineSelection = useWorkspaceStore(
    (state) => state.toggleOristudioCpLineSelection
  );
  const toggleOristudioCpVertexSelection = useWorkspaceStore(
    (state) => state.toggleOristudioCpVertexSelection
  );
  const toggleOristudioCpPointSelection = useWorkspaceStore(
    (state) => state.toggleOristudioCpPointSelection
  );
  const toggleOristudioCpCircleSelection = useWorkspaceStore(
    (state) => state.toggleOristudioCpCircleSelection
  );
  const toggleOristudioCpTextSelection = useWorkspaceStore(
    (state) => state.toggleOristudioCpTextSelection
  );
  const setOristudioCpSelection = useWorkspaceStore((state) => state.setOristudioCpSelection);
  const clearOristudioCpActionRequest = useWorkspaceStore(
    (state) => state.clearOristudioCpActionRequest
  );
  const setOristudioCpActiveDiagnostic = useWorkspaceStore(
    (state) => state.setOristudioCpActiveDiagnostic
  );
  const clearOristudioCpSelection = useWorkspaceStore((state) => state.clearOristudioCpSelection);
  const executeOristudioCpCommand = useWorkspaceStore(
    (state) => state.executeOristudioCpCommand
  );
  const previewOristudioCpCommand = useWorkspaceStore(
    (state) => state.previewOristudioCpCommand
  );
  const transformOristudioCpSelection = useWorkspaceStore(
    (state) => state.transformOristudioCpSelection
  );
  const shortcutOverrides = useShortcutStore((state) => state.overrides);

  const editableCp = oristudioCpDocument?.document ?? null;
  const editableCpHandle = oristudioCpDocument?.handle ?? null;
  const editableCpSummary = oristudioCpDocument?.summary ?? null;
  const cpCanvasRect = editableCp ? CP_EDITABLE_CANVAS_RECT : CP_WORLD_RECT;
  const cpFitRect = editableCp ? CP_EDITABLE_FIT_RECT : CP_WORLD_RECT;
  const cpCanvasViewBox = `${cpCanvasRect.x} ${cpCanvasRect.y} ${cpCanvasRect.width} ${cpCanvasRect.height}`;
  const editableCpBounds = ORIEDITA_PAPER_BOUNDS;
  const editableCpVisibleGrid = useMemo(
    () =>
      editableCp && oristudioCpViewport.gridVisible
        ? visibleOrieditaGridMetadata(editableCp.crease_pattern.grid)
        : null,
    [editableCp, oristudioCpViewport.gridVisible]
  );
  const editableCpGridLines = useMemo(
    () =>
      editableCpVisibleGrid
        ? getCpGridLines(editableCpBounds, editableCpVisibleGrid, 1, {
            canvasRect: cpCanvasRect,
            paperRect: CP_PAPER_RECT,
          })
        : [],
    [cpCanvasRect, editableCpBounds, editableCpVisibleGrid]
  );
  const editableCpGridWidth = useMemo(
    () =>
      editableCp
        ? getOrieditaGridBasis(visibleOrieditaGridMetadata(editableCp.crease_pattern.grid)).gridWidth
        : undefined,
    [editableCp]
  );
  const editableCpGridSize = editableCp
    ? normalizeOrieditaGridSize(editableCp.crease_pattern.grid.grid_size)
    : 8;
  const editableCpVertices = useMemo(() => getCpVertices(editableCp), [editableCp]);
  const hasEditableCreasePattern = !!editableCp;
  const hasCreasePattern =
    hasEditableCreasePattern || project.creases.length > 0 || project.facets.length > 0;
  const editableSelectionSize = cpSelectionSize(oristudioCpSelection);
  const editableSelectionLineKey = oristudioCpSelection.lines.join(',');
  const selectedEditableCpLines = useMemo(
    () => selectedCpLineSegments(editableCp, oristudioCpSelection),
    [editableCp, oristudioCpSelection]
  );
  const selectionTransformFrame = useMemo(
    () =>
      selectionRotationPreview?.frame ??
      cpLineSelectionFrame(selectedEditableCpLines, selectionTransformAngleDegrees),
    [selectedEditableCpLines, selectionRotationPreview, selectionTransformAngleDegrees]
  );
  const cpUiScale = 100 / Math.max(zoomPercent, 1);
  const activeCpAction = useMemo(
    () => (cpToolState.activeActionId ? cpActionById(cpToolState.activeActionId) : undefined),
    [cpToolState.activeActionId]
  );
  const activeCpCommand = useMemo(
    () => {
      if (activeCpAction?.kind === 'command') return activeCpAction.command;
      return cpToolState.activeOperationId
        ? cpCommandByOperation(cpToolState.activeOperationId)
        : undefined;
    },
    [activeCpAction, cpToolState.activeOperationId]
  );
  const activeCpInputMode = useMemo(
    () => activeActionInputMode(activeCpAction, activeCpCommand),
    [activeCpAction, activeCpCommand]
  );
  const visibleSelectionTransformFrame = isDefaultSelectionMode(
    cpToolState,
    cpToolPoints.length,
    cpToolPath.length
  )
    ? selectionTransformFrame
    : null;
  const highlightedEditableLineIds = useMemo(
    () => [
      ...pendingSquareBisectorLineIds,
      ...(pendingLengthenLineId === null ? [] : [pendingLengthenLineId]),
    ],
    [pendingLengthenLineId, pendingSquareBisectorLineIds]
  );
  const liveCommandPreviewPoints = useMemo(() => {
    if (cpToolPath.length > 0) return cpToolPath;
    if (!activeCpCommand || cpToolState.phase !== 'active') return cpToolPoints;
    if (isVariablePointSequenceOperation(activeCpCommand.operationId)) return cpToolPoints;
    const stepCount = activeCpCommand.toolSteps?.length ?? 0;
    const livePoint = snapTarget?.point ?? cursorModelPoint;
    if (stepCount === 0 || !livePoint || cpToolPoints.length === 0) return cpToolPoints;
    return [...cpToolPoints, livePoint].slice(0, stepCount);
  }, [activeCpCommand, cpToolPath, cpToolPoints, cpToolState.phase, cursorModelPoint, snapTarget]);
  const localDragLinePreviewSegments = useMemo<OristudioCpLineSegment[]>(() => {
    if (activeCpInputMode !== 'drag-line' || liveCommandPreviewPoints.length < 2) return [];
    const a = liveCommandPreviewPoints[0];
    const b = liveCommandPreviewPoints[1];
    if (!a || !b) return [];
    return [
      {
        a,
        b,
        color: activeCpLineColor,
        active: 'Inactive0',
        selected: 0,
        customized: 0,
        customized_color: { red: 0, green: 0, blue: 0 },
      },
    ];
  }, [activeCpInputMode, activeCpLineColor, liveCommandPreviewPoints]);
  const baseRenderedCommandPreviewPoints = useMemo(
    () =>
      activeCpInputMode === 'drag-line' ||
      activeCpInputMode === 'drag-box' ||
      isVariablePointSequenceOperation(activeCpCommand?.operationId)
        ? []
        : liveCommandPreviewPoints,
    [activeCpCommand?.operationId, activeCpInputMode, liveCommandPreviewPoints]
  );
  const baseRenderedCommandPreviewSegments = useMemo(
    () =>
      localDragLinePreviewSegments.length > 0
        ? localDragLinePreviewSegments
        : (cpCommandPreview?.segments ?? []),
    [cpCommandPreview?.segments, localDragLinePreviewSegments]
  );
  const renderedCommandPreviewBox = useMemo(
    () =>
      activeCpInputMode === 'drag-box' &&
      liveCommandPreviewPoints[0] &&
      liveCommandPreviewPoints[1]
        ? ([liveCommandPreviewPoints[0], liveCommandPreviewPoints[1]] as const)
        : null,
    [activeCpInputMode, liveCommandPreviewPoints]
  );
  const mirrorCommandPreview = shouldMirrorOristudioCpCommandPreview(
    activeCpCommand?.operationId,
    oristudioCpSymmetry
  );
  const renderedCommandPreviewBoxes = useMemo(() => {
    if (!renderedCommandPreviewBox) return [];
    if (!mirrorCommandPreview) return [renderedCommandPreviewBox];
    const reflectedPoints = reflectedPreviewPoints(
      [renderedCommandPreviewBox[0], renderedCommandPreviewBox[1]],
      oristudioCpSymmetry
    );
    const reflectedA = reflectedPoints[2];
    const reflectedB = reflectedPoints[3];
    if (!reflectedA || !reflectedB) return [renderedCommandPreviewBox];
    return [renderedCommandPreviewBox, [reflectedA, reflectedB] as const];
  }, [mirrorCommandPreview, oristudioCpSymmetry, renderedCommandPreviewBox]);
  const renderedCommandPreviewPoints = useMemo(
    () =>
      mirrorCommandPreview
        ? reflectedPreviewPoints(baseRenderedCommandPreviewPoints, oristudioCpSymmetry)
        : baseRenderedCommandPreviewPoints,
    [baseRenderedCommandPreviewPoints, mirrorCommandPreview, oristudioCpSymmetry]
  );
  const renderedCommandPreviewSegments = useMemo(
    () =>
      mirrorCommandPreview
        ? reflectedPreviewSegments(baseRenderedCommandPreviewSegments, oristudioCpSymmetry)
        : baseRenderedCommandPreviewSegments,
    [baseRenderedCommandPreviewSegments, mirrorCommandPreview, oristudioCpSymmetry]
  );
  const renderedCommandPreviewCircles = useMemo(
    () =>
      mirrorCommandPreview
        ? reflectedPreviewCircles(cpCommandPreview?.circles ?? [], oristudioCpSymmetry)
        : (cpCommandPreview?.circles ?? []),
    [cpCommandPreview?.circles, mirrorCommandPreview, oristudioCpSymmetry]
  );
  const renderedCommandCandidatePoints = useMemo(
    () =>
      mirrorCommandPreview
        ? reflectedPreviewPoints(cpCommandPreview?.points ?? [], oristudioCpSymmetry)
        : (cpCommandPreview?.points ?? []),
    [cpCommandPreview?.points, mirrorCommandPreview, oristudioCpSymmetry]
  );
  const squareBisectorToolPrompt =
    isSquareBisectorOperation(activeCpCommand?.operationId) &&
    cpToolState.phase === 'active' &&
    cpToolPoints.length === 0
      ? pendingSquareBisectorLineIds.length === 1
        ? 'Angle Bisector: Select 2 lines'
        : pendingSquareBisectorLineIds.length === 2
          ? 'Angle Bisector: Select segment to end'
          : cpToolState.prompt
      : cpToolState.prompt;
  const activeCpToolPrompt = cpSymmetryAxisPickPoints
    ? cpSymmetryAxisPickPoints.length === 0
      ? 'Set symmetry axis: first point'
      : 'Set symmetry axis: second point'
    : squareBisectorToolPrompt;
  const visibleCpSymmetryAxisLine = useMemo(() => {
    if (
      !editableCp ||
      !oristudioCpSymmetry.showAxis ||
      (!oristudioCpSymmetry.enabled && oristudioCpSymmetry.preset === 'none')
    ) {
      return null;
    }
    return cpSymmetryAxisLine(oristudioCpSymmetry.axis, editableCpBounds);
  }, [editableCp, editableCpBounds, oristudioCpSymmetry]);
  const draftCpSymmetryAxisLine = useMemo(() => {
    if (!editableCp || !cpSymmetryAxisPickPoints || cpSymmetryAxisPickPoints.length === 0) {
      return null;
    }
    const start = cpSymmetryAxisPickPoints[0];
    const end = snapTarget?.point ?? cursorModelPoint;
    if (!start || !end) return null;
    const axis = axisFromTwoPoints(start, end);
    return axis ? cpSymmetryAxisLine(axis, editableCpBounds) : null;
  }, [cpSymmetryAxisPickPoints, cursorModelPoint, editableCp, editableCpBounds, snapTarget]);
  const lastCommandResult = oristudioCpDocument?.lastCommandResult ?? null;
  const camvDiagnosticEntries =
    oristudioCpCamvResult?.diagnostic_entries ?? EMPTY_DIAGNOSTIC_ENTRIES;
  const latestCommandDiagnosticEntries =
    lastCommandResult && isDiagnosticResultOperation(lastCommandResult.operation)
      ? (lastCommandResult.diagnostic_entries ?? EMPTY_DIAGNOSTIC_ENTRIES)
      : EMPTY_DIAGNOSTIC_ENTRIES;
  const latestDiagnosticEntries = useMemo(() => {
    if (lastCommandResult?.operation === 'CheckCamv') return latestCommandDiagnosticEntries;
    if (camvDiagnosticEntries.length === 0) return latestCommandDiagnosticEntries;
    if (latestCommandDiagnosticEntries.length === 0) return camvDiagnosticEntries;
    return [...camvDiagnosticEntries, ...latestCommandDiagnosticEntries];
  }, [camvDiagnosticEntries, latestCommandDiagnosticEntries, lastCommandResult?.operation]);
  const diagnosticStatus = useMemo(
    () =>
      diagnosticHudStatus(oristudioCpCamvResult, { issueOnly: true }) ??
      diagnosticHudStatus(lastCommandResult),
    [lastCommandResult, oristudioCpCamvResult]
  );
  const diagnosticHudEntries = useMemo(() => {
    const hudResult =
      diagnosticHudStatus(oristudioCpCamvResult, { issueOnly: true }) !== null
        ? oristudioCpCamvResult
        : lastCommandResult;
    if (!hudResult || !isDiagnosticResultOperation(hudResult.operation)) {
      return EMPTY_DIAGNOSTIC_ENTRIES;
    }
    return hudResult.diagnostic_entries ?? EMPTY_DIAGNOSTIC_ENTRIES;
  }, [lastCommandResult, oristudioCpCamvResult]);
  const activeDiagnosticEntry = useMemo(
    () =>
      latestDiagnosticEntries.find((entry) => entry.id === oristudioCpActiveDiagnosticId) ?? null,
    [latestDiagnosticEntries, oristudioCpActiveDiagnosticId]
  );
  const buildCpCommandPayload = useCallback(
    (
      command: OristudioCpCommandDefinition,
      payload: OristudioCpCommandPayload = {}
    ): OristudioCpCommandPayload => ({
      ...cpCommandPayloadDefaults(
        command,
        editableCpBounds,
        editableCpGridWidth,
        activeCpLineColor,
        zoomPercent / 100,
        cpToolOptions
      ),
      ...payload,
    }),
    [activeCpLineColor, cpToolOptions, editableCpBounds, editableCpGridWidth, zoomPercent]
  );

  const handleCpSymmetryPreset = useCallback(
    (preset: 'book' | 'diagonal') => {
      const axis =
        oristudioCpSymmetry.preset === preset
          ? nextCpSymmetryPresetAxis(oristudioCpSymmetry)
          : cpSymmetryPresetAxis(preset, oristudioCpSymmetry.axis.angle);
      if (!axis) return;
      setCpSymmetryAxisPickPoints(null);
      setOristudioCpSymmetry({
        enabled: true,
        showAxis: true,
        preset,
        axis,
      });
      setActiveEditingSurface('crease-pattern');
    },
    [oristudioCpSymmetry, setActiveEditingSurface, setOristudioCpSymmetry]
  );

  const handleStartCpSymmetryAxisPick = useCallback(() => {
    setCpSymmetryAxisPickPoints([]);
    setOristudioCpSymmetry({ showAxis: true, preset: 'custom' });
    setActiveEditingSurface('crease-pattern');
  }, [setActiveEditingSurface, setOristudioCpSymmetry]);

  useEffect(() => {
    const documentKey = editableCp
      ? String(editableCpHandle ?? `editable-cp-${projectLoadId}`)
      : null;
    if (!documentKey) {
      defaultCpToolDocumentRef.current = null;
      return;
    }
    const isNewDocument = defaultCpToolDocumentRef.current !== documentKey;
    defaultCpToolDocumentRef.current = documentKey;
    const defaultAction = cpActionById(DEFAULT_ORISTUDIO_CP_ACTION_ID);
    if (!defaultAction) return;
    setCpToolState((state) =>
      isNewDocument || state.phase === 'idle'
        ? transitionOristudioCpToolState(state, {
            type: 'selectAction',
            action: defaultAction,
            editable: true,
          })
        : state
    );
  }, [cpToolState.phase, editableCp, editableCpHandle, projectLoadId]);

  useEffect(() => {
    if (
      !editableCp ||
      !activeCpCommand ||
      activeCpCommand.uiStatus !== 'ready' ||
      cpToolState.phase !== 'active' ||
      isCpMeasurementOperation(activeCpCommand.operationId) ||
      activeCpInputMode === 'drag-path' ||
      activeCpInputMode === 'drag-line' ||
      activeCpInputMode === 'drag-box' ||
      (liveCommandPreviewPoints.length === 0 &&
        !canPreviewFromSelection(activeCpCommand, oristudioCpSelection))
    ) {
      cpPreviewRequestRef.current += 1;
      setCpCommandPreview(null);
      return;
    }

    const requestId = cpPreviewRequestRef.current + 1;
    cpPreviewRequestRef.current = requestId;
    void previewOristudioCpCommand(
      activeCpCommand.operationId,
      buildCpCommandPayload(activeCpCommand, {
        line_ids: oristudioCpSelection.lines,
        circle_ids: oristudioCpSelection.circles,
        points: liveCommandPreviewPoints,
      })
    ).then((preview) => {
      if (cpPreviewRequestRef.current === requestId) {
        setCpCommandPreview(preview);
      }
    });
  }, [
    activeCpCommand,
    activeCpInputMode,
    buildCpCommandPayload,
    cpToolState.phase,
    editableCp,
    liveCommandPreviewPoints,
    oristudioCpSelection.circles,
    oristudioCpSelection.lines,
    oristudioCpSelection,
    previewOristudioCpCommand,
  ]);

  const handleCpToolAction = useCallback(
    (action: OristudioCpActionDefinition) => {
      setPendingLengthenLineId(null);
      if (action.kind === 'line-type') {
        setActiveCpLineColor(action.lineColor);
        return;
      }

      const command = action.command;
      setCpToolPoints([]);
      setCpToolPath([]);
      setPendingSquareBisectorLineIds([]);
      setCpCommandPreview(null);
      cpToolDragRef.current = null;
      setCpToolState((state) =>
        transitionOristudioCpToolState(state, {
          type: 'selectAction',
          action,
          editable: !!editableCp,
        })
      );

      if (!editableCp || command.uiStatus !== 'ready' || (command.toolSteps?.length ?? 0) > 0) {
        return;
      }

      if (cpCommandRequiresContextApply(command)) {
        return;
      }

      void (async () => {
        const succeeded = await executeOristudioCpCommand(
          command.operationId,
          buildCpCommandPayload(command, {
            line_ids: oristudioCpSelection.lines,
          })
        );
        setCpToolPoints([]);
        setCpToolState((state) =>
          state.activeActionId === action.id
            ? transitionOristudioCpToolState(
                state,
                succeeded
                  ? { type: 'commit', keepActive: true }
                  : {
                      type: 'commandError',
                      message: useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                    }
              )
            : state
        );
      })();
    },
    [buildCpCommandPayload, editableCp, executeOristudioCpCommand, oristudioCpSelection.lines]
  );

  const handleCpShortcutAction = useCallback(
    (actionId: OristudioCpActionId) => {
      const action = cpActionById(actionId);
      if (!action) return;
      handleCpToolAction(action);
    },
    [handleCpToolAction]
  );

  useEffect(
    () => registerCpActionShortcutExecutor(handleCpShortcutAction),
    [handleCpShortcutAction]
  );

  useEffect(() => {
    if (!oristudioCpActionRequest) return;

    const action = cpActionByOperation(oristudioCpActionRequest.operationId);
    if (action) {
      handleCpToolAction(action);
    }
    clearOristudioCpActionRequest(oristudioCpActionRequest.id);
  }, [clearOristudioCpActionRequest, handleCpToolAction, oristudioCpActionRequest]);

  const handleApplyActiveLineColor = useCallback(() => {
    if (!editableCp || oristudioCpSelection.lines.length === 0) return;
    void executeOristudioCpCommand('CreaseSetLineColor', {
      line_ids: oristudioCpSelection.lines,
      line_color: activeCpLineColor,
    });
  }, [activeCpLineColor, editableCp, executeOristudioCpCommand, oristudioCpSelection.lines]);

  const handleApplyActiveContextCommand = useCallback(() => {
    if (
      !editableCp ||
      !activeCpCommand ||
      activeCpCommand.uiStatus !== 'ready' ||
      ((activeCpCommand.toolSteps?.length ?? 0) > 0 &&
        !isVariablePointSequenceOperation(activeCpCommand.operationId) &&
        !isTextAnnotationOperation(activeCpCommand.operationId))
    ) {
      return;
    }
    if (activeCpCommand.operationId === 'VoronoiCreate' && cpToolPoints.length === 0) {
      return;
    }
    if (activeCpCommand.operationId === 'Text' && oristudioCpSelection.texts.length === 0) {
      return;
    }

    void (async () => {
      const selectionPayload: OristudioCpCommandPayload = {
        line_ids: oristudioCpSelection.lines,
      };
      if (
        activeCpCommand.operationId === 'CircleChangeColor' ||
        isSelectionCircleApplyOperation(activeCpCommand.operationId)
      ) {
        selectionPayload.circle_ids = oristudioCpSelection.circles;
      }
      if (activeCpCommand.operationId === 'VoronoiCreate') {
        selectionPayload.points = cpToolPoints;
      }
      if (activeCpCommand.operationId === 'Text') {
        selectionPayload.text_ids = oristudioCpSelection.texts;
        selectionPayload.text_action = 'SetContent';
        selectionPayload.text_content = cpToolOptions.textContent;
      }
      const succeeded = await executeOristudioCpCommand(
        activeCpCommand.operationId,
        buildCpCommandPayload(activeCpCommand, selectionPayload)
      );
      if (succeeded && activeCpCommand.operationId === 'VoronoiCreate') {
        setCpToolPoints([]);
        setCpCommandPreview(null);
      }
      setCpToolState((state) =>
        state.activeOperationId === activeCpCommand.operationId
          ? transitionOristudioCpToolState(
              state,
              succeeded
                  ? { type: 'commit', keepActive: true }
                : {
                    type: 'commandError',
                    message: useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                  }
            )
          : state
      );
    })();
  }, [
    activeCpCommand,
    buildCpCommandPayload,
    cpToolPoints,
    cpToolOptions.textContent,
    editableCp,
    executeOristudioCpCommand,
    oristudioCpSelection.circles,
    oristudioCpSelection.lines,
    oristudioCpSelection.texts,
  ]);

  const handleClearActiveContextInput = useCallback(() => {
    if (!activeCpCommand || activeCpCommand.operationId !== 'VoronoiCreate') return;
    setCpToolPoints([]);
    setCpCommandPreview(null);
    setCpToolState((state) =>
      state.activeOperationId === activeCpCommand.operationId
        ? transitionOristudioCpToolState(state, { type: 'cancel', keepActive: true })
        : state
    );
  }, [activeCpCommand]);

  const handleSelectCpDiagnostic = useCallback(
    (id: string) => {
      setOristudioCpActiveDiagnostic(id);
    },
    [setOristudioCpActiveDiagnostic]
  );

  const handleDeleteSelectedText = useCallback(() => {
    if (
      !editableCp ||
      !activeCpCommand ||
      activeCpCommand.operationId !== 'Text' ||
      oristudioCpSelection.texts.length === 0
    ) {
      return;
    }

    void (async () => {
      const succeeded = await executeOristudioCpCommand(
        activeCpCommand.operationId,
        buildCpCommandPayload(activeCpCommand, {
          text_action: 'DeleteSelected',
          text_ids: oristudioCpSelection.texts,
        })
      );
      if (succeeded) {
        setOristudioCpSelection(emptyOristudioCpSelection());
      }
      setCpToolState((state) =>
        state.activeOperationId === activeCpCommand.operationId
          ? transitionOristudioCpToolState(
              state,
              succeeded
                ? { type: 'commit', keepActive: true }
                : {
                    type: 'commandError',
                    message: useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                  }
            )
          : state
      );
    })();
  }, [
    activeCpCommand,
    buildCpCommandPayload,
    editableCp,
    executeOristudioCpCommand,
    oristudioCpSelection.texts,
    setOristudioCpSelection,
  ]);

  const eventToEditableModelPoint = useCallback(
    (event: Pick<PointerEvent<Element>, 'clientX' | 'clientY'>): Point | null => {
      const svg = svgRef.current;
      if (!svg || !editableCp) return null;
      const bounds = svg.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return null;
      const svgPoint = {
        x: cpCanvasRect.x + ((event.clientX - bounds.left) / bounds.width) * cpCanvasRect.width,
        y: cpCanvasRect.y + ((event.clientY - bounds.top) / bounds.height) * cpCanvasRect.height,
      };
      return cpSvgPointToModel(svgPoint, editableCpBounds);
    },
    [cpCanvasRect, editableCp, editableCpBounds]
  );

  const resolveEditableToolPoint = useCallback(
    (event: PointerEvent<SVGElement>, preferPointSnap = false): Point | null => {
      if (!editableCp) return null;
      const modelPoint = eventToEditableModelPoint(event);
      if (!modelPoint) return null;
      const selectionDistance = modelSelectionDistance(editableCpBounds, zoomPercent / 100);
      const target = preferPointSnap
        ? nearestOrieditaDrawPointTarget(
            editableCp,
            modelPoint,
            editableCpBounds,
            oristudioCpViewport,
            selectionDistance
          )
        : nearestCpSnapTarget(
            editableCp,
            modelPoint,
            editableCpBounds,
            oristudioCpViewport,
            selectionDistance
          );
      return target?.point ?? modelPoint;
    },
    [editableCp, editableCpBounds, eventToEditableModelPoint, oristudioCpViewport, zoomPercent]
  );

  const resolveEditableDrawPoint = useCallback(
    (
      event: PointerEvent<SVGElement>,
      requireSnap: boolean
    ): { point: Point; target: CpSnapTarget | null } | null => {
      if (!editableCp) return null;
      const modelPoint = eventToEditableModelPoint(event);
      if (!modelPoint) return null;
      const target = nearestOrieditaDrawPointTarget(
        editableCp,
        modelPoint,
        editableCpBounds,
        oristudioCpViewport,
        modelSelectionDistance(editableCpBounds, zoomPercent / 100)
      );
      if (!target && requireSnap) return null;
      return { point: target?.point ?? modelPoint, target };
    },
    [editableCp, editableCpBounds, eventToEditableModelPoint, oristudioCpViewport, zoomPercent]
  );

  const handleSelectionTransform = useCallback(
    (transform: CpSelectionTransform) => {
      const resolvedTransform =
        transform.kind === 'rotate' && !transform.center && selectionTransformFrame
          ? { ...transform, center: selectionTransformFrame.center }
          : transform;
      void transformOristudioCpSelection(resolvedTransform).then((succeeded) => {
        if (succeeded && resolvedTransform.kind === 'rotate') {
          setSelectionTransformAngleDegrees((current) =>
            normalizeSelectionTransformAngle(current + resolvedTransform.angleDegrees)
          );
        }
      });
    },
    [selectionTransformFrame, transformOristudioCpSelection]
  );

  const updateSelectionRotationPreview = useCallback(
    (drag: CpSelectionRotationDrag, point: Point, snap: boolean) => {
      const rawAngle =
        rotationAngleFromCenter(drag.center, point) - drag.startAngleDegrees;
      const angleDegrees = snap ? snapRotationDegrees(rawAngle) : rawAngle;
      const segments = transformCpLineSegments(drag.sourceLines, {
        kind: 'rotate',
        angleDegrees,
        center: drag.center,
      });
      const frame = cpLineSelectionFrame(
        segments,
        selectionTransformAngleDegrees + angleDegrees
      );
      drag.currentAngleDegrees = angleDegrees;
      if (frame) {
        setSelectionRotationPreview({ kind: 'rotate', angleDegrees, segments, frame });
      }
    },
    [selectionTransformAngleDegrees]
  );

  const selectionMoveSnapDocument = useMemo<OristudioCpDocumentSnapshot | null>(() => {
    if (!editableCp || oristudioCpSelection.lines.length === 0) return null;
    const selectedLineIds = new Set(oristudioCpSelection.lines);
    return {
      ...editableCp,
      crease_pattern: {
        ...editableCp.crease_pattern,
        line_segments: editableCp.crease_pattern.line_segments.filter(
          (_line, index) => !selectedLineIds.has(index + 1)
        ),
      },
    };
  }, [editableCp, oristudioCpSelection.lines]);

  const updateSelectionMovePreview = useCallback(
    (drag: CpSelectionMoveDrag, point: Point) => {
      const rawDelta = {
        x: point.x - drag.startPoint.x,
        y: point.y - drag.startPoint.y,
      };
      let delta = rawDelta;
      let snappedTarget: CpSnapTarget | null = null;
      const snappingEnabled =
        oristudioCpViewport.snapToGrid ||
        oristudioCpViewport.snapToVertices ||
        oristudioCpViewport.snapToLines;

      if (selectionMoveSnapDocument && snappingEnabled) {
        const translated = translateCpLineSegments(drag.sourceLines, rawDelta);
        const anchorPoints = cpLineSelectionMoveAnchorPoints(
          translated,
          selectionTransformAngleDegrees
        );
        const maxDistance = modelSelectionDistance(editableCpBounds, zoomPercent / 100);
        let best:
          | {
              target: CpSnapTarget;
              anchorPoint: Point;
            }
          | null = null;
        for (const anchorPoint of anchorPoints) {
          const target = nearestCpSnapTarget(
            selectionMoveSnapDocument,
            anchorPoint,
            editableCpBounds,
            oristudioCpViewport,
            maxDistance
          );
          if (!target) continue;
          if (!best || target.distance < best.target.distance) {
            best = { target, anchorPoint };
          }
        }
        if (best) {
          snappedTarget = best.target;
          delta = {
            x: rawDelta.x + best.target.point.x - best.anchorPoint.x,
            y: rawDelta.y + best.target.point.y - best.anchorPoint.y,
          };
        }
      }

      const segments = translateCpLineSegments(drag.sourceLines, delta);
      const frame = cpLineSelectionFrame(segments, selectionTransformAngleDegrees);
      drag.currentDelta = delta;
      setCursorModelPoint(point);
      setSnapTarget(snappedTarget);
      if (frame) {
        setSelectionRotationPreview({
          kind: 'translate',
          delta,
          snapLabel: snappedTarget?.label ?? null,
          segments,
          frame,
        });
      }
    },
    [
      editableCpBounds,
      oristudioCpViewport,
      selectionMoveSnapDocument,
      selectionTransformAngleDegrees,
      zoomPercent,
    ]
  );

  const updateSelectionResizePreview = useCallback(
    (drag: CpSelectionResizeDrag, point: Point) => {
      const transform = resizeTransformForPoint(
        drag.frame,
        drag.handle,
        point,
        modelSelectionDistance(editableCpBounds, zoomPercent / 100) / 2
      );
      const segments = scaleCpLineSegments(
        drag.sourceLines,
        transform.frame,
        transform.anchor,
        transform.scaleX,
        transform.scaleY
      );
      const frame = cpLineSelectionFrame(segments, drag.frame.angleDegrees);
      drag.currentTransform = transform;
      setCursorModelPoint(point);
      setSnapTarget(null);
      if (frame) {
        setSelectionRotationPreview({
          kind: 'scale',
          scaleX: transform.scaleX,
          scaleY: transform.scaleY,
          segments,
          frame,
        });
      }
    },
    [editableCpBounds, zoomPercent]
  );

  const handleSelectionRotatePointerDown = useCallback(
    (event: PointerEvent<Element>) => {
      if (event.button !== 0 || spacePressed || !editableCp || selectedEditableCpLines.length === 0) {
        return;
      }
      const frame = selectionTransformFrame;
      const point = eventToEditableModelPoint(event);
      if (!frame || !point) return;
      event.preventDefault();
      event.stopPropagation();
      selectionRotateDragRef.current = {
        pointerId: event.pointerId,
        center: frame.center,
        startAngleDegrees: rotationAngleFromCenter(frame.center, point),
        sourceLines: selectedEditableCpLines,
        currentAngleDegrees: 0,
      };
      svgRef.current?.setPointerCapture?.(event.pointerId);
      setSelectionRotationPreview({
        kind: 'rotate',
        angleDegrees: 0,
        segments: selectedEditableCpLines,
        frame,
      });
    },
    [editableCp, eventToEditableModelPoint, selectedEditableCpLines, selectionTransformFrame, spacePressed]
  );

  const handleSelectionMovePointerDown = useCallback(
    (event: PointerEvent<Element>) => {
      if (event.button !== 0 || spacePressed || !editableCp || selectedEditableCpLines.length === 0) {
        return;
      }
      const frame = selectionTransformFrame;
      const point = eventToEditableModelPoint(event);
      if (!frame || !point) return;
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        const lineId = nearestEditableCpLineId(
          editableCp,
          point,
          modelSelectionDistance(editableCpBounds, zoomPercent / 100)
        );
        if (lineId !== null) {
          event.preventDefault();
          event.stopPropagation();
          toggleOristudioCpLineSelection(lineId, true);
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectionMoveDragRef.current = {
        pointerId: event.pointerId,
        startPoint: point,
        sourceLines: selectedEditableCpLines,
        currentDelta: { x: 0, y: 0 },
      };
      svgRef.current?.setPointerCapture?.(event.pointerId);
      setSelectionRotationPreview({
        kind: 'translate',
        delta: { x: 0, y: 0 },
        snapLabel: null,
        segments: selectedEditableCpLines,
        frame,
      });
    },
    [
      editableCp,
      editableCpBounds,
      eventToEditableModelPoint,
      selectedEditableCpLines,
      selectionTransformFrame,
      spacePressed,
      toggleOristudioCpLineSelection,
      zoomPercent,
    ]
  );

  const handleSelectionResizePointerDown = useCallback(
    (handle: CpSelectionResizeHandle, event: PointerEvent<Element>) => {
      if (event.button !== 0 || spacePressed || !editableCp || selectedEditableCpLines.length === 0) {
        return;
      }
      const frame = selectionTransformFrame;
      const point = eventToEditableModelPoint(event);
      if (!frame || !point) return;
      event.preventDefault();
      event.stopPropagation();
      const transform = resizeTransformForPoint(
        frame,
        handle,
        point,
        modelSelectionDistance(editableCpBounds, zoomPercent / 100) / 2
      );
      selectionResizeDragRef.current = {
        pointerId: event.pointerId,
        frame,
        handle,
        sourceLines: selectedEditableCpLines,
        currentTransform: transform,
      };
      svgRef.current?.setPointerCapture?.(event.pointerId);
      setSelectionRotationPreview({
        kind: 'scale',
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
        segments: selectedEditableCpLines,
        frame,
      });
    },
    [
      editableCp,
      editableCpBounds,
      eventToEditableModelPoint,
      selectedEditableCpLines,
      selectionTransformFrame,
      spacePressed,
      zoomPercent,
    ]
  );

  const updateEditablePointerStatus = useCallback(
    (event: PointerEvent<SVGElement>) => {
      if (!editableCp) return;
      const modelPoint = eventToEditableModelPoint(event);
      setCursorModelPoint(modelPoint);
      if (modelPoint && activeCpInputMode === 'drag-line') {
        setSnapTarget(
          nearestOrieditaDrawPointTarget(
            editableCp,
            modelPoint,
            editableCpBounds,
            oristudioCpViewport,
            modelSelectionDistance(editableCpBounds, zoomPercent / 100)
          )
        );
        return;
      }
      const preferPointSnap =
        activeCpCommand && shouldPreferPointSnapForStep(activeCpCommand, cpToolPoints.length);
      setSnapTarget(
        modelPoint
          ? preferPointSnap
            ? nearestOrieditaDrawPointTarget(
                editableCp,
                modelPoint,
                editableCpBounds,
                oristudioCpViewport,
                modelSelectionDistance(editableCpBounds, zoomPercent / 100)
              )
            : nearestCpSnapTarget(
                editableCp,
                modelPoint,
                editableCpBounds,
                oristudioCpViewport,
                modelSelectionDistance(editableCpBounds, zoomPercent / 100)
              )
          : null
      );
    },
    [
      activeCpCommand,
      activeCpInputMode,
      cpToolPoints.length,
      editableCp,
      editableCpBounds,
      eventToEditableModelPoint,
      oristudioCpViewport,
      zoomPercent,
    ]
  );

  const handleEditableToolPointerDown = useCallback(
    (event: PointerEvent<SVGElement>) => {
      if (event.button === 0 && !spacePressed && editableCp && cpSymmetryAxisPickPoints) {
        const point = resolveEditableToolPoint(event, true);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        setActiveEditingSurface('crease-pattern');
        if (cpSymmetryAxisPickPoints.length === 0) {
          setCpSymmetryAxisPickPoints([point]);
          setOristudioCpSymmetry({ showAxis: true, preset: 'custom' });
          return;
        }
        const axis = axisFromTwoPoints(cpSymmetryAxisPickPoints[0], point);
        if (!axis) return;
        setCpSymmetryAxisPickPoints(null);
        setOristudioCpSymmetry({
          enabled: true,
          showAxis: true,
          preset: 'custom',
          axis,
        });
        return;
      }

      if (
        event.button !== 0 ||
        spacePressed ||
        isViewportInteractiveTarget(event.target) ||
        isCpSelectionTransformEventTarget(event.target) ||
        !editableCp ||
        !activeCpCommand ||
        activeCpCommand.uiStatus !== 'ready' ||
        cpToolState.phase !== 'active'
      ) {
        return;
      }
      const stepCount = activeCpCommand.toolSteps?.length ?? 0;
      if (
        stepCount === 0 &&
        isCircleTangentPointOperation(activeCpCommand.operationId) &&
        oristudioCpSelection.circles.length === 1
      ) {
        const point = resolveEditableToolPoint(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        void (async () => {
          const succeeded = await executeOristudioCpCommand(
            activeCpCommand.operationId,
            buildCpCommandPayload(activeCpCommand, {
              circle_ids: oristudioCpSelection.circles,
              points: [point],
            })
          );
          setCpToolState((state) =>
            state.activeOperationId === activeCpCommand.operationId
              ? transitionOristudioCpToolState(
                  state,
                  succeeded
                    ? { type: 'commit', keepActive: true }
                    : {
                        type: 'commandError',
                        message:
                          useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                      }
                )
              : state
          );
        })();
        return;
      }
      if (stepCount === 0) return;
      if (
        isLineClickSelectionOperation(activeCpCommand.operationId) &&
        isCpLineEventTarget(event.target)
      ) {
        return;
      }
      if (
        isReflectSelectionOperation(activeCpCommand.operationId) &&
        cpToolPoints.length === 0 &&
        isCpLineEventTarget(event.target)
      ) {
        return;
      }
      if (isLengthenCreaseOperation(activeCpCommand.operationId)) {
        if (isCpLineEventTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        isSquareBisectorOperation(activeCpCommand.operationId) &&
        isCpLineEventTarget(event.target) &&
        (cpToolPoints.length === 0 || pendingSquareBisectorLineIds.length > 0)
      ) {
        return;
      }
      if (
        isSquareBisectorOperation(activeCpCommand.operationId) &&
        pendingSquareBisectorLineIds.length > 0
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        allowsDirectEntitySelection(activeCpCommand.operationId) &&
        isCpSelectableEntityEventTarget(event.target)
      ) {
        return;
      }

      if (isTextAnnotationOperation(activeCpCommand.operationId)) {
        const point = eventToEditableModelPoint(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        const textId = cpTextIdFromEventTarget(event.target);
        if (textId) {
          const text = editableCp.crease_pattern.texts[textId - 1];
          setOristudioCpSelection({ ...emptyOristudioCpSelection(), texts: [textId] });
          if (text) {
            setCpToolOptions((current) => ({ ...current, textContent: text.text }));
          }
          cpToolDragRef.current = {
            operationId: activeCpCommand.operationId,
            actionId: activeCpAction?.kind === 'command' ? activeCpAction.id : null,
            mode: 'text-drag',
            pointerId: event.pointerId,
            points: [point],
            textId,
          };
          if (typeof event.pointerId === 'number') {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }
          return;
        }

        void (async () => {
          const previousTextCount = editableCp.crease_pattern.texts.length;
          const succeeded = await executeOristudioCpCommand(
            activeCpCommand.operationId,
            buildCpCommandPayload(activeCpCommand, {
              text_action: 'Create',
              text_content: cpToolOptions.textContent,
              points: [point],
            })
          );
          if (succeeded) {
            const nextTextCount =
              useWorkspaceStore.getState().oristudioCpDocument?.document.crease_pattern.texts
                .length ?? previousTextCount;
            if (nextTextCount > previousTextCount) {
              setOristudioCpSelection({
                ...emptyOristudioCpSelection(),
                texts: [nextTextCount],
              });
            }
          }
          setCpToolState((state) =>
            state.activeOperationId === activeCpCommand.operationId
              ? transitionOristudioCpToolState(
                  state,
                  succeeded
                    ? { type: 'commit', keepActive: true }
                    : {
                        type: 'commandError',
                        message:
                          useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                      }
                )
              : state
          );
        })();
        return;
      }

      if (isVariablePointSequenceOperation(activeCpCommand.operationId)) {
        const point = eventToEditableModelPoint(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        setCpToolPoints((current) => [...current, point]);
        setCpToolState((state) =>
          state.activeOperationId === activeCpCommand.operationId
            ? transitionOristudioCpToolState(state, { type: 'advanceStep' })
            : state
        );
        return;
      }

      if (activeCpInputMode === 'drag-line') {
        const resolved = resolveEditableDrawPoint(
          event,
          isRestrictedDrawOperation(activeCpCommand.operationId)
        );
        if (!resolved) return;
        event.preventDefault();
        event.stopPropagation();
        cpToolDragRef.current = {
          operationId: activeCpCommand.operationId,
          actionId: activeCpAction?.kind === 'command' ? activeCpAction.id : null,
          mode: 'drag-line',
          pointerId: event.pointerId,
          points: [resolved.point],
        };
        if (typeof event.pointerId === 'number') {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        setSnapTarget(resolved.target);
        setCpToolPoints([resolved.point]);
        setCpToolPath([resolved.point]);
        return;
      }

      if (activeCpInputMode === 'drag-box') {
        const point = eventToEditableModelPoint(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        cpToolDragRef.current = {
          operationId: activeCpCommand.operationId,
          actionId: activeCpAction?.kind === 'command' ? activeCpAction.id : null,
          mode: 'drag-box',
          pointerId: event.pointerId,
          points: [point],
          replaceSelection: !(event.shiftKey || event.metaKey || event.ctrlKey),
        };
        if (typeof event.pointerId === 'number') {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        setCpToolPoints([point]);
        setCpToolPath([point]);
        return;
      }

      if (activeCpInputMode === 'drag-path') {
        const point = eventToEditableModelPoint(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        cpToolDragRef.current = {
          operationId: activeCpCommand.operationId,
          actionId: activeCpAction?.kind === 'command' ? activeCpAction.id : null,
          mode: 'drag-path',
          pointerId: event.pointerId,
          points: [point],
        };
        if (typeof event.pointerId === 'number') {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        setCpToolPath([point]);
        return;
      }

      const point = resolveEditableToolPoint(
        event,
        shouldPreferPointSnapForStep(activeCpCommand, cpToolPoints.length)
      );
      if (!point) return;

      event.preventDefault();
      event.stopPropagation();
      const nextPoints = [...cpToolPoints, point];

      if (nextPoints.length < stepCount) {
        setCpToolPoints(nextPoints);
        setCpToolState((state) =>
          state.activeOperationId === activeCpCommand.operationId
            ? transitionOristudioCpToolState(state, { type: 'advanceStep' })
            : state
        );
        return;
      }

      const measurementSlot = cpMeasurementSlotForOperation(activeCpCommand.operationId);
      if (measurementSlot) {
        const value = computeCpMeasurementValue(activeCpCommand.operationId, nextPoints);
        if (value === null) return;
        setCpMeasurementSlots((current) => ({
          ...current,
          [measurementSlot]: value,
        }));
        setCpToolPoints([]);
        setCpToolState((state) =>
          state.activeOperationId === activeCpCommand.operationId
            ? transitionOristudioCpToolState(state, { type: 'commit', keepActive: true })
            : state
        );
        return;
      }

      setCpToolPoints([]);
      void (async () => {
        const succeeded = await executeOristudioCpCommand(
          activeCpCommand.operationId,
          buildCpCommandPayload(activeCpCommand, {
            line_ids: oristudioCpSelection.lines,
            circle_ids: oristudioCpSelection.circles,
            points: nextPoints,
          })
        );
        setCpToolState((state) =>
          state.activeOperationId === activeCpCommand.operationId
            ? transitionOristudioCpToolState(
                state,
                succeeded
                  ? { type: 'commit', keepActive: true }
                  : {
                      type: 'commandError',
                      message: useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                    }
              )
            : state
        );
      })();
    },
    [
      activeCpAction,
      activeCpCommand,
      activeCpInputMode,
      buildCpCommandPayload,
      cpSymmetryAxisPickPoints,
      cpToolPoints,
      cpToolOptions.textContent,
      cpToolState.phase,
      editableCp,
      eventToEditableModelPoint,
      executeOristudioCpCommand,
      oristudioCpSelection.circles,
      oristudioCpSelection.lines,
      pendingSquareBisectorLineIds.length,
      resolveEditableDrawPoint,
      resolveEditableToolPoint,
      setActiveEditingSurface,
      setOristudioCpSymmetry,
      setOristudioCpSelection,
      spacePressed,
    ]
  );

  const handleEditablePointerMove = useCallback(
    (event: PointerEvent<SVGElement>) => {
      const selectionRotateDrag = selectionRotateDragRef.current;
      if (selectionRotateDrag && selectionRotateDrag.pointerId === event.pointerId) {
        const point = eventToEditableModelPoint(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        updateSelectionRotationPreview(selectionRotateDrag, point, event.shiftKey);
        return;
      }
      const selectionMoveDrag = selectionMoveDragRef.current;
      if (selectionMoveDrag && selectionMoveDrag.pointerId === event.pointerId) {
        const point = eventToEditableModelPoint(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        updateSelectionMovePreview(selectionMoveDrag, point);
        return;
      }
      const selectionResizeDrag = selectionResizeDragRef.current;
      if (selectionResizeDrag && selectionResizeDrag.pointerId === event.pointerId) {
        const point = eventToEditableModelPoint(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        updateSelectionResizePreview(selectionResizeDrag, point);
        return;
      }
      updateEditablePointerStatus(event);
      const drag = cpToolDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.mode === 'text-drag') {
        const point = eventToEditableModelPoint(event);
        const startPoint = drag.points[0];
        if (!point || !startPoint) return;
        drag.points = [startPoint, point];
        return;
      }
      if (drag.mode === 'drag-line') {
        const resolved = resolveEditableDrawPoint(event, false);
        const startPoint = drag.points[0];
        if (!resolved || !startPoint) return;
        drag.points = [startPoint, resolved.point];
        setSnapTarget(resolved.target);
        setCpToolPath(drag.points);
        return;
      }
      if (drag.mode === 'drag-box') {
        const point = eventToEditableModelPoint(event);
        const startPoint = drag.points[0];
        if (!point || !startPoint) return;
        drag.points = [startPoint, point];
        setCpToolPath(drag.points);
        return;
      }
      const point = eventToEditableModelPoint(event);
      if (!point) return;
      const last = drag.points.at(-1);
      if (
        last &&
        pointDistanceSquared(last, point) <
          modelSelectionDistance(editableCpBounds, zoomPercent / 100) ** 2 / 16
      ) {
        return;
      }
      drag.points = [...drag.points, point];
      setCpToolPath(drag.points);
    },
    [
      editableCpBounds,
      eventToEditableModelPoint,
      resolveEditableDrawPoint,
      updateSelectionMovePreview,
      updateSelectionResizePreview,
      updateSelectionRotationPreview,
      updateEditablePointerStatus,
      zoomPercent,
    ]
  );

  const finishEditableDragPath = useCallback(
    (event: PointerEvent<SVGElement>) => {
      const selectionRotateDrag = selectionRotateDragRef.current;
      if (selectionRotateDrag && selectionRotateDrag.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        const point = eventToEditableModelPoint(event);
        if (point) {
          updateSelectionRotationPreview(selectionRotateDrag, point, event.shiftKey);
        }
        const angleDegrees = selectionRotateDrag.currentAngleDegrees;
        selectionRotateDragRef.current = null;
        setSelectionRotationPreview(null);
        svgRef.current?.releasePointerCapture?.(event.pointerId);
        if (Math.abs(angleDegrees) > 0.001) {
          void transformOristudioCpSelection({
            kind: 'rotate',
            angleDegrees,
            center: selectionRotateDrag.center,
          }).then((succeeded) => {
            if (succeeded) {
              setSelectionTransformAngleDegrees((current) =>
                normalizeSelectionTransformAngle(current + angleDegrees)
              );
            }
          });
        }
        return;
      }
      const selectionMoveDrag = selectionMoveDragRef.current;
      if (selectionMoveDrag && selectionMoveDrag.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        const point = eventToEditableModelPoint(event);
        if (point) {
          updateSelectionMovePreview(selectionMoveDrag, point);
        }
        const delta = selectionMoveDrag.currentDelta;
        selectionMoveDragRef.current = null;
        setSelectionRotationPreview(null);
        setSnapTarget(null);
        svgRef.current?.releasePointerCapture?.(event.pointerId);
        if (pointDistanceSquared({ x: 0, y: 0 }, delta) > 1e-10) {
          void transformOristudioCpSelection({ kind: 'translate', delta });
        }
        return;
      }
      const selectionResizeDrag = selectionResizeDragRef.current;
      if (selectionResizeDrag && selectionResizeDrag.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        const point = eventToEditableModelPoint(event);
        if (point) {
          updateSelectionResizePreview(selectionResizeDrag, point);
        }
        const transform = selectionResizeDrag.currentTransform;
        selectionResizeDragRef.current = null;
        setSelectionRotationPreview(null);
        setSnapTarget(null);
        svgRef.current?.releasePointerCapture?.(event.pointerId);
        if (
          transform &&
          (Math.abs(transform.scaleX - 1) > 0.001 || Math.abs(transform.scaleY - 1) > 0.001)
        ) {
          void transformOristudioCpSelection(transform);
        }
        return;
      }
      const drag = cpToolDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const command = cpCommandByOperation(drag.operationId);
      if (!command) {
        cpToolDragRef.current = null;
        setCpToolPath([]);
        setCpToolPoints([]);
        return;
      }
      const finalResolution =
        drag.mode === 'drag-line'
          ? resolveEditableDrawPoint(event, isRestrictedDrawOperation(drag.operationId))
          : null;
      const finalPoint =
        drag.mode === 'drag-line' ? finalResolution?.point : eventToEditableModelPoint(event);
      const points =
        drag.mode === 'drag-line'
          ? drag.points[0] && finalPoint
            ? [drag.points[0], finalPoint]
            : drag.points.slice(0, 1)
          : finalPoint &&
              !drag.points.some((point) => pointDistanceSquared(point, finalPoint) < 1e-12)
            ? [...drag.points, finalPoint]
            : drag.points;
      cpToolDragRef.current = null;
      if (typeof event.pointerId === 'number') {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
      if (drag.mode === 'text-drag') {
        const [startPoint, endPoint] = drag.points;
        if (
          !drag.textId ||
          !startPoint ||
          !endPoint ||
          pointDistanceSquared(startPoint, endPoint) <
            modelSelectionDistance(editableCpBounds, zoomPercent / 100) ** 2 / 16
        ) {
          return;
        }

        void (async () => {
          const succeeded = await executeOristudioCpCommand(
            command.operationId,
            buildCpCommandPayload(command, {
              text_action: 'Move',
              text_ids: [drag.textId as number],
              points: [startPoint, endPoint],
            })
          );
          setCpToolState((state) =>
            state.activeOperationId === command.operationId
              ? transitionOristudioCpToolState(
                  state,
                  succeeded
                    ? { type: 'commit', keepActive: true }
                    : {
                        type: 'commandError',
                        message:
                          useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                      }
                )
              : state
          );
        })();
        return;
      }
      setCpToolPath([]);
      setCpToolPoints([]);
      if (points.length < 2) {
        setCpToolState((state) =>
          state.activeOperationId === command.operationId
            ? transitionOristudioCpToolState(state, {
                type: 'cancel',
                keepActive: drag.mode === 'drag-line' || drag.mode === 'drag-box',
              })
            : state
        );
        return;
      }

      void (async () => {
        const succeeded = await executeOristudioCpCommand(
          command.operationId,
          buildCpCommandPayload(command, {
            line_ids: oristudioCpSelection.lines,
            circle_ids: oristudioCpSelection.circles,
            points,
            replace_selection:
              drag.operationId === 'CreaseSelect' ? drag.replaceSelection : undefined,
          })
        );
        setCpToolState((state) =>
          state.activeOperationId === command.operationId
            ? transitionOristudioCpToolState(
                state,
                succeeded
                  ? {
                      type: 'commit',
                      keepActive: true,
                    }
                  : {
                      type: 'commandError',
                      message: useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                    }
              )
            : state
        );
      })();
    },
    [
      buildCpCommandPayload,
      editableCpBounds,
      eventToEditableModelPoint,
      executeOristudioCpCommand,
      oristudioCpSelection.circles,
      oristudioCpSelection.lines,
      resolveEditableDrawPoint,
      transformOristudioCpSelection,
      updateSelectionMovePreview,
      updateSelectionResizePreview,
      updateSelectionRotationPreview,
      zoomPercent,
    ]
  );

  const cancelEditableDragPath = useCallback((event: PointerEvent<SVGElement>) => {
    const selectionRotateDrag = selectionRotateDragRef.current;
    if (selectionRotateDrag && selectionRotateDrag.pointerId === event.pointerId) {
      selectionRotateDragRef.current = null;
      setSelectionRotationPreview(null);
      svgRef.current?.releasePointerCapture?.(event.pointerId);
      return;
    }
    const selectionMoveDrag = selectionMoveDragRef.current;
    if (selectionMoveDrag && selectionMoveDrag.pointerId === event.pointerId) {
      selectionMoveDragRef.current = null;
      setSelectionRotationPreview(null);
      setSnapTarget(null);
      svgRef.current?.releasePointerCapture?.(event.pointerId);
      return;
    }
    const selectionResizeDrag = selectionResizeDragRef.current;
    if (selectionResizeDrag && selectionResizeDrag.pointerId === event.pointerId) {
      selectionResizeDragRef.current = null;
      setSelectionRotationPreview(null);
      setSnapTarget(null);
      svgRef.current?.releasePointerCapture?.(event.pointerId);
      return;
    }
    const drag = cpToolDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    cpToolDragRef.current = null;
    setCpToolPoints([]);
    setCpToolPath([]);
  }, []);

  const handleEditableLineClick = useCallback(
    (id: number, additive = false) => {
      if (
        activeCpCommand?.uiStatus === 'ready' &&
        cpToolState.phase === 'active' &&
        isReflectSelectionOperation(activeCpCommand.operationId) &&
        cpToolPoints.length === 0
      ) {
        const axis = editableCp?.crease_pattern.line_segments[id - 1];
        if (!axis) return;
        setCpToolPoints([]);
        setCpToolPath([]);
        void (async () => {
          const succeeded = await executeOristudioCpCommand(
            activeCpCommand.operationId,
            buildCpCommandPayload(activeCpCommand, {
              line_ids: oristudioCpSelection.lines,
              points: [axis.a, axis.b],
            })
          );
          setCpToolState((state) =>
            state.activeOperationId === activeCpCommand.operationId
              ? transitionOristudioCpToolState(
                  state,
                  succeeded
                    ? { type: 'commit', keepActive: true }
                    : {
                        type: 'commandError',
                        message:
                          useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                      }
                )
              : state
          );
        })();
        return;
      }

      if (
        activeCpCommand?.uiStatus === 'ready' &&
        cpToolState.phase === 'active' &&
        isLengthenCreaseOperation(activeCpCommand.operationId)
      ) {
        setCpToolPoints([]);
        setCpToolPath([]);
        if (pendingLengthenLineId === null) {
          setPendingLengthenLineId(id);
          setCpToolState((state) =>
            state.activeOperationId === activeCpCommand.operationId
              ? transitionOristudioCpToolState(state, { type: 'advanceStep' })
              : state
          );
          return;
        }

        const lineIds = [pendingLengthenLineId, id];
        setPendingLengthenLineId(null);
        void (async () => {
          const succeeded = await executeOristudioCpCommand(
            activeCpCommand.operationId,
            buildCpCommandPayload(activeCpCommand, {
              line_ids: lineIds,
            })
          );
          setCpToolState((state) =>
            state.activeOperationId === activeCpCommand.operationId
              ? transitionOristudioCpToolState(
                  state,
                  succeeded
                    ? { type: 'commit', keepActive: true }
                    : {
                        type: 'commandError',
                        message: useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                      }
                )
              : state
          );
        })();
        return;
      }

      if (
        activeCpCommand?.operationId === 'CreaseSelect' &&
        isDefaultSelectionMode(
          {
            activeOperationId: activeCpCommand.operationId,
            phase: cpToolState.phase,
          },
          cpToolPoints.length,
          cpToolPath.length
        )
      ) {
        toggleOristudioCpLineSelection(id, additive);
        return;
      }

      if (
        activeCpCommand?.uiStatus === 'ready' &&
        cpToolState.phase === 'active' &&
        isLineClickSelectionOperation(activeCpCommand.operationId)
      ) {
        setCpToolPoints([]);
        setCpToolPath([]);
        void (async () => {
          const succeeded = await executeOristudioCpCommand(
            activeCpCommand.operationId,
            buildCpCommandPayload(activeCpCommand, {
              line_ids: [id],
              replace_selection:
                activeCpCommand.operationId === 'CreaseSelect' ? !additive : undefined,
            })
          );
          setCpToolState((state) =>
            state.activeOperationId === activeCpCommand.operationId
              ? transitionOristudioCpToolState(
                  state,
                  succeeded
                    ? {
                        type: 'commit',
                        keepActive: isLineClickSelectionOperation(activeCpCommand.operationId),
                      }
                    : {
                        type: 'commandError',
                        message: useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                      }
                )
              : state
          );
        })();
        return;
      }

      if (
        activeCpCommand?.uiStatus === 'ready' &&
        cpToolState.phase === 'active' &&
        isSquareBisectorOperation(activeCpCommand.operationId) &&
        cpToolPoints.length === 0
      ) {
        setCpToolPath([]);
        if (pendingSquareBisectorLineIds.length < 2) {
          if (pendingSquareBisectorLineIds.includes(id)) return;
          setPendingSquareBisectorLineIds((current) => [...current, id]);
          setCpToolState((state) =>
            state.activeOperationId === activeCpCommand.operationId
              ? transitionOristudioCpToolState(state, { type: 'advanceStep' })
              : state
          );
          return;
        }

        const lineIds = [...pendingSquareBisectorLineIds, id];
        setPendingSquareBisectorLineIds([]);
        void (async () => {
          const succeeded = await executeOristudioCpCommand(
            activeCpCommand.operationId,
            buildCpCommandPayload(activeCpCommand, {
              line_ids: lineIds,
            })
          );
          setCpToolState((state) =>
            state.activeOperationId === activeCpCommand.operationId
              ? transitionOristudioCpToolState(
                  state,
                  succeeded
                    ? { type: 'commit', keepActive: true }
                    : {
                        type: 'commandError',
                        message: useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                      }
                )
              : state
          );
        })();
        return;
      }

      if (cpToolState.phase === 'active') return;
      toggleOristudioCpLineSelection(id, additive);
    },
    [
      activeCpCommand,
      buildCpCommandPayload,
      cpToolPoints.length,
      cpToolPath.length,
      cpToolState.phase,
      editableCp,
      executeOristudioCpCommand,
      oristudioCpSelection.lines,
      pendingLengthenLineId,
      pendingSquareBisectorLineIds,
      toggleOristudioCpLineSelection,
    ]
  );

  const handleEditableVertexClick = useCallback(
    (id: string, additive = false) => {
      if (
        cpToolState.phase === 'active' &&
        !allowsDirectEntitySelection(activeCpCommand?.operationId)
      ) {
        return;
      }
      toggleOristudioCpVertexSelection(id, additive);
    },
    [activeCpCommand?.operationId, cpToolState.phase, toggleOristudioCpVertexSelection]
  );

  const handleEditablePointClick = useCallback(
    (id: number, additive = false) => {
      if (
        cpToolState.phase === 'active' &&
        !allowsDirectEntitySelection(activeCpCommand?.operationId)
      ) {
        return;
      }
      toggleOristudioCpPointSelection(id, additive);
    },
    [activeCpCommand?.operationId, cpToolState.phase, toggleOristudioCpPointSelection]
  );

  const handleEditableCircleClick = useCallback(
    (id: number, additive = false) => {
      if (
        cpToolState.phase === 'active' &&
        !allowsDirectEntitySelection(activeCpCommand?.operationId)
      ) {
        return;
      }
      toggleOristudioCpCircleSelection(id, additive);
    },
    [activeCpCommand?.operationId, cpToolState.phase, toggleOristudioCpCircleSelection]
  );

  const handleEditableTextClick = useCallback(
    (id: number, additive = false) => {
      if (
        cpToolState.phase === 'active' &&
        !allowsDirectEntitySelection(activeCpCommand?.operationId)
      ) {
        return;
      }
      toggleOristudioCpTextSelection(id, additive);
    },
    [activeCpCommand?.operationId, cpToolState.phase, toggleOristudioCpTextSelection]
  );

  const clearSelectionOnBackgroundPointerDown = (event: PointerEvent<SVGElement>) => {
    if (event.button !== 0 || spacePressed) return;
    if (editableCp && editableSelectionSize > 0) {
      clearOristudioCpSelection();
      return;
    }
    if (selectionSize(selection) === 0) return;
    select({ kind: 'tree' });
  };
  const emptyStatusLabel =
    status === 'building_crease_pattern'
      ? 'Building crease pattern'
      : status === 'optimizing'
        ? 'Optimizing scale'
        : status === 'error' && error
          ? shortStatus(error.message)
          : documentMode === 'crease-pattern'
            ? 'No imported crease pattern'
            : 'No crease pattern';
  const sourceLabel =
    editableCp && oristudioCpLineage?.kind === 'generated-from-tree'
      ? [
          cpLineageStatusLabel(oristudioCpLineage),
          editableCpSummary ? `${editableCpSummary.line_segments} lines` : null,
          oristudioCpLineage.stale ? 'Rebuild CP to resync with design' : null,
        ]
          .filter(Boolean)
          .join(' | ')
      : documentMode === 'crease-pattern' && importedCreasePattern
      ? [
          importedCreasePattern.source.filename,
          importedCreasePattern.lineOnly ? 'View only' : 'Simulatable',
          oristudioCpDocument
            ? `Editable kernel: ${oristudioCpDocument.summary.line_segments} lines`
            : oristudioCpError
              ? `Kernel unavailable: ${shortStatus(oristudioCpError)}`
              : 'Editable kernel pending',
        ].join(' | ')
      : null;

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
    return getViewportFitScale(viewport, cpFitRect);
  }, [cpFitRect, getViewportSize]);

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
    () => registerViewportShortcutExecutor('crease-pattern', handleViewportShortcut),
    [handleViewportShortcut]
  );

  const clearEditablePointerStatus = useCallback(() => {
    setCursorModelPoint(null);
    setSnapTarget(null);
  }, []);

  const creasePatternFitKey = useMemo(
    () =>
      editableCp
        ? `editable:${projectLoadId}:${editableCpHandle ?? 'unhandled'}`
        : `generated:${projectLoadId}:${project.creases.length}:${project.facets.length}`,
    [editableCp, editableCpHandle, project.creases.length, project.facets.length, projectLoadId]
  );
  const lastFittedCreasePatternRef = useRef<string | null>(null);

  useEffect(() => {
    setSelectionTransformAngleDegrees(0);
  }, [editableCpHandle, editableSelectionLineKey]);

  const fitLoadedCreasePattern = useCallback(
    (animationTime = 0) => {
      if (!hasCreasePattern) {
        lastFittedCreasePatternRef.current = null;
        return true;
      }
      if (lastFittedCreasePatternRef.current === creasePatternFitKey) return true;
      const container = containerRef.current;
      if (!container || !transformRef.current || container.clientWidth <= 0 || container.clientHeight <= 0) {
        return false;
      }
      transformRef.current.centerView(computeFitScale(), animationTime);
      lastFittedCreasePatternRef.current = creasePatternFitKey;
      return true;
    },
    [computeFitScale, creasePatternFitKey, hasCreasePattern]
  );

  const fitLoadedCreasePatternRef = useRef(fitLoadedCreasePattern);
  useEffect(() => {
    fitLoadedCreasePatternRef.current = fitLoadedCreasePattern;
  }, [fitLoadedCreasePattern]);

  useEffect(() => {
    const container = containerRef.current;
    if (!hasCreasePattern) {
      lastFittedCreasePatternRef.current = null;
      return undefined;
    }

    let frame = requestAnimationFrame(() => fitLoadedCreasePatternRef.current(0));
    const observer =
      typeof ResizeObserver === 'undefined' || !container
        ? null
        : new ResizeObserver(() => {
            if (lastFittedCreasePatternRef.current !== creasePatternFitKey) {
              cancelAnimationFrame(frame);
              frame = requestAnimationFrame(() => fitLoadedCreasePatternRef.current(0));
            }
          });

    if (observer && container) {
      observer.observe(container);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [creasePatternFitKey, hasCreasePattern]);

  useEffect(() => {
    if (!diagnosticStatus) setDiagnosticHudExpanded(false);
  }, [diagnosticStatus]);

  useEffect(() => {
    if (!activeDiagnosticEntry || !editableCp) {
      lastFocusedDiagnosticRef.current = null;
      return;
    }

    const focusPoint = diagnosticEntryFocusPoint(activeDiagnosticEntry);
    if (!focusPoint) return;
    const focusKey = `${editableCpHandle ?? 'none'}:${activeDiagnosticEntry.id}:${focusPoint.x}:${focusPoint.y}`;
    if (lastFocusedDiagnosticRef.current === focusKey) return;
    const container = containerRef.current;
    const transform = transformRef.current;
    if (!container || !transform || container.clientWidth <= 0 || container.clientHeight <= 0) {
      return;
    }
    const svgPoint = modelPointToCpSvg(focusPoint, editableCpBounds);
    const fitScale = computeFitScale();
    const currentScale = Math.max(zoomPercent / 100, 0.05);
    const focusScale = Math.min(30, Math.max(currentScale, Math.min(3, fitScale * 2)));
    transform.setTransform(
      container.clientWidth / 2 - svgPoint.x * focusScale,
      container.clientHeight / 2 - svgPoint.y * focusScale,
      focusScale,
      180
    );
    lastFocusedDiagnosticRef.current = focusKey;
  }, [
    activeDiagnosticEntry,
    computeFitScale,
    editableCp,
    editableCpBounds,
    editableCpHandle,
    zoomPercent,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasCreasePattern) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      const interactive = isViewportInteractiveTarget(event.target);
      if (event.key === 'Escape' && editableCp) {
        if (cpSymmetryAxisPickPoints) {
          event.preventDefault();
          setCpSymmetryAxisPickPoints(null);
          return;
        }
        if (
          selectionRotateDragRef.current ||
          selectionMoveDragRef.current ||
          selectionResizeDragRef.current ||
          selectionRotationPreview
        ) {
          event.preventDefault();
          selectionRotateDragRef.current = null;
          selectionMoveDragRef.current = null;
          selectionResizeDragRef.current = null;
          setSelectionRotationPreview(null);
          setSnapTarget(null);
          return;
        }
        if (
          editableSelectionSize > 0 &&
          isDefaultSelectionMode(cpToolState, cpToolPoints.length, cpToolPath.length)
        ) {
          event.preventDefault();
          clearOristudioCpSelection();
          return;
        }
        const cancellation = cancelOristudioCpToolState(cpToolState);
        if (cancellation.handled) {
          event.preventDefault();
          setCpToolPoints([]);
          setCpToolPath([]);
          setPendingLengthenLineId(null);
          setPendingSquareBisectorLineIds([]);
          cpToolDragRef.current = null;
          setCpToolState(cancellation.state);
          return;
        }
        if (editableSelectionSize > 0) {
          event.preventDefault();
          clearOristudioCpSelection();
          return;
        }
      }

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
  }, [
    clearOristudioCpSelection,
    cpSymmetryAxisPickPoints,
    cpToolPath.length,
    cpToolPoints.length,
    cpToolState,
    editableCp,
    editableSelectionSize,
    hasCreasePattern,
    selectionRotationPreview,
  ]);

  useEffect(() => {
    if (!editableCp) {
      setCpToolPoints([]);
      setCpToolPath([]);
      setPendingLengthenLineId(null);
      setPendingSquareBisectorLineIds([]);
      setCpSymmetryAxisPickPoints(null);
      cpToolDragRef.current = null;
      selectionRotateDragRef.current = null;
      selectionMoveDragRef.current = null;
      selectionResizeDragRef.current = null;
      setSelectionRotationPreview(null);
      setCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE);
    }
  }, [editableCp]);

  useEffect(() => {
    setCpMeasurementSlots(createEmptyCpMeasurementSlots());
  }, [editableCpHandle]);

  useEffect(() => {
    if (!editableCp || activeCpCommand?.operationId !== 'Text') return;
    if (oristudioCpSelection.texts.length !== 1) return;
    const selectedText = editableCp.crease_pattern.texts[oristudioCpSelection.texts[0] - 1];
    if (!selectedText) return;
    setCpToolOptions((current) =>
      current.textContent === selectedText.text
        ? current
        : { ...current, textContent: selectedText.text }
    );
  }, [activeCpCommand?.operationId, editableCp, oristudioCpSelection.texts]);

  return (
    <section className="panel-shell cp-panel">
      <div className="panel-toolbar">
        <div className="panel-toolbar__group">
          <span className="panel-title">Crease Pattern</span>
        </div>
        {hasCreasePattern ? (
          <div className="cp-panel__mode">
            <span className="cp-panel__mode-label">Color by</span>
            <SegmentedControl
              aria-label="Choose how crease lines are colored"
              value={mode}
              onChange={setMode}
              options={[
                {
                  value: 'mvf',
                  label: 'M/V assignment',
                  icon: <GitBranch size={13} />,
                  title: 'Color by mountain, valley, flat, and border folds',
                },
                {
                  value: 'agrh',
                  label: 'Crease roles',
                  icon: <ScanLine size={13} />,
                  title: 'Color by axial, gusset, ridge, hinge, and pseudohinge roles',
                },
              ]}
            />
          </div>
        ) : (
          <span className="panel-toolbar__meta">{emptyStatusLabel}</span>
        )}
      </div>
      {sourceLabel && <div className="panel-subtitle">{sourceLabel}</div>}
      <div
        ref={containerRef}
        className={[
          'panel-body cp-panel__body',
          editableCp ? 'cp-panel__body--with-tools' : '',
        ].join(' ')}
        data-space-pan={spacePressed || undefined}
        tabIndex={-1}
        onPointerDownCapture={(event) => {
          setActiveShortcutViewportSurface('crease-pattern');
          if (editableCp) setActiveEditingSurface('crease-pattern');
          if (!isViewportInteractiveTarget(event.target)) containerRef.current?.focus();
        }}
      >
        {hasCreasePattern ? (
          <>
            {editableCp && (
              <CpToolRail
                activeActionId={cpToolState.activeActionId}
                activeLineColor={activeCpLineColor}
                editable={!!editableCp}
                onSelectAction={handleCpToolAction}
              />
            )}
            <div className="cp-panel__viewport">
              {diagnosticStatus && (
                <div
                  className="cp-diagnostic-hud"
                  data-tone={diagnosticStatus.tone}
                  data-expanded={diagnosticHudExpanded || undefined}
                  aria-live="polite"
                >
                  <button
                    type="button"
                    className="cp-diagnostic-hud__summary"
                    aria-expanded={diagnosticHudExpanded}
                    onClick={() => setDiagnosticHudExpanded((expanded) => !expanded)}
                  >
                    <span className="cp-diagnostic-hud__copy">
                      <span>{diagnosticStatus.label}</span>
                      {diagnosticStatus.detail &&
                        diagnosticStatus.detail !== diagnosticStatus.label && (
                          <small>{diagnosticStatus.detail}</small>
                        )}
                    </span>
                    {diagnosticHudExpanded ? (
                      <ChevronDown aria-hidden="true" size={16} />
                    ) : (
                      <ChevronRight aria-hidden="true" size={16} />
                    )}
                  </button>
                  {diagnosticHudExpanded && diagnosticHudEntries.length > 0 && (
                    <div className="cp-diagnostic-hud__list" aria-label="Canvas diagnostics">
                      {diagnosticHudEntries.slice(0, 12).map((entry) => (
                        <button
                          type="button"
                          className="cp-diagnostic-hud__row"
                          data-active={entry.id === oristudioCpActiveDiagnosticId || undefined}
                          data-severity={entry.severity}
                          key={entry.id}
                          onClick={() => handleSelectCpDiagnostic(entry.id)}
                        >
                          <span>{semanticCpDiagnosticKind(entry.kind)}</span>
                          <span>{cpDiagnosticEntryMessage(entry)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                  requestAnimationFrame(() => fitLoadedCreasePatternRef.current(0));
                }}
                onTransformed={(_ref, state) => setZoomPercent(Math.round(state.scale * 100))}
              >
                <TransformComponent
                  wrapperStyle={{ width: '100%', height: '100%' }}
                  contentStyle={{ width: 'fit-content', height: 'fit-content' }}
                >
                  <svg
                    ref={svgRef}
                    className="cp-canvas"
                    data-canvas-mode={editableCp ? 'editable' : 'generated'}
                    viewBox={cpCanvasViewBox}
                    width={cpCanvasRect.width}
                    height={cpCanvasRect.height}
                    style={{ width: cpCanvasRect.width, height: cpCanvasRect.height }}
                    role="img"
                    aria-label="Crease pattern"
                    onPointerMove={handleEditablePointerMove}
                    onPointerUp={finishEditableDragPath}
                    onPointerCancel={cancelEditableDragPath}
                    onPointerLeave={clearEditablePointerStatus}
                    onPointerDownCapture={handleEditableToolPointerDown}
                    onPointerDown={(event) => {
                      if (event.target === event.currentTarget) clearSelectionOnBackgroundPointerDown(event);
                    }}
                  >
                    <rect
                      className="paper-shadow"
                      x={CP_PAPER_SHADOW_RECT.x}
                      y={CP_PAPER_SHADOW_RECT.y}
                      width={CP_PAPER_SHADOW_RECT.width}
                      height={CP_PAPER_SHADOW_RECT.height}
                      rx="6"
                    />
                    <rect
                      className={editableCp ? 'paper paper--editable-cp-guide' : 'paper'}
                      x={CP_PAPER_RECT.x}
                      y={CP_PAPER_RECT.y}
                      width={CP_PAPER_RECT.width}
                      height={CP_PAPER_RECT.height}
                      onPointerDown={clearSelectionOnBackgroundPointerDown}
                    />
                    {editableCp ? (
                      <EditableCreasePattern
                        bounds={editableCpBounds}
                        clearSelectionOnBackgroundPointerDown={clearSelectionOnBackgroundPointerDown}
                        document={editableCp}
                        gridLines={editableCpGridLines}
                        gridVisible={oristudioCpViewport.gridVisible}
                        mode={mode}
                        symmetryActive={oristudioCpSymmetry.enabled}
                        symmetryAxisLine={visibleCpSymmetryAxisLine}
                        symmetryDraftLine={draftCpSymmetryAxisLine}
                        commandPreviewBoxes={renderedCommandPreviewBoxes}
                        commandCandidatePoints={renderedCommandCandidatePoints}
                        commandPreviewCircles={renderedCommandPreviewCircles}
                        commandPreviewPoints={renderedCommandPreviewPoints}
                        commandPreviewSegments={renderedCommandPreviewSegments}
                        highlightedLineIds={highlightedEditableLineIds}
                        selectionTransformFrame={visibleSelectionTransformFrame}
                        selectionTransformPreview={selectionRotationPreview}
                        selectionTransformUiScale={cpUiScale}
                        activeDiagnosticId={oristudioCpActiveDiagnosticId}
                        diagnostics={latestDiagnosticEntries}
                        onSelectionMovePointerDown={handleSelectionMovePointerDown}
                        onSelectionResizePointerDown={handleSelectionResizePointerDown}
                        onSelectionRotatePointerDown={handleSelectionRotatePointerDown}
                        onSelectionTransform={handleSelectionTransform}
                        selectDiagnostic={handleSelectCpDiagnostic}
                        selection={oristudioCpSelection}
                        snapTarget={snapTarget}
                        spacePressed={spacePressed}
                        toggleCircle={handleEditableCircleClick}
                        toggleLine={handleEditableLineClick}
                        togglePoint={handleEditablePointClick}
                        toggleText={handleEditableTextClick}
                        toggleVertex={handleEditableVertexClick}
                        vertices={editableCpVertices}
                      />
                    ) : (
                      <GeneratedCreasePattern
                        clearSelectionOnBackgroundPointerDown={clearSelectionOnBackgroundPointerDown}
                        mode={mode}
                        project={project}
                        select={select}
                        selection={selection}
                        spacePressed={spacePressed}
                      />
                    )}
                  </svg>
                </TransformComponent>
              </TransformWrapper>
              <ViewportToolbar
                ariaLabel="Crease pattern viewport controls"
                zoomPercent={zoomPercent}
                zoomIn={() => transformRef.current?.zoomIn(0.35, 120)}
                zoomOut={() => transformRef.current?.zoomOut(0.35, 120)}
                fitToView={() => fitToView()}
                setActualSize={setActualSize}
                setZoomLevel={setZoomLevel}
              >
                {editableCp && (
                  <>
                    <ViewportToolbarSeparator />
                    <IconButton
                      size="sm"
                      variant="toolbar"
                      title="Grid"
                      isActive={oristudioCpViewport.gridVisible}
                      onClick={() =>
                        setOristudioCpViewportOption('gridVisible', !oristudioCpViewport.gridVisible)
                      }
                    >
                      <Grid2X2 size={14} />
                    </IconButton>
                    <CpGridSizeControl
                      value={editableCpGridSize}
                      onChange={(gridSize) => {
                        void setOristudioCpGridSize(gridSize);
                      }}
                    />
                    <IconButton
                      size="sm"
                      variant="toolbar"
                      title="Snap"
                      isActive={
                        oristudioCpViewport.snapToGrid ||
                        oristudioCpViewport.snapToVertices ||
                        oristudioCpViewport.snapToLines
                      }
                      onClick={() => {
                        const enabled =
                          oristudioCpViewport.snapToGrid ||
                          oristudioCpViewport.snapToVertices ||
                          oristudioCpViewport.snapToLines;
                        setOristudioCpViewportOption('snapToGrid', !enabled);
                        setOristudioCpViewportOption('snapToVertices', !enabled);
                        setOristudioCpViewportOption('snapToLines', !enabled);
                      }}
                    >
                      <Magnet size={14} />
                    </IconButton>
                    <CpSymmetryMenuButton
                      symmetry={oristudioCpSymmetry}
                      axisPicking={cpSymmetryAxisPickPoints !== null}
                      axisPickCount={cpSymmetryAxisPickPoints?.length ?? 0}
                      onPreset={handleCpSymmetryPreset}
                      onPickAxis={handleStartCpSymmetryAxisPick}
                      onUpdate={(update) => {
                        setOristudioCpSymmetry(update);
                        setActiveEditingSurface('crease-pattern');
                      }}
                    />
                    <ViewportToolbarSeparator />
                    <CpLineTypeToolbar
                      activeLineColor={activeCpLineColor}
                      applyDisabled={oristudioCpSelection.lines.length === 0}
                      onApplyLineColor={handleApplyActiveLineColor}
                      onSelectLineColor={setActiveCpLineColor}
                      shortcutOverrides={shortcutOverrides}
                    />
                  </>
                )}
              </ViewportToolbar>
              {editableCp && activeCpCommand && (
                <CpContextToolPanel
                  action={activeCpAction}
                  command={activeCpCommand}
                  options={cpToolOptions}
                  setOptions={setCpToolOptions}
                  activeLineColor={activeCpLineColor}
                  measurementSlots={cpMeasurementSlots}
                  pendingPointCount={cpToolPoints.length}
                  selection={oristudioCpSelection}
                  onApply={
                    cpCommandRequiresContextApply(activeCpCommand)
                      ? handleApplyActiveContextCommand
                      : undefined
                  }
                  onClearInput={
                    activeCpCommand.operationId === 'VoronoiCreate' && cpToolPoints.length > 0
                      ? handleClearActiveContextInput
                      : undefined
                  }
                  onDeleteText={
                    activeCpCommand.operationId === 'Text' &&
                    oristudioCpSelection.texts.length > 0
                      ? handleDeleteSelectedText
                      : undefined
                  }
                />
              )}
              <div className="viewport-status-readout">
                <span>{formatZoom(zoomPercent / 100)}</span>
                {editableCp && <span>{activeCpToolPrompt}</span>}
                {editableCp && <span>{cpLineTypeStatusLabel(activeCpLineColor)}</span>}
                {editableCp && editableCpSummary && (
                  <span>{editableCpSummary.line_segments} lines</span>
                )}
                {editableCp && cursorModelPoint && (
                  <span>
                    {formatNumber(cursorModelPoint.x, 2)}, {formatNumber(cursorModelPoint.y, 2)}
                  </span>
                )}
                {editableCp && snapTarget && <span>Snap {snapTarget.label}</span>}
                {editableCp && editableSelectionSize > 0 && (
                  <span>{editableSelectionSize} selected</span>
                )}
                {editableCp && selectionRotationPreview?.kind === 'rotate' && (
                  <span>{formatNumber(selectionRotationPreview.angleDegrees ?? 0, 1)} deg</span>
                )}
                {editableCp && selectionRotationPreview?.kind === 'translate' && selectionRotationPreview.delta && (
                  <span>
                    Move {formatNumber(selectionRotationPreview.delta.x, 2)},{' '}
                    {formatNumber(selectionRotationPreview.delta.y, 2)}
                  </span>
                )}
                {editableCp && selectionRotationPreview?.kind === 'scale' && (
                  <span>
                    Scale {formatNumber((selectionRotationPreview.scaleX ?? 1) * 100, 0)}%,{' '}
                    {formatNumber((selectionRotationPreview.scaleY ?? 1) * 100, 0)}%
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="cp-panel__empty">
            <span title={status === 'error' ? error?.message : undefined}>{emptyStatusLabel}</span>
            <NextDocumentAction />
          </div>
        )}
      </div>
    </section>
  );
}

interface EditableCreasePatternProps {
  activeDiagnosticId: string | null;
  bounds: CpModelBounds;
  clearSelectionOnBackgroundPointerDown: (event: PointerEvent<SVGElement>) => void;
  document: OristudioCpDocumentSnapshot;
  gridLines: ReturnType<typeof getCpGridLines>;
  gridVisible: boolean;
  mode: 'mvf' | 'agrh';
  symmetryActive: boolean;
  symmetryAxisLine: readonly [Point, Point] | null;
  symmetryDraftLine: readonly [Point, Point] | null;
  commandPreviewBoxes: readonly (readonly [Point, Point])[];
  commandCandidatePoints: Point[];
  commandPreviewCircles: OristudioCpCircle[];
  commandPreviewPoints: Point[];
  commandPreviewSegments: OristudioCpLineSegment[];
  diagnostics: OristudioCpDiagnosticEntry[];
  highlightedLineIds: number[];
  onSelectionMovePointerDown: (event: PointerEvent<Element>) => void;
  onSelectionResizePointerDown: (
    handle: CpSelectionResizeHandle,
    event: PointerEvent<Element>
  ) => void;
  onSelectionRotatePointerDown: (event: PointerEvent<Element>) => void;
  onSelectionTransform: (transform: CpSelectionTransform) => void;
  selectDiagnostic: (id: string) => void;
  selection: OristudioCpSelection;
  selectionTransformFrame: CpLineSelectionFrame | null;
  selectionTransformPreview: CpSelectionTransformPreview | null;
  selectionTransformUiScale: number;
  snapTarget: CpSnapTarget | null;
  spacePressed: boolean;
  toggleCircle: (id: number, additive?: boolean) => void;
  toggleLine: (id: number, additive?: boolean) => void;
  togglePoint: (id: number, additive?: boolean) => void;
  toggleText: (id: number, additive?: boolean) => void;
  toggleVertex: (id: string, additive?: boolean) => void;
  vertices: CpVertex[];
}

function EditableCreasePattern({
  activeDiagnosticId,
  bounds,
  clearSelectionOnBackgroundPointerDown,
  document,
  gridLines,
  gridVisible,
  mode,
  symmetryActive,
  symmetryAxisLine,
  symmetryDraftLine,
  commandPreviewBoxes,
  commandCandidatePoints,
  commandPreviewCircles,
  commandPreviewPoints,
  commandPreviewSegments,
  diagnostics,
  highlightedLineIds,
  onSelectionMovePointerDown,
  onSelectionResizePointerDown,
  onSelectionRotatePointerDown,
  onSelectionTransform,
  selectDiagnostic,
  selection,
  selectionTransformFrame,
  selectionTransformPreview,
  selectionTransformUiScale,
  snapTarget,
  spacePressed,
  toggleCircle,
  toggleLine,
  togglePoint,
  toggleText,
  toggleVertex,
  vertices,
}: EditableCreasePatternProps) {
  return (
    <>
      {gridVisible &&
        gridLines.map((line) => {
          const a = modelPointToCpSvg(line.a, bounds);
          const b = modelPointToCpSvg(line.b, bounds);
          return (
            <line
              key={line.id}
              className="cp-grid-line"
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
            />
          );
        })}
      {symmetryAxisLine && (
        <SymmetryAxisGuide
          bounds={bounds}
          points={symmetryAxisLine}
          active={symmetryActive}
        />
      )}
      {symmetryDraftLine && (
        <SymmetryAxisGuide bounds={bounds} points={symmetryDraftLine} draft />
      )}
      {document.crease_pattern.line_segments.map((line, index) => {
        const id = index + 1;
        const a = modelPointToCpSvg(line.a, bounds);
        const b = modelPointToCpSvg(line.b, bounds);
        return (
          <g key={id}>
            <line
              className="cp-line-hit-target"
              data-cp-line-hit-id={id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              aria-label={`Editable ${cpLineAssignmentLabel(line.color)} line ${id} hit target`}
              onClick={(event) => {
                if (spacePressed) return;
                event.stopPropagation();
                toggleLine(id, event.shiftKey || event.metaKey || event.ctrlKey);
              }}
            />
            <line
              className={[
                cpLineColorClass(line.color, mode),
                selection.lines.includes(id) || highlightedLineIds.includes(id)
                  ? 'crease--selected'
                  : '',
              ].join(' ')}
              data-cp-line-id={id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              aria-label={`Editable ${cpLineAssignmentLabel(line.color)} line ${id}`}
              onClick={(event) => {
                if (spacePressed) return;
                event.stopPropagation();
                toggleLine(id, event.shiftKey || event.metaKey || event.ctrlKey);
              }}
            />
          </g>
        );
      })}
      {selectionTransformPreview?.segments.map((segment, index) => {
        const a = modelPointToCpSvg(segment.a, bounds);
        const b = modelPointToCpSvg(segment.b, bounds);
        return (
          <line
            key={`selection-transform-preview-${index}-${segment.a.x}-${segment.a.y}-${segment.b.x}-${segment.b.y}`}
            className={[
              cpLineColorClass(segment.color, mode),
              'cp-selection-transform-preview',
            ].join(' ')}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
          />
        );
      })}
      {document.crease_pattern.points.map((point, index) => {
        const id = index + 1;
        const svgPoint = modelPointToCpSvg(point, bounds);
        return (
          <circle
            key={id}
            className={[
              'cp-point',
              selection.points.includes(id) ? 'cp-point--selected' : '',
            ].join(' ')}
            data-cp-point-id={id}
            cx={svgPoint.x}
            cy={svgPoint.y}
            r="4"
            onClick={(event) => {
              if (spacePressed) return;
              event.stopPropagation();
              togglePoint(id, event.shiftKey || event.metaKey || event.ctrlKey);
            }}
          />
        );
      })}
      {document.crease_pattern.circles.map((circle, index) => {
        const id = index + 1;
        const center = modelPointToCpSvg({ x: circle.x, y: circle.y }, bounds);
        const radius =
          (circle.r / Math.max(bounds.spanX, bounds.spanY)) *
          Math.min(CP_PAPER_RECT.width, CP_PAPER_RECT.height);
        return (
          <circle
            key={id}
            className={[
              'cp-circle',
              selection.circles.includes(id) ? 'cp-circle--selected' : '',
            ].join(' ')}
            data-cp-circle-id={id}
            cx={center.x}
            cy={center.y}
            r={Math.max(1, radius)}
            onClick={(event) => {
              if (spacePressed) return;
              event.stopPropagation();
              toggleCircle(id, event.shiftKey || event.metaKey || event.ctrlKey);
            }}
          />
        );
      })}
      {commandPreviewCircles.map((circle, index) => {
        const center = modelPointToCpSvg({ x: circle.x, y: circle.y }, bounds);
        const radius =
          (circle.r / Math.max(bounds.spanX, bounds.spanY)) *
          Math.min(CP_PAPER_RECT.width, CP_PAPER_RECT.height);
        return (
          <circle
            key={`${index}-${circle.x}-${circle.y}-${circle.r}`}
            className="cp-command-preview"
            cx={center.x}
            cy={center.y}
            r={Math.max(1, radius)}
          />
        );
      })}
      {commandPreviewBoxes.map((box, index) => (
        <SelectionBoxPreview
          key={`${index}-${box[0].x}-${box[0].y}`}
          bounds={bounds}
          points={box}
        />
      ))}
      {diagnostics.flatMap((diagnostic) =>
        (diagnostic.segments ?? []).map((segment, index) => {
          const a = modelPointToCpSvg(segment.a, bounds);
          const b = modelPointToCpSvg(segment.b, bounds);
          const active = diagnostic.id === activeDiagnosticId;
          return (
            <line
              key={`${diagnostic.id}-segment-${index}`}
              className={[
                'cp-diagnostic-segment',
                active ? 'cp-diagnostic-segment--active' : '',
              ].join(' ')}
              data-active={active || undefined}
              data-cp-diagnostic-id={diagnostic.id}
              data-diagnostic-color={segment.color}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                selectDiagnostic(diagnostic.id);
              }}
            />
          );
        })
      )}
      {document.crease_pattern.texts.map((text, index) => {
        const id = index + 1;
        const position = modelPointToCpSvg(
          { x: textCoordinate(text.x), y: textCoordinate(text.y) },
          bounds
        );
        return (
          <text
            key={id}
            className={['cp-text', selection.texts.includes(id) ? 'cp-text--selected' : ''].join(
              ' '
            )}
            data-cp-text-id={id}
            x={position.x}
            y={position.y}
            onClick={(event) => {
              if (spacePressed) return;
              event.stopPropagation();
              toggleText(id, event.shiftKey || event.metaKey || event.ctrlKey);
            }}
          >
            {text.text}
          </text>
        );
      })}
      {vertices.map((vertex) => {
        const svgPoint = modelPointToCpSvg(vertex.point, bounds);
        const selected = selection.vertices?.includes(vertex.id) ?? false;
        return (
          <g
            key={vertex.id}
            data-cp-vertex-id={vertex.id}
            onClick={(event) => {
              if (spacePressed) return;
              event.stopPropagation();
              toggleVertex(vertex.id, event.shiftKey || event.metaKey || event.ctrlKey);
            }}
          >
            <circle
              className="cp-vertex-hit-target"
              cx={svgPoint.x}
              cy={svgPoint.y}
              r="7"
              aria-label={`Editable vertex at ${formatNumber(vertex.point.x, 2)}, ${formatNumber(vertex.point.y, 2)}`}
            />
            <circle
              className={['cp-vertex', selected ? 'cp-vertex--selected' : ''].join(' ')}
              cx={svgPoint.x}
              cy={svgPoint.y}
              r="3.2"
              aria-hidden="true"
            />
          </g>
        );
      })}
      {diagnostics
        .filter((diagnostic) => diagnostic.point)
        .map((diagnostic) => {
          const point = modelPointToCpSvg(diagnostic.point as Point, bounds);
          const active = diagnostic.id === activeDiagnosticId;
          return (
            <g
              key={`${diagnostic.id}-point`}
              className={[
                'cp-diagnostic-point',
                active ? 'cp-diagnostic-point--active' : '',
              ].join(' ')}
              data-active={active || undefined}
              data-cp-diagnostic-id={diagnostic.id}
              data-severity={diagnostic.severity}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                selectDiagnostic(diagnostic.id);
              }}
            >
              <circle className="cp-diagnostic-point__halo" cx={point.x} cy={point.y} r="9" />
              <circle className="cp-diagnostic-point__core" cx={point.x} cy={point.y} r="3.2" />
              <line
                className="cp-diagnostic-point__cross"
                x1={point.x - 6}
                y1={point.y}
                x2={point.x + 6}
                y2={point.y}
              />
              <line
                className="cp-diagnostic-point__cross"
                x1={point.x}
                y1={point.y - 6}
                x2={point.x}
                y2={point.y + 6}
              />
            </g>
          );
        })}
      {document.operation_frame?.active && (
        <polygon
          className="cp-operation-frame"
          points={document.operation_frame.points
            .map((point) => modelPointToCpSvg(point, bounds))
            .map((point) => `${point.x},${point.y}`)
          .join(' ')}
        />
      )}
      {commandPreviewSegments.map((segment, index) => {
        const a = modelPointToCpSvg(segment.a, bounds);
        const b = modelPointToCpSvg(segment.b, bounds);
        return (
          <line
            key={`${index}-${segment.a.x}-${segment.a.y}-${segment.b.x}-${segment.b.y}`}
            className={[
              cpLineColorClass(segment.color, mode),
              'cp-command-candidate',
            ].join(' ')}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
          />
        );
      })}
      {commandPreviewPoints.length > 1 && (
        <polyline
          className="cp-command-preview"
          points={commandPreviewPoints
            .map((point) => modelPointToCpSvg(point, bounds))
            .map((point) => `${point.x},${point.y}`)
            .join(' ')}
        />
      )}
      {commandCandidatePoints.map((point, index) => {
        const svgPoint = modelPointToCpSvg(point, bounds);
        return (
          <circle
            key={`${index}-${point.x}-${point.y}`}
            className="cp-command-candidate-point"
            cx={svgPoint.x}
            cy={svgPoint.y}
            r="4"
          />
        );
      })}
      {selectionTransformFrame && (
        <SelectionTransformBox
          bounds={bounds}
          selectionFrame={selectionTransformFrame}
          uiScale={selectionTransformUiScale}
          onMovePointerDown={onSelectionMovePointerDown}
          onResizePointerDown={onSelectionResizePointerDown}
          onRotatePointerDown={onSelectionRotatePointerDown}
          onTransform={onSelectionTransform}
        />
      )}
      {snapTarget && (
        <circle
          className="cp-snap-target"
          cx={modelPointToCpSvg(snapTarget.point, bounds).x}
          cy={modelPointToCpSvg(snapTarget.point, bounds).y}
          r="5"
        />
      )}
      <rect
        className="paper-border"
        x={CP_PAPER_RECT.x}
        y={CP_PAPER_RECT.y}
        width={CP_PAPER_RECT.width}
        height={CP_PAPER_RECT.height}
        onPointerDown={clearSelectionOnBackgroundPointerDown}
      />
    </>
  );
}

function SelectionTransformBox({
  bounds,
  selectionFrame,
  uiScale,
  onMovePointerDown,
  onResizePointerDown,
  onRotatePointerDown,
  onTransform,
}: {
  bounds: CpModelBounds;
  selectionFrame: CpLineSelectionFrame;
  uiScale: number;
  onMovePointerDown: (event: PointerEvent<Element>) => void;
  onResizePointerDown: (
    handle: CpSelectionResizeHandle,
    event: PointerEvent<Element>
  ) => void;
  onRotatePointerDown: (event: PointerEvent<Element>) => void;
  onTransform: (transform: CpSelectionTransform) => void;
}) {
  const center = modelPointToCpSvg(selectionFrame.center, bounds);
  const axisXEnd = modelPointToCpSvg(
    {
      x: selectionFrame.center.x + selectionFrame.axisX.x,
      y: selectionFrame.center.y + selectionFrame.axisX.y,
    },
    bounds
  );
  const axisYEnd = modelPointToCpSvg(
    {
      x: selectionFrame.center.x + selectionFrame.axisY.x,
      y: selectionFrame.center.y + selectionFrame.axisY.y,
    },
    bounds
  );
  const axisXVector = { x: axisXEnd.x - center.x, y: axisXEnd.y - center.y };
  const axisYVector = { x: axisYEnd.x - center.x, y: axisYEnd.y - center.y };
  const axisXLength = Math.max(1e-9, Math.hypot(axisXVector.x, axisXVector.y));
  const axisYLength = Math.max(1e-9, Math.hypot(axisYVector.x, axisYVector.y));
  const axisX = { x: axisXVector.x / axisXLength, y: axisXVector.y / axisXLength };
  const axisY = { x: axisYVector.x / axisYLength, y: axisYVector.y / axisYLength };
  const minSize = 18 * uiScale;
  const width = Math.max(selectionFrame.width * axisXLength, minSize);
  const height = Math.max(selectionFrame.height * axisYLength, minSize);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const framePoint = (xSign: -1 | 0 | 1, ySign: -1 | 0 | 1): Point => ({
    x: center.x + axisX.x * halfWidth * xSign + axisY.x * halfHeight * ySign,
    y: center.y + axisX.y * halfWidth * xSign + axisY.y * halfHeight * ySign,
  });
  const boxPoints = [
    framePoint(-1, 1),
    framePoint(1, 1),
    framePoint(1, -1),
    framePoint(-1, -1),
  ];
  const boxMinX = Math.min(...boxPoints.map((point) => point.x));
  const boxMinY = Math.min(...boxPoints.map((point) => point.y));
  const boxMaxY = Math.max(...boxPoints.map((point) => point.y));
  const menuButtonCount = 4;
  const menuSeparatorCount = 1;
  const menuChildCount = menuButtonCount + menuSeparatorCount;
  const menuButtonSize = 25;
  const menuGap = 3;
  const menuPadding = 4;
  const menuBorderWidth = 1;
  const menuSeparatorWidth = 1;
  const menuWidth =
    menuButtonCount * menuButtonSize +
    menuSeparatorCount * menuSeparatorWidth +
    (menuChildCount - 1) * menuGap +
    menuPadding * 2 +
    menuBorderWidth * 2;
  const menuHeight = 34;
  const canvasPadding = 10 * uiScale;
  const menuSvgWidth = menuWidth * uiScale;
  const menuSvgHeight = menuHeight * uiScale;
  const menuX = Math.min(
    Math.max(boxMinX, CP_EDITABLE_CANVAS_RECT.x + canvasPadding),
    CP_EDITABLE_CANVAS_RECT.x + CP_EDITABLE_CANVAS_RECT.width - menuSvgWidth - canvasPadding
  );
  const aboveMenuY = boxMinY - menuSvgHeight - 10 * uiScale;
  const menuY =
    aboveMenuY < CP_EDITABLE_CANVAS_RECT.y + canvasPadding
      ? boxMaxY + 10 * uiScale
      : aboveMenuY;
  const boxPointList = boxPoints.map((point) => `${point.x},${point.y}`).join(' ');
  const handleRadius = 5 * uiScale;
  const rotateHitRadius = 18 * uiScale;
  const resizeHandles = CP_SELECTION_RESIZE_HANDLES.map((handle) => ({
    ...handle,
    point: framePoint(handle.x, handle.y),
  }));

  return (
    <g className="cp-selection-transform" data-cp-selection-transform-control="true">
      <polygon
        className="cp-selection-transform__move-hit-area"
        points={boxPointList}
        onPointerDown={onMovePointerDown}
      />
      <polygon
        className="cp-selection-transform__box"
        points={boxPointList}
      />
      <foreignObject
        x={menuX}
        y={menuY}
        width={menuSvgWidth}
        height={menuSvgHeight}
        className="cp-selection-transform__menu-foreign"
      >
        <div
          className="cp-selection-transform__menu"
          role="toolbar"
          aria-label="Selection transforms"
          style={{
            width: menuWidth,
            height: menuHeight,
            transform: `scale(${uiScale})`,
            transformOrigin: 'top left',
          }}
        >
          <button
            type="button"
            title="Flip Horizontal"
            aria-label="Flip Horizontal"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onTransform({ kind: 'flip-horizontal' })}
          >
            <FlipHorizontal size={14} />
          </button>
          <button
            type="button"
            title="Flip Vertical"
            aria-label="Flip Vertical"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onTransform({ kind: 'flip-vertical' })}
          >
            <FlipVertical size={14} />
          </button>
          <span className="cp-selection-transform__separator" />
          <button
            type="button"
            title="Rotate Left 90"
            aria-label="Rotate Left 90"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onTransform({ kind: 'rotate', angleDegrees: 90 })}
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            title="Rotate Right 90"
            aria-label="Rotate Right 90"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onTransform({ kind: 'rotate', angleDegrees: -90 })}
          >
            <RotateCw size={14} />
          </button>
        </div>
      </foreignObject>
      {resizeHandles
        .filter((handle) => handle.x !== 0 && handle.y !== 0)
        .map((handle) => (
          <circle
            key={`rotate-${handle.id}`}
            className="cp-selection-transform__rotate-hit-area"
            cx={handle.point.x}
            cy={handle.point.y}
            r={rotateHitRadius}
            aria-label="Rotate selection"
            onPointerDown={onRotatePointerDown}
          />
        ))}
      {resizeHandles.map((handle) => (
        <circle
          key={handle.id}
          className="cp-selection-transform__resize-handle"
          data-cp-resize-cursor={handle.cursor}
          data-cp-resize-handle={handle.id}
          cx={handle.point.x}
          cy={handle.point.y}
          r={handleRadius}
          onPointerDown={(event) => onResizePointerDown(handle.id, event)}
        />
      ))}
    </g>
  );
}

function SelectionBoxPreview({
  bounds,
  points,
}: {
  bounds: CpModelBounds;
  points: readonly [Point, Point];
}) {
  const first = modelPointToCpSvg(points[0], bounds);
  const second = modelPointToCpSvg(points[1], bounds);
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const width = Math.abs(first.x - second.x);
  const height = Math.abs(first.y - second.y);

  return (
    <rect
      className="cp-command-box-preview"
      x={x}
      y={y}
      width={width}
      height={height}
    />
  );
}

function SymmetryAxisGuide({
  bounds,
  points,
  active = false,
  draft = false,
}: {
  bounds: CpModelBounds;
  points: readonly [Point, Point];
  active?: boolean;
  draft?: boolean;
}) {
  const a = modelPointToCpSvg(points[0], bounds);
  const b = modelPointToCpSvg(points[1], bounds);
  return (
    <line
      className={[
        'cp-symmetry-line',
        active ? 'cp-symmetry-line--active' : '',
        draft ? 'cp-symmetry-line--draft' : '',
      ].join(' ')}
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
    />
  );
}

interface GeneratedCreasePatternProps {
  clearSelectionOnBackgroundPointerDown: (event: PointerEvent<SVGElement>) => void;
  mode: 'mvf' | 'agrh';
  project: TreeProject;
  select: (selection: Selection) => void;
  selection: Selection;
  spacePressed: boolean;
}

function GeneratedCreasePattern({
  clearSelectionOnBackgroundPointerDown,
  mode,
  project,
  select,
  selection,
  spacePressed,
}: GeneratedCreasePatternProps) {
  return (
    <>
      {project.facets.map((facet) => {
        const points = facet.vertices
          .map((point) => paperToSvg(point, CP_PAPER_RECT))
          .map((point) => `${point.x},${point.y}`)
          .join(' ');
        return (
          <polygon
            key={facet.id}
            className={[
              `facet facet--${facet.color}`,
              isFacetSelected(selection, facet.id) ? 'facet--selected' : '',
            ].join(' ')}
            points={points}
            onClick={(event) => {
              if (spacePressed) return;
              select(
                event.shiftKey || event.metaKey || event.ctrlKey
                  ? toggleFacetSelection(selection, facet.id)
                  : { kind: 'facet', id: facet.id }
              );
            }}
          />
        );
      })}
      {project.creases.map((crease) => {
        const a = paperToSvg(crease.vertices[0], CP_PAPER_RECT);
        const b = paperToSvg(crease.vertices[1], CP_PAPER_RECT);
        return (
          <line
            key={crease.id}
            className={[
              creaseClass(crease.fold, crease.kind, mode),
              isCreaseSelected(selection, crease.id) ? 'crease--selected' : '',
            ].join(' ')}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            onClick={(event) => {
              if (spacePressed) return;
              select(
                event.shiftKey || event.metaKey || event.ctrlKey
                  ? toggleCreaseSelection(selection, crease.id)
                  : { kind: 'crease', id: crease.id }
              );
            }}
          />
        );
      })}
      <rect
        className="paper-border"
        x={CP_PAPER_RECT.x}
        y={CP_PAPER_RECT.y}
        width={CP_PAPER_RECT.width}
        height={CP_PAPER_RECT.height}
        onPointerDown={clearSelectionOnBackgroundPointerDown}
      />
    </>
  );
}

function CpContextToolPanel({
  action,
  command,
  options,
  setOptions,
  activeLineColor,
  measurementSlots,
  pendingPointCount,
  selection,
  onApply,
  onClearInput,
  onDeleteText,
}: {
  action: OristudioCpActionDefinition | undefined;
  command: OristudioCpCommandDefinition;
  options: OristudioCpToolOptions;
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>;
  activeLineColor: OristudioCpLineColor;
  measurementSlots: CpMeasurementSlots;
  pendingPointCount: number;
  selection: OristudioCpSelection;
  onApply?: () => void;
  onClearInput?: () => void;
  onDeleteText?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const groups = cpToolSettingGroupsForCommand(command);
  const instructions = instructionsForCpTool(action, command);
  const applyDisabled = contextApplyDisabledForCommand(command, selection, pendingPointCount);
  const title = action?.kind === 'command' ? action.label : command.label;
  const meta =
    groups.length > 0
      ? `${groups.length} ${groups.length === 1 ? 'setting' : 'settings'}`
      : 'Instructions';

  if (groups.length === 0 && !instructions) return null;

  return (
    <section
      className="cp-context-panel"
      aria-label="Crease pattern tool options"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className="cp-context-panel__header"
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span className="cp-context-panel__title">{title}</span>
        <span className="cp-context-panel__meta">{meta}</span>
      </button>
      {!collapsed && (
        <div className="cp-context-panel__body">
          {instructions && <CpContextToolInstructions instructions={instructions} />}
          {groups.map((group) => (
            <CpContextToolGroup
              key={group}
              group={group}
              options={options}
              setOptions={setOptions}
              activeLineColor={activeLineColor}
              activeMeasurementSlot={cpMeasurementSlotForOperation(command.operationId)}
              activeOperationId={command.operationId}
              measurementSlots={measurementSlots}
              pendingPointCount={pendingPointCount}
              selection={selection}
            />
          ))}
          {onApply && (
            <button
              className="cp-context-panel__apply"
              type="button"
              disabled={applyDisabled}
              onClick={onApply}
            >
              {command.operationId === 'VoronoiCreate'
                ? 'Apply Voronoi'
                : command.operationId === 'Text'
                  ? 'Apply text'
                  : command.operationId === 'CircleChangeColor'
                    ? 'Apply color'
                    : isSelectionCircleApplyOperation(command.operationId)
                      ? 'Apply circle'
                  : 'Apply to selection'}
            </button>
          )}
          {onDeleteText && (
            <button className="cp-context-panel__secondary" type="button" onClick={onDeleteText}>
              Delete text
            </button>
          )}
          {onClearInput && (
            <button className="cp-context-panel__secondary" type="button" onClick={onClearInput}>
              Clear seeds
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function CpContextToolInstructions({
  instructions,
}: {
  instructions: OristudioCpToolInstructions;
}) {
  const hasIntro = (instructions.intro?.length ?? 0) > 0;
  const hasSteps = (instructions.steps?.length ?? 0) > 0;
  const hasNotes = (instructions.notes?.length ?? 0) > 0;

  return (
    <div className="cp-context-panel__instructions">
      <div className="cp-context-panel__group-title">Instructions</div>
      {hasIntro && (
        <div className="cp-context-panel__instruction-copy">
          {instructions.intro?.map((line) => <p key={line}>{line}</p>)}
        </div>
      )}
      {hasSteps && (
        <ol className="cp-context-panel__instruction-list">
          {instructions.steps?.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}
      {hasNotes && (
        <div className="cp-context-panel__instruction-notes">
          {instructions.notes?.map((note) => <p key={note}>{note}</p>)}
        </div>
      )}
    </div>
  );
}

function CpContextToolGroup({
  group,
  options,
  setOptions,
  activeLineColor,
  activeMeasurementSlot,
  activeOperationId,
  measurementSlots,
  pendingPointCount,
  selection,
}: {
  group: OristudioCpToolSettingGroup;
  options: OristudioCpToolOptions;
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>;
  activeLineColor: OristudioCpLineColor;
  activeMeasurementSlot: CpMeasurementSlotId | null;
  activeOperationId: OristudioCpCommandDefinition['operationId'];
  measurementSlots: CpMeasurementSlots;
  pendingPointCount: number;
  selection: OristudioCpSelection;
}) {
  if (group === 'line-color') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Line type</div>
        <div className="cp-context-panel__readout">{cpLineTypeStatusLabel(activeLineColor)}</div>
      </div>
    );
  }

  if (group === 'division-count') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Divide by count</div>
        <NumericToolOption
          label="Count"
          ariaLabel="Division count"
          min={1}
          max={256}
          step={1}
          value={options.divisionCount}
          onChange={(divisionCount) =>
            setOptions((current) => ({ ...current, divisionCount }))
          }
        />
      </div>
    );
  }

  if (group === 'division-ratio') {
    return <DivisionRatioOptions options={options} setOptions={setOptions} />;
  }

  if (group === 'angle-system') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Angle system</div>
        <NumericToolOption
          label="Divider"
          ariaLabel="Angle system divider"
          min={0}
          max={360}
          step={1}
          value={options.angleSystemDivider}
          onChange={(angleSystemDivider) =>
            setOptions((current) => ({ ...current, angleSystemDivider }))
          }
        />
        <div className="cp-context-panel__angle-grid">
          {ANGLE_FIELDS.map((field, index) => (
            <NumericToolOption
              key={field}
              label={field}
              ariaLabel={`Angle ${field}`}
              min={0}
              max={360}
              step={0.1}
              value={options.angleSystemAngles[index] ?? 0}
              onChange={(value) => updateAngleField(setOptions, index, value)}
            />
          ))}
        </div>
      </div>
    );
  }

  if (group === 'replace-line-type') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Replace line type</div>
        <SelectToolOption
          label="From"
          ariaLabel="Replace from line type"
          value={options.customFromLineType}
          options={ORISTUDIO_CP_CUSTOM_LINE_TYPE_OPTIONS}
          onChange={(customFromLineType) =>
            setOptions((current) => ({ ...current, customFromLineType }))
          }
        />
        <SelectToolOption
          label="To"
          ariaLabel="Replace to line type"
          value={options.customToLineType}
          options={ORISTUDIO_CP_REPLACE_TARGET_LINE_TYPE_OPTIONS}
          onChange={(customToLineType) =>
            setOptions((current) => ({ ...current, customToLineType }))
          }
        />
      </div>
    );
  }

  if (group === 'delete-line-type') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Delete line type</div>
        <SelectToolOption
          label="Filter"
          ariaLabel="Delete line type"
          value={options.customLineType}
          options={ORISTUDIO_CP_CUSTOM_LINE_TYPE_OPTIONS}
          onChange={(customLineType) =>
            setOptions((current) => ({ ...current, customLineType }))
          }
        />
      </div>
    );
  }

  if (group === 'fix-precision') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Fix inaccurate</div>
        <NumericToolOption
          label="Precision"
          ariaLabel="Fix precision"
          min={0}
          max={100}
          step={0.01}
          value={options.fixPrecision}
          onChange={(fixPrecision) => setOptions((current) => ({ ...current, fixPrecision }))}
        />
        <CheckboxToolOption
          label="BP"
          ariaLabel="Use BP fix targets"
          checked={options.fixPrecisionUseBp}
          onChange={(fixPrecisionUseBp) =>
            setOptions((current) => ({ ...current, fixPrecisionUseBp }))
          }
        />
        <CheckboxToolOption
          label="22.5"
          ariaLabel="Use 22.5 fix targets"
          checked={options.fixPrecisionUse22_5}
          onChange={(fixPrecisionUse22_5) =>
            setOptions((current) => ({ ...current, fixPrecisionUse22_5 }))
          }
        />
      </div>
    );
  }

  if (group === 'polygon-corners') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Regular polygon</div>
        <NumericToolOption
          label="Corners"
          ariaLabel="Polygon corners"
          min={3}
          max={256}
          step={1}
          value={options.polygonCorners}
          onChange={(polygonCorners) =>
            setOptions((current) => ({ ...current, polygonCorners }))
          }
        />
      </div>
    );
  }

  if (group === 'parallel-width') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Parallel width</div>
        <NumericToolOption
          label="Width"
          ariaLabel="Parallel width"
          min={0}
          max={9999}
          step={0.1}
          value={options.parallelWidth}
          onChange={(parallelWidth) =>
            setOptions((current) => ({ ...current, parallelWidth }))
          }
        />
      </div>
    );
  }

  if (group === 'candidate-choice') {
    const usesNearestCandidate =
      activeOperationId !== 'CircleDrawTangentLine' &&
      activeOperationId !== 'CircleDrawConcentricSelect';
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Candidate</div>
        <CheckboxToolOption
          label={usesNearestCandidate ? 'Auto nearest' : 'First candidate'}
          ariaLabel={usesNearestCandidate ? 'Use nearest candidate' : 'Use first candidate'}
          checked={options.candidateIndex === null}
          onChange={(useNearest) =>
            setOptions((current) => ({
              ...current,
              candidateIndex: useNearest ? null : 0,
            }))
          }
        />
        <NumericToolOption
          label="Index"
          ariaLabel="Candidate index"
          min={1}
          max={256}
          step={1}
          value={(options.candidateIndex ?? 0) + 1}
          disabled={options.candidateIndex === null}
          onChange={(candidateIndex) =>
            setOptions((current) => ({
              ...current,
              candidateIndex: Math.max(0, candidateIndex - 1),
            }))
          }
        />
      </div>
    );
  }

  if (group === 'circle-select-help') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Circle selection</div>
        <div className="cp-context-panel__readout">
          {selection.circles.length} circle{selection.circles.length === 1 ? '' : 's'} selected
          {selection.lines.length > 0
            ? `, ${selection.lines.length} crease${selection.lines.length === 1 ? '' : 's'} selected`
            : ''}
        </div>
      </div>
    );
  }

  if (group === 'apply-lines') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">
          {activeOperationId === 'VoronoiCreate' ? 'Voronoi seeds' : 'Apply lines'}
        </div>
        <div className="cp-context-panel__readout">
          {activeOperationId === 'VoronoiCreate'
            ? `${pendingPointCount} seed ${pendingPointCount === 1 ? 'press' : 'presses'} pending`
            : 'Apply the generated lines from this tool.'}
        </div>
      </div>
    );
  }

  if (group === 'measurement-readout') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Measurement</div>
        <div className="cp-context-panel__measurement-grid">
          {CP_MEASUREMENT_SLOT_ORDER.map((slot) => (
            <div
              key={slot}
              className="cp-context-panel__measurement-row"
              data-active={slot === activeMeasurementSlot || undefined}
              data-measurement-slot={slot}
            >
              <span>{CP_MEASUREMENT_SLOT_LABELS[slot]}</span>
              <span>{formatCpMeasurementValue(slot, measurementSlots[slot])}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (group === 'custom-circle-color') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Circle color</div>
        <div
          className="cp-context-panel__color-swatch"
          style={{
            backgroundColor: `rgb(${options.customCircleColor.red}, ${options.customCircleColor.green}, ${options.customCircleColor.blue})`,
          }}
          aria-hidden="true"
        />
        <div className="cp-context-panel__angle-grid">
          {RGB_FIELDS.map((field) => (
            <NumericToolOption
              key={field.key}
              label={field.label}
              ariaLabel={field.ariaLabel}
              min={0}
              max={255}
              step={1}
              value={options.customCircleColor[field.key]}
              onChange={(value) => updateCustomCircleColor(setOptions, field.key, value)}
            />
          ))}
        </div>
      </div>
    );
  }

  if (group === 'text-content') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Text annotation</div>
        <TextAreaToolOption
          label="Text"
          ariaLabel="Text annotation content"
          value={options.textContent}
          onChange={(textContent) => setOptions((current) => ({ ...current, textContent }))}
        />
        <div className="cp-context-panel__readout">
          {selection.texts.length === 0 ? 'No text selected' : `${selection.texts.length} selected`}
        </div>
      </div>
    );
  }

  if (group === 'line-select-help') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Line selection</div>
        <div className="cp-context-panel__readout">Drag across creases to apply this action.</div>
      </div>
    );
  }

  return null;
}

const RATIO_FIELDS: readonly {
  key: keyof OristudioCpRatioExpression;
  label: string;
  ariaLabel: string;
  min?: number;
  step: number;
}[] = [
  { key: 'a', label: 'A', ariaLabel: 'Ratio A', step: 0.1 },
  { key: 'b', label: 'B', ariaLabel: 'Ratio B', step: 0.1 },
  { key: 'c', label: 'C', ariaLabel: 'Ratio C', min: 0, step: 0.1 },
  { key: 'd', label: 'D', ariaLabel: 'Ratio D', step: 0.1 },
  { key: 'e', label: 'E', ariaLabel: 'Ratio E', step: 0.1 },
  { key: 'f', label: 'F', ariaLabel: 'Ratio F', min: 0, step: 0.1 },
];

function DivisionRatioOptions({
  options,
  setOptions,
}: {
  options: OristudioCpToolOptions;
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>;
}) {
  const initialHalves = ratioHalvesFromExpression(options.divisionRatio);
  const [leftDraft, setLeftDraft] = useState(() => formatOrieditaRatioHalf(initialHalves.left));
  const [rightDraft, setRightDraft] = useState(() => formatOrieditaRatioHalf(initialHalves.right));
  const ratio = evaluateOrieditaRatioExpression(options.divisionRatio);
  const leftInvalid = parseOrieditaRatioHalfInput(leftDraft) === null;
  const rightInvalid = parseOrieditaRatioHalfInput(rightDraft) === null;

  const applyRatioExpression = useCallback(
    (divisionRatio: OristudioCpRatioExpression) => {
      const halves = ratioHalvesFromExpression(divisionRatio);
      setLeftDraft(formatOrieditaRatioHalf(halves.left));
      setRightDraft(formatOrieditaRatioHalf(halves.right));
      setOptions((current) => ({ ...current, divisionRatio }));
    },
    [setOptions]
  );

  const updateSimpleHalf = useCallback(
    (side: 'left' | 'right', value: string) => {
      if (side === 'left') {
        setLeftDraft(value);
      } else {
        setRightDraft(value);
      }
      const parsed = parseOrieditaRatioHalfInput(value);
      if (!parsed) return;
      setOptions((current) => {
        const halves = ratioHalvesFromExpression(current.divisionRatio);
        return {
          ...current,
          divisionRatio: ratioExpressionFromHalves(
            side === 'left' ? parsed : halves.left,
            side === 'right' ? parsed : halves.right
          ),
        };
      });
    },
    [setOptions]
  );

  const updateExactField = useCallback(
    (field: keyof OristudioCpRatioExpression, value: number) => {
      const divisionRatio = {
        ...options.divisionRatio,
        [field]: value,
      };
      applyRatioExpression(divisionRatio);
    },
    [applyRatioExpression, options.divisionRatio]
  );

  return (
    <div className="cp-context-panel__group">
      <div className="cp-context-panel__group-title">Divide by ratio</div>
      <div className="cp-context-panel__ratio-simple">
        <TextToolOption
          label="Left"
          ariaLabel="Left segment ratio"
          value={leftDraft}
          invalid={leftInvalid}
          onChange={(value) => updateSimpleHalf('left', value)}
        />
        <TextToolOption
          label="Right"
          ariaLabel="Right segment ratio"
          value={rightDraft}
          invalid={rightInvalid}
          onChange={(value) => updateSimpleHalf('right', value)}
        />
      </div>
      <div className="cp-context-panel__preset-grid" aria-label="Ratio presets">
        {ORISTUDIO_CP_RATIO_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="cp-context-panel__preset"
            data-active={sameRatioExpression(options.divisionRatio, preset.expression) || undefined}
            aria-label={`Use ${preset.label} ratio`}
            onClick={() => applyRatioExpression(preset.expression)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="cp-context-panel__readout">
        Computed ratio {formatOrieditaRatioNumber(ratio.ratioS)} :{' '}
        {formatOrieditaRatioNumber(ratio.ratioT)}
      </div>
      <details className="cp-context-panel__details">
        <summary>Exact form</summary>
        <div className="cp-context-panel__ratio-grid">
          {RATIO_FIELDS.map((field) => (
            <NumericToolOption
              key={field.key}
              label={field.label}
              ariaLabel={field.ariaLabel}
              min={field.min}
              max={999}
              step={field.step}
              value={options.divisionRatio[field.key]}
              onChange={(value) => updateExactField(field.key, value)}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function sameRatioExpression(
  left: OristudioCpRatioExpression,
  right: OristudioCpRatioExpression
): boolean {
  return RATIO_FIELDS.every((field) => left[field.key] === right[field.key]);
}

const ANGLE_FIELDS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

const RGB_FIELDS: readonly {
  key: keyof OristudioCpRgbColor;
  label: string;
  ariaLabel: string;
}[] = [
  { key: 'red', label: 'R', ariaLabel: 'Circle color red' },
  { key: 'green', label: 'G', ariaLabel: 'Circle color green' },
  { key: 'blue', label: 'B', ariaLabel: 'Circle color blue' },
];

function updateAngleField(
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>,
  index: number,
  value: number
) {
  setOptions((current) => {
    const angleSystemAngles = [...current.angleSystemAngles] as OristudioCpToolOptions['angleSystemAngles'];
    angleSystemAngles[index] = value;
    return {
      ...current,
      angleSystemAngles,
    };
  });
}

function updateCustomCircleColor(
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>,
  field: keyof OristudioCpRgbColor,
  value: number
) {
  setOptions((current) => ({
    ...current,
    customCircleColor: {
      ...current.customCircleColor,
      [field]: Math.round(value),
    },
  }));
}

function NumericToolOption({
  label,
  ariaLabel,
  min,
  max,
  step,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  min?: number;
  max?: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="cp-context-panel__field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number.parseFloat(event.currentTarget.value);
          if (!Number.isFinite(parsed)) return;
          onChange(clampToolNumber(parsed, min, max));
        }}
      />
    </label>
  );
}

function TextToolOption({
  label,
  ariaLabel,
  value,
  invalid,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="cp-context-panel__field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        type="text"
        value={value}
        aria-invalid={invalid}
        data-invalid={invalid || undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function TextAreaToolOption({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="cp-context-panel__field cp-context-panel__field--textarea">
      <span>{label}</span>
      <textarea
        aria-label={ariaLabel}
        rows={3}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function SelectToolOption({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: OristudioCpCustomLineType;
  options: readonly { value: OristudioCpCustomLineType; label: string }[];
  onChange: (value: OristudioCpCustomLineType) => void;
}) {
  return (
    <label className="cp-context-panel__field">
      <span>{label}</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as OristudioCpCustomLineType)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxToolOption({
  label,
  ariaLabel,
  checked,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="cp-context-panel__checkbox">
      <input
        aria-label={ariaLabel}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function clampToolNumber(value: number, min: number | undefined, max: number | undefined): number {
  const lowerBounded = min === undefined ? value : Math.max(min, value);
  return max === undefined ? lowerBounded : Math.min(max, lowerBounded);
}

function shortStatus(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'Crease pattern unavailable';
  const sentence = trimmed.split(/[.;]\s+/u)[0] ?? trimmed;
  return sentence.length > 54 ? `${sentence.slice(0, 51)}...` : sentence;
}
