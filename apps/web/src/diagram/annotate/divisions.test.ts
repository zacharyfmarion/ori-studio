import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import golden from './__fixtures__/divisionsGolden.json';
import { annotationDrawing, annotationMarks } from './annotationPrimitives';
import { DIVISIONS_CASES } from './divisions.cases';
import { CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';

/**
 * Equal divisions (Revision 2) as each surface draws them — a card, a page
 * and the canvas — recorded when the mark was made and checked by eye beside
 * Zach's sketch: a line set off the line it measures in the existing creases'
 * pen, dividers and ticks across it in a ring's, the ticks leaning as a
 * backslash on the page and crowding to their floor on a short edge, the
 * count upright beside the line in the page's face.
 */
describe('equal divisions', () => {
  it.each(DIVISIONS_CASES.map((annotation) => [annotation.id, annotation] as const))(
    '%s draws as recorded on a card, a page and the canvas',
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
      expect({ card, page, canvas }).toEqual((golden as Record<string, unknown>)[id]);
    }
  );
});
