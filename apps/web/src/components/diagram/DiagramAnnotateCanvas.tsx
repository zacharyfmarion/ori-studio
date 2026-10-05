import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { isDrawingTool } from '../../diagram/annotate/annotateTools';
import {
  angleMarkInPicture,
  arrowPolyline,
  pleatArrowInPicture,
  rightAngleGrips,
  rightAngleLegs,
} from '../../diagram/annotate/annotationHit';
import { angleMarkArcPoints } from '../../cp-workspace/references/stepDiagramGeometry';
import { pathNodesOf, visiblePathHandles } from '../../diagram/annotate/annotationPath';
import { annotationDrawing } from '../../diagram/annotate/annotationPrimitives';
import { pictureGeometry } from '../../diagram/annotate/pictureGeometry';
import { useCloseUpInsides } from '../../diagram/annotate/useCloseUpInsides';
import type { SnapTarget } from '../../diagram/annotate/pictureSnap';
import { CARD_FRAME_PX } from '../../diagram/annotate/paintAnnotations';
import {
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
  labelHalfWidth,
  LABEL_SIZE,
} from '../../diagram/annotate/annotationModel';
import {
  isKnownAnnotation,
  type DiagramAsset,
  type DiagramStep,
  type DiagramStyle,
  type KnownDiagramAnnotation,
} from '../../diagram/document/diagramDocument';
import { VIEWPORT_PINCH_ZOOM, VIEWPORT_WHEEL_ZOOM } from '../../hooks/useViewportSurface';
import { ViewportToolbar } from '../panels/ViewportToolbar';
import { DiagramAnnotateToolWindow } from './DiagramAnnotateToolWindow';
import { DiagramAnnotationLayer } from './DiagramAnnotationLayer';
import { DiagramCloseUpInsides } from './DiagramCloseUpInsides';
import styles from './DiagramAnnotateCanvas.module.css';

/** An end's dot, in screen px. */
const HANDLE_PX = 5;
/** A snap target's mark, in screen px: half its size. */
const SNAP_PX = 5;
/** Edit Path's grips, in screen px: a node's half-size and a handle's dot — larger for a finger. */
const NODE_PX = { fine: 4.5, coarse: 7 } as const;
const PATH_HANDLE_PX = { fine: 3.5, coarse: 5.5 } as const;

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
  // A flat fold's layers: a mark behind a flap is dotted under it as it is drawn (15e).
  const layers = useMemo(() => pictureGeometry(step, assets, style).layers, [step, assets, style]);
  const drawing = useMemo(
    () => (layout ? annotationDrawing(shown, layout.pictureFrame, CARD_FRAME_PX, style, layers) : null),
    [layout, shown, style, layers]
  );
  // Each close-up's inside, under the marks: the picture painted again, larger (15f).
  const insides = useCloseUpInsides({
    drawing,
    shown,
    committed: step.annotations,
    source: canvas.source,
    style,
    layers,
    pictureFrame: layout?.pictureFrame ?? null,
    framePx: CARD_FRAME_PX,
  });
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
        tabIndex={-1}
        onPointerDownCapture={onPointerDownCapture}
        {...handlers}
      >
        <TransformWrapper
          ref={transformRef}
          initialScale={1}
          minScale={0.1}
          maxScale={12}
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
                <div className={styles.paper} style={box(layout.picture)}>
                  {url && <img className={styles.picture} src={url} alt="" draggable={false} />}
                </div>
                {/* The frame, not the painted box: what the picture's units measure, and what a mark is placed against. */}
                <div className={styles.frame} style={box(layout.frame)} data-annotate-frame="" />
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
                  {drawing && (
                    <g
                      transform={`translate(${layout.frame.x} ${layout.frame.y}) scale(${layout.unit / CARD_FRAME_PX})`}
                    >
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
                      />
                    ))}
                  <PickMarks preview={canvas.pickPreview} layout={layout} zoom={zoom} />
                  <SnapTargets targets={canvas.snapTargets} layout={layout} zoom={zoom} />
                  {canvas.rightAnglePreview && <RightAngleGhost preview={canvas.rightAnglePreview} layout={layout} />}
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
 * Where the selected annotation is, over everything: a wash along it, and a
 * dot at each end of a line or an arrow to take hold of (`annotationEnds`) —
 * a callout's at its point; its box is taken where it is drawn. Sized for
 * the screen at any zoom.
 */
function Selection({
  annotation,
  layout,
  zoom,
  movable,
  calloutPen,
}: {
  annotation: KnownDiagramAnnotation;
  layout: AnnotateLayout;
  zoom: number;
  /** Whether its ends can be taken hold of: not on a diagram that cannot change. */
  movable: boolean;
  /** A callout's outline's pen, in picture units: its box is washed where it is stroked. */
  calloutPen: number;
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
      return ring(labelHalfWidth(annotation.text ?? '') + 0.1 * LABEL_SIZE);
    case 'turn-over':
    case 'rotate':
      return ring(GLYPH_REACH);
    case 'circle':
      // Along its ring: what a press takes hold of.
      return ring(CIRCLE_RADIUS);
    case 'right-angle': {
      // Along its legs, and a dot at its corner, which moves it, and at the
      // square's far corner, which turns it.
      const grips = rightAngleGrips(annotation, INK_UNITS);
      return (
        <g data-selection="">
          <polyline className={styles.selection} points={polylinePoints(rightAngleLegs(annotation, INK_UNITS).map(at))} />
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
    case 'close-up':
      return <CloseUpSelection annotation={annotation} layout={layout} zoom={zoom} movable={movable} />;
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
      {movable && annotationEnds(annotation.kind).map((end) => {
        const [x, y] = at(annotation[end]);
        return <circle key={end} className={styles.handle} cx={x} cy={y} r={handle} data-handle={end} />;
      })}
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

function polylinePoints(points: readonly (readonly number[])[]): string {
  return points.map((point) => point.join(',')).join(' ');
}

/**
 * The right angle a click puts down where the pointer is (decision 12), over
 * everything: its open square in the selection's colour on a white halo, at
 * the size the canvas draws it — a ghost of the mark, never the mark.
 */
function RightAngleGhost({ preview, layout }: { preview: RightAnglePreview; layout: AnnotateLayout }) {
  const legs = rightAngleLegs({ from: preview.at, to: [preview.at[0] + preview.opens[0], preview.at[1] + preview.opens[1]] }, INK_UNITS);
  const points = polylinePoints(legs.map(([u, v]) => [layout.frame.x + u * layout.unit, layout.frame.y + v * layout.unit]));
  return (
    <g data-right-angle-preview="">
      <polyline className={styles.ghostHalo} points={points} />
      <polyline className={styles.ghost} points={points} />
    </g>
  );
}

/**
 * A fold arrow in Edit Path (decision 3), over everything: a hairline along
 * its curve, every node — smooth a circle, corner a square, the selected one
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
  const points = arrowPolyline(annotation).map(at);
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
 * press would pick, the midline two parallel lines make, and the points
 * picked — sized for the screen. Lines run on past their ends, as the
 * bisector takes them, a little way each side.
 */
function PickMarks({ preview, layout, zoom }: { preview: PickPreview; layout: AnnotateLayout; zoom: number }) {
  const { points, lines, hovered, midline } = preview;
  if (points.length === 0 && lines.length === 0 && !hovered && !midline) return null;
  const at = ([u, v]: readonly [number, number]) => [layout.frame.x + u * layout.unit, layout.frame.y + v * layout.unit] as const;
  const segment = (key: string, className: string, a: readonly [number, number], b: readonly [number, number]) => {
    const [x1, y1] = at(a);
    const [x2, y2] = at(b);
    return <line key={key} className={className} x1={x1} y1={y1} x2={x2} y2={y2} />;
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
      {hovered && segment('hovered', styles.pickHover, hovered.a, hovered.b)}
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
