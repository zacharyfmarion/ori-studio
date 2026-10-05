import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import golden from './__fixtures__/calloutsGolden.json';
import { annotationDrawing, annotationMarks } from './annotationPrimitives';
import { CALLOUT_GOLDEN_CASES } from './calloutGolden.cases';
import { CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';

/**
 * A callout as it is drawn (D8's golden, for a mark References does not
 * draw): on a card, on a page — its markup and the box it reaches — and on
 * the canvas, for each of `CALLOUT_GOLDEN_CASES`. Recorded when callouts were
 * made (14g) and checked by eye first (`artifacts/diagram-annotate/14g/
 * golden-sheet.png`, set in the diagram's fonts); a change to its shape, its
 * pens or its words' runs shows here.
 */
describe('a callout’s drawing', () => {
  it.each(CALLOUT_GOLDEN_CASES.map((annotation) => [annotation.id, annotation] as const))(
    '%s draws as recorded',
    (id, annotation) => {
      const card = paintAnnotations([annotation], { x: 0, y: 0, width: 400, height: 300 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE);
      const page = paintAnnotations([annotation], { x: 12, y: 30, width: 283.46, height: 212.6 }, 283.46, DEFAULT_DIAGRAM_STYLE);
      const canvas = renderToStaticMarkup(
        annotationMarks(annotationDrawing([annotation], { width: 1, height: 0.75 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE))
      );
      expect({ card, page, canvas }).toEqual((golden as Record<string, unknown>)[id]);
    }
  );
});
