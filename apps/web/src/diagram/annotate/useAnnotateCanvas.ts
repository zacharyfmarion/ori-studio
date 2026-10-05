import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { trackDiagramAnnotationAdded } from '../../analytics';
import {
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_ROTATE_INK,
  DIAGRAM_TURN_OVER_INK,
  canvasDiagramInk,
} from '../../cp-workspace/references/diagram/diagramInk';
import { useViewportSurface } from '../../hooks/useViewportSurface';
import { readHeldModifiers, subscribeHeldModifiers } from '../../keyboard/heldModifiers';
import type { PlotRect } from '../../lib/geometry';
import { isPrimaryModifier } from '../../lib/platform';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectedDiagramPathNode } from '../../store/workspaceStore/diagramState';
import {
  isKnownAnnotation,
  stepById,
  type DiagramAnnotation,
  type DiagramAnnotationKind,
  type DiagramAsset,
  type DiagramStep,
  type DiagramStyle,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { paintSource, stepPictureSource, type PictureBox } from '../pictures/paintDiagramStep';
import { STEP_DIAGRAM_LINE_WIDTH } from '../pictures/paintStepDiagram';
import { stepPictureUrl } from '../pictures/useStepPictureUrl';
import { registerDiagramGestureCancel, registerDiagramViewCamera } from '../useDiagramShortcuts';
import { EDIT_PATH, drawingKind } from './annotateTools';
import { placePoint, snapOutcome, snapsWhenPlaced, type PlacedPoint } from './annotateSnap';
import { annotationActionEdit, editAnnotation } from './annotationActions';
import {
  circleRadius,
  hitAnnotation,
  hitPathGrip,
  type AnnotationGrip,
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
  createAnnotation,
  frameOf,
  isCornerKind,
  isDegenerate,
  isPointKind,
  moveAnnotation,
  moveAnnotationEnd,
  rightAngleAt,
  rightAngleDiagonal,
  type PictureFrame,
  type PicturePoint,
} from './annotationModel';
import { cancelLabelFocus, pendingLabelFocus, requestLabelFocus } from './labelFocus';
import { isViewportInteractiveTarget } from '../../components/panels/ViewportToolbar';
import type { DiagramAnnotationTool } from '../../analytics/events';
import { CARD_FRAME_PX } from './paintAnnotations';
import type { SnapTarget } from './pictureSnap';
import { useAnnotateSnap } from './useAnnotateSnap';
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

/**
 * A sign's reach from its centre, in picture units, as a card and the canvas
 * draw it: half the turn-over glyph, or the rotate glyph's circle and heads.
 */
export const GLYPH_REACH =
  Math.max(DIAGRAM_TURN_OVER_INK / 2, DIAGRAM_ROTATE_INK.radius + DIAGRAM_ARROWHEAD_INK.length / 2) *
  (canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH) / CARD_FRAME_PX);

/** One ink in picture units, as the canvas draws: what an arrow's head and a push's width are measured in. */
export const INK_UNITS = canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH) / CARD_FRAME_PX;

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
      start: PicturePoint;
      startTarget: SnapTarget | null;
      free: boolean;
      /** A right angle's: the way a click opens it, when the press was in a right angle there (decision 12). */
      opens?: PicturePoint | null;
    })
  | (Press & { mode: 'move'; grip: AnnotationGrip; original: KnownDiagramAnnotation; start: PicturePoint })
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
  const coarse = useIsCoarsePointerSurface();
  const tool = useWorkspaceStore((state) => state.diagramAnnotateTool);
  const selectedId = useWorkspaceStore((state) => state.diagramSelectedAnnotationId);
  const selectedNode = useWorkspaceStore(selectedDiagramPathNode);
  // The picture, from what it is made of: a text or an annotation edit keeps
  // these, so it is neither repainted nor taken for another picture.
  const { picture, source: pictureSource, unknown } = step;
  const source = useMemo(
    () => stepPictureSource({ ...step, picture, source: pictureSource, unknown }, assets),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the picture's inputs
    [picture, pictureSource, unknown, assets]
  );
  const painted = useMemo(() => (source ? paintSource(source, style) : null), [source, style]);
  const url = useMemo(() => (source ? stepPictureUrl(source, style) : null), [source, style]);
  const layout = useMemo(() => (painted ? layoutFor(painted) : null), [painted]);

  const camera = useViewportSurface({
    surface: null,
    worldRect: layout?.world ?? { x: 0, y: 0, width: 1, height: 1 },
    fitRect: layout?.picture,
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

  const cancel = useCallback(() => {
    showSnap([]);
    showRightAngle(null);
    if (!gesture.current) return false;
    gesture.current = null;
    setDraft(null);
    return true;
  }, [showSnap, showRightAngle]);
  useEffect(() => registerDiagramGestureCancel(cancel), [cancel]);
  // A tool picked, another step or another picture: whatever was in hand is dropped.
  useEffect(
    () => () => {
      cancel();
    },
    [cancel, step.id, tool, source]
  );
  // A label's field asks for the focus only while that label is the one selected.
  useEffect(() => {
    if (selectedId === null || selectedId !== pendingLabelFocus()) cancelLabelFocus();
  }, [selectedId]);
  useEffect(() => cancelLabelFocus, []);

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
   * The annotations as the canvas draws them: the step's, and the one in hand
   * where it is now. Only a drag joins them — anything shown over the marks
   * for a moment stays out — so a pointer's every move recompiles at most the
   * one annotation that moved (`compiledAnnotation`), and nothing else redraws
   * the marks.
   */
  const shown = useMemo<readonly DiagramAnnotation[]>(() => {
    if (!draft) return step.annotations;
    if (draft.id === DRAFT_ID) return [...step.annotations, draft];
    return step.annotations.map((annotation) => (annotation.id === draft.id ? draft : annotation));
  }, [step.annotations, draft]);

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

  /** How near a press must be, in picture units, at the zoom it is made at. */
  const hitSizes = useCallback((): HitSizes => {
    const screenPerWorld = overlay.current?.getScreenCTM()?.a ?? 1;
    const reach = (coarse ? REACH_PX.coarse : REACH_PX.fine) / (screenPerWorld * (layout?.unit ?? 1));
    return { tolerance: reach, glyph: GLYPH_REACH, label: LABEL_SIZE, ink: INK_UNITS };
  }, [coarse, layout]);

  const known = useCallback(
    (id: string) =>
      step.annotations.find(
        (annotation): annotation is KnownDiagramAnnotation => annotation.id === id && isKnownAnnotation(annotation)
      ),
    [step.annotations]
  );

  /**
   * Where the pointer at `at` puts what is in hand, snapped as the mark it is
   * (decision 9): a drawing's end — a circle's centre — or an arrow's or a
   * line's end taken hold of with Select, never onto the annotation itself; a
   * circle moved whole, its centre, the press keeping its offset from it.
   * With ⌘ (Ctrl) held (`free`), where the pointer is. Edit Path's nodes and
   * handles never snap.
   */
  const placeInHand = useCallback(
    (current: Gesture, at: PicturePoint, free: boolean, shift = false): PlacedInHand => {
      const loose = { at, target: null };
      switch (current.mode) {
        case 'draw':
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
          return snapsWhenPlaced(current.kind) ? placePoint(snapContext(), at, { free }) : loose;
        case 'move': {
          const { grip, original } = current;
          if (!snapsWhenPlaced(original.kind)) return loose;
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
          if (grip.part === 'from' || grip.part === 'to' || grip.part === 'corner') {
            const landed = placePoint(snapContext(), at, { free, ignore: original.id });
            return { ...landed, opens: squared(landed) };
          }
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
        const hit = hitAnnotation(step.annotations, at, hitSizes(), selectedId);
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
    [selectedId, known, hitSizes, selectedNode, step.annotations, step.id, readOnly]
  );

  /** A press anywhere on the canvas takes the keyboard there, as Edit's does: Space pans, letters pick tools. */
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
      const store = useWorkspaceStore.getState();
      const press = {
        pointerId: event.pointerId,
        client: [event.clientX, event.clientY] as [number, number],
        // A finger drifts as it lifts; a mouse or a pen does not.
        slop: event.pointerType === 'touch' ? DRAG_SLOP_PX.touch : DRAG_SLOP_PX.fine,
        loadId: store.diagramLoadId,
        moved: false,
      };
      const kind = drawingKind(tool);
      if (kind !== null) {
        if (readOnly) return;
        const free = isPrimaryModifier(event);
        // A right angle's corner, and the way a click opens it when the press is in a right angle.
        const start = isCornerKind(kind)
          ? placeRightAngle(snapContext(), at, { free })
          : { ...(snapsWhenPlaced(kind) ? placePoint(snapContext(), at, { free }) : { at, target: null }), opens: null };
        gesture.current = { mode: 'draw', kind, start: start.at, startTarget: start.target, free, opens: start.opens, ...press };
        // Where the press landed, at once: a finger sees it before its slop — and a right angle, the mark a click puts down.
        showSnap([start.target]);
        showRightAngle(isCornerKind(kind) && layout ? clickPreview(start, layout.pictureFrame, free) : null);
      } else if (tool === EDIT_PATH) {
        const started = pressPath(at, press, count);
        if (!started) return;
        gesture.current = started;
      } else {
        // Selecting is not an edit: a diagram that cannot change still selects.
        const grip = hitAnnotation(step.annotations, at, hitSizes(), selectedId);
        const original = grip ? known(grip.annotationId) : undefined;
        store.selectDiagramAnnotation(grip?.annotationId ?? null);
        if (readOnly || !grip || !original) return;
        if (count.count >= 2 && canBeShaped(original.kind)) {
          // A double-click on a fold arrow: Edit Path, to shape it. Spent: the
          // click after it is Edit Path's first, which picks a node.
          store.setDiagramAnnotateTool(EDIT_PATH);
          lastPress.current = null;
          return;
        }
        gesture.current = { mode: 'move', grip, original, start: at, ...press };
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
      step.annotations,
      hitSizes,
      selectedId,
      known,
      pressPath,
      transformRef,
      snapContext,
      showSnap,
      showRightAngle,
      clickPreview,
    ]
  );

  /**
   * The annotation a move makes of `annotation`, the press placed at `at`
   * ({@link placeInHand}). A circle whose centre snapped is put on its target
   * exactly, not moved by a difference that rounds.
   */
  const moved = (
    current: Extract<Gesture, { mode: 'move' }>,
    annotation: KnownDiagramAnnotation,
    { at, target, opens }: PlacedInHand
  ) => {
    const { grip } = current;
    switch (grip.part) {
      case 'body':
        if (target && isPointKind(annotation.kind)) return moveAnnotationEnd(annotation, 'from', target.at);
        if (target && isCornerKind(annotation.kind)) return opening(moveAnnotationEnd(annotation, 'from', target.at), opens);
        return moveAnnotation(annotation, [at[0] - current.start[0], at[1] - current.start[1]]);
      case 'from':
      case 'to':
        return moveAnnotationEnd(annotation, grip.part, at);
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
      const kind = drawingKind(tool);
      const looking =
        kind !== null && snapsWhenPlaced(kind) && !readOnly && !spacePressed && !pinching.current && input.buttons === 0;
      const at = looking && onStage(input.target) ? toPicture(input.clientX, input.clientY) : null;
      const free = isPrimaryModifier(input);
      if (kind !== null && isCornerKind(kind)) {
        // The corner a press here snaps to, and the mark a click puts down in it.
        const start = at ? placeRightAngle(snapContext(), at, { free }) : null;
        showSnap([start?.target ?? null]);
        showRightAngle(start && layout ? clickPreview(start, layout.pictureFrame, free) : null);
        return;
      }
      showSnap([at ? placePoint(snapContext(), at, { free }).target : null]);
    },
    [tool, readOnly, spacePressed, onStage, toPicture, snapContext, showSnap, showRightAngle, layout, clickPreview]
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
        const point = isPointKind(current.kind);
        setDraft(createAnnotation(current.kind, point ? placed.at : current.start, placed.at, layout.pictureFrame, () => DRAFT_ID));
        showSnap([point ? null : current.startTarget, placed.target]);
        return;
      }
      setDraft(moved(current, current.original, placed));
      showSnap([placed.target]);
    },
    [layout, toPicture, cancel, step.id, hover, placeInHand, showSnap, showRightAngle]
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => pointerMoved(event.nativeEvent), [pointerMoved]);

  /** The pointer gone from the stage, with nothing in hand: no target to show. */
  const onPointerLeave = useCallback(() => {
    lastPointer.current = null;
    if (gesture.current) return;
    showSnap([]);
    showRightAngle(null);
  }, [showSnap, showRightAngle]);

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

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      release(event.pointerId);
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      gesture.current = null;
      setDraft(null);
      showSnap([]);
      showRightAngle(null);
      if (!layout) return;
      const store = useWorkspaceStore.getState();
      const { loadId } = current;
      const free = isPrimaryModifier(event);
      if (current.mode === 'draw') {
        const point = isPointKind(current.kind);
        // A line or an arrow is drawn by a drag; a sign or a label is put down by a click; a right angle by either.
        if (!point && !current.moved && !isCornerKind(current.kind)) return;
        // A click puts a point where its press showed it: a hand or a finger
        // drifting within its slop before it lifts has not moved it.
        const { at, target } =
          point && !current.moved
            ? { at: current.start, target: current.startTarget }
            : placeInHand(current, toPicture(event.clientX, event.clientY) ?? current.start, free, event.shiftKey);
        const annotation = createAnnotation(current.kind, point ? at : current.start, at, layout.pictureFrame);
        if (isDegenerate(annotation, MIN_ANNOTATION_LENGTH)) return;
        const added = store.editDiagramAnnotations(step.id, 'Add annotation', (list) => [...list, annotation], {
          select: annotation.id,
          loadId,
        });
        if (!added) return;
        const snapped = target !== null || (!point && current.startTarget !== null);
        trackDiagramAnnotationAdded(
          ANNOTATION_TOOL[annotation.kind],
          snapOutcome(annotation.kind, { enabled: snap.enabled, free: free || current.free, snapped })
        );
        if (annotation.kind === 'label') {
          // A label is written, not drawn again: Select comes back to hand,
          // and its field takes the keys.
          store.setDiagramAnnotateTool(null);
          requestLabelFocus(annotation.id);
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
      // Applied to the annotation as it is now: an edit that landed during the
      // drag — its text, its arc — is kept, not overwritten by the press's copy.
      store.editDiagramAnnotations(
        step.id,
        'Move annotation',
        (list) =>
          list.map((annotation) => {
            if (annotation.id !== current.original.id) return annotation;
            const next = moved(current, annotation, placed);
            return current.grip.part !== 'body' && isDegenerate(next, MIN_ANNOTATION_LENGTH) ? annotation : next;
          }),
        { loadId }
      );
    },
    [layout, toPicture, step.id, release, landPath, showSnap, showRightAngle, placeInHand, snap.enabled]
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

/** A point {@link RIGHT_ANGLE_DIAGONAL} from `corner` the way `opens` goes: what a right angle's `to` is made from. */
function along(corner: PicturePoint, opens: PicturePoint): PicturePoint {
  return [corner[0] + opens[0] * RIGHT_ANGLE_DIAGONAL, corner[1] + opens[1] * RIGHT_ANGLE_DIAGONAL];
}

/** Each kind in the analytics event's spelling: a new kind is a type error until it has one. */
const ANNOTATION_TOOL: Readonly<Record<DiagramAnnotationKind, DiagramAnnotationTool>> = {
  'valley-arrow': 'valley_arrow',
  'mountain-arrow': 'mountain_arrow',
  'fold-unfold-arrow': 'fold_unfold_arrow',
  'push-arrow': 'push_arrow',
  'turn-over': 'turn_over',
  rotate: 'rotate',
  'valley-line': 'valley_line',
  'mountain-line': 'mountain_line',
  'hidden-line': 'hidden_line',
  label: 'label',
  circle: 'circle',
  'right-angle': 'right_angle',
};

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
