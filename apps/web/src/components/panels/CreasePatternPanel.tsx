import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cpActionLabel } from '../../i18n/cpVocab';
import { cpPaletteLabel } from '../../i18n/paletteLabels';
import { createPortal } from 'react-dom';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  FlipHorizontal2,
  GitBranch,
  Image as ImageIcon,
  ImagePlus,
  ListChecks,
  Maximize2,
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
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureState,
  OristudioCpRgbColor,
  OristudioCpLineColor,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
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
  cpToolSettingGroupsForCommand,
  evaluateOrieditaRatioExpression,
  type OristudioCpToolOptions,
} from '../../lib/oristudioCpToolSettings';
import { ORISTUDIO_CP_EXTRA_LINE_COLOR_PALETTE } from '../../lib/oristudioCpPalette';
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
  CP_PAPER_RECT,
  cpSelectionSize,
  cpSvgPointToModel,
  emptyOristudioCpSelection,
  getCpVertexPoints,
  getOrieditaGridBasis,
  modelPointToCpSvg,
  nearestCpSnapTarget,
  nearestOrieditaDrawPointTarget,
  ORIEDITA_PAPER_BOUNDS,
  visibleOrieditaGridMetadata,
  type CpModelBounds,
  type CpSnapTarget,
} from '../../lib/creasePatternViewport';
import {
  cpLineSelectionMoveAnchorPoints,
  selectedFoldableCpLineIds,
  selectedCpLineSegments,
  translateCpLineSegments,
} from '../../lib/creasePatternClipboard';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useShortcutStore } from '../../store/shortcutStore';
import { CreasePatternWebglCanvas } from '../../cp-workspace/CreasePatternWebglCanvas';
import type { CameraCommand, CpOverlayView } from '../../cp-workspace/CreasePatternWebglCanvas';
import type { CpContextMenuRequest } from '../../cp-workspace/contextMenuTarget';
import { flipFoldedState } from '../../cp-workspace/foldedFigureState';
import { hexToRgbColor, rgbColorToHex } from '../../lib/rgbColor';
import { ContextMenu } from '../ui/ContextMenu';
import type { ContextMenuItem, ContextMenuRequest } from '../ui/contextMenuTypes';
import { vertexPointsFromTransport } from '../../engine/oristudioCpGeometry';
import { CpTextOverlay } from '../../cp-workspace/CpTextOverlay';
import { CpImageOverlay } from '../../cp-workspace/CpImageOverlay';
import { CpImageInspector } from '../../cp-workspace/CpImageInspector';
import { createCpImage, type CpImage } from '../../cp-workspace/images/cpImage';
import { importImageFile, isSupportedImageFile } from '../../cp-workspace/images/cpImageImport';
import {
  fitImageModelSize,
  overlayCssPerModel,
  overlayCssToModel,
} from '../../cp-workspace/images/cpImagePlacement';
import {
  CpContextToolPanel,
  cpCommandRequiresContextApply,
  cpLineTypeStatusLabel,
} from './CpContextToolPanel';
import {
  buildCpDiagnosticMarkerHits,
  buildCpDiagnosticMarkers,
  buildCpDiagnosticStrokes,
  buildCpDiagnosticWedges,
  diagnosticEntryBounds,
  resolveCpDiagnosticToneColors,
} from '../../cp-workspace/diagnostics/geometry';
import { cpInputModel } from '../../cp-workspace/tools/inputModelRegistry';
import { distanceToSegment } from '../../cp-workspace/picking/lineHitIndex';
import { resolveCpLineColor } from '../../cp-workspace/adapters/cpLineColor';
import { readCssVarColor } from '../../cp-workspace/renderer/cssColor';
import { useThemeStore } from '../../store/themeStore';
import type { FoldedGeometry, Rgba, StrokeGeometry } from '../../cp-workspace/renderer/types';
import { foldedGeometryFromShapes } from '../../cp-workspace/adapters/cpFoldedToScene';
import {
  allowsDirectEntitySelection,
  isCreaseToggleMvClickTool,
  isDefaultSelectionMode,
  isLengthenCreaseOperation,
  isLineClickSelectionOperation,
  isLineEraseClickTool,
  isReflectSelectionOperation,
  isRestrictedDrawOperation,
  isSelectionCircleApplyOperation,
  isSquareBisectorOperation,
  isTextAnnotationOperation,
  isVariablePointSequenceOperation,
} from '../../cp-workspace/tools/predicates';
import {
  cpMeasurementSlotForOperation,
  createEmptyCpMeasurementSlots,
  isCpMeasurementOperation,
  type CpMeasurementSlots,
} from '../../cp-workspace/measure';
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

function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

const EMPTY_DIAGNOSTIC_ENTRIES: OristudioCpDiagnosticEntry[] = [];

const FOLDED_DISPLAY_STYLE_OPTIONS: OristudioCpFoldedFigureDisplayStyle[] = [
  'Paper5',
  'Transparent3',
  'Wire2',
];

function foldedDisplayStyleLabel(t: TFunction, value: OristudioCpFoldedFigureDisplayStyle): string {
  switch (value) {
    case 'Paper5':
      return t('panels:creasePattern.foldedStyle.paper', 'Paper');
    case 'Transparent3':
      return t('panels:creasePattern.foldedStyle.transparent', 'Transparent');
    case 'Wire2':
      return t('panels:creasePattern.foldedStyle.wire', 'Wire');
    case 'Development1':
      return t('panels:creasePattern.foldedStyle.dev1', 'Dev 1');
    case 'Development4':
      return t('panels:creasePattern.foldedStyle.dev4', 'Dev 4');
    case 'None0':
      return t('panels:creasePattern.foldedStyle.none', 'None');
    default:
      return value;
  }
}

const FOLDED_STATE_OPTIONS: OristudioCpFoldedFigureState[] = [
  'Front0',
  'Back1',
  'Both2',
  'Transparent3',
];

function foldedStateLabel(t: TFunction, value: OristudioCpFoldedFigureState): string {
  switch (value) {
    case 'Front0':
      return t('panels:creasePattern.foldedState.frontShort', 'F');
    case 'Back1':
      return t('panels:creasePattern.foldedState.backShort', 'B');
    case 'Both2':
      return t('panels:creasePattern.foldedState.both', 'Both');
    case 'Transparent3':
      return t('panels:creasePattern.foldedState.transparentShort', 'T');
    default:
      return value;
  }
}

function foldedStateTitle(t: TFunction, value: OristudioCpFoldedFigureState): string {
  switch (value) {
    case 'Front0':
      return t('panels:creasePattern.foldedState.front', 'Front');
    case 'Back1':
      return t('panels:creasePattern.foldedState.back', 'Back');
    case 'Both2':
      return t('panels:creasePattern.foldedState.bothTitle', 'Both');
    case 'Transparent3':
      return t('panels:creasePattern.foldedState.transparent', 'Transparent state');
    default:
      return value;
  }
}

// Front/back/line color pickers for a folded model (Oriedita's Front/Back/Line
// color actions). Fallbacks mirror the Rust FoldedFigureModel defaults.
type FoldedColorKey = 'front_color' | 'back_color' | 'line_color';
const FOLDED_COLOR_FIELDS: Array<{ key: FoldedColorKey; fallback: OristudioCpRgbColor }> = [
  { key: 'front_color', fallback: { red: 255, green: 255, blue: 50 } },
  { key: 'back_color', fallback: { red: 233, green: 233, blue: 233 } },
  { key: 'line_color', fallback: { red: 0, green: 0, blue: 0 } },
];

function foldedColorLabel(t: TFunction, key: FoldedColorKey): string {
  switch (key) {
    case 'front_color':
      return t('panels:creasePattern.foldedColor.front', 'Front');
    case 'back_color':
      return t('panels:creasePattern.foldedColor.back', 'Back');
    case 'line_color':
      return t('panels:creasePattern.foldedColor.line', 'Line');
    default:
      return key;
  }
}

function foldedColorAria(t: TFunction, key: FoldedColorKey): string {
  switch (key) {
    case 'front_color':
      return t('panels:creasePattern.foldedColor.frontAria', 'Folded front color');
    case 'back_color':
      return t('panels:creasePattern.foldedColor.backAria', 'Folded back color');
    case 'line_color':
      return t('panels:creasePattern.foldedColor.lineAria', 'Folded line color');
    default:
      return key;
  }
}

interface CpDiagnosticHudStatus {
  label: string;
  detail: string | null;
  tone: 'ok' | 'warn' | 'error';
}

function diagnosticOperationLabel(t: TFunction, operation: string): string {
  switch (operation) {
    case 'CheckCamv':
      return t('panels:creasePattern.diagnostic.camv', 'CAMV');
    case 'Check1':
      return t('panels:creasePattern.diagnostic.overlap', 'Overlap');
    case 'Check2':
      return t('panels:creasePattern.diagnostic.tJunction', 'T-junction');
    case 'Check3':
      return t('panels:creasePattern.diagnostic.vertexFoldability', 'Vertex foldability');
    case 'Check4':
      return t('panels:creasePattern.diagnostic.maekawaLbl', 'Maekawa/LBL');
    case 'FlatFoldableCheck':
      return t('panels:creasePattern.diagnostic.boundary', 'Boundary');
    default:
      return operation;
  }
}

function diagnosticHudStatus(
  t: TFunction,
  result: OristudioCpCommandResult | null | undefined,
  options: { issueOnly?: boolean } = {}
): CpDiagnosticHudStatus | null {
  if (!result || !isDiagnosticResultOperation(result.operation)) return null;
  if (!result?.diagnostics.length) return null;
  const entries = result.diagnostic_entries ?? EMPTY_DIAGNOSTIC_ENTRIES;
  const label = diagnosticOperationLabel(t, result.operation);
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
      label:
        errorCount === 1
          ? t('panels:creasePattern.diagnostic.errorOne', '{{count}} {{label}} Error', { count: errorCount, label })
          : t('panels:creasePattern.diagnostic.errorOther', '{{count}} {{label}} Errors', { count: errorCount, label }),
      detail,
      tone: 'error',
    };
  }

  if (warningCount > 0) {
    return {
      label:
        warningCount === 1
          ? t('panels:creasePattern.diagnostic.warningOne', '{{count}} {{label}} Warning', { count: warningCount, label })
          : t('panels:creasePattern.diagnostic.warningOther', '{{count}} {{label}} Warnings', { count: warningCount, label }),
      detail,
      tone: 'warn',
    };
  }

  if (options.issueOnly) return null;

  return {
    label: t('panels:creasePattern.diagnostic.ok', '{{label}} OK', { label }),
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
    operationId === 'LineSegmentDivision' ||
    operationId === 'LineSegmentRatioSet' ||
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

/**
 * Segment count for a preview circle of model radius `r`: scales with the
 * circumference (larger circles get more sides) with a high floor/cap, so the
 * preview reads as a smooth circle rather than a faceted polygon even zoomed in.
 */
function cpCircleRingSideCount(r: number): number {
  return Math.min(512, Math.max(128, Math.round(Math.abs(r) * 6)));
}

/** Approximate a circle (model coords) as ring segments, for the WebGL preview. */
function cpCircleRingSegments(
  x: number,
  y: number,
  r: number,
  sides = cpCircleRingSideCount(r)
): { a: Point; b: Point }[] {
  const out: { a: Point; b: Point }[] = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    out.push({
      a: { x: x + Math.cos(a0) * r, y: y + Math.sin(a0) * r },
      b: { x: x + Math.cos(a1) * r, y: y + Math.sin(a1) * r },
    });
  }
  return out;
}

/**
 * Existing creases the *active* end of a previewed crease lands on: for each
 * endpoint of the kernel preview geometry that is not one of the already-placed
 * points (`anchors`), the single crease it lies on (skipping junctions, where more
 * than one crease meets and which is meant would be ambiguous). This lets the
 * surface highlight a crease the new line snaps to even when the cursor point is
 * constrained off it — e.g. angle-restricted draw ending at an intersection, which
 * the point-under-cursor highlight can't see — without lighting up (and pinning) a
 * crease that merely happens to pass through a fixed anchor. Matches the vertex
 * rule of the live snap highlight: a lone crease lights up, a junction does not.
 */
function cpCreasesUnderPreviewEndpoints(
  previewSegments: readonly { a: Point; b: Point }[],
  anchors: readonly Point[],
  lineSegments: readonly OristudioCpLineSegment[],
  eps: number
): { a: Point; b: Point }[] {
  const nearAnchor = (p: Point) =>
    anchors.some((a) => Math.hypot(p.x - a.x, p.y - a.y) <= eps);
  const endpoints: Point[] = [];
  for (const s of previewSegments) {
    if (!nearAnchor(s.a)) endpoints.push(s.a);
    if (!nearAnchor(s.b)) endpoints.push(s.b);
  }
  const found = new Set<number>();
  for (const p of endpoints) {
    let onlyHit = -1;
    let count = 0;
    for (let i = 0; i < lineSegments.length && count < 2; i += 1) {
      const seg = lineSegments[i];
      if (distanceToSegment(p.x, p.y, seg.a, seg.b) <= eps) {
        count += 1;
        onlyHit = i;
      }
    }
    if (count === 1) found.add(onlyHit);
  }
  return [...found].map((i) => ({ a: lineSegments[i].a, b: lineSegments[i].b }));
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
  const { t } = useTranslation();
  return (
    <div className="cp-line-type-toolbar" aria-label={t('panels:creasePattern.activeCreaseLineType', 'Active crease line type')}>
      {ORISTUDIO_CP_LINE_TYPE_ACTIONS.map((action) => {
        const shortcut = shortcutLabelForAction(action.id, shortcutOverrides);
        return (
          <IconButton
            key={action.id}
            size="sm"
            variant="toolbar"
            title={shortcut ? `${cpActionLabel(t, action)} (${shortcut})` : cpActionLabel(t, action)}
            aria-label={cpActionLabel(t, action)}
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
  const { t } = useTranslation();
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
        title={activeExtraEntry ? activeExtraEntry.label : t('panels:creasePattern.moreLineColors', 'More line colors')}
        aria-label={t('panels:creasePattern.moreLineColors', 'More line colors')}
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
          aria-label={t('panels:creasePattern.extraLineColors', 'Extra line colors')}
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
              aria-label={cpPaletteLabel(t, entry)}
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const model = activeFigure?.snapshot?.model ?? null;
  const activeReady =
    activeFigure?.status === 'ready' && activeFigure.handle !== null && activeFigure.snapshot !== null;
  const currentCase = Math.max(activeFigure?.snapshot?.discovered_fold_cases ?? 1, 1);
  const canJumpCase = activeReady && Number.isFinite(Number(caseDraft));

  // Keep any display style already saved on a document selectable even if it is no
  // longer offered as a fresh choice (e.g. legacy Dev/None figures).
  const currentDisplayStyle = activeFigure?.displayStyle ?? 'Paper5';
  const foldedDisplayStyleOptions = FOLDED_DISPLAY_STYLE_OPTIONS.includes(currentDisplayStyle)
    ? FOLDED_DISPLAY_STYLE_OPTIONS
    : [...FOLDED_DISPLAY_STYLE_OPTIONS, currentDisplayStyle];

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
        title={t('panels:creasePattern.foldedModels', 'Folded models')}
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
          aria-label={t('panels:creasePattern.foldedModelControls', 'Folded model controls')}
        >
          <div className="folded-figure-menu__header">
            <span>{t('panels:creasePattern.foldedModels', 'Folded models')}</span>
            <span>{activeFigure ? activeFigure.title : t('panels:creasePattern.none', 'None')}</span>
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
                  <small>{figure.status === 'ready' ? t('panels:creasePattern.case', 'Case {{count}}', { count: figure.snapshot?.discovered_fold_cases ?? 0 }) : figure.status}</small>
                </button>
              ))}
            </div>
          )}
          <label className="folded-figure-menu__field">
            <span>{t('panels:creasePattern.start', 'Start')}</span>
            <input
              aria-label={t('panels:creasePattern.startingFace', 'Starting face')}
              type="number"
              min={1}
              step={1}
              value={startingFaceId}
              onChange={(event) => changeStartingFace(event.currentTarget.value)}
            />
          </label>
          <label className="folded-figure-menu__field">
            <span>{t('panels:creasePattern.display', 'Display')}</span>
            <select
              aria-label={t('panels:creasePattern.foldedDisplayStyle', 'Folded display style')}
              value={activeFigure?.displayStyle ?? 'Paper5'}
              disabled={!activeReady}
              onChange={(event) =>
                onDisplayStyle(event.currentTarget.value as OristudioCpFoldedFigureDisplayStyle)
              }
            >
              {foldedDisplayStyleOptions.map((value) => (
                <option key={value} value={value}>
                  {foldedDisplayStyleLabel(t, value)}
                </option>
              ))}
            </select>
          </label>
          <div className="folded-figure-menu__field folded-figure-menu__field--segmented">
            <span>{t('panels:creasePattern.side', 'Side')}</span>
            <SegmentedControl
              aria-label={t('panels:creasePattern.foldedModelSide', 'Folded model side')}
              options={FOLDED_STATE_OPTIONS.map((value) => ({
                value,
                label: foldedStateLabel(t, value),
                title: foldedStateTitle(t, value),
              }))}
              value={model?.state ?? 'Front0'}
              onChange={(state) => onModelUpdate({ state })}
            />
          </div>
          <div className="folded-figure-menu__colors">
            {FOLDED_COLOR_FIELDS.map((field) => (
              <label key={field.key} className="folded-figure-menu__color">
                <span>{foldedColorLabel(t, field.key)}</span>
                <input
                  aria-label={foldedColorAria(t, field.key)}
                  type="color"
                  value={rgbColorToHex(model?.[field.key] ?? field.fallback)}
                  disabled={!activeReady}
                  onChange={(event) =>
                    onModelUpdate({ [field.key]: hexToRgbColor(event.currentTarget.value) })
                  }
                />
              </label>
            ))}
          </div>
          <label className="folded-figure-menu__field">
            <span>{t('panels:creasePattern.caseLabel', 'Case')}</span>
            <div className="folded-figure-menu__case">
              <input
                aria-label={t('panels:creasePattern.foldCase', 'Fold case')}
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
                title={t('panels:creasePattern.goToFoldedCase', 'Go to folded case')}
                disabled={!canJumpCase}
                onClick={onFoldToCase}
              >
                <ChevronRight size={14} />
              </IconButton>
            </div>
          </label>
          <div className="folded-figure-menu__hint">{t('panels:creasePattern.current', 'Current {{count}}', { count: currentCase })}</div>
          <div className="folded-figure-menu__toggle-row">
            <span>{t('panels:creasePattern.shadow', 'Shadow')}</span>
            <Toggle
              checked={model?.display_shadows ?? false}
              disabled={!activeReady}
              onChange={(display_shadows) => onModelUpdate({ display_shadows })}
              aria-label={t('panels:creasePattern.showFoldedModelShadow', 'Show folded model shadow')}
            />
          </div>
          <div className="folded-figure-menu__toggle-row">
            <span>{t('panels:creasePattern.colorAlpha', 'Color alpha')}</span>
            <Toggle
              checked={model?.transparency_color ?? false}
              disabled={!activeReady}
              onChange={(transparency_color) => onModelUpdate({ transparency_color })}
              aria-label={t('panels:creasePattern.useColoredFoldedTransparency', 'Use colored folded transparency')}
            />
          </div>
          <label className="folded-figure-menu__field folded-figure-menu__field--range">
            <span>{t('panels:creasePattern.alpha', 'Alpha')}</span>
            <input
              aria-label={t('panels:creasePattern.foldedTransparency', 'Folded transparency')}
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
              title={t('panels:creasePattern.duplicateFoldedModel', 'Duplicate folded model')}
              disabled={activeFigure?.handle == null}
              onClick={() => onDuplicate()}
            >
              <Copy size={14} />
            </IconButton>
            <IconButton
              size="sm"
              variant="toolbar"
              title={t('panels:creasePattern.deleteFoldedModel', 'Delete folded model')}
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

export function CreasePatternPanel() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cpViewportRef = useRef<HTMLDivElement | null>(null);
  const [toolOptionsPortalTarget, setToolOptionsPortalTarget] = useState<HTMLElement | null>(null);
  const zoomPercentRef = useRef(100);
  const [zoomPercent, setZoomPercent] = useState(100);
  // Viewport-toolbar commands routed to the WebGL surface's owned camera (the SVG
  // controls drive react-zoom-pan-pinch, which the GL camera ignores). A bumped nonce
  // re-fires the same command.
  const [webglCameraCommand, setWebglCameraCommand] = useState<CameraCommand | null>(null);
  const cameraCommandNonceRef = useRef(0);
  const sendWebglCameraCommand = useCallback(
    (kind: CameraCommand['kind'], percent?: number) => {
      setWebglCameraCommand({ kind, percent, nonce: ++cameraCommandNonceRef.current });
    },
    []
  );
  const handleWebglZoomPercent = useCallback((percent: number) => {
    zoomPercentRef.current = percent;
    setZoomPercent(percent);
  }, []);
  // The WebGL camera's model→CSS affine, for positioning the text-annotation overlay.
  const [webglOverlayView, setWebglOverlayView] = useState<CpOverlayView | null>(null);
  const handleWebglViewChange = useCallback((view: CpOverlayView) => {
    setWebglOverlayView(view);
  }, []);
  const [spacePressed, setSpacePressed] = useState(false);
  // Images tool: when on, the reference-image overlay is interactive (select /
  // move / resize / rotate) and crease clicks fall through to it only over an
  // image. Store-owned so the load transaction can set it atomically (a saved
  // file with images opens ready to edit) — see projectSlice.
  const imageEditMode = useWorkspaceStore((state) => state.oristudioCpImageEditMode);
  const setImageEditMode = useWorkspaceStore((state) => state.setOristudioCpImageEditMode);
  const [cpToolState, setCpToolState] = useState(IDLE_ORISTUDIO_CP_TOOL_STATE);
  const [activeCpLineColor, setActiveCpLineColor] = useState<OristudioCpLineColor>('Red1');
  const [foldStartingFaceId, setFoldStartingFaceId] = useState(1);
  const [foldCaseDraft, setFoldCaseDraft] = useState('1');
  const [cpToolOptions, setCpToolOptions] = useState<OristudioCpToolOptions>(
    DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS
  );
  const [cpToolPoints, setCpToolPoints] = useState<Point[]>([]);
  const [cpToolPath, setCpToolPath] = useState<Point[]>([]);
  const [pendingLengthenLineId, setPendingLengthenLineId] = useState<number | null>(null);
  const [pendingSquareBisectorLineIds, setPendingSquareBisectorLineIds] = useState<number[]>([]);
  // Model point of an empty-canvas Text-tool click, relayed to the overlay to open
  // an inline-edit draft there. Cleared once the overlay has consumed it.
  const [textCreateDraftAt, setTextCreateDraftAt] = useState<Point | null>(null);
  const [cpMeasurementSlots, setCpMeasurementSlots] = useState<CpMeasurementSlots>(
    createEmptyCpMeasurementSlots
  );
  const [diagnosticHudExpanded, setDiagnosticHudExpanded] = useState(false);
  const defaultCpToolDocumentRef = useRef<string | null>(null);
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

  const project = useWorkspaceStore((state) => state.project);
  const status = useWorkspaceStore((state) => state.status);
  const error = useWorkspaceStore((state) => state.error);
  const importedCreasePattern = useWorkspaceStore((state) => state.importedCreasePattern);
  const activeEditingContext = useWorkspaceStore((state) => state.activeEditingContext);
  const oristudioCpDocument = useWorkspaceStore((state) => state.oristudioCpDocument);
  const ensureEditCreasePattern = useWorkspaceStore((state) => state.ensureEditCreasePattern);
  // Always-live canvas: seed a blank editable CP when the Edit workspace mounts
  // with no crease pattern (fresh app, or after a design reset cleared it).
  useEffect(() => {
    if (!oristudioCpDocument) void ensureEditCreasePattern();
  }, [oristudioCpDocument, ensureEditCreasePattern]);
  const oristudioCpCamvResult = useWorkspaceStore((state) => state.oristudioCpCamvResult);
  const oristudioCpSelection = useWorkspaceStore((state) => state.oristudioCpSelection);
  const oristudioCpImages = useWorkspaceStore((state) => state.oristudioCpImages);
  const oristudioCpSelectedImageId = useWorkspaceStore(
    (state) => state.oristudioCpSelectedImageId
  );
  const addCpImage = useWorkspaceStore((state) => state.addCpImage);
  const updateCpImage = useWorkspaceStore((state) => state.updateCpImage);
  const removeCpImage = useWorkspaceStore((state) => state.removeCpImage);
  const setSelectedCpImage = useWorkspaceStore((state) => state.setSelectedCpImage);
  const recordCpImageHistory = useWorkspaceStore((state) => state.recordCpImageHistory);
  const selectedCpImage =
    oristudioCpImages.find((image) => image.id === oristudioCpSelectedImageId) ?? null;
  // Image-layer state captured at the start of a move/resize/rotate gesture, so
  // the whole gesture records a single undo entry on commit.
  const preGestureImagesRef = useRef<readonly CpImage[] | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const beginImageGesture = useCallback(() => {
    preGestureImagesRef.current = useWorkspaceStore.getState().oristudioCpImages;
  }, []);
  const commitImageGesture = useCallback(
    (label: string) => {
      const previous = preGestureImagesRef.current;
      preGestureImagesRef.current = null;
      if (previous) recordCpImageHistory([...previous], label);
    },
    [recordCpImageHistory]
  );

  // Import an image file and add it as a reference image, placed at the given
  // client point (or the view center) and sized to ~half the view. Shared by the
  // drop handler and the Insert-image button.
  const addImageFromFile = useCallback(
    async (file: File, client: { x: number; y: number } | null) => {
      const view = webglOverlayView;
      const rect = cpViewportRef.current?.getBoundingClientRect();
      try {
        const source = await importImageFile(file);
        let center = { x: 0.5, y: 0.5 };
        let targetExtent = 1;
        if (view && rect) {
          const cssPoint = client
            ? { x: client.x - rect.left, y: client.y - rect.top }
            : { x: rect.width / 2, y: rect.height / 2 };
          const model = overlayCssToModel(view, cssPoint);
          if (model) center = model;
          const cssPerModel = overlayCssPerModel(view);
          if (cssPerModel > 0) {
            targetExtent = (0.5 * Math.min(rect.width, rect.height)) / cssPerModel;
          }
        }
        const { width, height } = fitImageModelSize(
          source.naturalWidth,
          source.naturalHeight,
          targetExtent
        );
        const images = useWorkspaceStore.getState().oristudioCpImages;
        const topZ = images.reduce((max, image) => Math.max(max, image.z), 0);
        addCpImage(
          createCpImage({
            src: source.src,
            naturalWidth: source.naturalWidth,
            naturalHeight: source.naturalHeight,
            center,
            width,
            height,
            z: topZ + 1,
          })
        );
        recordCpImageHistory([...images], t('panels:creasePattern.addImage', 'Add image'));
        setImageEditMode(true);
      } catch (error) {
        console.error('[cp-image] failed to import image', error);
      }
    },
    [addCpImage, recordCpImageHistory, setImageEditMode, webglOverlayView, t]
  );

  const handleViewportDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (Array.from(event.dataTransfer.types).includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleViewportDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const file = Array.from(event.dataTransfer.files).find(isSupportedImageFile);
      if (!file) return;
      event.preventDefault();
      void addImageFromFile(file, { x: event.clientX, y: event.clientY });
    },
    [addImageFromFile]
  );

  // Image-layer edits driven by the inspector: each records one undo entry.
  const bringSelectedImageToFront = useCallback(() => {
    if (!oristudioCpSelectedImageId) return;
    const images = useWorkspaceStore.getState().oristudioCpImages;
    const maxZ = images.reduce((max, image) => Math.max(max, image.z), 0);
    beginImageGesture();
    updateCpImage(oristudioCpSelectedImageId, { z: maxZ + 1 });
    commitImageGesture(t('panels:creasePattern.bringImageToFront', 'Bring image to front'));
  }, [oristudioCpSelectedImageId, updateCpImage, beginImageGesture, commitImageGesture, t]);

  const sendSelectedImageToBack = useCallback(() => {
    if (!oristudioCpSelectedImageId) return;
    const images = useWorkspaceStore.getState().oristudioCpImages;
    const minZ = images.reduce((min, image) => Math.min(min, image.z), 0);
    beginImageGesture();
    updateCpImage(oristudioCpSelectedImageId, { z: minZ - 1 });
    commitImageGesture(t('panels:creasePattern.sendImageToBack', 'Send image to back'));
  }, [oristudioCpSelectedImageId, updateCpImage, beginImageGesture, commitImageGesture, t]);

  const deleteSelectedImage = useCallback(() => {
    if (!oristudioCpSelectedImageId) return;
    beginImageGesture();
    removeCpImage(oristudioCpSelectedImageId);
    commitImageGesture(t('panels:creasePattern.deleteImage', 'Delete image'));
  }, [oristudioCpSelectedImageId, removeCpImage, beginImageGesture, commitImageGesture, t]);

  // Delete/Backspace removes the selected image while the Images tool is active.
  // Ignored when typing in a field so it never eats text edits.
  useEffect(() => {
    if (!imageEditMode || !oristudioCpSelectedImageId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      event.preventDefault();
      deleteSelectedImage();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [imageEditMode, oristudioCpSelectedImageId, deleteSelectedImage]);

  const oristudioCpActionRequest = useWorkspaceStore((state) => state.oristudioCpActionRequest);
  const oristudioCpFoldedFigures = useWorkspaceStore((state) => state.oristudioCpFoldedFigures);
  const oristudioCpActiveFoldedFigureId = useWorkspaceStore(
    (state) => state.oristudioCpActiveFoldedFigureId
  );
  const oristudioCpActiveDiagnosticId = useWorkspaceStore(
    (state) => state.oristudioCpActiveDiagnosticId
  );
  const oristudioCpViewport = useWorkspaceStore((state) => state.oristudioCpViewport);
  const projectLoadId = useWorkspaceStore((state) => state.projectLoadId);
  // Crease lines always use Oriedita's default M/V/flat/border coloring; the
  // color-by toggle has been removed from the CP panel header.
  const mode = 'mvf' as const;
  const currentTheme = useThemeStore((state) => state.currentTheme);
  const toggleOristudioCpLineSelection = useWorkspaceStore(
    (state) => state.toggleOristudioCpLineSelection
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
      ? t('panels:creasePattern.case', 'Case {{count}}', {
          count: activeFoldedFigure.snapshot?.discovered_fold_cases ?? 0,
        })
      : activeFoldedFigure.status === 'loading'
        ? t('panels:creasePattern.folding', 'Folding')
        : activeFoldedFigure.status === 'error'
          ? t('panels:creasePattern.foldError', 'Fold error')
          : t('panels:creasePattern.unsupported', 'Unsupported')
    : t('panels:creasePattern.noFold', 'No fold');
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

  // Right-click context menu for a folded form. Items act on the clicked figure by
  // id (not the active one), so they behave correctly even before selection settles.
  const [foldedContextMenu, setFoldedContextMenu] = useState<ContextMenuRequest | null>(null);
  // The folded figure armed for a drag-to-scale gesture (chosen "Scale"), or null.
  const [pendingScaleFigureId, setPendingScaleFigureId] = useState<string | null>(null);
  const buildFoldedFigureMenuItems = useCallback(
    (figure: OristudioCpFoldedFigureEntry): ContextMenuItem[] => {
      const ready =
        figure.status === 'ready' && figure.handle !== null && figure.snapshot !== null;
      const currentState = figure.snapshot?.model.state ?? 'Front0';
      return [
        {
          kind: 'action',
          id: 'flip',
          label: t('panels:creasePattern.flip', 'Flip'),
          icon: <FlipHorizontal2 size={14} />,
          disabled: !ready,
          // Turn the paper over: Front <-> Back. The Both/Transparent overlay
          // states live on the toolbar's "Side" control, not here.
          onSelect: () =>
            void updateOristudioCpFoldedFigureModel(figure.id, {
              state: flipFoldedState(currentState),
            }),
        },
        {
          kind: 'action',
          id: 'scale',
          label: t('panels:creasePattern.scale', 'Scale'),
          icon: <Maximize2 size={14} />,
          disabled: !ready,
          // Arm the canvas; the next drag scales this figure live.
          onSelect: () => setPendingScaleFigureId(figure.id),
        },
        {
          kind: 'action',
          id: 'delete',
          label: t('panels:creasePattern.delete', 'Delete'),
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: () => void deleteOristudioCpFoldedFigure(figure.id),
        },
        {
          kind: 'action',
          id: 'duplicate',
          label: t('panels:creasePattern.duplicate', 'Duplicate'),
          icon: <Copy size={14} />,
          disabled: figure.handle === null,
          onSelect: () => void duplicateOristudioCpFoldedFigure(figure.id),
        },
        {
          kind: 'action',
          id: 'wireframe',
          label: t('panels:creasePattern.wireframe', 'Wireframe'),
          icon: <Box size={14} />,
          disabled: !ready,
          onSelect: () => void setOristudioCpFoldedFigureDisplayStyle(figure.id, 'Wire2'),
        },
        {
          kind: 'action',
          id: 'xray',
          label: t('panels:creasePattern.xray', 'X-ray'),
          icon: <Eye size={14} />,
          disabled: !ready,
          onSelect: () =>
            void setOristudioCpFoldedFigureDisplayStyle(figure.id, 'Transparent3'),
        },
      ];
    },
    [
      updateOristudioCpFoldedFigureModel,
      deleteOristudioCpFoldedFigure,
      duplicateOristudioCpFoldedFigure,
      setOristudioCpFoldedFigureDisplayStyle,
      t,
    ]
  );
  const handleRequestContextMenu = useCallback(
    (request: CpContextMenuRequest) => {
      // Only folded figures raise a menu today; other targets fall through to the
      // canvas's existing behavior (e.g. right-drag erase).
      if (request.target.kind !== 'folded-figure') return;
      const figureId = request.target.figureId;
      const figure = oristudioCpFoldedFigures.find((candidate) => candidate.id === figureId);
      if (!figure) return;
      setOristudioCpActiveFoldedFigure(figureId);
      setFoldedContextMenu({
        x: request.clientX,
        y: request.clientY,
        items: buildFoldedFigureMenuItems(figure),
      });
    },
    [oristudioCpFoldedFigures, setOristudioCpActiveFoldedFigure, buildFoldedFigureMenuItems]
  );
  // Vertex dots: dedup crease-segment endpoints — the top main-thread cost after an
  // edit on dense patterns. Dedup straight from the transport's typed arrays
  // (parity-proven identical to getCpVertexPoints); the structured fallback only runs
  // for a state that carries no geometry.
  const editableCpGeometry = oristudioCpDocument?.geometry ?? null;
  const editableCpVertexPoints = useMemo(
    () =>
      editableCpGeometry
        ? vertexPointsFromTransport(editableCpGeometry)
        : getCpVertexPoints(editableCp),
    [editableCp, editableCpGeometry]
  );
  const importedFoldedForms = useMemo(
    () =>
      (importedCreasePattern?.sourceFold?.file_frames ?? [])
        .filter(isRenderableFoldedFormFrame),
    [importedCreasePattern?.sourceFold]
  );
  // WebGL geometry for the imported .fold folded-form frames: faces → fills, edges →
  // strokes in SVG user coords (via the same row layout as the SVG layer), so the
  // surface can draw them through its `userView` like the generated folded figures.
  const cpImportedFoldedFormsGeometry = useMemo<FoldedGeometry | null>(() => {
    void currentTheme;
    if (importedFoldedForms.length === 0) return null;
    const startIndex = generatedFoldedFigures.filter(isRenderableGeneratedFoldedFigure).length;
    const faceColor: Rgba = [1, 1, 50 / 255, 0.58]; // matches .cp-folded-form-face (#ffff32 @ .58)
    const tp = readCssVarColor(document.documentElement, '--text-primary', [0.9, 0.9, 0.9, 1]);
    const mix = (c: number) => c * 0.84 + 0.067 * 0.16; // color-mix(text-primary 84%, #111)
    const edgeColor: Rgba = [mix(tp[0]), mix(tp[1]), mix(tp[2]), 0.86];
    const faces: { ring: Point[]; color: Rgba }[] = [];
    const edges: { a: Point; b: Point; color: Rgba; width: number }[] = [];
    importedFoldedForms.forEach((frame, index) => {
      const vertices = foldFrameVertices(frame);
      const bounds = foldFrameBounds(vertices);
      if (!bounds) return;
      const toUser = (point: Point) => foldedFormPointToSvg(point, bounds, startIndex + index);
      for (const face of foldFrameFaces(frame, vertices)) {
        faces.push({ ring: face.map(toUser), color: faceColor });
      }
      for (const [a, b] of foldFrameEdges(frame, vertices)) {
        edges.push({ a: toUser(a), b: toUser(b), color: edgeColor, width: 1.15 });
      }
    });
    return foldedGeometryFromShapes(faces, edges);
  }, [importedFoldedForms, generatedFoldedFigures, currentTheme]);
  const camvIssuesVisible = oristudioCpViewport.camvIssuesVisible !== false;
  const hasEditableCreasePattern = !!editableCp;
  const hasCreasePattern =
    hasEditableCreasePattern || project.creases.length > 0 || project.facets.length > 0;
  const editableSelectionSize = cpSelectionSize(oristudioCpSelection);
  const selectedEditableCpLines = useMemo(
    () => selectedCpLineSegments(editableCp, oristudioCpSelection),
    [editableCp, oristudioCpSelection]
  );
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
  const squareBisectorToolPrompt =
    isSquareBisectorOperation(activeCpCommand?.operationId) &&
    cpToolState.phase === 'active' &&
    cpToolPoints.length === 0
      ? pendingSquareBisectorLineIds.length === 1
        ? t('panels:creasePattern.angleBisectorSelect2Lines', 'Angle Bisector: Select 2 lines')
        : pendingSquareBisectorLineIds.length === 2
          ? t('panels:creasePattern.angleBisectorSelectSegmentToEnd', 'Angle Bisector: Select segment to end')
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
  // WebGL diagnostic overlay geometry (markers + segment highlights). Rebuilt when
  // the entries or theme change; the tone colours read the current theme's CSS vars.
  const cpDiagnosticGeometry = useMemo(() => {
    void currentTheme;
    const toneColors = resolveCpDiagnosticToneColors(document.documentElement);
    return {
      markers: buildCpDiagnosticMarkers(latestDiagnosticEntries, toneColors),
      strokes: buildCpDiagnosticStrokes(latestDiagnosticEntries, toneColors),
      wedges: buildCpDiagnosticWedges(latestDiagnosticEntries, toneColors),
      hits: buildCpDiagnosticMarkerHits(latestDiagnosticEntries),
    };
  }, [latestDiagnosticEntries, currentTheme]);
  // Oriedita operation-frame outline for the WebGL surface: a dashed accent-coloured
  // closed loop (SVG `.cp-operation-frame`), or null when no frame is active.
  const cpOperationFrameStrokes = useMemo<StrokeGeometry | null>(() => {
    void currentTheme;
    const frame = editableCp?.operation_frame;
    if (!frame?.active) return null;
    const color = readCssVarColor(document.documentElement, '--accent-primary', [0.4, 0.6, 1, 1]);
    const p = frame.points;
    const edges: [Point, Point][] = [
      [p[0], p[1]],
      [p[1], p[2]],
      [p[2], p[3]],
      [p[3], p[0]],
    ];
    const count = edges.length;
    const a = new Float32Array(count * 2);
    const b = new Float32Array(count * 2);
    const colors = new Float32Array(count * 4);
    const widthMul = new Float32Array(count).fill(1);
    edges.forEach(([start, end], i) => {
      a[i * 2] = start.x;
      a[i * 2 + 1] = start.y;
      b[i * 2] = end.x;
      b[i * 2 + 1] = end.y;
      colors.set(color, i * 4);
    });
    return { a, b, color: colors, widthMul, count, dashed: true };
  }, [editableCp?.operation_frame, currentTheme]);
  const diagnosticStatus = useMemo(
    () => {
      const camvStatus = camvIssuesVisible
        ? diagnosticHudStatus(t, oristudioCpCamvResult, { issueOnly: true })
        : null;
      const commandStatus =
        !camvIssuesVisible && lastCommandResult?.operation === 'CheckCamv'
          ? null
          : diagnosticHudStatus(t, lastCommandResult);
      return camvStatus ?? commandStatus;
    },
    [camvIssuesVisible, lastCommandResult, oristudioCpCamvResult, t]
  );
  const diagnosticHudEntries = useMemo(() => {
    const hudResult =
      camvIssuesVisible && diagnosticHudStatus(t, oristudioCpCamvResult, { issueOnly: true }) !== null
        ? oristudioCpCamvResult
        : !camvIssuesVisible && lastCommandResult?.operation === 'CheckCamv'
          ? null
          : lastCommandResult;
    if (!hudResult || !isDiagnosticResultOperation(hudResult.operation)) {
      return EMPTY_DIAGNOSTIC_ENTRIES;
    }
    return hudResult.diagnostic_entries ?? EMPTY_DIAGNOSTIC_ENTRIES;
  }, [camvIssuesVisible, lastCommandResult, oristudioCpCamvResult, t]);
  const activeDiagnosticEntry = useMemo(
    () =>
      latestDiagnosticEntries.find((entry) => entry.id === oristudioCpActiveDiagnosticId) ?? null,
    [latestDiagnosticEntries, oristudioCpActiveDiagnosticId]
  );
  // Model bounds of the selected diagnostic, for the WebGL surface to frame in its
  // owned camera (the SVG focus effect drives the SVG transform, not the GL camera).
  const cpDiagnosticFocusBounds = useMemo(() => {
    if (!activeDiagnosticEntry) return null;
    const bounds = diagnosticEntryBounds(activeDiagnosticEntry);
    return bounds
      ? { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY }
      : null;
  }, [activeDiagnosticEntry]);
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


  const handleCpToolAction = useCallback(
    (action: OristudioCpActionDefinition) => {
      setPendingLengthenLineId(null);
      if (action.kind === 'line-type') {
        setActiveCpLineColor(action.lineColor);
        return;
      }

      // Picking a crease/geometry tool deselects the active reference image, so
      // its handles don't linger over the canvas while another tool is active.
      // (Image-layer interactivity itself is left untouched.)
      setSelectedCpImage(null);

      const command = action.command;
      setCpToolPoints([]);
      setCpToolPath([]);
      setPendingSquareBisectorLineIds([]);
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
                      message: useWorkspaceStore.getState().oristudioCpError ?? t('panels:creasePattern.commandFailed', 'Command failed'),
                    }
              )
            : state
        );
      })();
    },
    [
      buildCpCommandPayload,
      editableCp,
      executeOristudioCpCommand,
      oristudioCpSelection.lines,
      setSelectedCpImage,
      t,
    ]
  );

  const handleCpShortcutAction = useCallback(
    (actionId: OristudioCpActionId) => {
      const action = cpActionById(actionId);
      if (!action) return;
      // The `foldAction` (F) chord resolves to the Fold / FoldingEstimate CP
      // commands, which are still unimplemented stubs — selecting them as a tool
      // does nothing. Route F to the real fold path (the toolbar Fold button),
      // matching Oriedita where F folds the model in place.
      if (action.kind !== 'line-type') {
        const operationId = action.command.operationId;
        if (operationId === 'Fold' || operationId === 'FoldingEstimate') {
          handleFoldModel();
          return;
        }
      }
      handleCpToolAction(action);
    },
    [handleCpToolAction, handleFoldModel]
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
        !isVariablePointSequenceOperation(activeCpCommand.operationId))
    ) {
      return;
    }
    if (activeCpCommand.operationId === 'VoronoiCreate' && cpToolPoints.length === 0) {
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
      const succeeded = await executeOristudioCpCommand(
        activeCpCommand.operationId,
        buildCpCommandPayload(activeCpCommand, selectionPayload)
      );
      if (succeeded && activeCpCommand.operationId === 'VoronoiCreate') {
        setCpToolPoints([]);
      }
      setCpToolState((state) =>
        state.activeOperationId === activeCpCommand.operationId
          ? transitionOristudioCpToolState(
              state,
              succeeded
                  ? { type: 'commit', keepActive: true }
                : {
                    type: 'commandError',
                    message: useWorkspaceStore.getState().oristudioCpError ?? t('panels:creasePattern.commandFailed', 'Command failed'),
                  }
            )
          : state
      );
    })();
  }, [
    activeCpCommand,
    buildCpCommandPayload,
    cpToolPoints,
    editableCp,
    executeOristudioCpCommand,
    oristudioCpSelection.circles,
    oristudioCpSelection.lines,
    t,
  ]);

  const handleClearActiveContextInput = useCallback(() => {
    if (!activeCpCommand || activeCpCommand.operationId !== 'VoronoiCreate') return;
    setCpToolPoints([]);
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
                    message: useWorkspaceStore.getState().oristudioCpError ?? t('panels:creasePattern.commandFailed', 'Command failed'),
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
    t,
  ]);

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
      const anchorPoints = cpLineSelectionMoveAnchorPoints(translated, 0);
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
    [editableCpBounds, oristudioCpViewport, selectedEditableCpLines, selectionMoveSnapDocument]
  );

  // WebGL draw tools: snap a raw model draw point to nearby geometry (the surface
  // supplies its camera-derived tolerance), mirroring resolveEditableDrawPoint.
  const resolveEditableDrawModelPoint = useCallback(
    (rawPoint: Point, toleranceModel: number): { point: Point; snapped: boolean } => {
      if (!editableCp) return { point: rawPoint, snapped: false };
      const target = nearestOrieditaDrawPointTarget(
        editableCp,
        rawPoint,
        editableCpBounds,
        oristudioCpViewport,
        toleranceModel
      );
      // Report whether the point locked onto a grid point / vertex, so a restricted
      // draw can reject a start/end that doesn't snap.
      return { point: target?.point ?? rawPoint, snapped: target !== null };
    },
    [editableCp, editableCpBounds, oristudioCpViewport]
  );

  // Crease steps: snap the point onto the nearest crease (forcing line/vertex
  // snapping) so the kernel resolves that crease from the point.
  const resolveEditableDrawPointOnCrease = useCallback(
    (rawPoint: Point, toleranceModel: number): { point: Point; snappedToVertex: boolean } => {
      if (!editableCp) return { point: rawPoint, snappedToVertex: false };
      const target = nearestCpSnapTarget(
        editableCp,
        rawPoint,
        editableCpBounds,
        { ...oristudioCpViewport, snapToLines: true, snapToVertices: true },
        toleranceModel
      );
      // Report whether we snapped to a crease *junction* (a vertex where multiple
      // creases meet). The surface highlights the single line under any other snap
      // (line interior, or a grid point that lies on a line) but suppresses the
      // highlight at a junction, where which crease is meant is ambiguous.
      return { point: target?.point ?? rawPoint, snappedToVertex: target?.kind === 'vertex' };
    },
    [editableCp, editableCpBounds, oristudioCpViewport]
  );

  // "First click decides" classifier for the dual-mode tools (Mirror Line, Square
  // Bisector), mirroring Oriedita's `getClosestPoint` vs `getClosestLineSegment`
  // logic: the nearest snappable *point* — vertices AND grid points (per the snapping
  // setting) — wins ties, and a line only wins when it is *strictly* closer. Grid
  // inclusion is what lets a click land as a point even when it sits on a crease (a
  // grid point on the paper edge), instead of being read as a line selection; the
  // strict-closer rule keeps a bare mid-crease click a line. Point/vertex ties still
  // resolve to point mode, so Mirror Line's "click a vertex" path is unchanged.
  const resolveEditableFirstPickKind = useCallback(
    (rawPoint: Point, toleranceModel: number): 'point' | 'line' => {
      if (!editableCp) return 'point';
      const point = nearestOrieditaDrawPointTarget(
        editableCp,
        rawPoint,
        editableCpBounds,
        { ...oristudioCpViewport, snapToVertices: true },
        toleranceModel
      );
      const line = nearestCpSnapTarget(
        editableCp,
        rawPoint,
        editableCpBounds,
        { ...oristudioCpViewport, snapToLines: true, snapToVertices: false, snapToGrid: false },
        toleranceModel
      );
      if (line?.kind === 'line' && (!point || line.distance < point.distance)) return 'line';
      return 'point';
    },
    [editableCp, editableCpBounds, oristudioCpViewport]
  );

  // WebGL draw tools: commit a tool's collected points through the kernel command
  // (creases are resolved kernel-side from the points), then keep it active.
  const handleWebglToolCommit = useCallback(
    (commit: { points?: readonly Point[]; lineIds?: readonly number[]; additive?: boolean }) => {
      const command = activeCpCommand;
      if (!command || command.uiStatus !== 'ready') return;
      const points = commit.points ?? [];
      const pickedLineIds = commit.lineIds ?? [];
      // Line-entity tools (Lengthen) commit the picked crease ids as `line_ids`
      // and carry no points; the kernel operates on those creases directly. Every
      // other tool's engine only commits once it has its full point count, so any
      // non-empty point list is valid — including 1-point tools (DrawPoint,
      // DeletePoint, tangent-through-point, …). Reject only an empty commit.
      const isLineEntityCommit = pickedLineIds.length > 0 && points.length === 0;
      if (!isLineEntityCommit && points.length === 0) return;

      // Measure tools are non-mutating: never execute (the kernel has no execute arm
      // by design). Ask the kernel for the exact length/angle at the committed points
      // and store it in the panel slot; then just finalize the tool state.
      const measurementSlot = cpMeasurementSlotForOperation(command.operationId);
      if (measurementSlot) {
        void previewOristudioCpCommand(
          command.operationId,
          buildCpCommandPayload(command, { points: [...points] })
        ).then((preview) => {
          const value = preview?.measurement;
          if (value != null) {
            setCpMeasurementSlots((current) => ({ ...current, [measurementSlot]: value }));
          }
        });
        setCpToolState((state) =>
          state.activeOperationId === command.operationId
            ? transitionOristudioCpToolState(state, { type: 'commit', keepActive: true })
            : state
        );
        return;
      }
      void (async () => {
        const succeeded = await executeOristudioCpCommand(
          command.operationId,
          buildCpCommandPayload(command, {
            // Line-entity commits send the picked ids. Box select/unselect, flip,
            // and erase resolve their region from the box *points* kernel-side and
            // must send empty line_ids — CreaseSelect prioritises line_ids over the
            // box, so passing the prior selection would re-select it instead of the
            // new region. Other tools carry the prior selection as their input.
            line_ids:
              isLineEntityCommit
                ? [...pickedLineIds]
                : isCreaseToggleMvClickTool(command.operationId) ||
                    isLineEraseClickTool(command.operationId) ||
                    isLineClickSelectionOperation(command.operationId) ||
                    // Square Bisector's point mode resolves everything from its 4
                    // points; the kernel routes to line mode when line_ids has ≥3, so
                    // never leak the ambient selection into it.
                    command.operationId === 'SquareBisector' ||
                    // Lengthen commits a 3-point selection line + target; the kernel
                    // prioritises line_ids ≥ 2, so a stray ambient selection would
                    // hijack it into the click-pick path. Send its points alone.
                    isLengthenCreaseOperation(command.operationId)
                  ? []
                  : oristudioCpSelection.lines,
            circle_ids: oristudioCpSelection.circles,
            points: [...points],
            // A plain box/lasso/polygon select replaces the selection; holding a
            // modifier (additive) adds to it. The kernel selects are additive by
            // default, so the replace is done kernel-side when this is true.
            replace_selection:
              command.operationId === 'CreaseSelect' ||
              command.operationId === 'SelectLasso' ||
              command.operationId === 'SelectPolygon'
                ? !commit.additive
                : undefined,
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
                      message: useWorkspaceStore.getState().oristudioCpError ?? t('panels:creasePattern.commandFailed', 'Command failed'),
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
      previewOristudioCpCommand,
      oristudioCpSelection.circles,
      oristudioCpSelection.lines,
      t,
    ]
  );

  // Drive the step prompt for a WebGL line-entity tool (Lengthen) in lock-step
  // with the creases it has picked: derive the step from the pick count (reset,
  // then advance once per pick) so the prompt reads "Select target line" after the
  // first pick — parity with the SVG, whose `pendingLengthenLineId` advances it.
  const handleWebglToolPickProgress = useCallback(
    (picked: number) => {
      const command = activeCpCommand;
      if (!command || command.uiStatus !== 'ready') return;
      setCpToolState((state) => {
        if (state.activeOperationId !== command.operationId) return state;
        let next = transitionOristudioCpToolState(state, { type: 'cancel', keepActive: true });
        for (let i = 0; i < picked; i += 1) {
          next = transitionOristudioCpToolState(next, { type: 'advanceStep' });
        }
        return next;
      });
    },
    [activeCpCommand]
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

  // The active tool's WebGL routing from its declarative steps: a drag mode; a
  // click-based `sequence` with a per-step kind (free point vs picked crease); or
  // null. A step that is neither cleanly a point nor a crease (e.g. Square
  // bisector's "2 segments or 3 points"), or variable-length / text ops, is
  // excluded until it gets dedicated handling.
  const webglActiveTool = useMemo<{
    mode:
      | 'drag-line'
      | 'drag-box'
      | 'drag-path'
      | 'sequence'
      | 'line-entity'
      | 'lengthen'
      | 'angle-drag'
      | 'text'
      | null;
    stepKinds: ('point' | 'crease' | 'candidate')[];
    lineCount: number;
    dualMirror: boolean;
    converging: boolean;
    squareBisector: boolean;
    voronoi: boolean;
  }>(() => {
    const idle = {
      mode: null,
      stepKinds: [] as ('point' | 'crease' | 'candidate')[],
      lineCount: 0,
      dualMirror: false,
      converging: false,
      squareBisector: false,
      voronoi: false,
    };
    if (!activeCpCommand || activeCpCommand.uiStatus !== 'ready' || cpToolState.phase !== 'active') {
      return idle;
    }
    const im = activeCpCommand.inputMode;
    if (im === 'drag-line' || im === 'drag-box' || im === 'drag-path') {
      return { ...idle, mode: im };
    }
    // Mirror Line branches per first pick between a 3-point sequence and a 2-line
    // sequence, so its step kinds are decided on the canvas at press time — not
    // statically from the registry. Flag it and leave stepKinds empty.
    if (activeCpCommand.operationId === 'SymmetricDraw') {
      return { ...idle, mode: 'sequence', dualMirror: true };
    }
    // Converging Lines (angle-restricted): first pick is a crease OR two points →
    // its two endpoints are the base; then pick one of the ray *intersections* those
    // endpoints generate. A bespoke canvas handler drives it (dual first click +
    // candidate-point converge), so leave stepKinds empty and flag it.
    if (activeCpCommand.operationId === 'DrawCreaseAngleRestricted') {
      return { ...idle, mode: 'sequence', converging: true };
    }
    // Angle Restricted Line: a press-drag-release draw (like the Line tool) whose
    // endpoint is angle-system-snapped. A bespoke canvas handler anchors on press,
    // kernel-previews the snapped segment during the drag, and commits on release —
    // so it is neither the generic drag-line nor a two-click point sequence.
    if (activeCpCommand.operationId === 'DrawCreaseAngleRestricted5') {
      return { ...idle, mode: 'angle-drag' };
    }
    // Square Bisector: dual first pick — a point starts 3-point mode (3 points + a
    // destination crease), a crease starts 2-line mode (2 source creases + a
    // destination crease). A bespoke canvas handler drives both (modes A + B).
    if (activeCpCommand.operationId === 'SquareBisector') {
      return { ...idle, mode: 'sequence', squareBisector: true };
    }
    // Voronoi: click to add/toggle seed points (kernel snaps + toggles + rebuilds the
    // whole diagram from the accumulated click list); the diagram + seeds render as a
    // live preview, then the contextual Apply button commits. A bespoke canvas handler
    // just accumulates clicks into `cpToolPoints`.
    if (activeCpCommand.operationId === 'VoronoiCreate') {
      return { ...idle, mode: 'sequence', voronoi: true };
    }
    // Text: existing texts are selected/dragged via the DOM overlay; the canvas only
    // reports an empty-space click so the panel can start an inline-edit draft there.
    if (activeCpCommand.operationId === 'Text') {
      return { ...idle, mode: 'text' };
    }
    // Everything below is driven by the explicit per-operation registry — never
    // by the step-prompt text. Line-entity (Lengthen) picks crease ids; point-
    // sequence and axis-from-line (Reflect) collect points with the registry's
    // per-step snap; other models (circle-apply, line-click-mutate, bespoke,
    // select-apply) have no dedicated engine yet.
    // CircleDrawTangentLine with exactly one circle selected: click a point to draw
    // the tangent from that circle through it (a synthetic 1-point sequence). With
    // 2+ circles it is an Apply-button op instead, handled off-canvas.
    if (
      activeCpCommand.operationId === 'CircleDrawTangentLine' &&
      oristudioCpSelection.circles.length === 1
    ) {
      return { ...idle, mode: 'sequence', stepKinds: ['point'] };
    }
    const inputModel = cpInputModel(activeCpCommand.operationId);
    if (inputModel?.model === 'line-entity') {
      return { ...idle, mode: 'line-entity', lineCount: inputModel.lineCount ?? 2 };
    }
    // Lengthen: drag the selection line, then click the target line. A bespoke drag
    // handler on the canvas drives both gestures and commits 3 points.
    if (inputModel?.model === 'lengthen') {
      return { ...idle, mode: 'lengthen' };
    }
    if (
      (inputModel?.model === 'point-sequence' || inputModel?.model === 'axis-from-line') &&
      inputModel.snapPerStep
    ) {
      return { ...idle, mode: 'sequence', stepKinds: [...inputModel.snapPerStep] };
    }
    return idle;
  }, [activeCpCommand, cpToolState.phase, oristudioCpSelection.circles.length]);

  // Sequence-tool live preview for the WebGL surface: kernel-computed candidate
  // segments from the live points + picked/hovered creases, plus a highlight of
  // those creases. Picked creases show immediately; the kernel result merges in.
  const [webglToolPreviewSegments, setWebglToolPreviewSegments] = useState<
    readonly { a: Point; b: Point }[]
  >([]);
  // Kernel-computed candidate *points* (e.g. Converging Lines ray intersections)
  // rendered as pickable dots on the canvas, separate from candidate segments.
  const [webglToolPreviewPoints, setWebglToolPreviewPoints] = useState<readonly Point[]>([]);
  const webglPreviewRequestRef = useRef(0);
  const handleWebglToolPreviewInput = useCallback(
    (points: readonly Point[], highlightLineIds: readonly number[]) => {
      const command = activeCpCommand;
      // The passed ids are the hovered crease(s) — highlight only. The kernel
      // resolves creases from the points, so its payload carries the selection.
      const highlight = highlightLineIds
        .map((id) => editableCp?.crease_pattern.line_segments[id - 1])
        .filter((s): s is OristudioCpLineSegment => Boolean(s))
        .map((s) => ({ a: s.a, b: s.b }));
      if (!command || points.length === 0) {
        webglPreviewRequestRef.current += 1;
        setWebglToolPreviewSegments(highlight);
        setWebglToolPreviewPoints([]);
        return;
      }
      setWebglToolPreviewSegments(highlight);
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
        const kernel = (preview?.segments ?? []).map((s) => ({ a: s.a, b: s.b }));
        const rings = (preview?.circles ?? []).flatMap((c) => cpCircleRingSegments(c.x, c.y, c.r));
        // Also highlight any existing crease the previewed line actually lands on
        // (its kernel-computed endpoints), so an angle-constrained draw that snaps
        // to an intersection lights up that crease even though the cursor point is
        // off it. `highlight` already covers tools whose point snaps onto the line.
        const onCreaseEps = editableCpBounds.spanX * 1e-3;
        // Exclude the already-placed points (all but the live cursor) so only the
        // crease the *active* endpoint snaps to lights up — a crease under a fixed
        // anchor must not stay pinned.
        const anchors = points.slice(0, -1);
        const snapped = editableCp
          ? cpCreasesUnderPreviewEndpoints(
              kernel,
              anchors,
              editableCp.crease_pattern.line_segments,
              onCreaseEps
            )
          : [];
        setWebglToolPreviewSegments([...kernel, ...rings, ...highlight, ...snapped]);
        setWebglToolPreviewPoints(preview?.points ?? []);
        // Measure tools: surface the kernel-computed length/angle into its panel slot
        // live as points are placed (the value is Oriedita-parity math, not recomputed
        // in JS). Only update once the kernel actually returns a value.
        const measurementSlot = cpMeasurementSlotForOperation(command.operationId);
        const measurement = preview?.measurement;
        if (measurementSlot && measurement != null) {
          setCpMeasurementSlots((current) => ({ ...current, [measurementSlot]: measurement }));
        }
      });
    },
    [
      activeCpCommand,
      buildCpCommandPayload,
      editableCp,
      editableCpBounds,
      oristudioCpSelection.circles,
      oristudioCpSelection.lines,
      previewOristudioCpCommand,
    ]
  );

  // WebGL Voronoi seed clicks: mirror them into `cpToolPoints` (the source the
  // contextual Apply button commits) and drive the live diagram preview. The kernel
  // snaps/toggles/rebuilds from the accumulated click list, so we just pass it along.
  const handleWebglVoronoiSeeds = useCallback(
    (seeds: readonly Point[]) => {
      setCpToolPoints([...seeds]);
      handleWebglToolPreviewInput(seeds, []);
    },
    [handleWebglToolPreviewInput]
  );

  // Clear the WebGL point-sequence preview when that mode is no longer active.
  useEffect(() => {
    if (webglActiveTool.mode !== 'sequence') {
      webglPreviewRequestRef.current += 1;
      setWebglToolPreviewSegments([]);
      setWebglToolPreviewPoints([]);
    }
  }, [webglActiveTool.mode]);

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
                          useWorkspaceStore.getState().oristudioCpError ?? t('panels:creasePattern.commandFailed', 'Command failed'),
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
                        message: useWorkspaceStore.getState().oristudioCpError ?? t('panels:creasePattern.commandFailed', 'Command failed'),
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
                        message: useWorkspaceStore.getState().oristudioCpError ?? t('panels:creasePattern.commandFailed', 'Command failed'),
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
                        message: useWorkspaceStore.getState().oristudioCpError ?? t('panels:creasePattern.commandFailed', 'Command failed'),
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
                        message: useWorkspaceStore.getState().oristudioCpError ?? t('panels:creasePattern.commandFailed', 'Command failed'),
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
                        message: useWorkspaceStore.getState().oristudioCpError ?? t('panels:creasePattern.commandFailed', 'Command failed'),
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
      t,
    ]
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
        !allowsDirectEntitySelection(activeCpCommand?.operationId) &&
        !isTextAnnotationOperation(activeCpCommand?.operationId)
      ) {
        return;
      }
      toggleOristudioCpTextSelection(id, additive);
    },
    [activeCpCommand?.operationId, cpToolState.phase, toggleOristudioCpTextSelection]
  );

  // Text tool: a click on empty canvas opens an inline-edit draft at that model
  // point (the overlay owns the editor). Nothing is created until the draft is
  // committed non-blank — see handleTextCommitCreate.
  const handleTextCreate = useCallback(
    (modelPoint: Point) => {
      if (!editableCp || activeCpCommand?.operationId !== 'Text') return;
      setTextCreateDraftAt({ x: modelPoint.x, y: modelPoint.y });
    },
    [activeCpCommand?.operationId, editableCp]
  );

  // Commit a new text from the inline editor. Uses CreateAt (not Create) so the
  // engine never second-guesses the click with its FontMetrics-less bounds — the
  // frontend is the sole authority on "empty space".
  const handleTextCommitCreate = useCallback(
    (anchor: Point, content: string) => {
      if (!editableCp) return;
      const newTextId = editableCp.crease_pattern.texts.length + 1;
      void (async () => {
        const succeeded = await executeOristudioCpCommand('Text', {
          line_ids: [],
          text_action: 'CreateAt',
          points: [anchor],
          text_content: content,
        });
        if (succeeded) {
          setOristudioCpSelection({ ...emptyOristudioCpSelection(), texts: [newTextId] });
        }
      })();
    },
    [editableCp, executeOristudioCpCommand, setOristudioCpSelection]
  );

  const handleTextSetContent = useCallback(
    (id: number, content: string) => {
      void executeOristudioCpCommand('Text', {
        line_ids: [],
        text_action: 'SetContent',
        text_ids: [id],
        text_content: content,
      });
    },
    [executeOristudioCpCommand]
  );

  // An existing text edited down to blank is deleted (parity with Oriedita's
  // blank-text GC on commit).
  const handleTextDeleteById = useCallback(
    (id: number) => {
      void (async () => {
        const succeeded = await executeOristudioCpCommand('Text', {
          line_ids: [],
          text_action: 'DeleteSelected',
          text_ids: [id],
        });
        if (succeeded) setOristudioCpSelection(emptyOristudioCpSelection());
      })();
    },
    [executeOristudioCpCommand, setOristudioCpSelection]
  );

  const handleSelectSingleText = useCallback(
    (id: number) => {
      setOristudioCpSelection({ ...emptyOristudioCpSelection(), texts: [id] });
    },
    [setOristudioCpSelection]
  );

  const handleTextDraftConsumed = useCallback(() => {
    setTextCreateDraftAt(null);
  }, []);

  // Commit a text drag. The engine's Move applies (points[1] - points[0]) as the
  // delta, so a zero origin + the model delta moves the text by exactly that much.
  // Returns the command promise so the overlay can hold its optimistic offset until
  // the document update lands (no snap-back flicker).
  const handleTextMove = useCallback(
    (id: number, delta: Point) => {
      if (delta.x === 0 && delta.y === 0) return Promise.resolve();
      return executeOristudioCpCommand('Text', {
        line_ids: [],
        text_action: 'Move',
        text_ids: [id],
        points: [
          { x: 0, y: 0 },
          { x: delta.x, y: delta.y },
        ],
      });
    },
    [executeOristudioCpCommand]
  );

  const emptyStatusLabel =
    status === 'building_crease_pattern'
      ? t('panels:creasePattern.buildingCreasePattern', 'Building crease pattern')
      : status === 'optimizing'
        ? t('panels:creasePattern.optimizingScale', 'Optimizing scale')
        : status === 'error' && error
          ? shortStatus(error.message)
          : activeEditingContext === 'crease-pattern'
            ? t('panels:creasePattern.noImportedCreasePattern', 'No imported crease pattern')
            : t('panels:creasePattern.noCreasePattern', 'No crease pattern');
  // The zoom-preset dropdown passes a scale (preset/100); the owned camera takes a percent.
  const setZoomLevel = useCallback(
    (scale: number) => sendWebglCameraCommand('set-percent', scale * 100),
    [sendWebglCameraCommand]
  );

  const handleViewportShortcut = useCallback(
    (id: ViewportShortcutId) => {
      switch (id) {
        case 'viewport.zoomIn':
          sendWebglCameraCommand('zoom-in');
          break;
        case 'viewport.zoomOut':
          sendWebglCameraCommand('zoom-out');
          break;
        case 'viewport.fit':
          sendWebglCameraCommand('fit');
          break;
        case 'viewport.actualSize':
          sendWebglCameraCommand('set-percent', 100);
          break;
      }
    },
    [sendWebglCameraCommand]
  );

  useEffect(
    () => registerViewportShortcutExecutor('crease-pattern', handleViewportShortcut),
    [handleViewportShortcut]
  );

  useEffect(() => {
    if (!diagnosticStatus) setDiagnosticHudExpanded(false);
  }, [diagnosticStatus]);


  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasCreasePattern) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      const interactive = isViewportInteractiveTarget(event.target);
      // While typing in the inline text editor, let it own ESC (commit + deselect);
      // don't also run the panel's ESC (which would clear selection / cancel the tool).
      if (event.key === 'Escape' && editableCp && !interactive) {
        // A selection takes priority: Escape deselects for *any* resting tool (not
        // just CreaseSelect) as long as no gesture is in progress — a second Escape
        // then cancels/deactivates the tool. Matches Oriedita, and fixes "select-all,
        // Escape, select-one ⇒ everything selected again" for Polygon/Lasso/etc.
        const gestureInProgress =
          cpToolPoints.length > 0 ||
          cpToolPath.length > 0 ||
          pendingLengthenLineId !== null ||
          pendingSquareBisectorLineIds.length > 0 ||
          cpToolDragRef.current !== null;
        if (editableSelectionSize > 0 && !gestureInProgress) {
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

      // Delete/Backspace removes the selected text annotation(s) under the Text tool
      // (a web convention Oriedita lacks). Guarded by `!interactive` so it never
      // fires while typing in the inline editor. handleDeleteSelectedText itself
      // checks the Text tool + a non-empty text selection.
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !interactive &&
        editableCp &&
        isTextAnnotationOperation(activeCpCommand?.operationId) &&
        oristudioCpSelection.texts.length > 0
      ) {
        event.preventDefault();
        handleDeleteSelectedText();
        return;
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
    activeCpCommand?.operationId,
    clearOristudioCpSelection,
    cpToolPath.length,
    cpToolPoints.length,
    cpToolState,
    editableCp,
    editableSelectionSize,
    handleDeleteSelectedText,
    hasCreasePattern,
    oristudioCpSelection.texts.length,
    pendingLengthenLineId,
    pendingSquareBisectorLineIds.length,
  ]);

  useEffect(() => {
    if (!editableCp) {
      setCpToolPoints([]);
      setCpToolPath([]);
      setPendingLengthenLineId(null);
      setPendingSquareBisectorLineIds([]);
      cpToolDragRef.current = null;
      setCpToolState(IDLE_ORISTUDIO_CP_TOOL_STATE);
    }
  }, [editableCp]);

  useEffect(() => {
    setCpMeasurementSlots(createEmptyCpMeasurementSlots());
  }, [editableCpHandle]);

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
            <div
              className="cp-panel__viewport"
              ref={cpViewportRef}
              onDragOver={handleViewportDragOver}
              onDrop={handleViewportDrop}
            >
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
                    <div className="cp-diagnostic-hud__list" aria-label={t('panels:creasePattern.canvasDiagnostics', 'Canvas diagnostics')}>
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
              {editableCp ? (
                <>
                <CreasePatternWebglCanvas
                  className="cp-webgl-layer"
                  lineSegments={editableCp.crease_pattern.line_segments}
                  geometry={oristudioCpDocument?.geometry ?? null}
                  images={oristudioCpImages}
                  modelToSvg={editableModelToSvg}
                  svgToModel={editableSvgToModel}
                  selectedLineIds={oristudioCpSelection.lines}
                  selectedPointIds={oristudioCpSelection.points}
                  selectedCircleIds={oristudioCpSelection.circles}
                  onSelect={(hit, additive) => {
                    if (!hit) {
                      if (!additive) clearOristudioCpSelection();
                      // A click on empty canvas also deselects the active image
                      // (mirrors how creases clear on a background click). An image
                      // click is captured by its overlay and never reaches here.
                      if (imageEditMode) setSelectedCpImage(null);
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
                  activeToolStepKinds={webglActiveTool.stepKinds}
                  activeToolLineCount={webglActiveTool.lineCount}
                  activeToolDualMirror={webglActiveTool.dualMirror}
                  activeToolConverging={webglActiveTool.converging}
                  activeToolSquareBisector={webglActiveTool.squareBisector}
                  activeToolVoronoi={webglActiveTool.voronoi}
                  activeToolDashedPreview={isCpMeasurementOperation(activeCpCommand?.operationId)}
                  onTextCreate={handleTextCreate}
                  voronoiSeeds={cpToolPoints}
                  onVoronoiSeedsChange={handleWebglVoronoiSeeds}
                  activeToolRequireSnap={isRestrictedDrawOperation(activeCpCommand?.operationId)}
                  activeToolClickSelects={isLineClickSelectionOperation(activeCpCommand?.operationId)}
                  activeToolClickErases={isLineEraseClickTool(activeCpCommand?.operationId)}
                  resolveDrawPoint={resolveEditableDrawModelPoint}
                  resolveDrawPointOnCrease={resolveEditableDrawPointOnCrease}
                  resolveFirstPickKind={resolveEditableFirstPickKind}
                  onToolCommit={handleWebglToolCommit}
                  onToolPreviewInput={handleWebglToolPreviewInput}
                  onToolPickProgress={handleWebglToolPickProgress}
                  toolCommandPreviewSegments={webglToolPreviewSegments}
                  toolCommandPreviewPoints={webglToolPreviewPoints}
                  toolPreviewColor={toolPreviewColor}
                  diagnosticMarkers={cpDiagnosticGeometry.markers}
                  diagnosticStrokes={cpDiagnosticGeometry.strokes}
                  diagnosticWedges={cpDiagnosticGeometry.wedges}
                  diagnosticHits={cpDiagnosticGeometry.hits}
                  onSelectDiagnostic={handleSelectCpDiagnostic}
                  operationFrame={cpOperationFrameStrokes}
                  focusModelBounds={cpDiagnosticFocusBounds}
                  cameraCommand={webglCameraCommand}
                  onZoomPercentChange={handleWebglZoomPercent}
                  onViewChange={handleWebglViewChange}
                  onEraseBox={(points) => {
                    void executeOristudioCpCommand('LineSegmentDelete', {
                      line_ids: [],
                      points: [...points],
                    });
                  }}
                  onEraseLine={(id) => {
                    void executeOristudioCpCommand('LineSegmentDelete', { line_ids: [id] });
                  }}
                  onRequestContextMenu={handleRequestContextMenu}
                  mode={mode}
                  lineWidth={oristudioCpViewport.lineWidth ?? 1}
                  points={editableCp.crease_pattern.points}
                  vertices={editableCpVertexPoints}
                  pointSize={oristudioCpViewport.pointSize ?? 1}
                  circles={editableCp.crease_pattern.circles}
                  circleRadiusToSvg={editableCircleRadiusToSvg}
                  foldedFigures={generatedFoldedFigures}
                  scaleFoldedFigureId={pendingScaleFigureId}
                  onScaleFoldedFigure={(figureId, scale) => {
                    void updateOristudioCpFoldedFigureModel(figureId, { scale });
                  }}
                  onScaleFoldedFigureEnd={() => setPendingScaleFigureId(null)}
                  importedForms={cpImportedFoldedFormsGeometry}
                  grid={editableCpVisibleGrid}
                  gridVisible={oristudioCpViewport.gridVisible}
                />
                <ContextMenu
                  open={foldedContextMenu !== null}
                  x={foldedContextMenu?.x ?? 0}
                  y={foldedContextMenu?.y ?? 0}
                  items={foldedContextMenu?.items ?? []}
                  onOpenChange={(open) => {
                    if (!open) setFoldedContextMenu(null);
                  }}
                />
                {webglOverlayView &&
                  (editableCp.crease_pattern.texts.length > 0 ||
                    isTextAnnotationOperation(activeCpCommand?.operationId)) && (
                    <CpTextOverlay
                      texts={editableCp.crease_pattern.texts}
                      selectedTextIds={oristudioCpSelection.texts}
                      view={webglOverlayView}
                      zoomPercent={zoomPercent}
                      selectable={
                        cpToolState.phase !== 'active' ||
                        allowsDirectEntitySelection(activeCpCommand?.operationId) ||
                        isTextAnnotationOperation(activeCpCommand?.operationId)
                      }
                      textToolActive={isTextAnnotationOperation(activeCpCommand?.operationId)}
                      createDraftAt={textCreateDraftAt}
                      onCreateDraftConsumed={handleTextDraftConsumed}
                      onToggleText={handleEditableTextClick}
                      onSelectText={handleSelectSingleText}
                      onCreateText={handleTextCommitCreate}
                      onSetTextContent={handleTextSetContent}
                      onDeleteText={handleTextDeleteById}
                      onMoveText={handleTextMove}
                      onDeselect={clearOristudioCpSelection}
                    />
                  )}
                {webglOverlayView && oristudioCpImages.length > 0 && (
                  <CpImageOverlay
                    images={oristudioCpImages}
                    selectedImageId={oristudioCpSelectedImageId}
                    view={webglOverlayView}
                    interactive={imageEditMode}
                    onSelectImage={setSelectedCpImage}
                    onUpdateImage={updateCpImage}
                    onGestureStart={beginImageGesture}
                    onGestureCommit={(_id, label) => commitImageGesture(label)}
                  />
                )}
                {imageEditMode && selectedCpImage && (
                  <CpImageInspector
                    image={selectedCpImage}
                    onUpdate={(patch) => updateCpImage(selectedCpImage.id, patch)}
                    onGestureStart={beginImageGesture}
                    onGestureCommit={commitImageGesture}
                    onBringToFront={bringSelectedImageToFront}
                    onSendToBack={sendSelectedImageToBack}
                    onDelete={deleteSelectedImage}
                  />
                )}
                </>
              ) : (
                <div className="cp-panel__unopened" role="status">
                  {t('panels:creasePattern.couldNotOpenForEditing', 'This crease pattern could not be opened for editing.')}
                </div>
              )}
              <ViewportToolbar
                ariaLabel={t('panels:creasePattern.viewportControls', 'Crease pattern viewport controls')}
                zoomPercent={zoomPercent}
                zoomIn={() => sendWebglCameraCommand('zoom-in')}
                zoomOut={() => sendWebglCameraCommand('zoom-out')}
                fitToView={() => sendWebglCameraCommand('fit')}
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
                    <IconButton
                      size="sm"
                      variant="toolbar"
                      title={imageEditMode ? t('panels:creasePattern.editingImagesClickToExit', 'Editing images (click to exit)') : t('panels:creasePattern.editImages', 'Edit images')}
                      aria-pressed={imageEditMode}
                      data-active={imageEditMode || undefined}
                      onClick={() => setImageEditMode(!imageEditMode)}
                    >
                      <ImageIcon size={14} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      variant="toolbar"
                      title={t('panels:creasePattern.insertImage', 'Insert image...')}
                      onClick={() => imageFileInputRef.current?.click()}
                    >
                      <ImagePlus size={14} />
                    </IconButton>
                    <input
                      ref={imageFileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) void addImageFromFile(file, null);
                      }}
                    />
                    <ViewportToolbarSeparator />
                    <div className="cp-folded-figure-actions">
                      <IconButton
                        size="sm"
                        variant="toolbar"
                        title={t('panels:creasePattern.fold', 'Fold')}
                        disabled={!canFoldSelectedModel}
                        onClick={handleFoldModel}
                      >
                        <GitBranch size={14} />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="toolbar"
                        title={t('panels:creasePattern.anotherSolution', 'Another solution')}
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
                  />,
                  toolOptionsPortalTarget
                )}
              <div className="viewport-status-readout">
                <span>{formatZoom(zoomPercent / 100)}</span>
                {editableCp && <span>{activeCpToolPrompt}</span>}
                {editableCp && <span>{cpLineTypeStatusLabel(activeCpLineColor, t)}</span>}
                {editableCp && editableCpSummary && (
                  <span>{t('panels:creasePattern.linesCount', '{{count}} lines', { count: editableCpSummary.line_segments })}</span>
                )}
                {editableCp && editableSelectionSize > 0 && (
                  <span>{t('panels:creasePattern.selectedCount', '{{count}} selected', { count: editableSelectionSize })}</span>
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


function isRenderableGeneratedFoldedFigure(figure: OristudioCpFoldedFigureEntry): boolean {
  return Boolean(figure.renderSnapshot?.primitives.length || figure.snapshot?.wireframe);
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

const IMPORTED_FOLDED_FORM_VIEW = {
  x: CP_PAPER_RECT.x + 20,
  y: CP_PAPER_RECT.y + 20,
  width: 136,
  height: 136,
};

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

function shortStatus(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'Crease pattern unavailable';
  const sentence = trimmed.split(/[.;]\s+/u)[0] ?? trimmed;
  return sentence.length > 54 ? `${sentence.slice(0, 51)}...` : sentence;
}
