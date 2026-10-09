import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { isDrawingTool } from '../../diagram/annotate/annotateTools';
import {
  angleMarkInPicture,
  arrowPolyline,
  divisionsInPicture,
  divisionsOffsetGrip,
  labelBox,
  pleatArrowInPicture,
  rightAngleGrips,
  rightAngleInPicture,
} from '../../diagram/annotate/annotationHit';
import {
  angleMarkArcPoints,
  divisionsStrokes,
  rightAnglePathData,
  type SvgPoint,
} from '../../cp-workspace/references/stepDiagramGeometry';
import { pathNodesOf, pathNodesPolyline, visiblePathHandles } from '../../diagram/annotate/annotationPath';
import { annotationDrawing } from '../../diagram/annotate/annotationPrimitives';
import { useCloseUpInsides } from '../../diagram/annotate/useCloseUpInsides';
import { useXRayInsides } from '../../diagram/xray/useXRayInsides';
import type { SnapTarget } from '../../diagram/annotate/pictureSnap';
import { CARD_FRAME_PX } from '../../diagram/annotate/paintAnnotations';
import {
  ANNOTATE_CAMERA_SCALE,
  calloutPenUnits,
  CIRCLE_RADIUS,
  GLYPH_REACH,
  INK_UNITS,
  useAnnotateCanvas,
  type AnnotateLayout,
  type RightAnglePreview,
} from '../../diagram/annotate/useAnnotateCanvas';
import type { PickPreview } from '../../diagram/annotate/usePickTool';
import {
  annotationEnds,
  calloutDrawnBox,
  calloutShape,
  canBeShaped,
  closeUpShape,
  LABEL_SIZE,
} from '../../diagram/annotate/annotationModel';
import {
  isKnownAnnotation,
  type DiagramAsset,
  type DiagramStep,
  type DiagramStyle,
  type DiagramZoomOutline,
  type KnownDiagramAnnotation,
} from '../../diagram/document/diagramDocument';
import { VIEWPORT_PINCH_ZOOM, VIEWPORT_WHEEL_ZOOM } from '../../hooks/useViewportSurface';
import { ViewportToolbar } from '../panels/ViewportToolbar';
import { DiagramAnnotateToolWindow } from './DiagramAnnotateToolWindow';
import { DiagramAnnotationLayer } from './DiagramAnnotationLayer';
import { DiagramCloseUpInsides } from './DiagramCloseUpInsides';
import { DiagramXRayInsides } from './DiagramXRayInsides';
import { markGeometry, markPaper, viewOfStep } from '../../diagram/zoom/stepView';
import { zoomGrips } from '../../diagram/zoom/zoomGrips';
import { transformBoxHandles } from '../../diagram/annotate/transformGrips';
import { TRANSFORM_STROKE_PX, transformHandleSizes } from '../../lib/transformBox';
import { zoomOutlineOf, zoomOutlinePoints } from '../../diagram/zoom/zoomModel';
import { DiagramZoomView } from './DiagramZoomView';
import styles from './DiagramAnnotateCanvas.module.css';

/** An end's dot, in screen px. */
const HANDLE_PX = 5;
/** A snap target's mark, in screen px: half its size. */
const SNAP_PX = 5;
/** Edit Path's grips, in screen px: a node's half-size and a handle's dot — larger for a finger. */
const NODE_PX = { fine: 4.5, coarse: 7 } as const;
const PATH_HANDLE_PX = { fine: 3.5, coarse: 5.5 } as const;
/** A right angle's tie to its vertex (RA6), in screen px: a hairline. */
const TIE_PX = 1;
/**
 * A selected frame's line and its dashes, and an anchor face's outline and
 * the face a pick would take (Revision 2), in screen px: drawn in the world,
 * so divided by the camera's zoom as the grips are, or a canvas stepped back
 * to reach a far anchor face loses them.
 */
const FRAME_LINE_PX = { width: 1.5, dash: 6, gap: 4 } as const;
const ANCHOR_FACE_PX = 1.25;
/** A selected x-ray's picked point: its ring's radius and its dot's on screen (Revision 3). */
const ANCHOR_POINT_PX = 5;
const ANCHOR_DOT_PX = 1.5;
const PICK_FACE_PX = 1;

/**
 * The Annotate canvas (D8): the step's picture alone, with its annotations
 * drawn over it live as they print — under one camera, on a stage as white as
 * the page in every theme, so a mark that reaches past the picture reads as it
 * will print. A hairline marks the picture's frame. The selected annotation
 * shows where it is and, for a line or an arrow, a dot at each end — a
 * callout's at its point — or, in Edit Path, a fold arrow's nodes and the
 * handles beside the selected one.
 * The behaviour is `useAnnotateCanvas`'s; its presses are the whole stage's.
 * The tool window floats over its bottom right while a tool is in hand and
 * the diagram can change.
 */
export function DiagramAnnotateCanvas({
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
  const canvas = useAnnotateCanvas({ step, assets, style, readOnly });
  const { camera, overlay, url, layout, shown, tool, selectedId, onPointerDownCapture, handlers } = canvas;
  const { containerRef, transformRef, zoomPercent, spacePressed, zoomIn, zoomOut, fitToView, setZoomLevel, onInit, onTransformed } =
    camera;
  // A flat fold's layers, in the marks' units: a mark behind a flap is dotted under it as it is drawn (15e).
  const layers = useMemo(() => markGeometry(step, assets, style).layers, [step, assets, style]);
  // A References picture's sheet, in the marks' units: a label's halo is filled with the face it stands on (17b).
  const paper = useMemo(() => markPaper(step, assets), [step, assets]);
  const drawing = useMemo(
    () => (layout ? annotationDrawing(shown, layout.pictureFrame, CARD_FRAME_PX, style, layers, paper) : null),
    [layout, shown, style, layers, paper]
  );
  // Each close-up's inside, under the marks: the picture painted again, larger (15f).
  const insides = useCloseUpInsides({
    drawing,
    shown,
    committed: step.annotations,
    source: canvas.source,
    zoomed: canvas.zoomed,
    style,
    layers,
    paper,
    pictureFrame: layout?.pictureFrame ?? null,
    framePx: CARD_FRAME_PX,
  });
  // Each x-ray's window, under the close-ups' insides and the marks: the step's own picture without its top layers (Revision 3).
  const xrayIds = `x-ray-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const zoomView = useMemo(() => viewOfStep(step).zoom, [step]);
  const windows = useXRayInsides({ step, drawing, shown, zoom: zoomView, style, framePx: CARD_FRAME_PX, idPrefix: xrayIds });
  const selected = shown.find(
    (annotation): annotation is KnownDiagramAnnotation => annotation.id === selectedId && isKnownAnnotation(annotation)
  );
  const zoom = Math.max(zoomPercent, 1) / 100;
  // The view as an element, for the tool window to anchor to once it is laid out.
  const [view, setView] = useState<HTMLDivElement | null>(null);
  const attachView = useCallback(
    (element: HTMLDivElement | null) => {
      containerRef.current = element;
      setView(element);
    },
    [containerRef]
  );

  return (
    <>
      <div
        ref={attachView}
        className={styles.view}
        data-space-pan={spacePressed || undefined}
        data-tool={tool ?? 'select'}
        data-draws={isDrawingTool(tool) || undefined}
        data-picking={canvas.pickingAnchor || undefined}
        data-transform-hover={canvas.transformHover ?? undefined}
        tabIndex={-1}
        onPointerDownCapture={onPointerDownCapture}
        {...handlers}
      >
        <TransformWrapper
          ref={transformRef}
          initialScale={1}
          minScale={ANNOTATE_CAMERA_SCALE.min}
          maxScale={ANNOTATE_CAMERA_SCALE.max}
          limitToBounds={false}
          wheel={VIEWPORT_WHEEL_ZOOM}
          panning={{
            velocityDisabled: true,
            wheelPanning: true,
            allowMiddleClickPan: true,
            // A drag draws; the picture moves with Space held, the middle button or
            // two fingers (one finger never reaches the camera: `useAnnotateCanvas`).
            allowLeftClickPan: spacePressed,
          }}
          pinch={VIEWPORT_PINCH_ZOOM}
          doubleClick={{ disabled: true }}
          onInit={onInit}
          onTransformed={onTransformed}
        >
          <TransformComponent
            wrapperClass={styles.stage}
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={layout ? { width: layout.world.width, height: layout.world.height } : undefined}
          >
            {layout && (
              <div className={styles.world} style={{ width: layout.world.width, height: layout.world.height }}>
                {canvas.zoomed ? (
                  // An enlarged step: its window, its picture clipped to its frame (Revision 2).
                  <DiagramZoomView
                    zoomed={canvas.zoomed}
                    layout={layout}
                    style={style}
                    surround={canvas.frameSelected}
                    surroundAlso={canvas.surroundAlso}
                  />
                ) : (
                  <div className={styles.paper} style={box(layout.picture)}>
                    {url && <img className={styles.picture} src={url} alt="" draggable={false} />}
                  </div>
                )}
                {/* The frame, not the painted box: what the picture's units measure, and what a mark is placed against. */}
                <div
                  className={styles.frame}
                  style={box(layout.frame)}
                  data-annotate-frame=""
                  data-zoomed={canvas.zoomed ? '' : undefined}
                />
                <svg
                  ref={overlay}
                  className={styles.overlay}
                  data-annotate-overlay=""
                  width={layout.world.width}
                  height={layout.world.height}
                  viewBox={`0 0 ${layout.world.width} ${layout.world.height}`}
                  role="img"
                  aria-label={t('panels:diagram.annotate.canvasLabel', 'Annotations on the step’s picture')}
                >
                  {selected && <SelectionUnder annotation={selected} layout={layout} />}
                  {drawing && (
                    <g
                      transform={`translate(${layout.frame.x} ${layout.frame.y}) scale(${layout.unit / CARD_FRAME_PX})`}
                    >
                      <DiagramXRayInsides insides={windows} />
                      <DiagramCloseUpInsides insides={insides} style={style} />
                      <DiagramAnnotationLayer drawing={drawing} style={style} />
                    </g>
                  )}
                  {selected &&
                    (canvas.editingPath && canBeShaped(selected.kind) ? (
                      <PathSelection
                        annotation={selected}
                        layout={layout}
                        zoom={zoom}
                        selectedNode={canvas.selectedNode}
                        coarse={canvas.coarse}
                      />
                    ) : (
                      // Edit Path moves nothing it cannot shape: no ends to offer.
                      <Selection
                        annotation={selected}
                        layout={layout}
                        zoom={zoom}
                        movable={!readOnly && !canvas.editingPath}
                        calloutPen={calloutPenUnits(style)}
                        coarse={canvas.coarse}
                      />
                    ))}
                  {canvas.anchorRing && (
                    <FaceRing
                      ring={canvas.anchorRing}
                      layout={layout}
                      className={styles.anchorFace}
                      strokeWidth={ANCHOR_FACE_PX / zoom}
                    />
                  )}
                  {canvas.anchorPoint && <AnchorPoint at={canvas.anchorPoint} layout={layout} zoom={zoom} />}
                  {canvas.pickHighlight && (
                    <FaceRing
                      ring={canvas.pickHighlight}
                      layout={layout}
                      className={styles.pickFace}
                      strokeWidth={PICK_FACE_PX / zoom}
                    />
                  )}
                  {canvas.frameOutline && canvas.frameSelected && (
                    <ZoomOutlineSelection outline={canvas.frameOutline} layout={layout} zoom={zoom} movable={!readOnly} frame />
                  )}
                  <PickMarks preview={canvas.pickPreview} layout={layout} zoom={zoom} />
                  <SnapTargets targets={canvas.snapTargets} layout={layout} zoom={zoom} />
                  {canvas.rightAnglePreview && <RightAngleGhost preview={canvas.rightAnglePreview} layout={layout} zoom={zoom} />}
                </svg>
              </div>
            )}
          </TransformComponent>
        </TransformWrapper>
        <ViewportToolbar
          ariaLabel={t('panels:diagram.annotate.controls', 'Annotate view controls')}
          zoomPercent={zoomPercent}
          zoomIn={zoomIn}
          zoomOut={zoomOut}
          fitToView={fitToView}
          setZoomLevel={setZoomLevel}
          groups={[]}
          tone="raised"
        />
      </div>
      {/* Outside the view in the React tree: see the component. */}
      {!readOnly && <DiagramAnnotateToolWindow container={view} step={step} />}
    </>
  );
}

function box({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  return { left: x, top: y, width, height };
}

/**
 * Where the selected annotation is, over everything: a wash along it — a
 * solid line's is under it (`SelectionUnder`) — and a dot at each end of a
 * line or an arrow to take hold of (`annotationEnds`) — a callout's at its
 * point; its box is taken where it is drawn. Sized for the screen at any zoom.
 */
function Selection({
  annotation,
  layout,
  zoom,
  movable,
  calloutPen,
  coarse,
}: {
  annotation: KnownDiagramAnnotation;
  layout: AnnotateLayout;
  zoom: number;
  /** Whether its ends can be taken hold of: not on a diagram that cannot change. */
  movable: boolean;
  /** A callout's outline's pen, in picture units: its box is washed where it is stroked. */
  calloutPen: number;
  /** The pointer is a finger: a transform box's handles are drawn for one. */
  coarse: boolean;
}) {
  const at = ([u, v]: readonly [number, number]) => [layout.frame.x + u * layout.unit, layout.frame.y + v * layout.unit];
  const handle = HANDLE_PX / zoom;
  const ring = (reach: number) => {
    const [x, y] = at(annotation.from);
    return <circle className={styles.selection} cx={x} cy={y} r={reach * layout.unit} data-selection="" />;
  };
  // Washed along as it is drawn: a sign or a label round its place, an arrow
  // along its arc or path, a push or a line straight, a callout round its box
  // and along its line. A switch, so a new kind has to say.
  let path: readonly (readonly [number, number])[];
  let box: ReturnType<typeof calloutShape>['box'] | null = null;
  switch (annotation.kind) {
    case 'label':
      return <LabelSelection annotation={annotation} layout={layout} zoom={zoom} movable={movable} />;
    case 'turn-over':
    case 'rotate':
      return ring(GLYPH_REACH);
    case 'circle':
      // Along its ring: what a press takes hold of.
      return ring(CIRCLE_RADIUS);
    case 'right-angle': {
      // Along its ∟ and its square, as one path; a dot at the vertex it
      // marks, which moves it, tied to it by a hairline (RA6), and one at the
      // square's far corner, which turns it.
      const grips = rightAngleGrips(annotation, INK_UNITS);
      const drawn = rightAngleOnCanvas(annotation, layout);
      return (
        <g data-selection="">
          <path className={styles.selection} d={drawn.d} />
          <CornerTie tie={drawn.tie} zoom={zoom} />
          {movable &&
            (['corner', 'direction'] as const).map((part) => {
              const [x, y] = at(grips[part]);
              return <circle key={part} className={styles.handle} cx={x} cy={y} r={handle} data-handle={part} />;
            })}
        </g>
      );
    }
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'white-arrow':
      path = arrowPolyline(annotation);
      break;
    case 'push-arrow':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
      path = [annotation.from, annotation.to];
      break;
    case 'solid-line':
      // Washed under its stroke (`SelectionUnder`): over it, the wash would tint the colour it is drawn in.
      path = [];
      break;
    case 'pleat-arrow': {
      // Along its bolt, tail to tip.
      const shape = pleatArrowInPicture(annotation, INK_UNITS);
      path = shape ? shape.bolt.map(({ x, y }) => [x, y] as const) : [annotation.from, annotation.to];
      break;
    }
    case 'angle-mark': {
      // Along its arc: it moves whole.
      const shape = angleMarkInPicture(annotation, INK_UNITS);
      path = shape ? angleMarkArcPoints(shape).map(({ x, y }) => [x, y] as const) : [];
      break;
    }
    case 'callout': {
      const shape = calloutShape(annotation);
      path = shape.line ?? [];
      // Along its outline as drawn, outside the box its words were measured for.
      box = calloutDrawnBox(shape.box, calloutPen);
      break;
    }
    case 'divisions':
      return <DivisionsSelection annotation={annotation} layout={layout} zoom={zoom} movable={movable} />;
    case 'close-up':
      return <CloseUpSelection annotation={annotation} layout={layout} zoom={zoom} movable={movable} />;
    case 'zoom':
    case 'x-ray':
      // Along its outline, all the way round, with its grips (Revision 2): an x-ray's window a circle's (Revision 3).
      return <ZoomOutlineSelection outline={zoomOutlineOf(annotation)} layout={layout} zoom={zoom} movable={movable} />;
    case 'star':
    case 'eye':
    case 'oval':
    case 'rectangle':
      // Its transform box, as an image's on the Edit canvas (Revision 3).
      return <TransformBoxSelection annotation={annotation} layout={layout} zoom={zoom} movable={movable} coarse={coarse} />;
  }
  const points = path.map(at);
  const corner = box && at([box.x, box.y]);
  return (
    <g data-selection="">
      {points.length > 1 && (
        <polyline className={styles.selection} points={points.map((point) => point.join(',')).join(' ')} />
      )}
      {box && corner && (
        <rect
          className={styles.selection}
          x={corner[0]}
          y={corner[1]}
          width={box.width * layout.unit}
          height={box.height * layout.unit}
          data-callout-box=""
        />
      )}
      {movable && annotationEnds(annotation).map((end) => {
        const [x, y] = at(annotation[end]);
        return <circle key={end} className={styles.handle} cx={x} cy={y} r={handle} data-handle={end} />;
      })}
    </g>
  );
}

/**
 * A selected label: washed round its words, at its size and weight (17b) —
 * hung text's where they hang — and, for hung text, a dot at its anchor,
 * which moves it whole and snaps as a callout's point does, tied to its words
 * by a hairline, as a right angle's corner is tied to its vertex.
 */
function LabelSelection({
  annotation,
  layout,
  zoom,
  movable,
}: {
  annotation: KnownDiagramAnnotation;
  layout: AnnotateLayout;
  zoom: number;
  movable: boolean;
}) {
  const at = ([u, v]: readonly [number, number]) => [layout.frame.x + u * layout.unit, layout.frame.y + v * layout.unit] as const;
  const { centre, halfWidth, size } = labelBox(annotation, LABEL_SIZE);
  const radius = halfWidth + 0.1 * size;
  const [cx, cy] = at(centre);
  const ends = annotationEnds(annotation);
  const [ax, ay] = at(annotation.from);
  // From the anchor to the ring round the words, along the way between them; none where the anchor is inside it.
  const apart = Math.hypot(centre[0] - annotation.from[0], centre[1] - annotation.from[1]);
  const rim = apart > radius ? at([centre[0] + ((annotation.from[0] - centre[0]) * radius) / apart, centre[1] + ((annotation.from[1] - centre[1]) * radius) / apart]) : null;
  return (
    <g data-selection="">
      <circle className={styles.selection} cx={cx} cy={cy} r={radius * layout.unit} />
      {ends.length > 0 && rim && <CornerTie tie={{ x1: ax, y1: ay, x2: rim[0], y2: rim[1] }} zoom={zoom} />}
      {movable &&
        ends.map((end) => {
          const [x, y] = at(annotation[end]);
          return <circle key={end} className={styles.handle} cx={x} cy={y} r={HANDLE_PX / zoom} data-handle={end} />;
        })}
    </g>
  );
}

/**
 * The wash along a selected solid line (17a), painted under the drawing rather
 * than over it as every other mark's is: a line is drawn in a colour of its
 * own, and the wash laid over it tints that colour — an orange line read as
 * mauve until it was let go. Under it, the line shows as it prints, in a wash
 * either side. Its ends' dots stay over everything (`Selection`).
 */
function SelectionUnder({ annotation, layout }: { annotation: KnownDiagramAnnotation; layout: AnnotateLayout }) {
  if (annotation.kind !== 'solid-line') return null;
  const points = [annotation.from, annotation.to].map(
    ([u, v]) => `${layout.frame.x + u * layout.unit},${layout.frame.y + v * layout.unit}`
  );
  return <polyline className={styles.selection} points={points.join(' ')} data-selection-under="" />;
}

/**
 * Selected equal divisions (Revision 2): washed along their ink — the line,
 * the dividers, the ticks and the count — with a hairline along the line they
 * measure, which they never draw, between a dot at each of its ends, which
 * moves that end; and a handle at the middle of their line, which sets how
 * far off it stands, as a drag of the mark does.
 */
function DivisionsSelection({
  annotation,
  layout,
  zoom,
  movable,
}: {
  annotation: KnownDiagramAnnotation;
  layout: AnnotateLayout;
  zoom: number;
  movable: boolean;
}) {
  const at = ([u, v]: readonly [number, number]) => [layout.frame.x + u * layout.unit, layout.frame.y + v * layout.unit] as const;
  const world = ({ x, y }: SvgPoint) => at([x, y]);
  const shape = divisionsInPicture(annotation, INK_UNITS);
  const handle = HANDLE_PX / zoom;
  const [x1, y1] = at(annotation.from);
  const [x2, y2] = at(annotation.to);
  const number = shape?.number;
  const corner = number && world({ x: number.at.x - number.halfWidth, y: number.at.y - number.halfHeight });
  const [hx, hy] = at(divisionsOffsetGrip(annotation, INK_UNITS));
  return (
    <g data-selection="" data-divisions-selection="">
      {shape &&
        divisionsStrokes(shape).map(([a, b], index) => (
          <polyline key={index} className={styles.selection} points={polylinePoints([world(a), world(b)])} />
        ))}
      {number && corner && (
        <rect
          className={styles.selection}
          x={corner[0]}
          y={corner[1]}
          width={2 * number.halfWidth * layout.unit}
          height={2 * number.halfHeight * layout.unit}
        />
      )}
      <line className={styles.measuredLine} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={TIE_PX / zoom} data-measured-line="" />
      {movable &&
        annotationEnds(annotation).map((end) => {
          const [x, y] = at(annotation[end]);
          return <circle key={end} className={styles.handle} cx={x} cy={y} r={handle} data-handle={end} />;
        })}
      {movable && <circle className={styles.handle} cx={hx} cy={hy} r={handle * 0.8} data-handle="offset" />}
    </g>
  );
}

/**
 * A selected close-up (15f): washed along both rings and the line between
 * them, a dot at each centre — its circle moves by its inside — and one on
 * each ring, on the side away from the other, which resizes it.
 */
function CloseUpSelection({
  annotation,
  layout,
  zoom,
  movable,
}: {
  annotation: KnownDiagramAnnotation;
  layout: AnnotateLayout;
  zoom: number;
  movable: boolean;
}) {
  const at = ([u, v]: readonly [number, number]) => [layout.frame.x + u * layout.unit, layout.frame.y + v * layout.unit] as const;
  const { area, inset, line } = closeUpShape(annotation);
  const handle = HANDLE_PX / zoom;
  const circles = { from: area, to: inset } as const;
  return (
    <g data-selection="">
      {(['from', 'to'] as const).map((end) => {
        const [x, y] = at(circles[end].centre);
        return <circle key={end} className={styles.selection} cx={x} cy={y} r={circles[end].radius * layout.unit} />;
      })}
      {line && <polyline className={styles.selection} points={polylinePoints(line.map(at))} />}
      {movable &&
        (['from', 'to'] as const).flatMap((end) => {
          const { centre, radius } = circles[end];
          const other = circles[end === 'from' ? 'to' : 'from'].centre;
          const apart = Math.hypot(centre[0] - other[0], centre[1] - other[1]);
          const away = apart > 0 ? [(centre[0] - other[0]) / apart, (centre[1] - other[1]) / apart] : [1, 0];
          const [x, y] = at(centre);
          const [rx, ry] = at([centre[0] + away[0]! * radius, centre[1] + away[1]! * radius]);
          return [
            <circle key={end} className={styles.handle} cx={x} cy={y} r={handle} data-handle={end} />,
            <circle key={`ring-${end}`} className={styles.handle} cx={rx} cy={ry} r={handle} data-handle={`ring-${end}`} />,
          ];
        })}
    </g>
  );
}

/**
 * A selected enlarge area, or an enlarged step's frame (Revision 2): washed
 * along its outline, with its grips — its centre's dot, which moves it, and
 * a circle's dot on its rim, or a rectangle's corners and edges' middles,
 * which resize it. A frame's own wash is a hairline: it is drawn over the
 * picture round it, where a wash would hide what it lies on.
 */
function ZoomOutlineSelection({
  outline,
  layout,
  zoom,
  movable,
  frame = false,
}: {
  outline: DiagramZoomOutline;
  layout: AnnotateLayout;
  zoom: number;
  movable: boolean;
  frame?: boolean;
}) {
  const at = ([u, v]: readonly [number, number]) => [layout.frame.x + u * layout.unit, layout.frame.y + v * layout.unit] as const;
  const points = zoomOutlinePoints(outline).map(at);
  const handle = HANDLE_PX / zoom;
  return (
    <g data-selection="" data-zoom-selection={frame ? 'frame' : 'area'}>
      {frame ? (
        <polygon
          className={styles.frameLine}
          points={polylinePoints(points)}
          strokeWidth={FRAME_LINE_PX.width / zoom}
          strokeDasharray={`${FRAME_LINE_PX.dash / zoom} ${FRAME_LINE_PX.gap / zoom}`}
        />
      ) : (
        <polygon className={styles.selection} points={polylinePoints(points)} />
      )}
      {movable &&
        zoomGrips(outline).map(({ grip, at: point }) => {
          const [x, y] = at(point);
          const name = grip.part === 'corner' ? `corner-${grip.corner}` : grip.part === 'edge' ? `edge-${grip.edge}` : grip.part;
          return <circle key={name} className={styles.handle} cx={x} cy={y} r={handle} data-handle={`zoom-${name}`} />;
        })}
    </g>
  );
}

/**
 * A selected star's, eye's or shape's transform box (Revision 3): the Edit
 * canvas's image selection, from the same layout (`transformHandles`) — its
 * outline at 1.5 screen px, a square at each corner that scales a glyph about
 * its centre, or at each corner and each edge's middle that resizes an oval or
 * a rectangle, and a round handle 18 screen px out from each corner that
 * turns it — for a finger larger, and a touch target out (18d follow-up),
 * as `transformHandleSizes` says — in the
 * selection's ink, the squares and handles white as the Diagram's grips are,
 * sized for the screen at any zoom — their strokes too, divided by the
 * camera's zoom as the frame line's are: the world is drawn under the
 * camera's CSS transform, which `non-scaling-stroke` does not see (18b
 * review). Round a small star or eye the box is drawn at least 24 screen px
 * across (R3-30c B). No handles on a diagram that cannot change.
 */
function TransformBoxSelection({
  annotation,
  layout,
  zoom,
  movable,
  coarse,
}: {
  annotation: KnownDiagramAnnotation;
  layout: AnnotateLayout;
  zoom: number;
  movable: boolean;
  coarse: boolean;
}) {
  const sizes = transformHandleSizes(coarse);
  // One screen px, in picture units: what the handles are laid out and pressed at.
  const drawn = transformBoxHandles(annotation, 1 / (zoom * layout.unit), sizes);
  if (!drawn) return null;
  const at = ({ x, y }: { x: number; y: number }) => [layout.frame.x + x * layout.unit, layout.frame.y + y * layout.unit] as const;
  const corners = drawn.corners.map(([x, y]) => at({ x, y }));
  const side = sizes.square / zoom;
  const stroke = TRANSFORM_STROKE_PX / zoom;
  return (
    <g data-selection="" data-transform-box="">
      <polygon className={styles.transformBox} points={polylinePoints(corners)} strokeWidth={stroke} />
      {movable &&
        drawn.handles.rotate.map(({ corner, at: point }) => {
          const [x, y] = at(point);
          return (
            <circle
              key={`rotate-${corner}`}
              className={styles.transformHandle}
              cx={x}
              cy={y}
              r={sizes.turnRadius / zoom}
              strokeWidth={stroke}
              data-handle={`rotate-${corner}`}
            />
          );
        })}
      {movable &&
        drawn.handles.scale.map(({ handle, at: point }) => {
          const [x, y] = at(point);
          return (
            <rect
              key={handle}
              className={styles.transformHandle}
              x={x - side / 2}
              y={y - side / 2}
              width={side}
              height={side}
              strokeWidth={stroke}
              data-handle={`scale-${handle}`}
            />
          );
        })}
    </g>
  );
}

/**
 * A face's ring as the picture draws it, over the marks (Revision 2): the
 * selected area's or frame's anchor face, outlined in the selection's ink,
 * or the face a click would anchor to in the pick mode, filled lightly.
 */
function FaceRing({
  ring,
  layout,
  className,
  strokeWidth,
}: {
  ring: readonly (readonly [number, number])[];
  layout: AnnotateLayout;
  className: string | undefined;
  /** In the world's px: its screen px over the camera's zoom. */
  strokeWidth: number;
}) {
  const at = ([u, v]: readonly [number, number]) => [layout.frame.x + u * layout.unit, layout.frame.y + v * layout.unit] as const;
  return <polygon className={className} points={polylinePoints(ring.map(at))} strokeWidth={strokeWidth} data-face-ring="" />;
}

/**
 * A selected x-ray's picked point (Revision 3): a small ring with a dot, in
 * the selection's ink, at a size on screen whatever the zoom — where its
 * layers are counted, as an enlarge area's anchor face is outlined.
 */
function AnchorPoint({ at: [u, v], layout, zoom }: { at: readonly [number, number]; layout: AnnotateLayout; zoom: number }) {
  const [cx, cy] = [layout.frame.x + u * layout.unit, layout.frame.y + v * layout.unit];
  return (
    <g className={styles.anchorPoint} strokeWidth={ANCHOR_FACE_PX / zoom}>
      <circle cx={cx} cy={cy} r={ANCHOR_POINT_PX / zoom} data-x-ray-anchor="" />
      <circle cx={cx} cy={cy} r={ANCHOR_DOT_PX / zoom} className={styles.anchorPointDot} />
    </g>
  );
}

function polylinePoints(points: readonly (readonly number[])[]): string {
  return points.map((point) => point.join(',')).join(' ');
}

/**
 * A right-angle mark on the canvas, in world px: its ∟ and its square as one
 * path's data, and the hairline that ties it to the vertex it marks, from the
 * vertex to the ∟'s corner (RA6) — the vertex's dot otherwise sits alone in
 * the gap the mark leaves the lines.
 */
function rightAngleOnCanvas(
  mark: Pick<KnownDiagramAnnotation, 'from' | 'to'>,
  layout: AnnotateLayout
): { d: string; tie: { x1: number; y1: number; x2: number; y2: number } } {
  const world = ({ x, y }: SvgPoint): SvgPoint => ({ x: layout.frame.x + x * layout.unit, y: layout.frame.y + y * layout.unit });
  const { legs, square } = rightAngleInPicture(mark, INK_UNITS);
  const inner = world(legs[1]);
  const vertex = world({ x: mark.from[0], y: mark.from[1] });
  return {
    d: rightAnglePathData({
      legs: [world(legs[0]), inner, world(legs[2])],
      square: [world(square[0]), world(square[1]), world(square[2])],
    }),
    tie: { x1: vertex.x, y1: vertex.y, x2: inner.x, y2: inner.y },
  };
}

/**
 * The right angle a click puts down where the pointer is (decision 12), over
 * everything: the mark in the selection's colour on a white halo, at the size
 * the canvas draws it, tied to its vertex as a selected one is — a ghost of
 * the mark, never the mark.
 */
function RightAngleGhost({ preview, layout, zoom }: { preview: RightAnglePreview; layout: AnnotateLayout; zoom: number }) {
  const drawn = rightAngleOnCanvas({ from: preview.at, to: [preview.at[0] + preview.opens[0], preview.at[1] + preview.opens[1]] }, layout);
  return (
    <g data-right-angle-preview="">
      <path className={styles.ghostHalo} d={drawn.d} />
      <path className={styles.ghost} d={drawn.d} />
      <CornerTie tie={drawn.tie} zoom={zoom} />
    </g>
  );
}

/**
 * A right angle's tie to the vertex it marks (RA6): a hairline at any zoom.
 * The camera scales the overlay by `zoom` with a CSS transform, which no
 * `vector-effect` undoes, so its width is divided by the zoom as the grips'
 * sizes are.
 */
function CornerTie({ tie, zoom }: { tie: { x1: number; y1: number; x2: number; y2: number }; zoom: number }) {
  return <line className={styles.cornerTie} {...tie} strokeWidth={TIE_PX / zoom} data-corner-tie="" />;
}

/**
 * A fold arrow in Edit Path (decision 3), over everything: a hairline along
 * its curve — a fold-and-unfold arrow's out and back — every node — smooth a circle, corner a square, the selected one
 * filled — and the handles that shape the curve either side of the selected
 * node (Affinity): its own two and its neighbours' facing ones. An arc shows
 * the nodes its first edit would give it. Sized for the screen at any zoom.
 */
function PathSelection({
  annotation,
  layout,
  zoom,
  selectedNode,
  coarse,
}: {
  annotation: KnownDiagramAnnotation;
  layout: AnnotateLayout;
  zoom: number;
  selectedNode: number | null;
  coarse: boolean;
}) {
  const nodes = pathNodesOf(annotation);
  if (!nodes) return null;
  const at = ([u, v]: readonly [number, number]) => [layout.frame.x + u * layout.unit, layout.frame.y + v * layout.unit] as const;
  const node = (coarse ? NODE_PX.coarse : NODE_PX.fine) / zoom;
  const handle = (coarse ? PATH_HANDLE_PX.coarse : PATH_HANDLE_PX.fine) / zoom;
  const points = (pathNodesPolyline(annotation) ?? []).map(at);
  return (
    <g data-selection="" data-path-selection="">
      <polyline className={styles.pathLine} points={points.map((point) => point.join(',')).join(' ')} />
      {visiblePathHandles(nodes, selectedNode).map(({ node: owner, side, at: point }) => {
        const [x1, y1] = at(nodes[owner]!.at);
        const [x2, y2] = at(point);
        return (
          <g key={`${owner}-${side}`}>
            <line className={styles.handleArm} x1={x1} y1={y1} x2={x2} y2={y2} />
            <circle className={styles.pathHandle} cx={x2} cy={y2} r={handle} data-path-handle={`${owner}-${side}`} />
          </g>
        );
      })}
      {nodes.map((each, index) => {
        const [x, y] = at(each.at);
        const selected = index === selectedNode || undefined;
        return each.type === 'corner' ? (
          <rect
            key={index}
            className={styles.node}
            x={x - node}
            y={y - node}
            width={2 * node}
            height={2 * node}
            data-path-node={index}
            data-corner=""
            data-selected={selected}
          />
        ) : (
          <circle key={index} className={styles.node} cx={x} cy={y} r={node} data-path-node={index} data-selected={selected} />
        );
      })}
    </g>
  );
}

/**
 * A pick tool's picks (15b), over the marks: the lines picked, the one a
 * press would pick — firmly where the press takes it outright, as Equal
 * Divisions' click does — the midline two parallel lines make, and the points
 * picked — sized for the screen. Lines run on past their ends, as the
 * bisector takes them, a little way each side.
 */
function PickMarks({ preview, layout, zoom }: { preview: PickPreview; layout: AnnotateLayout; zoom: number }) {
  const { points, lines, hovered, midline, hoverTakes } = preview;
  if (points.length === 0 && lines.length === 0 && !hovered && !midline) return null;
  const at = ([u, v]: readonly [number, number]) => [layout.frame.x + u * layout.unit, layout.frame.y + v * layout.unit] as const;
  const segment = (
    key: string,
    className: string,
    a: readonly [number, number],
    b: readonly [number, number],
    takes?: boolean
  ) => {
    const [x1, y1] = at(a);
    const [x2, y2] = at(b);
    return <line key={key} className={className} x1={x1} y1={y1} x2={x2} y2={y2} data-takes={takes ? '' : undefined} />;
  };
  // The midline across the frame and past it: a line, not a segment.
  const across = midline
    ? (() => {
        const length = Math.hypot(midline.along[0], midline.along[1]) || 1;
        const reach = 2;
        const [ux, uy] = [(midline.along[0] / length) * reach, (midline.along[1] / length) * reach];
        return segment('midline', styles.pickMidline, [midline.at[0] - ux, midline.at[1] - uy], [midline.at[0] + ux, midline.at[1] + uy]);
      })()
    : null;
  return (
    <g data-pick-marks="">
      {hovered && segment('hovered', styles.pickHover, hovered.a, hovered.b, hoverTakes)}
      {lines.map((line, index) => segment(`line-${index}`, styles.pickLine, line.a, line.b))}
      {across}
      {points.map((point, index) => {
        const [x, y] = at(point);
        return <circle key={index} className={styles.pickPoint} cx={x} cy={y} r={SNAP_PX / zoom} data-pick-point={index} />;
      })}
    </g>
  );
}

/**
 * Where a press would land, or where the ends in hand have (decision 9), over
 * everything, in the selection's colour on a white halo: a mark for what the
 * target is — a dot where lines meet, a ring where one ends, a square at a
 * corner of the paper, a diamond on a References mark, a cross where two lines
 * cross, a ring round a dot on another annotation. Sized for the screen.
 */
function SnapTargets({ targets, layout, zoom }: { targets: readonly SnapTarget[]; layout: AnnotateLayout; zoom: number }) {
  if (targets.length === 0) return null;
  const size = SNAP_PX / zoom;
  return (
    <g data-snap-targets="">
      {targets.map((target, index) => {
        const x = layout.frame.x + target.at[0] * layout.unit;
        const y = layout.frame.y + target.at[1] * layout.unit;
        const mark = snapMark(target.kind, x, y, size);
        return (
          <g key={index} data-snap-target={target.kind}>
            <g className={styles.snapHalo}>{mark}</g>
            <g className={styles.snapMark} data-filled={target.kind === 'vertex' || undefined}>
              {mark}
            </g>
          </g>
        );
      })}
    </g>
  );
}

/** A target's mark at (`x`, `y`), `size` its half-width: a switch, so a new kind of target has to say. */
function snapMark(kind: SnapTarget['kind'], x: number, y: number, size: number) {
  switch (kind) {
    case 'vertex':
      return <circle cx={x} cy={y} r={size * 0.7} />;
    case 'end':
      return <circle cx={x} cy={y} r={size * 0.8} />;
    case 'corner':
      return <rect x={x - size * 0.8} y={y - size * 0.8} width={size * 1.6} height={size * 1.6} />;
    case 'point':
      return <path d={`M ${x} ${y - size} L ${x + size} ${y} L ${x} ${y + size} L ${x - size} ${y} Z`} />;
    case 'crossing':
      return (
        <path d={`M ${x - size} ${y - size} L ${x + size} ${y + size} M ${x + size} ${y - size} L ${x - size} ${y + size}`} />
      );
    case 'annotation':
      return (
        <>
          <circle cx={x} cy={y} r={size} />
          <circle cx={x} cy={y} r={size * 0.3} data-dot="" />
        </>
      );
  }
}
