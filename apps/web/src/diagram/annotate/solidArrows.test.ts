import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import golden from './__fixtures__/solidArrowGolden.json';
import { annotationDrawing, annotationMarks } from './annotationPrimitives';
import { CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';
import { SOLID_ARROW_CASES } from './solidArrows.cases';

/**
 * The solid arrows (Phase 15d) as each surface draws them — a card, a page and
 * the canvas — recorded when the fill was made and checked by eye
 * (`artifacts/diagram-second-pass/15d/golden-solid-arrows.png`): a white
 * arrow's own outline, in its pen, filled with the arrow's ink rather than the
 * page's white, straight as the Solid Arrow lays it or shaped.
 */
describe('a solid arrow', () => {
  it.each(SOLID_ARROW_CASES.map((annotation) => [annotation.id, annotation] as const))(
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

  it('is its white twin’s outline, filled with ink', () => {
    const [laid, twin] = SOLID_ARROW_CASES.slice(0, 2).map(
      (annotation) => paintAnnotations([annotation], { x: 0, y: 0, width: 400, height: 300 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE)!.markup
    );
    const numbers = (markup: string) =>
      [...markup.matchAll(/ d="([^"]+)"/g)].flatMap((match) => match[1]!.match(/-?\d+(\.\d+)?/g)!.map(Number));
    const [a, b] = [numbers(laid!), numbers(twin!)];
    expect(b).toHaveLength(a.length);
    // The same corners, the twin laid 0.15 of the frame lower, in the drawing's own px.
    const lower = 0.15 * CARD_FRAME_PX;
    b.forEach((value, index) => expect(value - (index % 2 === 1 ? lower : 0)).toBeCloseTo(a[index]!, 2));
    const firstFill = (markup: string) => markup.match(/ fill="([^"]+)"/)![1];
    expect(firstFill(laid!)).not.toBe(firstFill(twin!));
  });
});
