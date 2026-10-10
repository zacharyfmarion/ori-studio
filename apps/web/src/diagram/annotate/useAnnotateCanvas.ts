import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { trackDiagramAnnotationAdded, trackDiagramEnlargementChanged, trackDiagramMarkStyled } from '../../analytics';
import {
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_ROTATE_INK,
  DIAGRAM_TURN_OVER_INK,
} from '../../cp-workspace/references/diagram/diagramInk';
import { useViewportSurface } from '../../hooks/useViewportSurface';
import { readHeldModifiers, subscribeHeldModifiers } from '../../keyboard/heldModifiers';
import { unionPlotRect, type PlotRect } from '../../lib/geometry';
import { isPrimaryModifier } from '../../lib/platform';
import { transformHandleSizes } from '../../lib/transformBox';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectedDiagramPathNode } from '../../store/workspaceStore/diagramState';
import {
  isKnownAnnotation,
  stepById,
  type DiagramAnnotation,
  type DiagramIdFactory,
  type DiagramAnnotationKind,
  type DiagramAsset,
  type DiagramStep,
  type DiagramStyle,
  type DiagramZoomOutline,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { paintSource, stepPictureSource, type PictureBox } from '../pictures/paintDiagramStep';
import { stepPictureFrame } from '../pictures/pictureFrame';
import { stepPictureUrl } from '../pictures/useStepPictureUrl';
import { ZOOM_CARD_MARGIN, zoomedSource, type ZoomedSource } from '../zoom/paintZoomed';
import { marksBox, marksInWindow } from '../zoom/stepView';
import { useAnchorPick } from '../zoom/useAnchorPick';
import { anchorFaceRing } from '../zoom/zoomAnchor';
import { intoBox, outlineFromBox, outlineIntoBox, setFrameOutline } from '../zoom/zoomFrames';
import { draggedOutline, sameOutline, zoomGripAt, type ZoomGrip } from '../zoom/zoomGrips';
import {
  distanceToRim,
  frameWindow,
  stepReach,
  withZoomOutline,
  zoomAreaFromCorners,
  zoomOutlineOf,
  ZOOM_FRAME_ID,
} from '../zoom/zoomModel';
import { registerDiagramGestureCancel, registerDiagramViewCamera } from '../useDiagramShortcuts';
import { EDIT_PATH, drawingKind, drawingLook, isPickTool, type DrawingLook } from './annotateTools';
import { placePoint, snapOutcome, snapsAnchor, snapsEnd, snapsWhenPlaced, type PlacedPoint } from './annotateSnap';
import { annotationActionEdit, editAnnotation } from './annotationActions';
import { annotationEventDetail, annotationEventKind } from './annotationEventKind';
import {
  circleRadius,
  hitAnnotation,
  hitPathGrip,
  type AnnotationGrip,
  type HitOptions,
  type HitSizes,
  type PathGripPart,
} from './annotationHit';
import { isCornerNode, pathRepresentation, sameRepresentation, splitPathSegment, type PathRepresentation } from './annotationPath';
import { applyAnnotationEdit } from './applyAnnotationEdit';
import { dragPath, pathDragEdit, pathGripAnchor, type PathModifiers } from './editPathGesture';
import {
  LABEL_SIZE,
  MIN_ANNOTATION_LENGTH,
  RIGHT_ANGLE_DIAGONAL,
  canBeShaped,
  carriesText,
  closeUpShape,
  createAnnotation,
  areaFromCorners,
  eyeLooking,
  frameOf,
  isAreaKind,
  isCornerKind,
  isDegenerate,
  isHungText,
  isPointKind,
  moveAnnotation,
  moveAnnotationEnd,
  moveLabelWords,
  placedByClick,
  rightAngleAt,
  rightAngleDiagonal,
  withAnnotationReach,
  withCloseUpRing,
  withColor,
  withTextStyle,
  withWhiteArrowLook,
  type PictureFrame,
  type PicturePoint,
} from './annotationModel';
import { cancelFieldFocus, pendingFieldFocus, requestFieldFocus } from './fieldFocus';
import { draggedDivisions } from './divisionsPlacement';
import { hasTransformBox, transformDragged } from './transformGrips';
import { nearestLine } from './nearestLine';
import { setToolNotice } from './pickProgress';
import type { PickedLine } from './angleBisector';
import { isViewportInteractiveTarget } from '../../components/panels/ViewportToolbar';
import { annotationDrawing, annotationReach, calloutPen } from './annotationPrimitives';
import { CARD_FRAME_PX } from './paintAnnotations';
import { xrayAnchorDrawn, xrayFacesOf } from '../xray/xrayScene';
import { INK_UNITS } from './canvasInk';
import type { SnapTarget } from './pictureSnap';
import { useAnnotateSnap } from './useAnnotateSnap';
import { useAnnotateToolInHand } from './useAnnotateToolInHand';
import { usePickTool } from './usePickTool';
import {
  clickedOpening,
  draggedOpening,
  placeRightAngle,
  squaredOpening,
  type RightAngleStart,
} from './rightAnglePlacement';

/** The frame's longer side in the canvas's world, CSS px: big enough that the picture is sharp at fit. */
export const ANNOTATE_FRAME_PX = 1000;
/**
 * The room round the picture the camera frames, as a share of its frame. A
 * press reaches further: anywhere on the stage, as far as an annotation may
 * (`ANNOTATION_REACH`).
 */
const WORLD_MARGIN = 0.25;
/** How far a press may travel and still be a click, in screen px: a finger drifts further than a mouse or a pen. */
const DRAG_SLOP_PX = { fine: 4, touch: 10 } as const;
/** How near a press must be to take hold of something, in screen px: a mouse's, a finger's. */
const REACH_PX = { fine: 8, coarse: 18 } as const;
/**
 * How soon and how near a second press must come to make a double-click (or
 * a double tap): the canvas counts them itself, as a pointer event's own
 * `detail` is not a click count in every browser.
 */
const DOUBLE_PRESS = { ms: 500, px: { fine: 6, touch: 16 } } as const;

const DRAFT_ID = 'annotation-draft';

/** How far the canvas zooms in and out: the camera's bounds. */
export const ANNOTATE_CAMERA_SCALE = { min: 0.1, max: 12 } as const;
const [CANVAS_MIN_SCALE, CANVAS_MAX_SCALE] = [ANNOTATE_CAMERA_SCALE.min, ANNOTATE_CAMERA_SCALE.max];

/**
 * How far round an enlarged step's frame the canvas shows once the frame is
 * selected, in frame lengths each way: room to see the picture round it and
 * to drag its grips out (Revision 2).
 */
const FRAME_SELECTED_REACH = 0.35;

function sameBox(a: PictureBox, b: PictureBox): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * A sign's reach from its centre, in picture units, as a card and the canvas
 * draw it: half the turn-over glyph, or the rotate glyph's circle and heads.
 */
export const GLYPH_REACH =
  Math.max(DIAGRAM_TURN_OVER_INK / 2, DIAGRAM_ROTATE_INK.radius + DIAGRAM_ARROWHEAD_INK.length / 2) * INK_UNITS;

// One ink in picture units, as the canvas draws: `canvasInk.ts` owns it, for the model's derived shapes too.
export { INK_UNITS };

/** A callout's outline's pen in picture units, as the canvas draws it in `style`. */
export function calloutPenUnits(style: DiagramStyle): number {
  return calloutPen(style) / CARD_FRAME_PX;
}

/** A circle's ring, in picture units, as the canvas draws it. */
export const CIRCLE_RADIUS = circleRadius(INK_UNITS);

/** What every press carries: its pointer, where it began on screen, its slop, the diagram it began on. */
interface Press {
  pointerId: number;
  client: [number, number];
  slop: number;
  loadId: number;
  moved: boolean;
}

/**
 * What the canvas reads of a pointer event: where, which pointer, and the
 * keys held — a real event's, or the last one's again with the keys held now
 * when only a key changed.
 */
type PointerInput = Pick<
  PointerEvent,
  'pointerId' | 'pointerType' | 'clientX' | 'clientY' | 'buttons' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'target'
>;

/**
 * A press in progress: a new annotation being drawn, one being moved, or —
 * in Edit Path — a fold arrow's node, handle or curve taken hold of. A path
 * gesture keeps where the part was (`anchor`) and what the arrow was made of
 * (`representation`), and is let go if an edit under it changes that. A
 * drawing's start is where the press landed, snapped (`startTarget` what to);
 * `free` says whether ⌘ was held when it began.
 */
type Gesture =
  | (Press & {
      mode: 'draw';
      kind: DiagramAnnotationKind;
      /** The look the tool lays it in, over its kind's own: the Solid Arrow's (15d), an enlarge area's shape (Revision 2). */
      look: DrawingLook;
      start: PicturePoint;
      startTarget: SnapTarget | null;
      free: boolean;
      /** A right angle's: the way a click opens it, when the press was in a right angle there (decision 12). */
      opens?: PicturePoint | null;
      /** Where the pointer pressed, unsnapped: the line equal divisions clicked there divide (Revision 2). */
      pressed: PicturePoint;
    })
  /** `px` is one screen px in picture units as the press was made: what a transform box's handles were drawn at (Revision 3). */
  | (Press & { mode: 'move'; grip: AnnotationGrip; original: KnownDiagramAnnotation; start: PicturePoint; px: number })
  /** An enlarged step's frame taken hold of (Revision 2): moved by its centre or rim, resized by a grip, in the canvas's units. */
  | (Press & { mode: 'frame'; grip: ZoomGrip; original: DiagramZoomOutline; start: PicturePoint })
  | (Press & {
      mode: 'path';
      grip: PathGripPart;
      original: KnownDiagramAnnotation;
      start: PicturePoint;
      anchor: PicturePoint;
      representation: PathRepresentation;
      /** Shift and Alt as the preview last drew them: the drop lands where it was shown. */
      modifiers: PathModifiers;
    });

/**
 * The last press, for counting a double-click: when and where, how many
 * presses it ended, the node its click added to the curve, if it did — which
 * the second press of the same double-click must not turn into a corner —
 * and the arrow its click selected, if it did, which the second press must
 * not shape at all: a double-click on an arrow picks it, as Select's does.
 */
interface LastPress {
  time: number;
  client: [number, number];
  count: number;
  added: { annotationId: string; node: number } | null;
  selected: string | null;
}

/**
 * The right-angle mark a click would put down where the pointer is (decision
 * 12): its corner and the way it opens, shown over the marks, never in them.
 */
export interface RightAnglePreview {
  at: PicturePoint;
  opens: PicturePoint;
}

/**
 * What a press with Select would take of a selected star's, eye's or shape's transform box
 * (Revision 3): its body, which moves it; a scale square; or a turn handle.
 * The view's cursor says which, as the Edit canvas's box does: `move`,
 * `pointer` and `grab`.
 */
export type TransformHover = 'body' | 'scale' | 'rotate';

function sameRightAngle(a: RightAnglePreview | null, b: RightAnglePreview | null): boolean {
  if (a === null || b === null) return a === b;
  return a.at[0] === b.at[0] && a.at[1] === b.at[1] && a.opens[0] === b.opens[0] && a.opens[1] === b.opens[1];
}

/** Where the picture and its frame sit in the canvas's world, in world px. */
export interface AnnotateLayout {
  world: PlotRect;
  /** The painted picture's box. */
  picture: PictureBox;
  /** The frame's box: where picture units are measured. */
  frame: PictureBox;
  /** The frame in picture units. */
  pictureFrame: PictureFrame;
  /** World px per picture unit: the frame's longer side. */
  unit: number;
}

/**
 * What the canvas's fit frames, in world px: the picture and every mark the
 * step draws past it, as a page leaves them room — a close-up beside the
 * picture among them (15f). On an enlarged step (`enlarged`) its window
 * alone: a page sizes it by what lies inside it, and a mark reaching out of
 * it, or copied in from the whole picture and lying off it, counts for
 * neither (Zach, 2026-10-07). An x-ray's window with `xRays`: on a step whose
 * picture has the layers it is drawn on (Revision 3).
 */
export function annotateFitRect(
  layout: AnnotateLayout,
  annotations: readonly DiagramAnnotation[],
  style: DiagramStyle,
  enlarged: boolean,
  xRays = false
): PlotRect {
  return enlarged ? layout.picture : withMarksReach(layout, annotations, style, xRays);
}

/** The picture's box with what `annotations` draw past it, in world px: x-rays' windows with `xRays`, where they are drawn. */
function withMarksReach(layout: AnnotateLayout, annotations: readonly DiagramAnnotation[], style: DiagramStyle, xRays: boolean): PlotRect {
  const reach = annotationReach(annotationDrawing(annotations, layout.pictureFrame, CARD_FRAME_PX, style), { xRays });
  const k = layout.unit / CARD_FRAME_PX;
  return unionPlotRect(layout.picture, {
    x: layout.frame.x + reach.x * k,
    y: layout.frame.y + reach.y * k,
    width: reach.width * k,
    height: reach.height * k,
  });
}

/** A close-up's two rings, in world px: what has to be in view to see it whole (15f). */
function closeUpRings(annotation: KnownDiagramAnnotation, layout: AnnotateLayout): PlotRect {
  const { area, inset } = closeUpShape(annotation);
  const ring = ({ centre, radius }: { centre: PicturePoint; radius: number }): PlotRect => ({
    x: layout.frame.x + (centre[0] - radius) * layout.unit,
    y: layout.frame.y + (centre[1] - radius) * layout.unit,
    width: 2 * radius * layout.unit,
    height: 2 * radius * layout.unit,
  });
  return unionPlotRect(ring(area), ring(inset));
}

/**
 * What of a paste — the marks `ids` names — the canvas draws (`drawn`), in
 * world px: what has to be in view to see it (18d review). Null when it draws
 * none of it, as an enlarged step keeps a mark far off its window but draws
 * it nowhere (`marksInWindow`).
 */
export function pastedRect(layout: AnnotateLayout, drawn: readonly DiagramAnnotation[], ids: readonly string[]): PlotRect | null {
  const pasted = new Set(ids);
  const box = marksBox(drawn.filter(({ id }) => pasted.has(id)));
  return (
    box && {
      x: layout.frame.x + box.x * layout.unit,
      y: layout.frame.y + box.y * layout.unit,
      width: box.width * layout.unit,
      height: box.height * layout.unit,
    }
  );
}

/**
 * An enlarged step's window as the picture the canvas lays out: its frame is
 * the window, in any units — the canvas draws it at its own size — with the
 * margin its card gives it, so a fit leaves its boundary the room it leaves
 * any picture's edge, clear of the zoom pill.
 */
function windowPainted({ view }: ZoomedSource): { widthPx: number; heightPx: number; frame: PictureBox } {
  const { width, height } = view.window;
  const pad = Math.max(width, height) * ZOOM_CARD_MARGIN;
  return { widthPx: width + 2 * pad, heightPx: height + 2 * pad, frame: { x: pad, y: pad, width, height } };
}

/** Where an enlarged step's window sits in the canvas's world: the canvas's frame (Revision 2). */
export function zoomedCanvasLayout(zoomed: ZoomedSource): AnnotateLayout | null {
  return layoutFor(windowPainted(zoomed));
}

function layoutFor(painted: { widthPx: number; heightPx: number; frame: PictureBox }): AnnotateLayout | null {
  const longer = Math.max(painted.frame.width, painted.frame.height);
  const pictureFrame = frameOf(painted.frame.width, painted.frame.height);
  if (!(longer > 0) || !pictureFrame) return null;
  const scale = ANNOTATE_FRAME_PX / longer;
  const margin = WORLD_MARGIN * ANNOTATE_FRAME_PX;
  const picture = { x: margin, y: margin, width: painted.widthPx * scale, height: painted.heightPx * scale };
  return {
    world: { x: 0, y: 0, width: picture.width + 2 * margin, height: picture.height + 2 * margin },
    picture,
    frame: {
      x: margin + painted.frame.x * scale,
      y: margin + painted.frame.y * scale,
      width: painted.frame.width * scale,
      height: painted.frame.height * scale,
    },
    pictureFrame,
    unit: ANNOTATE_FRAME_PX,
  };
}

/**
 * The Annotate canvas's behaviour (AGENTS.md › Panel components): the
 * picture alone, its annotations drawn over it as they would print, the
 * camera, and every press — draw with a tool, or take hold of an annotation
 * or one of its ends and move it. A drag previews here and is committed once
 * when it lands, so it is one undo step, and Escape drops it with nothing to
 * take back. One finger or pen draws; a second one makes it a pinch, which
 * the camera takes, and the stroke in hand is dropped.
 *
 * In Edit Path (decision 3) a press on the selected fold arrow takes hold of
 * a node, a handle or its curve ({@link hitPathGrip}) and drags it
 * (`editPathGesture.ts`); a click on the curve adds a node there, and a
 * double-click on a node makes it a corner or smooth. Anywhere else it
 * selects, and moves nothing. A double-click on a fold arrow with Select
 * picks Edit Path up.
 *
 * Presses are the whole stage's — the view the camera pans, past the picture
 * and its margin, as far as an annotation may reach — but never a control's
 * floating over it, as the zoom pill does. `handlers` go on the view.
 */
export function useAnnotateCanvas({
  step,
  assets,
  style,
  readOnly,
}: {
  step: DiagramStep;
  assets: Readonly<Record<string, DiagramAsset>>;
  style: DiagramStyle;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  // What a new callout says, in the author's own language: the words become
  // theirs, printed as they read them, like anything typed (D8).
  const calloutText = t('panels:diagram.annotations.repeatBehind', 'Repeat behind');
  const coarse = useIsCoarsePointerSurface();
  // Select in place of an Enlarge tool on an enlarged step, which takes no area (Revision 2), and of the X-Ray tool
  // where the rail holds it (Revision 3, R3-18a A).
  const tool = useAnnotateToolInHand(step);
  // The line the Line tool draws (15a).
  const lineType = useSettingsStore((state) => state.diagramAnnotateLineType);
  // The colour it draws a solid line in (17a).
  const lineColor = useSettingsStore((state) => state.diagramAnnotateLineColor);
  // The style the Label tool sets its text in (17b).
  const textStyle = useSettingsStore((state) => state.diagramAnnotateTextStyle);
  const circleMode = useSettingsStore((state) => state.diagramAnnotateCircleMode);
  // The fill the Star tool lays (Revision 3, R3-4 C).
  const starFill = useSettingsStore((state) => state.diagramAnnotateStarFill);
  const selectedId = useWorkspaceStore((state) => state.diagramSelectedAnnotationId);
  const selectedNode = useWorkspaceStore(selectedDiagramPathNode);
  // The picture, from what it is made of: a text or an annotation edit keeps
  // these, so it is neither repainted nor taken for another picture.
  const { picture, source: pictureSource, unknown, zoom } = step;
  const source = useMemo(
    () => stepPictureSource({ ...step, picture, source: pictureSource, unknown }, assets),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the picture's inputs
    [picture, pictureSource, unknown, assets]
  );
  // An enlarged step's window is the canvas's frame (Revision 2): its marks are in its units.
  const zoomed = useMemo(
    () => zoomedSource({ ...step, picture, source: pictureSource, unknown, zoom }, assets),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the picture's and the frame's inputs
    [picture, pictureSource, unknown, zoom, assets]
  );
  // Where its marks may lie, and how large an area may grow, in their units: a drag's draft is held there as its edit is.
  const reach = useMemo(() => stepReach({ zoom, picture }), [zoom, picture]);
  const painted = useMemo(
    () => (zoomed ? windowPainted(zoomed) : source ? paintSource(source, style) : null),
    [zoomed, source, style]
  );
  // An enlarged step's marks far off its window: kept, but neither drawn, framed nor pressed.
  const zoomWindow = zoomed?.view.window ?? null;
  const viewed = useMemo(
    () => (zoomWindow ? marksInWindow(zoomWindow, step.annotations) : step.annotations),
    [zoomWindow, step.annotations]
  );
  // Whether its x-rays' windows are drawn: not on a picture with no layers (R3-18b A), where a rim nobody sees is
  // neither pressed nor framed (review of 18e).
  const xRaysDrawn = useMemo(() => xrayFacesOf(step) !== null, [step]);
  const pressable = useMemo((): HitOptions => ({ xRays: xRaysDrawn }), [xRaysDrawn]);
  // An enlarged step's frame in the canvas's units, its window's (Revision 2): a layer of the step,
  // selected by its boundary, and moved and resized by its grips.
  const frameOutline = useMemo(() => (zoomed ? outlineIntoBox(zoomed.view.window, zoomed.view.frame) : null), [zoomed]);
  /** The frame as a drag of it shows it, before it lands: an outline over the picture, nothing repainted. */
  const [frameDraft, setFrameDraft] = useState<DiagramZoomOutline | null>(null);
  // The Anchor row's pick mode, while it is armed for this step.
  const anchorPick = useAnchorPick({ step, window: zoomWindow });
  // An enlarged step's picture is drawn under its frame's clip (`DiagramZoomView`), not as an image of the whole.
  const url = useMemo(() => (source && !zoomed ? stepPictureUrl(source, style) : null), [source, zoomed, style]);
  const layout = useMemo(() => (painted ? layoutFor(painted) : null), [painted]);
  // What a fit frames: the picture and the marks past it, or an enlarged step's window alone.
  const framed = useMemo(
    () => (layout ? annotateFitRect(layout, viewed, style, zoomed !== null, xRaysDrawn) : undefined),
    [layout, zoomed, viewed, style, xRaysDrawn]
  );

  const camera = useViewportSurface({
    surface: null,
    spaceToPan: false,
    worldRect: layout?.world ?? { x: 0, y: 0, width: 1, height: 1 },
    fitRect: framed,
    fitAnchor: 'fit-rect',
    fitKey: `${step.id}:${layout ? 'laid-out' : 'waiting'}`,
    maxFitScale: 4,
  });
  const { handleViewportShortcut, containerRef, transformRef, spacePressed } = camera;
  useEffect(() => registerDiagramViewCamera(handleViewportShortcut), [handleViewportShortcut]);

  const overlay = useRef<SVGSVGElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  /** The pointers down on the overlay; more than one is a pinch, the camera's. */
  const pointers = useRef(new Set<number>());
  const pinching = useRef(false);
  const lastPress = useRef<LastPress | null>(null);
  /** The last pointer over the stage, for a key that changes what it would snap to without a move. */
  const lastPointer = useRef<PointerInput | null>(null);
  const [draft, setDraft] = useState<KnownDiagramAnnotation | null>(null);
  const snap = useAnnotateSnap({ step, assets, style, overlay, unit: layout?.unit ?? null });
  const { context: snapContext, show: showSnap } = snap;
  const [rightAngle, setRightAngle] = useState<RightAnglePreview | null>(null);
  /** Show the right angle a click would put down — none to clear it — re-rendering only for a change. */
  const showRightAngle = useCallback(
    (next: RightAnglePreview | null) => setRightAngle((current) => (sameRightAngle(current, next) ? current : next)),
    []
  );
  /** The right angle a click from `start` puts down: its corner, opening as a click opens it. */
  const clickPreview = useCallback(
    (start: RightAngleStart, frame: PictureFrame, free: boolean): RightAnglePreview => ({
      at: start.at,
      opens: clickedOpening(snapContext(), start, frame, { free }),
    }),
    [snapContext]
  );

  /**
   * What a press with Select would take of the selected star's, eye's or shape's transform box
   * under the pointer (Revision 3): its body, a scale square or a turn handle
   * — the cursor the view shows there, as the Edit canvas's box shows its own.
   */
  const [transformHover, setTransformHover] = useState<TransformHover | null>(null);

  /** The line a click with Equal Divisions would divide, under the pointer (Revision 2). */
  const [lineHover, setLineHover] = useState<PickedLine | null>(null);
  const showLineHover = useCallback(
    (next: PickedLine | null) => setLineHover((current) => (sameLine(current, next) ? current : next)),
    []
  );

  const cancel = useCallback(() => {
    showSnap([]);
    showRightAngle(null);
    showLineHover(null);
    if (!gesture.current) return false;
    gesture.current = null;
    setDraft(null);
    setFrameDraft(null);
    return true;
  }, [showSnap, showRightAngle, showLineHover]);
  // A tool picked, another step or another picture: whatever was in hand is
  // dropped, and what the last press could not do is no longer said.
  useEffect(
    () => () => {
      cancel();
      setToolNotice(null);
    },
    [cancel, step.id, tool, source]
  );
  // A field asks for the focus only while its annotation is the one selected.
  useEffect(() => {
    if (selectedId === null || selectedId !== pendingFieldFocus()?.annotationId) cancelFieldFocus();
  }, [selectedId]);
  useEffect(() => cancelFieldFocus, []);

  /**
   * Whether a press landed on the stage: on the surface the camera pans
   * (its wrapper, where it asks the same of its own presses), not on a
   * control floating over it.
   */
  const onStage = useCallback(
    (target: EventTarget | null) => {
      const surface = transformRef.current?.instance.wrapperComponent;
      return target instanceof Node && surface != null && surface.contains(target);
    },
    [transformRef]
  );

  // One finger is the pen's: the camera never sees it start, and pans with
  // two (its pinch). The camera listens on its wrapper, inside the view, so
  // this listens on the view in the capture phase, ahead of it.
  useEffect(() => {
    const view = containerRef.current;
    if (!view) return undefined;
    const keepOneFinger = (event: TouchEvent) => {
      if (event.touches.length < 2 && onStage(event.target)) event.stopPropagation();
    };
    view.addEventListener('touchstart', keepOneFinger, { capture: true, passive: true });
    return () => view.removeEventListener('touchstart', keepOneFinger, { capture: true });
  }, [containerRef, onStage]);


  /**
   * A client point in picture units, through the overlay's matrix wherever on
   * the stage it is. Not clamped to reach: the model keeps what a press makes
   * or moves within it (`createAnnotation`, `moveAnnotationEnd`,
   * `moveAnnotation`), and a press past the edge must not hit the mark at the
   * edge as if it were on it.
   */
  const toPicture = useCallback(
    (clientX: number, clientY: number): PicturePoint | null => {
      const svg = overlay.current;
      const matrix = svg?.getScreenCTM();
      if (!svg || !matrix || !layout) return null;
      const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
      return [(point.x - layout.frame.x) / layout.unit, (point.y - layout.frame.y) / layout.unit];
    },
    [layout]
  );

  /** How near a press must be, in picture units, at the zoom it is made at; and one screen px there. */
  const hitSizes = useCallback((): HitSizes => {
    const screenPerWorld = overlay.current?.getScreenCTM()?.a ?? 1;
    const px = 1 / (screenPerWorld * (layout?.unit ?? 1));
    const reach = (coarse ? REACH_PX.coarse : REACH_PX.fine) * px;
    return {
      tolerance: reach,
      glyph: GLYPH_REACH,
      label: LABEL_SIZE,
      ink: INK_UNITS,
      calloutPen: calloutPenUnits(style),
      px,
      handles: transformHandleSizes(coarse),
    };
  }, [coarse, layout, style]);

  /** The Angle Bisector's and the equal-angle mark's picks (15b), while one of them is in hand. */
  const picker = usePickTool({
    step,
    assets,
    style,
    tool,
    lineType,
    lineColor,
    readOnly,
    snapContext,
    showSnap,
    reach: () => hitSizes().tolerance,
  });
  const { unpick } = picker;
  // Escape: the drag in hand dropped, else the last pick taken back.
  useEffect(() => registerDiagramGestureCancel(() => cancel() || unpick()), [cancel, unpick]);

  /**
   * The annotations as the canvas draws them: the step's, and the one in hand
   * where it is now. Only a drag joins them — anything shown over the marks
   * for a moment stays out — so a pointer's every move recompiles at most the
   * one annotation that moved (`compiledAnnotation`), and nothing else redraws
   * the marks.
   */
  const shown = useMemo<readonly DiagramAnnotation[]>(() => {
    const withDraft = !draft
      ? viewed
      : draft.id === DRAFT_ID
        ? [...viewed, draft]
        : viewed.map((annotation) => (annotation.id === draft.id ? draft : annotation));
    // What a pick tool's next press would draw, under the pointer.
    return picker.drafts.length === 0 ? withDraft : [...withDraft, ...picker.drafts];
  }, [viewed, draft, picker.drafts]);

  const known = useCallback(
    (id: string) =>
      step.annotations.find(
        (annotation): annotation is KnownDiagramAnnotation => annotation.id === id && isKnownAnnotation(annotation)
      ),
    [step.annotations]
  );

  /**
   * What a press at `at` with Select would take of the selected star's, eye's or shape's box:
   * a scale square, a turn handle or its body; null off it, and with no box
   * selected.
   */
  const transformHoverAt = useCallback(
    (at: PicturePoint | null): TransformHover | null => {
      const selected = selectedId === null || at === null ? undefined : known(selectedId);
      if (!at || !selected || !hasTransformBox(selected)) return null;
      const hit = hitAnnotation(viewed, at, hitSizes(), selectedId, pressable);
      if (hit?.annotationId !== selected.id) return null;
      if (hit.part === 'transform') return hit.handle.kind === 'scale' ? 'scale' : 'rotate';
      return hit.part === 'body' ? 'body' : null;
    },
    [selectedId, known, viewed, hitSizes, pressable]
  );

  /**
   * Whether the tool in hand lays `kind`, the selected mark's own kind — a
   * star's with the Star, an eye's with the Eye, an oval's with the Oval, a
   * rectangle's with the Rectangle — so its box's handles take a press
   * before the tool draws (18d). Under any other tool that draws, the press
   * draws that tool's mark, even on the box: the squares sit on a shape's
   * corners and edges, where an arrow or a line is often started.
   */
  const handlesInHand = useCallback(
    (kind: DiagramAnnotationKind | null): boolean => {
      const selected = kind === null || selectedId === null ? undefined : known(selectedId);
      return selected?.kind === kind;
    },
    [selectedId, known]
  );

  /**
   * The selected mark's transform handle a press at `at` is on — a scale
   * square or a turn handle, as Select would take it, never the box's body —
   * and the mark. What a press with the mark's own tool still in hand takes
   * before it draws (`handlesInHand`): the box a star, an eye or a shape
   * just laid shows scales and turns it rather than laying another under the
   * press (18d). Null off its handles, and with no box selected.
   */
  const handleGripAt = useCallback(
    (at: PicturePoint): { grip: AnnotationGrip; original: KnownDiagramAnnotation } | null => {
      const selected = selectedId === null ? undefined : known(selectedId);
      if (!selected || !hasTransformBox(selected)) return null;
      const grip = hitAnnotation(viewed, at, hitSizes(), selectedId, pressable);
      return grip?.annotationId === selected.id && grip.part === 'transform' ? { grip, original: selected } : null;
    },
    [selectedId, known, viewed, hitSizes, pressable]
  );

  // The selected area's anchor face, or the selected frame's, outlined in the selection's ink, in the canvas's units.
  const anchorRingPicture = useMemo(() => {
    const area = selectedId === null || selectedId === ZOOM_FRAME_ID ? undefined : known(selectedId);
    const target =
      selectedId === ZOOM_FRAME_ID && zoomWindow
        ? ({ kind: 'frame' } as const)
        : area?.kind === 'zoom'
          ? ({ kind: 'area', area } as const)
          : null;
    return target ? anchorFaceRing(step, target) : null;
  }, [selectedId, known, step, zoomWindow]);
  // The selected x-ray's picked point, where its peeling starts, in the canvas's units (review of 18e, 18g).
  const anchorPoint = useMemo(() => {
    const selected = selectedId === null ? undefined : known(selectedId);
    const faces = selected?.kind === 'x-ray' && selected.anchor ? xrayFacesOf(step) : null;
    const at = faces && selected?.anchor ? xrayAnchorDrawn(faces, selected.anchor) : null;
    return at && zoomWindow ? intoBox(zoomWindow, at) : at;
  }, [selectedId, known, step, zoomWindow]);
  const anchorRing = useMemo(
    () => (anchorRingPicture && zoomWindow ? anchorRingPicture.map((point) => intoBox(zoomWindow, point)) : anchorRingPicture),
    [anchorRingPicture, zoomWindow]
  );
  // What the picture round a selected frame takes in besides the window (picture units): its anchor face,
  // outlined over it — or, while the pick mode asks for a face, the whole picture, so faces outside can be picked.
  const surroundAlso = useMemo((): PictureBox | null => {
    if (!zoomWindow || selectedId !== ZOOM_FRAME_ID) return null;
    if (anchorPick.picking === ZOOM_FRAME_ID) {
      const whole = stepPictureFrame(step, assets);
      return whole && { x: 0, y: 0, width: whole.width, height: whole.height };
    }
    return anchorRingPicture && boxOf(anchorRingPicture);
  }, [zoomWindow, selectedId, anchorPick.picking, step, assets, anchorRingPicture]);

  // The frame selected: the canvas steps back far enough to show the picture round it and reach its grips —
  // once, as it is selected, and not under a drag that selected it, which steps back when it lets go.
  const frameSelected = selectedId === ZOOM_FRAME_ID && frameOutline !== null;
  const { bringIntoView } = camera;
  const revealFrame = useCallback(() => {
    if (!layout) return;
    const { frame } = layout;
    const grow = FRAME_SELECTED_REACH * Math.max(frame.width, frame.height);
    bringIntoView({ x: frame.x - grow, y: frame.y - grow, width: frame.width + 2 * grow, height: frame.height + 2 * grow });
  }, [layout, bringIntoView]);
  useEffect(() => {
    if (frameSelected && !gesture.current) revealFrame();
    // Once, as it is selected: not again for every move of the frame while it stays selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameSelected]);
  // A paste on this step (18d review) lands where its marks were copied: out of view if the canvas is zoomed in
  // elsewhere, or beside an enlarged step's window when they come from another picture (Revision 2, decision 7).
  // The canvas steps back to show what of it is drawn, once, as it does for a close-up laid beside the picture (15f),
  // as soon as the step it is handed holds the paste; a paste made before it opened is not shown again.
  const pasted = useWorkspaceStore((state) => state.diagramPasted);
  const pasteSeen = useRef(pasted?.nonce ?? null);
  useEffect(() => {
    if (!pasted || pasted.nonce === pasteSeen.current) return;
    if (pasted.stepId === step.id && (!layout || !step.annotations.some(({ id }) => id === pasted.ids[0]))) return;
    pasteSeen.current = pasted.nonce;
    const rect = pasted.stepId === step.id && layout ? pastedRect(layout, viewed, pasted.ids) : null;
    if (rect) bringIntoView(rect);
  }, [pasted, step.id, step.annotations, layout, viewed, bringIntoView]);
  // The pick mode armed for the frame: the canvas steps back to its anchor face too, which may lie far off.
  const pickingFrame = anchorPick.picking === ZOOM_FRAME_ID;
  useEffect(() => {
    if (!pickingFrame || !layout || !anchorRing) return;
    const { frame, unit } = layout;
    const grow = FRAME_SELECTED_REACH * Math.max(frame.width, frame.height);
    const ring = boxOf(anchorRing);
    const x = Math.min(frame.x - grow, frame.x + ring.x * unit);
    const y = Math.min(frame.y - grow, frame.y + ring.y * unit);
    const right = Math.max(frame.x + frame.width + grow, frame.x + (ring.x + ring.width) * unit);
    const bottom = Math.max(frame.y + frame.height + grow, frame.y + (ring.y + ring.height) * unit);
    bringIntoView({ x, y, width: right - x, height: bottom - y });
    // Once, as the mode is armed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickingFrame]);

  /**
   * A frame dropped somewhere else: the camera kept so the picture stays
   * where it was on the screen — the canvas's frame is the window, so the
   * new window would otherwise draw the picture moved and resized under a
   * frame that seemed not to move. Set as the drop commits, applied once the
   * canvas is laid out on the new window.
   */
  const holdCamera = useRef<{ from: PictureBox; to: PictureBox } | null>(null);
  useLayoutEffect(() => {
    const held = holdCamera.current;
    const api = transformRef.current;
    if (!held || !zoomWindow || !layout || !api) return;
    holdCamera.current = null;
    if (!sameBox(held.to, zoomWindow)) return;
    const { positionX, positionY, scale } = api.instance.transformState;
    const [from, to] = [Math.max(held.from.width, held.from.height), Math.max(zoomWindow.width, zoomWindow.height)];
    const next = Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, (scale * to) / from));
    // A picture point p lands at s·(F + (p − W)·unit/|W|) + t on screen: the same for every p, before and after.
    const per = (scale * layout.unit) / from;
    const shift = (f: number, was: number, now: number, position: number) => position + f * (scale - next) + per * (now - was);
    api.setTransform(
      shift(layout.frame.x, held.from.x, zoomWindow.x, positionX),
      shift(layout.frame.y, held.from.y, zoomWindow.y, positionY),
      next,
      0
    );
  }, [zoomWindow, layout, transformRef]);

  /**
   * Where the pointer at `at` puts what is in hand, snapped as the mark it is
   * (decision 9): a drawing's end — a circle's centre — or a line's end, or
   * a callout's point, taken hold of with Select, never onto the annotation
   * itself (an arrow's end, never: `snapsWhenPlaced`); a circle moved whole, its centre, the press
   * keeping its offset from it. A callout's box never snaps (`snapsEnd`).
   * With ⌘ (Ctrl) held (`free`), where the pointer is. Edit Path's nodes and
   * handles never snap.
   */
  const placeInHand = useCallback(
    (current: Gesture, at: PicturePoint, free: boolean, shift = false): PlacedInHand => {
      const loose = { at, target: null };
      switch (current.mode) {
        case 'draw':
          if (current.kind === 'circle') return loose;
          // A right angle's drag says which way it opens from its corner: a point along that way.
          if (isCornerKind(current.kind)) {
            if (!layout) return loose;
            const opens =
              (current.moved ? draggedOpening(snapContext(), current.start, at, { free, shift }) : null) ??
              clickedOpening(
                snapContext(),
                { at: current.start, target: current.startTarget, opens: current.opens ?? null },
                layout.pictureFrame,
                { free: current.free }
              );
            return { at: along(current.start, opens), target: null };
          }
          // The end a drag puts down: a point kind's one place, anything else's `to`.
          return snapsEnd(current.kind, isPointKind(current.kind) ? 'from' : 'to')
            ? placePoint(snapContext(), at, { free })
            : loose;
        case 'move': {
          const { grip, original } = current;
          // Hung text's anchor (17b) snaps, as a callout's point does; its words, as any text, never.
          const anchor = (grip.part === 'from' || grip.part === 'to') && snapsAnchor(original, grip.part);
          if (!snapsWhenPlaced(original.kind) && !anchor) return loose;
          if (grip.part === 'direction') {
            // The way a right angle opens, turned toward the pointer: a point along it, or where it was.
            const opens = draggedOpening(snapContext(), original.from, at, { free, shift });
            return { at: opens ? along(original.from, opens) : original.to, target: null };
          }
          // A right angle whose corner lands on a point opens into the right angle there nearest the way it opened.
          const squared = (landed: PlacedPoint) =>
            isCornerKind(original.kind) && landed.target
              ? squaredOpening(snapContext(), landed.at, rightAngleDiagonal(original), { free: false })
              : undefined;
          if (grip.part === 'corner' || anchor || ((grip.part === 'from' || grip.part === 'to') && snapsEnd(original.kind, grip.part))) {
            const landed = placePoint(snapContext(), at, { free, ignore: original.id });
            return { ...landed, opens: squared(landed) };
          }
          if (grip.part === 'from' || grip.part === 'to') return loose;
          if (grip.part !== 'body' || !(isPointKind(original.kind) || isCornerKind(original.kind))) return loose;
          const centre: PicturePoint = [original.from[0] + at[0] - current.start[0], original.from[1] + at[1] - current.start[1]];
          const landed = placePoint(snapContext(), centre, { free, ignore: original.id });
          return {
            at: [at[0] + landed.at[0] - centre[0], at[1] + landed.at[1] - centre[1]],
            target: landed.target,
            opens: squared(landed),
          };
        }
        case 'path':
        case 'frame':
          return loose;
      }
    },
    [snapContext, layout]
  );

  /**
   * An Edit Path press: on the selected fold arrow's node, handle or curve, the
   * gesture it starts — a node is selected as it is pressed, and a
   * double-click on one turns it smooth or corner, but not the node the
   * double-click's own first click added to the curve (where its second
   * press lands). Off them it selects what is there — the node first goes,
   * then the arrow — and starts nothing.
   */
  const pressPath = useCallback(
    (at: PicturePoint, press: Press, count: LastPress): Gesture | null => {
      const store = useWorkspaceStore.getState();
      const selected = selectedId === null ? undefined : known(selectedId);
      const grip =
        selected && canBeShaped(selected.kind) ? hitPathGrip(selected, at, hitSizes().tolerance, selectedNode) : null;
      if (!selected || !grip) {
        const hit = hitAnnotation(viewed, at, hitSizes(), selectedId, pressable);
        if (hit !== null && hit.annotationId === selectedId) return null;
        if (hit === null && selectedNode !== null) store.selectDiagramPathNode(null);
        else store.selectDiagramAnnotation(hit?.annotationId ?? null);
        if (hit !== null) count.selected = hit.annotationId;
        return null;
      }
      // The second press of a double-click that picked this arrow: picked, and nothing more.
      if (count.count >= 2 && count.selected === selected.id) return null;
      if (grip.part === 'node') {
        const added = count.added;
        const justAdded = added !== null && added.annotationId === selected.id && added.node === grip.node;
        if (count.count >= 2 && !justAdded && !readOnly) {
          const id = isCornerNode(selected, grip.node) ? 'smooth-node' : 'corner-node';
          const edit = annotationActionEdit(id, selected.id, { node: grip.node });
          applyAnnotationEdit(store, step.id, edit, { loadId: press.loadId });
          store.selectDiagramPathNode(grip.node);
          // Spent: the press after it starts a count of its own, as a third click is no second double-click.
          lastPress.current = null;
          return null;
        }
        store.selectDiagramPathNode(grip.node);
      }
      if (readOnly) return null;
      const anchor = pathGripAnchor(selected, grip);
      const representation = pathRepresentation(selected);
      if (!anchor || !representation) return null;
      const modifiers = { shift: false, alt: false };
      return { mode: 'path', grip, original: selected, start: at, anchor, representation, modifiers, ...press };
    },
    [selectedId, known, hitSizes, selectedNode, viewed, pressable, step.id, readOnly]
  );

  /** A press anywhere on the canvas takes the keyboard there, as Edit's does: shortcuts pick tools. */
  const onPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!isViewportInteractiveTarget(event.target)) containerRef.current?.focus({ preventScroll: true });
    },
    [containerRef]
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!onStage(event.target)) return;
      pointers.current.add(event.pointerId);
      if (pointers.current.size > 1) {
        // A second finger: a pinch, not a stroke. Nothing in hand lands.
        pinching.current = true;
        cancel();
        return;
      }
      if (pinching.current || event.button !== 0 || spacePressed || !layout) return;
      const at = toPicture(event.clientX, event.clientY);
      if (!at) return;
      const count = nextPress(lastPress.current, event);
      lastPress.current = count;
      // What the last press could not do is said until the next.
      setToolNotice(null);
      const store = useWorkspaceStore.getState();
      const press = {
        pointerId: event.pointerId,
        client: [event.clientX, event.clientY] as [number, number],
        // A finger drifts as it lifts; a mouse or a pen does not.
        slop: event.pointerType === 'touch' ? DRAG_SLOP_PX.touch : DRAG_SLOP_PX.fine,
        loadId: store.diagramLoadId,
        moved: false,
      };
      if (anchorPick.picking !== null) {
        // The Anchor row's pick mode, whatever tool is in hand: a click anchors (Revision 2).
        anchorPick.press(at);
        event.preventDefault();
        return;
      }
      if (isPickTool(tool)) {
        // A pick, on the press: the Angle Bisector's, or the equal-angle mark's (15b).
        if (picker.press(at, isPrimaryModifier(event))) event.preventDefault();
        return;
      }
      const kind = drawingKind(tool, lineType);
      // The selected mark's box, a handle pressed with that mark's own tool in hand: the handle's (18d).
      const handle = handlesInHand(kind) && !readOnly ? handleGripAt(at) : null;
      if (handle) {
        gesture.current = { mode: 'move', grip: handle.grip, original: handle.original, start: at, px: hitSizes().px, ...press };
      } else if (kind !== null) {
        // An enlarged step is not enlarged again (yet): the Enlarge tools draw nothing on it. (Nor is an x-ray cut where
        // the rail holds its tool: Select is in hand there, `useAnnotateToolInHand`.)
        if (readOnly || (kind === 'zoom' && step.zoom)) return;
        const free = isPrimaryModifier(event);
        // A right angle's corner, and the way a click opens it when the press is in a right angle.
        const start = isCornerKind(kind)
          ? placeRightAngle(snapContext(), at, { free })
          : { ...(snapsEnd(kind, 'from') ? placePoint(snapContext(), at, { free }) : { at, target: null }), opens: null };
        gesture.current = {
          mode: 'draw',
          kind,
          look: { ...drawingLook(tool, { type: lineType, color: lineColor }, textStyle, starFill), circleMode },
          start: start.at,
          startTarget: start.target,
          free,
          opens: start.opens,
          pressed: at,
          ...press,
        };
        showLineHover(null);
        // Where the press landed, at once: a finger sees it before its slop — and a right angle, the mark a click puts down.
        showSnap([start.target]);
        showRightAngle(isCornerKind(kind) && layout ? clickPreview(start, layout.pictureFrame, free) : null);
      } else if (tool === EDIT_PATH) {
        const started = pressPath(at, press, count);
        if (!started) return;
        gesture.current = started;
      } else {
        const reach = hitSizes().tolerance;
        // An enlarged step's frame, selected (Revision 2): its grips before anything drawn over it.
        const frameGrip =
          selectedId === ZOOM_FRAME_ID && frameOutline && !readOnly ? zoomGripAt(frameOutline, at, reach) : null;
        // Selecting is not an edit: a diagram that cannot change still selects.
        const grip = frameGrip ? null : hitAnnotation(viewed, at, hitSizes(), selectedId, pressable);
        // Under every mark, the frame's boundary: it selects the frame, and moves it.
        const onFrame = frameGrip !== null || (!grip && frameOutline !== null && distanceToRim(frameOutline, at) <= reach);
        const original = grip ? known(grip.annotationId) : undefined;
        store.selectDiagramAnnotation(onFrame ? ZOOM_FRAME_ID : (grip?.annotationId ?? null));
        if (onFrame && frameOutline) {
          if (readOnly) return;
          gesture.current = { mode: 'frame', grip: frameGrip ?? { part: 'centre' }, original: frameOutline, start: at, ...press };
        } else {
          if (readOnly || !grip || !original) return;
          if (count.count >= 2 && canBeShaped(original.kind)) {
            // A double-click on a fold arrow: Edit Path, to shape it. Spent: the
            // click after it is Edit Path's first, which picks a node.
            store.setDiagramAnnotateTool(EDIT_PATH);
            lastPress.current = null;
            return;
          }
          gesture.current = { mode: 'move', grip, original, start: at, px: hitSizes().px, ...press };
        }
      }
      // Held by the stage, not the view: a browser shows the cursor of the
      // element holding a pointer, and the tool's crosshair is the stage's.
      // Its events still bubble to these handlers on the view.
      (transformRef.current?.instance.wrapperComponent ?? event.currentTarget).setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [
      onStage,
      cancel,
      spacePressed,
      readOnly,
      layout,
      toPicture,
      tool,
      lineType,
      lineColor,
      textStyle,
      starFill,
      circleMode,
      picker,
      viewed,
      pressable,
      hitSizes,
      selectedId,
      known,
      handlesInHand,
      handleGripAt,
      pressPath,
      transformRef,
      snapContext,
      showSnap,
      showRightAngle,
      showLineHover,
      clickPreview,
      anchorPick,
      step,
      frameOutline,
    ]
  );

  /**
   * The annotation a move makes of `annotation`, the press placed at `at`
   * ({@link placeInHand}). A circle whose centre snapped is put on its target
   * exactly, not moved by a difference that rounds. Shift held holds a
   * close-up's scale to halves, and keeps an enlarge area's aspect; Alt
   * resizes an area about its centre.
   */
  const moved = (
    current: Extract<Gesture, { mode: 'move' }>,
    annotation: KnownDiagramAnnotation,
    { at, target, opens }: PlacedInHand,
    keys: { shift: boolean; alt: boolean }
  ) => {
    const { grip } = current;
    const halves = keys.shift;
    switch (grip.part) {
      case 'body':
        // Equal divisions belong to their line: a drag of the mark sets how far off it they stand (ED2).
        if (annotation.kind === 'divisions') return draggedDivisions(annotation, current.start, at, { halves });
        // Hung text taken by its words (17b): they go by the pointer's travel, its anchor left where it is.
        if (isHungText(annotation)) return moveLabelWords(annotation, [at[0] - current.start[0], at[1] - current.start[1]]);
        if (target && isPointKind(annotation.kind)) return moveAnnotationEnd(annotation, 'from', target.at);
        if (target && isCornerKind(annotation.kind)) return opening(moveAnnotationEnd(annotation, 'from', target.at), opens);
        return moveAnnotation(annotation, [at[0] - current.start[0], at[1] - current.start[1]]);
      case 'from':
      case 'to':
        return moveAnnotationEnd(annotation, grip.part, at);
      case 'box':
        // Taken anywhere on it, it goes by the pointer's travel, its point left where it is.
        return moveAnnotationEnd(annotation, 'to', [
          annotation.to[0] + at[0] - current.start[0],
          annotation.to[1] + at[1] - current.start[1],
        ]);
      case 'node':
      case 'handle':
      case 'segment':
        // Edit Path's own gesture holds these (`mode: 'path'`), never a move.
        return annotation;
      case 'corner':
        // A right angle's corner: the mark moves whole, and opens square into a right angle where it lands.
        return opening(moveAnnotationEnd(annotation, 'from', at), opens);
      case 'direction':
        // The way it opens, turned toward the point the pointer gave (`placeInHand`).
        return moveAnnotationEnd(annotation, 'to', at);
      case 'circle': {
        // A close-up's circle, taken anywhere inside: it goes by the pointer's
        // travel, the other left where it is.
        const [x, y] = annotation[grip.end];
        return moveAnnotationEnd(annotation, grip.end, [x + at[0] - current.start[0], y + at[1] - current.start[1]]);
      }
      case 'ring': {
        // A close-up's ring goes in or out as far as the pointer has from where
        // it took hold: the area's sets its radius, the close-up's its scale.
        const { area, inset } = closeUpShape(annotation);
        const { centre, radius } = grip.end === 'from' ? area : inset;
        const away = (point: PicturePoint) => Math.hypot(point[0] - centre[0], point[1] - centre[1]);
        return withCloseUpRing(annotation, grip.end, radius + away(at) - away(current.start), halves);
      }
      case 'offset':
        // The handle at the middle of equal divisions' line: as a drag of the mark.
        return draggedDivisions(annotation, current.start, at, { halves });
      case 'zoom':
        // An enlarge area's grip (Revision 2): its centre moves it, its rim, corners and edges resize it.
        return withZoomOutline(annotation, draggedOutline(zoomOutlineOf(annotation), grip.zoom, current.start, at, keys));
      case 'transform':
        // A star's, an eye's or a shape's transform box (Revision 3): a square resizes it as its kind does with the
        // keys held — a glyph about its centre, a shape freely, Shift its proportions, Alt its centre — and a turn
        // handle turns it, Shift by 15°.
        return transformDragged(annotation, grip.handle, current.start, at, { px: current.px, shift: keys.shift, alt: keys.alt });
    }
  };

  /**
   * A pointer over the stage with nothing in hand (hover is new): with a tool
   * that snaps, the target a press here would land on — shown over the marks,
   * never drawn into them. A finger has no hover; it sees its target on the
   * press.
   */
  const hover = useCallback(
    (input: PointerInput) => {
      if (anchorPick.picking !== null) {
        // The face a click would anchor to, under the pointer (Revision 2).
        const over = !spacePressed && !pinching.current && input.buttons === 0 && onStage(input.target);
        anchorPick.hover(over ? toPicture(input.clientX, input.clientY) : null);
        showSnap([]);
        return;
      }
      if (isPickTool(tool)) {
        const over = !readOnly && !spacePressed && !pinching.current && input.buttons === 0 && onStage(input.target);
        picker.hover(over ? toPicture(input.clientX, input.clientY) : null, isPrimaryModifier(input));
        return;
      }
      const kind = drawingKind(tool, lineType);
      // Over the selected star's, eye's or shape's box, what a press there would take of it: with Select, any of it; with
      // the mark's own tool in hand, only a handle, which takes the press before a draw (18d) — its body is drawn on; with
      // any other tool, none of it.
      const inHand = handlesInHand(kind);
      const boxed = (tool === null || inHand) && !readOnly && !spacePressed && !pinching.current && input.buttons === 0;
      const overBox = boxed && onStage(input.target) ? transformHoverAt(toPicture(input.clientX, input.clientY)) : null;
      const onHandle = inHand && overBox !== null && overBox !== 'body';
      setTransformHover(tool === null || onHandle ? overBox : null);
      if (onHandle) {
        // Nothing would be drawn: no snap, line or right angle is shown for it.
        showLineHover(null);
        showSnap([]);
        showRightAngle(null);
        return;
      }
      const looking =
        kind !== null && snapsWhenPlaced(kind) && !readOnly && !spacePressed && !pinching.current && input.buttons === 0;
      const at = looking && onStage(input.target) ? toPicture(input.clientX, input.clientY) : null;
      const free = isPrimaryModifier(input);
      // The line a click would divide, seen before it is taken: on a flat
      // fold, a covered face's edge among them (Revision 2).
      showLineHover(kind === 'divisions' && at ? nearestLine(step, assets, style, at, hitSizes().tolerance, { whole: true }) : null);
      if (kind !== null && isCornerKind(kind)) {
        // The corner a press here snaps to, and the mark a click puts down in it.
        const start = at ? placeRightAngle(snapContext(), at, { free }) : null;
        showSnap([start?.target ?? null]);
        showRightAngle(start && layout ? clickPreview(start, layout.pictureFrame, free) : null);
        return;
      }
      showSnap([at ? placePoint(snapContext(), at, { free }).target : null]);
    },
    [
      tool,
      lineType,
      picker,
      readOnly,
      spacePressed,
      onStage,
      toPicture,
      snapContext,
      showSnap,
      showRightAngle,
      showLineHover,
      layout,
      clickPreview,
      step,
      assets,
      style,
      hitSizes,
      anchorPick,
      transformHoverAt,
      handlesInHand,
    ]
  );

  const pointerMoved = useCallback(
    (event: PointerInput) => {
      lastPointer.current = pick(event);
      const current = gesture.current;
      if (!current) {
        if (event.pointerType !== 'touch') hover(event);
        return;
      }
      if (current.pointerId !== event.pointerId || !layout) return;
      if (!current.moved && Math.hypot(event.clientX - current.client[0], event.clientY - current.client[1]) < current.slop) {
        return;
      }
      const pointer = toPicture(event.clientX, event.clientY);
      if (!pointer) return;
      current.moved = true;
      // The drag draws the mark itself now.
      showRightAngle(null);
      if (current.mode === 'frame') {
        // An outline over the picture as it is: nothing is painted again until it lands.
        setFrameDraft(
          draggedOutline(current.original, current.grip, current.start, pointer, { shift: event.shiftKey, alt: event.altKey })
        );
        return;
      }
      if (current.mode === 'path') {
        // An undo or another edit made the arrow something else under the drag: let it go.
        if (!sameRepresentation(current.representation, pathRepresentationOf(liveAnnotation(step.id, current)))) {
          cancel();
          return;
        }
        current.modifiers = { shift: event.shiftKey, alt: event.altKey };
        setDraft(pathDragged(current, current.original, pointer, current.modifiers));
        return;
      }
      const placed = placeInHand(current, pointer, isPrimaryModifier(event), event.shiftKey);
      if (current.mode === 'draw') {
        const point = isPointKind(current.kind) && current.kind !== 'circle';
        const start = point ? placed.at : current.start;
        setDraft(
          laid(
            current.kind,
            current.look,
            start,
            placed.at,
            layout.pictureFrame,
            { shift: event.shiftKey, alt: event.altKey },
            () => DRAFT_ID,
            calloutText
          )
        );
        showSnap([point ? null : current.startTarget, placed.target]);
        return;
      }
      setDraft(withAnnotationReach(reach, () => moved(current, current.original, placed, { shift: event.shiftKey, alt: event.altKey })));
      showSnap([placed.target]);
    },
    [layout, toPicture, cancel, step.id, hover, placeInHand, showSnap, showRightAngle, calloutText, reach]
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => pointerMoved(event.nativeEvent), [pointerMoved]);

  /** The pointer gone from the stage, with nothing in hand: no target to show. */
  const onPointerLeave = useCallback(() => {
    lastPointer.current = null;
    if (gesture.current) return;
    setTransformHover(null);
    showSnap([]);
    showRightAngle(null);
    showLineHover(null);
  }, [showSnap, showRightAngle, showLineHover]);

  // ⌘ pressed or let go with the pointer still: what it would snap to, or what
  // the drag in hand lands on, changes all the same. Held keys are tracked for
  // the whole window, wherever the focus is (`heldModifiers.ts`).
  const refreshForKeys = useRef<() => void>(() => undefined);
  useEffect(() => {
    refreshForKeys.current = () => {
      const last = lastPointer.current;
      if (!last) return;
      const held = readHeldModifiers();
      pointerMoved({ ...last, metaKey: held.meta, ctrlKey: held.ctrl, shiftKey: held.shift, altKey: held.alt });
    };
  }, [pointerMoved]);
  useEffect(() => subscribeHeldModifiers(() => refreshForKeys.current()), []);
  // Another mark selected, or another tool: the box under a still pointer is asked again — its cursor
  // alone, so what a tool would snap to is still shown only once the pointer moves.
  useEffect(() => {
    const last = lastPointer.current;
    if (gesture.current) return;
    const selecting = last !== null && tool === null && !readOnly && !spacePressed && last.buttons === 0 && onStage(last.target);
    setTransformHover(selecting ? transformHoverAt(toPicture(last.clientX, last.clientY)) : null);
    // Only as the selection or the tool changes: a move asks on its own (`hover`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, tool]);

  // The camera moved under a still pointer — a pan, a pinch, a wheel's zoom:
  // what a press there would land on moved with the picture, and how far a
  // press reaches in it changed with the zoom.
  const { onTransformed: cameraMoved } = camera;
  const onTransformed = useCallback(
    (ref: ReactZoomPanPinchRef, state: { scale: number }) => {
      cameraMoved(ref, state);
      if (!gesture.current) refreshForKeys.current();
    },
    [cameraMoved]
  );

  /** A pointer gone: the pinch ends with the last of them, never turning back into a stroke. */
  const release = useCallback((pointerId: number) => {
    pointers.current.delete(pointerId);
    if (pointers.current.size === 0) pinching.current = false;
  }, []);

  /**
   * A path gesture landing, as one undo step on the arrow as the store has it
   * now — unless that is no longer the arrow the press took hold of. A drag
   * commits where it was previewed; a click on the curve adds a node there,
   * the curve unchanged, and selects it.
   */
  const landPath = useCallback(
    (current: Extract<Gesture, { mode: 'path' }>, event: ReactPointerEvent<HTMLElement>) => {
      const now = liveAnnotation(step.id, current);
      if (!sameRepresentation(current.representation, pathRepresentationOf(now))) return;
      const store = useWorkspaceStore.getState();
      const { grip, original, loadId } = current;
      if (!current.moved) {
        if (grip.part !== 'segment') return;
        const added = applyAnnotationEdit(
          store,
          step.id,
          {
            label: 'Add node',
            edit: editAnnotation(original.id, (annotation) => splitPathSegment(annotation, grip.segment, grip.t)),
            selectPathNode: grip.segment + 1,
            shapes: { annotationId: original.id, gesture: 'add_node' },
          },
          { loadId }
        );
        if (added && lastPress.current) lastPress.current.added = { annotationId: original.id, node: grip.segment + 1 };
        return;
      }
      const at = toPicture(event.clientX, event.clientY);
      if (!at) return;
      // As the preview drew it: a key let go after the last move does not move the drop.
      const { modifiers } = current;
      const { label, gesture: shaped } = pathDragEdit(grip);
      applyAnnotationEdit(
        store,
        step.id,
        {
          label,
          edit: editAnnotation(original.id, (annotation) => pathDragged(current, annotation, at, modifiers)),
          shapes: { annotationId: original.id, gesture: shaped },
        },
        { loadId }
      );
    },
    [step.id, toPicture]
  );

  /**
   * Equal divisions landing (Revision 2, ED1): a drag measures the line from
   * where it began to where it ends, each snapped as a line's end; a click —
   * or a drag shorter than a slip — divides the whole line under where it
   * pressed, unsnapped, or puts nothing down and says so. Selected, with its Parts field available in Layers; focus stays on the
   * canvas and the tool stays in hand.
   */
  const layDivisions = useCallback(
    (current: Extract<Gesture, { mode: 'draw' }>, event: ReactPointerEvent<HTMLElement>) => {
      if (!layout) return;
      const store = useWorkspaceStore.getState();
      const free = isPrimaryModifier(event);
      const placed = current.moved
        ? placeInHand(current, toPicture(event.clientX, event.clientY) ?? current.start, free, event.shiftKey)
        : null;
      const dragged = placed && createAnnotation('divisions', current.start, placed.at, layout.pictureFrame);
      let annotation: KnownDiagramAnnotation;
      let placedBy: 'drag' | 'line';
      if (dragged && !isDegenerate(dragged, MIN_ANNOTATION_LENGTH)) {
        annotation = dragged;
        placedBy = 'drag';
      } else {
        const line = nearestLine(step, assets, style, current.pressed, hitSizes().tolerance, { whole: true });
        if (!line) {
          setToolNotice({ tool: 'divisions', notice: 'no-line' });
          return;
        }
        annotation = createAnnotation('divisions', line.a, line.b, layout.pictureFrame);
        if (isDegenerate(annotation, MIN_ANNOTATION_LENGTH)) return;
        placedBy = 'line';
      }
      const added = store.editDiagramAnnotations(step.id, 'Add annotation', (list) => [...list, annotation], {
        select: annotation.id,
        loadId: current.loadId,
      });
      if (!added) return;
      // A click on a line picks lines rather than points, as a bisector between two lines does.
      const snapped = placedBy === 'drag' && (current.startTarget !== null || placed?.target != null);
      trackDiagramAnnotationAdded(
        'divisions',
        placedBy === 'line' ? 'none' : snapOutcome('divisions', { enabled: snap.enabled, free: free || current.free, snapped }),
        { placed: placedBy }
      );
      // Keep keyboard focus on the canvas so Escape and tool shortcuts work.
    },
    [layout, placeInHand, toPicture, step, assets, style, hitSizes, snap.enabled]
  );

  /**
   * An enlarged step's frame landing (Revision 2, Z10), as one undo step: the
   * frame where it was dropped on the step's picture, its imprint made again
   * on the same face, and the marks carried by the window's move, so they
   * stay on the same paper (`setFrameOutline`). The camera is kept so the
   * picture stays where it was on the screen.
   */
  const landFrame = useCallback(
    (current: Extract<Gesture, { mode: 'frame' }>, event: ReactPointerEvent<HTMLElement>) => {
      // A click on the boundary selected it: the picture round it shown.
      if (!current.moved) {
        revealFrame();
        return;
      }
      const window = zoomed?.view.window;
      const pointer = toPicture(event.clientX, event.clientY);
      if (!window || !pointer) return;
      const dropped = draggedOutline(current.original, current.grip, current.start, pointer, {
        shift: event.shiftKey,
        alt: event.altKey,
      });
      if (sameOutline(dropped, current.original)) return;
      const store = useWorkspaceStore.getState();
      let to: PictureBox | null = null;
      const changed = store.editDiagramStepZoom(
        step.id,
        current.grip.part === 'centre' ? 'Move enlarged frame' : 'Resize enlarged frame',
        (document) => {
          const next = setFrameOutline(document, step.id, outlineFromBox(window, dropped), document.assets);
          const frame = stepById(next, step.id)?.zoom?.frame;
          to = frame ? frameWindow(frame) : null;
          return next;
        },
        { loadId: current.loadId }
      );
      if (!changed) return;
      if (to) holdCamera.current = { from: window, to };
      trackDiagramEnlargementChanged('frame', 'moved');
    },
    [zoomed, toPicture, step.id, revealFrame]
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      release(event.pointerId);
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      gesture.current = null;
      setDraft(null);
      setFrameDraft(null);
      showSnap([]);
      showRightAngle(null);
      if (!layout) return;
      const store = useWorkspaceStore.getState();
      const { loadId } = current;
      const free = isPrimaryModifier(event);
      if (current.mode === 'frame') {
        landFrame(current, event);
        return;
      }
      if (current.mode === 'draw' && current.kind === 'divisions') {
        layDivisions(current, event);
        return;
      }
      if (current.mode === 'draw') {
        const point = isPointKind(current.kind) && current.kind !== 'circle';
        // A line or an arrow is drawn by a drag; a sign or a label is put down
        // by a click; a right angle or a callout by either, a click putting a
        // callout's box beside its point.
        if (!placedByClick(current.kind) && !current.moved) return;
        // A click puts a point where its press showed it: a hand or a finger
        // drifting within its slop before it lifts has not moved it. A
        // callout clicked ends where it began, so its box goes beside its
        // point, however far the press snapped from the pointer; a right
        // angle clicked opens the way its press found.
        const { at, target } =
          !current.moved && !isCornerKind(current.kind)
            ? { at: current.start, target: current.startTarget }
            : placeInHand(current, toPicture(event.clientX, event.clientY) ?? current.start, free, event.shiftKey);
        const annotation = laid(
          current.kind,
          current.look,
          point ? at : current.start,
          at,
          layout.pictureFrame,
          { shift: event.shiftKey, alt: event.altKey },
          undefined,
          calloutText
        );
        if (isDegenerate(annotation, MIN_ANNOTATION_LENGTH)) return;
        const area = annotation.kind === 'zoom';
        const xray = annotation.kind === 'x-ray';
        const added = store.editDiagramAnnotations(
          step.id,
          area ? 'Enlarge area' : 'Add annotation',
          (list) => [...list, annotation],
          { select: annotation.id, loadId }
        );
        if (!added) return;
        // The step is an enlarge source now, or x-rayed: an older flat capture gets its faces, in the same undo step
        // (Revision 2; Revision 3, R3-18a A).
        if (area || xray) void store.giveDiagramStepPaperFaces(step.id);
        // Numeric options remain available in Layers without taking focus.
        // Put beside the picture, a close-up may be out of view: it is brought into it (15f).
        if (annotation.kind === 'close-up') camera.bringIntoView(closeUpRings(annotation, layout));
        const snapped = target !== null || (!point && current.startTarget !== null);
        const eventKind = annotationEventKind(annotation);
        const how = snapOutcome(annotation.kind, { enabled: snap.enabled, free: free || current.free, snapped });
        // A solid line's colour, by name (17a), and a label's options (17b); no other mark sends any.
        const detail = annotationEventDetail(annotation);
        if (Object.keys(detail).length > 0) trackDiagramAnnotationAdded(eventKind, how, detail);
        else trackDiagramAnnotationAdded(eventKind, how);
        if (carriesText(annotation.kind)) {
          // A label or a callout is written, not drawn again: Select comes
          // back to hand, and its field takes the keys.
          store.setDiagramAnnotateTool(null);
          requestFieldFocus(annotation.id, 'text');
        }
        return;
      }
      if (current.mode === 'path') {
        landPath(current, event);
        return;
      }
      if (!current.moved) return;
      const pointer = toPicture(event.clientX, event.clientY);
      if (!pointer) return;
      const placed = placeInHand(current, pointer, free, event.shiftKey);
      const area = current.original.kind === 'zoom';
      // A star's, an eye's or a shape's box (Revision 3): resized or turned, the Edit canvas's own words for each.
      const transform = current.grip.part === 'transform' ? current.grip.handle : null;
      // An x-ray's window moved or resized is an x-ray's change, never an enlargement's (Revision 3).
      const label = area
        ? 'Change enlarge area'
        : current.original.kind === 'x-ray'
          ? 'Change X-ray'
          : transform
          ? transform.kind === 'scale'
            ? 'Resize annotation'
            : 'Rotate annotation'
          : 'Move annotation';
      // Applied to the annotation as it is now: an edit that landed during the
      // drag — its text, its arc — is kept, not overwritten by the press's copy.
      const changed = store.editDiagramAnnotations(
        step.id,
        label,
        (list) =>
          list.map((annotation) => {
            if (annotation.id !== current.original.id) return annotation;
            const next = moved(current, annotation, placed, { shift: event.shiftKey, alt: event.altKey });
            return current.grip.part !== 'body' && isDegenerate(next, MIN_ANNOTATION_LENGTH) ? annotation : next;
          }),
        { loadId }
      );
      if (changed && area) trackDiagramEnlargementChanged('area', 'moved');
      if (changed && transform) {
        trackDiagramMarkStyled(annotationEventKind(current.original), transform.kind === 'scale' ? 'size' : 'rotation', 'handle');
      }
    },
    [
      layout,
      toPicture,
      step.id,
      release,
      landPath,
      landFrame,
      showSnap,
      showRightAngle,
      placeInHand,
      snap.enabled,
      calloutText,
      camera,
      layDivisions,
    ]
  );

  const onPointerGone = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      release(event.pointerId);
      if (gesture.current?.pointerId === event.pointerId) cancel();
    },
    [cancel, release]
  );

  return {
    camera: { ...camera, onTransformed },
    overlay,
    url,
    /** What the picture is painted from: a close-up paints it again, larger (15f). */
    source,
    /** An enlarged step's window, and what it is painted from (Revision 2); null for a whole picture. */
    zoomed,
    /** An enlarged step's frame in the canvas's units — as a drag of it shows it — or null for a whole picture. */
    frameOutline: frameDraft ?? frameOutline,
    /** The frame is selected: the picture round it shows, dimmed, with its grips. */
    frameSelected,
    /** The selected area's or frame's anchor face, outlined, in the canvas's units; null for none. */
    anchorRing,
    /** The selected x-ray's picked point, marked, in the canvas's units; null for none (Revision 3). */
    anchorPoint,
    /** What the picture round a selected frame takes in besides the window, in picture units; null for nothing more. */
    surroundAlso,
    /** The face a click would anchor to in the pick mode, in the canvas's units; null for none. */
    pickHighlight: anchorPick.highlight,
    /** The Anchor row's pick mode is armed: the canvas asks for a face. */
    pickingAnchor: anchorPick.picking !== null,
    layout,
    shown,
    tool,
    selectedId: draft?.id === DRAFT_ID ? null : selectedId,
    /** Edit Path is in hand: the selected fold arrow shows its nodes. */
    editingPath: tool === EDIT_PATH,
    selectedNode,
    coarse,
    /** Where a press would land, or the ends in hand have: shown over the marks, never in them. */
    snapTargets: snap.targets,
    /** The right angle a click would put down where the pointer is: shown over the marks, never in them. */
    rightAnglePreview: rightAngle,
    /** What a press with Select would take of the selected star's, eye's or shape's box under the pointer: the view's cursor. */
    transformHover,
    /**
     * A pick tool's picks, and what a press would pick: shown over the marks
     * (15b) — with Equal Divisions, the line a click would divide.
     */
    pickPreview: lineHover ? { ...picker.preview, hovered: lineHover, hoverTakes: true } : picker.preview,
    onPointerDownCapture,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerLeave,
      onPointerUp,
      onPointerCancel: onPointerGone,
      onLostPointerCapture: onPointerGone,
    },
  };
}

/**
 * Where the pointer puts what is in hand (`placeInHand`), and — for a right
 * angle whose corner landed on a point — the way it opens there.
 */
type PlacedInHand = PlacedPoint & { opens?: PicturePoint };

/** A right angle opening the way `opens` goes, about its corner; as it was without one. */
function opening(mark: KnownDiagramAnnotation, opens: PicturePoint | undefined): KnownDiagramAnnotation {
  return opens ? { ...mark, ...rightAngleAt(mark.from, opens) } : mark;
}

/** Whether two lines are one, end for end. */
function sameLine(a: PickedLine | null, b: PickedLine | null): boolean {
  if (a === null || b === null) return a === b;
  return a.a[0] === b.a[0] && a.a[1] === b.a[1] && a.b[0] === b.b[0] && a.b[1] === b.b[1];
}

/**
 * What a drawing tool lays from `start` to `end`: an enlarge area in its
 * tool's shape — a rounded rectangle dragged corner to corner, square with
 * Shift and from its middle with Alt (Revision 2) — an eye at `start`
 * looking toward `end`, in 15° steps with Shift (Revision 3, R3-8 A), an
 * oval or a rectangle corner to corner as that area is, a circle or a square
 * with Shift (Revision 3) — or its kind, in its look.
 */
function laid(
  kind: DiagramAnnotationKind,
  look: DrawingLook,
  start: PicturePoint,
  end: PicturePoint,
  frame: PictureFrame,
  keys: { shift: boolean; alt: boolean },
  newId?: DiagramIdFactory,
  calloutText?: string
): KnownDiagramAnnotation {
  const { shape, color, text, circleMode, ...arrowLook } = look;
  if (kind === 'zoom' && shape === 'rounded') {
    return zoomAreaFromCorners(start, end, { square: keys.shift, fromMiddle: keys.alt }, newId);
  }
  if (kind === 'eye') return eyeLooking(start, end, frame, { steps: keys.shift }, newId);
  if (isAreaKind(kind)) return areaFromCorners(kind, start, end, { square: keys.shift, fromMiddle: keys.alt }, newId);
  // A solid line in the colour chosen beside the tool hint’s Line Type (17a).
  const made = withColor(withWhiteArrowLook(createAnnotation(kind, start, end, frame, newId, calloutText, circleMode), arrowLook), color ?? null);
  // A label in the tool hint’s Text Style (17b).
  return text ? withTextStyle(made, text) : made;
}

/** A point {@link RIGHT_ANGLE_DIAGONAL} from `corner` the way `opens` goes: what a right angle's `to` is made from. */
function along(corner: PicturePoint, opens: PicturePoint): PicturePoint {
  return [corner[0] + opens[0] * RIGHT_ANGLE_DIAGONAL, corner[1] + opens[1] * RIGHT_ANGLE_DIAGONAL];
}


/**
 * The press `event` makes after `previous`: how many presses it ends, close
 * enough in time and place to count as one double-click, and the node the
 * first one's click added, if it did.
 */
function nextPress(
  previous: LastPress | null,
  event: Pick<PointerEvent, 'timeStamp' | 'clientX' | 'clientY' | 'pointerType'>
): LastPress {
  const near = DOUBLE_PRESS.px[event.pointerType === 'touch' ? 'touch' : 'fine'];
  const again =
    previous !== null &&
    event.timeStamp - previous.time <= DOUBLE_PRESS.ms &&
    Math.hypot(event.clientX - previous.client[0], event.clientY - previous.client[1]) <= near;
  return {
    time: event.timeStamp,
    client: [event.clientX, event.clientY],
    count: again ? previous.count + 1 : 1,
    added: again ? previous.added : null,
    selected: again ? previous.selected : null,
  };
}

/**
 * A pointer event's fields the canvas reads, copied: an event is the
 * browser's, and its fields are getters that a spread does not copy.
 */
function pick(event: PointerInput): PointerInput {
  const { pointerId, pointerType, clientX, clientY, buttons, metaKey, ctrlKey, shiftKey, altKey, target } = event;
  return { pointerId, pointerType, clientX, clientY, buttons, metaKey, ctrlKey, shiftKey, altKey, target };
}

/** The arrow a path gesture holds, as the store has it now: what a drag is checked against, and lands on. */
function liveAnnotation(stepId: string, current: Extract<Gesture, { mode: 'path' }>): KnownDiagramAnnotation | null {
  const { diagram } = useWorkspaceStore.getState();
  const annotation = diagram
    ? stepById(diagram, stepId)?.annotations.find((each) => each.id === current.original.id)
    : undefined;
  return annotation && isKnownAnnotation(annotation) ? annotation : null;
}

function pathRepresentationOf(annotation: KnownDiagramAnnotation | null): PathRepresentation | null {
  return annotation ? pathRepresentation(annotation) : null;
}

/** The arrow a path gesture makes of `annotation`, the pointer at `at` with `modifiers` held. */
function pathDragged(
  current: Extract<Gesture, { mode: 'path' }>,
  annotation: KnownDiagramAnnotation,
  at: PicturePoint,
  modifiers: PathModifiers
): KnownDiagramAnnotation {
  return dragPath(annotation, current.grip, current.anchor, [at[0] - current.start[0], at[1] - current.start[1]], modifiers);
}

/** The upright box round a ring's points. */
function boxOf(ring: readonly PicturePoint[]): PictureBox {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
