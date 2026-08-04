import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Copy,
  ImagePlus,
  ListChecks,
  Loader2,
  Origami,
  Trash2,
} from 'lucide-react';
import {
  registerCpActionShortcutExecutor,
  registerViewportShortcutExecutor,
  setActiveShortcutViewportSurface,
} from '../../keyboard/shortcutRuntime';
import {
  shortcutLabelForAction,
  type ViewportShortcutId,
} from '../../keyboard/shortcuts';
import type {
  OristudioCpCommandPayload,
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
import { CpDiagnosticHud } from '../../cp-workspace/diagnostics/CpDiagnosticHud';
import {
  DEFAULT_ORISTUDIO_CP_ACTION_ID,
  cpActionByOperation,
  cpActionById,
  cpActionByUpstreamMouseMode,
  type OristudioCpActionDefinition,
  type OristudioCpActionId,
  type OristudioCpCommandActionDefinition,
} from '../../lib/oristudioCpActions';
import {
  cpCommandByOperation,
  cpCommandUsesActiveLineColor,
  type OristudioCpCommandDefinition,
} from '../../lib/oristudioCpCommands';
import { forcedAssignmentNotice } from '../../cp-workspace/tools/toolUnavailable';
import { toolPreviewSegments } from '../../cp-workspace/tools/toolPreviewSegments';
import { usePersistedCpToolOptions } from '../../cp-workspace/tools/usePersistedCpToolOptions';
import type { ToolPreviewSegment } from '../../cp-workspace/tools/types';
import {
  cancelOristudioCpToolState,
  IDLE_ORISTUDIO_CP_TOOL_STATE,
  transitionOristudioCpToolState,
} from '../../lib/oristudioCpToolState';
import {
  cpToolSettingGroupsForCommand,
  evaluateOrieditaRatioExpression,
  type OristudioCpToolOptions,
} from '../../lib/oristudioCpToolSettings';
import {
  activeLineColorFromOrieditaMetadata,
  activeMouseModeFromOrieditaMetadata,
  canvasToolOptionsFromOrieditaMetadata,
} from '../../lib/orieditaNativeMetadata';
import {
  CP_PAPER_RECT,
  cpModelToSvg,
  cpSelectionSize,
  cpSvgToModel,
  DEFAULT_ORISTUDIO_CP_FOLD_ANGLE_DISPLAY,
  DEFAULT_ORISTUDIO_CP_LINE_STYLE,
  emptyOristudioCpSelection,
  getCpVertexPoints,
  getOrieditaGridBasis,
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
import type { CpOverlayView, StepKind } from '../../cp-workspace/CreasePatternWebglCanvas';
import { cpCamera } from '../../cp-workspace/renderer/cpCameraRegistry';
import type { CpContextMenuRequest } from '../../cp-workspace/contextMenuTarget';
import {
} from '../../cp-workspace/folded/foldedFigureActions';
// Registers `__foldedStaleDebug()` in dev builds; no-op in production.
import '../../cp-workspace/folded/foldedFigureStalenessDebug';
// Registers `__inlineSimStaleDebug()` in dev builds; no-op in production.
import '../../cp-workspace/inlineSimulation/inlineSimulationStalenessDebug';
import { foldedFigureCurrentCase } from '../../cp-workspace/folded/foldedFigureState';
import { hexToRgbColor, rgbColorToHex } from '../../lib/rgbColor';
import { ContextMenu } from '../ui/ContextMenu';
import type { ContextMenuRequest } from '../ui/contextMenuTypes';
import { vertexPointsFromTransport } from '../../engine/oristudioCpGeometry';
import { foldedGeometryFromShapes } from '../../cp-workspace/adapters/cpFoldedToScene';
import { CanvasObjectOverlay } from '../../cp-workspace/CanvasObjectOverlay';
import type { CanvasObjectBoxUpdate } from '../../cp-workspace/CanvasObjectOverlay';
import { CpTextAnnotationLayer } from '../../cp-workspace/CpTextAnnotationLayer';
import { CpMeasureLayer } from '../../cp-workspace/CpMeasureLayer';
import { CpFoldAngleLayer } from '../../cp-workspace/foldAngle/CpFoldAngleLayer';
import { CpImageInspector } from '../../cp-workspace/CpImageInspector';
import { CpSelectionToolbar } from '../../cp-workspace/CpSelectionToolbar';
import { CpFoldedFigureToolbar } from '../../cp-workspace/folded/CpFoldedFigureToolbar';
import { useFoldedFigures } from '../../cp-workspace/folded/useFoldedFigures';
import { foldedFigureMenuItemsWith } from '../../cp-workspace/folded/foldedFigureMenuItems';
import { selectedCanvasObjectId as selectedCanvasObjectIdOf } from '../../cp-workspace/canvasObjects/transformableObject';
import { InlineSimulationLayer } from '../../cp-workspace/InlineSimulationLayer';
import { InlineSimulationInspector } from '../../cp-workspace/InlineSimulationInspector';
import { useInlineSimulations } from '../../cp-workspace/inlineSimulation/useInlineSimulations';
import { useSimulateSelection } from '../../cp-workspace/inlineSimulation/useSimulateSelection';
import { useBlurOnPressOutside } from '../../cp-workspace/inlineSimulation/useBlurOnPressOutside';
import { cpOverlayViewStore } from '../../cp-workspace/cpOverlayViewStore';
import type { CpOverlayViews } from '../../cp-workspace/cpOverlayViewStore';
import { useCpDocumentCamera } from '../../cp-workspace/camera/useCpDocumentCamera';
import { isTextAnnotation } from '../../cp-workspace/annotations/annotation';
import { useCpAnnotations } from '../../cp-workspace/annotations/useCpAnnotations';
import { CpContextToolPanel, cpLineTypeStatusLabel } from './CpContextToolPanel';
import {
  buildCpDiagnosticMarkers,
  buildCpDiagnosticStrokes,
  buildCpDiagnosticWedges,
  resolveCpDiagnosticToneColors,
} from '../../cp-workspace/diagnostics/geometry';
import { visibleCpDiagnosticEntries } from '../../cp-workspace/diagnostics/visibleEntries';
import { cpInputModel } from '../../cp-workspace/tools/inputModelRegistry';
import { distanceToSegment } from '../../cp-workspace/picking/lineHitIndex';
import { resolveCpLineColor } from '../../cp-workspace/adapters/cpLineColor';
import { useCpLineColorInversion } from '../../cp-workspace/lineColor/useCpLineColorInversion';
import { readCssVarColor } from '../../cp-workspace/renderer/cssColor';
import { useThemeStore } from '../../store/themeStore';
import {
  OVERLAY_DASH_PATTERN,
  type FoldedGeometry,
  type Rgba,
  type StrokeGeometry,
} from '../../cp-workspace/renderer/types';
import {
  allowsDirectEntitySelection,
  cpCommandRequiresContextApply,
  creaseTransformTool,
  isCreaseToggleMvClickTool,
  isDefaultSelectionMode,
  isLengthenCreaseOperation,
  isLineClickSelectionOperation,
  isLineEraseClickTool,
  isModelAlignedBoxOperation,
  isReflectSelectionOperation,
  isRestrictedDrawOperation,
  isSelectionCircleApplyOperation,
  isSquareBisectorOperation,
  isVariablePointSequenceOperation,
  isWholeDocumentCpCommand,
  toolClickAction,
} from '../../cp-workspace/tools/predicates';
import {
  cpMeasureKindForOperation,
  cpMeasurePointCount,
  isCpMeasurementOperation,
  type CpAngleUnit,
  type CpMeasureKind,
  type CpMeasureScale,
  type CpMeasureUnit,
  type CpMeasurement,
} from '../../cp-workspace/measure';
import {
  readCpMeasurePreferences,
  writeCpMeasurePreferences,
} from '../../cp-workspace/measurePreferences';
import { ColorField } from '../ui/ColorField';
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
import type { FoldDocument } from '../../engine/types';

function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/**
 * View-rotation step per button press or key: 11.25 degrees, matching
 * Oriedita's default angle-system divider (180/16). Sixteen presses make a
 * half turn, and the sequence passes through 22.5 and 45 — the angles
 * origami work is laid out along.
 */
const VIEW_ROTATION_STEP_RADIANS = Math.PI / 16;

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

/**
 * The measure tool's per-step prompt. Literal `t()` keys so the i18n extractor
 * sees every prompt; the step list follows the kind (2 points / 3 with a vertex).
 */
function measureStepPrompt(t: TFunction, kind: CpMeasureKind, picked: number): string {
  if (kind === 'angle') {
    if (picked <= 0) return t('panels:creasePattern.measurePickFirstPoint', 'Pick first point');
    if (picked === 1) return t('panels:creasePattern.measurePickVertexPoint', 'Pick vertex point');
    return t('panels:creasePattern.measurePickSecondPoint', 'Pick second point');
  }
  return picked <= 0
    ? t('panels:creasePattern.measurePickFirstPoint', 'Pick first point')
    : t('panels:creasePattern.measurePickSecondPoint', 'Pick second point');
}

/** Literal-key `t()` calls so the extractor sees every snap name. */
function measureSnapLabel(t: TFunction, kind: CpSnapTarget['kind'] | null): string {
  switch (kind) {
    case 'vertex':
      return t('panels:creasePattern.measureSnapVertex', 'vertex');
    case 'grid':
      return t('panels:creasePattern.measureSnapGrid', 'grid');
    case 'point':
      return t('panels:creasePattern.measureSnapPoint', 'point');
    case 'line':
      return t('panels:creasePattern.measureSnapCrease', 'crease');
    default:
      return t('panels:creasePattern.measureSnapFree', 'free');
  }
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

  if (cpCommandUsesActiveLineColor(operationId)) {
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

  // Where a completion candidate may stop. The ray extension happens in the
  // kernel, so the setting has to travel with the command.
  if (
    operationId === 'VertexMakeAngularlyFlatFoldable' ||
    operationId === 'FoldableLineDraw'
  ) {
    payload.stop_on_auxiliary = toolOptions.foldableLineStopsOnAux;
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

function FoldedFigureMenuButton({
  figures,
  activeFigure,
  startingFaceId,
  caseDraft,
  onStartingFaceIdChange,
  onCaseDraftChange,
  staleFigureIds,
  onSelectFigure,
  onDisplayStyle,
  onModelUpdate,
  onModelGestureEnd,
  onFoldToCase,
  onDuplicate,
  onDelete,
}: {
  figures: OristudioCpFoldedFigureEntry[];
  activeFigure: OristudioCpFoldedFigureEntry | null;
  startingFaceId: number;
  caseDraft: string;
  /**
   * Figures whose source creases have changed since they were folded. Derived
   * per document revision rather than stamped on the entry — see
   * `lib/foldedFigureStaleness.ts`.
   */
  staleFigureIds: ReadonlySet<string>;
  onStartingFaceIdChange: (startingFaceId: number) => void;
  onCaseDraftChange: (draft: string) => void;
  onSelectFigure: (id: string) => void;
  onDisplayStyle: (displayStyle: OristudioCpFoldedFigureDisplayStyle) => void;
  /**
   * Apply a model change. `scope` groups the stream of changes a single drag
   * emits (colour picker, alpha slider) into one undo entry; omit it for
   * discrete controls, which record immediately.
   */
  onModelUpdate: (update: Partial<OristudioCpFoldedFigureModel>, scope?: string) => void;
  /** End a scoped run of {@link onModelUpdate} changes and record one entry. */
  onModelGestureEnd: (scope: string, label: string) => void;
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
  const currentCase = Math.max(foldedFigureCurrentCase(activeFigure), 1);
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
                  <small data-stale={staleFigureIds.has(figure.id) || undefined}>
                    {staleFigureIds.has(figure.id)
                      ? t('panels:creasePattern.stale', 'Stale')
                      : figure.status === 'ready'
                        ? t('panels:creasePattern.case', 'Case {{count}}', {
                            count: foldedFigureCurrentCase(figure),
                          })
                        : figure.status}
                  </small>
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
              <ColorField
                key={field.key}
                label={foldedColorLabel(t, field.key)}
                value={rgbColorToHex(model?.[field.key] ?? field.fallback)}
                disabled={!activeReady}
                onChange={(value) =>
                  onModelUpdate({ [field.key]: hexToRgbColor(value) }, `color:${field.key}`)
                }
                onCommit={() =>
                  onModelGestureEnd(
                    `color:${field.key}`,
                    t('panels:creasePattern.changeFoldedColor', 'Change folded model color')
                  )
                }
              />
            ))}
          </div>
          <label className="folded-figure-menu__field">
            <span>{t('panels:creasePattern.caseLabel', 'Case')}</span>
            {/* The field is the control: Enter or blur commits it. A separate
                "go" button alongside an input the user has already typed into
                is a second thing to find for no extra ability. */}
            <div className="folded-figure-menu__case">
              <input
                aria-label={t('panels:creasePattern.foldCase', 'Fold case')}
                type="number"
                min={1}
                step={1}
                value={caseDraft}
                disabled={!activeReady}
                onChange={(event) => onCaseDraftChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  if (canJumpCase) onFoldToCase();
                }}
                onBlur={() => {
                  if (canJumpCase) onFoldToCase();
                }}
              />
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
          {/* No Color alpha toggle: it only reaches the Transparent display
              style, and transparency is not a supported surface right now. The
              model keeps `transparency_color` so Oriedita files round-trip. */}
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
  const zoomPercentRef = useRef(100);
  const [zoomPercent, setZoomPercent] = useState(100);
  // Hand tool: a plain drag pans the canvas instead of running the active
  // tool. Accel-drag pan stays available whether or not this is on.
  const [panToolActive, setPanToolActive] = useState(false);
  // Mirrors the canvas camera's rotation so the toolbar can show the angle and
  // offer a reset; the camera itself remains the source of truth.
  const [viewRotation, setViewRotation] = useState(0);
  const handleWebglZoomPercent = useCallback((percent: number) => {
    zoomPercentRef.current = percent;
    setZoomPercent(percent);
  }, []);
  // The WebGL camera's affines. Every camera frame is published to the external
  // cpOverlayViewStore, which the overlay components subscribe to directly — so
  // pan/zoom re-renders only the small overlays (crisp, real font size) and never
  // the giant panel. `webglOverlayView` is a *debounced* copy of the model-space
  // affine, kept only for the toolbar anchors + on-demand handlers, which don't
  // need to track every frame and only ever place model-space content.
  const [webglOverlayView, setWebglOverlayView] = useState<CpOverlayView | null>(null);
  const overlaySettleTimerRef = useRef<number | undefined>(undefined);
  const viewSeededRef = useRef(false);
  const handleWebglViewChange = useCallback((views: CpOverlayViews) => {
    cpOverlayViewStore.set(views);
    if (!viewSeededRef.current) {
      // Seed the debounced copy on the first frame so toolbars/mounts don't wait
      // for the settle; afterwards it only updates on settle.
      viewSeededRef.current = true;
      setWebglOverlayView(views.model);
      return;
    }
    window.clearTimeout(overlaySettleTimerRef.current);
    overlaySettleTimerRef.current = window.setTimeout(() => setWebglOverlayView(views.model), 100);
  }, []);
  const [cpToolState, setCpToolState] = useState(IDLE_ORISTUDIO_CP_TOOL_STATE);
  const [activeCpLineColor, setActiveCpLineColor] = useState<OristudioCpLineColor>('Red1');
  // Most of these are per-use and start at their defaults every session. The few
  // that are working preferences — the angle system, Fix Inaccurate's tolerance —
  // are opted into persistence by name; see `lib/cpToolOptionPersistence.ts`.
  const [cpToolOptions, setCpToolOptions] = usePersistedCpToolOptions();
  // Arming a tool resolves its variant mode (`resolveCpVariantOperation`, via the
  // tool state), so tool selection needs to read the options — but neither the
  // document-restore effect nor the rail's select handler may re-run when an
  // unrelated option changes, so they read the latest through a ref.
  const cpToolOptionsRef = useRef(cpToolOptions);
  cpToolOptionsRef.current = cpToolOptions;
  const [cpToolPoints, setCpToolPoints] = useState<Point[]>([]);
  const [cpToolPath, setCpToolPath] = useState<Point[]>([]);
  const [pendingLengthenLineId, setPendingLengthenLineId] = useState<number | null>(null);
  const [pendingSquareBisectorLineIds, setPendingSquareBisectorLineIds] = useState<number[]>([]);
  // Readings taken in this measure session, oldest first, so several can be compared
  // side by side. They live for the tool session only — Escape (which deactivates the
  // tool) clears them; nothing is persisted.
  const [cpMeasurements, setCpMeasurements] = useState<readonly CpMeasurement[]>([]);
  const [cpHoveredMeasureIndex, setCpHoveredMeasureIndex] = useState<number | null>(null);
  // Points placed so far in the current measure pick, for the step prompt. A
  // sequence tool's points live on the canvas, so this mirrors its pick progress.
  const [cpMeasurePicked, setCpMeasurePicked] = useState(0);
  // The pick in progress — placed points plus the cursor — so the on-canvas figure
  // and its value track the mouse before anything is committed.
  const [cpMeasureLivePoints, setCpMeasureLivePoints] = useState<readonly Point[]>([]);
  const [cpMeasureLiveValue, setCpMeasureLiveValue] = useState<number | null>(null);
  // What the live point snapped onto, so a measurement never silently reads between
  // two points that only look like vertices.
  const [cpMeasureSnapKind, setCpMeasureSnapKind] = useState<CpSnapTarget['kind'] | null>(null);
  // Display units are a persisted user preference, not a document property: a
  // designer reads in the units they think in, whatever the file was authored in.
  const [cpMeasurePreferences, setCpMeasurePreferences] = useState(readCpMeasurePreferences);
  const setCpMeasureUnit = useCallback((unit: CpMeasureUnit) => {
    setCpMeasurePreferences((current) => {
      const next = { ...current, unit };
      writeCpMeasurePreferences(next);
      return next;
    });
  }, []);
  const setCpMeasureAngleUnit = useCallback((angleUnit: CpAngleUnit) => {
    setCpMeasurePreferences((current) => {
      const next = { ...current, angleUnit };
      writeCpMeasurePreferences(next);
      return next;
    });
  }, []);
  const setCpMeasurePaperEdgeMm = useCallback((paperEdgeMm: number) => {
    setCpMeasurePreferences((current) => {
      const next = { ...current, paperEdgeMm };
      writeCpMeasurePreferences(next);
      return next;
    });
  }, []);
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
  // with no crease pattern (fresh app, or after a design reset cleared it). Track
  // the in-flight provision so the empty canvas shows a loading state rather than
  // the "No crease pattern" affordance during that brief gap.
  const [cpProvisioning, setCpProvisioning] = useState(false);
  useEffect(() => {
    if (oristudioCpDocument) {
      setCpProvisioning(false);
      return;
    }
    let cancelled = false;
    setCpProvisioning(true);
    void ensureEditCreasePattern().finally(() => {
      if (!cancelled) setCpProvisioning(false);
    });
    return () => {
      cancelled = true;
    };
  }, [oristudioCpDocument, ensureEditCreasePattern]);
  const oristudioCpCamvResult = useWorkspaceStore((state) => state.oristudioCpCamvResult);
  const oristudioCpSelection = useWorkspaceStore((state) => state.oristudioCpSelection);
  // Reference images and text boxes: their transformable projection, the
  // gesture/undo protocol, image import and stacking, and the inline text-edit
  // lifecycle.
  const annotations = useCpAnnotations({
    overlayView: webglOverlayView,
    viewportRef: cpViewportRef,
  });
  const {
    editingTextId,
    selectedImage: selectedCpImage,
    imageAnnotations,
    setSelectedAnnotation,
    updateAnnotation,
    imageFileInputRef,
    addImageFromFile,
    deleteSelectedImage,
  } = annotations;
  const oristudioCpAnnotations = annotations.annotations;
  const oristudioCpSelectedAnnotationId = annotations.selectedAnnotationId;

  // Text boxes, passed to the canvas only so open + fit-to-view frame them too
  // (they render on the DOM layer, not in GL).
  const textAnnotations = useMemo(
    () => oristudioCpAnnotations.filter(isTextAnnotation),
    [oristudioCpAnnotations]
  );
  // Object toolbars anchor themselves against the *live* camera (see
  // useCanvasObjectAnchor); the panel only supplies the element they measure
  // from. Anchoring off the panel's debounced camera copy left them behind
  // during a zoom until the debounce fired.
  //
  // The viewport lives behind `hasCreasePattern`, so it isn't in the DOM when
  // the panel first mounts (the CP provisions asynchronously). A callback ref
  // captures it the moment it attaches — and re-captures on any remount — so
  // the toolbars can anchor as soon as the viewport exists. `cpViewportRef`
  // stays populated for imperative reads; `toolbarContainer` state drives the
  // re-render that hands the element to the toolbar consumers.
  const [toolbarContainer, setToolbarContainer] = useState<HTMLElement | null>(null);
  const attachViewport = useCallback((el: HTMLDivElement | null) => {
    cpViewportRef.current = el;
    setToolbarContainer(el);
  }, []);








  const oristudioCpActionRequest = useWorkspaceStore((state) => state.oristudioCpActionRequest);
  const oristudioCpFoldedFigures = useWorkspaceStore((state) => state.oristudioCpFoldedFigures);
  const oristudioCpActiveFoldedFigureId = useWorkspaceStore(
    (state) => state.oristudioCpActiveFoldedFigureId
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
  const setOristudioCpSelection = useWorkspaceStore((state) => state.setOristudioCpSelection);
  const clearOristudioCpActionRequest = useWorkspaceStore(
    (state) => state.clearOristudioCpActionRequest
  );
  const setOristudioCpActiveFoldedFigure = useWorkspaceStore(
    (state) => state.setOristudioCpActiveFoldedFigure
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
  // The fold chord lands on FoldingEstimate (Fold is the deduped duplicate);
  // `handleCpShortcutAction` routes both to the real fold path.
  const foldShortcutLabel = shortcutLabelForAction('cp.action.folding-estimate', shortcutOverrides);

  const editableCp = oristudioCpDocument?.document ?? null;
  const editableCpHandle = oristudioCpDocument?.handle ?? null;
  const editableCpSummary = oristudioCpDocument?.summary ?? null;
  // Why the editable kernel refused this file, recorded by `loadCreasePattern`.
  // Only meaningful in the read-only state below, where there is no document.
  const cpLoadError = useWorkspaceStore((state) => state.oristudioCpError);
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
  // The document's view: what to open at, and where a moved camera is recorded.
  const documentCamera = useCpDocumentCamera(editableCp?.metadata);
  // Upstream's `calculateLineColor()`: while the modifier is held the crease
  // colour reads inverted everywhere -- rail, preview, committed line -- while
  // `activeCpLineColor` keeps the colour the user actually chose. Every read
  // below goes through the effective colour; only the two writes (metadata
  // restore, rail click) touch the base.
  const { effectiveLineColor: effectiveCpLineColor } = useCpLineColorInversion(
    activeCpLineColor,
    activeEditingContext === 'crease-pattern'
  );
  const editableCpBounds = ORIEDITA_PAPER_BOUNDS;
  // `cpModelToSvg` / `cpSvgToModel`, not a document-derived affine: a file's
  // saved Oriedita camera is a view, and baking it in here gave the canvas two
  // disagreeing user spaces. See the note on `cpModelToSvg`.
  const editableModelToSvg = cpModelToSvg;
  const editableSvgToModel = cpSvgToModel;
  const editableCircleRadiusToSvg = useCallback(
    (radius: number) =>
      Math.max(
        1,
        (radius / Math.max(editableCpBounds.spanX, editableCpBounds.spanY)) *
          Math.min(CP_PAPER_RECT.width, CP_PAPER_RECT.height)
      ),
    [editableCpBounds]
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
    setCpToolOptions,
  ]);


  const selectedEditableFoldLineIds = useMemo(
    () => selectedFoldableCpLineIds(editableCp, oristudioCpSelection),
    [editableCp, oristudioCpSelection]
  );
  // Folded figures: derived state, the undo-gesture protocol, and the store-bound
  // verbs the toolbar and context menu both render from.
  const folded = useFoldedFigures({
    cpDocument: oristudioCpDocument,
    selectedFoldLineIds: selectedEditableFoldLineIds,
  });
  const {
    active: activeFoldedFigure,
    generated: generatedFoldedFigures,
    selected: selectedFoldedFigure,
    staleIds: staleFoldedFigureIds,
    actionDeps: foldedFigureActionDeps,
    canFoldSelectedModel,
    foldStartingFaceId,
    setFoldStartingFaceId,
    foldCaseDraft,
    setFoldCaseDraft,
  } = folded;

  // Inline simulation windows: the third canvas-object kind, and the only one
  // whose contents keep running after you place them.
  const inlineSimulations = useInlineSimulations({ cpDocument: oristudioCpDocument });
  const focusedInlineSimulation = inlineSimulations.selected;
  // Leaving the surface gives the window up, which also hands the `simulator`
  // shortcut scope back. Presses *on* the surface are the canvas's business.
  useBlurOnPressOutside({
    active: inlineSimulations.focusedId !== null,
    panelRef: containerRef,
    onBlur: inlineSimulations.blur,
  });
  /**
   * Everything placed on the canvas that the WebGL renderer does not draw
   * itself, for framing. Both kinds live on their own DOM layers, so without
   * this the camera cannot see them: fitting to view would frame the creases
   * alone and leave a simulation window off screen.
   */
  const overlayBoxes = useMemo(
    () => [
      ...textAnnotations,
      // Windows are never hidden — there is no affordance for it — but the
      // framing contract is "skip what is not drawn", so say so rather than
      // leaving the reader to infer it.
      ...inlineSimulations.simulations.map((simulation) => ({
        ...simulation.box,
        hidden: false,
      })),
    ],
    [textAnnotations, inlineSimulations.simulations]
  );
  // Shared with the selection toolbar, so the keyboard and the button cannot
  // disagree about what counts as a simulatable region.
  const simulateSelectionInline = useSimulateSelection();

  // One overlay for every canvas object, so chrome and hit-testing resolve in a
  // single pass and no two kinds can show handles at once.
  const canvasObjects = useMemo(
    () => [
      ...annotations.transformableObjects,
      ...folded.transformableObjects,
      ...inlineSimulations.transformableObjects,
    ],
    [
      annotations.transformableObjects,
      folded.transformableObjects,
      inlineSimulations.transformableObjects,
    ]
  );
  const isFoldedFigureId = useCallback(
    (id: string) => folded.transformableObjects.some((object) => object.id === id),
    [folded.transformableObjects]
  );
  // The canvas's single selection: whichever kind currently owns it. The store
  // keeps the ids mutually exclusive, so at most one is non-null.
  //
  // A window's focus *is* its selection — only one can be focused, and a focused
  // window is exactly the one whose handles should be live.
  const selectedCanvasObjectId = selectedCanvasObjectIdOf({
    annotationId: oristudioCpSelectedAnnotationId,
    foldedFigureId: oristudioCpActiveFoldedFigureId,
    inlineSimulationId: inlineSimulations.focusedId,
  });
  const selectCanvasObject = useCallback(
    (id: string | null) => {
      // Deselecting is per-kind: the store treats releasing a claim as nobody's
      // business but the releaser's, so say it for all three. Selecting is not —
      // whichever kind is named takes the canvas from the rest, in the store.
      if (id === null) {
        setSelectedAnnotation(null);
        setOristudioCpActiveFoldedFigure(null);
        inlineSimulations.blur();
        return;
      }
      if (inlineSimulations.isInlineSimulationId(id)) inlineSimulations.focus(id);
      else if (isFoldedFigureId(id)) setOristudioCpActiveFoldedFigure(id);
      else setSelectedAnnotation(id);
    },
    [isFoldedFigureId, inlineSimulations, setSelectedAnnotation, setOristudioCpActiveFoldedFigure]
  );

  // Gesture dispatch: the overlay reports box updates by id, and the id decides
  // which store the update belongs in.
  const handleCanvasObjectUpdate = useCallback(
    (id: string, patch: CanvasObjectBoxUpdate) => {
      if (inlineSimulations.isInlineSimulationId(id)) inlineSimulations.applyBoxUpdate(id, patch);
      else if (isFoldedFigureId(id)) folded.applyBoxUpdate(id, patch);
      else annotations.applyBoxUpdate(id, patch);
    },
    [isFoldedFigureId, folded, annotations, inlineSimulations]
  );
  // All three kinds take one checkpoint per gesture, not per pointermove.
  const beginCanvasObjectGesture = useCallback(
    (id: string) => {
      if (inlineSimulations.isInlineSimulationId(id)) inlineSimulations.beginGesture();
      else if (isFoldedFigureId(id)) folded.beginGesture();
      else annotations.beginGesture();
    },
    [isFoldedFigureId, annotations, folded, inlineSimulations]
  );
  const commitCanvasObjectGesture = useCallback(
    (id: string, kind: 'move' | 'resize' | 'rotate' | 'crop') => {
      if (inlineSimulations.isInlineSimulationId(id)) {
        inlineSimulations.commitGesture(inlineSimulations.gestureLabel(kind));
      } else if (isFoldedFigureId(id)) folded.commitGesture(folded.gestureLabel(kind));
      else annotations.commitGesture(annotations.gestureLabel(kind));
    },
    [
      isFoldedFigureId,
      annotations,
      folded,
      inlineSimulations,
    ]
  );





  // Right-click context menu for a folded form. Items act on the clicked figure by
  // id (not the active one), so they behave correctly even before selection settles.
  const [foldedContextMenu, setFoldedContextMenu] = useState<ContextMenuRequest | null>(null);
  const buildFoldedFigureMenuItems = useCallback(
    (figure: OristudioCpFoldedFigureEntry) =>
      foldedFigureMenuItemsWith(figure, foldedFigureActionDeps, t),
    [foldedFigureActionDeps, t]
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
  /**
   * Right-click on a canvas object. The overlay sits above the canvas and takes
   * the press first, so the canvas's own right-click path never sees a click
   * that lands on an object — this is what routes it to the folded menu.
   * Annotations have no context menu yet and simply select.
   */
  const handleCanvasObjectContextMenu = useCallback(
    (id: string, clientX: number, clientY: number) => {
      const figure = oristudioCpFoldedFigures.find((candidate) => candidate.id === id);
      if (!figure) return;
      setOristudioCpActiveFoldedFigure(id);
      setFoldedContextMenu({ x: clientX, y: clientY, items: buildFoldedFigureMenuItems(figure) });
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
      // The tool state holds the *resolved* operation, which for a merged tool
      // (Extend Line, Divided Line) is not always its action's own — so it wins.
      // For every other tool the two name the same command.
      const resolved = cpToolState.activeOperationId
        ? cpCommandByOperation(cpToolState.activeOperationId)
        : undefined;
      if (resolved) return resolved;
      return activeCpAction?.kind === 'command' ? activeCpAction.command : undefined;
    },
    [activeCpAction, cpToolState.activeOperationId]
  );
  // A merged tool's mode is a tool option, so it can change while the tool is
  // already armed. Re-resolve rather than making the user reselect the tool.
  useEffect(() => {
    setCpToolState((state) =>
      transitionOristudioCpToolState(state, {
        type: 'resolveVariant',
        toolOptions: cpToolOptions,
      })
    );
  }, [cpToolOptions]);
  // Annotations (images, text) select/drag/resize directly — no dedicated tool.
  // They are interactive whenever the active tool isn't mid-draw, or explicitly
  // allows direct entity selection; a drawing tool keeps its clicks on the canvas.
  const annotationsInteractive =
    cpToolState.phase !== 'active' || allowsDirectEntitySelection(activeCpCommand?.operationId);

  /**
   * Delete the selected canvas object, whichever kind holds the selection.
   * Reports whether there was one, since that is what decides if Delete belongs
   * to the viewport at all — see `viewport.delete` in the shortcut registry.
   */
  const deleteSelectedCanvasObject = useCallback((): boolean => {
    if (!annotationsInteractive || !selectedCanvasObjectId) return false;
    if (oristudioCpSelectedAnnotationId) deleteSelectedImage();
    else if (inlineSimulations.isInlineSimulationId(selectedCanvasObjectId)) {
      inlineSimulations.remove(selectedCanvasObjectId);
    } else folded.remove(selectedCanvasObjectId);
    return true;
  }, [
    annotationsInteractive,
    selectedCanvasObjectId,
    oristudioCpSelectedAnnotationId,
    deleteSelectedImage,
    folded,
    inlineSimulations,
  ]);
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
  // Which measure tool is active decides what is being measured — there is no
  // kind parameter: Measure Length and Measure Angle are separate tools.
  const cpMeasureKind = cpMeasureKindForOperation(activeCpCommand?.operationId);

  // What one model unit is worth for this document: the Oriedita paper frame's
  // width is the "paper edge = 1" reference, and the grid width comes from the
  // document's own grid so "grid squares" tracks a grid change.
  const cpMeasureScale = useMemo<CpMeasureScale>(
    () => ({
      paperEdge: editableCpBounds.spanX,
      gridWidth: editableCpGridWidth ?? editableCpBounds.spanX,
      paperEdgeMm: cpMeasurePreferences.paperEdgeMm,
    }),
    [editableCpBounds.spanX, editableCpGridWidth, cpMeasurePreferences.paperEdgeMm]
  );

  // Measure's prompt follows its kind, not the command's static 2-step list: an
  // angle collects three points, and the middle one is the vertex.
  const measureToolPrompt =
    isCpMeasurementOperation(activeCpCommand?.operationId) && cpToolState.phase === 'active'
      ? `${t('panels:creasePattern.measure', 'Measure')}: ${measureStepPrompt(
          t,
          cpMeasureKind ?? 'distance',
          cpMeasurePicked
        )}`
      : squareBisectorToolPrompt;
  const activeCpToolPrompt = measureToolPrompt;
  const lastCommandResult = oristudioCpDocument?.lastCommandResult ?? null;
  // What the canvas is showing — the same rule the store applies when it decides
  // whether a newly activated diagnostic is one the user can actually see.
  const latestDiagnosticEntries = useMemo(
    () => visibleCpDiagnosticEntries(oristudioCpCamvResult, lastCommandResult, camvIssuesVisible),
    [camvIssuesVisible, lastCommandResult, oristudioCpCamvResult]
  );
  // WebGL diagnostic overlay geometry (markers + segment highlights). Rebuilt when
  // the entries or theme change; the tone colours read the current theme's CSS vars.
  const cpDiagnosticGeometry = useMemo(() => {
    void currentTheme;
    const toneColors = resolveCpDiagnosticToneColors(document.documentElement);
    return {
      markers: buildCpDiagnosticMarkers(latestDiagnosticEntries, toneColors),
      strokes: buildCpDiagnosticStrokes(latestDiagnosticEntries, toneColors),
      wedges: buildCpDiagnosticWedges(latestDiagnosticEntries, toneColors),
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
    return { a, b, color: colors, widthMul, count, dashPatterns: [OVERLAY_DASH_PATTERN] };
  }, [editableCp?.operation_frame, currentTheme]);
  // The `selection_distance` every tool command carries, exposed to the canvas so a
  // destination pick is gated on the same radius the kernel searches.
  const cpToolSelectionDistance = useMemo(
    () => modelSelectionDistance(editableCpBounds, zoomPercent / 100),
    [editableCpBounds, zoomPercent]
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
        effectiveCpLineColor,
        zoomPercent / 100,
        cpToolOptions
      ),
      ...payload,
    }),
    [effectiveCpLineColor, cpToolOptions, editableCpBounds, editableCpGridWidth, zoomPercent]
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
            toolOptions: cpToolOptionsRef.current,
          })
        : state
    );
  }, [cpToolState.phase, editableCp, editableCpHandle, nativeActiveMouseMode, projectLoadId]);


  const handleCpToolAction = useCallback(
    (action: OristudioCpActionDefinition) => {
      setPendingLengthenLineId(null);
      // The hand tool and a crease tool are mutually exclusive, so the rail
      // and the toolbar never both read as active.
      setPanToolActive(false);
      if (action.kind === 'line-type') {
        setActiveCpLineColor(action.lineColor);
        return;
      }

      // Picking a crease/geometry tool deselects the active reference image, so
      // its handles don't linger over the canvas while another tool is active.
      // (Image-layer interactivity itself is left untouched.)
      setSelectedAnnotation(null);

      const command = action.command;
      setCpToolPoints([]);
      setCpToolPath([]);
      setPendingSquareBisectorLineIds([]);
      cpToolDragRef.current = null;

      // A whole-document verb (a repair sweep, a check) runs on the spot and
      // arms nothing, so it must not take the active-tool slot: the rail would
      // leave its button lit while the canvas had no tool, and clicks would go
      // nowhere. Decide before the state writes, not after them.
      const runsImmediately = !!editableCp && isWholeDocumentCpCommand(command);
      if (!runsImmediately) {
        setCpToolState((state) =>
          transitionOristudioCpToolState(state, {
            type: 'selectAction',
            action,
            editable: !!editableCp,
            toolOptions: cpToolOptionsRef.current,
          })
        );
        // Persist the selection so the tool survives panel remounts (workspace switches).
        useWorkspaceStore.getState().setOristudioCpActiveToolId(action.id);
      }

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
      setSelectedAnnotation,
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
          folded.foldModel();
          return;
        }
      }
      handleCpToolAction(action);
    },
    [handleCpToolAction, folded]
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
    (
      rawPoint: Point,
      toleranceModel: number
    ): { point: Point; snapped: boolean; kind?: CpSnapTarget['kind'] } => {
      if (!editableCp) return { point: rawPoint, snapped: false };
      const target = nearestOrieditaDrawPointTarget(
        editableCp,
        rawPoint,
        editableCpBounds,
        oristudioCpViewport,
        toleranceModel
      );
      // Report whether the point locked onto a grid point / vertex, so a restricted
      // draw can reject a start/end that doesn't snap — and *what* it locked onto, so
      // the measure tool can say whether an endpoint is a real vertex or a free point.
      return { point: target?.point ?? rawPoint, snapped: target !== null, kind: target?.kind };
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
  // Bisector). A crease's nearest point is its *perpendicular foot*, which sits
  // essentially on top of its own endpoint — so comparing that foot-distance against
  // the vertex distance lets a crease shadow its own vertex almost everywhere around
  // it, making vertices near-impossible to grab. So a *vertex* within a tight grab
  // radius wins outright (the same point-first rule `hitTest` uses for selection),
  // and only when no vertex is that close do we fall back to the grid-vs-line contest:
  // there the nearest snappable point (vertices + grid points, per the snapping
  // setting) wins ties and a line only wins when *strictly* closer, which keeps a
  // bare mid-crease click a line and lets a grid point on a crease read as a point.
  const resolveEditableFirstPickKind = useCallback(
    (rawPoint: Point, toleranceModel: number, pointPriorityModel: number): 'point' | 'line' => {
      if (!editableCp) return 'point';
      // A crease endpoint / paper corner / bare point within the tight radius wins
      // outright — grid points are excluded here so a click near a grid point on a
      // crease still falls through to the line contest below.
      const vertex = nearestOrieditaDrawPointTarget(
        editableCp,
        rawPoint,
        editableCpBounds,
        { ...oristudioCpViewport, snapToVertices: true, snapToGrid: false },
        pointPriorityModel
      );
      if (vertex && vertex.distance <= pointPriorityModel) return 'point';
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
      // and show it; then just finalize the tool state. The active *command* is always
      // the one Measure tool; which kernel operation computes the value follows the
      // chosen kind.
      const commitMeasureKind = cpMeasureKindForOperation(command.operationId);
      if (commitMeasureKind) {
        const kind = commitMeasureKind;
        // A one-click crease pick commits the crease id; its endpoints are the two
        // points the kernel measures between.
        const pickedCrease =
          points.length === 0 && pickedLineIds.length > 0
            ? editableCp?.crease_pattern.line_segments[pickedLineIds[0] - 1]
            : undefined;
        const measurePoints = pickedCrease ? [pickedCrease.a, pickedCrease.b] : [...points];
        if (measurePoints.length === 0) return;
        void previewOristudioCpCommand(
          command.operationId,
          buildCpCommandPayload(command, { points: measurePoints })
        ).then((preview) => {
          const value = preview?.measurement;
          if (value != null) {
            setCpMeasurements((current) => [...current, { kind, value, points: measurePoints }]);
          }
        });
        setCpMeasurePicked(0);
        setCpMeasureLivePoints([]);
        setCpMeasureLiveValue(null);
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
      editableCp?.crease_pattern.line_segments,
      executeOristudioCpCommand,
      previewOristudioCpCommand,
      oristudioCpSelection.circles,
      oristudioCpSelection.lines,
      t,
    ]
  );

  // Drive the step prompt in lock-step with the inputs a tool has taken: creases for
  // a line-entity tool (Lengthen), placed points for a point-sequence one. Derive the
  // step from the count (reset, then advance once per input) so a multi-step tool
  // reads "Pick destination point" once its source point is down, instead of sitting
  // on step one for the whole gesture.
  const handleWebglToolPickProgress = useCallback(
    (picked: number) => {
      const command = activeCpCommand;
      if (!command || command.uiStatus !== 'ready') return;
      if (isCpMeasurementOperation(command.operationId)) setCpMeasurePicked(picked);
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
  //
  // Keyed on the same predicate that decides the command's `line_color` payload,
  // so what you see while dragging is what gets committed. Keying on
  // `command.group === 'draw'` instead looked equivalent but is a UI taxonomy:
  // only 4 of the 34 crease-drawing operations carry that group, so the other 30
  // (Angle Restricted Line among them) previewed accent-blue and then committed
  // in the crease colour.
  const toolPreviewColor = useMemo(
    () =>
      cpCommandUsesActiveLineColor(activeCpCommand?.operationId)
        ? resolveCpLineColor(effectiveCpLineColor, mode, document.documentElement)
        : readCssVarColor(document.documentElement, '--accent-primary', [0.4, 0.6, 1, 1] as const),
    [activeCpCommand?.operationId, effectiveCpLineColor, mode]
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
    stepKinds: StepKind[];
    lineCount: number;
    dualMirror: boolean;
    converging: boolean;
    squareBisector: boolean;
    voronoi: boolean;
  }>(() => {
    const idle = {
      mode: null,
      stepKinds: [] as StepKind[],
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
    readonly ToolPreviewSegment[]
  >([]);
  // Existing creases the tool is snapping to or has picked, kept apart from the
  // candidate segments above because they are stroked in the selection accent
  // rather than the crease colour. They shared one array until the preview colour
  // started tracking the crease colour, at which point a hovered crease read as
  // though the tool had recoloured it.
  const [webglToolHighlightSegments, setWebglToolHighlightSegments] = useState<
    readonly { a: Point; b: Point }[]
  >([]);
  // Kernel-computed candidate *points* (e.g. Converging Lines ray intersections)
  // rendered as pickable dots on the canvas, separate from candidate segments.
  const [webglToolPreviewPoints, setWebglToolPreviewPoints] = useState<readonly Point[]>([]);
  // Why the tool has nothing to offer for the points placed so far — the
  // vertex-completion solve's "no single crease closes this vertex", which is a
  // real answer and would otherwise show as an empty canvas.
  const [cpToolUnavailable, setCpToolUnavailable] = useState<string | null>(null);
  // The completion tool determines mountain/valley itself, so the crease can come
  // out the opposite colour to the one selected in the rail. Correct, and worth a
  // word: nothing else in the editor overrides the active line type.
  const cpToolForcedAssignment = useMemo(
    () => forcedAssignmentNotice(t, webglToolPreviewSegments, effectiveCpLineColor),
    [t, webglToolPreviewSegments, effectiveCpLineColor]
  );
  const webglPreviewRequestRef = useRef(0);
  // The crease transform tools (Move / Copy, two- and four-point) preview by
  // transforming the selection on the canvas itself, so they take no kernel
  // preview — see `activeToolTransform` on the WebGL surface.
  const webglActiveToolTransform = useMemo(
    () => creaseTransformTool(activeCpCommand?.operationId),
    [activeCpCommand?.operationId]
  );
  const handleWebglToolPreviewInput = useCallback(
    (points: readonly Point[], highlightLineIds: readonly number[]) => {
      const command = activeCpCommand;
      // The passed ids are the hovered crease(s) — highlight only. The kernel
      // resolves creases from the points, so its payload carries the selection.
      const highlight = highlightLineIds
        .map((id) => editableCp?.crease_pattern.line_segments[id - 1])
        .filter((s): s is OristudioCpLineSegment => Boolean(s))
        .map((s) => ({ a: s.a, b: s.b }));
      if (isCpMeasurementOperation(command?.operationId)) {
        setCpMeasureLivePoints([...points]);
        if (points.length === 0) setCpMeasureLiveValue(null);
      }
      if (!command || points.length === 0) {
        webglPreviewRequestRef.current += 1;
        setWebglToolPreviewSegments([]);
        setWebglToolHighlightSegments(highlight);
        setWebglToolPreviewPoints([]);
        setCpToolUnavailable(null);
        return;
      }
      // Show a hovered-crease highlight immediately, but when there is none don't blank
      // the current kernel preview while the async recompute is in flight: that
      // clear-then-repopulate on every mouse move is what makes continuous guide lines
      // (e.g. Converging Lines' rays) flicker. Leaving the last preview in place until
      // the new one arrives keeps them steady; the async result replaces it below.
      if (highlight.length > 0) setWebglToolHighlightSegments(highlight);
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
        const kernel = toolPreviewSegments(preview?.segments, command.operationId);
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
        // Candidate geometry and existing-crease highlights go to separate
        // channels: the first is stroked in the crease colour the tool would
        // commit, the second in the selection accent.
        setWebglToolPreviewSegments([...kernel, ...rings]);
        setWebglToolHighlightSegments([...highlight, ...snapped]);
        setWebglToolPreviewPoints(preview?.points ?? []);
        setCpToolUnavailable(preview?.unavailable ?? null);
        // Measure: surface the kernel-computed length/angle live as points are placed
        // (Oriedita-parity math, never recomputed in JS). Only once the kernel returns
        // a value — it needs the full point count for the kind.
        if (isCpMeasurementOperation(command.operationId)) {
          setCpMeasureLiveValue(preview?.measurement ?? null);
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

  // Clear the WebGL point-sequence preview when that mode is no longer active, or
  // when a transform tool takes over the preview channel with its own ghost — the
  // transform tools are `sequence` tools too, so without the second condition a
  // previous tool's candidate segments would linger under the ghost.
  useEffect(() => {
    if (webglActiveTool.mode !== 'sequence' || webglActiveToolTransform) {
      webglPreviewRequestRef.current += 1;
      setWebglToolPreviewSegments([]);
      setWebglToolHighlightSegments([]);
      setWebglToolPreviewPoints([]);
      setCpToolUnavailable(null);
    }
  }, [webglActiveTool.mode, webglActiveToolTransform]);

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
  // While the blank editable CP is being seeded, show a loading state instead of
  // the "No crease pattern" affordance — but never mask a real busy/error status.
  const isProvisioningInitialCp =
    cpProvisioning &&
    status !== 'error' &&
    status !== 'building_crease_pattern' &&
    status !== 'optimizing';
  // The zoom-preset dropdown passes a scale (preset/100); the owned camera takes a percent.
  const setZoomLevel = useCallback(
    (scale: number) => cpCamera()?.setZoomPercent(scale * 100),
    []
  );

  /**
   * Escape, as a layered cancel: leave the hand tool, else drop the selection,
   * else deactivate the tool. Matches Oriedita, and fixes "select-all, Escape,
   * select-one ⇒ everything selected again" for Polygon/Lasso and friends.
   *
   * Reached through the shortcut runtime rather than a listener on this panel,
   * so it fires wherever focus happens to be — including the floating toolbars,
   * which are the surfaces a container-scoped listener silently loses.
   */
  const cancelActiveCpInput = useCallback(() => {
    if (!editableCp) return;
    // An open text editor owns Escape: leave the edit rather than the tool. The
    // editor itself claims the key while it holds focus (its Lexical command),
    // so this branch is what covers focus sitting on its floating toolbar.
    if (editingTextId) {
      annotations.exitEditText('escape');
      return;
    }
    if (panToolActive) {
      setPanToolActive(false);
      return;
    }
    // A selection takes priority as long as no gesture is in progress; a second
    // Escape then cancels the tool.
    const gestureInProgress =
      cpToolPoints.length > 0 ||
      cpToolPath.length > 0 ||
      pendingLengthenLineId !== null ||
      pendingSquareBisectorLineIds.length > 0 ||
      cpToolDragRef.current !== null;
    if (editableSelectionSize > 0 && !gestureInProgress) {
      clearOristudioCpSelection();
      return;
    }
    const cancellation = cancelOristudioCpToolState(cpToolState);
    if (cancellation.handled) {
      setCpToolPoints([]);
      setCpToolPath([]);
      setPendingLengthenLineId(null);
      setPendingSquareBisectorLineIds([]);
      cpToolDragRef.current = null;
      setCpToolState(cancellation.state);
      return;
    }
    if (editableSelectionSize > 0) clearOristudioCpSelection();
  }, [
    clearOristudioCpSelection,
    cpToolPath.length,
    cpToolPoints.length,
    cpToolState,
    editableCp,
    editableSelectionSize,
    editingTextId,
    annotations,
    panToolActive,
    pendingLengthenLineId,
    pendingSquareBisectorLineIds.length,
  ]);

  /**
   * Drop the most recent measurement, while the measure tool is active and
   * nothing is selected. With a selection, Delete belongs to the crease delete —
   * quietly stealing it would risk the geometry instead of a readout.
   */
  const dropLastMeasurement = useCallback((): boolean => {
    if (!editableCp || editableSelectionSize > 0) return false;
    if (cpMeasurements.length === 0) return false;
    if (!isCpMeasurementOperation(cpToolState.activeOperationId)) return false;
    setCpMeasurements((current) => current.slice(0, -1));
    setCpHoveredMeasureIndex(null);
    return true;
  }, [
    editableCp,
    editableSelectionSize,
    cpMeasurements.length,
    cpToolState.activeOperationId,
  ]);

  // No `default`: the switch is exhaustive over `ViewportShortcutId`, so a new
  // viewport verb fails to compile here until this surface says whether it
  // claims the chord or hands it on.
  const handleViewportShortcut = useCallback(
    (id: ViewportShortcutId): boolean => {
      switch (id) {
        case 'viewport.cancel':
          cancelActiveCpInput();
          return true;
        // Two viewport verbs share Delete, and both decline when they do not
        // apply so the chord falls through to `edit.delete` and deletes creases.
        // A selected canvas object outranks a measurement: it is the thing
        // currently showing handles.
        case 'viewport.delete':
          return deleteSelectedCanvasObject() || dropLastMeasurement();
        case 'viewport.simulateSelectionInline':
          void simulateSelectionInline();
          return true;
        case 'viewport.zoomIn':
          cpCamera()?.zoomIn();
          return true;
        case 'viewport.zoomOut':
          cpCamera()?.zoomOut();
          return true;
        case 'viewport.fit':
          cpCamera()?.fit();
          return true;
        case 'viewport.pan':
          setPanToolActive((active) => !active);
          return true;
        case 'viewport.rotateCcw':
          cpCamera()?.rotateBy(-VIEW_ROTATION_STEP_RADIANS);
          return true;
        case 'viewport.rotateCw':
          cpCamera()?.rotateBy(VIEW_ROTATION_STEP_RADIANS);
          return true;
        case 'viewport.resetRotation':
          cpCamera()?.rotateReset();
          return true;
        case 'viewport.actualSize':
          cpCamera()?.setZoomPercent(100);
          return true;
      }
    },
    [
      cancelActiveCpInput,
      simulateSelectionInline,
      deleteSelectedCanvasObject,
      dropLastMeasurement,
    ]
  );

  useEffect(
    () => registerViewportShortcutExecutor('crease-pattern', handleViewportShortcut),
    [handleViewportShortcut]
  );

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
    setCpMeasurements([]);
    setCpMeasurePicked(0);
  }, [editableCpHandle]);

  // V1 measurement lifetime: a reading lives only while the measure tool is active.
  // Escape deactivates the tool (cancelOristudioCpToolState → idle) and switching
  // tools changes the operation, so both paths land here and clear it.
  useEffect(() => {
    if (
      cpToolState.phase !== 'active' ||
      !isCpMeasurementOperation(cpToolState.activeOperationId)
    ) {
      setCpMeasurements([]);
      setCpHoveredMeasureIndex(null);
      setCpMeasurePicked(0);
      setCpMeasureLivePoints([]);
      setCpMeasureLiveValue(null);
    }
  }, [cpToolState.activeOperationId, cpToolState.phase]);

  return (
    <section className="panel-shell cp-panel">
      <div
        ref={containerRef}
        className={[
          'panel-body cp-panel__body',
          editableCp ? 'cp-panel__body--with-tools' : '',
        ].join(' ')}
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
                activeLineColor={effectiveCpLineColor}
                editable={!!editableCp}
                onSelectAction={handleCpToolAction}
              />
            )}
            <div
              className="cp-panel__viewport"
              ref={attachViewport}
              onDragOver={annotations.handleViewportDragOver}
              onDrop={annotations.handleViewportDrop}
            >
              <CpDiagnosticHud />
              {editableCp ? (
                <>
                <CreasePatternWebglCanvas
                  className="cp-webgl-layer"
                  lineSegments={editableCp.crease_pattern.line_segments}
                  geometry={oristudioCpDocument?.geometry ?? null}
                  images={imageAnnotations}
                  overlayBoxes={overlayBoxes}
                  framingKey={`${projectLoadId}:${editableCpHandle ?? 'none'}`}
                  modelToSvg={editableModelToSvg}
                  svgToModel={editableSvgToModel}
                  selectedLineIds={oristudioCpSelection.lines}
                  selectedPointIds={oristudioCpSelection.points}
                  selectedCircleIds={oristudioCpSelection.circles}
                  onSelect={(hit, additive) => {
                    // Any click on the canvas is a click outside every canvas
                    // object — the overlay captures presses that land on one and
                    // they never reach here. So deselect first, whether or not
                    // the click found a crease. Taking a crease selection would
                    // clear an object anyway, but a click that *deselects* the
                    // last crease leaves no claim behind to do it.
                    selectCanvasObject(null);
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
                  onTranslateSelection={(delta) => {
                    void transformOristudioCpSelection({ kind: 'translate', delta });
                  }}
                  resolveMoveSnap={resolveEditableMoveSnap}
                  activeToolInputMode={webglActiveTool.mode}
                  activeToolOperationId={activeCpCommand?.operationId ?? null}
                  activeToolStepKinds={webglActiveTool.stepKinds}
                  activeToolCommitsLoneCandidate={
                    cpInputModel(activeCpCommand?.operationId)?.commitOnLoneCandidate ?? false
                  }
                  activeToolSelectionDistance={cpToolSelectionDistance}
                  activeToolLineCount={webglActiveTool.lineCount}
                  activeToolDualMirror={webglActiveTool.dualMirror}
                  activeToolMeasureCreasePick={cpMeasureKind === 'distance'}
                  activeToolConverging={webglActiveTool.converging}
                  activeToolSquareBisector={webglActiveTool.squareBisector}
                  activeToolVoronoi={webglActiveTool.voronoi}
                  activeToolDashedPreview={isCpMeasurementOperation(activeCpCommand?.operationId)}
                  activeToolTransform={webglActiveToolTransform}
                  onTextCreate={webglActiveTool.mode === 'text' ? annotations.createTextAt : undefined}
                  onTextCreateBox={
                    webglActiveTool.mode === 'text' ? annotations.createTextBoxFromDrag : undefined
                  }
                  voronoiSeeds={cpToolPoints}
                  onVoronoiSeedsChange={handleWebglVoronoiSeeds}
                  activeToolRequireSnap={isRestrictedDrawOperation(activeCpCommand?.operationId)}
                  activeToolClickAction={toolClickAction(activeCpCommand?.operationId)}
                  resolveDrawPoint={resolveEditableDrawModelPoint}
                  resolveDrawPointOnCrease={resolveEditableDrawPointOnCrease}
                  resolveFirstPickKind={resolveEditableFirstPickKind}
                  onToolCommit={handleWebglToolCommit}
                  onToolPreviewInput={handleWebglToolPreviewInput}
                  onToolPickProgress={handleWebglToolPickProgress}
                  onToolSnapKind={setCpMeasureSnapKind}
                  toolCommandPreviewSegments={webglToolPreviewSegments}
                  toolCommandHighlightSegments={webglToolHighlightSegments}
                  toolCommandPreviewPoints={webglToolPreviewPoints}
                  toolPreviewColor={toolPreviewColor}
                  diagnosticMarkers={cpDiagnosticGeometry.markers}
                  diagnosticStrokes={cpDiagnosticGeometry.strokes}
                  diagnosticWedges={cpDiagnosticGeometry.wedges}
                  operationFrame={cpOperationFrameStrokes}
                  panToolActive={panToolActive}
                  onRotationChange={setViewRotation}
                  onZoomPercentChange={handleWebglZoomPercent}
                  onViewChange={handleWebglViewChange}
                  {...documentCamera}
                  activeToolModelAlignedBox={isModelAlignedBoxOperation(
                    activeCpCommand?.operationId
                  )}
                  onEraseBox={(points) => {
                    void executeOristudioCpCommand('LineSegmentDelete', {
                      line_ids: [],
                      points: [...points],
                    });
                  }}
                  onEraseLine={(id) => {
                    void executeOristudioCpCommand('LineSegmentDelete', { line_ids: [id] });
                  }}
                  onEraseCircle={(id) => {
                    void executeOristudioCpCommand('LineSegmentDelete', { circle_ids: [id] });
                  }}
                  onRequestContextMenu={handleRequestContextMenu}
                  mode={mode}
                  lineStyle={oristudioCpViewport.lineStyle ?? DEFAULT_ORISTUDIO_CP_LINE_STYLE}
                  foldAngleDisplay={
                    oristudioCpViewport.foldAngleDisplay ??
                    DEFAULT_ORISTUDIO_CP_FOLD_ANGLE_DISPLAY
                  }
                  lineWidth={oristudioCpViewport.lineWidth ?? 1}
                  points={editableCp.crease_pattern.points}
                  vertices={editableCpVertexPoints}
                  pointSize={oristudioCpViewport.pointSize ?? 1}
                  circles={editableCp.crease_pattern.circles}
                  circleRadiusToSvg={editableCircleRadiusToSvg}
                  foldedFigures={generatedFoldedFigures}
                  staleFoldedFigureIds={staleFoldedFigureIds}
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
                  isCpMeasurementOperation(activeCpCommand?.operationId) &&
                  cpToolState.phase === 'active' && (
                    <CpMeasureLayer
                      measurements={cpMeasurements}
                      hoveredIndex={cpHoveredMeasureIndex}
                      liveKind={cpMeasureKind ?? 'distance'}
                      livePoints={cpMeasureLivePoints}
                      liveValue={cpMeasureLiveValue}
                      liveSnapLabel={
                        cpMeasurePicked > 0 &&
                        cpMeasurePicked < cpMeasurePointCount(cpMeasureKind ?? 'distance')
                          ? measureSnapLabel(t, cpMeasureSnapKind)
                          : null
                      }
                      unit={cpMeasurePreferences.unit}
                      angleUnit={cpMeasurePreferences.angleUnit}
                      scale={cpMeasureScale}
                    />
                  )}
                {webglOverlayView && (
                  <CpFoldAngleLayer
                    lineSegments={editableCp?.crease_pattern.line_segments}
                    toolCandidates={webglToolPreviewSegments}
                  />
                )}
                {webglOverlayView && (oristudioCpAnnotations.length > 0 || editingTextId) && (
                  <CpTextAnnotationLayer
                    annotations={oristudioCpAnnotations}
                    editingTextId={editingTextId}
                    toolbarContainer={toolbarContainer}
                    onChangeText={annotations.changeTextContent}
                    onExitEdit={annotations.exitEditText}
                    onDelete={annotations.deleteEditingText}
                    onSyncHeight={annotations.syncAnnotationHeight}
                  />
                )}
                {webglOverlayView && canvasObjects.length > 0 && (
                  <CanvasObjectOverlay
                    objects={canvasObjects}
                    selectedId={selectedCanvasObjectId}
                    suppressedId={editingTextId}
                    inertBodyIds={inlineSimulations.inertBodyIds}
                    interactive={annotationsInteractive}
                    onSelect={selectCanvasObject}
                    onUpdate={handleCanvasObjectUpdate}
                    onCropUpdate={annotations.applyCrop}
                    onRequestEdit={annotations.requestEditText}
                    onContextMenu={handleCanvasObjectContextMenu}
                    canCrop={annotations.canCrop}
                    onGestureStart={beginCanvasObjectGesture}
                    onGestureCommit={commitCanvasObjectGesture}
                  />
                )}
                {webglOverlayView && inlineSimulations.simulations.length > 0 && (
                  <InlineSimulationLayer
                    simulations={inlineSimulations.simulations}
                    focusedId={inlineSimulations.focusedId}
                    staleIds={inlineSimulations.staleIds}
                    viewSettings={inlineSimulations.settings}
                    playing={inlineSimulations.playing}
                    overlayInteractive={annotationsInteractive}
                    replayRequest={inlineSimulations.replayRequest}
                    onFocus={inlineSimulations.focus}
                    onPlayingChange={inlineSimulations.setPlaying}
                  />
                )}
                {focusedInlineSimulation && (
                  <InlineSimulationInspector
                    simulation={focusedInlineSimulation}
                    container={toolbarContainer}
                    playing={inlineSimulations.playing}
                    stale={inlineSimulations.staleIds.has(focusedInlineSimulation.id)}
                    colorMode={inlineSimulations.settings.colorMode}
                    onColorMode={(mode) => inlineSimulations.setSetting('colorMode', mode)}
                    onTogglePlay={inlineSimulations.togglePlay}
                    onScrub={(percent) =>
                      inlineSimulations.scrub(focusedInlineSimulation.id, percent)
                    }
                    onReplay={inlineSimulations.replay}
                    onExport={inlineSimulations.exportView}
                    onRefresh={() => inlineSimulations.refresh(focusedInlineSimulation.id)}
                    onDelete={() => inlineSimulations.remove(focusedInlineSimulation.id)}
                  />
                )}
                {annotationsInteractive && selectedCpImage && !editingTextId && (
                  <CpImageInspector
                    image={selectedCpImage}
                    container={toolbarContainer}
                    onUpdate={(patch) => updateAnnotation(selectedCpImage.id, patch)}
                    onGestureStart={annotations.beginGesture}
                    onGestureCommit={annotations.commitGesture}
                    onBringToFront={annotations.bringSelectedImageToFront}
                    onSendToBack={annotations.sendSelectedImageToBack}
                    onDelete={deleteSelectedImage}
                  />
                )}
                {!editingTextId && !selectedCpImage && selectedFoldedFigure && (
                  <CpFoldedFigureToolbar
                    figure={selectedFoldedFigure}
                    container={toolbarContainer}
                    deps={foldedFigureActionDeps}
                  />
                )}
                {/* Deliberately not gated on `annotationsInteractive`: that flag
                    keeps *annotations* from stealing clicks while a drawing tool
                    is mid-gesture, and it is false for exactly the tools that
                    produce crease selections (Box Select and friends), which
                    would hide these actions whenever they are relevant. Only the
                    other floating toolbars are mutually exclusive with this one. */}
                {!editingTextId && !selectedCpImage && !selectedFoldedFigure && (
                  <CpSelectionToolbar container={toolbarContainer} />
                )}
                </>
              ) : (
                <div className="cp-panel__unopened" role="status">
                  <span className="cp-panel__unopened-title">
                    {t('panels:creasePattern.couldNotOpenForEditing', 'This crease pattern could not be opened for editing.')}
                  </span>
                  <span className="cp-panel__unopened-detail">
                    {t(
                      'panels:creasePattern.couldNotOpenForEditingHint',
                      'It is shown read-only. You can still view, fold, and export it.'
                    )}
                  </span>
                  {/* The kernel's own reason. Without it this state is a dead end:
                      the file is on screen, editing is off, and nothing says why. */}
                  {cpLoadError && <code className="cp-panel__unopened-reason">{cpLoadError}</code>}
                </div>
              )}
              <ViewportToolbar
                ariaLabel={t('panels:creasePattern.viewportControls', 'Crease pattern viewport controls')}
                zoomPercent={zoomPercent}
                zoomIn={() => cpCamera()?.zoomIn()}
                zoomOut={() => cpCamera()?.zoomOut()}
                fitToView={() => cpCamera()?.fit()}
                setZoomLevel={setZoomLevel}
                panToolActive={panToolActive}
                togglePanTool={() => setPanToolActive((active) => !active)}
                panShortcutLabel={shortcutLabelForAction('viewport.pan', shortcutOverrides)}
                viewRotation={viewRotation}
                rotateView={(direction) =>
                  cpCamera()?.rotateBy(direction * VIEW_ROTATION_STEP_RADIANS)
                }
                setViewRotation={(degrees) =>
                  cpCamera()?.rotateTo((degrees * Math.PI) / 180)
                }
                rotateCcwShortcutLabel={shortcutLabelForAction('viewport.rotateCcw', shortcutOverrides)}
                rotateCwShortcutLabel={shortcutLabelForAction('viewport.rotateCw', shortcutOverrides)}
              >
                {editableCp && (
                  <>
                    <ViewportToolbarSeparator />
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
                        title={foldShortcutLabel
                          ? `${t('panels:creasePattern.fold', 'Fold')} (${foldShortcutLabel})`
                          : t('panels:creasePattern.fold', 'Fold')}
                        disabled={!canFoldSelectedModel}
                        onClick={folded.foldModel}
                      >
                        <Origami size={14} />
                      </IconButton>
                      {/* "Another solution" lives on the figure's own contextual
                          bar, which acts on the figure you clicked. This copy
                          acted on the *active* figure — after a fold, a fallback
                          to whichever was made most recently. */}
                      <FoldedFigureMenuButton
                        figures={oristudioCpFoldedFigures}
                        activeFigure={activeFoldedFigure}
                        startingFaceId={foldStartingFaceId}
                        caseDraft={foldCaseDraft}
                        staleFigureIds={staleFoldedFigureIds}
                        onStartingFaceIdChange={setFoldStartingFaceId}
                        onCaseDraftChange={setFoldCaseDraft}
                        onSelectFigure={setOristudioCpActiveFoldedFigure}
                        onDisplayStyle={folded.setDisplayStyle}
                        onModelUpdate={folded.updateModel}
                        onModelGestureEnd={folded.endModelGesture}
                        onFoldToCase={folded.foldToCase}
                        onDuplicate={folded.duplicate}
                        onDelete={folded.remove}
                      />
                    </div>
                  </>
                )}
              </ViewportToolbar>
              {editableCp && activeCpCommand && (
                <CpContextToolPanel
                  container={toolbarContainer}
                  action={activeCpAction}
                  command={activeCpCommand}
                  options={cpToolOptions}
                  setOptions={setCpToolOptions}
                  activeLineColor={effectiveCpLineColor}
                  measurements={cpMeasurements}
                  onHoverMeasurement={setCpHoveredMeasureIndex}
                  measureUnit={cpMeasurePreferences.unit}
                  measureAngleUnit={cpMeasurePreferences.angleUnit}
                  measureScale={cpMeasureScale}
                  onMeasureUnitChange={setCpMeasureUnit}
                  onMeasureAngleUnitChange={setCpMeasureAngleUnit}
                  onMeasurePaperEdgeMmChange={setCpMeasurePaperEdgeMm}
                  pendingPointCount={cpToolPoints.length}
                  selection={oristudioCpSelection}
                  unavailable={cpToolUnavailable}
                  toolNotice={cpToolForcedAssignment}
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
                />
              )}
              <div className="viewport-status-readout">
                <span>{formatZoom(zoomPercent / 100)}</span>
                {editableCp && <span>{activeCpToolPrompt}</span>}
                {editableCp && <span>{cpLineTypeStatusLabel(effectiveCpLineColor, t)}</span>}
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
            {isProvisioningInitialCp ? (
              <span className="cp-panel__preparing" role="status" aria-live="polite">
                <Loader2 size={16} className="cp-panel__spinner" aria-hidden="true" />
                {t('panels:creasePattern.preparing', 'Preparing the editor…')}
              </span>
            ) : (
              <>
                <span title={status === 'error' ? error?.message : undefined}>{emptyStatusLabel}</span>
                <NextDocumentAction />
              </>
            )}
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
