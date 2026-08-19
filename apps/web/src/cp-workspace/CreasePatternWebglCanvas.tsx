import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createReglRenderer } from './renderer/reglRenderer';
import { CpRendererUnavailable } from './CpRendererUnavailable';
import { reportError } from '../monitoring';
import type { CpRenderer } from './renderer/CpRenderer';
import { readCssVarColor } from './renderer/cssColor';
import { syncHeldModifiersFromEvent } from '../keyboard/heldModifiers';
import { resolveWheelGesture, type WheelGesturePreference } from '../lib/wheelGesture';
import { claimWheelBurst, forwardWheel } from '../lib/wheelBurst';
import { cpCanvasCursor, usePanModifierHeld } from './cpCanvasCursor';
import {
  cameraZoomForPercent,
  fitUserCamera,
  frameUserCameraOnBounds,
  modelViewFromCamera,
  normalizeCameraRotation,
  panUserCamera,
  unprojectDevicePoint,
  userCameraToView,
  userCamerasEqual,
  viewTransformScale,
  zoomUserCameraAt,
  type UserBounds,
  type UserCamera,
} from './renderer/camera';
import { registerCpCamera, type CpCameraHandle } from './renderer/cpCameraRegistry';
import { LineHitIndex } from './picking/lineHitIndex';
import {
  circleRingIntersectsConvexQuad,
  pointInConvexQuad,
  segmentIntersectsConvexQuad,
} from './picking/convexQuad';
import { viewAlignedBoxCorners, type BoxCorners } from './tools/viewAlignedBox';
import { previewGroupsToStrokes, previewSegmentsToStrokes } from './renderer/previewStrokes';
import { candidatePreviewGroups } from './adapters/candidatePreviewGroups';
import {
  type FoldedGeometry,
  type MarkerGeometry,
  type ModelPoint,
  type PointGeometry,
  type Rgba,
  type StrokeGeometry,
  type ViewTransform,
  type Viewport,
  type WedgeGeometry,
} from './renderer/types';
import type { CpOverlayViews } from './cpOverlayViewStore';
import {
  applyAffine,
  cpSnapshotToScene,
  translationMatrix,
  type CpAffineMatrix,
  type CpLineSegmentInput,
  type CpTransformPreview,
} from './adapters/cpSnapshotToScene';
import { cpGeometryStrokesToScene } from './adapters/cpGeometryToScene';
import { matrixFromPointPairs } from './tools/creaseTransform';
import type { CpStepSnap } from './tools/inputModelRegistry';
import { isCreaseStep, loneCandidateAutoPick, requiresCreaseInRange } from './tools/sequenceSteps';
import {
  createTransformGhost,
  ghostBaseFromGeometry,
  ghostBaseFromSegments,
  type CpTransformGhost,
} from './tools/transformGhost';
import type { CpGeometryTransport } from '../engine/oristudioCpGeometry';
import type { CpImage } from './images/cpImage';
import { cpContentBounds } from './cpContentBounds';
import { cpPointsToScene, VERTEX_RADIUS_FACTOR } from './adapters/cpPointsToScene';
import { createCpLineAppearanceResolver } from './adapters/cpLineStyle';
import { cpLineStyleDashPatterns } from '../lib/oristudioCpLineStyle';
import { resolveCpPointStyle } from './adapters/cpPointStyle';
import {
  cpContradictionFaceFills,
  cpFoldedToScene,
  foldedFigureUserBounds,
  type FoldedFigureBounds,
} from './adapters/cpFoldedToScene';
import type { OristudioCpFoldedFigureEntry } from '../engine/oristudioCpTypes';
import { useFolded3dOrbitFigures } from './folded/useFolded3dOrbitFigures';
import type { CpContextMenuRequest } from './contextMenuTarget';
import { cpGridLinesToStrokes, gridBoundsKey, visibleGridBounds } from './adapters/cpGridToScene';
import {
  cpVertexId,
  orieditaGridLinesForModelBounds,
  type OristudioCpFoldAngleDisplay,
  type OristudioCpLineStyle,
  getOrieditaGridBasis,
} from '../lib/creasePatternViewport';
import { toolEngineFor } from './tools/registry';
import {
  cpPointerReleaseRoute,
  toolModeSnapsDrawPoint,
  type ActiveToolMode,
} from './tools/pointerRelease';
import { createToolRuntime, type ToolRuntime } from './tools/runtime';
import { createStepSequenceTool } from './tools/stepSequenceTool';
import { createLinePickTool } from './tools/linePickTool';
import type { ToolCommit, ToolPreviewSegment } from './tools/types';
import {
  CP_LINE_HIT_MIN_CSS,
  CP_LINE_HIT_RATIO,
  CP_POINT_HIT_MIN_CSS,
  CP_POINT_HIT_RATIO,
  CP_SNAP_RATIO,
  cpHitRadiusModel,
  cpKernelSnapRadiusModel,
  cpSnapRadiusModel,
} from './snapRadius';
import type { ToolClickAction } from './tools/predicates';

/**
 * Per-step snap/feedback mode — the input registry's {@link CpStepSnap}, which is
 * where each tool's steps are declared. Aliased (not redeclared) so the surface and
 * the registry cannot drift apart.
 */
export type StepKind = CpStepSnap;
/**
 * How far a stale folded figure fades. Shallow enough to read as a state rather
 * than as the Transparent display style, which is a deliberate look a user picks.
 */
const STALE_FOLDED_FIGURE_OPACITY = 0.45;

/**
 * Zoom factor for one press of a zoom button or chord. The wheel has its own
 * continuous factor — this is only the discrete step.
 */
const ZOOM_STEP = 1.35;

/**
 * The owned camera's model → CSS-pixel affine (relative to the canvas top-left),
 * reported to the panel so DOM overlays (text annotations) can position themselves
 * against the same camera the GL surface draws with:
 *   cssPoint = origin + model.x * ex + model.y * ey
 */
export interface CpOverlayView {
  origin: readonly [number, number];
  ex: readonly [number, number];
  ey: readonly [number, number];
}
import type { OristudioCpGridMetadata } from '../engine/oristudioCpTypes';
import { useThemeStore } from '../store/themeStore';

/** Cap DPR at 2 — matches the perf budget and avoids 3x/4x fill on hidpi. */
const MAX_DPR = 2;

/** Stable empty image list so the upload effect doesn't re-run on every render. */
const EMPTY_IMAGES: readonly CpImage[] = [];
/**
 * The editable SVG canvas is transparent, so the colour behind it is the panel
 * body background (`--bg-primary`). Clearing the WebGL surface to the same
 * variable keeps the two renderers visually identical when toggling.
 */
const CANVAS_BG_VAR = '--bg-primary';
/** Hue a shallower fold shifts toward; see `foldAngle/foldAngleRamp.ts`. */
const FOLD_ANGLE_ANCHOR_VAR = '--fold-angle-anchor';
const FOLD_ANGLE_ANCHOR_FALLBACK: Rgba = [0.851, 0.275, 0.937, 1];

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
 * How fast diagnostic markers and cursor decorations shrink when zoomed *out*
 * past the fit view. 0 = constant screen size, 1 = lockstep with the content.
 * These are affordances rather than content — a snap ring that shrank with the
 * paper would stop reading as a target — so they keep a partial shrink.
 */
const MARKER_SHRINK_EXPONENT = 0.7;

/**
 * How fast crease points and vertices shrink when zoomed *out* past the fit view.
 * 1 = lockstep with the content, so a vertex stays the same fraction of the
 * pattern at every zoom and the picture reads identically at any scale. Anything
 * below 1 makes vertices grow relative to the creases as you zoom out, which on a
 * dense CP turns the pattern into a field of dots. Sub-pixel dots then fade
 * rather than clamp (see the point program), which is what "shrink with the
 * pattern" means once a dot is asking for less than a pixel of ink.
 *
 * Note this rides `zoomRatio`, which is normalised against the whole document's
 * bounding box and so is meaningless on a sheet holding several patterns — there
 * it pins at 1 and dots keep their full size. Visibility is handled separately
 * by the crowding ramp below, which does not have that flaw.
 */
const VERTEX_SHRINK_EXPONENT = 1;

/** Point/vertex outline width in CSS px (SVG non-scaling stroke ~1.4). */
const POINT_OUTLINE_CSS = 1.4;

/**
 * Crease point/vertex visibility, in units of *crowding*: a dot's diameter as a
 * fraction of the on-screen distance between neighbouring vertices. 0.1 means
 * dots take up a tenth of the gap between them; 1.0 means they touch and the
 * pattern reads as a field of dots rather than as creases.
 *
 * Vertices are an up-close editing affordance (snap and hit targets). Surveying
 * a dense pattern, they are noise over the creases they annotate, so they fade
 * out entirely rather than shrinking forever.
 *
 * Crowding is a ratio of two CSS-px lengths, which is what makes it behave the
 * same everywhere: on any display density, at any `Point size`, at any document
 * coordinate scale. An earlier version keyed this to `cam.zoom / fitZoom`, which
 * measures zoom against the bounding box of the *whole document* — on a sheet
 * holding several patterns spread over thousands of units that reads as "zoomed
 * way in" while you look at one small pattern, and every fade stayed off.
 */
const VERTEX_CROWD_FULL_AT = 0.15;
const VERTEX_CROWD_GONE_AT = 0.45;
/**
 * Where the outline ring collapses into the fill, same units. It goes first: a
 * ring reads as a target, and a plain dot is quieter at the same size.
 */
const VERTEX_RING_FULL_AT = 0.12;
const VERTEX_RING_GONE_AT = 0.3;

/** Creases sampled when estimating vertex spacing. See `vertexSpacingModel`. */
const VERTEX_SPACING_SAMPLE_CAP = 2048;

/** Hermite ramp between two edges, clamped — the GLSL `smoothstep`. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Selection highlight: accent colour + a wider stroke. */
const SELECTION_COLOR_VAR = '--accent-primary';
const SELECTION_FALLBACK: Rgba = [0.4, 0.6, 1, 1];
const SELECTION_WIDTH_MUL = 2.6;
/** Alpha of a copy gesture's ghost, so prospective creases read as not-yet-real. */
const GHOST_ALPHA = 0.55;
/** Click-vs-drag gesture threshold (CSS px). Deliberately *not* a radius: it must
    not scale with the snap-radius setting, or a large radius would swallow short
    deliberate drags. The three radii it used to sit beside (10 / 8 / 6) are now one
    law in `snapRadius.ts`. */
const CLICK_MOVE_THRESHOLD = 4;

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

/** Clamped projection of `p` onto the segment a→b. */
function projectPointOnSegment(
  p: ModelPoint,
  a: ToolPreviewSegment['a'],
  b: ToolPreviewSegment['b'],
): ModelPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Project `raw` onto the nearest of `segments` within `maxDistance`, else null.
 *
 * Returns the index as well as the point: the completion tool renders that
 * candidate solid so you can see which one a click would take, and it must be the
 * same answer the pick uses or the two disagree.
 */
function snapToNearestSegment(
  raw: ModelPoint,
  segments: readonly ToolPreviewSegment[],
  maxDistance: number,
): { point: ModelPoint; index: number } | null {
  let best: { point: ModelPoint; index: number } | null = null;
  let bestDist = maxDistance;
  for (const [index, s] of segments.entries()) {
    const proj = projectPointOnSegment(raw, s.a, s.b);
    const d = Math.hypot(proj.x - raw.x, proj.y - raw.y);
    if (d <= bestDist) {
      bestDist = d;
      best = { point: proj, index };
    }
  }
  return best;
}

/** Whether segments p1p2 and p3p4 strictly cross (Oriedita's INTERSECTS_1). */
function segmentsIntersect(
  p1: ModelPoint,
  p2: ModelPoint,
  p3: ModelPoint,
  p4: ModelPoint,
): boolean {
  const side = (a: ModelPoint, b: ModelPoint, c: ModelPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = side(p3, p4, p1);
  const d2 = side(p3, p4, p2);
  const d3 = side(p1, p2, p3);
  const d4 = side(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** The nearest of `candidates` to `raw` within `maxDistance`, else null. */
function snapToNearestPoint(
  raw: ModelPoint,
  candidates: readonly ModelPoint[],
  maxDistance: number,
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
  candidateDots: readonly ModelPoint[] = [],
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
  { kind: 'line'; id: number } | { kind: 'point'; id: number } | { kind: 'circle'; id: number };

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
  /**
   * Compact geometry transport for the same document. Crease strokes are built from
   * this (typed arrays) when present — the default; `lineSegments` is used only as a
   * fallback when it is absent, and for hit-testing / id lookups either way.
   */
  geometry?: CpGeometryTransport | null;
  /** Model → user-coordinate mapping (the intermediate space the surface renders in). */
  modelToSvg: (point: ModelPoint) => ModelPoint;
  /** User → model mapping (inverse of {@link modelToSvg}) for hit-testing. */
  svgToModel: (point: ModelPoint) => ModelPoint;
  /**
   * Turning a focused 3D folded figure.
   *
   * A folded figure has no element of its own — it is drawn into this surface —
   * so when the canvas-object overlay makes a focused figure's body inert the
   * press lands here instead, and this is how the canvas asks whether it was
   * meant for the figure's camera. `claimsPress` takes a point in **user**
   * space, which is where a folded figure's box lives.
   *
   * The decision and the maths are in `folded/foldedFigureOrbitGesture`; nothing
   * here does more than route.
   */
  foldedOrbit?: {
    /** The figure currently taking drags, or null when none is focused. */
    focusedId: string | null;
    claimsPress: (point: ModelPoint) => boolean;
    /**
     * Anchor and advance a turn, in **CSS pixels** — deliberately not the user
     * point `claimsPress` takes.
     *
     * The two are different questions. "Is the press on the figure" is about the
     * figure's box, which lives in user space; "how far has the hand moved" is
     * about the hand, and unprojecting that through the crease-pattern camera
     * divides it by the zoom and rotates it by the view rotation. Measuring the
     * drag in user space made a figure turn at half rate at 200% zoom and pitch
     * on a horizontal drag over a rotated canvas.
     */
    begin: (point: { x: number; y: number }) => boolean;
    advance: (point: { x: number; y: number }) => void;
    commit: () => void;
    /**
     * Whether a wheel at this point belongs to the focused figure's camera
     * rather than to the crease-pattern camera. Narrower than `claimsPress`:
     * only a figure drawn as a live window can be zoomed at all.
     */
    claimsWheel: (point: ModelPoint) => boolean;
    /** Zoom the focused figure by one wheel event's worth. */
    zoom: (deltaY: number) => void;
  } | null;
  /**
   * Reference images (superset layer), drawn above the grid and below the
   * creases. Placement is in model coordinates.
   */
  images?: readonly CpImage[];
  /**
   * Boxes that live on their own DOM layer rather than being drawn here — text
   * annotations and inline simulation windows — folded into the framing bounds
   * so opening a document and fitting to view include them. Model coords.
   *
   * Anything placed on the canvas belongs here. A kind that is missing is
   * invisible to framing, so fitting to view can leave it off screen entirely,
   * with nothing to suggest why.
   */
  overlayBoxes?: readonly {
    center: ModelPoint;
    width: number;
    height: number;
    rotation: number;
    hidden: boolean;
  }[];
  /**
   * Identity of the document being framed. The camera seeds itself once from
   * `contentBounds`; when this changes (a new document loaded) the seed is
   * discarded so the next frame re-fits against the *current* bounds — which by
   * then include the document's annotations. Without this, opening frames from a
   * snapshot taken before the annotation layer propagated.
   */
  framingKey?: string | number;
  /** Currently selected ids (lines/points/circles are 1-based). */
  selectedLineIds: readonly number[];
  selectedPointIds: readonly number[];
  selectedCircleIds: readonly number[];
  /** Click-select callback: the hit primitive, or null for a background click. */
  onSelect: (hit: CpSelectHit | null, additive: boolean) => void;
  /** Marquee (box) select callback with the touched ids by type. */
  onBoxSelect: (sets: CpBoxSelection, additive: boolean) => void;
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
    toleranceModel: number,
  ) => { delta: { x: number; y: number }; snapLabel: string | null };
  /**
   * Active draw-tool mode, or null when no draw tool is active. Drag modes draw on
   * a plain drag; `point-sequence` places a point per click and previews on hover.
   */
  activeToolInputMode: ActiveToolMode | null;
  /**
   * The active operation, or null when no tool is active. Not used for routing —
   * that is what {@link activeToolInputMode} and the input-model registry are for —
   * only so per-tool interaction state is abandoned when the tool changes, including
   * between two tools that share an input mode (Draw crease → Make alternating M/V).
   */
  activeToolOperationId: string | null;
  /**
   * Hand-tool mode: a plain left drag pans instead of running the active tool.
   * The accel-drag pan (Cmd on Apple, Ctrl elsewhere) works regardless.
   */
  panToolActive: boolean;
  /**
   * What an *unmodified* scroll or two-finger drag does. Pinch and the accel key
   * zoom either way, so this only changes the unmodified gesture.
   */
  wheelGesture: WheelGesturePreference;
  /** Per-step input kinds for a `sequence` tool (free point vs picked crease). */
  activeToolStepKinds: readonly StepKind[];
  /**
   * Whether this tool commits at once when its final candidate step has a single
   * option — see `CpInputModelEntry.commitOnLoneCandidate`.
   */
  activeToolCommitsLoneCandidate: boolean;
  /**
   * The user's snap radius in model units (Oriedita's `mouseRadius`). Every
   * tolerance on this surface derives from it through `cpSnapRadiusModel`.
   */
  snapRadius: number;
  /**
   * Publishes the resolved snap distance whenever it changes, so the panel sends
   * the kernel *exactly* the radius this surface snapped with. Deriving it there
   * from the reported zoom percent would skew by the percent rounding, and a
   * `crease-required` step gates its pick on this number matching the kernel's.
   */
  onSnapDistanceChange: (distance: number) => void;
  /** Number of crease picks a `line-entity` tool collects before committing. */
  activeToolLineCount: number;
  /**
   * When true (Grid Restricted Line), a drag-line draw only begins from, and only
   * commits to, points that snap to grid/vertices — an unsnapped start or release
   * draws nothing.
   */
  activeToolRequireSnap: boolean;
  /**
   * How a click (no drag) is routed while a drag-box tool is active. Oriedita's
   * `BoxSelectStepNode` splits the release the same way: a dragged box runs the box
   * action, a zero-length press runs the tool against the crease nearest the cursor.
   * The drag-box engine commits nothing for that degenerate gesture, so tools with a
   * click behaviour name it here.
   * - `'select'` — CreaseSelect / CreaseUnselect: routes to {@link onSelect}, which
   *   selects/unselects the crease under the cursor or clears on empty.
   * - `'crease'` — CreaseToggleMv: only a crease hit routes to {@link onSelect} (the
   *   panel dispatches the flip); a click on empty space leaves the selection alone.
   * - `'erase'` — LineSegmentDelete: deletes the crease under the cursor via
   *   {@link onEraseLine}, or the circle ring under it via {@link onEraseCircle}.
   *   Mirrors Oriedita's LINE_SEGMENT_DELETE_3.
   */
  activeToolClickAction: ToolClickAction | null;
  /**
   * True for Mirror Line (SymmetricDraw), whose input is dual-mode: the first pick
   * decides between a 3-point sequence (pick lands on a vertex/point) and a 2-line
   * sequence (pick lands on a bare crease). When set, the sequence engine defers its
   * step kinds to {@link resolveFirstPickKind} at first press instead of reading
   * the static `activeToolStepKinds`.
   */
  activeToolDualMirror: boolean;
  /**
   * True for the Measure tool in its distance kind: a first pick that lands on a
   * bare crease measures *that crease* in one click (committed as its line id), so
   * a designer never has to click both endpoints of a line already on the canvas.
   * A pick on a vertex/point falls through to the normal 2-point sequence.
   */
  activeToolMeasureCreasePick: boolean;
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
   * True for Voronoi: each click appends a seed point; the kernel snaps/toggles and
   * rebuilds the whole diagram from the accumulated list ({@link voronoiSeeds}),
   * previewed live until the contextual Apply button commits.
   */
  activeToolVoronoi: boolean;
  /** True for the measure tools: their guide line renders as a screen-space dash. */
  activeToolDashedPreview: boolean;
  /**
   * Set for the crease transform tools (move/copy, two-point and four-point), which
   * preview the selection at its prospective position while the gesture runs. A
   * `move` shifts the real strokes in place; a `copy` leaves them and draws a ghost.
   * The point count is the tool's own — two points is a translation, four is the
   * similarity taking the source pair onto the target pair.
   */
  activeToolTransform: { kind: 'move' | 'copy'; pointCount: 2 | 4 } | null;
  /**
   * Text tool: a plain click on empty canvas (no drag, no pan) reports its model
   * point so the panel can start an inline-edit draft there. Selecting/dragging an
   * existing text is handled by the DOM overlay, so those clicks never reach here.
   */
  onTextCreate?: (modelPoint: ModelPoint) => void;
  /**
   * Text tool: a press-and-drag reports the drag's start + end model points so
   * the panel can create a text box of that size (vs. the click above, which
   * makes an auto-sizing box).
   */
  /**
   * Text-tool press-drag: create a box at the four corners the marquee drew, so
   * the created box carries the marquee's orientation rather than deriving its
   * own. Corners are in perimeter order (see `tools/viewAlignedBox`).
   */
  onTextCreateBox?: (corners: BoxCorners) => void;
  /** The current Voronoi click list (owned by the panel as `cpToolPoints`). */
  voronoiSeeds: readonly ModelPoint[];
  /** Report the updated Voronoi click list after a seed add / gesture reset. */
  onVoronoiSeedsChange: (seeds: readonly ModelPoint[]) => void;
  /**
   * Classify a dual-mode tool's first pick as point mode or line mode (point-priority).
   * Consulted on the first press/hover of Mirror Line, Converging Lines, and Square
   * Bisector. `pointPriorityModel` is the tight radius within which a vertex wins
   * outright over a crease whose perpendicular foot is marginally closer.
   */
  resolveFirstPickKind: (
    rawPoint: ModelPoint,
    toleranceModel: number,
    pointPriorityModel: number,
  ) => 'point' | 'line';
  /**
   * Snap a raw model draw point to nearby geometry (grid/vertices), reporting
   * whether it locked on (for restricted draws that reject unsnapped points).
   */
  resolveDrawPoint: (
    rawPoint: ModelPoint,
    toleranceModel: number,
  ) => {
    point: ModelPoint;
    snapped: boolean;
    /** What the point locked onto when it snapped; reported via {@link onToolSnapKind}. */
    kind?: 'grid' | 'vertex' | 'point' | 'line';
  };
  /**
   * Snap a raw model draw point onto nearby geometry incl. creases (for crease
   * steps), reporting whether the result landed on a crease *junction* (a vertex
   * where creases meet) — the surface highlights the single line under any other
   * snap but suppresses the highlight at a junction, where it would be ambiguous.
   */
  resolveDrawPointOnCrease: (
    rawPoint: ModelPoint,
    toleranceModel: number,
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
   * Report how many inputs the active tool has taken so far (0 when reset) — creases
   * for a `line-entity` tool, placed points for a `sequence` one — so the controller
   * can advance the step prompt in lock-step with them. Cumulative, not a delta.
   */
  onToolPickProgress: (picked: number) => void;
  /**
   * What the live point of a `sequence` tool has snapped onto, or null when it is
   * free. Taken from the resolve the step already does, so naming the snap costs no
   * extra geometry scan. The measure tool uses it to say whether an endpoint is a
   * real vertex or a point that merely looks like one.
   */
  onToolSnapKind: (kind: 'grid' | 'vertex' | 'point' | 'line' | null) => void;
  /**
   * Kernel-computed candidate geometry for the active sequence tool -- what the
   * tool *would create*. Stroked in {@link toolPreviewColor}.
   */
  toolCommandPreviewSegments: readonly ToolPreviewSegment[];
  /**
   * *Existing* creases the active sequence tool is snapping to or picking.
   * Stroked in the selection accent, not the crease colour: these are already in
   * the document and are being pointed at, not drawn. Kept apart from
   * {@link toolCommandPreviewSegments} because the two used to share one array
   * and therefore one colour, which meant whichever of the two was right made the
   * other wrong.
   */
  toolCommandHighlightSegments: readonly ToolPreviewSegment[];
  /**
   * Creases the active tool is previewing a *replacement* for, as 1-based ids.
   * The document stops drawing them so the preview stands alone rather than
   * lying on top of the crease it would change. Purely visual — they are still
   * there to click, select and draw over.
   */
  toolReplacedLineIds: readonly number[];
  /** Kernel-computed candidate *points* (Converging Lines ray intersections). */
  toolCommandPreviewPoints: readonly ModelPoint[];
  /** Colour of the in-progress candidate crease (the resolved active line colour). */
  toolPreviewColor: Rgba;
  /** Diagnostic overlay geometry (CAMV / check-fix): shape markers + segment highlights. */
  diagnosticMarkers: MarkerGeometry;
  diagnosticStrokes: StrokeGeometry;
  /** Big-little-big sector wedges (screen-scaled fills), or empty when none. */
  diagnosticWedges: WedgeGeometry;
  /** The Oriedita operation-frame outline (dashed closed loop), or null when inactive. */
  operationFrame: StrokeGeometry | null;
  /** Report the camera's current zoom percent (100% = fit) so the toolbar reflects it. */
  onZoomPercentChange: (percent: number) => void;
  /** Current view rotation in radians, so the toolbar can show and clear it. */
  onRotationChange: (radians: number) => void;
  /** Report the camera's model→CSS and user→CSS affines so DOM overlays can position to them. */
  onViewChange: (views: CpOverlayViews) => void;
  /**
   * The camera the document was saved at, adopted once per {@link framingKey}
   * in place of the auto-fit. Null (or absent) fits to content as before.
   */
  initialCamera?: UserCamera | null;
  /**
   * A view rotation (radians) the document names without a full camera — an
   * imported Oriedita file, which persists its own camera angle. Used as the
   * angle of the auto-fit, so the pattern is framed *and* turned the way its
   * author left it. Ignored when {@link initialCamera} is present, which already
   * carries a rotation.
   */
  initialRotation?: number | null;
  /**
   * Keep the active drag-box tool's box axis-aligned in *model* space (and
   * committing two diagonal corners) instead of upright on screen. Only the
   * operation frame needs this — see `tools/predicates.isModelAlignedBoxOperation`.
   */
  activeToolModelAlignedBox?: boolean;
  /**
   * Report the camera whenever it changes, so the document can persist the view.
   * Fires per frame only when a value actually moved; the consumer debounces.
   */
  onCameraChange?: (camera: UserCamera) => void;
  /**
   * Right-drag box erase (universal, overrides the active tool): delete every
   * crease inside the box given by its two opposite corners (model coords).
   */
  onEraseBox: (points: readonly ModelPoint[]) => void;
  /** Right-click erase: delete the 1-based crease id under the cursor. */
  onEraseLine: (id: number) => void;
  /**
   * Right-click erase on a circle ring: delete the 1-based circle id under the
   * cursor. Oriedita's right-click eraser runs in `BOTH_4`, the additional-input
   * mode that erases circles as well as creases.
   */
  onEraseCircle: (id: number) => void;
  /**
   * Open a context menu for what a right-*click* (press + release without a drag)
   * landed on. Right-*drag* remains the erase gesture and never calls this. The
   * canvas resolves the target; the panel decides what menu to show.
   */
  onRequestContextMenu: (request: CpContextMenuRequest) => void;
  /** Assignment colour mode. */
  mode: 'mvf' | 'agrh';
  /** Oriedita line style: how each crease colour is inked and dashed. */
  lineStyle: OristudioCpLineStyle;
  /** Which channel a non-180 crease spends on its fold angle. */
  foldAngleDisplay: OristudioCpFoldAngleDisplay;
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
  /**
   * Figures that no longer match the creases they were folded from. Drawn faded,
   * so an out-of-date figure looks out of date on the canvas rather than only in
   * the folded-models list.
   */
  staleFoldedFigureIds?: ReadonlySet<string>;
  /**
   * Figures drawn by the folded-figure window layer instead of by this canvas.
   *
   * A 3D figure that can be meshed becomes a DOM window over this surface — the
   * shared-canvas viewport an inline simulation already is — so drawing it here
   * as well would put two copies of the same model on top of each other. Only
   * the *drawing* is withheld: its content bounds and its pick box stay, because
   * a window takes no pointer events and the gestures still land here.
   */
  windowedFoldedFigureIds?: ReadonlySet<string>;
  /** Imported `.fold` folded-form frames as fills + strokes (user coords), or null. */
  importedForms: FoldedGeometry | null;
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
  geometry,
  images,
  overlayBoxes,
  framingKey,
  modelToSvg,
  svgToModel,
  foldedOrbit,
  selectedLineIds,
  selectedPointIds,
  selectedCircleIds,
  onSelect,
  onBoxSelect,
  onTranslateSelection,
  resolveMoveSnap,
  activeToolInputMode,
  activeToolOperationId,
  panToolActive,
  wheelGesture,
  activeToolStepKinds,
  activeToolCommitsLoneCandidate,
  snapRadius,
  onSnapDistanceChange,
  activeToolLineCount,
  activeToolRequireSnap,
  activeToolClickAction,
  activeToolDualMirror,
  activeToolMeasureCreasePick,
  activeToolConverging,
  activeToolSquareBisector,
  activeToolVoronoi,
  activeToolDashedPreview,
  activeToolTransform,
  onTextCreate,
  onTextCreateBox,
  voronoiSeeds,
  onVoronoiSeedsChange,
  resolveFirstPickKind,
  resolveDrawPoint,
  resolveDrawPointOnCrease,
  onToolCommit,
  onToolPreviewInput,
  onToolPickProgress,
  onToolSnapKind,
  toolCommandPreviewSegments,
  toolCommandHighlightSegments,
  toolReplacedLineIds,
  toolCommandPreviewPoints,
  toolPreviewColor,
  diagnosticMarkers,
  diagnosticStrokes,
  diagnosticWedges,
  operationFrame,
  onZoomPercentChange,
  onRotationChange,
  onViewChange,
  initialCamera,
  initialRotation,
  activeToolModelAlignedBox,
  onCameraChange,
  onEraseBox,
  onEraseLine,
  onEraseCircle,
  onRequestContextMenu,
  mode,
  lineStyle,
  foldAngleDisplay,
  lineWidth,
  points,
  vertices,
  pointSize,
  circles,
  circleRadiusToSvg,
  foldedFigures,
  staleFoldedFigureIds,
  windowedFoldedFigureIds,
  importedForms,
  grid,
  gridVisible,
}: CreasePatternWebglCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Drives the grab/grabbing cursor for every pan gesture — hand tool, middle
  // button, Cmd+drag. State rather than a direct style write, so a re-render
  // mid-drag cannot clobber it.
  const [panDragging, setPanDragging] = useState(false);
  /**
   * Where the pointer stands with respect to a focused 3D folded figure.
   *
   * Only the cursor reads this. It is deliberately about the **pointer** and not
   * about focus: keyed on focus alone, the whole canvas wore a grab cursor from
   * the moment a fold completed, advertising a turn everywhere except the one
   * place it worked.
   */
  const [foldedOrbitPointer, setFoldedOrbitPointer] = useState<'none' | 'over' | 'turning'>('none');
  const foldedOrbitPointerRef = useRef<'none' | 'over' | 'turning'>('none');
  // Cmd held offers a grab before the press, so the pan affordance is visible
  // rather than something you have to already know about.
  const panModifierHeld = usePanModifierHeld();
  const rendererRef = useRef<CpRenderer | null>(null);
  const renderNowRef = useRef<() => void>(() => {});
  // Late-bound `buildStrokes` so effects declared before it (the tool-reset
  // effect) can rebuild strokes; assigned once `buildStrokes` is defined.
  const buildStrokesRef = useRef<
    ((move?: CpTransformPreview, pickedLineIds?: readonly number[]) => StrokeGeometry) | null
  >(null);
  const buildPointsRef = useRef<((move?: CpTransformPreview) => PointGeometry) | null>(null);
  // In-progress crease transform (Move / Copy): which variant is previewing, and
  // for a copy the ghost buffer plus the selection it snapshotted. Refs, not state:
  // a gesture updates these every pointer move and must not re-render React.
  const transformActiveRef = useRef<'move' | 'copy' | null>(null);
  const transformGhostRef = useRef<CpTransformGhost | null>(null);
  const transformGhostIdsRef = useRef<ReadonlySet<number> | null>(null);
  // A committed copy leaves its ghost up until the document's own strokes arrive,
  // so the new creases never blink out during the async command round trip.
  const pendingGhostClearRef = useRef(false);

  // The preview channel has two writers. Drag tools push to it imperatively from
  // their feed handlers; the point-sequence effect below publishes the
  // controller's candidate segments declaratively. These two refs keep them from
  // treading on each other:
  //
  // - `toolPreviewSegmentsRef` remembers what a drag tool last drew *in the tool
  //   colour*, so holding Control mid-drag repaints it in the inverted colour
  //   immediately rather than waiting for the next pointer move. Null whenever
  //   the channel holds something with a colour of its own (an erase box, a
  //   transform ghost), which must never be repainted.
  // - `sequencePreviewOwnedRef` records whether the declarative effect is what
  //   put the current content there, so it only ever clears its own.
  const toolPreviewSegmentsRef = useRef<readonly ToolPreviewSegment[] | null>(null);
  const sequencePreviewOwnedRef = useRef(false);
  /** Which previewed candidate the cursor is nearest, or null. */
  const armedCandidateRef = useRef<number | null>(null);
  /** Repaint the sequence preview from the pointer path, without a re-render. */
  const paintSequencePreviewRef = useRef<(() => void) | null>(null);

  /**
   * Take the preview channel down and forget who owned it. Every clear goes
   * through here, so a later repaint can never resurrect content that has
   * already been taken down.
   */
  const clearPreview = useCallback(() => {
    toolPreviewSegmentsRef.current = null;
    sequencePreviewOwnedRef.current = false;
    rendererRef.current?.setPreview(null);
  }, []);

  // Drop an in-progress transform preview and put the surface back as it was.
  // Only the channel the gesture actually touched is restored: a move rebuilt the
  // real strokes and points, a copy only wrote to the preview channel.
  const clearTransformPreview = useCallback(() => {
    const renderer = rendererRef.current;
    const active = transformActiveRef.current;
    transformActiveRef.current = null;
    transformGhostRef.current = null;
    transformGhostIdsRef.current = null;
    if (!renderer || active === null) return;
    if (active === 'move') {
      const strokes = buildStrokesRef.current;
      const pts = buildPointsRef.current;
      if (strokes) renderer.setStrokes(strokes());
      if (pts) renderer.setPoints(pts());
    } else {
      clearPreview();
    }
  }, [clearPreview]);

  const gridKeyRef = useRef<string | null>(null);
  // Owned camera (Phase 2). Null until seeded from the SVG's current fit.
  const cameraRef = useRef<UserCamera | null>(null);
  // Bumped when the GL context is lost, to rebuild the renderer. The camera is
  // stashed across that rebuild so recovery does not also throw away wherever the
  // user had panned and zoomed to.
  const [rendererGeneration, setRendererGeneration] = useState(0);
  // Non-null once a WebGL2 context could not be created, which replaces the
  // (blank) canvas with an explanation. See `CpRendererUnavailable`.
  const [rendererError, setRendererError] = useState<string | null>(null);
  const preservedCameraRef = useRef<UserCamera | null>(null);
  // A saved camera armed by the framingKey effect, consumed by the first
  // `ensureCamera` after it. One-shot: once adopted, the user owns the camera,
  // so a later re-render must not drag the view back to where the file was saved.
  const pendingInitialCameraRef = useRef<UserCamera | null>(null);
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
  // Last view rotation reported to the panel (dedupes the per-frame report).
  const lastReportedRotationRef = useRef(0);
  // Last full camera reported to the panel (dedupes the per-frame report).
  const lastReportedCameraRef = useRef<UserCamera | null>(null);
  // Last zoom percent reported to the panel (dedupes the per-frame report).
  const lastReportedZoomRef = useRef<number | null>(null);
  const lastReportedSnapDistanceRef = useRef(Number.NaN);
  // Last model→CSS affine reported to the panel (for the text overlay), to dedupe.
  const lastReportedViewRef = useRef<CpOverlayViews | null>(null);
  // Square Bisector's dual-mode accumulator: `mode` is chosen on the first pick
  // ('point' → collect 3 points then a destination; 'line' → collect 2 source crease
  // ids then a destination id). Null mode means the gesture hasn't started.
  const squareBisectorRef = useRef<{
    mode: 'point' | 'line' | null;
    points: ModelPoint[];
    lineIds: number[];
  }>({ mode: null, points: [], lineIds: [] });
  // Creases picked so far by a `line-entity` tool. Rendered in the selection style
  // so a picked line "shows up as selected" until commit — parity with the SVG's
  // persistent `highlightedLineIds`. Read by `buildStrokes`.
  const linePickHighlightRef = useRef<readonly number[]>([]);
  // Lengthen's two-gesture state: `select` draws the selection line (points a→b) the
  // kernel intersects to pick creases; `extend` then clicks the target line. `a`/`b`
  // hold the finalized selection line across the phase change.
  const lengthenRef = useRef<{
    phase: 'select' | 'extend';
    a: ModelPoint | null;
    b: ModelPoint | null;
  }>({ phase: 'select', a: null, b: null });
  // Persistent runtime for a crease-draw tool — `drag-line` and Angle Restricted
  // Line both run `dragLineTool` (see `toolModeSnapsDrawPoint`). Unlike the box/path
  // engines — whose whole gesture lives between one press and its release — this one
  // has to survive between gestures, because a click-to-place draw parks its start
  // endpoint there while the user moves to the second click. Cleared on a tool change
  // below.
  const armedDrawRuntimeRef = useRef<ToolRuntime | null>(null);
  // Mirror of that runtime's armed start (from its `livePoints`), so the surface can
  // mark it, gate presses on it, and drive the step prompt without re-deriving the
  // engine's arming rule. Null whenever no start is parked.
  const armedDrawPointRef = useRef<ModelPoint | null>(null);
  const currentTheme = useThemeStore((state) => state.currentTheme);

  // A tool change abandons any in-progress click sequence and its overlay.
  useEffect(() => {
    persistentToolRuntimeRef.current = null;
    sequenceStepRef.current = 0;
    armedDrawRuntimeRef.current = null;
    armedDrawPointRef.current = null;
    dynamicStepKindsRef.current = null;
    convergingBaseRef.current = [];
    squareBisectorRef.current = { mode: null, points: [], lineIds: [] };
    linePickHighlightRef.current = [];
    lengthenRef.current = { phase: 'select', a: null, b: null };
    rendererRef.current?.setOverlayPoints(null);
    // Drops a drag-line's armed rubber band along with its parked start.
    clearPreview();
    clearTransformPreview();
    const rebuild = buildStrokesRef.current;
    if (rebuild) rendererRef.current?.setStrokes(rebuild());
    renderNowRef.current();
  }, [
    activeToolInputMode,
    activeToolOperationId,
    activeToolStepKinds,
    activeToolLineCount,
    activeToolDualMirror,
    activeToolMeasureCreasePick,
    activeToolConverging,
    activeToolSquareBisector,
    activeToolTransform,
    clearTransformPreview,
    clearPreview,
  ]);

  // The distance between neighbouring vertices, in model units — vertices are
  // crease endpoints, so the median crease length measures it directly. This is
  // the reference for sizing vertex dots: it is what "the dots are crowding the
  // pattern" actually means, and it is unaffected by how far apart several
  // patterns sit on one sheet.
  //
  // Oriedita's grid pitch (`ORIEDITA_PAPER_SIZE / grid_size`) is the tempting
  // choice here, being declared by the document rather than measured. It does
  // not survive contact with real files: a crease pattern drawn at a scale where
  // one pattern spans thousands of units has creases several grid cells long
  // (iguana_19.osf: 25-unit grid, 71-unit median crease), so the grid says
  // "crowded" while the vertices have ample room. It is kept only as the
  // fallback for a document with no creases to measure.
  // Sampled rather than exhaustive: this runs again whenever the geometry
  // changes, and sorting every length costs ~17ms on a 52k-edge document —
  // a dropped frame per edit. A strided sample bounds it to a fixed ~0.1ms and
  // is not an approximation worth worrying about: on a real 7.4k-edge pattern
  // even a 512-sample stride reproduces the exhaustive median exactly.
  const vertexSpacingModel = useMemo(() => {
    const stride = Math.max(1, Math.ceil(lineSegments.length / VERTEX_SPACING_SAMPLE_CAP));
    const lengths: number[] = [];
    for (let i = 0; i < lineSegments.length; i += stride) {
      const seg = lineSegments[i];
      const length = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
      if (length > 1e-9) lengths.push(length);
    }
    if (lengths.length === 0) return grid ? getOrieditaGridBasis(grid).gridWidth : 0;
    lengths.sort((a, b) => a - b);
    return lengths[lengths.length >> 1];
  }, [lineSegments, grid]);

  // Content bounds in SVG user coords, for the initial camera fit (independent
  // of the SVG's own fixed-rect fit, which mis-centres imported cameras).
  const contentBounds = useMemo<UserBounds | null>(
    () => cpContentBounds({ lineSegments, images, overlayBoxes, foldedFigures, modelToSvg }),
    [lineSegments, images, overlayBoxes, foldedFigures, modelToSvg],
  );

  // Spatial indices for click hit-testing. Points are indexed as zero-length
  // segments so the same distance query applies (id = index + 1). Vertices are
  // derived and not selectable, so they get no index.
  const hitIndex = useMemo(
    () => new LineHitIndex(lineSegments.map((s, i) => ({ id: i + 1, a: s.a, b: s.b }))),
    [lineSegments],
  );
  const pointIndex = useMemo(
    () => new LineHitIndex(points.map((p, i) => ({ id: i + 1, a: p, b: p }))),
    [points],
  );
  // Folded-figure pick boxes (SVG user coords) for cmd-drag move, in draw order.
  const foldedBounds = useMemo<FoldedFigureBounds[]>(
    () => foldedFigureUserBounds(foldedFigures),
    [foldedFigures],
  );
  // Selected line ids as a set, for "is the press on a selected line" (move-drag).
  const selectedLineSet = useMemo(() => new Set(selectedLineIds), [selectedLineIds]);
  const replacedLineSet = useMemo(
    () => (toolReplacedLineIds.length > 0 ? new Set(toolReplacedLineIds) : undefined),
    [toolReplacedLineIds],
  );
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
    (move?: CpTransformPreview, pickedLineIds?: readonly number[]): StrokeGeometry => {
      // Lines picked by an in-progress line-entity tool render in the selection
      // style too, so a picked crease reads as "selected". The picked set is passed
      // in by the imperative caller (event handler) — never read from a ref here,
      // so this stays safe to call from the render path.
      const selected =
        pickedLineIds && pickedLineIds.length
          ? new Set([...selectedLineSet, ...pickedLineIds])
          : selectedLineSet;
      const appearanceFor = createCpLineAppearanceResolver(
        lineStyle,
        mode,
        document.documentElement,
      );
      const dashPatterns = cpLineStyleDashPatterns(lineStyle);
      const selection = {
        selected,
        color: readCssVarColor(document.documentElement, SELECTION_COLOR_VAR, SELECTION_FALLBACK),
        widthMul: SELECTION_WIDTH_MUL,
      };
      // Build strokes from the compact transport (typed arrays) — the default hot
      // path. The two builders are byte-identical (guarded by the parity gate), so
      // the structured fallback below is only for the rare state that carries no
      // geometry (e.g. a fixture); it never runs on a real edit.
      // The anchor is only read by the `color` mode, but resolving it
      // unconditionally keeps the two modes symmetric at the call site — the
      // builders take one fold-angle value either way.
      const foldAngle = {
        display: foldAngleDisplay,
        anchor: readCssVarColor(
          document.documentElement,
          FOLD_ANGLE_ANCHOR_VAR,
          FOLD_ANGLE_ANCHOR_FALLBACK,
        ),
      };
      const replaced = replacedLineSet;
      if (geometry) {
        return cpGeometryStrokesToScene(
          geometry,
          appearanceFor,
          dashPatterns,
          selection,
          move,
          foldAngle,
          replaced,
        ).strokes;
      }
      return cpSnapshotToScene(
        lineSegments,
        appearanceFor,
        dashPatterns,
        selection,
        move,
        foldAngle,
        replaced,
      ).strokes;
    },
    // currentTheme drives DOM-resolved colours; rebuild callers on theme change.
    // foldAngleDisplay belongs here for the same reason lineStyle does: leave it
    // out and switching the View panel's dropdown does nothing until some
    // unrelated edit happens to invalidate this callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      lineSegments,
      geometry,
      mode,
      lineStyle,
      foldAngleDisplay,
      selectedLineSet,
      replacedLineSet,
      currentTheme,
    ],
  );
  useEffect(() => {
    buildStrokesRef.current = buildStrokes;
  }, [buildStrokes]);

  // Build the point buffer (crease points, derived vertices, circles). During a
  // move-drag or transform gesture the derived vertices of the moved lines follow
  // through `move.matrix`; real points and circles do not move, matching the kernel
  // ops, which transform line segments only.
  const buildPoints = useCallback(
    (move?: CpTransformPreview): PointGeometry => {
      const movedVertices =
        move === undefined
          ? vertices
          : vertices.map((v) =>
              selectedEndpointKeys.has(cpVertexId(v)) ? applyAffine(move.matrix, v.x, v.y) : v,
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
        },
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
    ],
  );
  useEffect(() => {
    buildPointsRef.current = buildPoints;
  }, [buildPoints]);

  // Snapshot the selected creases for a copy gesture's ghost. Each keeps its own
  // M/V appearance (as Oriedita's transform preview draws them, through the same
  // `drawCpLine` the crease pattern uses) at a reduced alpha, so the prospective
  // geometry reads as new rather than as more selection.
  const createSelectionGhost = useCallback(
    (ids: ReadonlySet<number>): CpTransformGhost | null => {
      const appearanceFor = createCpLineAppearanceResolver(
        lineStyle,
        mode,
        document.documentElement,
      );
      const style = { alpha: GHOST_ALPHA, widthMul: SELECTION_WIDTH_MUL };
      const base = geometry
        ? ghostBaseFromGeometry(geometry, ids, appearanceFor, style)
        : ghostBaseFromSegments(lineSegments, ids, appearanceFor, style);
      return createTransformGhost(base, style, cpLineStyleDashPatterns(lineStyle));
    },
    // currentTheme drives DOM-resolved colours; rebuild on theme change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometry, lineSegments, mode, lineStyle, currentTheme],
  );

  // Per-frame / per-interaction inputs the effect reads without re-subscribing.
  const live = {
    modelToSvg,
    svgToModel,
    foldedOrbit,
    lineWidth,
    grid,
    gridVisible,
    contentBounds,
    vertexSpacingModel,
    pointSize,
    hitIndex,
    pointIndex,
    lineSegments,
    points,
    vertices,
    circles,
    circleRadiusToSvg,
    foldedFigures,
    foldedBounds,
    selectedLineSet,
    buildStrokes,
    buildPoints,
    onSelect,
    onBoxSelect,
    onTranslateSelection,
    resolveMoveSnap,
    activeToolInputMode,
    panToolActive,
    wheelGesture,
    activeToolStepKinds,
    activeToolCommitsLoneCandidate,
    snapRadius,
    onSnapDistanceChange,
    activeToolLineCount,
    activeToolRequireSnap,
    activeToolClickAction,
    activeToolDualMirror,
    activeToolMeasureCreasePick,
    activeToolConverging,
    activeToolSquareBisector,
    activeToolVoronoi,
    activeToolTransform,
    createSelectionGhost,
    clearTransformPreview,
    onTextCreate,
    onTextCreateBox,
    voronoiSeeds,
    onVoronoiSeedsChange,
    resolveFirstPickKind,
    resolveDrawPoint,
    resolveDrawPointOnCrease,
    onToolCommit,
    onToolPreviewInput,
    onToolPickProgress,
    onToolSnapKind,
    toolPreviewColor,
    toolCommandPreviewSegments,
    toolCommandHighlightSegments,
    toolCommandPreviewPoints,
    onZoomPercentChange,
    onRotationChange,
    onViewChange,
    initialCamera,
    initialRotation,
    activeToolModelAlignedBox,
    onCameraChange,
    onEraseBox,
    onEraseLine,
    onEraseCircle,
    onRequestContextMenu,
  };
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
    // Inputs affecting stroke thickness / mapping changed — redraw.
    renderNowRef.current();
  });

  // Resolve a lone candidate the moment the kernel preview reports it, rather than
  // on the next click. The step prompt is driven by the picks reported here, so
  // deferring this told the user to "select flat foldable line" while the click that
  // followed was already being read as the destination — and a click on the one ray
  // on screen, the thing the prompt named, is exactly what the destination step
  // cannot accept.
  /**
   * Resolve a candidate step that has exactly one option, feeding it as the pick.
   *
   * Called from two places on purpose: from the pointer path the instant the step
   * is reached (the candidates are already on screen, so nothing needs to arrive),
   * and from the effect below for the tools whose candidates only appear once the
   * kernel answers. Returns whether it acted.
   */
  const tryLoneCandidateAutoPick = useCallback((runtime: ToolRuntime): boolean => {
    const stepKinds = dynamicStepKindsRef.current ?? liveRef.current.activeToolStepKinds;
    const auto = loneCandidateAutoPick(
      stepKinds,
      sequenceStepRef.current,
      liveRef.current.toolCommandPreviewSegments,
      liveRef.current.activeToolCommitsLoneCandidate,
    );
    if (!auto) return false;
    const out = runtime.feed({ kind: 'down', point: auto });
    if (out.commit) {
      liveRef.current.onToolCommit(out.commit);
      liveRef.current.onToolPreviewInput([], []);
      sequenceStepRef.current = 0;
      dynamicStepKindsRef.current = null;
      armedCandidateRef.current = null;
      liveRef.current.onToolPickProgress(0);
      return true;
    }
    sequenceStepRef.current += 1;
    liveRef.current.onToolPickProgress(sequenceStepRef.current);
    return true;
  }, []);

  useEffect(() => {
    const runtime = persistentToolRuntimeRef.current;
    if (!runtime) return;
    tryLoneCandidateAutoPick(runtime);
  }, [tryLoneCandidateAutoPick, toolCommandPreviewSegments]);

  // A new document: drop the one-shot camera seed so the next frame re-fits
  // against the current bounds (creases + images + text boxes). Declared after
  // the liveRef effect so `contentBounds` is already up to date when it re-fits.
  //
  // A document that carries its own saved camera arms it here instead, and
  // `ensureCamera` adopts it in place of the fit. Arming rather than assigning
  // keeps the seed lazy: before the first draw there is no viewport to fit
  // against, and this effect is the one place that knows the document changed.
  useEffect(() => {
    cameraRef.current = null;
    pendingInitialCameraRef.current = liveRef.current.initialCamera ?? null;
    renderNowRef.current();
  }, [framingKey]);

  // Force a grid rebuild when its params, visibility, or theme colour change.
  useEffect(() => {
    gridKeyRef.current = null;
    renderNowRef.current();
  }, [grid, gridVisible, currentTheme]);

  // Build GPU-ready geometry whenever the segments or mode change. `currentTheme`
  // is an intentional trigger: colours are resolved from theme CSS variables, so
  // the scene must be rebuilt when the theme switches even though its value is
  // not read directly here.
  //
  // Creases, points and folded figures are memoized apart, and uploaded through
  // the renderer's three channels rather than as one scene. Merged, a 3D figure
  // being turned rebuilt every crease in the document on every pointer move,
  // because the merged memo could not tell which of its three inputs had
  // changed.
  const strokeGeometry = useMemo(() => buildStrokes(), [buildStrokes]);
  const pointGeometry = useMemo(() => buildPoints(), [buildPoints]);
  // The figures as drawn: the store's entries, with any figure the user is
  // currently turning swapped for its live orbit frame. See
  // `folded/folded3dRuntime.ts` for why the live camera is not in the store.
  const sceneFoldedFigures = useMemo(
    () =>
      windowedFoldedFigureIds && windowedFoldedFigureIds.size > 0
        ? foldedFigures.filter((figure) => !windowedFoldedFigureIds.has(figure.id))
        : foldedFigures,
    [foldedFigures, windowedFoldedFigureIds],
  );
  const drawnFoldedFigures = useFolded3dOrbitFigures(sceneFoldedFigures);
  const foldedGeometry = useMemo(
    () =>
      cpFoldedToScene(drawnFoldedFigures, (figure) =>
        staleFoldedFigureIds?.has(figure.id) ? STALE_FOLDED_FIGURE_OPACITY : 1,
      ),
    [drawnFoldedFigures, staleFoldedFigureIds],
  );

  // Red fill for the two faces of any folded figure whose fold hit a global
  // layer-ordering contradiction (Oriedita drawSelfIntersectingSubFaces). Model
  // space, so it rides the renderer's diagnostic-fill layer.
  const contradictionFaceFills = useMemo(
    () => cpContradictionFaceFills(foldedFigures),
    [foldedFigures],
  );

  // Renderer lifecycle + render loop. Re-runs only when the GL context is lost
  // and a replacement renderer has to be built (see `rendererGeneration`).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: CpRenderer;
    try {
      renderer = createReglRenderer(canvas, {
        // Redraw once an async image texture finishes decoding.
        onAsyncLoad: () => renderNowRef.current(),
        // The context and every regl resource on it are gone. Nothing here can
        // repair that, so keep the camera the user was working at and rebuild
        // the whole renderer from scratch on the next tick.
        onContextLost: () => {
          console.warn('[cp-webgl] WebGL context lost; rebuilding the renderer');
          preservedCameraRef.current = cameraRef.current;
          setRendererGeneration((generation) => generation + 1);
        },
      });
    } catch (error) {
      // Surfaced, not logged. A packaged desktop build has no console anyone
      // reads, so the old console.error left this as a silently blank editor —
      // which is exactly what WebKitGTK produces with no usable WebGL2.
      reportError(error, { surface: 'cp-workspace:webgl' });
      setRendererError(error instanceof Error ? error.message : String(error));
      return;
    }
    // A rebuild after context loss succeeded, so clear any earlier failure.
    setRendererError(null);
    rendererRef.current = renderer;

    const viewportOf = (ratio: number): Viewport => ({
      width: canvas.width,
      height: canvas.height,
      dpr: ratio,
    });

    // Seed the owned camera once by fitting the geometry bounds. An editable CP always
    // carries its paper boundary, so `contentBounds` is present; when it isn't (no
    // geometry yet) the camera stays unseeded and nothing draws until geometry arrives.
    const ensureCamera = (viewport: Viewport): UserCamera | null => {
      if (cameraRef.current) return cameraRef.current;
      // Recovering from context loss: adopt the camera the dead renderer had,
      // so the surface comes back where the user left it instead of re-fitting.
      if (preservedCameraRef.current) {
        cameraRef.current = preservedCameraRef.current;
        preservedCameraRef.current = null;
        return cameraRef.current;
      }
      // The document brought its own view. Adopted before the bounds check on
      // purpose: a saved camera needs no content to fit against, so this also
      // gets the view right on the first frame of a document whose geometry
      // has not been measured yet.
      const saved = pendingInitialCameraRef.current;
      if (saved) {
        pendingInitialCameraRef.current = null;
        cameraRef.current = { ...saved };
        return cameraRef.current;
      }
      const bounds = liveRef.current.contentBounds;
      if (!bounds) return null;
      // No saved camera, but the document may still name the angle it was
      // authored at (an imported Oriedita file's own camera). Fit at that
      // rotation rather than square — `fitUserCamera` measures the bounds along
      // the rotated screen axes, so the pattern still fills the viewport.
      cameraRef.current = fitUserCamera(
        bounds,
        viewport,
        undefined,
        liveRef.current.initialRotation ?? 0,
      );
      return cameraRef.current;
    };

    const renderNow = () => {
      const ratio = dpr();
      const viewport = viewportOf(ratio);
      const cam = ensureCamera(viewport);
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
              cpGridLinesToStrokes(lines, [color[0], color[1], color[2], GRID_COLOR_ALPHA]),
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
      // Deliberately the *unrotated* fit: this is only a reference scale for
      // stroke/marker sizing, so passing `cam.rotation` here would make line
      // weight breathe as the view turns.
      const fitZoom = bounds ? fitUserCamera(bounds, viewport).zoom : cam.zoom;
      const zoomRatio = cam.zoom / fitZoom;
      const widthBoost = Math.pow(Math.max(zoomRatio, 1), WIDTH_ZOOM_EXPONENT);
      const markerShrink = zoomRatio < 1 ? Math.pow(zoomRatio, MARKER_SHRINK_EXPONENT) : 1;
      const markerScalePx = ratio * widthBoost * markerShrink;
      const vertexShrink = zoomRatio < 1 ? Math.pow(zoomRatio, VERTEX_SHRINK_EXPONENT) : 1;
      const pointScalePx = ratio * widthBoost * vertexShrink;
      // How much of the on-screen gap between neighbouring vertices a dot eats
      // up. Both terms are CSS px, so this is a pure ratio: independent of
      // display density, of the document's coordinate scale, and of how far
      // apart several patterns happen to sit on one sheet. `view.ex` is the
      // model->device basis, so its length is device px per model unit.
      const vertexDiameterCss = 2 * VERTEX_RADIUS_FACTOR * liveRef.current.pointSize;
      const modelPxPerUnit = Math.hypot(view.ex[0], view.ex[1]);
      const spacingCss = (liveRef.current.vertexSpacingModel * modelPxPerUnit) / ratio;
      const crowding = spacingCss > 1e-6 ? vertexDiameterCss / spacingCss : 0;
      const pointOpacity = 1 - smoothstep(VERTEX_CROWD_FULL_AT, VERTEX_CROWD_GONE_AT, crowding);
      const pointRingScale = 1 - smoothstep(VERTEX_RING_FULL_AT, VERTEX_RING_GONE_AT, crowding);

      // Report the zoom percent so the viewport toolbar reflects the owned camera.
      // 100% = actual size (1 user unit == 1 CSS px, i.e. zoom == dpr), matching the
      // SVG transform's scale; deduped so it only fires when the value changes.
      const zoomPercent = Math.round((cam.zoom / ratio) * 100);
      if (zoomPercent !== lastReportedZoomRef.current) {
        lastReportedZoomRef.current = zoomPercent;
        liveRef.current.onZoomPercentChange(zoomPercent);
      }

      // The panel builds command payloads from this, so it must be the exact
      // radius this surface snapped with rather than a re-derivation from the
      // rounded percent above. Every prop change re-runs the render effect, so a
      // change to the setting republishes without its own listener.
      const snapDistance = cpKernelSnapRadiusModel(liveRef.current.snapRadius, cam.zoom / ratio);
      if (snapDistance !== lastReportedSnapDistanceRef.current) {
        lastReportedSnapDistanceRef.current = snapDistance;
        liveRef.current.onSnapDistanceChange(snapDistance);
      }

      if (cam.rotation !== lastReportedRotationRef.current) {
        lastReportedRotationRef.current = cam.rotation;
        liveRef.current.onRotationChange(cam.rotation);
      }

      // Report the whole camera so the document can persist the view. Deduped
      // by value: a pan/zoom/rotate frame reports, a redraw for any other reason
      // does not. The consumer debounces to a settle.
      const lastCamera = lastReportedCameraRef.current;
      if (!lastCamera || !userCamerasEqual(lastCamera, cam)) {
        lastReportedCameraRef.current = { ...cam };
        liveRef.current.onCameraChange?.({ ...cam });
      }

      // Report the model→CSS affine (device view / dpr) for DOM overlays to project
      // against; deduped so it only fires when the camera actually moved.
      // Both spaces are reported: annotations place through `model`, folded
      // figures through `user` (the space their render primitives land in).
      const toCss = (v: ViewTransform): CpOverlayView => ({
        origin: [v.origin[0] / ratio, v.origin[1] / ratio],
        ex: [v.ex[0] / ratio, v.ex[1] / ratio],
        ey: [v.ey[0] / ratio, v.ey[1] / ratio],
      });
      const cssViews: CpOverlayViews = { model: toCss(view), user: toCss(userView) };
      const prev = lastReportedViewRef.current;
      const sameView = (a: CpOverlayView, b: CpOverlayView) =>
        a.origin[0] === b.origin[0] &&
        a.origin[1] === b.origin[1] &&
        a.ex[0] === b.ex[0] &&
        a.ex[1] === b.ex[1] &&
        a.ey[0] === b.ey[0] &&
        a.ey[1] === b.ey[1];
      if (!prev || !sameView(prev.model, cssViews.model) || !sameView(prev.user, cssViews.user)) {
        lastReportedViewRef.current = cssViews;
        liveRef.current.onViewChange(cssViews);
      }

      renderer.render({
        clearColor: readCssVarColor(canvas, CANVAS_BG_VAR, FALLBACK_CLEAR),
        view,
        userView,
        // Constant screen size (CSS px * dpr) times the gentle zoom boost. Circle
        // radii still scale fully with zoom via userScalePx — real geometry.
        strokeWidthPx: CREASE_WIDTH_FACTOR * liveRef.current.lineWidth * ratio * widthBoost,
        userScalePx: cam.zoom,
        markerScalePx,
        pointScalePx,
        // Outlines ride the scale of whatever they outline, so a shrinking dot
        // does not keep a full-width ring and bottom out at a constant size.
        constantOutlinePx: POINT_OUTLINE_CSS * ratio,
        markerOutlinePx: POINT_OUTLINE_CSS * markerScalePx,
        pointOutlinePx: POINT_OUTLINE_CSS * pointScalePx * pointRingScale,
        pointOpacity,
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
        (clientY - rect.top) * ratio,
      );
    };
    const clientToModel = (clientX: number, clientY: number): ModelPoint | null => {
      const userPt = clientToUser(clientX, clientY);
      return userPt ? liveRef.current.svgToModel(userPt) : null;
    };

    /**
     * The user-space point a press should orbit at, or null if it should not.
     *
     * User space rather than model space because that is where a folded
     * figure's transformable box lives, and the box consulted is the same one
     * the overlay made inert — deriving a second notion of "inside the figure"
     * here is how the two would drift into a band that neither moves nor turns.
     */
    // Set from a pointer handler, so it must not re-render per move: the state
    // changes only when the pointer crosses the figure's edge, which is rare.
    const setOrbitPointer = (next: 'none' | 'over' | 'turning') => {
      if (foldedOrbitPointerRef.current === next) return;
      foldedOrbitPointerRef.current = next;
      setFoldedOrbitPointer(next);
    };

    /**
     * Whether a press here turns the focused figure.
     *
     * Answered in user space and returning only a verdict, because the point the
     * drag is then measured in is the client one — see `foldedOrbit.begin`. This
     * used to hand its user point straight on as the drag anchor, which is how
     * the turn rate came to depend on the crease-pattern zoom.
     */
    const orbitClaimsPressAt = (clientX: number, clientY: number): boolean => {
      const orbit = liveRef.current.foldedOrbit;
      if (!orbit) return false;
      const user = clientToUser(clientX, clientY);
      return user != null && orbit.claimsPress(user);
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
        modelViewFromCamera(cam, viewportOf(dpr()), liveRef.current.modelToSvg),
      );
      return (cssTol * dpr()) / Math.max(1e-6, scale);
    };

    /** Live zoom in the toolbar's terms: CSS px per SVG user unit. */
    const zoomOf = (): number => {
      const cam = cameraRef.current;
      return cam ? cam.zoom / dpr() : 1;
    };
    /**
     * The three radii, one law scaled by its ratios — see `snapRadius.ts`. They
     * were independent CSS-px constants (10 / 8 / 6) until the radius became a
     * user setting and they had to move together.
     */
    const snapTolerance = (): number =>
      cpSnapRadiusModel(liveRef.current.snapRadius, zoomOf(), CP_SNAP_RATIO);
    // Hit radii never tighten below pointer precision — see `cpHitRadiusModel`.
    const lineHitTolerance = (): number =>
      cpHitRadiusModel(
        liveRef.current.snapRadius,
        zoomOf(),
        CP_LINE_HIT_RATIO,
        CP_LINE_HIT_MIN_CSS,
      );
    const pointHitTolerance = (): number =>
      cpHitRadiusModel(
        liveRef.current.snapRadius,
        zoomOf(),
        CP_POINT_HIT_RATIO,
        CP_POINT_HIT_MIN_CSS,
      );
    /**
     * What the kernel will search. Bounded by the setting, unlike the on-screen
     * radius, so a `crease-required` step gates on the kernel's own number.
     */
    const kernelSnapTolerance = (): number =>
      cpKernelSnapRadiusModel(liveRef.current.snapRadius, zoomOf());

    // The id of the diagnostic marker under a model point, if any (nearest within a
    // screen-constant radius). Markers are screen-sized, so the tolerance is CSS px.
    // Pick the primitive under the cursor. Points win only on a tight radius
    // (small precise targets) so a click near one still lets you grab the crease;
    // circles match near their ring. Vertices are derived and not pickable.
    const hitTest = (clientX: number, clientY: number): CpSelectHit | null => {
      const m = clientToModel(clientX, clientY);
      if (!m) return null;
      const l = liveRef.current;
      const ptTol = pointHitTolerance();
      const lineTol = lineHitTolerance();

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

    // Erase whatever a click landed on. Creases and circles are both erasable;
    // points are not, matching Oriedita's `deleteSingleLineOrCircle`.
    const eraseHit = (hit: CpSelectHit | null) => {
      if (hit?.kind === 'line') liveRef.current.onEraseLine(hit.id);
      else if (hit?.kind === 'circle') liveRef.current.onEraseCircle(hit.id);
    };

    // Transient marquee rectangle rendered as a plain DOM overlay.
    const marquee = document.createElement('div');
    marquee.className = 'cp-webgl-marquee';
    marquee.style.display = 'none';
    canvas.parentElement?.appendChild(marquee);

    /** The live model→device transform, or null before the camera is seeded. */
    const currentView = (): ViewTransform | null => {
      const cam = cameraRef.current;
      if (!cam) return null;
      return modelViewFromCamera(cam, viewportOf(dpr()), liveRef.current.modelToSvg);
    };

    /**
     * The drag's box in model space, axis-aligned *on screen* — a rotated
     * quadrilateral in model space whenever the view is turned.
     *
     * This is Oriedita's construction: `BoxSelectStepNode` builds the four
     * corners in screen coordinates and maps each through `Camera.TV2object`.
     * The kernel takes all four unchanged, since `required_selection_polygon`
     * reads three or more points as a polygon verbatim.
     */
    const dragBoxCorners = (clientX: number, clientY: number): BoxCorners | null => {
      const p1 = clientToModel(pressX, pressY);
      const p2 = clientToModel(clientX, clientY);
      if (!p1 || !p2) return null;
      return viewAlignedBoxCorners(p1, p2, currentView());
    };

    const updateMarquee = (clientX: number, clientY: number) => {
      const parent = canvas.parentElement?.getBoundingClientRect();
      if (!parent) return;
      // The box is upright on screen by construction, so the outline is the plain
      // client-space rect between press and cursor — no projection, no rotation.
      marquee.style.display = 'block';
      marquee.style.left = `${Math.min(pressX, clientX) - parent.left}px`;
      marquee.style.top = `${Math.min(pressY, clientY) - parent.top}px`;
      marquee.style.width = `${Math.abs(clientX - pressX)}px`;
      marquee.style.height = `${Math.abs(clientY - pressY)}px`;
    };
    const boxSelect = (clientX: number, clientY: number, additive: boolean) => {
      const quad = dragBoxCorners(clientX, clientY);
      if (!quad) return;
      const l = liveRef.current;
      const sets: CpBoxSelection = { lines: [], points: [], circles: [] };
      // Crossing marquee for lines/circle-rings; enclosed centres for points.
      // Vertices are derived, not selectable.
      l.lineSegments.forEach((s, i) => {
        if (segmentIntersectsConvexQuad(s.a, s.b, quad)) sets.lines.push(i + 1);
      });
      l.points.forEach((p, i) => {
        if (pointInConvexQuad(p, quad)) sets.points.push(i + 1);
      });
      l.circles.forEach((c, i) => {
        if (circleRingIntersectsConvexQuad(c.x, c.y, c.r, quad)) sets.circles.push(i + 1);
      });
      l.onBoxSelect(sets, additive);
    };

    let panning = false;
    let selecting = false;
    let moved = false;
    // Text tool: true only when THIS press started on the canvas (empty space).
    // A press that began on the DOM overlay (a label, or the dismiss backdrop that
    // closes an open editor) never runs the canvas' pointerdown, so this stays false
    // and the release must not create a text — otherwise clicking away from an editor
    // (which removes the backdrop mid-gesture) would spawn a stray box.
    let textPressStarted = false;
    // Active draw-tool drag: a runtime wrapping the active input mode's pure
    // engine, created on pointer-down and driven by feedTool.
    let drawing = false;
    // Shift held when the current drag began, for additive box selection. Shift
    // alone, matching the click and box select paths below — and leaving Ctrl
    // free to mean crease-colour inversion, its meaning upstream.
    let dragShift = false;
    let toolRuntime: ToolRuntime | null = null;
    /**
     * Where to ring the draw point: the snapped position when it actually moved off
     * the cursor, else null (nothing in range, so nothing to indicate).
     */
    const snapRingFor = (point: ModelPoint, raw: ModelPoint): ModelPoint | null =>
      point.x !== raw.x || point.y !== raw.y ? point : null;
    /**
     * Where to ring an endpoint the *kernel* resolves (Angle Restricted Line):
     * the point it reports back, which it publishes only when the endpoint
     * really landed on a vertex or grid point rather than on the bare
     * angle-system projection. Ringing the cursor's nearest snap target instead
     * would promise a snap the angle constraint may refuse. It trails the
     * cursor by one preview round-trip, in step with the preview line itself.
     */
    const kernelSnapRing = (): ModelPoint | null =>
      liveRef.current.toolCommandPreviewPoints[0] ?? null;
    /**
     * The runtime driving the current draw. A crease-draw tool keeps one for its whole
     * activation — its click-to-place start is parked in the engine between gestures —
     * created here on first use; box/path tools get a fresh one per press. Both draw
     * modes run the same `drag-line` engine; what differs is where their preview and
     * commit endpoint come from, which `feedTool` handles.
     */
    const drawRuntime = (): ToolRuntime | null => {
      if (!toolModeSnapsDrawPoint(liveRef.current.activeToolInputMode)) return toolRuntime;
      armedDrawRuntimeRef.current ??= createToolRuntime(toolEngineFor('drag-line'));
      return armedDrawRuntimeRef.current;
    };
    /**
     * Mark the draw's armed start (a dot, like a half-placed point sequence) plus the
     * usual snap ring, and keep the step prompt on the endpoint the tool is now
     * waiting for. `livePoints` is the engine's own report of what it has parked, so
     * the arming rule lives in exactly one place.
     */
    const syncArmedDrawPoint = (
      livePoints: readonly ModelPoint[] | undefined,
      snapRing: ModelPoint | null,
      /**
       * Dots to draw, when they are not just the armed start: Angle Restricted Line
       * marks its anchor for the whole drag, as upstream's `drawStepVertex(anchorPoint)`
       * does. Arming and the step prompt still key off `livePoints` alone — an anchor
       * being *dragged* from is not a parked one.
       */
      placed: readonly ModelPoint[] = livePoints ?? [],
    ) => {
      const armed = livePoints?.[0] ?? null;
      const was = armedDrawPointRef.current;
      armedDrawPointRef.current = armed;
      renderer.setOverlayPoints(
        sequenceOverlayPoints(
          placed,
          snapRing,
          readCssVarColor(document.documentElement, SELECTION_COLOR_VAR, SELECTION_FALLBACK),
        ),
      );
      if (!!armed !== !!was) liveRef.current.onToolPickProgress(armed ? 1 : 0);
    };
    // Publish tool-coloured segments to the preview channel and remember them, so
    // a colour change mid-gesture can repaint without a pointer event. Every
    // writer that draws in `toolPreviewColor` goes through here; writers with a
    // colour of their own (erase, transform ghost) call `takePreviewChannel`.
    const setToolPreview = (segments: readonly ToolPreviewSegment[] | null | undefined) => {
      const live = segments && segments.length > 0 ? segments : null;
      toolPreviewSegmentsRef.current = live;
      sequencePreviewOwnedRef.current = false;
      renderer.setPreview(
        live ? previewSegmentsToStrokes(live, liveRef.current.toolPreviewColor) : null,
      );
    };
    // Claim the preview channel for content that owns its colours.
    const takePreviewChannel = () => {
      toolPreviewSegmentsRef.current = null;
      sequencePreviewOwnedRef.current = false;
    };
    /**
     * Angle Restricted Line previews through the kernel rather than locally, and that
     * preview is a React state write — blanking it on every hover frame would
     * re-render the panel per mouse move. Only publish a *change*, so an idle hover
     * (before an anchor exists) stays silent, as its bespoke handler did.
     */
    let anglePreviewLive = false;
    const publishAnglePreview = (segment: ToolPreviewSegment | undefined, cursor: ModelPoint) => {
      if (segment) {
        anglePreviewLive = true;
        // The kernel resolves the angle-system ray from the *cursor direction*
        // (`snap_to_close_point_in_active_angle_system`, upstream `syuusei_point_A_37`),
        // so it gets the raw cursor — a vertex-snapped one would pick a different ray.
        liveRef.current.onToolPreviewInput([segment.a, cursor], []);
      } else if (anglePreviewLive) {
        anglePreviewLive = false;
        liveRef.current.onToolPreviewInput([], []);
      }
    };
    const feedTool = (
      kind: 'down' | 'move' | 'up' | 'cancel',
      clientX: number,
      clientY: number,
    ) => {
      const runtime = drawRuntime();
      if (!runtime) return;
      // Only crease-drawing snaps to grid/vertices; selection/erase boxes (drag-box)
      // and freehand paths (drag-path — lasso/polygon) follow the raw cursor, so a
      // rubber-band select doesn't jump to nearby points. Snapping every phase is what
      // keeps the engine's click-vs-drag test honest — see `toolModeSnapsDrawPoint`.
      const mode = liveRef.current.activeToolInputMode;
      const snaps = toolModeSnapsDrawPoint(mode);
      // Angle Restricted Line runs the same engine but hands its preview to the kernel,
      // which owns the angle snap; the local preview channel stays empty for it.
      const kernelPreviewed = mode === 'angle-drag';
      if (kind === 'cancel') {
        const out = runtime.feed({ kind, point: { x: 0, y: 0 } });
        setToolPreview(null);
        if (kernelPreviewed) publishAnglePreview(undefined, { x: 0, y: 0 });
        if (snaps) syncArmedDrawPoint(out.livePoints, null);
        renderNow();
        return;
      }
      const raw = clientToModel(clientX, clientY);
      if (!raw) return;
      const resolved = snaps
        ? liveRef.current.resolveDrawPoint(raw, snapTolerance())
        : { point: raw, snapped: false };
      // Grid-restricted draw: an endpoint must land on a snapped grid/vertex point.
      // A drag that releases off-target is dropped, as upstream's release does. A
      // click-to-place draw instead ignores the miss and stays armed — losing the
      // parked start to a stray click would be the worse failure.
      if (liveRef.current.activeToolRequireSnap && kind === 'up' && !resolved.snapped) {
        if (armedDrawPointRef.current) return;
        const out = runtime.feed({ kind: 'cancel', point: resolved.point });
        setToolPreview(null);
        if (snaps) syncArmedDrawPoint(out.livePoints, null);
        renderNow();
        return;
      }
      const out = runtime.feed({
        kind,
        point: resolved.point,
        tolerance: modelToleranceOf(CLICK_MOVE_THRESHOLD),
        viewTransform: liveRef.current.activeToolModelAlignedBox ? null : currentView(),
      });
      const segment = out.preview?.segments[0];
      if (kernelPreviewed) publishAnglePreview(segment, raw);
      else setToolPreview(out.preview?.segments);
      if (snaps) {
        // Keep the anchor dotted for the whole angle drag, not just while armed.
        const placed = segment ? [segment.a] : out.livePoints;
        syncArmedDrawPoint(
          out.livePoints,
          kernelPreviewed && segment ? kernelSnapRing() : snapRingFor(resolved.point, raw),
          kernelPreviewed ? (placed ?? []) : undefined,
        );
      }
      renderNow();
      if (out.commit) {
        // Same raw-cursor rule as the preview: the engine saw the snapped point so its
        // arming rule holds, but the endpoint the kernel angle-snaps is the cursor.
        const points =
          kernelPreviewed && out.commit.points ? [out.commit.points[0], raw] : out.commit.points;
        liveRef.current.onToolCommit({ ...out.commit, points, additive: dragShift });
      }
    };
    // --- Crease transform preview (Move / Copy, two-point and four-point) ---
    // While the gesture runs, the selection is drawn where it would land. A `move`
    // shifts the real strokes in place (their originals travel with them, as the
    // ambient selection drag-move already does); a `copy` leaves the originals and
    // draws a ghost of the new geometry on the preview channel.
    //
    // The transform is resolved from the live points — placed points plus the
    // cursor — so a two-point tool previews from its first click and a four-point
    // tool from its third. Before that the transform is underdetermined and only
    // the placed dots show.
    const transformMatrixFor = (
      livePoints: readonly ModelPoint[],
      pointCount: 2 | 4,
    ): CpAffineMatrix | null => {
      if (pointCount === 2) {
        if (livePoints.length < 2) return null;
        const [from, to] = livePoints;
        return translationMatrix({ x: to.x - from.x, y: to.y - from.y });
      }
      if (livePoints.length < 4) return null;
      return matrixFromPointPairs(livePoints[0], livePoints[1], livePoints[2], livePoints[3]);
    };
    const updateTransformPreview = (
      transform: { kind: 'move' | 'copy'; pointCount: 2 | 4 },
      livePoints: readonly ModelPoint[],
    ) => {
      const ids = liveRef.current.selectedLineSet;
      const matrix = transformMatrixFor(livePoints, transform.pointCount);
      if (matrix === null) {
        // Underdetermined (too few points) or degenerate (a coincident source or
        // target pair) — show the placed dots alone rather than guessing.
        liveRef.current.clearTransformPreview();
        return;
      }
      if (transform.kind === 'move') {
        transformActiveRef.current = 'move';
        const move = { ids, matrix };
        renderer.setStrokes(liveRef.current.buildStrokes(move));
        renderer.setPoints(liveRef.current.buildPoints(move));
        return;
      }
      // Copy: snapshot the selection once per gesture, then transform in place.
      transformActiveRef.current = 'copy';
      if (!transformGhostRef.current || transformGhostIdsRef.current !== ids) {
        transformGhostRef.current = liveRef.current.createSelectionGhost(ids);
        transformGhostIdsRef.current = ids;
      }
      // The ghost carries the copied strokes' own colours, so it is not a tool
      // preview and must not be repainted as one.
      takePreviewChannel();
      renderer.setPreview(transformGhostRef.current?.update(matrix) ?? null);
    };
    // Persistent click-based `sequence` tool: every step collects a point. A
    // 'crease' step snaps the point onto the nearest crease and highlights it
    // (the kernel resolves the crease from the point); a 'point' step snaps to
    // grid/vertices. Placed points + a snap ring draw as an overlay; the
    // controller kernel-previews the live points and renders the result.
    const feedPersistent = (kind: 'down' | 'move' | 'cancel', clientX: number, clientY: number) => {
      if (liveRef.current.activeToolInputMode !== 'sequence') return;
      const accent = readCssVarColor(
        document.documentElement,
        SELECTION_COLOR_VAR,
        SELECTION_FALLBACK,
      );
      if (kind === 'cancel') {
        persistentToolRuntimeRef.current?.feed({ kind: 'cancel', point: { x: 0, y: 0 } });
        sequenceStepRef.current = 0;
        dynamicStepKindsRef.current = null;
        liveRef.current.onToolPreviewInput([], []);
        liveRef.current.onToolPickProgress(0);
        liveRef.current.clearTransformPreview();
        renderer.setOverlayPoints(null);
        renderNow();
        return;
      }
      const raw = clientToModel(clientX, clientY);
      if (!raw) return;
      const tol = snapTolerance();
      // Mirror Line decides its step kinds on the first press: a pick on a
      // vertex/point runs a 3-point sequence, a pick on a bare crease a 2-line one.
      if (liveRef.current.activeToolDualMirror && !persistentToolRuntimeRef.current) {
        const firstPickKind = liveRef.current.resolveFirstPickKind(raw, tol, pointHitTolerance());
        if (kind !== 'down') {
          // Hovering before the first pick — preview the mode the click will enter so
          // the two modes are legible: highlight the crease it would pick in line mode,
          // else ring the vertex/point it would snap to in point mode.
          if (firstPickKind === 'line') {
            // Query with the classifier's tolerance so a crease it called "line" always
            // resolves to a highlight (no 8–10px dead zone against the tighter hit tol).
            const lineId = liveRef.current.hitIndex.query(raw.x, raw.y, tol);
            liveRef.current.onToolPreviewInput([], lineId > 0 ? [lineId] : []);
            renderer.setOverlayPoints(null);
          } else {
            liveRef.current.onToolPreviewInput([], []);
            const snap = liveRef.current.resolveDrawPoint(raw, tol);
            renderer.setOverlayPoints(
              sequenceOverlayPoints([], snap.snapped ? snap.point : null, accent),
            );
          }
          renderNow();
          return;
        }
        dynamicStepKindsRef.current =
          firstPickKind === 'line' ? ['crease', 'crease'] : ['point', 'point', 'point'];
      }
      // Measure (distance): a first pick on a bare crease measures that crease
      // outright. Same classifier as Mirror Line, so "vertex wins over line" reads
      // identically in both tools.
      if (liveRef.current.activeToolMeasureCreasePick && !persistentToolRuntimeRef.current) {
        const firstPickKind = liveRef.current.resolveFirstPickKind(raw, tol, pointHitTolerance());
        if (firstPickKind === 'line') {
          const lineId = liveRef.current.hitIndex.query(raw.x, raw.y, tol);
          if (lineId > 0) {
            if (kind !== 'down') {
              // Hovering: light up the crease this click would measure.
              liveRef.current.onToolPreviewInput([], [lineId]);
              renderer.setOverlayPoints(null);
              renderNow();
              return;
            }
            liveRef.current.onToolCommit({ lineIds: [lineId] });
            liveRef.current.onToolPreviewInput([], []);
            renderer.setOverlayPoints(null);
            renderNow();
            return;
          }
        }
      }
      const stepKinds = dynamicStepKindsRef.current ?? liveRef.current.activeToolStepKinds;
      if (!persistentToolRuntimeRef.current) {
        persistentToolRuntimeRef.current = createToolRuntime(
          createStepSequenceTool(stepKinds.length),
        );
        sequenceStepRef.current = 0;
      }
      const runtime = persistentToolRuntimeRef.current;
      const stepKind = stepKinds[sequenceStepRef.current];
      const creaseStep = isCreaseStep(stepKind);
      const candidateStep = stepKind === 'candidate';
      // Nothing is armed until the tool is actually choosing between candidates.
      // Left set, a stale index from the last pick would draw one of the rays
      // solid while merely hovering a vertex — reading as "this is the one" before
      // anything has been chosen.
      if (!candidateStep && armedCandidateRef.current !== null) {
        armedCandidateRef.current = null;
        paintSequencePreviewRef.current?.();
      }
      let point: ModelPoint;
      let snappedToVertex = false;
      if (creaseStep) {
        const resolved = liveRef.current.resolveDrawPointOnCrease(raw, tol);
        point = resolved.point;
        snappedToVertex = resolved.snappedToVertex;
        // A destination step takes the crease the kernel will find from this point,
        // so a pick with none in its selection distance is ignored — upstream stays
        // on the step for it, where committing raises a "nearest line is outside
        // selection distance" error and throws the whole gesture away.
        if (
          requiresCreaseInRange(stepKind) &&
          kind === 'down' &&
          liveRef.current.hitIndex.query(point.x, point.y, kernelSnapTolerance()) <= 0
        ) {
          return;
        }
      } else if (candidateStep) {
        // Snap onto the nearest previewed candidate ray. A pick that lands on no ray
        // is ignored (Oriedita's candidate step gates on selection distance) rather
        // than silently committing the nearest one from across the canvas.
        const snapped = snapToNearestSegment(raw, liveRef.current.toolCommandPreviewSegments, tol);
        if (snapped === null && kind === 'down') return;
        point = snapped?.point ?? raw;
        // Arm the candidate under the cursor so it renders solid among the dashed
        // alternatives — the same projection the pick just used, so what looks
        // armed and what a click takes cannot disagree.
        if (armedCandidateRef.current !== (snapped?.index ?? null)) {
          armedCandidateRef.current = snapped?.index ?? null;
          paintSequencePreviewRef.current?.();
        }
      } else {
        const resolved = liveRef.current.resolveDrawPoint(raw, tol);
        point = resolved.point;
        liveRef.current.onToolSnapKind(resolved.snapped ? (resolved.kind ?? null) : null);
      }
      // On a crease step, highlight the single line under the snapped point — so a
      // crease the point lands on lights up even when it snapped to a grid point on
      // that line. Suppress the highlight only at a vertex where creases meet (the
      // snap ring marks the junction; which crease is meant would be ambiguous).
      const hoverLine =
        creaseStep && !snappedToVertex
          ? liveRef.current.hitIndex.query(point.x, point.y, lineHitTolerance())
          : -1;
      const highlight = hoverLine > 0 ? [hoverLine] : [];
      const out = runtime.feed({ kind, point });
      const transform = liveRef.current.activeToolTransform;
      if (out.commit) {
        liveRef.current.onToolCommit(out.commit);
        liveRef.current.onToolPreviewInput([], []);
        renderer.setOverlayPoints(null);
        sequenceStepRef.current = 0;
        dynamicStepKindsRef.current = null;
        armedCandidateRef.current = null;
        if (transform) {
          // Leave the previewed geometry up: the committed document re-renders it
          // at exactly this position a moment later, so tearing it down here would
          // blink the result out for the length of the async command. The scene
          // upload takes the ghost down (a move's strokes are simply replaced).
          transformActiveRef.current = null;
          transformGhostIdsRef.current = null;
          pendingGhostClearRef.current = transform.kind === 'copy';
        }
      } else {
        if (kind === 'down') {
          sequenceStepRef.current += 1;
          // Advance the step prompt with the points actually placed, so a multi-step
          // tool reads "Pick destination point" once its source is down. Reported as
          // a cumulative count (not a delta) so the auto-advanced candidate steps
          // above, which skip a pick, stay in sync.
          liveRef.current.onToolPickProgress(sequenceStepRef.current);
          // A lone candidate resolves the moment the step is reached, using the
          // candidates already on screen. The effect below also watches for this,
          // but only fires when a *new* preview arrives — and after a click with no
          // pointer movement none does, which would leave the tool waiting for a
          // jiggle of the mouse before it acted.
          if (tryLoneCandidateAutoPick(runtime)) return;
        }
        const live = out.livePoints ?? [];
        const placed = kind === 'move' ? live.slice(0, -1) : live;
        const ring = kind === 'move' && (point.x !== raw.x || point.y !== raw.y) ? point : null;
        // On a candidate step, dot the endpoints of every previewed candidate ray so
        // each option reads as a distinct pickable line (Oriedita draws these dots).
        const candidateDots = candidateStep
          ? liveRef.current.toolCommandPreviewSegments.flatMap((s) => [s.a, s.b])
          : [];
        renderer.setOverlayPoints(sequenceOverlayPoints(placed, ring, accent, candidateDots));
        if (transform) {
          // The transform tools own the preview channel: their ghost is built here
          // from the live points, so the kernel preview is skipped entirely. Left
          // on, it would re-transport the whole selection per mouse move and fight
          // the ghost for the channel (its default arm draws a rubber-band segment
          // between the last two points, which means nothing for these tools).
          updateTransformPreview(transform, live);
        } else {
          liveRef.current.onToolPreviewInput(live, highlight);
        }
      }
      renderNow();
    };
    // Converging Lines (angle-restricted): a bespoke sequence. The dual first click
    // builds the base segment — a crease pick supplies both endpoints at once, else
    // two point picks — then the previewed converging rays throw off intersection
    // points; picking one draws the two creases from the base endpoints to it.
    const feedConverging = (kind: 'down' | 'move' | 'cancel', clientX: number, clientY: number) => {
      const accent = readCssVarColor(
        document.documentElement,
        SELECTION_COLOR_VAR,
        SELECTION_FALLBACK,
      );
      if (kind === 'cancel') {
        convergingBaseRef.current = [];
        liveRef.current.onToolPreviewInput([], []);
        renderer.setOverlayPoints(null);
        renderNow();
        return;
      }
      const raw = clientToModel(clientX, clientY);
      if (!raw) return;
      const tol = snapTolerance();
      const base = convergingBaseRef.current;

      if (base.length < 2) {
        if (kind === 'down') {
          if (base.length === 0) {
            // First pick: a crease supplies both base endpoints; else a free point.
            // A vertex under the cursor wins outright (classifier's tight point-priority
            // radius) — otherwise the crease an endpoint caps always shadows the vertex
            // (its distance-to-segment is ~0 there), making vertices impossible to grab.
            const lineId =
              liveRef.current.resolveFirstPickKind(raw, tol, pointHitTolerance()) === 'line'
                ? liveRef.current.hitIndex.query(raw.x, raw.y, tol)
                : 0;
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
          // the point it would snap to. Mirror the commit's point-wins-ties rule so
          // the preview matches what the click will actually grab.
          const lineId =
            liveRef.current.resolveFirstPickKind(raw, tol, pointHitTolerance()) === 'line'
              ? liveRef.current.hitIndex.query(raw.x, raw.y, tol)
              : 0;
          liveRef.current.onToolPreviewInput([], lineId > 0 ? [lineId] : []);
          const snap = liveRef.current.resolveDrawPoint(raw, tol);
          const ring = lineId > 0 || !snap.snapped ? null : snap.point;
          renderer.setOverlayPoints(sequenceOverlayPoints([], ring, accent));
        } else {
          // Hover for the second base point.
          liveRef.current.onToolPreviewInput([], []);
          const snap = liveRef.current.resolveDrawPoint(raw, tol);
          renderer.setOverlayPoints(
            sequenceOverlayPoints(base, snap.snapped ? snap.point : null, accent),
          );
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
          sequenceOverlayPoints([], converge, accent, liveRef.current.toolCommandPreviewPoints),
        );
      }
      renderNow();
    };
    // Square Bisector (modes A + B): the first pick decides the mode. A point starts
    // 3-point mode — collect 3 angle points then a destination crease, commit 4
    // points. A crease starts 2-line mode — collect 2 source crease ids then a
    // destination crease id, commit 3 line ids. Picked source creases render in the
    // selection style; point mode shows placed dots + the kernel bisector preview.
    const feedSquareBisector = (
      kind: 'down' | 'move' | 'cancel',
      clientX: number,
      clientY: number,
    ) => {
      const accent = readCssVarColor(
        document.documentElement,
        SELECTION_COLOR_VAR,
        SELECTION_FALLBACK,
      );
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
      const tol = snapTolerance();
      const hitTol = lineHitTolerance();
      const lineUnderCursor = () => liveRef.current.hitIndex.query(raw.x, raw.y, hitTol);

      // First pick decides point mode vs line mode (point-priority, like Mirror Line).
      // The line lookup uses the classifier's tolerance (`tol`), not the tighter hit
      // tolerance, so a click the classifier calls a line always resolves to one.
      if (state.mode === null) {
        if (liveRef.current.resolveFirstPickKind(raw, tol, pointHitTolerance()) === 'line') {
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
            renderer.setOverlayPoints(
              sequenceOverlayPoints([], snap.snapped ? snap.point : null, accent),
            );
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
            renderer.setOverlayPoints(
              sequenceOverlayPoints(pts, snap.snapped ? snap.point : null, accent),
            );
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
          setLinePickHighlight(
            lineId > 0 && !lines.includes(lineId) ? [...lines, lineId] : [...lines],
          );
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
    // Voronoi: every click appends a seed point to the panel-owned list; the kernel
    // snaps/toggles/rebuilds the diagram from it, and the diagram + seed dots render
    // via the preview channels. Cancel/Escape clears the list.
    const feedVoronoi = (kind: 'down' | 'move' | 'cancel', clientX: number, clientY: number) => {
      if (kind === 'cancel') {
        liveRef.current.onVoronoiSeedsChange([]);
        return;
      }
      if (kind !== 'down') return;
      const raw = clientToModel(clientX, clientY);
      if (!raw) return;
      liveRef.current.onVoronoiSeedsChange([...liveRef.current.voronoiSeeds, raw]);
    };
    // Dispatch a click-based `sequence` gesture to the right bespoke handler, else the
    // generic point-sequence engine.
    const feedSequenceTool = (
      kind: 'down' | 'move' | 'cancel',
      clientX: number,
      clientY: number,
    ) => {
      if (liveRef.current.activeToolConverging) feedConverging(kind, clientX, clientY);
      else if (liveRef.current.activeToolSquareBisector) feedSquareBisector(kind, clientX, clientY);
      else if (liveRef.current.activeToolVoronoi) feedVoronoi(kind, clientX, clientY);
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
          createLinePickTool(liveRef.current.activeToolLineCount),
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
      const hit = liveRef.current.hitIndex.query(raw.x, raw.y, lineHitTolerance());
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
    // Lengthen (Oriedita LENGTHEN_CREASE_5): two drag gestures. Gesture 1 draws a
    // selection line — the kernel extends every crease it crosses (a click is the
    // degenerate nearest-crease fallback); gesture 2 clicks the target line to extend
    // to. Commits 3 raw points [selectionA, selectionB, extensionPoint] — no snapping,
    // matching Oriedita's object-space handler. The kernel resolves creases + target.
    const feedLengthen = (
      kind: 'down' | 'move' | 'up' | 'cancel',
      clientX: number,
      clientY: number,
    ) => {
      if (liveRef.current.activeToolInputMode !== 'lengthen') return;
      const state = lengthenRef.current;
      const accent = readCssVarColor(
        document.documentElement,
        SELECTION_COLOR_VAR,
        SELECTION_FALLBACK,
      );
      // The crease ids the selection line picks, mirroring the kernel: every crease it
      // strictly crosses, or — when degenerate (a click) — the nearest crease. Rendered
      // in the selection style so they read as selected as the line is drawn through them.
      const pickedCreaseIds = (a: ModelPoint, b: ModelPoint): number[] => {
        if (Math.hypot(b.x - a.x, b.y - a.y) <= modelToleranceOf(CLICK_MOVE_THRESHOLD)) {
          const hit = liveRef.current.hitIndex.query(b.x, b.y, lineHitTolerance());
          return hit > 0 ? [hit] : [];
        }
        const ids: number[] = [];
        liveRef.current.lineSegments.forEach((s, i) => {
          if (segmentsIntersect(a, b, s.a, s.b)) ids.push(i + 1);
        });
        return ids;
      };
      const reset = () => {
        lengthenRef.current = { phase: 'select', a: null, b: null };
        setLinePickHighlight([]);
        clearPreview();
        renderer.setOverlayPoints(null);
        liveRef.current.onToolPickProgress(0);
      };
      if (kind === 'cancel') {
        reset();
        renderNow();
        return;
      }
      const raw = clientToModel(clientX, clientY);
      if (!raw) return;
      if (state.phase === 'select') {
        if (kind === 'down') {
          state.a = raw;
          state.b = raw;
          setLinePickHighlight([]);
          setToolPreview(null);
        } else if (kind === 'move') {
          if (!state.a) return; // hover before pressing: nothing to draw yet
          state.b = raw;
          // Draw only the selection line while dragging; the creases it picks light up
          // on release (like a box select), not live under the cursor.
          //
          // Explicitly the accent, not the tool colour: Lengthen *commits* in the
          // active crease colour, but what this strokes is a selection gesture, not
          // a crease, so it should read like a box select rather than like the line
          // being drawn.
          takePreviewChannel();
          renderer.setPreview(
            previewSegmentsToStrokes(
              [{ a: state.a, b: state.b }],
              readCssVarColor(document.documentElement, SELECTION_COLOR_VAR, SELECTION_FALLBACK),
            ),
          );
        } else if (kind === 'up') {
          if (!state.a) return;
          state.b = raw;
          const picked = pickedCreaseIds(state.a, state.b);
          // Nothing crossed — reset, as Oriedita does when the sorting box is empty.
          if (picked.length === 0) {
            reset();
            renderNow();
            return;
          }
          // Advance: keep the picked creases highlighted through the target step, and
          // move the panel prompt to "select target line" (step 2).
          state.phase = 'extend';
          setLinePickHighlight(picked);
          liveRef.current.onToolPickProgress(1);
        }
        renderNow();
        return;
      }
      // phase === 'extend': the next click's raw point is the extension target.
      if (kind === 'move' || kind === 'down') {
        renderer.setOverlayPoints(sequenceOverlayPoints([], raw, accent));
      } else if (kind === 'up') {
        if (state.a && state.b) {
          liveRef.current.onToolCommit({ points: [state.a, state.b, raw] });
        }
        reset();
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
      const out = eraseRuntime.feed({ kind, point: raw, viewTransform: currentView() });
      // The erase box draws in its own colour, so it must not be repainted as a
      // tool preview when the crease colour changes.
      takePreviewChannel();
      renderer.setPreview(
        out.preview && out.preview.segments.length > 0
          ? previewSegmentsToStrokes(
              out.preview.segments,
              readCssVarColor(canvas, ERASE_COLOR_VAR, ERASE_FALLBACK),
            )
          : null,
      );
      renderNow();
    };
    // Turning a focused 3D folded figure. The overlay has made its body inert,
    // so its presses arrive here instead of moving it.
    let orbiting = false;
    // Whether the wheel gesture in flight is turning a focused folded figure,
    // and which gesture that answer was worked out for. See `onWheel`.
    let foldedWheelBurst: { id: number; claimed: boolean } | null = null;
    // Active selection move-drag: press point (model) and running delta (model).
    let movingSelection = false;
    let moveStart: ModelPoint | null = null;
    let moveDelta: ModelPoint = { x: 0, y: 0 };
    let lastX = 0;
    let lastY = 0;
    let pressX = 0;
    let pressY = 0;
    const onPointerDown = (e: PointerEvent) => {
      lastX = pressX = e.clientX;
      lastY = pressY = e.clientY;
      moved = false;
      const toolMode = liveRef.current.activeToolInputMode;
      const orbitClaims = orbitClaimsPressAt(e.clientX, e.clientY);
      if (e.button === 2) {
        // Right button: universal erase gesture, overrides any active tool — including
        // a crease draw waiting on its second click, whose parked start it abandons.
        e.preventDefault();
        if (toolModeSnapsDrawPoint(toolMode) && armedDrawPointRef.current) feedTool('cancel', 0, 0);
        erasing = true;
        eraseRuntime = createToolRuntime(toolEngineFor('drag-box'));
        feedErase('down', e.clientX, e.clientY);
      } else if (e.button === 1) {
        // Middle button: pan, whatever tool is active. Oriedita makes this
        // unclaimable by design — its handler `Feature` enum has no BUTTON_2,
        // so every tool declines the middle button and the canvas' own pan
        // always wins (`Canvas.java` mousePressed/Dragged). preventDefault also
        // suppresses the browser's middle-click autoscroll.
        e.preventDefault();
        panning = true;
        setPanDragging(true);
      } else if (orbitClaims) {
        // A focused 3D folded figure turns instead of anything else happening.
        // Above the tool branches because a tool must not draw through a figure
        // the user is turning, and below the right/middle-button ones because
        // erase and pan are unclaimable by design — the same precedence the
        // overlay gives a focused simulation window.
        e.preventDefault();
        orbiting = liveRef.current.foldedOrbit?.begin({ x: e.clientX, y: e.clientY }) ?? false;
        if (orbiting) setOrbitPointer('turning');
      } else if (e.metaKey || liveRef.current.panToolActive) {
        // Meta+drag pans, as does a plain drag while the hand tool is on. Folded
        // figures are grabbed through the canvas-object overlay now, which sits
        // above this canvas and takes the press first.
        //
        // `metaKey`, not the platform accel. This is upstream's rule verbatim --
        // `Canvas.java:267` maps `isMetaDown()` to BUTTON2, whose handler pans --
        // and it means the same thing in practice: Cmd on macOS, and off-Apple
        // the Windows/Super key, which nobody drags with. Using the accel here
        // instead would claim Ctrl+drag on Windows, and Ctrl belongs to crease
        // colour inversion (see `useCpLineColorInversion`), which upstream also
        // binds on every platform. Middle-button drag and the hand tool remain
        // the pan affordances that work identically everywhere.
        e.preventDefault();
        panning = true;
        setPanDragging(true);
      } else if (toolMode === 'sequence') {
        // Click-based tool: place a point / pick a crease (no drag). Hover previews.
        e.preventDefault();
        feedSequenceTool('down', e.clientX, e.clientY);
      } else if (toolMode === 'line-entity') {
        // Click-based entity pick: each click grabs a crease by id.
        e.preventDefault();
        feedLinePick('down', e.clientX, e.clientY);
      } else if (toolMode === 'lengthen') {
        // Two-gesture drag tool: draw the selection line, then click the target.
        e.preventDefault();
        feedLengthen('down', e.clientX, e.clientY);
      } else if (toolMode === 'angle-drag') {
        // Angle Restricted Line: press anchors the start, drag previews the
        // angle-snapped segment, release commits — the same gesture and the same
        // engine as the drag-line tools below, so it takes the same press setup. It
        // needs its own branch only to keep those tools' `toolEngineFor` narrowing,
        // and because its runtime is persistent (`drawRuntime`).
        e.preventDefault();
        drawing = true;
        dragShift = e.shiftKey;
        feedTool('down', e.clientX, e.clientY);
      } else if (toolMode === 'text') {
        // Text tool: a plain click on empty canvas starts an inline-edit draft
        // (handled on release, once we know it was a click and not a pan/drag).
        // Clicks on existing texts are captured by the DOM overlay and never reach
        // here, so any press that lands here is on empty space.
        e.preventDefault();
        textPressStarted = true;
      } else if (toolMode) {
        // A drag draw tool is active: plain drag draws instead of selecting.
        e.preventDefault();
        // Grid-restricted draw only accepts endpoints that snap to grid/vertices, so
        // an unsnapped press starts nothing — and, when a click-to-place start is
        // already armed, leaves that start parked rather than moving it off-grid.
        const m = clientToModel(e.clientX, e.clientY);
        const endpointSnapped =
          !m ||
          toolMode !== 'drag-line' ||
          !liveRef.current.activeToolRequireSnap ||
          liveRef.current.resolveDrawPoint(m, snapTolerance()).snapped;
        if (endpointSnapped) {
          drawing = true;
          dragShift = e.shiftKey;
          // The crease-draw tools run on a persistent runtime (see drawRuntime); the
          // others open a fresh engine per gesture.
          if (!toolModeSnapsDrawPoint(toolMode)) {
            toolRuntime = createToolRuntime(toolEngineFor(toolMode));
          }
          feedTool('down', e.clientX, e.clientY);
        }
      } else {
        // A plain drag that starts on an already-selected crease moves the whole
        // line selection; otherwise it selects (click or marquee).
        const m = clientToModel(e.clientX, e.clientY);
        const lineId = m ? liveRef.current.hitIndex.query(m.x, m.y, lineHitTolerance()) : -1;
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
      // Adopt the modifier state the pointer reports, as upstream does on every
      // canvas mouseMoved (`Canvas.java:245`). Focus loss clears held modifiers
      // because no keyup will arrive, which is right — except when the key is
      // still down on return. Moving over the canvas is what corrects that.
      syncHeldModifiersFromEvent(e);
      if (
        Math.abs(e.clientX - pressX) > CLICK_MOVE_THRESHOLD ||
        Math.abs(e.clientY - pressY) > CLICK_MOVE_THRESHOLD
      ) {
        moved = true;
      }
      if (!orbiting && !panning && !erasing && !drawing) {
        // Asked with the gesture's own predicate, so the open hand appears
        // exactly where a press would turn the figure and nowhere else. Skipped
        // mid-gesture: a drag owns the cursor until it is released.
        //
        // Gated on something being focused first. `orbitClaimsPressAt` measures
        // the canvas to place the pointer, and this runs on every move over the
        // app's hottest surface — with no focused figure there is nothing to be
        // over, so the answer is 'none' without touching layout.
        setOrbitPointer(
          liveRef.current.foldedOrbit?.focusedId != null && orbitClaimsPressAt(e.clientX, e.clientY)
            ? 'over'
            : 'none',
        );
      }
      if (orbiting) {
        // The pointer is captured, so a drag that leaves the figure keeps
        // turning it — the same as dragging a scrollbar past its track, and what
        // any orbit that stopped at the object's edge would get wrong.
        //
        // Client pixels, unprojected by nothing: this is the same measurement
        // `SimulatorViewport` takes, which is the whole of what makes a figure
        // and a simulation answer one drag with one rotation.
        liveRef.current.foldedOrbit?.advance({ x: e.clientX, y: e.clientY });
      } else if (erasing) {
        feedErase('move', e.clientX, e.clientY);
      } else if (drawing) {
        feedTool('move', e.clientX, e.clientY);
      } else if (liveRef.current.panToolActive && !panning) {
        // Hand tool on but not dragging: suppress every tool hover preview, so
        // no ghost snap indicator trails the grab cursor.
      } else if (liveRef.current.activeToolInputMode === 'lengthen' && !panning) {
        // Lengthen: draw the selection line while dragging, or (in the extension
        // phase) track the target-point cursor. Fires on hover too.
        feedLengthen('move', e.clientX, e.clientY);
      } else if (
        liveRef.current.activeToolInputMode === 'sequence' &&
        !panning &&
        !movingSelection &&
        !selecting
      ) {
        // Hover with a click-based tool active: update its preview / highlight.
        feedSequenceTool('move', e.clientX, e.clientY);
      } else if (
        liveRef.current.activeToolInputMode === 'line-entity' &&
        !panning &&
        !movingSelection &&
        !selecting
      ) {
        // Hover with an entity-pick tool active: highlight the crease under cursor.
        feedLinePick('move', e.clientX, e.clientY);
      } else if (
        toolModeSnapsDrawPoint(liveRef.current.activeToolInputMode) &&
        !panning &&
        !movingSelection &&
        !selecting
      ) {
        // Hover with a crease-draw tool (before pressing): show the snap indicator at
        // where the endpoint would land, and — once a click-to-place start is armed —
        // rubber-band the crease from it. The engine ignores a move with nothing
        // started, so the same feed covers both. Only the crease-draw tools snap;
        // drag-path (lasso/polygon) follows the raw cursor with no snap indicator.
        feedTool('move', e.clientX, e.clientY);
      } else if (movingSelection && moveStart) {
        if (moved) {
          const m = clientToModel(e.clientX, e.clientY);
          if (m) {
            const rawDelta = { x: m.x - moveStart.x, y: m.y - moveStart.y };
            // Snap the translation to nearby grid/vertices/lines (screen-fixed
            // tolerance from the WebGL camera), matching the SVG move.
            moveDelta = liveRef.current.resolveMoveSnap(rawDelta, snapTolerance()).delta;
            // Redraw the selected lines shifted in place — the real strokes move,
            // no separate copy — and let their derived vertices follow. Only the
            // stroke + point buffers are re-uploaded per frame.
            const move = {
              ids: liveRef.current.selectedLineSet,
              matrix: translationMatrix(moveDelta),
            };
            renderer.setStrokes(liveRef.current.buildStrokes(move));
            renderer.setPoints(liveRef.current.buildPoints(move));
            renderNow();
          }
        }
      } else if (panning && cameraRef.current) {
        const ratio = dpr();
        panUserCamera(cameraRef.current, (e.clientX - lastX) * ratio, (e.clientY - lastY) * ratio);
        lastX = e.clientX;
        lastY = e.clientY;
        renderNow();
      } else if (selecting && moved) {
        marquee.classList.remove('cp-webgl-marquee--text');
        updateMarquee(e.clientX, e.clientY);
      } else if (
        liveRef.current.activeToolInputMode === 'text' &&
        textPressStarted &&
        moved &&
        !panning &&
        !movingSelection
      ) {
        // Text tool press-drag: rubber-band the box the release will create.
        marquee.classList.add('cp-webgl-marquee--text');
        updateMarquee(e.clientX, e.clientY);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      const cancelled = e.type === 'pointercancel';
      if (orbiting) {
        // Handled before `cpPointerReleaseRoute` rather than as a case in it:
        // orbit is claimed in the first branch of pointerdown, so no tool, erase
        // or pan can be in flight alongside it, and the route function exists to
        // arbitrate exactly the modes that can overlap. A cancel still commits —
        // the figure has been drawn turned on every move, so the choice is
        // between one undo entry and a turn the user cannot undo at all. Commit
        // is also the only thing that writes the camera to the store, so
        // skipping it would leave the figure drawn at a camera nothing records.
        orbiting = false;
        setOrbitPointer(orbitClaimsPressAt(e.clientX, e.clientY) ? 'over' : 'none');
        liveRef.current.foldedOrbit?.commit();
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        return;
      }
      // Which handler owns this release. The precedence rule (erase and pan outrank
      // the active tool) lives in one pure, unit-tested function rather than in the
      // guards of each branch below, where a mode that forgot to exclude an
      // in-flight erase stranded the whole gesture. See tools/pointerRelease.ts.
      const route = cpPointerReleaseRoute({
        toolMode: liveRef.current.activeToolInputMode,
        erasing,
        panning,
        drawing,
        movingSelection,
        selecting,
        moved,
        cancelled,
        transformPointCount: liveRef.current.activeToolTransform?.pointCount ?? null,
        sequenceStep: sequenceStepRef.current,
      });
      if (route === 'sequence-drag-commit') {
        // Oriedita's two-point move/copy are press-drag-release, not click-click
        // (BaseMouseHandlerLineTransform commits on mouseReleased). Release after a
        // drag places the destination point and commits, so both gestures work: drag
        // it there, or click twice.
        feedSequenceTool('down', e.clientX, e.clientY);
      } else if (route === 'lengthen') {
        feedLengthen(cancelled ? 'cancel' : 'up', e.clientX, e.clientY);
      } else if (route === 'angle-drag') {
        // Angle Restricted Line: release commits the [anchor, endpoint] segment, or
        // parks the anchor for a second click. Its own route (rather than 'draw')
        // because the mode is panel-selected, not declared as a drag `inputMode`.
        feedTool(cancelled ? 'cancel' : 'up', e.clientX, e.clientY);
      } else if (route === 'text') {
        // Text tool: a click (no drag) whose press started on the canvas starts an
        // inline-edit draft at that model point; a press-drag creates a text box of
        // the dragged size. A pan, or a release whose press began on the overlay
        // (dismissing an editor), does nothing.
        if (textPressStarted && !cancelled) {
          if (moved) {
            const corners = dragBoxCorners(e.clientX, e.clientY);
            if (corners) liveRef.current.onTextCreateBox?.(corners);
          } else {
            const m = clientToModel(e.clientX, e.clientY);
            if (m) liveRef.current.onTextCreate?.(m);
          }
        }
      } else if (route === 'erase') {
        clearPreview();
        const raw = clientToModel(e.clientX, e.clientY);
        if (eraseRuntime && raw) {
          const figureId = !moved ? figureAt(e.clientX, e.clientY) : null;
          if (cancelled) {
            eraseRuntime.feed({ kind: 'cancel', point: raw });
          } else if (figureId) {
            // Right-*click* (no drag) over a folded figure opens its context menu
            // instead of erasing; right-*drag* and clicks elsewhere still erase.
            eraseRuntime.feed({ kind: 'cancel', point: raw });
            liveRef.current.onRequestContextMenu({
              clientX: e.clientX,
              clientY: e.clientY,
              target: { kind: 'folded-figure', figureId },
            });
          } else {
            const out = eraseRuntime.feed({
              kind: 'up',
              point: raw,
              viewTransform: currentView(),
            });
            if (out.commit) {
              // Right-drag: erase every crease inside the box.
              liveRef.current.onEraseBox(out.commit.points ?? []);
            } else {
              // Right-click (degenerate box): erase the primitive under the cursor.
              eraseHit(hitTest(e.clientX, e.clientY));
            }
          }
        }
        renderNow();
      } else if (route === 'draw') {
        const clickAction = !moved && !cancelled ? liveRef.current.activeToolClickAction : null;
        if (clickAction) {
          // A click (no drag) on a tool that defines one: discard the degenerate box
          // and run the click behaviour against the crease under the cursor, matching
          // Oriedita's press-vs-drag split in `BoxSelectStepNode.runReleaseAction`.
          feedTool('cancel', e.clientX, e.clientY);
          const hit = hitTest(e.clientX, e.clientY);
          if (clickAction === 'erase') {
            eraseHit(hit);
          } else if (clickAction === 'select' || hit?.kind === 'line') {
            liveRef.current.onSelect(hit, e.shiftKey);
          }
        } else {
          feedTool(cancelled ? 'cancel' : 'up', e.clientX, e.clientY);
        }
        if (!toolModeSnapsDrawPoint(liveRef.current.activeToolInputMode)) {
          toolRuntime = null;
          renderer.setOverlayPoints(null);
        }
        // A crease-draw tool keeps its runtime (a click may have just armed its start)
        // and its overlay, which feedTool has already set to the armed dot + snap ring.
      } else if (route === 'move-selection') {
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
      } else if (route === 'select') {
        if (moved) boxSelect(e.clientX, e.clientY, e.shiftKey);
        else liveRef.current.onSelect(hitTest(e.clientX, e.clientY), e.shiftKey);
      }
      // Every gesture flag is cleared here, not inside the branch that consumed it.
      // A flag cleared only by its own branch survives any release routed elsewhere,
      // and `erasing` in particular then makes the *next* press feed a dead erase
      // runtime — a one-gesture glitch becomes a permanently broken canvas.
      marquee.style.display = 'none';
      marquee.classList.remove('cp-webgl-marquee--text');
      panning = false;
      setPanDragging(false);
      selecting = false;
      movingSelection = false;
      moveStart = null;
      drawing = false;
      erasing = false;
      eraseRuntime = null;
      textPressStarted = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    // What a plain scroll does is the `wheelGesture` preference — zoom by
    // default, pan for the Figma model — and the accel key zooms under either,
    // which is what keeps zoom reachable from a mouse. `resolveWheelGesture`
    // owns the whole decision — including the fast pinch curve and the
    // `deltaMode` normalisation this handler used to skip — so nothing here
    // reads a modifier or a raw delta.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Whose gesture this is was settled by its first event, and a cursor that
      // has since wandered over an inline simulation window does not change the
      // answer — see `claimWheelBurst`. An owner elsewhere gets the event
      // delivered rather than dropped, so a zoom begun on a window survives the
      // cursor leaving it just as a pan survives crossing one.
      const burst = claimWheelBurst(canvas);
      if (burst.owner !== canvas) {
        forwardWheel(burst.owner, e);
        return;
      }
      // A focused 3D folded figure zooms its own camera instead, exactly as a
      // focused inline simulation window does — there the window is a DOM
      // element and takes the wheel itself; a folded figure is drawn into this
      // surface, so the wheel arrives here and has to be routed. Above the
      // camera branches for the same reason the orbit press is: what the
      // pointer is over decides who the gesture belongs to.
      //
      // Decided once per burst, and keyed on the burst's identity rather than on
      // "was I the first handler": when the event was forwarded from a window
      // this handler is the *second* claim of that event, so a bare first-event
      // flag would leave the previous gesture's answer standing.
      if (foldedWheelBurst?.id !== burst.id) {
        const user = clientToUser(e.clientX, e.clientY);
        foldedWheelBurst = {
          id: burst.id,
          claimed: !!(user && liveRef.current.foldedOrbit?.claimsWheel(user)),
        };
      }
      if (foldedWheelBurst.claimed) {
        liveRef.current.foldedOrbit?.zoom(e.deltaY);
        return;
      }
      const cam = cameraRef.current;
      if (!cam) return;
      const ratio = dpr();
      const gesture = resolveWheelGesture(e, liveRef.current.wheelGesture);
      if (gesture.kind === 'pan') {
        // Negated: `panUserCamera` takes a *drag* delta, and a scroll moves the
        // content the other way — so the paper follows the fingers.
        panUserCamera(cam, -gesture.dx * ratio, -gesture.dy * ratio);
      } else {
        if (gesture.factor === 1) return;
        const rect = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * ratio;
        const cy = (e.clientY - rect.top) * ratio;
        zoomUserCameraAt(cam, viewportOf(ratio), cx, cy, gesture.factor);
      }
      renderNow();
    };
    // Suppress the browser menu so the right button is free for the erase gesture.
    const onContextMenu = (e: Event) => e.preventDefault();
    // Drop the hover snap indicator when the cursor leaves the canvas. A parked crease
    // start stays put — the cursor is coming back — but its rubber band goes, since
    // there is no cursor left to stretch it to.
    const onPointerLeave = () => {
      if (!orbiting) setOrbitPointer('none');
      const mode = liveRef.current.activeToolInputMode;
      // Guarded on the mode as well as the ref, so a parked point cannot outlive the
      // tool that placed it if a reset is ever missed.
      const parked = (toolModeSnapsDrawPoint(mode) && armedDrawPointRef.current) || null;
      if (parked) {
        clearPreview();
        if (mode === 'angle-drag') liveRef.current.onToolPreviewInput([], []);
        renderer.setOverlayPoints(
          sequenceOverlayPoints(
            [parked],
            null,
            readCssVarColor(document.documentElement, SELECTION_COLOR_VAR, SELECTION_FALLBACK),
          ),
        );
      } else {
        renderer.setOverlayPoints(null);
      }
      renderNow();
    };
    // Escape abandons an in-progress point sequence, entity pick, or armed draw.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (liveRef.current.activeToolInputMode === 'sequence') {
        feedSequenceTool('cancel', 0, 0);
      } else if (liveRef.current.activeToolInputMode === 'line-entity') {
        feedLinePick('cancel', 0, 0);
      } else if (liveRef.current.activeToolInputMode === 'lengthen') {
        feedLengthen('cancel', 0, 0);
      } else if (toolModeSnapsDrawPoint(liveRef.current.activeToolInputMode)) {
        feedTool('cancel', 0, 0);
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
    // Live inputs are read through liveRef rather than deps, so this runs once
    // per mount. `rendererGeneration` is the only dep that ever changes -- it
    // does so on context loss, where the dead renderer must be torn down and
    // replaced. (`clearPreview` and `tryLoneCandidateAutoPick` are stable
    // callbacks, listed to satisfy the exhaustive-deps rule.)
  }, [rendererGeneration, clearPreview, tryLoneCandidateAutoPick]);

  // Upload creases and points whenever they are rebuilt, then redraw immediately.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setStrokes(strokeGeometry);
    renderer.setPoints(pointGeometry);
    // A copy gesture's ghost was deliberately left up through the commit; now that
    // the document's own strokes carry the new creases, take it down. Doing it here
    // rather than at commit means the geometry never blinks out in between.
    if (pendingGhostClearRef.current) {
      pendingGhostClearRef.current = false;
      transformGhostRef.current = null;
      clearPreview();
    }
    renderNowRef.current();
  }, [strokeGeometry, pointGeometry, rendererGeneration, clearPreview]);

  // Folded figures on their own channel, so turning one uploads its fills and
  // edges and leaves the crease buffers alone.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setFolded(foldedGeometry);
    renderNowRef.current();
  }, [foldedGeometry, rendererGeneration]);

  // Point-sequence kernel preview: render the controller-supplied candidate
  // segments on the preview channel. Drag tools drive the same channel
  // imperatively, so this must only ever clear content it published itself --
  // it used to clear unconditionally, which wiped a live drag preview whenever
  // this effect re-ran for an unrelated reason (a colour change from holding
  // Control being the way to see it, since the preview then only came back on
  // the next pointer move).
  const paintSequencePreview = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return false;
    if (toolCommandPreviewSegments.length === 0 && toolCommandHighlightSegments.length === 0) {
      return false;
    }
    sequencePreviewOwnedRef.current = true;
    toolPreviewSegmentsRef.current = null;
    renderer.setPreview(
      previewGroupsToStrokes(
        [
          // What the tool would create, in the crease colour it would create it
          // in — the active colour, unless a candidate names its own crease.
          ...candidatePreviewGroups(
            toolCommandPreviewSegments,
            toolPreviewColor,
            createCpLineAppearanceResolver(lineStyle, mode, document.documentElement),
            {
              display: foldAngleDisplay,
              anchor: readCssVarColor(
                document.documentElement,
                FOLD_ANGLE_ANCHOR_VAR,
                FOLD_ANGLE_ANCHOR_FALLBACK,
              ),
            },
            armedCandidateRef.current,
          ),
          // Creases that already exist and are merely being pointed at, in the
          // selection accent — they are not being drawn, so they must not take
          // the crease colour and read as though the tool had recoloured them.
          {
            segments: toolCommandHighlightSegments,
            color: readCssVarColor(
              document.documentElement,
              SELECTION_COLOR_VAR,
              SELECTION_FALLBACK,
            ),
          },
        ],
        activeToolDashedPreview,
      ),
    );
    return true;
    // `currentTheme` is not read here, but it is what makes the DOM-resolved
    // candidate colours change — same reason the stroke builders depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    toolCommandPreviewSegments,
    toolCommandHighlightSegments,
    toolPreviewColor,
    activeToolDashedPreview,
    lineStyle,
    mode,
    foldAngleDisplay,
    currentTheme,
  ]);
  useEffect(() => {
    paintSequencePreviewRef.current = () => {
      if (paintSequencePreview()) renderNowRef.current();
    };
  }, [paintSequencePreview]);

  useEffect(() => {
    if (!rendererRef.current) return;
    if (paintSequencePreview()) {
      renderNowRef.current();
      return;
    }
    if (!sequencePreviewOwnedRef.current) return;
    clearPreview();
    renderNowRef.current();
  }, [paintSequencePreview, rendererGeneration, clearPreview]);

  // Repaint a live drag preview when the crease colour changes under it --
  // holding Control mid-drag inverts the colour, and the stroke should follow at
  // once rather than on the next pointer move.
  useEffect(() => {
    const renderer = rendererRef.current;
    const segments = toolPreviewSegmentsRef.current;
    if (!renderer || !segments) return;
    renderer.setPreview(previewSegmentsToStrokes(segments, toolPreviewColor));
    renderNowRef.current();
  }, [toolPreviewColor, rendererGeneration]);

  // Diagnostic overlays (CAMV / check-fix): shape markers + segment highlights, built
  // model-space by the panel and forwarded straight to the renderer's overlay layer.
  useEffect(() => {
    rendererRef.current?.setDiagnosticMarkers(
      diagnosticMarkers.count > 0 ? diagnosticMarkers : null,
    );
    renderNowRef.current();
  }, [diagnosticMarkers, rendererGeneration]);
  useEffect(() => {
    rendererRef.current?.setDiagnosticStrokes(
      diagnosticStrokes.count > 0 ? diagnosticStrokes : null,
    );
    renderNowRef.current();
  }, [diagnosticStrokes, rendererGeneration]);
  useEffect(() => {
    rendererRef.current?.setDiagnosticWedges(diagnosticWedges.count > 0 ? diagnosticWedges : null);
    renderNowRef.current();
  }, [diagnosticWedges, rendererGeneration]);
  useEffect(() => {
    rendererRef.current?.setDiagnosticFills(
      contradictionFaceFills.count > 0 ? contradictionFaceFills : null,
    );
    renderNowRef.current();
  }, [contradictionFaceFills, rendererGeneration]);
  useEffect(() => {
    rendererRef.current?.setOverlayFrame(operationFrame);
    renderNowRef.current();
  }, [operationFrame, rendererGeneration]);
  useEffect(() => {
    rendererRef.current?.setImportedForms(importedForms);
    renderNowRef.current();
  }, [importedForms, rendererGeneration]);

  // Reference-image layer: upload/evict textures when the image list changes,
  // then redraw. Textures are cached by `src` in the renderer, so transform-only
  // edits (move/resize/rotate/crop) re-run this cheaply without re-uploading.
  useEffect(() => {
    rendererRef.current?.setImages(images ?? EMPTY_IMAGES);
    renderNowRef.current();
  }, [images, rendererGeneration]);

  // Every camera verb shares this: the camera is seeded lazily on the first draw,
  // so before then there is nothing to move and the verb is a no-op. Redraws once,
  // here, so no verb has to remember to.
  const withCamera = useCallback(
    (move: (camera: UserCamera, viewport: Viewport, canvas: HTMLCanvasElement) => void) => {
      const canvas = canvasRef.current;
      const camera = cameraRef.current;
      if (!canvas || !camera || canvas.width === 0) return;
      move(camera, { width: canvas.width, height: canvas.height, dpr: 1 }, canvas);
      renderNowRef.current();
    },
    [],
  );

  // The camera as methods, published for the panel's toolbar and shortcuts and for
  // the store's jump-to-diagnostic. Registered rather than passed down: a check
  // command can be dispatched from the menu, which never touches the panel.
  useEffect(() => {
    const handle: CpCameraHandle = {
      zoomIn: () =>
        withCamera((camera, viewport) =>
          zoomUserCameraAt(camera, viewport, viewport.width / 2, viewport.height / 2, ZOOM_STEP),
        ),
      zoomOut: () =>
        withCamera((camera, viewport) =>
          zoomUserCameraAt(
            camera,
            viewport,
            viewport.width / 2,
            viewport.height / 2,
            1 / ZOOM_STEP,
          ),
        ),
      fit: () =>
        withCamera((camera, viewport) => {
          // Fit reframes; it does not straighten. Rotation is cleared only by the
          // explicit reset, so an unrelated framing command never discards it.
          const docBounds = liveRef.current.contentBounds;
          if (docBounds) {
            cameraRef.current = fitUserCamera(docBounds, viewport, undefined, camera.rotation);
          }
        }),
      setZoomPercent: (percent) =>
        withCamera((camera, viewport, canvas) => {
          const deviceRatio = viewport.width / Math.max(1, canvas.clientWidth);
          camera.zoom = cameraZoomForPercent(percent, deviceRatio);
        }),
      rotateBy: (radians) =>
        withCamera((camera) => {
          camera.rotation = normalizeCameraRotation(camera.rotation + radians);
        }),
      rotateTo: (radians) =>
        withCamera((camera) => {
          camera.rotation = normalizeCameraRotation(radians);
        }),
      rotateReset: () =>
        withCamera((camera) => {
          camera.rotation = 0;
        }),
      frameModelBounds: (bounds) =>
        withCamera((camera, viewport) => {
          // Model bounds → user coords via the current modelToSvg, taking all four
          // corners because the mapping may rotate or flip.
          const toUser = liveRef.current.modelToSvg;
          const corners = [
            toUser({ x: bounds.minX, y: bounds.minY }),
            toUser({ x: bounds.maxX, y: bounds.maxY }),
            toUser({ x: bounds.minX, y: bounds.maxY }),
            toUser({ x: bounds.maxX, y: bounds.minY }),
          ];
          const xs = corners.map((corner) => corner.x);
          const ys = corners.map((corner) => corner.y);
          cameraRef.current = frameUserCameraOnBounds(
            {
              minX: Math.min(...xs),
              minY: Math.min(...ys),
              maxX: Math.max(...xs),
              maxY: Math.max(...ys),
            },
            viewport,
            camera,
            liveRef.current.contentBounds,
          );
        }),
    };
    return registerCpCamera(handle);
  }, [withCamera]);

  // Voronoi seed markers: the kernel returns the current (snapped, toggled) seed set
  // as preview points; render them as dots so each mother point reads clearly. The
  // diagram lines themselves ride the preview-segments channel above.
  useEffect(() => {
    if (!activeToolVoronoi) return;
    const renderer = rendererRef.current;
    if (!renderer) return;
    const accent = readCssVarColor(
      document.documentElement,
      SELECTION_COLOR_VAR,
      SELECTION_FALLBACK,
    );
    renderer.setOverlayPoints(
      toolCommandPreviewPoints.length > 0
        ? sequenceOverlayPoints([], null, accent, toolCommandPreviewPoints)
        : null,
    );
    renderNowRef.current();
  }, [activeToolVoronoi, toolCommandPreviewPoints]);

  // Losing focus can happen with the pointer parked over the figure — Escape, or
  // a selection elsewhere — and no pointer event follows to correct the cursor.
  const focusedFigureId = foldedOrbit?.focusedId ?? null;
  useEffect(() => {
    if (focusedFigureId != null) return;
    foldedOrbitPointerRef.current = 'none';
    setFoldedOrbitPointer('none');
  }, [focusedFigureId]);

  const cursor = cpCanvasCursor({
    panToolActive,
    panModifierHeld,
    panDragging,
    foldedOrbitHovered: foldedOrbitPointer === 'over',
    foldedOrbitDragging: foldedOrbitPointer === 'turning',
  });

  return (
    <>
      <canvas
        ref={canvasRef}
        className={className}
        style={cursor ? { cursor } : undefined}
        aria-hidden="true"
      />
      {/* Absolutely positioned over `.cp-panel__viewport`, which is the
          positioning context and already hosts the other canvas overlays. */}
      {rendererError !== null && <CpRendererUnavailable reason={rendererError} />}
    </>
  );
}
