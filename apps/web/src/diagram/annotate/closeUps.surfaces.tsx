import { renderToStaticMarkup } from 'react-dom/server';
import { DiagramAnnotationLayer } from '../../components/diagram/DiagramAnnotationLayer';
import { DiagramCloseUpInsides } from '../../components/diagram/DiagramCloseUpInsides';
import { DEFAULT_DIAGRAM_STYLE, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { estimateTextSetter } from '../pages/estimateTextSetter';
import { cellPicture } from '../pages/pagePictures';
import { paintSource, stepPictureSource } from '../pictures/paintDiagramStep';
import { annotationDrawing } from './annotationPrimitives';
import { annotatedPicture, CARD_FRAME_PX } from './paintAnnotations';
import { closeUpInsides } from './useCloseUpInsides';

const style = DEFAULT_DIAGRAM_STYLE;

/**
 * A step's close-ups as each surface paints them (15f), on `cpStep`'s square
 * of paper: a card's whole SVG, a page cell's markup with what it sets and
 * where, and the canvas's insides and marks as React draws them.
 */
export function closeUpSurfaces(annotations: readonly KnownDiagramAnnotation[]) {
  const step = { ...cpStep('step-1'), annotations: [...annotations] };
  const source = stepPictureSource(step, {})!;
  const painted = paintSource(source, style)!;
  const card = annotatedPicture(painted, annotations, style, 1, null, (scale) => paintSource(source, style, undefined, scale));
  const cell = { pictureMm: { x: 10, y: 20, size: 60 }, mmPerUnit: null, frameMm: null };
  const page = cellPicture(step, {}, style, cell, 'c0-', { hanStyle: 'sc', runs: estimateTextSetter.runs });
  const pictureFrame = { width: 1, height: 1 };
  const drawing = annotationDrawing(annotations, pictureFrame, CARD_FRAME_PX, style);
  const insides = closeUpInsides({
    drawing,
    shown: annotations,
    committed: annotations,
    source,
    style,
    layers: null,
    pictureFrame,
    framePx: CARD_FRAME_PX,
  });
  const canvas = renderToStaticMarkup(
    <g>
      <DiagramCloseUpInsides insides={insides} style={style} />
      <DiagramAnnotationLayer drawing={drawing} style={style} />
    </g>
  );
  return { card, page, canvas };
}
