import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import golden from './__fixtures__/arcArrowsGolden.json';
import { arrowPolyline } from './annotationHit';
import { annotationDrawing, annotationMarks } from './annotationPrimitives';
import { ARC_ARROW_CASES } from './arcArrowParity.cases';
import { CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';

/**
 * Decision 2: an arrow never shaped stays References' exact arc. Its drawing
 * — on a card, on a page, on the canvas — and the line a press and the
 * selection follow were recorded before arrows could be shaped (at
 * 565360b45), for every arrow kind at every bend and length that draws
 * differently, beside every other kind; they must not move by a byte.
 * Only the box each is cropped to has moved since: an arc arrow is now
 * measured where it is drawn rather than padded a head's length all round.
 */
describe('an arrow never shaped', () => {
  it.each(ARC_ARROW_CASES.map((annotation) => [annotation.id, annotation] as const))(
    '%s draws exactly as it did before arrows could be shaped',
    (id, annotation) => {
      const card = paintAnnotations([annotation], { x: 0, y: 0, width: 400, height: 300 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE);
      const page = paintAnnotations(
        [annotation],
        { x: 12, y: 30, width: 283.46, height: 212.6 },
        283.46,
        DEFAULT_DIAGRAM_STYLE
      );
      const canvas = renderToStaticMarkup(
        annotationMarks(annotationDrawing([annotation], { width: 1, height: 0.75 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE))
      );
      const arc = annotation.kind === 'valley-arrow' || annotation.kind === 'mountain-arrow' || annotation.kind === 'fold-unfold-arrow';
      const recorded = (golden as Record<string, unknown>)[id];
      expect({ card, page, canvas, polyline: arc ? arrowPolyline(annotation) : null }).toEqual(recorded);
    }
  );
});
