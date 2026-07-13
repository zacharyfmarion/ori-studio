import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { createReglRenderer } from './renderer/reglRenderer';
import type { CpRenderer } from './renderer/CpRenderer';
import { readCssVarColor } from './renderer/cssColor';
import {
  fitUserCamera,
  modelViewFromCamera,
  panUserCamera,
  seedUserCamera,
  unprojectDevicePoint,
  userCameraToView,
  viewTransformScale,
  zoomUserCameraAt,
  type UserBounds,
  type UserCamera,
} from './renderer/camera';
import {
  LineHitIndex,
  circleRingIntersectsAabb,
  segmentIntersectsAabb,
} from './picking/lineHitIndex';
import type { ModelPoint, PointGeometry, Rgba, StrokeGeometry, Viewport } from './renderer/types';
import {
  cpSnapshotToScene,
  type CpLineSegmentInput,
  type CpMovePreview,
} from './adapters/cpSnapshotToScene';
import { cpPointsToScene } from './adapters/cpPointsToScene';
import { resolveCpLineColor } from './adapters/cpLineColor';
import { resolveCpPointStyle } from './adapters/cpPointStyle';
import {
  cpFoldedToScene,
  foldedFigureUserBounds,
  type FoldedFigureBounds,
} from './adapters/cpFoldedToScene';
import type { OristudioCpFoldedFigureEntry } from '../engine/oristudioCpTypes';
import {
  cpGridLinesToStrokes,
  gridBoundsKey,
  visibleGridBounds,
} from './adapters/cpGridToScene';
import { sampleView } from './svgViewBridge';
import { cpVertexId, orieditaGridLinesForModelBounds } from '../lib/creasePatternViewport';
import { toolEngineFor, type ToolInputMode } from './tools/registry';
import { createToolRuntime, type ToolRuntime } from './tools/runtime';
import { createStepSequenceTool } from './tools/stepSequenceTool';
import { createLinePickTool } from './tools/linePickTool';
import type { ToolCommit, ToolPreviewSegment } from './tools/types';

/**
 * Draw modes the canvas routes: the drag engines, the click-based persistent
 * `sequence` mode (every step collects a point; its {@link StepKind} sets how the
 * surface snaps + gives feedback), and `line-entity` (each click picks an existing
 * crease by id and commits line ids — the Lengthen model, which takes no points).
 */
type ActiveToolMode = ToolInputMode | 'sequence' | 'line-entity';
/**
 * Per-step snap/feedback mode: snap to grid/vertices (`point`), onto an existing
 * crease (`crease`), or onto the nearest kernel-computed candidate ray (`candidate`,
 * used by the flat-foldable/candidate tools whose middle step picks one of the
 * previewed option lines rather than free geometry).
 */
export type StepKind = 'point' | 'crease' | 'candidate';
import type { OristudioCpGridMetadata } from '../engine/oristudioCpTypes';
import { useThemeStore } from '../store/themeStore';

/** Cap DPR at 2 — matches the perf budget and avoids 3x/4x fill on hidpi. */
const MAX_DPR = 2;

/**
 * The editable SVG canvas is transparent, so the colour behind it is the panel
 * body background (`--bg-primary`). Clearing the WebGL surface to the same
 * variable keeps the two renderers visually identical when toggling.
 */
const CANVAS_BG_VAR = '--bg-primary';

/** Fallback if the CSS variable is missing (roughly a neutral dark panel). */
const FALLBACK_CLEAR: Rgba = [0.157, 0.172, 0.204, 1];

/** SVG editable crease width: `calc(var(--cp-line-width) * 1.5px)` in user units. */
const CREASE_WIDTH_FACTOR = 1.5;

/**
 * Crease width + markers are essentially constant screen size, but grow *very*
 * gently as you zoom in past the fit view so they don't read as thinning against
 * the expanding content. 0 = fully constant (thins relative to content), 1 =
 * full world-scaling (the old fattening). ~0.15 is a mild, crisp middle. The
 * growth is anchored at the fit zoom so it behaves the same for any CP scale.
 */
const WIDTH_ZOOM_EXPONENT = 0.15;

/**
 * How fast point/vertex markers shrink when zoomed *out* past the fit view, so a
 * dense CP's vertices don't dominate the zoomed-out picture. 0 = constant screen
 * size (they'd swamp the view), 1 = shrink in lockstep with the content. ~0.7
 * declutters while keeping them visible. Only markers shrink — crease lines keep
 * their constant screen width so structure stays legible.
 */
const MARKER_SHRINK_EXPONENT = 0.7;

/** Point/vertex outline width in CSS px (SVG non-scaling stroke ~1.4). */
const POINT_OUTLINE_CSS = 1.4;

/** Selection highlight: accent colour + a wider stroke. */
const SELECTION_COLOR_VAR = '--accent-primary';
const SELECTION_FALLBACK: Rgba = [0.4, 0.6, 1, 1];
const SELECTION_WIDTH_MUL = 2.6;
/** Click hit tolerances (CSS px). Points/vertices are small precise targets, so
    they win only on a tighter radius than the fatter line tolerance. */
const HIT_TOLERANCE_CSS = 8;
const POINT_HIT_TOLERANCE_CSS = 6;
const CLICK_MOVE_THRESHOLD = 4;
/** Move-drag snap radius (CSS px): how close an anchor must be to a target. */
const SNAP_TOLERANCE_CSS = 10;

/** Grid colour: `--border-default` composited at 82% (matches the SVG grid line). */
const GRID_COLOR_VAR = '--border-default';
const GRID_COLOR_ALPHA = 0.82;
const GRID_FALLBACK: Rgba = [0.4, 0.43, 0.48, GRID_COLOR_ALPHA];

/** Erase gesture (right-drag box) preview colour. */
const ERASE_COLOR_VAR = '--status-danger';
const ERASE_FALLBACK: Rgba = [0.85, 0.32, 0.32, 0.9];

/** Snap-target indicator: a constant-screen-size ring at the snapped draw point. */
const SNAP_INDICATOR_RADIUS = 5;
/** Placed sequence points render as small filled dots. */
const PLACED_POINT_RADIUS = 3;
const TRANSPARENT: Rgba = [0, 0, 0, 0];

const dpr = () => Math.min(window.devicePixelRatio || 1, MAX_DPR);

/** Pack a tool preview's candidate segments (model coords) into stroke geometry. */
function previewSegmentsToStrokes(
  segments: readonly ToolPreviewSegment[],
  color: Rgba
): StrokeGeometry {
  const count = segments.length;
  const a = new Float32Array(count * 2);
  const b = new Float32Array(count * 2);
  const col = new Float32Array(count * 4);
  const widthMul = new Float32Array(count).fill(1);
  for (let i = 0; i < count; i++) {
    const s = segments[i];
    a[i * 2] = s.a.x;
    a[i * 2 + 1] = s.a.y;
    b[i * 2] = s.b.x;
    b[i * 2 + 1] = s.b.y;
    col[i * 4] = color[0];
    col[i * 4 + 1] = color[1];
    col[i * 4 + 2] = color[2];
    col[i * 4 + 3] = color[3];
  }
  return { a, b, color: col, widthMul, count };
}

/** A single ring marker (transparent fill + coloured outline) at a snap point. */
function snapIndicatorPoints(point: ModelPoint, color: Rgba): PointGeometry {
  return {
    center: new Float32Array([point.x, point.y]),
    radius: new Float32Array([SNAP_INDICATOR_RADIUS]),
    screenSpace: new Float32Array([1]),
    fill: new Float32Array([TRANSPARENT[0], TRANSPARENT[1], TRANSPARENT[2], TRANSPARENT[3]]),
    stroke: new Float32Array([color[0], color[1], color[2], color[3]]),
    count: 1,
  };
}

/** Clamped projection of `p` onto the segment a→b. */
function projectPointOnSegment(
  p: ModelPoint,
  a: ToolPreviewSegment['a'],
  b: ToolPreviewSegment['b']
): ModelPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Project `raw` onto the nearest of `segments` within `maxDistance`, else null. */
function snapToNearestSegment(
  raw: ModelPoint,
  segments: readonly ToolPreviewSegment[],
  maxDistance: number
): ModelPoint | null {
  let best: ModelPoint | null = null;
  let bestDist = maxDistance;
  for (const s of segments) {
    const proj = projectPointOnSegment(raw, s.a, s.b);
    const d = Math.hypot(proj.x - raw.x, proj.y - raw.y);
    if (d <= bestDist) {
      bestDist = d;
      best = proj;
    }
  }
  return best;
}

/** The nearest of `candidates` to `raw` within `maxDistance`, else null. */
function snapToNearestPoint(
  raw: ModelPoint,
  candidates: readonly ModelPoint[],
  maxDistance: number
): ModelPoint | null {
  let best: ModelPoint | null = null;
  let bestDist = maxDistance;
  for (const p of candidates) {
    const d = Math.hypot(p.x - raw.x, p.y - raw.y);
    if (d <= bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/**
 * Overlay markers for a sequence: placed points as dots + a ring at the cursor.
 * `candidateDots` are the endpoints of previewed candidate rays (flat-foldable
 * step), drawn as dots so each option reads as a distinct pickable line.
 */
function sequenceOverlayPoints(
  placed: readonly ModelPoint[],
  ring: ModelPoint | null,
  color: Rgba,
  candidateDots: readonly ModelPoint[] = []
): PointGeometry | null {
  const count = placed.length + candidateDots.length + (ring ? 1 : 0);
  if (count === 0) return null;
  const center = new Float32Array(count * 2);
  const radius = new Float32Array(count);
  const screenSpace = new Float32Array(count).fill(1);
  const fill = new Float32Array(count * 4);
  const stroke = new Float32Array(count * 4);
  const put = (i: number, p: ModelPoint, r: number, f: Rgba) => {
    center[i * 2] = p.x;
    center[i * 2 + 1] = p.y;
    radius[i] = r;
    fill[i * 4] = f[0];
    fill[i * 4 + 1] = f[1];
    fill[i * 4 + 2] = f[2];
    fill[i * 4 + 3] = f[3];
    stroke[i * 4] = color[0];
    stroke[i * 4 + 1] = color[1];
    stroke[i * 4 + 2] = color[2];
    stroke[i * 4 + 3] = color[3];
  };
  let idx = 0;
  placed.forEach((p) => put(idx++, p, PLACED_POINT_RADIUS, color));
  candidateDots.forEach((p) => put(idx++, p, PLACED_POINT_RADIUS, color));
  if (ring) put(idx, ring, SNAP_INDICATOR_RADIUS, TRANSPARENT);
  return { center, radius, screenSpace, fill, stroke, count };
}

/**
 * A hit primitive from a click. Only real geometry is selectable — vertices are
 * derived line endpoints and are not (they merely follow the lines).
 */
export type CpSelectHit =
  | { kind: 'line'; id: number }
  | { kind: 'point'; id: number }
  | { kind: 'circle'; id: number };

/** Ids touched by a marquee, by primitive type. */
export interface CpBoxSelection {
  lines: number[];
  points: number[];
  circles: number[];
}

export interface CreasePatternWebglCanvasProps {
  className?: string;
  /** Crease-pattern line segments in model coordinates. */
  lineSegments: readonly CpLineSegmentInput[];
  /** The SVG the WebGL overlay mirrors for pan/zoom (Phase-1 bridge). */
  svgRef: RefObject<SVGSVGElement | null>;
  /** Model → SVG user-coordinate mapping (matches the SVG renderer). */
  modelToSvg: (point: ModelPoint) => ModelPoint;
  /** SVG user → model mapping (inverse of {@link modelToSvg}) for hit-testing. */
  svgToModel: (point: ModelPoint) => ModelPoint;
  /** Currently selected ids (lines/points/circles are 1-based). */
  selectedLineIds: readonly number[];
  selectedPointIds: readonly number[];
  selectedCircleIds: readonly number[];
  /** Click-select callback: the hit primitive, or null for a background click. */
  onSelect: (hit: CpSelectHit | null, additive: boolean) => void;
  /** Marquee (box) select callback with the touched ids by type. */
  onBoxSelect: (sets: CpBoxSelection, additive: boolean) => void;
  /**
   * Drag a folded figure by `delta` SVG user units (cmd/ctrl-drag over it,
   * mirroring Oriedita). Called repeatedly during the drag with incremental
   * deltas.
   */
  onMoveFoldedFigure: (figureId: string, delta: { x: number; y: number }) => void;
  /**
   * Commit a translation of the selected crease lines by `delta` (model coords),
   * on release of a selection move-drag. Line-based, matching the SVG selection
   * transform.
   */
  onTranslateSelection: (delta: { x: number; y: number }) => void;
  /**
   * Snap a move-drag's raw delta to nearby grid/vertices/lines. Given the raw
   * cursor delta and a snap tolerance in model units (derived from the WebGL
   * camera so it is a fixed screen distance), returns the adjusted delta and the
   * snapped target's label (or the raw delta unchanged when nothing snaps).
   */
  resolveMoveSnap: (
    rawDelta: { x: number; y: number },
    toleranceModel: number
  ) => { delta: { x: number; y: number }; snapLabel: string | null };
  /**
   * Active draw-tool mode, or null when no draw tool is active. Drag modes draw on
   * a plain drag; `point-sequence` places a point per click and previews on hover.
   */
  activeToolInputMode: ActiveToolMode | null;
  /** Per-step input kinds for a `sequence` tool (free point vs picked crease). */
  activeToolStepKinds: readonly StepKind[];
  /** Number of crease picks a `line-entity` tool collects before committing. */
  activeToolLineCount: number;
  /**
   * When true (Grid Restricted Line), a drag-line draw only begins from, and only
   * commits to, points that snap to grid/vertices — an unsnapped start or release
   * draws nothing.
   */
  activeToolRequireSnap: boolean;
  /**
   * True for click-or-box select tools (CreaseSelect / CreaseUnselect): a click
   * (no drag) routes to {@link onSelect} — select/unselect the crease under the
   * cursor, or clear on empty — while a drag runs the box command. Without this a
   * click would commit a degenerate box that selects nothing.
   */
  activeToolClickSelects: boolean;
  /**
   * True for Mirror Line (SymmetricDraw), whose input is dual-mode: the first pick
   * decides between a 3-point sequence (pick lands on a vertex/point) and a 2-line
   * sequence (pick lands on a bare crease). When set, the sequence engine defers its
   * step kinds to {@link resolveFirstPickKind} at first press instead of reading
   * the static `activeToolStepKinds`.
   */
  activeToolDualMirror: boolean;
  /**
   * True for Converging Lines (DrawCreaseAngleRestricted): a bespoke handler drives
   * its dual first click (a crease → its two endpoints are the base, or two points)
   * then a converge pick on one of the ray intersections in {@link
   * toolCommandPreviewPoints}.
   */
  activeToolConverging: boolean;
  /**
   * True for Square Bisector: a bespoke handler drives its dual first pick — a point
   * starts 3-point mode (3 points + destination crease → commit 4 points), a crease
   * starts 2-line mode (2 source creases + destination crease → commit 3 line ids).
   */
  activeToolSquareBisector: boolean;
  /**
   * Classify a dual-mode tool's first pick as point mode or line mode (point-priority
   * per Oriedita). Consulted on the first press of Mirror Line and Square Bisector.
   */
  resolveFirstPickKind: (rawPoint: ModelPoint, toleranceModel: number) => 'point' | 'line';
  /**
   * Snap a raw model draw point to nearby geometry (grid/vertices), reporting
   * whether it locked on (for restricted draws that reject unsnapped points).
   */
  resolveDrawPoint: (
    rawPoint: ModelPoint,
    toleranceModel: number
  ) => { point: ModelPoint; snapped: boolean };
  /**
   * Snap a raw model draw point onto nearby geometry incl. creases (for crease
   * steps), reporting whether the result landed on a crease *junction* (a vertex
   * where creases meet) — the surface highlights the single line under any other
   * snap but suppresses the highlight at a junction, where it would be ambiguous.
   */
  resolveDrawPointOnCrease: (
    rawPoint: ModelPoint,
    toleranceModel: number
  ) => { point: ModelPoint; snappedToVertex: boolean };
  /** Commit a tool's collected input (free points and/or picked crease ids). */
  onToolCommit: (commit: ToolCommit) => void;
  /**
   * Report a sequence tool's live input (placed points + cursor, and picked +
   * hovered crease ids) so the controller can kernel-preview + highlight them; the
   * result comes back via `toolCommandPreviewSegments`.
   */
  onToolPreviewInput: (points: readonly ModelPoint[], lineIds: readonly number[]) => void;
  /**
   * Report how many creases a `line-entity` tool has picked so far (0 when reset),
   * so the controller can advance the step prompt in lock-step with the picks.
   */
  onToolPickProgress: (picked: number) => void;
  /** Kernel-computed preview + pick-highlight segments for the active sequence tool. */
  toolCommandPreviewSegments: readonly ToolPreviewSegment[];
  /** Kernel-computed candidate *points* (Converging Lines ray intersections). */
  toolCommandPreviewPoints: readonly ModelPoint[];
  /** Colour of the in-progress candidate crease (the resolved active line colour). */
  toolPreviewColor: Rgba;
  /**
   * Right-drag box erase (universal, overrides the active tool): delete every
   * crease inside the box given by its two opposite corners (model coords).
   */
  onEraseBox: (points: readonly ModelPoint[]) => void;
  /** Right-click erase: delete the 1-based crease id under the cursor. */
  onEraseLine: (id: number) => void;
  /** Assignment colour mode. */
  mode: 'mvf' | 'agrh';
  /** `--cp-line-width` value driving stroke thickness. */
  lineWidth: number;
  /** Explicit crease points in model coordinates. */
  points: readonly ModelPoint[];
  /** Vertices (line-endpoint markers) in model coordinates. */
  vertices: readonly ModelPoint[];
  /** `--cp-point-size` value driving point/vertex radius. */
  pointSize: number;
  /** Circle-packing circles in model coordinates (radius in model units). */
  circles: readonly { x: number; y: number; r: number }[];
  /** Model radius → SVG user-unit radius (matches the SVG renderer). */
  circleRadiusToSvg: (radius: number) => number;
  /** Generated folded figures (render-snapshot primitives). */
  foldedFigures: readonly OristudioCpFoldedFigureEntry[];
  /** Grid parameters, or null when there is no grid. */
  grid: OristudioCpGridMetadata | null;
  /** Whether the grid is shown. */
  gridVisible: boolean;
}

/**
 * WebGL crease-pattern edit surface (behind the `webgl` dev flag).
 *
 * Step 2 of the SVG -> WebGL migration: renders the crease lines read-only,
 * mirroring the SVG's pan/zoom via {@link sampleView} so the two are directly
 * comparable. Interaction and the owned camera arrive in later steps. See
 * implementation-plans/webgl-canvas-workspace-migration.md.
 *
 * Rendering is driven two ways: synchronously on input changes (mount, resize,
 * geometry, theme) so the surface is always current, plus a requestAnimationFrame
 * loop that re-renders while the mirrored SVG transform changes (i.e. during a
 * live pan/zoom). The synchronous path means a backgrounded tab — where rAF is
 * throttled — still shows the correct static frame.
 */
export function CreasePatternWebglCanvas({
  className,
  lineSegments,
  svgRef,
  modelToSvg,
  svgToModel,
  selectedLineIds,
  selectedPointIds,
  selectedCircleIds,
  onSelect,
  onBoxSelect,
  onMoveFoldedFigure,
  onTranslateSelection,
  resolveMoveSnap,
  activeToolInputMode,
  activeToolStepKinds,
  activeToolLineCount,
  activeToolRequireSnap,
  activeToolClickSelects,
  activeToolDualMirror,
  activeToolConverging,
  activeToolSquareBisector,
  resolveFirstPickKind,
  resolveDrawPoint,
  resolveDrawPointOnCrease,
  onToolCommit,
  onToolPreviewInput,
  onToolPickProgress,
  toolCommandPreviewSegments,
  toolCommandPreviewPoints,
  toolPreviewColor,
  onEraseBox,
  onEraseLine,
  mode,
  lineWidth,
  points,
  vertices,
  pointSize,
  circles,
  circleRadiusToSvg,
  foldedFigures,
  grid,
  gridVisible,
}: CreasePatternWebglCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CpRenderer | null>(null);
  const renderNowRef = useRef<() => void>(() => {});
  // Late-bound `buildStrokes` so effects declared before it (the tool-reset
  // effect) can rebuild strokes; assigned once `buildStrokes` is defined.
  const buildStrokesRef = useRef<
    ((move?: CpMovePreview, pickedLineIds?: readonly number[]) => StrokeGeometry) | null
  >(null);
  const gridKeyRef = useRef<string | null>(null);
  // Owned camera (Phase 2). Null until seeded from the SVG's current fit.
  const cameraRef = useRef<UserCamera | null>(null);
  // Persistent runtime for the click-based `sequence` tool: points accumulate
  // across pointer gestures. Reset when the active tool changes (below).
  const persistentToolRuntimeRef = useRef<ToolRuntime | null>(null);
  // Index of the sequence step awaiting input, for per-step snapping/feedback.
  const sequenceStepRef = useRef(0);
  // Mirror Line's per-first-pick step kinds, decided at press time (point mode →
  // 3 point steps, line mode → 2 crease steps). Null until the first press; reset
  // on commit/cancel. Overrides the static `activeToolStepKinds` when set.
  const dynamicStepKindsRef = useRef<readonly StepKind[] | null>(null);
  // Converging Lines' base segment endpoints, accumulated across the dual first
  // click: a crease pick fills both at once, two point picks fill one each. Once it
  // holds 2, the gesture is in its converge (candidate-point) step.
  const convergingBaseRef = useRef<ModelPoint[]>([]);
  // Square Bisector's dual-mode accumulator: `mode` is chosen on the first pick
  // ('point' → collect 3 points then a destination; 'line' → collect 2 source crease
  // ids then a destination id). Null mode means the gesture hasn't started.
  const squareBisectorRef = useRef<{
    mode: 'point' | 'line' | null;
    points: ModelPoint[];
    lineIds: number[];
  }>({ mode: null, points: [], lineIds: [] });
  // Creases picked so far by a `line-entity` tool (Lengthen). Rendered in the
  // selection style so a picked line "shows up as selected" until commit — parity
  // with the SVG's persistent `highlightedLineIds`. Read by `buildStrokes`.
  const linePickHighlightRef = useRef<readonly number[]>([]);
  const currentTheme = useThemeStore((state) => state.currentTheme);

  // A tool change abandons any in-progress click sequence and its overlay.
  useEffect(() => {
    persistentToolRuntimeRef.current = null;
    sequenceStepRef.current = 0;
    dynamicStepKindsRef.current = null;
    convergingBaseRef.current = [];
    squareBisectorRef.current = { mode: null, points: [], lineIds: [] };
    linePickHighlightRef.current = [];
    rendererRef.current?.setOverlayPoints(null);
    const rebuild = buildStrokesRef.current;
    if (rebuild) rendererRef.current?.setStrokes(rebuild());
    renderNowRef.current();
  }, [
    activeToolInputMode,
    activeToolStepKinds,
    activeToolLineCount,
    activeToolDualMirror,
    activeToolConverging,
    activeToolSquareBisector,
  ]);

  // Content bounds in SVG user coords, for the initial camera fit (independent
  // of the SVG's own fixed-rect fit, which mis-centres imported cameras).
  const contentBounds = useMemo<UserBounds | null>(() => {
    if (lineSegments.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const seg of lineSegments) {
      for (const p of [seg.a, seg.b]) {
        const u = modelToSvg(p);
        if (u.x < minX) minX = u.x;
        if (u.y < minY) minY = u.y;
        if (u.x > maxX) maxX = u.x;
        if (u.y > maxY) maxY = u.y;
      }
    }
    return { minX, minY, maxX, maxY };
  }, [lineSegments, modelToSvg]);

  // Spatial indices for click hit-testing. Points are indexed as zero-length
  // segments so the same distance query applies (id = index + 1). Vertices are
  // derived and not selectable, so they get no index.
  const hitIndex = useMemo(
    () => new LineHitIndex(lineSegments.map((s, i) => ({ id: i + 1, a: s.a, b: s.b }))),
    [lineSegments]
  );
  const pointIndex = useMemo(
    () => new LineHitIndex(points.map((p, i) => ({ id: i + 1, a: p, b: p }))),
    [points]
  );
  // Folded-figure pick boxes (SVG user coords) for cmd-drag move, in draw order.
  const foldedBounds = useMemo<FoldedFigureBounds[]>(
    () => foldedFigureUserBounds(foldedFigures),
    [foldedFigures]
  );
  // Selected line ids as a set, for "is the press on a selected line" (move-drag).
  const selectedLineSet = useMemo(() => new Set(selectedLineIds), [selectedLineIds]);
  // Quantized ids of the endpoints of the selected lines. A derived vertex sits
  // on one of these iff it belongs to a moved line, so it should follow the drag.
  const selectedEndpointKeys = useMemo(() => {
    const keys = new Set<string>();
    lineSegments.forEach((s, i) => {
      if (selectedLineSet.has(i + 1)) {
        keys.add(cpVertexId(s.a));
        keys.add(cpVertexId(s.b));
      }
    });
    return keys;
  }, [lineSegments, selectedLineSet]);

  // Build the crease-stroke buffer, optionally with the selected lines shifted by
  // an in-progress move-drag. Shared by the scene memo (no move) and the drag
  // handler (live delta), so the moved strokes are the real, highlighted lines.
  const buildStrokes = useCallback(
    (move?: CpMovePreview, pickedLineIds?: readonly number[]): StrokeGeometry => {
      // Lines picked by an in-progress line-entity tool render in the selection
      // style too, so a picked crease reads as "selected". The picked set is passed
      // in by the imperative caller (event handler) — never read from a ref here,
      // so this stays safe to call from the render path.
      const selected =
        pickedLineIds && pickedLineIds.length
          ? new Set([...selectedLineSet, ...pickedLineIds])
          : selectedLineSet;
      return cpSnapshotToScene(
        lineSegments,
        (color) => resolveCpLineColor(color, mode, document.documentElement),
        {
          selected,
          color: readCssVarColor(document.documentElement, SELECTION_COLOR_VAR, SELECTION_FALLBACK),
          widthMul: SELECTION_WIDTH_MUL,
        },
        move
      ).strokes;
    },
    // currentTheme drives DOM-resolved colours; rebuild callers on theme change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineSegments, mode, selectedLineSet, currentTheme]
  );
  useEffect(() => {
    buildStrokesRef.current = buildStrokes;
  }, [buildStrokes]);

  // Build the point buffer (crease points, derived vertices, circles). During a
  // move-drag the derived vertices of the moved lines follow by `move.delta`;
  // real points and circles do not move (line-only transform for now).
  const buildPoints = useCallback(
    (move?: CpMovePreview): PointGeometry => {
      const movedVertices =
        move === undefined
          ? vertices
          : vertices.map((v) =>
              selectedEndpointKeys.has(cpVertexId(v))
                ? { x: v.x + move.delta.x, y: v.y + move.delta.y }
                : v
            );
      return cpPointsToScene(
        points,
        movedVertices,
        circles.map((c) => ({ center: { x: c.x, y: c.y }, radius: circleRadiusToSvg(c.r) })),
        resolveCpPointStyle(document.documentElement, pointSize),
        {
          pointIdx: new Set(selectedPointIds.map((id) => id - 1)),
          circleIdx: new Set(selectedCircleIds.map((id) => id - 1)),
          color: readCssVarColor(document.documentElement, SELECTION_COLOR_VAR, SELECTION_FALLBACK),
        }
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      points,
      vertices,
      circles,
      circleRadiusToSvg,
      pointSize,
      selectedPointIds,
      selectedCircleIds,
      selectedEndpointKeys,
      currentTheme,
    ]
  );

  // Per-frame / per-interaction inputs the effect reads without re-subscribing.
  const live = {
    modelToSvg,
    svgToModel,
    lineWidth,
    grid,
    gridVisible,
    contentBounds,
    hitIndex,
    pointIndex,
    lineSegments,
    points,
    vertices,
    circles,
    circleRadiusToSvg,
    foldedBounds,
    selectedLineSet,
    buildStrokes,
    buildPoints,
    onSelect,
    onBoxSelect,
    onMoveFoldedFigure,
    onTranslateSelection,
    resolveMoveSnap,
    activeToolInputMode,
    activeToolStepKinds,
    activeToolLineCount,
    activeToolRequireSnap,
    activeToolClickSelects,
    activeToolDualMirror,
    activeToolConverging,
    activeToolSquareBisector,
    resolveFirstPickKind,
    resolveDrawPoint,
    resolveDrawPointOnCrease,
    onToolCommit,
    onToolPreviewInput,
    onToolPickProgress,
    toolPreviewColor,
    toolCommandPreviewSegments,
    toolCommandPreviewPoints,
    onEraseBox,
    onEraseLine,
  };
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
    // Inputs affecting stroke thickness / mapping changed — redraw.
    renderNowRef.current();
  });

  // Force a grid rebuild when its params, visibility, or theme colour change.
  useEffect(() => {
    gridKeyRef.current = null;
    renderNowRef.current();
  }, [grid, gridVisible, currentTheme]);

  // Build GPU-ready geometry whenever the segments or mode change. `currentTheme`
  // is an intentional trigger: colours are resolved from theme CSS variables, so
  // the scene must be rebuilt when the theme switches even though its value is
  // not read directly here.
  const scene = useMemo(
    () => ({
      strokes: buildStrokes(),
      points: buildPoints(),
      folded: cpFoldedToScene(foldedFigures),
    }),
    [buildStrokes, buildPoints, foldedFigures]
  );

  // Renderer lifecycle + render loop (once per mount).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: CpRenderer;
    try {
      renderer = createReglRenderer(canvas);
    } catch (error) {
      console.error('[cp-webgl] failed to initialise WebGL renderer', error);
      return;
    }
    rendererRef.current = renderer;

    const viewportOf = (ratio: number): Viewport => ({
      width: canvas.width,
      height: canvas.height,
      dpr: ratio,
    });

    // Seed the owned camera once. Prefer fitting the actual geometry bounds
    // (correct for any imported camera); fall back to the SVG's current fit if
    // there is no geometry yet.
    const ensureCamera = (viewport: Viewport, ratio: number): UserCamera | null => {
      if (cameraRef.current) return cameraRef.current;
      const bounds = liveRef.current.contentBounds;
      if (bounds) {
        cameraRef.current = fitUserCamera(bounds, viewport);
        return cameraRef.current;
      }
      const svg = svgRef.current;
      if (!svg) return null;
      const sampled = sampleView(svg, canvas, liveRef.current.modelToSvg, ratio);
      if (!sampled) return null;
      const seeded = seedUserCamera(sampled.userView, viewport);
      if (!seeded) return null;
      cameraRef.current = seeded;
      return seeded;
    };

    const renderNow = () => {
      const ratio = dpr();
      const viewport = viewportOf(ratio);
      const cam = ensureCamera(viewport, ratio);
      if (!cam) return;

      const view = modelViewFromCamera(cam, viewport, liveRef.current.modelToSvg);
      const userView = userCameraToView(cam, viewport);

      // Grid is view-dependent: regenerate its lines when the visible region
      // (or params/theme, via gridKeyRef reset) changes.
      const gridMeta = liveRef.current.grid;
      if (gridMeta && liveRef.current.gridVisible) {
        const bounds = visibleGridBounds(view, canvas.width, canvas.height);
        if (bounds) {
          const key = gridBoundsKey(bounds, gridMeta);
          if (key !== gridKeyRef.current) {
            gridKeyRef.current = key;
            const lines = orieditaGridLinesForModelBounds(bounds, gridMeta);
            const color = readCssVarColor(canvas, GRID_COLOR_VAR, GRID_FALLBACK);
            renderer.setGrid(
              cpGridLinesToStrokes(lines, [color[0], color[1], color[2], GRID_COLOR_ALPHA])
            );
          }
        }
      } else if (gridKeyRef.current !== null) {
        gridKeyRef.current = null;
        renderer.setGrid(null);
      }

      // Crease width and markers are ~constant screen size but grow very gently
      // once zoomed in past the fit view, so they read as crisp (like Oriedita)
      // without thinning against the expanding content. Markers additionally
      // shrink when zoomed out past fit so dense vertices don't dominate. Both
      // anchored at the fit zoom so they are scale-invariant.
      const bounds = liveRef.current.contentBounds;
      const fitZoom = bounds ? fitUserCamera(bounds, viewport).zoom : cam.zoom;
      const zoomRatio = cam.zoom / fitZoom;
      const widthBoost = Math.pow(Math.max(zoomRatio, 1), WIDTH_ZOOM_EXPONENT);
      const markerShrink = zoomRatio < 1 ? Math.pow(zoomRatio, MARKER_SHRINK_EXPONENT) : 1;

      renderer.render({
        clearColor: readCssVarColor(canvas, CANVAS_BG_VAR, FALLBACK_CLEAR),
        view,
        userView,
        // Constant screen size (CSS px * dpr) times the gentle zoom boost. Circle
        // radii still scale fully with zoom via userScalePx — real geometry.
        strokeWidthPx: CREASE_WIDTH_FACTOR * liveRef.current.lineWidth * ratio * widthBoost,
        userScalePx: cam.zoom,
        markerScalePx: ratio * widthBoost * markerShrink,
        pointOutlinePx: POINT_OUTLINE_CSS * ratio,
      });
    };
    renderNowRef.current = renderNow;

    const applySize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = dpr();
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      renderer.resize({ width, height, dpr: ratio });
      renderNow();
    };

    const observer = new ResizeObserver(applySize);
    observer.observe(canvas);
    applySize();

    // --- Pointer interaction on the canvas ---
    // cmd/ctrl + drag pans; a plain click selects the crease under the cursor;
    // a plain drag marquee-selects.
    const clientToUser = (clientX: number, clientY: number): ModelPoint | null => {
      const cam = cameraRef.current;
      if (!cam) return null;
      const ratio = dpr();
      const rect = canvas.getBoundingClientRect();
      return unprojectDevicePoint(
        userCameraToView(cam, viewportOf(ratio)),
        (clientX - rect.left) * ratio,
        (clientY - rect.top) * ratio
      );
    };
    const clientToModel = (clientX: number, clientY: number): ModelPoint | null => {
      const userPt = clientToUser(clientX, clientY);
      return userPt ? liveRef.current.svgToModel(userPt) : null;
    };

    // Topmost folded figure whose pick box contains the cursor (draw order:
    // later figures render on top, so scan back-to-front).
    const figureAt = (clientX: number, clientY: number): string | null => {
      const u = clientToUser(clientX, clientY);
      if (!u) return null;
      const bounds = liveRef.current.foldedBounds;
      for (let i = bounds.length - 1; i >= 0; i--) {
        const b = bounds[i].bounds;
        if (u.x >= b.minX && u.x <= b.maxX && u.y >= b.minY && u.y <= b.maxY) {
          return bounds[i].id;
        }
      }
      return null;
    };

    const modelToleranceOf = (cssTol: number): number => {
      const cam = cameraRef.current;
      if (!cam) return cssTol;
      const scale = viewTransformScale(
        modelViewFromCamera(cam, viewportOf(dpr()), liveRef.current.modelToSvg)
      );
      return (cssTol * dpr()) / Math.max(1e-6, scale);
    };

    // Pick the primitive under the cursor. Points win only on a tight radius
    // (small precise targets) so a click near one still lets you grab the crease;
    // circles match near their ring. Vertices are derived and not pickable.
    const hitTest = (clientX: number, clientY: number): CpSelectHit | null => {
      const m = clientToModel(clientX, clientY);
      if (!m) return null;
      const l = liveRef.current;
      const ptTol = modelToleranceOf(POINT_HIT_TOLERANCE_CSS);
      const lineTol = modelToleranceOf(HIT_TOLERANCE_CSS);

      const p = l.pointIndex.query(m.x, m.y, ptTol);
      if (p > 0) return { kind: 'point', id: p };
      const line = l.hitIndex.query(m.x, m.y, lineTol);
      if (line > 0) return { kind: 'line', id: line };
      for (let i = 0; i < l.circles.length; i++) {
        const c = l.circles[i];
        if (Math.abs(Math.hypot(m.x - c.x, m.y - c.y) - c.r) <= lineTol) {
          return { kind: 'circle', id: i + 1 };
        }
      }
      return null;
    };

    // Transient marquee rectangle rendered as a plain DOM overlay.
    const marquee = document.createElement('div');
    marquee.className = 'cp-webgl-marquee';
    marquee.style.display = 'none';
    canvas.parentElement?.appendChild(marquee);
    const updateMarquee = (clientX: number, clientY: number) => {
      const parent = canvas.parentElement?.getBoundingClientRect();
      if (!parent) return;
      marquee.style.display = 'block';
      marquee.style.left = `${Math.min(pressX, clientX) - parent.left}px`;
      marquee.style.top = `${Math.min(pressY, clientY) - parent.top}px`;
      marquee.style.width = `${Math.abs(clientX - pressX)}px`;
      marquee.style.height = `${Math.abs(clientY - pressY)}px`;
    };
    const boxSelect = (clientX: number, clientY: number, additive: boolean) => {
      const p1 = clientToModel(pressX, pressY);
      const p2 = clientToModel(clientX, clientY);
      if (!p1 || !p2) return;
      const box = {
        minX: Math.min(p1.x, p2.x),
        maxX: Math.max(p1.x, p2.x),
        minY: Math.min(p1.y, p2.y),
        maxY: Math.max(p1.y, p2.y),
      };
      const l = liveRef.current;
      const inBox = (p: ModelPoint) =>
        p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
      const sets: CpBoxSelection = { lines: [], points: [], circles: [] };
      // Crossing marquee for lines/circle-rings; enclosed centres for points.
      // Vertices are derived, not selectable.
      l.lineSegments.forEach((s, i) => {
        if (segmentIntersectsAabb(s.a, s.b, box)) sets.lines.push(i + 1);
      });
      l.points.forEach((p, i) => {
        if (inBox(p)) sets.points.push(i + 1);
      });
      l.circles.forEach((c, i) => {
        if (circleRingIntersectsAabb(c.x, c.y, c.r, box)) sets.circles.push(i + 1);
      });
      l.onBoxSelect(sets, additive);
    };

    let panning = false;
    let selecting = false;
    let moved = false;
    // Active draw-tool drag: a runtime wrapping the active input mode's pure
    // engine, created on pointer-down and driven by feedTool.
    let drawing = false;
    // Modifier held when the current drag began, for additive box selection.
    let dragShift = false;
    let toolRuntime: ToolRuntime | null = null;
    // A ring at the draw point when it snapped to nearby geometry, else null.
    // `raw` is the un-snapped point.
    const snapIndicatorForSnap = (point: ModelPoint, raw: ModelPoint) =>
      point.x !== raw.x || point.y !== raw.y
        ? snapIndicatorPoints(
            point,
            readCssVarColor(document.documentElement, SELECTION_COLOR_VAR, SELECTION_FALLBACK)
          )
        : null;
    const showSnapIndicator = (point: ModelPoint, raw: ModelPoint) => {
      renderer.setOverlayPoints(snapIndicatorForSnap(point, raw));
    };
    const feedTool = (kind: 'down' | 'move' | 'up' | 'cancel', clientX: number, clientY: number) => {
      if (!toolRuntime) return;
      const raw = clientToModel(clientX, clientY);
      if (!raw) return;
      // Only crease-drawing (drag-line) snaps to grid/vertices; selection/erase
      // boxes (drag-box) and freehand paths (drag-path — lasso/polygon) follow the
      // raw cursor, so a rubber-band select doesn't jump to nearby points.
      const snaps = liveRef.current.activeToolInputMode === 'drag-line';
      const resolved = snaps
        ? liveRef.current.resolveDrawPoint(raw, modelToleranceOf(SNAP_TOLERANCE_CSS))
        : { point: raw, snapped: false };
      if (snaps) showSnapIndicator(resolved.point, raw);
      // Grid-restricted draw: the release must land on a snapped grid/vertex point,
      // else the crease is rejected (the start is gated in onPointerDown). The end
      // follows freely during the drag; only the commit requires a snap.
      if (liveRef.current.activeToolRequireSnap && kind === 'up' && !resolved.snapped) {
        toolRuntime.feed({ kind: 'cancel', point: resolved.point });
        renderer.setPreview(null);
        renderNow();
        return;
      }
      const out = toolRuntime.feed({ kind, point: resolved.point });
      renderer.setPreview(
        out.preview && out.preview.segments.length > 0
          ? previewSegmentsToStrokes(out.preview.segments, liveRef.current.toolPreviewColor)
          : null
      );
      renderNow();
      if (out.commit) liveRef.current.onToolCommit({ ...out.commit, additive: dragShift });
    };
    // Persistent click-based `sequence` tool: every step collects a point. A
    // 'crease' step snaps the point onto the nearest crease and highlights it
    // (the kernel resolves the crease from the point); a 'point' step snaps to
    // grid/vertices. Placed points + a snap ring draw as an overlay; the
    // controller kernel-previews the live points and renders the result.
    const feedPersistent = (kind: 'down' | 'move' | 'cancel', clientX: number, clientY: number) => {
      if (liveRef.current.activeToolInputMode !== 'sequence') return;
      const accent = readCssVarColor(document.documentElement, SELECTION_COLOR_VAR, SELECTION_FALLBACK);
      if (kind === 'cancel') {
        persistentToolRuntimeRef.current?.feed({ kind: 'cancel', point: { x: 0, y: 0 } });
        sequenceStepRef.current = 0;
        dynamicStepKindsRef.current = null;
        liveRef.current.onToolPreviewInput([], []);
        renderer.setOverlayPoints(null);
        renderNow();
        return;
      }
      const raw = clientToModel(clientX, clientY);
      if (!raw) return;
      const tol = modelToleranceOf(SNAP_TOLERANCE_CSS);
      // Mirror Line decides its step kinds on the first press: a pick on a
      // vertex/point runs a 3-point sequence, a pick on a bare crease a 2-line one.
      if (liveRef.current.activeToolDualMirror && !persistentToolRuntimeRef.current) {
        if (kind !== 'down') {
          // Hovering before the first pick — no mode yet. Show a plain point-snap
          // ring so the cursor reads as a placement without committing to a mode.
          const snap = liveRef.current.resolveDrawPoint(raw, tol).point;
          const ring = snap.x !== raw.x || snap.y !== raw.y ? snap : null;
          renderer.setOverlayPoints(sequenceOverlayPoints([], ring, accent));
          renderNow();
          return;
        }
        dynamicStepKindsRef.current =
          liveRef.current.resolveFirstPickKind(raw, tol) === 'line'
            ? ['crease', 'crease']
            : ['point', 'point', 'point'];
      }
      const stepKinds = dynamicStepKindsRef.current ?? liveRef.current.activeToolStepKinds;
      if (!persistentToolRuntimeRef.current) {
        persistentToolRuntimeRef.current = createToolRuntime(createStepSequenceTool(stepKinds.length));
        sequenceStepRef.current = 0;
      }
      const runtime = persistentToolRuntimeRef.current;
      // Auto-select a lone candidate: when the candidate step has exactly one
      // previewed option, Oriedita skips the pick. Inject a point on that ray and
      // advance, so this event lands on the following (destination) step.
      while (
        stepKinds[sequenceStepRef.current] === 'candidate' &&
        liveRef.current.toolCommandPreviewSegments.length === 1
      ) {
        const only = liveRef.current.toolCommandPreviewSegments[0];
        runtime.feed({
          kind: 'down',
          point: { x: (only.a.x + only.b.x) / 2, y: (only.a.y + only.b.y) / 2 },
        });
        sequenceStepRef.current += 1;
      }
      const stepKind = stepKinds[sequenceStepRef.current];
      const creaseStep = stepKind === 'crease';
      const candidateStep = stepKind === 'candidate';
      let point: ModelPoint;
      let snappedToVertex = false;
      if (creaseStep) {
        const resolved = liveRef.current.resolveDrawPointOnCrease(raw, tol);
        point = resolved.point;
        snappedToVertex = resolved.snappedToVertex;
      } else if (candidateStep) {
        // Snap onto the nearest previewed candidate ray. A pick that lands on no ray
        // is ignored (Oriedita's candidate step gates on selection distance) rather
        // than silently committing the nearest one from across the canvas.
        const snapped = snapToNearestSegment(raw, liveRef.current.toolCommandPreviewSegments, tol);
        if (snapped === null && kind === 'down') return;
        point = snapped ?? raw;
      } else {
        point = liveRef.current.resolveDrawPoint(raw, tol).point;
      }
      // On a crease step, highlight the single line under the snapped point — so a
      // crease the point lands on lights up even when it snapped to a grid point on
      // that line. Suppress the highlight only at a vertex where creases meet (the
      // snap ring marks the junction; which crease is meant would be ambiguous).
      const hoverLine =
        creaseStep && !snappedToVertex
          ? liveRef.current.hitIndex.query(point.x, point.y, modelToleranceOf(HIT_TOLERANCE_CSS))
          : -1;
      const highlight = hoverLine > 0 ? [hoverLine] : [];
      const out = runtime.feed({ kind, point });
      if (out.commit) {
        liveRef.current.onToolCommit(out.commit);
        liveRef.current.onToolPreviewInput([], []);
        renderer.setOverlayPoints(null);
        sequenceStepRef.current = 0;
        dynamicStepKindsRef.current = null;
      } else {
        if (kind === 'down') sequenceStepRef.current += 1;
        const live = out.livePoints ?? [];
        const placed = kind === 'move' ? live.slice(0, -1) : live;
        const ring = kind === 'move' && (point.x !== raw.x || point.y !== raw.y) ? point : null;
        // On a candidate step, dot the endpoints of every previewed candidate ray so
        // each option reads as a distinct pickable line (Oriedita draws these dots).
        const candidateDots = candidateStep
          ? liveRef.current.toolCommandPreviewSegments.flatMap((s) => [s.a, s.b])
          : [];
        renderer.setOverlayPoints(sequenceOverlayPoints(placed, ring, accent, candidateDots));
        liveRef.current.onToolPreviewInput(live, highlight);
      }
      renderNow();
    };
    // Converging Lines (angle-restricted): a bespoke sequence. The dual first click
    // builds the base segment — a crease pick supplies both endpoints at once, else
    // two point picks — then the previewed converging rays throw off intersection
    // points; picking one draws the two creases from the base endpoints to it.
    const feedConverging = (kind: 'down' | 'move' | 'cancel', clientX: number, clientY: number) => {
      const accent = readCssVarColor(document.documentElement, SELECTION_COLOR_VAR, SELECTION_FALLBACK);
      if (kind === 'cancel') {
        convergingBaseRef.current = [];
        liveRef.current.onToolPreviewInput([], []);
        renderer.setOverlayPoints(null);
        renderNow();
        return;
      }
      const raw = clientToModel(clientX, clientY);
      if (!raw) return;
      const tol = modelToleranceOf(SNAP_TOLERANCE_CSS);
      const hitTol = modelToleranceOf(HIT_TOLERANCE_CSS);
      const base = convergingBaseRef.current;

      if (base.length < 2) {
        if (kind === 'down') {
          if (base.length === 0) {
            // First pick: a crease supplies both base endpoints; else a free point.
            const lineId = liveRef.current.hitIndex.query(raw.x, raw.y, hitTol);
            const seg = lineId > 0 ? liveRef.current.lineSegments[lineId - 1] : undefined;
            if (seg) {
              convergingBaseRef.current = [
                { x: seg.a.x, y: seg.a.y },
                { x: seg.b.x, y: seg.b.y },
              ];
              liveRef.current.onToolPreviewInput(convergingBaseRef.current, []);
            } else {
              convergingBaseRef.current = [liveRef.current.resolveDrawPoint(raw, tol).point];
            }
          } else {
            // Second base point completes the segment.
            convergingBaseRef.current = [base[0], liveRef.current.resolveDrawPoint(raw, tol).point];
            liveRef.current.onToolPreviewInput(convergingBaseRef.current, []);
          }
          renderer.setOverlayPoints(sequenceOverlayPoints(convergingBaseRef.current, null, accent));
        } else if (base.length === 0) {
          // Hover before the first pick: highlight a crease under the cursor, or ring
          // the point it would snap to.
          const lineId = liveRef.current.hitIndex.query(raw.x, raw.y, hitTol);
          liveRef.current.onToolPreviewInput([], lineId > 0 ? [lineId] : []);
          const snap = liveRef.current.resolveDrawPoint(raw, tol);
          const ring = lineId > 0 || !snap.snapped ? null : snap.point;
          renderer.setOverlayPoints(sequenceOverlayPoints([], ring, accent));
        } else {
          // Hover for the second base point.
          liveRef.current.onToolPreviewInput([], []);
          const snap = liveRef.current.resolveDrawPoint(raw, tol);
          renderer.setOverlayPoints(sequenceOverlayPoints(base, snap.snapped ? snap.point : null, accent));
        }
        renderNow();
        return;
      }

      // Converge step: pick one of the previewed ray intersections.
      const converge = snapToNearestPoint(raw, liveRef.current.toolCommandPreviewPoints, tol);
      if (kind === 'down') {
        if (converge) {
          liveRef.current.onToolCommit({ points: [base[0], base[1], converge] });
          convergingBaseRef.current = [];
          liveRef.current.onToolPreviewInput([], []);
          renderer.setOverlayPoints(null);
        }
      } else {
        // Preview the rays + result creases to the hovered converge point, and dot
        // the intersection candidates (ringing the one under the cursor).
        liveRef.current.onToolPreviewInput([base[0], base[1], converge ?? raw], []);
        renderer.setOverlayPoints(
          sequenceOverlayPoints([], converge, accent, liveRef.current.toolCommandPreviewPoints)
        );
      }
      renderNow();
    };
    // Square Bisector (modes A + B): the first pick decides the mode. A point starts
    // 3-point mode — collect 3 angle points then a destination crease, commit 4
    // points. A crease starts 2-line mode — collect 2 source crease ids then a
    // destination crease id, commit 3 line ids. Picked source creases render in the
    // selection style; point mode shows placed dots + the kernel bisector preview.
    const feedSquareBisector = (kind: 'down' | 'move' | 'cancel', clientX: number, clientY: number) => {
      const accent = readCssVarColor(document.documentElement, SELECTION_COLOR_VAR, SELECTION_FALLBACK);
      const state = squareBisectorRef.current;
      const reset = () => {
        squareBisectorRef.current = { mode: null, points: [], lineIds: [] };
        setLinePickHighlight([]);
        liveRef.current.onToolPreviewInput([], []);
        renderer.setOverlayPoints(null);
      };
      if (kind === 'cancel') {
        reset();
        renderNow();
        return;
      }
      const raw = clientToModel(clientX, clientY);
      if (!raw) return;
      const tol = modelToleranceOf(SNAP_TOLERANCE_CSS);
      const hitTol = modelToleranceOf(HIT_TOLERANCE_CSS);
      const lineUnderCursor = () => liveRef.current.hitIndex.query(raw.x, raw.y, hitTol);

      // First pick decides point mode vs line mode (point-priority, like Mirror Line).
      // The line lookup uses the classifier's tolerance (`tol`), not the tighter hit
      // tolerance, so a click the classifier calls a line always resolves to one.
      if (state.mode === null) {
        if (liveRef.current.resolveFirstPickKind(raw, tol) === 'line') {
          const lineId = liveRef.current.hitIndex.query(raw.x, raw.y, tol);
          if (kind === 'down') {
            if (lineId > 0) {
              state.mode = 'line';
              state.lineIds = [lineId];
              setLinePickHighlight([lineId]);
            }
          } else {
            setLinePickHighlight(lineId > 0 ? [lineId] : []);
            renderer.setOverlayPoints(null);
          }
        } else {
          const snap = liveRef.current.resolveDrawPoint(raw, tol);
          if (kind === 'down') {
            state.mode = 'point';
            state.points = [snap.point];
            renderer.setOverlayPoints(sequenceOverlayPoints(state.points, null, accent));
          } else {
            setLinePickHighlight([]);
            renderer.setOverlayPoints(sequenceOverlayPoints([], snap.snapped ? snap.point : null, accent));
          }
        }
        renderNow();
        return;
      }

      if (state.mode === 'point') {
        const pts = state.points;
        if (pts.length < 3) {
          const snap = liveRef.current.resolveDrawPoint(raw, tol);
          if (kind === 'down') {
            pts.push(snap.point);
            if (pts.length === 3) liveRef.current.onToolPreviewInput(pts, []);
            renderer.setOverlayPoints(sequenceOverlayPoints(pts, null, accent));
          } else {
            renderer.setOverlayPoints(sequenceOverlayPoints(pts, snap.snapped ? snap.point : null, accent));
          }
        } else {
          // Destination crease: the 4th point resolves the nearest line kernel-side.
          const dest = liveRef.current.resolveDrawPointOnCrease(raw, tol).point;
          if (kind === 'down') {
            liveRef.current.onToolCommit({ points: [...pts, dest] });
            reset();
          } else {
            const hoverLine = liveRef.current.hitIndex.query(dest.x, dest.y, hitTol);
            liveRef.current.onToolPreviewInput([...pts, dest], hoverLine > 0 ? [hoverLine] : []);
            renderer.setOverlayPoints(sequenceOverlayPoints(pts, null, accent));
          }
        }
        renderNow();
        return;
      }

      // mode === 'line': collect the 2nd source crease, then a destination crease.
      const lineId = lineUnderCursor();
      const lines = state.lineIds;
      if (lines.length < 2) {
        if (kind === 'down') {
          if (lineId > 0 && !lines.includes(lineId)) {
            lines.push(lineId);
            setLinePickHighlight([...lines]);
          }
        } else {
          setLinePickHighlight(lineId > 0 && !lines.includes(lineId) ? [...lines, lineId] : [...lines]);
        }
      } else if (kind === 'down') {
        if (lineId > 0) {
          liveRef.current.onToolCommit({ lineIds: [...lines, lineId] });
          reset();
        }
      } else {
        setLinePickHighlight(lineId > 0 ? [...lines, lineId] : [...lines]);
      }
      renderNow();
    };
    // Dispatch a click-based `sequence` gesture to the right bespoke handler, else the
    // generic point-sequence engine.
    const feedSequenceTool = (kind: 'down' | 'move' | 'cancel', clientX: number, clientY: number) => {
      if (liveRef.current.activeToolConverging) feedConverging(kind, clientX, clientY);
      else if (liveRef.current.activeToolSquareBisector) feedSquareBisector(kind, clientX, clientY);
      else feedPersistent(kind, clientX, clientY);
    };
    // Set the persistent picked-crease highlight (rendered in the selection style
    // via buildStrokes) and re-upload strokes only when the set actually changes.
    const setLinePickHighlight = (ids: readonly number[]) => {
      const cur = linePickHighlightRef.current;
      if (cur.length === ids.length && cur.every((v, i) => v === ids[i])) return;
      linePickHighlightRef.current = ids;
      renderer.setStrokes(liveRef.current.buildStrokes(undefined, ids));
    };
    // Persistent click-based `line-entity` tool (Lengthen): each click picks the
    // crease under the cursor by id; after `count` picks it commits those ids as
    // `line_ids` (no points — the kernel operates on the creases directly). Picked
    // creases render in the selection style (buildStrokes) so they read as
    // "selected"; the crease under the cursor previews via the transient preview
    // channel. A click that misses every crease is swallowed.
    const feedLinePick = (kind: 'down' | 'move' | 'cancel', clientX: number, clientY: number) => {
      if (liveRef.current.activeToolInputMode !== 'line-entity') return;
      if (!persistentToolRuntimeRef.current) {
        persistentToolRuntimeRef.current = createToolRuntime(
          createLinePickTool(liveRef.current.activeToolLineCount)
        );
      }
      const runtime = persistentToolRuntimeRef.current;
      if (kind === 'cancel') {
        runtime.feed({ kind: 'cancel', point: { x: 0, y: 0 } });
        setLinePickHighlight([]);
        liveRef.current.onToolPreviewInput([], []);
        liveRef.current.onToolPickProgress(0);
        renderNow();
        return;
      }
      const raw = clientToModel(clientX, clientY);
      if (!raw) return;
      const hit = liveRef.current.hitIndex.query(raw.x, raw.y, modelToleranceOf(HIT_TOLERANCE_CSS));
      const hoveredId = hit > 0 ? hit : null;
      const out = runtime.feed({ kind, point: raw, lineId: hoveredId });
      if (out.commit) {
        liveRef.current.onToolCommit(out.commit);
        setLinePickHighlight([]);
        liveRef.current.onToolPreviewInput([], []);
      } else {
        if (kind === 'down') {
          // On a pick the engine's highlight is the picked set (no hover on down).
          const picked = out.highlightLineIds ?? [];
          setLinePickHighlight(picked);
          liveRef.current.onToolPickProgress(picked.length);
        }
        // Preview the crease under the cursor as the next-pick candidate.
        liveRef.current.onToolPreviewInput([], hoveredId != null ? [hoveredId] : []);
      }
      renderNow();
    };
    // Right-button erase gesture: reuses the drag-box engine for its rubber-band
    // box, but bound to the erase operation and never snapped (matches Oriedita).
    let erasing = false;
    let eraseRuntime: ToolRuntime | null = null;
    const feedErase = (kind: 'down' | 'move', clientX: number, clientY: number) => {
      if (!eraseRuntime) return;
      const raw = clientToModel(clientX, clientY);
      if (!raw) return;
      const out = eraseRuntime.feed({ kind, point: raw });
      renderer.setPreview(
        out.preview && out.preview.segments.length > 0
          ? previewSegmentsToStrokes(
              out.preview.segments,
              readCssVarColor(canvas, ERASE_COLOR_VAR, ERASE_FALLBACK)
            )
          : null
      );
      renderNow();
    };
    // Active folded-figure drag: figure id + last cursor position in user coords.
    let movingFigure: string | null = null;
    // Active selection move-drag: press point (model) and running delta (model).
    let movingSelection = false;
    let moveStart: ModelPoint | null = null;
    let moveDelta: ModelPoint = { x: 0, y: 0 };
    let lastUserX = 0;
    let lastUserY = 0;
    let lastX = 0;
    let lastY = 0;
    let pressX = 0;
    let pressY = 0;
    const onPointerDown = (e: PointerEvent) => {
      lastX = pressX = e.clientX;
      lastY = pressY = e.clientY;
      moved = false;
      const toolMode = liveRef.current.activeToolInputMode;
      if (e.button === 2) {
        // Right button: universal erase gesture, overrides any active tool.
        e.preventDefault();
        erasing = true;
        eraseRuntime = createToolRuntime(toolEngineFor('drag-box'));
        feedErase('down', e.clientX, e.clientY);
      } else if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        // cmd/ctrl over a folded figure grabs it to move; otherwise it pans.
        const figureId = figureAt(e.clientX, e.clientY);
        const u = figureId ? clientToUser(e.clientX, e.clientY) : null;
        if (figureId && u) {
          movingFigure = figureId;
          lastUserX = u.x;
          lastUserY = u.y;
        } else {
          panning = true;
        }
      } else if (toolMode === 'sequence') {
        // Click-based tool: place a point / pick a crease (no drag). Hover previews.
        e.preventDefault();
        feedSequenceTool('down', e.clientX, e.clientY);
      } else if (toolMode === 'line-entity') {
        // Click-based entity pick (Lengthen): each click grabs a crease by id.
        e.preventDefault();
        feedLinePick('down', e.clientX, e.clientY);
      } else if (toolMode) {
        // A drag draw tool is active: plain drag draws instead of selecting.
        e.preventDefault();
        // Grid-restricted draw only begins from a point that snaps to grid/vertices.
        const m = clientToModel(e.clientX, e.clientY);
        const startSnapped =
          !m ||
          toolMode !== 'drag-line' ||
          !liveRef.current.activeToolRequireSnap ||
          liveRef.current.resolveDrawPoint(m, modelToleranceOf(SNAP_TOLERANCE_CSS)).snapped;
        if (startSnapped) {
          drawing = true;
          dragShift = e.shiftKey || e.metaKey || e.ctrlKey;
          toolRuntime = createToolRuntime(toolEngineFor(toolMode));
          feedTool('down', e.clientX, e.clientY);
        }
      } else {
        // A plain drag that starts on an already-selected crease moves the whole
        // line selection; otherwise it selects (click or marquee).
        const m = clientToModel(e.clientX, e.clientY);
        const lineId = m
          ? liveRef.current.hitIndex.query(m.x, m.y, modelToleranceOf(HIT_TOLERANCE_CSS))
          : -1;
        if (m && lineId > 0 && liveRef.current.selectedLineSet.has(lineId)) {
          e.preventDefault();
          movingSelection = true;
          moveStart = m;
          moveDelta = { x: 0, y: 0 };
        } else {
          selecting = true;
        }
      }
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (
        Math.abs(e.clientX - pressX) > CLICK_MOVE_THRESHOLD ||
        Math.abs(e.clientY - pressY) > CLICK_MOVE_THRESHOLD
      ) {
        moved = true;
      }
      if (erasing) {
        feedErase('move', e.clientX, e.clientY);
      } else if (drawing) {
        feedTool('move', e.clientX, e.clientY);
      } else if (
        liveRef.current.activeToolInputMode === 'sequence' &&
        !panning &&
        !movingFigure &&
        !movingSelection &&
        !selecting
      ) {
        // Hover with a click-based tool active: update its preview / highlight.
        feedSequenceTool('move', e.clientX, e.clientY);
      } else if (
        liveRef.current.activeToolInputMode === 'line-entity' &&
        !panning &&
        !movingFigure &&
        !movingSelection &&
        !selecting
      ) {
        // Hover with an entity-pick tool active: highlight the crease under cursor.
        feedLinePick('move', e.clientX, e.clientY);
      } else if (
        liveRef.current.activeToolInputMode === 'drag-line' &&
        !panning &&
        !movingFigure &&
        !movingSelection &&
        !selecting
      ) {
        // Hover with a crease-draw tool (before pressing): show the snap indicator
        // at where the endpoint would land. Only drag-line snaps; drag-path
        // (lasso/polygon) follows the raw cursor with no snap indicator.
        const raw = clientToModel(e.clientX, e.clientY);
        if (raw) {
          showSnapIndicator(
            liveRef.current.resolveDrawPoint(raw, modelToleranceOf(SNAP_TOLERANCE_CSS)).point,
            raw
          );
          renderNow();
        }
      } else if (movingSelection && moveStart) {
        if (moved) {
          const m = clientToModel(e.clientX, e.clientY);
          if (m) {
            const rawDelta = { x: m.x - moveStart.x, y: m.y - moveStart.y };
            // Snap the translation to nearby grid/vertices/lines (screen-fixed
            // tolerance from the WebGL camera), matching the SVG move.
            moveDelta = liveRef.current.resolveMoveSnap(
              rawDelta,
              modelToleranceOf(SNAP_TOLERANCE_CSS)
            ).delta;
            // Redraw the selected lines shifted in place — the real strokes move,
            // no separate copy — and let their derived vertices follow. Only the
            // stroke + point buffers are re-uploaded per frame.
            const move = { ids: liveRef.current.selectedLineSet, delta: moveDelta };
            renderer.setStrokes(liveRef.current.buildStrokes(move));
            renderer.setPoints(liveRef.current.buildPoints(move));
            renderNow();
          }
        }
      } else if (movingFigure) {
        const u = clientToUser(e.clientX, e.clientY);
        if (u) {
          liveRef.current.onMoveFoldedFigure(movingFigure, {
            x: u.x - lastUserX,
            y: u.y - lastUserY,
          });
          lastUserX = u.x;
          lastUserY = u.y;
          // The store update re-renders via the foldedFigures prop; no manual
          // draw here (and the camera has not moved, so user coords stay valid).
        }
      } else if (panning && cameraRef.current) {
        const ratio = dpr();
        panUserCamera(cameraRef.current, (e.clientX - lastX) * ratio, (e.clientY - lastY) * ratio);
        lastX = e.clientX;
        lastY = e.clientY;
        renderNow();
      } else if (selecting && moved) {
        updateMarquee(e.clientX, e.clientY);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (erasing) {
        renderer.setPreview(null);
        const raw = clientToModel(e.clientX, e.clientY);
        if (eraseRuntime && raw) {
          if (e.type === 'pointercancel') {
            eraseRuntime.feed({ kind: 'cancel', point: raw });
          } else {
            const out = eraseRuntime.feed({ kind: 'up', point: raw });
            if (out.commit) {
              // Right-drag: erase every crease inside the box.
              liveRef.current.onEraseBox(out.commit.points ?? []);
            } else {
              // Right-click (degenerate box): erase the crease under the cursor.
              const hit = hitTest(e.clientX, e.clientY);
              if (hit && hit.kind === 'line') liveRef.current.onEraseLine(hit.id);
            }
          }
        }
        renderNow();
        erasing = false;
        eraseRuntime = null;
      } else if (drawing) {
        if (liveRef.current.activeToolClickSelects && !moved && e.type !== 'pointercancel') {
          // A click (no drag) on a select tool: discard the degenerate box and
          // route to the click handler (select/unselect the crease, or deselect on
          // empty), matching the SVG's per-crease click select.
          feedTool('cancel', e.clientX, e.clientY);
          liveRef.current.onSelect(hitTest(e.clientX, e.clientY), e.shiftKey);
        } else {
          feedTool(e.type === 'pointercancel' ? 'cancel' : 'up', e.clientX, e.clientY);
        }
        drawing = false;
        toolRuntime = null;
        renderer.setOverlayPoints(null);
      } else if (movingSelection) {
        if (moved && (Math.abs(moveDelta.x) > 1e-9 || Math.abs(moveDelta.y) > 1e-9)) {
          // Commit: the document update re-renders the strokes at their final
          // position, so we leave the shifted strokes in place (no snap-back).
          liveRef.current.onTranslateSelection(moveDelta);
        } else {
          // No effective move: restore the un-shifted strokes + points, and if it
          // was a plain click, run normal selection (lets a point on top win).
          renderer.setStrokes(liveRef.current.buildStrokes());
          renderer.setPoints(liveRef.current.buildPoints());
          renderNow();
          if (!moved) liveRef.current.onSelect(hitTest(e.clientX, e.clientY), e.shiftKey);
        }
      } else if (selecting) {
        if (moved) boxSelect(e.clientX, e.clientY, e.shiftKey);
        else liveRef.current.onSelect(hitTest(e.clientX, e.clientY), e.shiftKey);
      }
      marquee.style.display = 'none';
      panning = false;
      selecting = false;
      movingFigure = null;
      movingSelection = false;
      moveStart = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      if (!cam) return;
      const ratio = dpr();
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * ratio;
      const cy = (e.clientY - rect.top) * ratio;
      zoomUserCameraAt(cam, viewportOf(ratio), cx, cy, Math.pow(1.0015, -e.deltaY));
      renderNow();
    };
    // Suppress the browser menu so the right button is free for the erase gesture.
    const onContextMenu = (e: Event) => e.preventDefault();
    // Drop the hover snap indicator when the cursor leaves the canvas.
    const onPointerLeave = () => {
      renderer.setOverlayPoints(null);
      renderNow();
    };
    // Escape abandons an in-progress point sequence or entity pick.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (liveRef.current.activeToolInputMode === 'sequence') {
        feedSequenceTool('cancel', 0, 0);
      } else if (liveRef.current.activeToolInputMode === 'line-entity') {
        feedLinePick('cancel', 0, 0);
      }
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('keydown', onKeyDown);
      marquee.remove();
      renderNowRef.current = () => {};
      cameraRef.current = null;
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [svgRef]);

  // Upload geometry whenever it is rebuilt, then redraw immediately.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setScene(scene);
    renderNowRef.current();
  }, [scene]);

  // Point-sequence kernel preview: render the controller-supplied candidate
  // segments on the preview channel (cleared when there are none). Drag tools
  // drive the preview channel imperatively instead; the two tools are exclusive.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setPreview(
      toolCommandPreviewSegments.length > 0
        ? previewSegmentsToStrokes(toolCommandPreviewSegments, toolPreviewColor)
        : null
    );
    renderNowRef.current();
  }, [toolCommandPreviewSegments, toolPreviewColor]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
