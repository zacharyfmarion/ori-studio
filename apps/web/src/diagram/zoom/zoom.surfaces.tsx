import { renderToStaticMarkup } from 'react-dom/server';
import { DiagramAnnotationLayer } from '../../components/diagram/DiagramAnnotationLayer';
import { DiagramZoomView } from '../../components/diagram/DiagramZoomView';
import { annotationDrawing } from '../annotate/annotationPrimitives';
import { annotatedPicture, CARD_FRAME_PX } from '../annotate/paintAnnotations';
import { zoomedCanvasLayout } from '../annotate/useAnnotateCanvas';
import { DEFAULT_DIAGRAM_STYLE, type DiagramAsset, type DiagramStep } from '../document/diagramDocument';
import { estimateTextSetter } from '../pages/estimateTextSetter';
import { cellPicture } from '../pages/pagePictures';
import { paintSource, stepPictureSource } from '../pictures/paintDiagramStep';
import { stepPictureFrame } from '../pictures/pictureFrame';
import { zoomedCardPicture, zoomedSource } from './paintZoomed';
import { markGeometry } from './stepView';

const style = DEFAULT_DIAGRAM_STYLE;

/** A page cell 60 mm square, its picture fitted as a picture with no paper is. */
const CELL = { pictureMm: { x: 10, y: 20, size: 60 }, mmPerUnit: null, frameMm: null };

/**
 * An enlarged step as each surface paints it (16d): a card's whole SVG, a
 * page cell's markup with what it sets and where, and the canvas's window
 * and marks as React draws them. Null where the step is not enlarged.
 */
export function zoomSurfaces(step: DiagramStep, assets: Readonly<Record<string, DiagramAsset>>) {
  const zoomed = zoomedSource(step, assets)!;
  const layers = markGeometry(step, assets, style).layers;
  const card = zoomedCardPicture(zoomed, step.annotations, style, layers);
  const page = cellPicture(step, assets, style, CELL, 'c0-', { hanStyle: 'sc', runs: estimateTextSetter.runs });
  const layout = zoomedCanvasLayout(zoomed)!;
  const drawing = annotationDrawing(step.annotations, layout.pictureFrame, CARD_FRAME_PX, style, layers);
  const canvas = renderToStaticMarkup(
    <g>
      <DiagramZoomView zoomed={zoomed} layout={layout} style={style} />
      <g transform={`translate(${layout.frame.x} ${layout.frame.y}) scale(${layout.unit / CARD_FRAME_PX})`}>
        <DiagramAnnotationLayer drawing={drawing} style={style} />
      </g>
    </g>
  );
  return { card, page, canvas };
}

/** The step an area is on, as a card and a page paint it, and its marks as the canvas draws them. */
export function areaSurfaces(step: DiagramStep, assets: Readonly<Record<string, DiagramAsset>>) {
  const source = stepPictureSource(step, assets)!;
  const card = annotatedPicture(paintSource(source, style)!, step.annotations, style);
  const page = cellPicture(step, assets, style, CELL, 'c0-', { hanStyle: 'sc', runs: estimateTextSetter.runs });
  const frame = stepPictureFrame(step, assets)!;
  const canvas = renderToStaticMarkup(
    <DiagramAnnotationLayer drawing={annotationDrawing(step.annotations, frame, CARD_FRAME_PX, style)} style={style} />
  );
  return { card, page, canvas };
}
