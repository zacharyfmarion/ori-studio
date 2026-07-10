import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FlipHorizontal,
  FlipVertical,
  GitBranch,
  ListChecks,
  RotateCcw,
  RotateCw,
  Trash2,
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
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureState,
  OristudioCpFoldedRenderGeometry,
  OristudioCpFoldedRenderPaint,
  OristudioCpFoldedRenderPathCommand,
  OristudioCpFoldedRenderPrimitive,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpFoldedRenderStroke,
  OristudioCpGridMetadata,
  OristudioCpLineColor,
  OristudioCpLineSegment,
  OristudioCpRgbColor,
  OristudioCpRgbaColor,
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
  cpActionByUpstreamMouseMode,
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
import {
  ORISTUDIO_CP_EXTRA_LINE_COLOR_PALETTE,
  cpPaletteEntryForColor,
} from '../../lib/oristudioCpPalette';
import {
  activeLineColorFromOrieditaMetadata,
  activeMouseModeFromOrieditaMetadata,
  canvasToolOptionsFromOrieditaMetadata,
} from '../../lib/orieditaNativeMetadata';
import {
  orieditaCameraFromMetadata,
  orieditaCameraSvgScale,
  orieditaObjectToSvg,
  orieditaSvgToObject,
} from '../../lib/orieditaCamera';
import {
  CP_EDITABLE_CANVAS_RECT,
  CP_EDITABLE_FIT_RECT,
  CP_PAPER_RECT,
  CP_PAPER_SHADOW_RECT,
  CP_WORLD_RECT,
  cpLineAssignmentLabel,
  cpLineColorClass,
  cpLineStyleColorKind,
  cpSelectionSize,
  cpSvgPointToModel,
  emptyOristudioCpSelection,
  expandedModelBoundsFromPoints,
  getCpVertices,
  getOrieditaGridBasis,
  modelPointToCpSvg,
  nearestCpSnapTarget,
  nearestOrieditaDrawPointTarget,
  orieditaGridLinesForModelBounds,
  ORIEDITA_PAPER_BOUNDS,
  textCoordinate,
  visibleOrieditaGridMetadata,
  type CpGridLine,
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
  selectedFoldableCpLineIds,
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
import { useCpRendererStore } from '../../store/cpRendererStore';
import { CreasePatternWebglCanvas } from '../../cp-workspace/CreasePatternWebglCanvas';
import { resolveCpLineColor } from '../../cp-workspace/adapters/cpLineColor';
import { readCssVarColor } from '../../cp-workspace/renderer/cssColor';
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
import { CP_TOOL_OPTIONS_PANE_SLOT_ID } from './cpToolOptionsPortal';
import type { FoldDocument } from '../../engine/types';

function creaseClass(fold: string, kind: string, mode: 'mvf' | 'agrh'): string {
  if (mode === 'agrh') return `crease crease--kind-${kind}`;
  return `crease crease--fold-${fold}`;
}

function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

const EMPTY_DIAGNOSTIC_ENTRIES: OristudioCpDiagnosticEntry[] = [];

const FOLDED_DISPLAY_STYLE_OPTIONS: Array<{
  value: OristudioCpFoldedFigureDisplayStyle;
  label: string;
}> = [
  { value: 'Paper5', label: 'Paper' },
  { value: 'Transparent3', label: 'Transparent' },
  { value: 'Wire2', label: 'Wire' },
  { value: 'Development1', label: 'Dev 1' },
  { value: 'Development4', label: 'Dev 4' },
  { value: 'None0', label: 'None' },
];

const FOLDED_STATE_OPTIONS: Array<{
  value: OristudioCpFoldedFigureState;
  label: string;
  title: string;
}> = [
  { value: 'Front0', label: 'F', title: 'Front' },
  { value: 'Back1', label: 'B', title: 'Back' },
  { value: 'Both2', label: 'Both', title: 'Both' },
  { value: 'Transparent3', label: 'T', title: 'Transparent state' },
];

interface CpDiagnosticHudStatus {
  label: string;
  detail: string | null;
  tone: 'ok' | 'warn' | 'error';
}

interface CpDiagnosticBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  center: Point;
}

type CpDiagnosticMarkerShape =
  | 'generic'
  | 'triangle'
  | 'square'
  | 'circle'
  | 'ring'
  | 'little-big-little'
  | 'none';

type CpDiagnosticMarkerTone = 'danger' | 'warning' | 'mountain' | 'valley' | 'neutral' | 'unknown';

interface CpDiagnosticMarkerStyle {
  shape: CpDiagnosticMarkerShape;
  tone: CpDiagnosticMarkerTone;
}

const CP_DIAGNOSTIC_FOCUS_PADDING = 56;
const CP_DIAGNOSTIC_MARKER_SIZE = 24;
const CP_DIAGNOSTIC_LBL_RADIUS = 18;

function diagnosticEntryPoints(entry: OristudioCpDiagnosticEntry): Point[] {
  const points: Point[] = [];
  if (entry.point) points.push(entry.point);
  for (const segment of entry.segments ?? []) {
    points.push(segment.a, segment.b);
  }
  for (const sector of entry.little_big_little ?? []) {
    points.push(sector.segment.a, sector.segment.b);
  }
  return points;
}

function boundsFromPoints(points: Point[]): CpDiagnosticBounds | null {
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    minX,
    minY,
    maxX,
    maxY,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

function diagnosticEntryBounds(entry: OristudioCpDiagnosticEntry): CpDiagnosticBounds | null {
  return boundsFromPoints(diagnosticEntryPoints(entry));
}

function svgPointToContentPoint(point: Point, viewBox: { x: number; y: number }): Point {
  return { x: point.x - viewBox.x, y: point.y - viewBox.y };
}

function isFlatFoldabilityDiagnostic(entry: OristudioCpDiagnosticEntry): boolean {
  return (
    entry.kind === 'Check4' ||
    entry.kind === 'CheckCamv' ||
    entry.rule === 'NumberOfFolds' ||
    entry.rule === 'Angles' ||
    entry.rule === 'Maekawa' ||
    entry.rule === 'LittleBigLittle'
  );
}

function cpDiagnosticMarkerTone(entry: OristudioCpDiagnosticEntry): CpDiagnosticMarkerTone {
  switch (entry.violation_color) {
    case 'NotEnoughMountain':
      return 'mountain';
    case 'NotEnoughValley':
      return 'valley';
    case 'Equal':
    case 'Correct':
      return 'neutral';
    case 'Unknown':
      return 'unknown';
    default:
      return entry.severity === 'warning' ? 'warning' : 'danger';
  }
}

function cpDiagnosticMarkerStyle(entry: OristudioCpDiagnosticEntry): CpDiagnosticMarkerStyle {
  if (!isFlatFoldabilityDiagnostic(entry)) {
    return {
      shape: 'generic',
      tone: cpDiagnosticMarkerTone(entry),
    };
  }

  switch (entry.rule) {
    case 'NumberOfFolds':
      return { shape: 'triangle', tone: cpDiagnosticMarkerTone(entry) };
    case 'Angles':
      return {
        shape: entry.violation_color === 'Correct' ? 'ring' : 'circle',
        tone: cpDiagnosticMarkerTone(entry),
      };
    case 'Maekawa':
      return { shape: 'square', tone: cpDiagnosticMarkerTone(entry) };
    case 'LittleBigLittle':
      return { shape: 'little-big-little', tone: cpDiagnosticMarkerTone(entry) };
    case 'None':
      return { shape: 'none', tone: cpDiagnosticMarkerTone(entry) };
    default:
      return { shape: 'generic', tone: cpDiagnosticMarkerTone(entry) };
  }
}

function diagnosticSegmentEndpoint(point: Point, segment: OristudioCpLineSegment): Point {
  const distanceA = squaredDistance(point, segment.a);
  const distanceB = squaredDistance(point, segment.b);
  return distanceA > distanceB ? segment.a : segment.b;
}

function squaredDistance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function diagnosticSectorPoint(
  center: Point,
  segment: OristudioCpLineSegment,
  modelToSvg: (point: Point) => Point
): Point {
  const endpoint = modelToSvg(diagnosticSegmentEndpoint(center, segment));
  const svgCenter = modelToSvg(center);
  const dx = endpoint.x - svgCenter.x;
  const dy = endpoint.y - svgCenter.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return svgCenter;
  return {
    x: svgCenter.x + (dx / length) * CP_DIAGNOSTIC_LBL_RADIUS,
    y: svgCenter.y + (dy / length) * CP_DIAGNOSTIC_LBL_RADIUS,
  };
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

  if (operationId === 'LineSegmentDelete') {
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

// Oriedita `CREASE_TOGGLE_MV_58` (the 'C' tool): clicking a crease flips its
// mountain/valley assignment in place, keeping the tool active for the next click.
function isCreaseToggleMvClickTool(operationId: string | null | undefined): boolean {
  return operationId === 'CreaseToggleMv';
}

function isSquareBisectorOperation(operationId: string | null | undefined): boolean {
  return operationId === 'SquareBisector';
}

// Oriedita `LINE_SEGMENT_DELETE_3` (the eraser tool): clicking a crease deletes
// it (honoring the tool-options line-type filter), keeping the tool active for
// the next click.
function isLineEraseClickTool(operationId: string | null | undefined): boolean {
  return operationId === 'LineSegmentDelete';
}

// Mirrors the kernel `CustomLineType::matches`: does a crease's line color pass
// the eraser's line-type filter? Used to preview which crease a click erases.
function lineColorMatchesCustomType(
  color: string,
  lineType: OristudioCpCustomLineType
): boolean {
  switch (lineType) {
    case 'Any':
      return true;
    case 'Edge':
      return color === 'Black0';
    case 'MountainAndValley':
      return color === 'Red1' || color === 'Blue2';
    case 'Mountain':
      return color === 'Red1';
    case 'Valley':
      return color === 'Blue2';
    case 'Aux':
      return color === 'Cyan3';
    default:
      return false;
  }
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
  onSelectLineColor,
  shortcutOverrides,
}: {
  activeLineColor: OristudioCpLineColor;
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

function FoldedFigureMenuButton({
  figures,
  activeFigure,
  startingFaceId,
  caseDraft,
  onStartingFaceIdChange,
  onCaseDraftChange,
  onSelectFigure,
  onDisplayStyle,
  onModelUpdate,
  onFoldToCase,
  onDuplicate,
  onDelete,
}: {
  figures: OristudioCpFoldedFigureEntry[];
  activeFigure: OristudioCpFoldedFigureEntry | null;
  startingFaceId: number;
  caseDraft: string;
  onStartingFaceIdChange: (startingFaceId: number) => void;
  onCaseDraftChange: (draft: string) => void;
  onSelectFigure: (id: string) => void;
  onDisplayStyle: (displayStyle: OristudioCpFoldedFigureDisplayStyle) => void;
  onModelUpdate: (update: Partial<OristudioCpFoldedFigureModel>) => void;
  onFoldToCase: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const model = activeFigure?.snapshot?.model ?? null;
  const activeReady =
    activeFigure?.status === 'ready' && activeFigure.handle !== null && activeFigure.snapshot !== null;
  const currentCase = Math.max(activeFigure?.snapshot?.discovered_fold_cases ?? 1, 1);
  const canJumpCase = activeReady && Number.isFinite(Number(caseDraft));

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

  const changeStartingFace = (value: string) => {
    const parsed = Number(value);
    onStartingFaceIdChange(Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : 1);
  };

  return (
    <div className="viewport-toolbar__menu-anchor folded-figure-menu" ref={menuRef}>
      <IconButton
        size="sm"
        variant="toolbar"
        title="Folded models"
        aria-haspopup="menu"
        aria-expanded={open}
        isActive={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ListChecks size={14} />
      </IconButton>
      {open && (
        <div
          className="viewport-toolbar__dropdown folded-figure-menu__panel"
          role="menu"
          aria-label="Folded model controls"
        >
          <div className="folded-figure-menu__header">
            <span>Folded models</span>
            <span>{activeFigure ? activeFigure.title : 'None'}</span>
          </div>
          {figures.length > 0 && (
            <div className="folded-figure-menu__list">
              {figures.map((figure) => (
                <button
                  key={figure.id}
                  type="button"
                  className="folded-figure-menu__figure"
                  data-active={figure.id === activeFigure?.id ? true : undefined}
                  data-status={figure.status}
                  role="menuitemradio"
                  aria-checked={figure.id === activeFigure?.id}
                  onClick={() => onSelectFigure(figure.id)}
                >
                  <span>{figure.title}</span>
                  <small>{figure.status === 'ready' ? `Case ${figure.snapshot?.discovered_fold_cases ?? 0}` : figure.status}</small>
                </button>
              ))}
            </div>
          )}
          <label className="folded-figure-menu__field">
            <span>Start</span>
            <input
              aria-label="Starting face"
              type="number"
              min={1}
              step={1}
              value={startingFaceId}
              onChange={(event) => changeStartingFace(event.currentTarget.value)}
            />
          </label>
          <label className="folded-figure-menu__field">
            <span>Display</span>
            <select
              aria-label="Folded display style"
              value={activeFigure?.displayStyle ?? 'Paper5'}
              disabled={!activeReady}
              onChange={(event) =>
                onDisplayStyle(event.currentTarget.value as OristudioCpFoldedFigureDisplayStyle)
              }
            >
              {FOLDED_DISPLAY_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="folded-figure-menu__field folded-figure-menu__field--segmented">
            <span>Side</span>
            <SegmentedControl
              aria-label="Folded model side"
              options={FOLDED_STATE_OPTIONS}
              value={model?.state ?? 'Front0'}
              onChange={(state) => onModelUpdate({ state })}
            />
          </div>
          <label className="folded-figure-menu__field">
            <span>Case</span>
            <div className="folded-figure-menu__case">
              <input
                aria-label="Fold case"
                type="number"
                min={1}
                step={1}
                value={caseDraft}
                disabled={!activeReady}
                onChange={(event) => onCaseDraftChange(event.currentTarget.value)}
                onBlur={() => {
                  if (canJumpCase) onFoldToCase();
                }}
              />
              <IconButton
                size="sm"
                variant="toolbar"
                title="Go to folded case"
                disabled={!canJumpCase}
                onClick={onFoldToCase}
              >
                <ChevronRight size={14} />
              </IconButton>
            </div>
          </label>
          <div className="folded-figure-menu__hint">Current {currentCase}</div>
          <div className="folded-figure-menu__toggle-row">
            <span>Shadow</span>
            <Toggle
              checked={model?.display_shadows ?? false}
              disabled={!activeReady}
              onChange={(display_shadows) => onModelUpdate({ display_shadows })}
              aria-label="Show folded model shadow"
            />
          </div>
          <div className="folded-figure-menu__toggle-row">
            <span>Color alpha</span>
            <Toggle
              checked={model?.transparency_color ?? false}
              disabled={!activeReady}
              onChange={(transparency_color) => onModelUpdate({ transparency_color })}
              aria-label="Use colored folded transparency"
            />
          </div>
          <label className="folded-figure-menu__field folded-figure-menu__field--range">
            <span>Alpha</span>
            <input
              aria-label="Folded transparency"
              type="range"
              min={0}
              max={255}
              step={1}
              value={model?.transparent_transparency ?? 16}
              disabled={!activeReady}
              onChange={(event) =>
                onModelUpdate({
                  transparent_transparency: Math.max(
                    0,
                    Math.min(255, Math.round(Number(event.currentTarget.value)))
                  ),
                })
              }
            />
          </label>
          <div className="folded-figure-menu__actions">
            <IconButton
              size="sm"
              variant="toolbar"
              title="Duplicate folded model"
              disabled={!activeFigure?.handle}
              onClick={() => onDuplicate()}
            >
              <Copy size={14} />
            </IconButton>
            <IconButton
              size="sm"
              variant="toolbar"
              title="Delete folded model"
              disabled={!activeFigure}
              onClick={() => onDelete()}
            >
              <Trash2 size={14} />
            </IconButton>
          </div>
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

function foldedFigureIdFromEventTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest('[data-folded-figure-id]')?.getAttribute('data-folded-figure-id') ?? null;
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

interface FoldedFigureMoveDrag {
  pointerId: number;
  figureId: string;
  lastSvgPoint: Point;
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
  const cpViewportRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const [toolOptionsPortalTarget, setToolOptionsPortalTarget] = useState<HTMLElement | null>(null);
  // Registered by the infinite grid layer so viewport transforms can trigger a
  // grid recompute without re-rendering the whole panel on every pan frame.
  const gridSyncRef = useRef<(() => void) | null>(null);
  const zoomPercentRef = useRef(100);
  const viewportPanningRef = useRef(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [spacePressed, setSpacePressed] = useState(false);
  const [cursorModelPoint, setCursorModelPoint] = useState<Point | null>(null);
  const [snapTarget, setSnapTarget] = useState<CpSnapTarget | null>(null);
  const [cpToolState, setCpToolState] = useState(IDLE_ORISTUDIO_CP_TOOL_STATE);
  const [activeCpLineColor, setActiveCpLineColor] = useState<OristudioCpLineColor>('Red1');
  const [foldStartingFaceId, setFoldStartingFaceId] = useState(1);
  const [foldCaseDraft, setFoldCaseDraft] = useState('1');
  const [cpToolOptions, setCpToolOptions] = useState<OristudioCpToolOptions>(
    DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS
  );
  const [cpToolPoints, setCpToolPoints] = useState<Point[]>([]);
  const [cpToolPath, setCpToolPath] = useState<Point[]>([]);
  // Live preview box for the right-button-drag erase gesture.
  const [rightEraseBox, setRightEraseBox] = useState<readonly [Point, Point] | null>(null);
  const [pendingLengthenLineId, setPendingLengthenLineId] = useState<number | null>(null);
  const [pendingSquareBisectorLineIds, setPendingSquareBisectorLineIds] = useState<number[]>([]);
  const [cpMeasurementSlots, setCpMeasurementSlots] = useState<CpMeasurementSlots>(
    createEmptyCpMeasurementSlots
  );
  const [cpCommandPreview, setCpCommandPreview] = useState<OristudioCpCommandPreview | null>(null);
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
  const foldedFigureMoveDragRef = useRef<FoldedFigureMoveDrag | null>(null);
  const restoredNativeCanvasModelRef = useRef<string | null>(null);
  const cpToolDragRef = useRef<{
    operationId: OristudioCpCommandDefinition['operationId'];
    actionId: OristudioCpCommandActionDefinition['id'] | null;
    mode: 'drag-line' | 'drag-path' | 'drag-box' | 'text-drag';
    pointerId: number;
    points: Point[];
    replaceSelection?: boolean;
    textId?: number;
  } | null>(null);
  // Oriedita's universal right-button-drag erase: dragging a box with the right
  // mouse button deletes every crease in that region (any line type), and a
  // plain right-click deletes the crease under the cursor. Works with any tool.
  const rightEraseDragRef = useRef<{
    pointerId: number;
    startPoint: Point;
    currentPoint: Point;
  } | null>(null);

  const project = useWorkspaceStore((state) => state.project);
  const status = useWorkspaceStore((state) => state.status);
  const error = useWorkspaceStore((state) => state.error);
  const documentMode = useWorkspaceStore((state) => state.documentMode);
  const importedCreasePattern = useWorkspaceStore((state) => state.importedCreasePattern);
  const oristudioCpDocument = useWorkspaceStore((state) => state.oristudioCpDocument);
  const oristudioCpCamvResult = useWorkspaceStore((state) => state.oristudioCpCamvResult);
  const oristudioCpSelection = useWorkspaceStore((state) => state.oristudioCpSelection);
  const oristudioCpActionRequest = useWorkspaceStore((state) => state.oristudioCpActionRequest);
  const oristudioCpFoldedFigures = useWorkspaceStore((state) => state.oristudioCpFoldedFigures);
  const oristudioCpActiveFoldedFigureId = useWorkspaceStore(
    (state) => state.oristudioCpActiveFoldedFigureId
  );
  const oristudioCpActiveDiagnosticId = useWorkspaceStore(
    (state) => state.oristudioCpActiveDiagnosticId
  );
  const oristudioCpViewport = useWorkspaceStore((state) => state.oristudioCpViewport);
  const cpRendererMode = useCpRendererStore((state) => state.mode);
  const projectLoadId = useWorkspaceStore((state) => state.projectLoadId);
  // Crease lines always use Oriedita's default M/V/flat/border coloring; the
  // color-by toggle has been removed from the CP panel header.
  const mode = 'mvf' as const;
  const selection = useWorkspaceStore((state) => state.selection);
  const select = useWorkspaceStore((state) => state.select);
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
  const foldOristudioCpDocument = useWorkspaceStore((state) => state.foldOristudioCpDocument);
  const foldAnotherOristudioCpFigure = useWorkspaceStore(
    (state) => state.foldAnotherOristudioCpFigure
  );
  const foldOristudioCpFigureToCase = useWorkspaceStore(
    (state) => state.foldOristudioCpFigureToCase
  );
  const setOristudioCpActiveFoldedFigure = useWorkspaceStore(
    (state) => state.setOristudioCpActiveFoldedFigure
  );
  const moveOristudioCpFoldedFigure = useWorkspaceStore(
    (state) => state.moveOristudioCpFoldedFigure
  );
  const setOristudioCpFoldedFigureDisplayStyle = useWorkspaceStore(
    (state) => state.setOristudioCpFoldedFigureDisplayStyle
  );
  const updateOristudioCpFoldedFigureModel = useWorkspaceStore(
    (state) => state.updateOristudioCpFoldedFigureModel
  );
  const duplicateOristudioCpFoldedFigure = useWorkspaceStore(
    (state) => state.duplicateOristudioCpFoldedFigure
  );
  const deleteOristudioCpFoldedFigure = useWorkspaceStore(
    (state) => state.deleteOristudioCpFoldedFigure
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

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const updateTarget = () => {
      const target = document.getElementById(CP_TOOL_OPTIONS_PANE_SLOT_ID);
      setToolOptionsPortalTarget((current) => (current === target ? current : target));
    };

    updateTarget();
    if (typeof MutationObserver === 'undefined' || !document.body) return undefined;

    const observer = new MutationObserver(updateTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const editableCp = oristudioCpDocument?.document ?? null;
  const editableCpHandle = oristudioCpDocument?.handle ?? null;
  // Identifies a genuine document load; stable across edits and undo/redo so the
  // viewport auto-fit does not re-run when history is restored in place.
  const editableCpLoadSerial = oristudioCpDocument?.loadSerial ?? null;
  const editableCpSummary = oristudioCpDocument?.summary ?? null;
  const nativeActiveLineColor = useMemo(
    () => activeLineColorFromOrieditaMetadata(editableCp?.metadata),
    [editableCp?.metadata]
  );
  const nativeActiveMouseMode = useMemo(
    () => activeMouseModeFromOrieditaMetadata(editableCp?.metadata),
    [editableCp?.metadata]
  );
  const nativeCanvasToolOptions = useMemo(
    () => canvasToolOptionsFromOrieditaMetadata(editableCp?.metadata),
    [editableCp?.metadata]
  );
  const nativeCreasePatternCamera = useMemo(
    () => orieditaCameraFromMetadata(editableCp?.metadata),
    [editableCp?.metadata]
  );
  // SVG-only: its decorations live in user units, so track an imported camera's
  // zoom to keep them proportional. The WebGL surface sizes decorations in screen
  // space and must not use this. (Retired with the SVG render path.)
  const svgUserSpaceDecorationScale = nativeCreasePatternCamera
    ? Math.abs(nativeCreasePatternCamera.cameraZoomX) || 1
    : 1;
  const cpCanvasRect = editableCp ? CP_EDITABLE_CANVAS_RECT : CP_WORLD_RECT;
  const cpFitRect = editableCp ? CP_EDITABLE_FIT_RECT : CP_WORLD_RECT;
  const cpCanvasViewBox = `${cpCanvasRect.x} ${cpCanvasRect.y} ${cpCanvasRect.width} ${cpCanvasRect.height}`;
  const editableCpBounds = ORIEDITA_PAPER_BOUNDS;
  const editableModelToSvg = useCallback(
    (point: Point) =>
      nativeCreasePatternCamera
        ? orieditaObjectToSvg(point, nativeCreasePatternCamera)
        : modelPointToCpSvg(point, editableCpBounds),
    [editableCpBounds, nativeCreasePatternCamera]
  );
  const editableSvgToModel = useCallback(
    (point: Point) =>
      nativeCreasePatternCamera
        ? orieditaSvgToObject(point, nativeCreasePatternCamera)
        : cpSvgPointToModel(point, editableCpBounds),
    [editableCpBounds, nativeCreasePatternCamera]
  );
  const editableCircleRadiusToSvg = useCallback(
    (radius: number) => {
      if (nativeCreasePatternCamera) {
        return Math.max(1, radius * orieditaCameraSvgScale(nativeCreasePatternCamera).x);
      }
      return Math.max(
        1,
        (radius / Math.max(editableCpBounds.spanX, editableCpBounds.spanY)) *
          Math.min(CP_PAPER_RECT.width, CP_PAPER_RECT.height)
      );
    },
    [editableCpBounds, nativeCreasePatternCamera]
  );
  const editableCpVisibleGrid = useMemo(
    () =>
      editableCp && oristudioCpViewport.gridVisible
        ? visibleOrieditaGridMetadata(editableCp.crease_pattern.grid)
        : null,
    [editableCp, oristudioCpViewport.gridVisible]
  );
  // Fallback grid extent for environments where the live viewport transform is
  // unavailable (initial paint before fit, jsdom tests). Mirrors the previous
  // fixed-world extent so a grid is always present; the live layer widens this
  // to the visible viewport once a screen CTM is available.
  const editableCpFallbackGridBounds = useMemo(() => {
    const corners = [
      { x: cpCanvasRect.x, y: cpCanvasRect.y },
      { x: cpCanvasRect.x + cpCanvasRect.width, y: cpCanvasRect.y },
      { x: cpCanvasRect.x, y: cpCanvasRect.y + cpCanvasRect.height },
      { x: cpCanvasRect.x + cpCanvasRect.width, y: cpCanvasRect.y + cpCanvasRect.height },
    ].map((point) => editableSvgToModel(point));
    return expandedModelBoundsFromPoints(corners, 0);
  }, [cpCanvasRect, editableSvgToModel]);
  const editableCpGridWidth = useMemo(
    () =>
      editableCp
        ? getOrieditaGridBasis(visibleOrieditaGridMetadata(editableCp.crease_pattern.grid)).gridWidth
        : undefined,
    [editableCp]
  );
  useEffect(() => {
    if (!editableCp) {
      restoredNativeCanvasModelRef.current = null;
      return;
    }

    const restoreKey = `${projectLoadId}:${editableCpHandle ?? 'none'}`;
    if (restoredNativeCanvasModelRef.current === restoreKey) return;
    restoredNativeCanvasModelRef.current = restoreKey;
    if (nativeActiveLineColor) setActiveCpLineColor(nativeActiveLineColor);
    if (nativeCanvasToolOptions) {
      setCpToolOptions((current) => ({ ...current, ...nativeCanvasToolOptions }));
    }
  }, [
    editableCp,
    editableCpHandle,
    nativeActiveLineColor,
    nativeCanvasToolOptions,
    projectLoadId,
  ]);
  const activeFoldedFigure = useMemo(
    () =>
      oristudioCpFoldedFigures.find((figure) => figure.id === oristudioCpActiveFoldedFigureId) ??
      oristudioCpFoldedFigures.find(
        (figure) => figure.sourceKind === 'generated-from-current-cp' && figure.snapshot?.wireframe
      ) ??
      null,
    [oristudioCpActiveFoldedFigureId, oristudioCpFoldedFigures]
  );
  const generatedFoldedFigures = useMemo(
    () =>
      oristudioCpFoldedFigures.filter(
        (figure) => figure.sourceKind === 'generated-from-current-cp'
      ),
    [oristudioCpFoldedFigures]
  );
  const foldedFigureStatusLabel = activeFoldedFigure
    ? activeFoldedFigure.status === 'ready' || activeFoldedFigure.status === 'stale'
      ? `Case ${activeFoldedFigure.snapshot?.discovered_fold_cases ?? 0}`
      : activeFoldedFigure.status === 'loading'
        ? 'Folding'
        : activeFoldedFigure.status === 'error'
          ? 'Fold error'
          : 'Unsupported'
    : 'No fold';
  const canFoldAnother =
    activeFoldedFigure?.status === 'ready' &&
    activeFoldedFigure.handle !== null &&
    activeFoldedFigure.snapshot?.find_another_overlap_valid === true;
  const selectedEditableFoldLineIds = useMemo(
    () => selectedFoldableCpLineIds(editableCp, oristudioCpSelection),
    [editableCp, oristudioCpSelection]
  );
  const canFoldSelectedModel = selectedEditableFoldLineIds.length > 0;

  useEffect(() => {
    setFoldCaseDraft(String(Math.max(activeFoldedFigure?.snapshot?.discovered_fold_cases ?? 1, 1)));
  }, [activeFoldedFigure?.id, activeFoldedFigure?.snapshot?.discovered_fold_cases]);

  const handleFoldModel = useCallback(() => {
    if (!canFoldSelectedModel) return;
    void foldOristudioCpDocument({
      startingFaceId: foldStartingFaceId,
      lineIds: selectedEditableFoldLineIds,
    });
  }, [canFoldSelectedModel, foldOristudioCpDocument, foldStartingFaceId, selectedEditableFoldLineIds]);
  const handleFoldAnother = useCallback(() => {
    if (!activeFoldedFigure) return;
    void foldAnotherOristudioCpFigure(activeFoldedFigure.id);
  }, [activeFoldedFigure, foldAnotherOristudioCpFigure]);
  const handleFoldToCase = useCallback(() => {
    if (!activeFoldedFigure || activeFoldedFigure.status !== 'ready') return;
    const objective = Math.max(1, Math.round(Number(foldCaseDraft)));
    if (!Number.isFinite(objective)) {
      setFoldCaseDraft(String(Math.max(activeFoldedFigure.snapshot?.discovered_fold_cases ?? 1, 1)));
      return;
    }
    setFoldCaseDraft(String(objective));
    void foldOristudioCpFigureToCase(activeFoldedFigure.id, objective);
  }, [activeFoldedFigure, foldCaseDraft, foldOristudioCpFigureToCase]);
  const handleFoldedDisplayStyle = useCallback(
    (displayStyle: OristudioCpFoldedFigureDisplayStyle) => {
      if (!activeFoldedFigure) return;
      void setOristudioCpFoldedFigureDisplayStyle(activeFoldedFigure.id, displayStyle);
    },
    [activeFoldedFigure, setOristudioCpFoldedFigureDisplayStyle]
  );
  const handleFoldedModelUpdate = useCallback(
    (update: Partial<OristudioCpFoldedFigureModel>) => {
      if (!activeFoldedFigure) return;
      void updateOristudioCpFoldedFigureModel(activeFoldedFigure.id, update);
    },
    [activeFoldedFigure, updateOristudioCpFoldedFigureModel]
  );
  const handleDuplicateFoldedFigure = useCallback(() => {
    if (!activeFoldedFigure) return;
    void duplicateOristudioCpFoldedFigure(activeFoldedFigure.id);
  }, [activeFoldedFigure, duplicateOristudioCpFoldedFigure]);
  const handleDeleteFoldedFigure = useCallback(() => {
    if (!activeFoldedFigure) return;
    void deleteOristudioCpFoldedFigure(activeFoldedFigure.id);
  }, [activeFoldedFigure, deleteOristudioCpFoldedFigure]);
  const editableCpVertices = useMemo(() => getCpVertices(editableCp), [editableCp]);
  const editableCpVertexPoints = useMemo(
    () => editableCpVertices.map((vertex) => vertex.point),
    [editableCpVertices]
  );
  const importedFoldedForms = useMemo(
    () =>
      (importedCreasePattern?.sourceFold?.file_frames ?? [])
        .filter(isRenderableFoldedFormFrame),
    [importedCreasePattern?.sourceFold]
  );
  const camvIssuesVisible = oristudioCpViewport.camvIssuesVisible !== false;
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
  const eraseHoverLineId = useMemo(() => {
    if (
      cpToolState.activeOperationId !== 'LineSegmentDelete' ||
      cpToolState.phase !== 'active' ||
      !editableCp ||
      !cursorModelPoint
    ) {
      return null;
    }
    const id = nearestEditableCpLineId(
      editableCp,
      cursorModelPoint,
      modelSelectionDistance(editableCpBounds, zoomPercent / 100)
    );
    if (id === null) return null;
    const segment = editableCp.crease_pattern.line_segments[id - 1];
    if (
      segment &&
      !lineColorMatchesCustomType(segment.color, cpToolOptions.customLineType)
    ) {
      return null;
    }
    return id;
  }, [
    cpToolState.activeOperationId,
    cpToolState.phase,
    editableCp,
    cursorModelPoint,
    editableCpBounds,
    zoomPercent,
    cpToolOptions.customLineType,
  ]);
  const highlightedEditableLineIds = useMemo(
    () => [
      ...pendingSquareBisectorLineIds,
      ...(pendingLengthenLineId === null ? [] : [pendingLengthenLineId]),
      ...(eraseHoverLineId === null ? [] : [eraseHoverLineId]),
    ],
    [pendingLengthenLineId, pendingSquareBisectorLineIds, eraseHoverLineId]
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
  const renderedCommandPreviewBoxes = useMemo(
    () => [
      ...(renderedCommandPreviewBox ? [renderedCommandPreviewBox] : []),
      ...(rightEraseBox ? [rightEraseBox] : []),
    ],
    [renderedCommandPreviewBox, rightEraseBox]
  );
  const renderedCommandPreviewPoints = baseRenderedCommandPreviewPoints;
  const renderedCommandPreviewSegments = baseRenderedCommandPreviewSegments;
  const renderedCommandPreviewCircles = useMemo(
    () => cpCommandPreview?.circles ?? [],
    [cpCommandPreview?.circles]
  );
  const renderedCommandCandidatePoints = useMemo(
    () => cpCommandPreview?.points ?? [],
    [cpCommandPreview?.points]
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
  const activeCpToolPrompt = squareBisectorToolPrompt;
  const lastCommandResult = oristudioCpDocument?.lastCommandResult ?? null;
  const camvDiagnosticEntries = camvIssuesVisible
    ? (oristudioCpCamvResult?.diagnostic_entries ?? EMPTY_DIAGNOSTIC_ENTRIES)
    : EMPTY_DIAGNOSTIC_ENTRIES;
  const latestCommandDiagnosticEntries =
    lastCommandResult && isDiagnosticResultOperation(lastCommandResult.operation)
      ? (lastCommandResult.diagnostic_entries ?? EMPTY_DIAGNOSTIC_ENTRIES)
      : EMPTY_DIAGNOSTIC_ENTRIES;
  const visibleLatestCommandDiagnosticEntries =
    !camvIssuesVisible && lastCommandResult?.operation === 'CheckCamv'
      ? EMPTY_DIAGNOSTIC_ENTRIES
      : latestCommandDiagnosticEntries;
  const latestDiagnosticEntries = useMemo(() => {
    if (lastCommandResult?.operation === 'CheckCamv') return visibleLatestCommandDiagnosticEntries;
    if (camvDiagnosticEntries.length === 0) return visibleLatestCommandDiagnosticEntries;
    if (visibleLatestCommandDiagnosticEntries.length === 0) return camvDiagnosticEntries;
    return [...camvDiagnosticEntries, ...visibleLatestCommandDiagnosticEntries];
  }, [camvDiagnosticEntries, lastCommandResult?.operation, visibleLatestCommandDiagnosticEntries]);
  const diagnosticStatus = useMemo(
    () => {
      const camvStatus = camvIssuesVisible
        ? diagnosticHudStatus(oristudioCpCamvResult, { issueOnly: true })
        : null;
      const commandStatus =
        !camvIssuesVisible && lastCommandResult?.operation === 'CheckCamv'
          ? null
          : diagnosticHudStatus(lastCommandResult);
      return camvStatus ?? commandStatus;
    },
    [camvIssuesVisible, lastCommandResult, oristudioCpCamvResult]
  );
  const diagnosticHudEntries = useMemo(() => {
    const hudResult =
      camvIssuesVisible && diagnosticHudStatus(oristudioCpCamvResult, { issueOnly: true }) !== null
        ? oristudioCpCamvResult
        : !camvIssuesVisible && lastCommandResult?.operation === 'CheckCamv'
          ? null
          : lastCommandResult;
    if (!hudResult || !isDiagnosticResultOperation(hudResult.operation)) {
      return EMPTY_DIAGNOSTIC_ENTRIES;
    }
    return hudResult.diagnostic_entries ?? EMPTY_DIAGNOSTIC_ENTRIES;
  }, [camvIssuesVisible, lastCommandResult, oristudioCpCamvResult]);
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
    // Prefer the tool the user last selected (persisted across panel remounts),
    // then the document's native mouse mode, then the default tool.
    const persistedToolId = useWorkspaceStore.getState().oristudioCpActiveToolId;
    const restoredAction =
      (persistedToolId ? cpActionById(persistedToolId) : undefined) ??
      (nativeActiveMouseMode ? cpActionByUpstreamMouseMode(nativeActiveMouseMode) : undefined);
    const nextAction = isNewDocument ? restoredAction ?? defaultAction : defaultAction;
    if (!nextAction) return;
    setCpToolState((state) =>
      isNewDocument || state.phase === 'idle'
        ? transitionOristudioCpToolState(state, {
            type: 'selectAction',
            action: nextAction,
            editable: true,
          })
        : state
    );
  }, [cpToolState.phase, editableCp, editableCpHandle, nativeActiveMouseMode, projectLoadId]);

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
      // Persist the selection so the tool survives panel remounts (workspace switches).
      useWorkspaceStore.getState().setOristudioCpActiveToolId(action.id);

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

  const eventToEditableSvgPoint = useCallback(
    (event: Pick<PointerEvent<Element>, 'clientX' | 'clientY'>): Point | null => {
      const svg = svgRef.current;
      if (!svg || !editableCp) return null;
      const bounds = svg.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return null;
      return {
        x: cpCanvasRect.x + ((event.clientX - bounds.left) / bounds.width) * cpCanvasRect.width,
        y: cpCanvasRect.y + ((event.clientY - bounds.top) / bounds.height) * cpCanvasRect.height,
      };
    },
    [cpCanvasRect, editableCp]
  );

  const eventToEditableModelPoint = useCallback(
    (event: Pick<PointerEvent<Element>, 'clientX' | 'clientY'>): Point | null => {
      const svgPoint = eventToEditableSvgPoint(event);
      if (!svgPoint) return null;
      return editableSvgToModel(svgPoint);
    },
    [editableSvgToModel, eventToEditableSvgPoint]
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

  // Snap a move-drag delta to grid/vertices/lines for the WebGL surface. The
  // caller supplies the tolerance in model units (from its own camera) so the
  // snap radius stays a fixed screen distance. Mirrors the SVG snap in
  // updateSelectionMovePreview, but returns the adjusted delta instead of
  // driving SVG preview state.
  const resolveEditableMoveSnap = useCallback(
    (
      rawDelta: Point,
      toleranceModel: number
    ): { delta: Point; snapLabel: string | null } => {
      const snappingEnabled =
        oristudioCpViewport.snapToGrid ||
        oristudioCpViewport.snapToVertices ||
        oristudioCpViewport.snapToLines;
      if (!snappingEnabled || !selectionMoveSnapDocument) {
        return { delta: rawDelta, snapLabel: null };
      }
      const translated = translateCpLineSegments(selectedEditableCpLines, rawDelta);
      const anchorPoints = cpLineSelectionMoveAnchorPoints(
        translated,
        selectionTransformAngleDegrees
      );
      let best: { target: CpSnapTarget; anchorPoint: Point } | null = null;
      for (const anchorPoint of anchorPoints) {
        const target = nearestCpSnapTarget(
          selectionMoveSnapDocument,
          anchorPoint,
          editableCpBounds,
          oristudioCpViewport,
          toleranceModel
        );
        if (!target) continue;
        if (!best || target.distance < best.target.distance) best = { target, anchorPoint };
      }
      if (!best) return { delta: rawDelta, snapLabel: null };
      return {
        delta: {
          x: rawDelta.x + best.target.point.x - best.anchorPoint.x,
          y: rawDelta.y + best.target.point.y - best.anchorPoint.y,
        },
        snapLabel: best.target.label,
      };
    },
    [
      editableCpBounds,
      oristudioCpViewport,
      selectedEditableCpLines,
      selectionMoveSnapDocument,
      selectionTransformAngleDegrees,
    ]
  );

  // WebGL draw tools: snap a raw model draw point to nearby geometry (the surface
  // supplies its camera-derived tolerance), mirroring resolveEditableDrawPoint.
  const resolveEditableDrawModelPoint = useCallback(
    (rawPoint: Point, toleranceModel: number): Point => {
      if (!editableCp) return rawPoint;
      const target = nearestOrieditaDrawPointTarget(
        editableCp,
        rawPoint,
        editableCpBounds,
        oristudioCpViewport,
        toleranceModel
      );
      return target?.point ?? rawPoint;
    },
    [editableCp, editableCpBounds, oristudioCpViewport]
  );

  // WebGL draw tools: commit a tool's collected input (free points and/or picked
  // crease ids) through the kernel command, then keep the tool active for the next.
  const handleWebglToolCommit = useCallback(
    (commit: { points?: readonly Point[]; lineIds?: readonly number[] }) => {
      const command = activeCpCommand;
      if (!command || command.uiStatus !== 'ready') return;
      const points = commit.points ?? [];
      const pickedLineIds = commit.lineIds ?? [];
      if (points.length < 2 && pickedLineIds.length < 1) return;
      void (async () => {
        const succeeded = await executeOristudioCpCommand(
          command.operationId,
          buildCpCommandPayload(command, {
            // Entity-pick tools pass the picked creases; flip/erase box tools
            // resolve the box kernel-side; other tools use the prior selection.
            line_ids:
              pickedLineIds.length > 0
                ? [...pickedLineIds]
                : isCreaseToggleMvClickTool(command.operationId) ||
                    isLineEraseClickTool(command.operationId)
                  ? []
                  : oristudioCpSelection.lines,
            circle_ids: oristudioCpSelection.circles,
            points: [...points],
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
                      message: useWorkspaceStore.getState().oristudioCpError ?? 'Command failed',
                    }
              )
            : state
        );
      })();
    },
    [
      activeCpCommand,
      buildCpCommandPayload,
      executeOristudioCpCommand,
      oristudioCpSelection.circles,
      oristudioCpSelection.lines,
    ]
  );

  // Only crease-drawing tools preview in the active line colour; select / toggle /
  // transform box + lasso tools preview in the neutral selection accent so a
  // "select crease" box doesn't look like a red crease.
  const toolPreviewColor = useMemo(
    () =>
      activeCpCommand?.group === 'draw'
        ? resolveCpLineColor(activeCpLineColor, mode, document.documentElement)
        : readCssVarColor(document.documentElement, '--accent-primary', [0.4, 0.6, 1, 1] as const),
    [activeCpCommand?.group, activeCpLineColor, mode]
  );

  // The active tool's WebGL routing mode from its declarative steps: a drag mode;
  // an all-line-pick sequence (line-pick); an all-free-point sequence
  // (point-sequence); or null. Mixed / variable-length / text ops are excluded
  // until they get dedicated engines.
  const webglActiveTool = useMemo<{
    mode: 'drag-line' | 'drag-box' | 'drag-path' | 'point-sequence' | 'line-pick' | null;
    stepCount: number;
  }>(() => {
    if (!activeCpCommand || activeCpCommand.uiStatus !== 'ready' || cpToolState.phase !== 'active') {
      return { mode: null, stepCount: 0 };
    }
    const im = activeCpCommand.inputMode;
    if (im === 'drag-line' || im === 'drag-box' || im === 'drag-path') {
      return { mode: im, stepCount: 0 };
    }
    const steps = activeCpCommand.toolSteps ?? [];
    if (
      steps.length === 0 ||
      isVariablePointSequenceOperation(activeCpCommand.operationId) ||
      isTextAnnotationOperation(activeCpCommand.operationId)
    ) {
      return { mode: null, stepCount: 0 };
    }
    const picksLine = (step: string) => {
      const t = step.toLowerCase();
      return (
        (t.includes('crease') || t.includes('segment') || t.includes('line')) && !t.includes('point')
      );
    };
    const picksPoint = (step: string) => {
      const t = step.toLowerCase();
      return (
        t.includes('point') &&
        !t.includes('crease') &&
        !t.includes('segment') &&
        !t.includes('line')
      );
    };
    if (steps.every(picksLine)) return { mode: 'line-pick', stepCount: steps.length };
    if (steps.every(picksPoint)) return { mode: 'point-sequence', stepCount: steps.length };
    return { mode: null, stepCount: 0 };
  }, [activeCpCommand, cpToolState.phase]);

  // Point-sequence live preview (kernel-computed) for the WebGL surface.
  const [webglToolPreviewSegments, setWebglToolPreviewSegments] = useState<
    readonly { a: Point; b: Point }[]
  >([]);
  const webglPreviewRequestRef = useRef(0);
  const handleWebglToolPreviewPoints = useCallback(
    (points: readonly Point[]) => {
      const command = activeCpCommand;
      if (!command || points.length === 0) {
        webglPreviewRequestRef.current += 1;
        setWebglToolPreviewSegments([]);
        return;
      }
      const requestId = ++webglPreviewRequestRef.current;
      void previewOristudioCpCommand(
        command.operationId,
        buildCpCommandPayload(command, {
          line_ids: oristudioCpSelection.lines,
          circle_ids: oristudioCpSelection.circles,
          points: [...points],
        })
      ).then((preview) => {
        if (webglPreviewRequestRef.current !== requestId) return;
        setWebglToolPreviewSegments((preview?.segments ?? []).map((s) => ({ a: s.a, b: s.b })));
      });
    },
    [
      activeCpCommand,
      buildCpCommandPayload,
      oristudioCpSelection.circles,
      oristudioCpSelection.lines,
      previewOristudioCpCommand,
    ]
  );

  // Clear the WebGL point-sequence preview when that mode is no longer active.
  useEffect(() => {
    if (webglActiveTool.mode !== 'point-sequence') {
      webglPreviewRequestRef.current += 1;
      setWebglToolPreviewSegments([]);
    }
  }, [webglActiveTool.mode]);

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

  const handleFoldedFigurePointerDown = useCallback(
    (figureId: string, event: PointerEvent<Element>) => {
      if (event.button !== 0 || spacePressed || !editableCp) return;
      event.preventDefault();
      event.stopPropagation();
      setActiveEditingSurface('crease-pattern');
      setOristudioCpActiveFoldedFigure(figureId);

      if (!event.metaKey && !event.ctrlKey) return;
      const svgPoint = eventToEditableSvgPoint(event);
      if (!svgPoint) return;
      foldedFigureMoveDragRef.current = {
        pointerId: event.pointerId,
        figureId,
        lastSvgPoint: svgPoint,
      };
      svgRef.current?.setPointerCapture?.(event.pointerId);
    },
    [
      editableCp,
      eventToEditableSvgPoint,
      setActiveEditingSurface,
      setOristudioCpActiveFoldedFigure,
      spacePressed,
    ]
  );

  const updateEditablePointerStatus = useCallback(
    (event: PointerEvent<SVGElement>) => {
      if (!editableCp) return;
      if (viewportPanningRef.current || spacePressed || (event.buttons & 4) !== 0) {
        setCursorModelPoint(null);
        setSnapTarget(null);
        return;
      }
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
      spacePressed,
      zoomPercent,
    ]
  );

  const handleViewportTransformed = useCallback(
    (_ref: ReactZoomPanPinchRef, state: { scale: number }) => {
      // Keep the infinite grid aligned with the visible viewport on every
      // transform (pan, zoom, pinch, programmatic fit).
      gridSyncRef.current?.();
      const nextZoomPercent = Math.round(state.scale * 100);
      if (zoomPercentRef.current === nextZoomPercent) return;
      zoomPercentRef.current = nextZoomPercent;
      setZoomPercent(nextZoomPercent);
    },
    []
  );

  const handleViewportPanning = useCallback(() => {
    gridSyncRef.current?.();
  }, []);

  const handleViewportPanStart = useCallback(() => {
    viewportPanningRef.current = true;
    setCursorModelPoint(null);
    setSnapTarget(null);
  }, []);

  const handleViewportPanStop = useCallback(() => {
    viewportPanningRef.current = false;
    // Grid regeneration was frozen during the gesture; refill it for the final
    // viewport now that panning has ended.
    gridSyncRef.current?.();
  }, []);

  // Erase the crease nearest a model-space point (Oriedita right-drag delete).
  // Filter-free: the right-drag gesture removes any crease it sweeps over.
  const eraseCreaseAtModelPoint = useCallback(
    (point: Point) => {
      if (!editableCp) return;
      const id = nearestEditableCpLineId(
        editableCp,
        point,
        modelSelectionDistance(editableCpBounds, zoomPercent / 100)
      );
      if (id === null) return;
      void executeOristudioCpCommand('LineSegmentDelete', { line_ids: [id] });
    },
    [editableCp, editableCpBounds, executeOristudioCpCommand, zoomPercent]
  );

  const handleEditableToolPointerDown = useCallback(
    (event: PointerEvent<SVGElement>) => {
      const foldedFigureId = foldedFigureIdFromEventTarget(event.target);
      if (foldedFigureId) {
        handleFoldedFigurePointerDown(foldedFigureId, event);
        return;
      }

      // Oriedita's universal right-button-drag erase (box-select-and-delete a
      // region, any line type) works with any tool active.
      if (
        event.button === 2 &&
        editableCp &&
        !spacePressed &&
        !isViewportInteractiveTarget(event.target) &&
        !isCpSelectionTransformEventTarget(event.target)
      ) {
        const point = eventToEditableModelPoint(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        rightEraseDragRef.current = {
          pointerId: event.pointerId,
          startPoint: point,
          currentPoint: point,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setRightEraseBox([point, point]);
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
        (isLineClickSelectionOperation(activeCpCommand.operationId) ||
          isCreaseToggleMvClickTool(activeCpCommand.operationId)) &&
        isCpLineEventTarget(event.target)
      ) {
        // Clicking a crease should flip it via the line click handler; let the
        // pointerdown fall through so a box drag only starts on empty canvas.
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
      cpToolPoints,
      cpToolOptions.textContent,
      cpToolState.phase,
      editableCp,
      eventToEditableModelPoint,
      executeOristudioCpCommand,
      handleFoldedFigurePointerDown,
      oristudioCpSelection.circles,
      oristudioCpSelection.lines,
      pendingSquareBisectorLineIds.length,
      resolveEditableDrawPoint,
      resolveEditableToolPoint,
      setOristudioCpSelection,
      spacePressed,
    ]
  );

  const handleEditablePointerMove = useCallback(
    (event: PointerEvent<SVGElement>) => {
      const rightEraseDrag = rightEraseDragRef.current;
      if (rightEraseDrag && rightEraseDrag.pointerId === event.pointerId) {
        const point = eventToEditableModelPoint(event);
        if (!point) return;
        event.preventDefault();
        event.stopPropagation();
        rightEraseDrag.currentPoint = point;
        setRightEraseBox([rightEraseDrag.startPoint, point]);
        return;
      }
      const foldedFigureMoveDrag = foldedFigureMoveDragRef.current;
      if (foldedFigureMoveDrag && foldedFigureMoveDrag.pointerId === event.pointerId) {
        const svgPoint = eventToEditableSvgPoint(event);
        if (!svgPoint) return;
        event.preventDefault();
        event.stopPropagation();
        const delta = {
          x: svgPoint.x - foldedFigureMoveDrag.lastSvgPoint.x,
          y: svgPoint.y - foldedFigureMoveDrag.lastSvgPoint.y,
        };
        foldedFigureMoveDrag.lastSvgPoint = svgPoint;
        moveOristudioCpFoldedFigure(foldedFigureMoveDrag.figureId, delta);
        return;
      }
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
      eventToEditableSvgPoint,
      moveOristudioCpFoldedFigure,
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
      const rightEraseDrag = rightEraseDragRef.current;
      if (rightEraseDrag && rightEraseDrag.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        const { startPoint, currentPoint } = rightEraseDrag;
        rightEraseDragRef.current = null;
        setRightEraseBox(null);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        const clickThreshold =
          modelSelectionDistance(editableCpBounds, zoomPercent / 100) ** 2 / 16;
        if (pointDistanceSquared(startPoint, currentPoint) < clickThreshold) {
          // Plain right-click: erase the crease under the cursor (any type).
          eraseCreaseAtModelPoint(currentPoint);
        } else {
          // Right-drag: box-select and delete the region (any line type). The
          // empty line_ids makes the kernel resolve the box, and omitting
          // custom_line_type erases every crease inside it.
          void executeOristudioCpCommand('LineSegmentDelete', {
            line_ids: [],
            points: [startPoint, currentPoint],
          });
        }
        return;
      }
      const foldedFigureMoveDrag = foldedFigureMoveDragRef.current;
      if (foldedFigureMoveDrag && foldedFigureMoveDrag.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        foldedFigureMoveDragRef.current = null;
        svgRef.current?.releasePointerCapture?.(event.pointerId);
        return;
      }
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
            // The flip and eraser tools operate on the boxed lines, never on a
            // prior selection, so they always resolve the box on the kernel side.
            line_ids:
              isCreaseToggleMvClickTool(drag.operationId) ||
              isLineEraseClickTool(drag.operationId)
                ? []
                : oristudioCpSelection.lines,
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
      eraseCreaseAtModelPoint,
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
    const rightEraseDrag = rightEraseDragRef.current;
    if (rightEraseDrag && rightEraseDrag.pointerId === event.pointerId) {
      rightEraseDragRef.current = null;
      setRightEraseBox(null);
      svgRef.current?.releasePointerCapture?.(event.pointerId);
      return;
    }
    const foldedFigureMoveDrag = foldedFigureMoveDragRef.current;
    if (foldedFigureMoveDrag && foldedFigureMoveDrag.pointerId === event.pointerId) {
      foldedFigureMoveDragRef.current = null;
      svgRef.current?.releasePointerCapture?.(event.pointerId);
      return;
    }
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
        activeCpCommand?.uiStatus === 'ready' &&
        cpToolState.phase === 'active' &&
        isLineEraseClickTool(activeCpCommand.operationId)
      ) {
        setCpToolPoints([]);
        setCpToolPath([]);
        void (async () => {
          const succeeded = await executeOristudioCpCommand(
            activeCpCommand.operationId,
            buildCpCommandPayload(activeCpCommand, { line_ids: [id] })
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
        activeCpCommand?.uiStatus === 'ready' &&
        cpToolState.phase === 'active' &&
        isCreaseToggleMvClickTool(activeCpCommand.operationId)
      ) {
        setCpToolPoints([]);
        setCpToolPath([]);
        void (async () => {
          const succeeded = await executeOristudioCpCommand(
            activeCpCommand.operationId,
            buildCpCommandPayload(activeCpCommand, { line_ids: [id] })
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
        ? `editable:${projectLoadId}:${editableCpLoadSerial ?? 'unloaded'}`
        : `generated:${projectLoadId}:${project.creases.length}:${project.facets.length}`,
    [editableCp, editableCpLoadSerial, project.creases.length, project.facets.length, projectLoadId]
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

    const focusBounds = diagnosticEntryBounds(activeDiagnosticEntry);
    if (!focusBounds) return;
    const focusKey = [
      editableCpHandle ?? 'none',
      activeDiagnosticEntry.id,
      focusBounds.minX,
      focusBounds.minY,
      focusBounds.maxX,
      focusBounds.maxY,
      cpCanvasRect.x,
      cpCanvasRect.y,
    ].join(':');
    if (lastFocusedDiagnosticRef.current === focusKey) return;
    const container = containerRef.current;
    const transform = transformRef.current;
    if (!container || !transform || container.clientWidth <= 0 || container.clientHeight <= 0) {
      return;
    }
    const contentBounds = boundsFromPoints(
      diagnosticEntryPoints(activeDiagnosticEntry).map((point) =>
        svgPointToContentPoint(editableModelToSvg(point), cpCanvasRect)
      )
    );
    if (!contentBounds) return;
    const paddedWidth = Math.max(container.clientWidth - CP_DIAGNOSTIC_FOCUS_PADDING * 2, 32);
    const paddedHeight = Math.max(container.clientHeight - CP_DIAGNOSTIC_FOCUS_PADDING * 2, 32);
    const boundsWidth = Math.max(contentBounds.maxX - contentBounds.minX, CP_DIAGNOSTIC_MARKER_SIZE);
    const boundsHeight = Math.max(contentBounds.maxY - contentBounds.minY, CP_DIAGNOSTIC_MARKER_SIZE);
    const issueFitScale = Math.min(
      30,
      Math.max(0.05, Math.min(paddedWidth / boundsWidth, paddedHeight / boundsHeight))
    );
    const documentFitScale = computeFitScale();
    const currentScale = Math.max(zoomPercentRef.current / 100, 0.05);
    const desiredScale = Math.min(3, Math.max(currentScale, documentFitScale * 2));
    const focusScale = Math.min(30, Math.max(0.05, Math.min(desiredScale, issueFitScale)));
    transform.setTransform(
      container.clientWidth / 2 - contentBounds.center.x * focusScale,
      container.clientHeight / 2 - contentBounds.center.y * focusScale,
      focusScale,
      180
    );
    lastFocusedDiagnosticRef.current = focusKey;
  }, [
    activeDiagnosticEntry,
    computeFitScale,
    cpCanvasRect,
    editableCp,
    editableCpHandle,
    editableModelToSvg,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasCreasePattern) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      const interactive = isViewportInteractiveTarget(event.target);
      if (event.key === 'Escape' && editableCp) {
        if (
          selectionRotateDragRef.current ||
          selectionMoveDragRef.current ||
          selectionResizeDragRef.current ||
          foldedFigureMoveDragRef.current ||
          selectionRotationPreview
        ) {
          event.preventDefault();
          selectionRotateDragRef.current = null;
          selectionMoveDragRef.current = null;
          selectionResizeDragRef.current = null;
          foldedFigureMoveDragRef.current = null;
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
      cpToolDragRef.current = null;
      selectionRotateDragRef.current = null;
      selectionMoveDragRef.current = null;
      selectionResizeDragRef.current = null;
      foldedFigureMoveDragRef.current = null;
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
            <div className="cp-panel__viewport" ref={cpViewportRef}>
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
                onPanningStart={handleViewportPanStart}
                onPanning={handleViewportPanning}
                onPanningStop={handleViewportPanStop}
                onTransformed={handleViewportTransformed}
              >
                <TransformComponent
                  wrapperStyle={{ width: '100%', height: '100%' }}
                  contentStyle={{ width: 'fit-content', height: 'fit-content' }}
                >
                  <svg
                    ref={svgRef}
                    className="cp-canvas"
                    data-webgl-hidden={cpRendererMode === 'webgl' && editableCp ? 'true' : undefined}
                    data-canvas-mode={editableCp ? 'editable' : 'generated'}
                    data-cp-line-style={oristudioCpViewport.lineStyle ?? 'color'}
                    viewBox={cpCanvasViewBox}
                    width={cpCanvasRect.width}
                    height={cpCanvasRect.height}
                    style={
                      {
                        width: cpCanvasRect.width,
                        height: cpCanvasRect.height,
                        '--cp-line-width':
                          (oristudioCpViewport.lineWidth ?? 1) * svgUserSpaceDecorationScale,
                        '--cp-point-size':
                          (oristudioCpViewport.pointSize ?? 1) * svgUserSpaceDecorationScale,
                      } as CSSProperties
                    }
                    role="img"
                    aria-label="Crease pattern"
                    onPointerMove={handleEditablePointerMove}
                    onPointerUp={finishEditableDragPath}
                    onPointerCancel={cancelEditableDragPath}
                    onPointerLeave={clearEditablePointerStatus}
                    onPointerDownCapture={handleEditableToolPointerDown}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={(event) => {
                      if (event.target === event.currentTarget) clearSelectionOnBackgroundPointerDown(event);
                    }}
                  >
                    {!editableCp && (
                      <>
                        <rect
                          className="paper-shadow"
                          x={CP_PAPER_SHADOW_RECT.x}
                          y={CP_PAPER_SHADOW_RECT.y}
                          width={CP_PAPER_SHADOW_RECT.width}
                          height={CP_PAPER_SHADOW_RECT.height}
                          rx="6"
                        />
                        <rect
                          className="paper"
                          x={CP_PAPER_RECT.x}
                          y={CP_PAPER_RECT.y}
                          width={CP_PAPER_RECT.width}
                          height={CP_PAPER_RECT.height}
                          onPointerDown={clearSelectionOnBackgroundPointerDown}
                        />
                      </>
                    )}
                    {editableCp ? (
                      <EditableCreasePattern
                        circleRadiusToSvg={editableCircleRadiusToSvg}
                        document={editableCp}
                        generatedFoldedFigures={generatedFoldedFigures}
                        grid={editableCpVisibleGrid}
                        gridFallbackBounds={editableCpFallbackGridBounds}
                        gridSyncRef={gridSyncRef}
                        gridPanningRef={viewportPanningRef}
                        gridVisible={oristudioCpViewport.gridVisible}
                        importedFoldedForms={importedFoldedForms}
                        mode={mode}
                        modelToSvg={editableModelToSvg}
                        svgRef={svgRef}
                        svgToModel={editableSvgToModel}
                        viewportRef={cpViewportRef}
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
                        activeFoldedFigureId={oristudioCpActiveFoldedFigureId}
                        diagnostics={latestDiagnosticEntries}
                        onFoldedFigurePointerDown={handleFoldedFigurePointerDown}
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
              {cpRendererMode === 'webgl' && editableCp && (
                <CreasePatternWebglCanvas
                  className="cp-webgl-layer"
                  lineSegments={editableCp.crease_pattern.line_segments}
                  svgRef={svgRef}
                  modelToSvg={editableModelToSvg}
                  svgToModel={editableSvgToModel}
                  selectedLineIds={oristudioCpSelection.lines}
                  selectedPointIds={oristudioCpSelection.points}
                  selectedCircleIds={oristudioCpSelection.circles}
                  onSelect={(hit, additive) => {
                    if (!hit) {
                      if (!additive) clearOristudioCpSelection();
                      return;
                    }
                    if (hit.kind === 'line') handleEditableLineClick(hit.id, additive);
                    else if (hit.kind === 'point') handleEditablePointClick(hit.id, additive);
                    else handleEditableCircleClick(hit.id, additive);
                  }}
                  onBoxSelect={(sets, additive) => {
                    const merge = (prev: number[], next: number[]) =>
                      Array.from(new Set([...prev, ...next]));
                    const base = additive ? oristudioCpSelection : emptyOristudioCpSelection();
                    setOristudioCpSelection({
                      ...base,
                      lines: additive ? merge(base.lines, sets.lines) : sets.lines,
                      points: additive ? merge(base.points, sets.points) : sets.points,
                      circles: additive ? merge(base.circles, sets.circles) : sets.circles,
                    });
                  }}
                  onMoveFoldedFigure={(figureId, delta) => {
                    moveOristudioCpFoldedFigure(figureId, delta);
                  }}
                  onTranslateSelection={(delta) => {
                    void transformOristudioCpSelection({ kind: 'translate', delta });
                  }}
                  resolveMoveSnap={resolveEditableMoveSnap}
                  activeToolInputMode={webglActiveTool.mode}
                  activeToolStepCount={webglActiveTool.stepCount}
                  resolveDrawPoint={resolveEditableDrawModelPoint}
                  onToolCommit={handleWebglToolCommit}
                  onToolPreviewPoints={handleWebglToolPreviewPoints}
                  toolCommandPreviewSegments={webglToolPreviewSegments}
                  toolPreviewColor={toolPreviewColor}
                  onEraseBox={(points) => {
                    void executeOristudioCpCommand('LineSegmentDelete', {
                      line_ids: [],
                      points: [...points],
                    });
                  }}
                  onEraseLine={(id) => {
                    void executeOristudioCpCommand('LineSegmentDelete', { line_ids: [id] });
                  }}
                  mode={mode}
                  lineWidth={oristudioCpViewport.lineWidth ?? 1}
                  points={editableCp.crease_pattern.points}
                  vertices={editableCpVertexPoints}
                  pointSize={oristudioCpViewport.pointSize ?? 1}
                  circles={editableCp.crease_pattern.circles}
                  circleRadiusToSvg={editableCircleRadiusToSvg}
                  foldedFigures={generatedFoldedFigures}
                  grid={editableCpVisibleGrid}
                  gridVisible={oristudioCpViewport.gridVisible}
                />
              )}
              <ViewportToolbar
                ariaLabel="Crease pattern viewport controls"
                zoomPercent={zoomPercent}
                zoomIn={() => transformRef.current?.zoomIn(0.35, 120)}
                zoomOut={() => transformRef.current?.zoomOut(0.35, 120)}
                fitToView={() => fitToView()}
                setZoomLevel={setZoomLevel}
              >
                {editableCp && (
                  <>
                    <ViewportToolbarSeparator />
                    <CpLineTypeToolbar
                      activeLineColor={activeCpLineColor}
                      onSelectLineColor={setActiveCpLineColor}
                      shortcutOverrides={shortcutOverrides}
                    />
                    <ViewportToolbarSeparator />
                    <div className="cp-folded-figure-actions">
                      <IconButton
                        size="sm"
                        variant="toolbar"
                        title="Fold"
                        disabled={!canFoldSelectedModel}
                        onClick={handleFoldModel}
                      >
                        <GitBranch size={14} />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="toolbar"
                        title="Another solution"
                        disabled={!canFoldAnother}
                        onClick={handleFoldAnother}
                      >
                        <ChevronRight size={14} />
                      </IconButton>
                      <FoldedFigureMenuButton
                        figures={oristudioCpFoldedFigures}
                        activeFigure={activeFoldedFigure}
                        startingFaceId={foldStartingFaceId}
                        caseDraft={foldCaseDraft}
                        onStartingFaceIdChange={setFoldStartingFaceId}
                        onCaseDraftChange={setFoldCaseDraft}
                        onSelectFigure={setOristudioCpActiveFoldedFigure}
                        onDisplayStyle={handleFoldedDisplayStyle}
                        onModelUpdate={handleFoldedModelUpdate}
                        onFoldToCase={handleFoldToCase}
                        onDuplicate={handleDuplicateFoldedFigure}
                        onDelete={handleDeleteFoldedFigure}
                      />
                    </div>
                    <span
                      className="viewport-toolbar__meta cp-folded-model-status"
                      data-folded-model-status={activeFoldedFigure?.status ?? 'none'}
                    >
                      {foldedFigureStatusLabel}
                    </span>
                  </>
                )}
              </ViewportToolbar>
              {editableCp &&
                activeCpCommand &&
                toolOptionsPortalTarget &&
                createPortal(
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
                  />,
                  toolOptionsPortalTarget
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

// Extra viewport shown around the visible region so pans reuse the cached grid
// instead of revealing an ungridded edge before the next recompute. Widened
// because grid regeneration is now frozen during an active pan gesture (it
// re-rasterizes the layer), so this margin is the buffer the drag pans into
// before the grid is refilled on pan-stop.
const GRID_VIEWPORT_MARGIN_RATIO = 0.75;
// Snap the generation region outward to this fraction of its span so small pans
// resolve to the same coverage key and skip regeneration.
const GRID_SNAP_STEP_RATIO = 0.2;
const GRID_SNAP_MIN_STEP = 1e-3;

/**
 * Map the visible viewport rectangle into model space using the SVG's live
 * screen CTM (which already folds in the pan/zoom CSS transform). Returns null
 * when no transform is available yet (initial paint, jsdom), so callers can fall
 * back to a fixed extent.
 */
function visibleModelGridBounds(
  svg: SVGSVGElement | null,
  viewport: HTMLElement | null,
  svgToModel: (point: Point) => Point
): CpModelBounds | null {
  if (!svg || !viewport || typeof svg.getScreenCTM !== 'function') return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const rect = viewport.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  let inverse: DOMMatrix;
  try {
    inverse = ctm.inverse();
  } catch {
    return null;
  }
  const screenCorners: Point[] = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.left, y: rect.bottom },
    { x: rect.right, y: rect.bottom },
  ];
  const modelCorners = screenCorners.map((corner) => {
    const svgX = inverse.a * corner.x + inverse.c * corner.y + inverse.e;
    const svgY = inverse.b * corner.x + inverse.d * corner.y + inverse.f;
    return svgToModel({ x: svgX, y: svgY });
  });
  return expandedModelBoundsFromPoints(modelCorners, GRID_VIEWPORT_MARGIN_RATIO);
}

function snapModelGridBounds(bounds: CpModelBounds): CpModelBounds {
  const step = Math.max(
    GRID_SNAP_MIN_STEP,
    Math.max(bounds.spanX, bounds.spanY) * GRID_SNAP_STEP_RATIO
  );
  const minX = Math.floor(bounds.minX / step) * step;
  const minY = Math.floor(bounds.minY / step) * step;
  const maxX = Math.ceil(bounds.maxX / step) * step;
  const maxY = Math.ceil(bounds.maxY / step) * step;
  return {
    minX,
    minY,
    maxX,
    maxY,
    spanX: Math.max(step, maxX - minX),
    spanY: Math.max(step, maxY - minY),
  };
}

interface OrieditaInfiniteGridProps {
  grid: OristudioCpGridMetadata;
  fallbackBounds: CpModelBounds;
  modelToSvg: (point: Point) => Point;
  svgToModel: (point: Point) => Point;
  svgRef: RefObject<SVGSVGElement | null>;
  viewportRef: RefObject<HTMLElement | null>;
  syncRef: MutableRefObject<(() => void) | null>;
  isPanningRef: MutableRefObject<boolean>;
}

/**
 * Grid layer that follows the visible viewport, matching Oriedita's behavior of
 * repainting the grid across the whole visible canvas each frame. Lines are
 * generated over the currently visible model region (widened by a margin) rather
 * than a fixed world rect, so the grid never terminates at a world edge. The
 * lines render inside the pan/zoom-transformed SVG and its `overflow: visible`
 * surface, so they move with the content and are not clipped to the CP viewBox.
 */
function OrieditaInfiniteGrid({
  grid,
  fallbackBounds,
  modelToSvg,
  svgToModel,
  svgRef,
  viewportRef,
  syncRef,
  isPanningRef,
}: OrieditaInfiniteGridProps) {
  const [lines, setLines] = useState<CpGridLine[]>([]);
  const coverageKeyRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);

  const recompute = useCallback(() => {
    // Freeze regeneration during an active pan gesture: rebuilding the grid's
    // DOM re-rasterizes the promoted crease layer and costs a frame. The margin
    // around the visible region keeps the grid covering the viewport while
    // dragging, and the parent forces one recompute on pan-stop.
    if (isPanningRef.current) return;
    const visible = visibleModelGridBounds(svgRef.current, viewportRef.current, svgToModel);
    const snapped = snapModelGridBounds(visible ?? fallbackBounds);
    const key = [
      grid.grid_size,
      grid.grid_angle,
      grid.grid_xa,
      grid.grid_ya,
      grid.interval_grid_size,
      grid.draw_diagonal_gridlines ? 1 : 0,
      snapped.minX.toFixed(3),
      snapped.minY.toFixed(3),
      snapped.maxX.toFixed(3),
      snapped.maxY.toFixed(3),
    ].join(':');
    if (key === coverageKeyRef.current) return;
    coverageKeyRef.current = key;
    setLines(orieditaGridLinesForModelBounds(snapped, grid));
  }, [fallbackBounds, grid, isPanningRef, svgRef, svgToModel, viewportRef]);

  const scheduleRecompute = useCallback(() => {
    if (frameRef.current != null) return;
    if (typeof requestAnimationFrame !== 'function') {
      recompute();
      return;
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      recompute();
    });
  }, [recompute]);

  // Let viewport transforms drive a recompute without re-rendering the panel.
  useEffect(() => {
    syncRef.current = scheduleRecompute;
    return () => {
      if (syncRef.current === scheduleRecompute) syncRef.current = null;
    };
  }, [scheduleRecompute, syncRef]);

  // Recompute immediately when grid params or coordinate mapping change, and keep
  // the grid aligned when the viewport element resizes.
  useEffect(() => {
    coverageKeyRef.current = null;
    recompute();
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => scheduleRecompute());
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [recompute, scheduleRecompute, viewportRef]);

  useEffect(
    () => () => {
      if (frameRef.current != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameRef.current);
      }
    },
    []
  );

  return (
    <g className="cp-grid-layer">
      {lines.map((line) => {
        const a = modelToSvg(line.a);
        const b = modelToSvg(line.b);
        return <line key={line.id} className="cp-grid-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
      })}
    </g>
  );
}

interface EditableCreasePatternProps {
  activeDiagnosticId: string | null;
  activeFoldedFigureId: string | null;
  circleRadiusToSvg: (radius: number) => number;
  document: OristudioCpDocumentSnapshot;
  generatedFoldedFigures: OristudioCpFoldedFigureEntry[];
  grid: OristudioCpGridMetadata | null;
  gridFallbackBounds: CpModelBounds;
  gridSyncRef: MutableRefObject<(() => void) | null>;
  gridPanningRef: MutableRefObject<boolean>;
  gridVisible: boolean;
  importedFoldedForms: FoldDocument[];
  mode: 'mvf' | 'agrh';
  modelToSvg: (point: Point) => Point;
  svgRef: RefObject<SVGSVGElement | null>;
  svgToModel: (point: Point) => Point;
  viewportRef: RefObject<HTMLElement | null>;
  commandPreviewBoxes: readonly (readonly [Point, Point])[];
  commandCandidatePoints: Point[];
  commandPreviewCircles: OristudioCpCircle[];
  commandPreviewPoints: Point[];
  commandPreviewSegments: OristudioCpLineSegment[];
  diagnostics: OristudioCpDiagnosticEntry[];
  highlightedLineIds: number[];
  onFoldedFigurePointerDown: (id: string, event: PointerEvent<Element>) => void;
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

// Static crease geometry is split into memoized layers so panning (which only
// touches cursor/snap/grid state) never re-reconciles the hundreds of SVG nodes
// below. Each layer only re-renders when its own geometry or selection changes,
// uses O(1) Set lookups for the selected/highlighted classes (instead of a
// per-node Array.includes scan), and delegates click handling to a single group
// handler (instead of a fresh closure per node).
const CreaseLines = memo(function CreaseLines({
  lineSegments,
  modelToSvg,
  mode,
  selectedLineIds,
  highlightedLineIds,
  spacePressed,
  onToggleLine,
}: {
  lineSegments: OristudioCpDocumentSnapshot['crease_pattern']['line_segments'];
  modelToSvg: (point: Point) => Point;
  mode: 'mvf' | 'agrh';
  selectedLineIds: readonly number[];
  highlightedLineIds: readonly number[];
  spacePressed: boolean;
  onToggleLine: (id: number, additive?: boolean) => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedLineIds), [selectedLineIds]);
  const highlightedSet = useMemo(() => new Set(highlightedLineIds), [highlightedLineIds]);
  const handleClick = useCallback(
    (event: ReactMouseEvent<SVGGElement>) => {
      if (spacePressed) return;
      const target = (event.target as Element).closest?.(
        '[data-cp-line-hit-id],[data-cp-line-id]'
      );
      const raw =
        target?.getAttribute('data-cp-line-hit-id') ?? target?.getAttribute('data-cp-line-id');
      if (!raw) return;
      event.stopPropagation();
      onToggleLine(Number(raw), event.shiftKey || event.metaKey || event.ctrlKey);
    },
    [onToggleLine, spacePressed]
  );
  return (
    <g onClick={handleClick}>
      {lineSegments.map((line, index) => {
        const id = index + 1;
        const a = modelToSvg(line.a);
        const b = modelToSvg(line.b);
        const selected = selectedSet.has(id) || highlightedSet.has(id);
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
            />
            <line
              className={[
                cpLineColorClass(line.color, mode),
                selected ? 'crease--selected' : '',
              ].join(' ')}
              data-cp-line-id={id}
              data-cp-line-color={cpLineStyleColorKind(line.color)}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              aria-label={`Editable ${cpLineAssignmentLabel(line.color)} line ${id}`}
            />
          </g>
        );
      })}
    </g>
  );
});

const CreasePoints = memo(function CreasePoints({
  points,
  modelToSvg,
  selectedPointIds,
  spacePressed,
  onTogglePoint,
}: {
  points: OristudioCpDocumentSnapshot['crease_pattern']['points'];
  modelToSvg: (point: Point) => Point;
  selectedPointIds: readonly number[];
  spacePressed: boolean;
  onTogglePoint: (id: number, additive?: boolean) => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedPointIds), [selectedPointIds]);
  const handleClick = useCallback(
    (event: ReactMouseEvent<SVGGElement>) => {
      if (spacePressed) return;
      const raw = (event.target as Element)
        .closest?.('[data-cp-point-id]')
        ?.getAttribute('data-cp-point-id');
      if (!raw) return;
      event.stopPropagation();
      onTogglePoint(Number(raw), event.shiftKey || event.metaKey || event.ctrlKey);
    },
    [onTogglePoint, spacePressed]
  );
  return (
    <g onClick={handleClick}>
      {points.map((point, index) => {
        const id = index + 1;
        const svgPoint = modelToSvg(point);
        return (
          <circle
            key={id}
            className={['cp-point', selectedSet.has(id) ? 'cp-point--selected' : ''].join(' ')}
            data-cp-point-id={id}
            cx={svgPoint.x}
            cy={svgPoint.y}
            r="4"
          />
        );
      })}
    </g>
  );
});

const CreaseCircles = memo(function CreaseCircles({
  circles,
  modelToSvg,
  circleRadiusToSvg,
  selectedCircleIds,
  spacePressed,
  onToggleCircle,
}: {
  circles: OristudioCpDocumentSnapshot['crease_pattern']['circles'];
  modelToSvg: (point: Point) => Point;
  circleRadiusToSvg: (radius: number) => number;
  selectedCircleIds: readonly number[];
  spacePressed: boolean;
  onToggleCircle: (id: number, additive?: boolean) => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedCircleIds), [selectedCircleIds]);
  const handleClick = useCallback(
    (event: ReactMouseEvent<SVGGElement>) => {
      if (spacePressed) return;
      const raw = (event.target as Element)
        .closest?.('[data-cp-circle-id]')
        ?.getAttribute('data-cp-circle-id');
      if (!raw) return;
      event.stopPropagation();
      onToggleCircle(Number(raw), event.shiftKey || event.metaKey || event.ctrlKey);
    },
    [onToggleCircle, spacePressed]
  );
  return (
    <g onClick={handleClick}>
      {circles.map((circle, index) => {
        const id = index + 1;
        const center = modelToSvg({ x: circle.x, y: circle.y });
        const radius = circleRadiusToSvg(circle.r);
        return (
          <circle
            key={id}
            className={['cp-circle', selectedSet.has(id) ? 'cp-circle--selected' : ''].join(' ')}
            data-cp-circle-id={id}
            cx={center.x}
            cy={center.y}
            r={Math.max(1, radius)}
          />
        );
      })}
    </g>
  );
});

const CreaseTexts = memo(function CreaseTexts({
  texts,
  modelToSvg,
  selectedTextIds,
  spacePressed,
  onToggleText,
}: {
  texts: OristudioCpDocumentSnapshot['crease_pattern']['texts'];
  modelToSvg: (point: Point) => Point;
  selectedTextIds: readonly number[];
  spacePressed: boolean;
  onToggleText: (id: number, additive?: boolean) => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedTextIds), [selectedTextIds]);
  const handleClick = useCallback(
    (event: ReactMouseEvent<SVGGElement>) => {
      if (spacePressed) return;
      const raw = (event.target as Element)
        .closest?.('[data-cp-text-id]')
        ?.getAttribute('data-cp-text-id');
      if (!raw) return;
      event.stopPropagation();
      onToggleText(Number(raw), event.shiftKey || event.metaKey || event.ctrlKey);
    },
    [onToggleText, spacePressed]
  );
  return (
    <g onClick={handleClick}>
      {texts.map((text, index) => {
        const id = index + 1;
        const position = modelToSvg({ x: textCoordinate(text.x), y: textCoordinate(text.y) });
        return (
          <text
            key={id}
            className={['cp-text', selectedSet.has(id) ? 'cp-text--selected' : ''].join(' ')}
            data-cp-text-id={id}
            x={position.x}
            y={position.y}
          >
            {text.text}
          </text>
        );
      })}
    </g>
  );
});

const CreaseVertices = memo(function CreaseVertices({
  vertices,
  modelToSvg,
  selectedVertexIds,
  spacePressed,
  onToggleVertex,
}: {
  vertices: CpVertex[];
  modelToSvg: (point: Point) => Point;
  selectedVertexIds: readonly string[] | undefined;
  spacePressed: boolean;
  onToggleVertex: (id: string, additive?: boolean) => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedVertexIds ?? []), [selectedVertexIds]);
  const handleClick = useCallback(
    (event: ReactMouseEvent<SVGGElement>) => {
      if (spacePressed) return;
      const raw = (event.target as Element)
        .closest?.('[data-cp-vertex-id]')
        ?.getAttribute('data-cp-vertex-id');
      if (!raw) return;
      event.stopPropagation();
      onToggleVertex(raw, event.shiftKey || event.metaKey || event.ctrlKey);
    },
    [onToggleVertex, spacePressed]
  );
  return (
    <g onClick={handleClick}>
      {vertices.map((vertex) => {
        const svgPoint = modelToSvg(vertex.point);
        const selected = selectedSet.has(vertex.id);
        return (
          <g key={vertex.id} data-cp-vertex-id={vertex.id}>
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
    </g>
  );
});

function EditableCreasePattern({
  activeDiagnosticId,
  activeFoldedFigureId,
  circleRadiusToSvg,
  document,
  generatedFoldedFigures,
  grid,
  gridFallbackBounds,
  gridSyncRef,
  gridPanningRef,
  gridVisible,
  importedFoldedForms,
  mode,
  modelToSvg,
  svgRef,
  svgToModel,
  viewportRef,
  commandPreviewBoxes,
  commandCandidatePoints,
  commandPreviewCircles,
  commandPreviewPoints,
  commandPreviewSegments,
  diagnostics,
  highlightedLineIds,
  onFoldedFigurePointerDown,
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
      {gridVisible && grid && (
        <OrieditaInfiniteGrid
          grid={grid}
          fallbackBounds={gridFallbackBounds}
          modelToSvg={modelToSvg}
          svgToModel={svgToModel}
          svgRef={svgRef}
          viewportRef={viewportRef}
          syncRef={gridSyncRef}
          isPanningRef={gridPanningRef}
        />
      )}
      <CreaseLines
        lineSegments={document.crease_pattern.line_segments}
        modelToSvg={modelToSvg}
        mode={mode}
        selectedLineIds={selection.lines}
        highlightedLineIds={highlightedLineIds}
        spacePressed={spacePressed}
        onToggleLine={toggleLine}
      />
      {selectionTransformPreview?.segments.map((segment, index) => {
        const a = modelToSvg(segment.a);
        const b = modelToSvg(segment.b);
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
      <CreasePoints
        points={document.crease_pattern.points}
        modelToSvg={modelToSvg}
        selectedPointIds={selection.points}
        spacePressed={spacePressed}
        onTogglePoint={togglePoint}
      />
      <CreaseCircles
        circles={document.crease_pattern.circles}
        modelToSvg={modelToSvg}
        circleRadiusToSvg={circleRadiusToSvg}
        selectedCircleIds={selection.circles}
        spacePressed={spacePressed}
        onToggleCircle={toggleCircle}
      />
      {commandPreviewCircles.map((circle, index) => {
        const center = modelToSvg({ x: circle.x, y: circle.y });
        const radius = circleRadiusToSvg(circle.r);
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
          modelToSvg={modelToSvg}
          points={box}
        />
      ))}
      {diagnostics.flatMap((diagnostic) => {
        if (cpDiagnosticMarkerStyle(diagnostic).shape === 'little-big-little') return [];
        return (diagnostic.segments ?? []).map((segment, index) => {
          const a = modelToSvg(segment.a);
          const b = modelToSvg(segment.b);
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
        });
      })}
      <CreaseTexts
        texts={document.crease_pattern.texts}
        modelToSvg={modelToSvg}
        selectedTextIds={selection.texts}
        spacePressed={spacePressed}
        onToggleText={toggleText}
      />
      <GeneratedFoldedFiguresLayer
        activeFigureId={activeFoldedFigureId}
        figures={generatedFoldedFigures}
        onFigurePointerDown={onFoldedFigurePointerDown}
      />
      <ImportedFoldedFormsLayer
        frames={importedFoldedForms}
        startIndex={generatedFoldedFigures.filter(isRenderableGeneratedFoldedFigure).length}
      />
      <CreaseVertices
        vertices={vertices}
        modelToSvg={modelToSvg}
        selectedVertexIds={selection.vertices}
        spacePressed={spacePressed}
        onToggleVertex={toggleVertex}
      />
      {diagnostics.map((diagnostic) => (
        <DiagnosticPointMarker
          key={`${diagnostic.id}-point`}
          activeDiagnosticId={activeDiagnosticId}
          diagnostic={diagnostic}
          modelToSvg={modelToSvg}
          selectDiagnostic={selectDiagnostic}
        />
      ))}
      {document.operation_frame?.active && (
        <polygon
          className="cp-operation-frame"
          points={document.operation_frame.points
            .map(modelToSvg)
            .map((point) => `${point.x},${point.y}`)
          .join(' ')}
        />
      )}
      {commandPreviewSegments.map((segment, index) => {
        const a = modelToSvg(segment.a);
        const b = modelToSvg(segment.b);
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
            .map(modelToSvg)
            .map((point) => `${point.x},${point.y}`)
            .join(' ')}
        />
      )}
      {commandCandidatePoints.map((point, index) => {
        const svgPoint = modelToSvg(point);
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
          modelToSvg={modelToSvg}
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
          cx={modelToSvg(snapTarget.point).x}
          cy={modelToSvg(snapTarget.point).y}
          r="5"
        />
      )}
    </>
  );
}

function DiagnosticPointMarker({
  activeDiagnosticId,
  diagnostic,
  modelToSvg,
  selectDiagnostic,
}: {
  activeDiagnosticId: string | null;
  diagnostic: OristudioCpDiagnosticEntry;
  modelToSvg: (point: Point) => Point;
  selectDiagnostic: (id: string) => void;
}) {
  if (!diagnostic.point) return null;
  const point = modelToSvg(diagnostic.point);
  const active = diagnostic.id === activeDiagnosticId;
  const marker = cpDiagnosticMarkerStyle(diagnostic);
  if (marker.shape === 'none') return null;

  return (
    <g
      className={[
        'cp-diagnostic-point',
        active ? 'cp-diagnostic-point--active' : '',
      ].join(' ')}
      data-active={active || undefined}
      data-cp-diagnostic-id={diagnostic.id}
      data-diagnostic-tone={marker.tone}
      data-marker-shape={marker.shape}
      data-rule={diagnostic.rule ?? undefined}
      data-severity={diagnostic.severity}
      data-violation-color={diagnostic.violation_color ?? undefined}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        selectDiagnostic(diagnostic.id);
      }}
    >
      {marker.shape === 'generic' ? (
        <>
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
        </>
      ) : marker.shape === 'triangle' ? (
        <polygon
          className="cp-diagnostic-point__oriedita-shape"
          points={`${point.x},${point.y - 10} ${point.x - 10},${point.y + 8} ${point.x + 10},${point.y + 8}`}
        />
      ) : marker.shape === 'square' ? (
        <rect
          className="cp-diagnostic-point__oriedita-shape"
          x={point.x - 9}
          y={point.y - 9}
          width="18"
          height="18"
        />
      ) : marker.shape === 'circle' || marker.shape === 'ring' ? (
        <circle className="cp-diagnostic-point__oriedita-shape" cx={point.x} cy={point.y} r="10" />
      ) : (
        <DiagnosticLittleBigLittleMarker
          diagnostic={diagnostic}
          modelToSvg={modelToSvg}
          point={diagnostic.point}
        />
      )}
    </g>
  );
}

function DiagnosticLittleBigLittleMarker({
  diagnostic,
  modelToSvg,
  point,
}: {
  diagnostic: OristudioCpDiagnosticEntry;
  modelToSvg: (point: Point) => Point;
  point: Point;
}) {
  const sectors =
    diagnostic.little_big_little && diagnostic.little_big_little.length > 0
      ? diagnostic.little_big_little
      : (diagnostic.segments ?? []).map((segment) => ({ segment, violating: false }));
  const svgPoint = modelToSvg(point);

  if (sectors.length < 2) {
    return (
      <polygon
        className="cp-diagnostic-point__oriedita-shape"
        points={`${svgPoint.x},${svgPoint.y - 11} ${svgPoint.x + 10},${svgPoint.y - 4} ${svgPoint.x + 6},${svgPoint.y + 9} ${svgPoint.x - 6},${svgPoint.y + 9} ${svgPoint.x - 10},${svgPoint.y - 4}`}
      />
    );
  }

  return (
    <>
      {sectors.flatMap((sector, index) => {
        if (index === sectors.length - 1 && sector.segment.color === 'Black0') return [];
        const next = sectors[(index + 1) % sectors.length];
        if (!next) return [];
        const a = diagnosticSectorPoint(point, sector.segment, modelToSvg);
        const b = diagnosticSectorPoint(point, next.segment, modelToSvg);
        return (
          <polygon
            key={`${diagnostic.id}-lbl-${index}`}
            className="cp-diagnostic-lbl-sector"
            data-violating={sector.violating || undefined}
            points={`${svgPoint.x},${svgPoint.y} ${a.x},${a.y} ${b.x},${b.y}`}
          />
        );
      })}
    </>
  );
}

const IMPORTED_FOLDED_FORM_VIEW = {
  x: CP_PAPER_RECT.x + 20,
  y: CP_PAPER_RECT.y + 20,
  width: 136,
  height: 136,
};

function GeneratedFoldedFiguresLayer({
  activeFigureId,
  figures,
  onFigurePointerDown,
}: {
  activeFigureId: string | null;
  figures: OristudioCpFoldedFigureEntry[];
  onFigurePointerDown: (id: string, event: PointerEvent<Element>) => void;
}) {
  const renderableFigures = figures.filter(isRenderableGeneratedFoldedFigure);
  if (renderableFigures.length === 0) return null;
  return (
    <g className="cp-generated-folded-figures-layer">
      {renderableFigures.map((figure) => (
        <GeneratedFoldedFigure
          key={figure.id}
          active={figure.id === activeFigureId}
          figure={figure}
          onPointerDown={onFigurePointerDown}
        />
      ))}
    </g>
  );
}

function isRenderableGeneratedFoldedFigure(figure: OristudioCpFoldedFigureEntry): boolean {
  return Boolean(figure.renderSnapshot?.primitives.length || figure.snapshot?.wireframe);
}

function foldedFigureDisplayTransform(figure: OristudioCpFoldedFigureEntry): string | undefined {
  const offset = figure.displayOffset;
  if (!offset || (Math.abs(offset.x) < 1e-9 && Math.abs(offset.y) < 1e-9)) return undefined;
  return `translate(${offset.x} ${offset.y})`;
}

function GeneratedFoldedFigure({
  active,
  figure,
  onPointerDown,
}: {
  active: boolean;
  figure: OristudioCpFoldedFigureEntry;
  onPointerDown: (id: string, event: PointerEvent<Element>) => void;
}) {
  if (figure.renderSnapshot?.primitives.length) {
    return (
      <GeneratedFoldedFigurePrimitiveLayer
        active={active}
        figure={figure}
        onPointerDown={onPointerDown}
        snapshot={figure.renderSnapshot}
      />
    );
  }

  const wireframe = figure?.snapshot?.wireframe;
  if (!wireframe) return null;
  const bounds = foldFrameBounds(wireframe.points);
  if (!bounds) return null;

  const toSvg = (point: Point) => foldedFormPointToSvg(point, bounds, 0);
  const fill = rgbColorCss(figure.snapshot?.model.front_color);
  const stroke = rgbColorCss(figure.snapshot?.model.line_color);
  return (
    <g
      className={[
        'cp-generated-folded-figure',
        figure.status === 'stale' ? 'cp-generated-folded-figure--stale' : '',
      ].join(' ')}
      data-folded-figure-id={figure.id}
      data-folded-figure-active={active || undefined}
      data-folded-figure-status={figure.status}
      transform={foldedFigureDisplayTransform(figure)}
      onPointerDown={(event) => onPointerDown(figure.id, event)}
    >
      {wireframe.faces.map((face, faceIndex) => {
        const points = face
          .map((pointIndex) => wireframe.points[pointIndex])
          .filter((point): point is Point => !!point);
        if (points.length < 3 || points.length !== face.length) return null;
        return (
          <polygon
            key={`face-${faceIndex}`}
            className="cp-generated-folded-figure-face"
            points={points
              .map(toSvg)
              .map((point) => `${point.x},${point.y}`)
              .join(' ')}
            style={{ fill }}
          />
        );
      })}
      {wireframe.lines.map((line, lineIndex) => {
        const start = wireframe.points[line.begin];
        const end = wireframe.points[line.end];
        if (!start || !end) return null;
        const a = toSvg(start);
        const b = toSvg(end);
        return (
          <line
            key={`line-${lineIndex}`}
            className="cp-generated-folded-figure-edge"
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            style={{ stroke }}
          />
        );
      })}
    </g>
  );
}

function GeneratedFoldedFigurePrimitiveLayer({
  active,
  figure,
  onPointerDown,
  snapshot,
}: {
  active: boolean;
  figure: OristudioCpFoldedFigureEntry;
  onPointerDown: (id: string, event: PointerEvent<Element>) => void;
  snapshot: OristudioCpFoldedRenderSnapshot;
}) {
  const bounds = foldedRenderSnapshotBounds(snapshot);
  if (!bounds) return null;
  const toSvg = (point: Point) => modelPointToCpSvg(point, ORIEDITA_PAPER_BOUNDS);
  const hitRect = foldedRenderBoundsRect(bounds, toSvg);
  const gradientIds = new Map<number, string>();
  const gradients = snapshot.primitives.flatMap((primitive) => {
    const paint = primitive.style.paint;
    if (paint.kind !== 'gradient') return [];
    const id = `cp-folded-gradient-${figure.id}-${primitive.sequence}`;
    gradientIds.set(primitive.sequence, id);
    const from = toSvg(paint.from);
    const to = toSvg(paint.to);
    return [{ id, from, to, paint }];
  });

  return (
    <g
      className={[
        'cp-generated-folded-figure',
        'cp-generated-folded-figure--primitive',
        figure.status === 'stale' ? 'cp-generated-folded-figure--stale' : '',
      ].join(' ')}
      data-folded-figure-id={figure.id}
      data-folded-figure-active={active || undefined}
      data-folded-figure-status={figure.status}
      data-folded-render-pass={snapshot.pass ?? undefined}
      transform={foldedFigureDisplayTransform(figure)}
      onPointerDown={(event) => onPointerDown(figure.id, event)}
    >
      <rect className="cp-generated-folded-figure-hit-target" {...hitRect} />
      {gradients.length > 0 && (
        <defs>
          {gradients.map(({ id, from, to, paint }) => (
            <linearGradient
              key={id}
              id={id}
              gradientUnits="userSpaceOnUse"
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            >
              <stop offset="0%" stopColor={rgbaColorCss(paint.from_color)} />
              <stop offset="100%" stopColor={rgbaColorCss(paint.to_color)} />
            </linearGradient>
          ))}
        </defs>
      )}
      {snapshot.primitives.map((primitive) =>
        renderFoldedRenderPrimitive(primitive, toSvg, gradientIds.get(primitive.sequence))
      )}
    </g>
  );
}

function renderFoldedRenderPrimitive(
  primitive: OristudioCpFoldedRenderPrimitive,
  toSvg: (point: Point) => Point,
  gradientId: string | undefined
) {
  const key = `primitive-${primitive.sequence}`;
  const paint = foldedRenderPaintCss(primitive.style.paint, gradientId);
  const stroke = foldedRenderStrokeAttrs(primitive.style.stroke);
  const isFill = primitive.kind.startsWith('fill_');
  const isStroke = primitive.kind.startsWith('stroke_');
  const common = {
    key,
    className: 'cp-generated-folded-figure-primitive',
    vectorEffect: 'non-scaling-stroke' as const,
  };
  const paintAttrs = isFill
    ? { fill: paint, stroke: 'none' }
    : isStroke
      ? { fill: 'none', stroke: paint, ...stroke }
      : { fill: paint, stroke: 'none' };

  switch (primitive.geometry.kind) {
    case 'path':
      return (
        <path
          {...common}
          {...paintAttrs}
          d={foldedRenderPathD(primitive.geometry.commands, toSvg)}
        />
      );
    case 'segment': {
      const from = toSvg(primitive.geometry.from);
      const to = toSvg(primitive.geometry.to);
      return (
        <line
          {...common}
          {...paintAttrs}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
        />
      );
    }
    case 'polygon':
      return (
        <polygon
          {...common}
          {...paintAttrs}
          points={primitive.geometry.points
            .map(toSvg)
            .map((point) => `${point.x},${point.y}`)
            .join(' ')}
        />
      );
    case 'rect': {
      const rect = foldedRenderRectToSvg(primitive.geometry, toSvg);
      return <rect {...common} {...paintAttrs} {...rect} />;
    }
    case 'ellipse': {
      const rect = foldedRenderRectToSvg(primitive.geometry, toSvg);
      return (
        <ellipse
          {...common}
          {...paintAttrs}
          cx={rect.x + rect.width / 2}
          cy={rect.y + rect.height / 2}
          rx={rect.width / 2}
          ry={rect.height / 2}
        />
      );
    }
    case 'text': {
      const position = toSvg(primitive.geometry.position);
      return (
        <text
          {...common}
          {...paintAttrs}
          x={position.x}
          y={position.y}
          fontSize={12}
          fontWeight={700}
        >
          {primitive.geometry.value}
        </text>
      );
    }
    default:
      return null;
  }
}

function foldedRenderPathD(
  commands: OristudioCpFoldedRenderPathCommand[],
  toSvg: (point: Point) => Point
): string {
  return commands
    .map((command) => {
      switch (command.command) {
        case 'move_to': {
          const point = toSvg(command.point);
          return `M ${point.x} ${point.y}`;
        }
        case 'line_to': {
          const point = toSvg(command.point);
          return `L ${point.x} ${point.y}`;
        }
        case 'quad_to': {
          const control = toSvg(command.control);
          const point = toSvg(command.point);
          return `Q ${control.x} ${control.y} ${point.x} ${point.y}`;
        }
        case 'cubic_to': {
          const control1 = toSvg(command.control_1);
          const control2 = toSvg(command.control_2);
          const point = toSvg(command.point);
          return `C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${point.x} ${point.y}`;
        }
        case 'close':
          return 'Z';
      }
    })
    .join(' ');
}

function foldedRenderRectToSvg(
  rect: Extract<OristudioCpFoldedRenderGeometry, { kind: 'rect' | 'ellipse' }>,
  toSvg: (point: Point) => Point
) {
  const first = toSvg({ x: rect.x, y: rect.y });
  const second = toSvg({ x: rect.x + rect.width, y: rect.y + rect.height });
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  };
}

function foldedRenderBoundsRect(bounds: CpModelBounds, toSvg: (point: Point) => Point) {
  const first = toSvg({ x: bounds.minX, y: bounds.minY });
  const second = toSvg({ x: bounds.maxX, y: bounds.maxY });
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.max(Math.abs(second.x - first.x), 1e-6),
    height: Math.max(Math.abs(second.y - first.y), 1e-6),
  };
}

function foldedRenderPaintCss(
  paint: OristudioCpFoldedRenderPaint,
  gradientId: string | undefined
): string {
  switch (paint.kind) {
    case 'none':
      return 'none';
    case 'color':
      return rgbaColorCss(paint.color);
    case 'gradient':
      return gradientId ? `url(#${gradientId})` : rgbaColorCss(paint.from_color);
    case 'texture':
    case 'other':
      return 'currentColor';
  }
}

function foldedRenderStrokeAttrs(stroke: OristudioCpFoldedRenderStroke) {
  if (stroke.kind !== 'basic') return {};
  return {
    strokeWidth: stroke.width,
    strokeLinecap: foldedRenderLineCap(stroke.end_cap),
    strokeLinejoin: foldedRenderLineJoin(stroke.line_join),
    strokeMiterlimit: stroke.miter_limit,
  };
}

function foldedRenderLineCap(cap: number): 'butt' | 'round' | 'square' {
  if (cap === 1) return 'round';
  if (cap === 2) return 'square';
  return 'butt';
}

function foldedRenderLineJoin(join: number): 'miter' | 'round' | 'bevel' {
  if (join === 1) return 'round';
  if (join === 2) return 'bevel';
  return 'miter';
}

function ImportedFoldedFormsLayer({
  frames,
  startIndex = 0,
}: {
  frames: FoldDocument[];
  startIndex?: number;
}) {
  if (frames.length === 0) return null;
  return (
    <g className="cp-folded-form-layer" aria-hidden="true">
      {frames.map((frame, index) => (
        <ImportedFoldedFormFigure
          key={`${index}-${frame.frame_title ?? 'folded-form'}`}
          frame={frame}
          index={startIndex + index}
        />
      ))}
    </g>
  );
}

function ImportedFoldedFormFigure({
  frame,
  index,
}: {
  frame: FoldDocument;
  index: number;
}) {
  const vertices = foldFrameVertices(frame);
  const bounds = foldFrameBounds(vertices);
  if (!bounds) return null;

  const toSvg = (point: Point) => foldedFormPointToSvg(point, bounds, index);
  return (
    <g
      className="cp-folded-form"
      data-folded-form-index={index}
      data-folded-form-title={frame.frame_title || undefined}
    >
      {foldFrameFaces(frame, vertices).map((face, faceIndex) => (
        <polygon
          key={`face-${faceIndex}`}
          className="cp-folded-form-face"
          points={face
            .map(toSvg)
            .map((point) => `${point.x},${point.y}`)
            .join(' ')}
        />
      ))}
      {foldFrameEdges(frame, vertices).map(([a, b], edgeIndex) => {
        const start = toSvg(a);
        const end = toSvg(b);
        return (
          <line
            key={`edge-${edgeIndex}`}
            className="cp-folded-form-edge"
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
          />
        );
      })}
    </g>
  );
}

function isRenderableFoldedFormFrame(frame: FoldDocument): boolean {
  return (
    frame.frame_classes?.includes('foldedForm') === true &&
    foldFrameVertices(frame).length > 0 &&
    foldFrameEdges(frame, foldFrameVertices(frame)).length > 0
  );
}

function foldFrameVertices(frame: FoldDocument): Point[] {
  const coords = Array.isArray(frame.vertices_coords) ? frame.vertices_coords : [];
  return coords.flatMap((coord) => {
    if (!Array.isArray(coord)) return [];
    const x = Number(coord[0]);
    const y = Number(coord[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
  });
}

function foldFrameEdges(frame: FoldDocument, vertices: Point[]): Array<readonly [Point, Point]> {
  const edges = Array.isArray(frame.edges_vertices) ? frame.edges_vertices : [];
  return edges.flatMap((edge) => {
    if (!Array.isArray(edge)) return [];
    const a = Number(edge[0]);
    const b = Number(edge[1]);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return [];
    const start = vertices[a];
    const end = vertices[b];
    return start && end ? ([[start, end]] as Array<readonly [Point, Point]>) : [];
  });
}

function foldFrameFaces(frame: FoldDocument, vertices: Point[]): Point[][] {
  const faces = Array.isArray(frame.faces_vertices) ? frame.faces_vertices : [];
  return faces.flatMap((face) => {
    if (!Array.isArray(face) || face.length < 3) return [];
    const points = face
      .map((vertex) => (Number.isInteger(Number(vertex)) ? vertices[Number(vertex)] : null))
      .filter((point): point is Point => !!point);
    return points.length === face.length ? [points] : [];
  });
}

function foldFrameBounds(vertices: Point[]): CpModelBounds | null {
  if (vertices.length === 0) return null;
  const minX = Math.min(...vertices.map((point) => point.x));
  const maxX = Math.max(...vertices.map((point) => point.x));
  const minY = Math.min(...vertices.map((point) => point.y));
  const maxY = Math.max(...vertices.map((point) => point.y));
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  return { minX, minY, maxX, maxY, spanX, spanY };
}

function foldedRenderSnapshotBounds(snapshot: OristudioCpFoldedRenderSnapshot): CpModelBounds | null {
  const points = snapshot.primitives.flatMap(foldedRenderPrimitiveBoundsPoints);
  return foldFrameBounds(points);
}

function foldedRenderPrimitiveBoundsPoints(primitive: OristudioCpFoldedRenderPrimitive): Point[] {
  switch (primitive.geometry.kind) {
    case 'path':
      return primitive.geometry.commands.flatMap(foldedRenderPathCommandPoints);
    case 'segment':
      return [primitive.geometry.from, primitive.geometry.to];
    case 'polygon':
      return primitive.geometry.points;
    case 'rect':
    case 'ellipse':
      return [
        { x: primitive.geometry.x, y: primitive.geometry.y },
        {
          x: primitive.geometry.x + primitive.geometry.width,
          y: primitive.geometry.y + primitive.geometry.height,
        },
      ];
    case 'text':
      return [primitive.geometry.position];
  }
}

function foldedRenderPathCommandPoints(command: OristudioCpFoldedRenderPathCommand): Point[] {
  switch (command.command) {
    case 'move_to':
    case 'line_to':
      return [command.point];
    case 'quad_to':
      return [command.control, command.point];
    case 'cubic_to':
      return [command.control_1, command.control_2, command.point];
    case 'close':
      return [];
  }
}

function foldedFormPointToSvg(point: Point, bounds: CpModelBounds, index: number): Point {
  const gap = 16;
  const view = {
    ...IMPORTED_FOLDED_FORM_VIEW,
    x: IMPORTED_FOLDED_FORM_VIEW.x + index * (IMPORTED_FOLDED_FORM_VIEW.width + gap),
  };
  const scale = Math.min(view.width / bounds.spanX, view.height / bounds.spanY);
  const offsetX = (view.width - bounds.spanX * scale) / 2;
  const offsetY = (view.height - bounds.spanY * scale) / 2;
  return {
    x: view.x + offsetX + (point.x - bounds.minX) * scale,
    y: view.y + offsetY + (point.y - bounds.minY) * scale,
  };
}

function rgbColorCss(color: OristudioCpRgbColor | undefined): string {
  if (!color) return 'currentColor';
  return `rgb(${color.red} ${color.green} ${color.blue})`;
}

function rgbaColorCss(color: OristudioCpRgbaColor): string {
  return `rgb(${color.red} ${color.green} ${color.blue} / ${color.alpha / 255})`;
}

function SelectionTransformBox({
  modelToSvg,
  selectionFrame,
  uiScale,
  onMovePointerDown,
  onResizePointerDown,
  onRotatePointerDown,
  onTransform,
}: {
  modelToSvg: (point: Point) => Point;
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
  const center = modelToSvg(selectionFrame.center);
  const axisXEnd = modelToSvg({
    x: selectionFrame.center.x + selectionFrame.axisX.x,
    y: selectionFrame.center.y + selectionFrame.axisX.y,
  });
  const axisYEnd = modelToSvg({
    x: selectionFrame.center.x + selectionFrame.axisY.x,
    y: selectionFrame.center.y + selectionFrame.axisY.y,
  });
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
  modelToSvg,
  points,
}: {
  modelToSvg: (point: Point) => Point;
  points: readonly [Point, Point];
}) {
  const first = modelToSvg(points[0]);
  const second = modelToSvg(points[1]);
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

  if (group === 'erase-line-type') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Erase</div>
        <SelectToolOption
          label="Filter"
          ariaLabel="Erase line type"
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
