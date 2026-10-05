import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import golden from './__fixtures__/pleatArrowGolden.json';
import { annotationDrawing, annotationMarks } from './annotationPrimitives';
import { CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';
import { PLEAT_ARROW_CASES } from './pleatArrows.cases';

/**
 * The pleat arrows (Phase 15c) as each surface draws them — a card, a page and
 * the canvas — recorded when the arrow was made and checked by eye
 * (`artifacts/diagram-second-pass/15c/golden-pleat-arrows*.png`): a lightning
 * bolt, its runs parallel and their Zs a fixed print size, smaller on a short
 * arrow, the valley arrow's head on its last run, off the picture as on it.
 */
describe('a pleat arrow', () => {
  it.each(PLEAT_ARROW_CASES.map((annotation) => [annotation.id, annotation] as const))(
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
