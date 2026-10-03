import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { arrowPolyline } from '../../diagram/annotate/annotationHit';
import { annotationDrawing } from '../../diagram/annotate/annotationPrimitives';
import { CARD_FRAME_PX } from '../../diagram/annotate/paintAnnotations';
import { GLYPH_REACH, useAnnotateCanvas, type AnnotateLayout } from '../../diagram/annotate/useAnnotateCanvas';
import { isArrowKind, isPointKind, labelHalfWidth, LABEL_SIZE } from '../../diagram/annotate/annotationModel';
import {
  isKnownAnnotation,
  type DiagramAsset,
  type DiagramStep,
  type DiagramStyle,
  type KnownDiagramAnnotation,
} from '../../diagram/document/diagramDocument';
import { VIEWPORT_PINCH_ZOOM, VIEWPORT_WHEEL_ZOOM } from '../../hooks/useViewportSurface';
import { ViewportToolbar } from '../panels/ViewportToolbar';
import { DiagramAnnotationLayer } from './DiagramAnnotationLayer';
import styles from './DiagramAnnotateCanvas.module.css';

/** An end's dot, in screen px. */
const HANDLE_PX = 5;

/**
 * The Annotate canvas (D8): the step's picture alone, on its paper, with its
 * annotations drawn over it live as they print — under one camera, with room
 * round the picture for an arrow that starts off it. The selected annotation
 * shows where it is and, for a line or an arrow, a dot at each end. The
 * behaviour is `useAnnotateCanvas`'s.
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
  const { camera, overlay, url, layout, shown, tool, selectedId, onPointerDownCapture, handlers } = useAnnotateCanvas({
    step,
    assets,
    style,
    readOnly,
  });
  const { containerRef, transformRef, zoomPercent, spacePressed, zoomIn, zoomOut, fitToView, setZoomLevel, onInit, onTransformed } =
    camera;
  const drawing = useMemo(
    () => (layout ? annotationDrawing(shown, layout.pictureFrame, CARD_FRAME_PX, style) : null),
    [layout, shown, style]
  );
  const selected = shown.find(
    (annotation): annotation is KnownDiagramAnnotation => annotation.id === selectedId && isKnownAnnotation(annotation)
  );
  const zoom = Math.max(zoomPercent, 1) / 100;

  return (
    <div
      ref={containerRef}
      className={styles.view}
      data-space-pan={spacePressed || undefined}
      tabIndex={-1}
      onPointerDownCapture={onPointerDownCapture}
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
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={layout ? { width: layout.world.width, height: layout.world.height } : undefined}
        >
          {layout && (
            <div className={styles.world} style={{ width: layout.world.width, height: layout.world.height }}>
              <div className={styles.paper} style={box(layout.picture)}>
                {url && <img className={styles.picture} src={url} alt="" draggable={false} />}
              </div>
              <svg
                ref={overlay}
                className={styles.overlay}
                data-annotate-overlay=""
                data-tool={tool ?? 'select'}
                width={layout.world.width}
                height={layout.world.height}
                viewBox={`0 0 ${layout.world.width} ${layout.world.height}`}
                role="img"
                aria-label={t('panels:diagram.annotate.canvasLabel', 'Annotations on the step’s picture')}
                {...handlers}
              >
                {drawing && (
                  <g
                    transform={`translate(${layout.frame.x} ${layout.frame.y}) scale(${layout.unit / CARD_FRAME_PX})`}
                  >
                    <DiagramAnnotationLayer drawing={drawing} style={style} />
                  </g>
                )}
                {selected && <Selection annotation={selected} layout={layout} zoom={zoom} movable={!readOnly} />}
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
      />
    </div>
  );
}

function box({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  return { left: x, top: y, width, height };
}

/**
 * Where the selected annotation is, over everything: a wash along it, and a
 * dot at each end of a line or an arrow to take hold of. Sized for the
 * screen at any zoom.
 */
function Selection({
  annotation,
  layout,
  zoom,
  movable,
}: {
  annotation: KnownDiagramAnnotation;
  layout: AnnotateLayout;
  zoom: number;
  /** Whether its ends can be taken hold of: not on a diagram that cannot change. */
  movable: boolean;
}) {
  const at = ([u, v]: readonly [number, number]) => [layout.frame.x + u * layout.unit, layout.frame.y + v * layout.unit];
  const handle = HANDLE_PX / zoom;
  if (isPointKind(annotation.kind)) {
    const [x, y] = at(annotation.from);
    const reach = (annotation.kind === 'label' ? labelHalfWidth(annotation.text ?? '') + 0.1 * LABEL_SIZE : GLYPH_REACH) * layout.unit;
    return <circle className={styles.selection} cx={x} cy={y} r={reach} data-selection="" />;
  }
  const points = (isArrowKind(annotation.kind) ? arrowPolyline(annotation) : [annotation.from, annotation.to]).map(at);
  return (
    <g data-selection="">
      <polyline className={styles.selection} points={points.map((point) => point.join(',')).join(' ')} />
      {movable && (['from', 'to'] as const).map((end) => {
        const [x, y] = at(annotation[end]);
        return <circle key={end} className={styles.handle} cx={x} cy={y} r={handle} data-handle={end} />;
      })}
    </g>
  );
}
