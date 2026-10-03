import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { trackDiagramAnnotationAdded } from '../../analytics';
import {
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_ROTATE_INK,
  DIAGRAM_TURN_OVER_INK,
  canvasDiagramInk,
} from '../../cp-workspace/references/diagram/diagramInk';
import { useViewportSurface } from '../../hooks/useViewportSurface';
import type { PlotRect } from '../../lib/geometry';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  isKnownAnnotation,
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
import { hitAnnotation, type AnnotationGrip, type HitSizes } from './annotationHit';
import {
  LABEL_SIZE,
  createAnnotation,
  frameOf,
  isDegenerate,
  isPointKind,
  moveAnnotation,
  moveAnnotationEnd,
  type PictureFrame,
  type PicturePoint,
} from './annotationModel';
import { requestLabelFocus } from './labelFocus';
import { CARD_FRAME_PX } from './paintAnnotations';

/** The frame's longer side in the canvas's world, CSS px: big enough that the picture is sharp at fit. */
export const ANNOTATE_FRAME_PX = 1000;
/** The room round the picture, as a share of its frame: an arrow may start off the paper. */
const WORLD_MARGIN = 0.25;
/** How far a press may travel and still be a click, in screen px. */
const DRAG_SLOP = 4;
/** How near a press must be to take hold of something, in screen px: a mouse's, a finger's. */
const REACH_PX = { fine: 8, coarse: 18 } as const;
/** The shortest arrow or line, as a share of the frame: anything shorter was a slip. */
const MIN_LENGTH = 0.015;

const DRAFT_ID = 'annotation-draft';

/**
 * A sign's reach from its centre, in picture units, as a card and the canvas
 * draw it: half the turn-over glyph, or the rotate glyph's circle and heads.
 */
export const GLYPH_REACH =
  Math.max(DIAGRAM_TURN_OVER_INK / 2, DIAGRAM_ROTATE_INK.radius + DIAGRAM_ARROWHEAD_INK.length / 2) *
  (canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH) / CARD_FRAME_PX);

/** A press in progress: a new annotation being drawn, or one being moved. */
type Gesture =
  | { mode: 'draw'; kind: DiagramAnnotationKind; start: PicturePoint; client: [number, number]; moved: boolean }
  | {
      mode: 'move';
      grip: AnnotationGrip;
      original: KnownDiagramAnnotation;
      start: PicturePoint;
      client: [number, number];
      moved: boolean;
    };

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
 * take back.
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
  const source = useMemo(() => stepPictureSource(step, assets), [step, assets]);
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
  const { handleViewportShortcut } = camera;
  useEffect(() => registerDiagramViewCamera(handleViewportShortcut), [handleViewportShortcut]);

  const overlay = useRef<SVGSVGElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<KnownDiagramAnnotation | null>(null);

  const cancel = useCallback(() => {
    if (!gesture.current) return false;
    gesture.current = null;
    setDraft(null);
    return true;
  }, []);
  useEffect(() => registerDiagramGestureCancel(cancel), [cancel]);
  // A tool picked, another step or another picture: whatever was in hand is dropped.
  useEffect(
    () => () => {
      cancel();
    },
    [cancel, step.id, tool, layout]
  );

  /** The annotations as the canvas shows them: the one in hand where it is now. */
  const shown = useMemo<readonly DiagramAnnotation[]>(() => {
    if (!draft) return step.annotations;
    if (draft.id === DRAFT_ID) return [...step.annotations, draft];
    return step.annotations.map((annotation) => (annotation.id === draft.id ? draft : annotation));
  }, [step.annotations, draft]);

  /** A client point in picture units. */
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
    return { tolerance: reach, glyph: GLYPH_REACH, label: LABEL_SIZE };
  }, [coarse, layout]);

  const known = useCallback(
    (id: string) => step.annotations.find((annotation): annotation is KnownDiagramAnnotation =>
      annotation.id === id && isKnownAnnotation(annotation)
    ),
    [step.annotations]
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (event.button !== 0 || camera.spacePressed || readOnly || !layout) return;
      const at = toPicture(event.clientX, event.clientY);
      if (!at) return;
      const store = useWorkspaceStore.getState();
      const client: [number, number] = [event.clientX, event.clientY];
      if (tool !== null) {
        gesture.current = { mode: 'draw', kind: tool, start: at, client, moved: false };
      } else {
        const grip = hitAnnotation(step.annotations, at, hitSizes(), selectedId);
        const original = grip ? known(grip.annotationId) : undefined;
        store.selectDiagramAnnotation(grip?.annotationId ?? null);
        if (!grip || !original) return;
        gesture.current = { mode: 'move', grip, original, start: at, client, moved: false };
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [camera.spacePressed, readOnly, layout, toPicture, tool, step.annotations, hitSizes, selectedId, known]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const current = gesture.current;
      if (!current || !layout) return;
      if (!current.moved && Math.hypot(event.clientX - current.client[0], event.clientY - current.client[1]) < DRAG_SLOP) {
        return;
      }
      const at = toPicture(event.clientX, event.clientY);
      if (!at) return;
      current.moved = true;
      if (current.mode === 'draw') {
        setDraft(createAnnotation(current.kind, isPointKind(current.kind) ? at : current.start, at, layout.pictureFrame, () => DRAFT_ID));
      } else {
        const { original, grip, start } = current;
        setDraft(
          grip.part === 'body'
            ? moveAnnotation(original, [at[0] - start[0], at[1] - start[1]])
            : moveAnnotationEnd(original, grip.part, at)
        );
      }
    },
    [layout, toPicture]
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const current = gesture.current;
      gesture.current = null;
      setDraft(null);
      if (!current || !layout) return;
      const store = useWorkspaceStore.getState();
      const loadId = store.diagramLoadId;
      if (current.mode === 'draw') {
        const at = toPicture(event.clientX, event.clientY) ?? current.start;
        const point = isPointKind(current.kind);
        // A line or an arrow is drawn by a drag; a sign or a label is put down by a click.
        if (!point && !current.moved) return;
        const annotation = createAnnotation(current.kind, point ? at : current.start, at, layout.pictureFrame);
        if (isDegenerate(annotation, MIN_LENGTH)) return;
        const added = store.editDiagramAnnotations(step.id, 'Add annotation', (list) => [...list, annotation], {
          select: annotation.id,
          loadId,
        });
        if (!added) return;
        trackDiagramAnnotationAdded(annotationTool(annotation.kind));
        if (annotation.kind === 'label') requestLabelFocus(annotation.id);
        return;
      }
      if (!current.moved) return;
      const at = toPicture(event.clientX, event.clientY);
      if (!at) return;
      const { original, grip, start } = current;
      const moved =
        grip.part === 'body'
          ? moveAnnotation(original, [at[0] - start[0], at[1] - start[1]])
          : moveAnnotationEnd(original, grip.part, at);
      if (grip.part !== 'body' && isDegenerate(moved, MIN_LENGTH)) return;
      store.editDiagramAnnotations(
        step.id,
        'Move annotation',
        (list) => list.map((annotation) => (annotation.id === moved.id ? moved : annotation)),
        { loadId }
      );
    },
    [layout, toPicture, step.id]
  );

  return {
    camera,
    overlay,
    url,
    layout,
    shown,
    tool,
    selectedId: draft?.id === DRAFT_ID ? null : selectedId,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: () => void cancel(),
      onLostPointerCapture: () => void cancel(),
    },
  };
}

/** A kind in the analytics event's spelling. */
function annotationTool(kind: DiagramAnnotationKind) {
  return kind.replaceAll('-', '_') as Parameters<typeof trackDiagramAnnotationAdded>[0];
}
