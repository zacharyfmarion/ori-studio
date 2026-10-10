import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import golden from './__fixtures__/starsGolden.json';
import { annotationDrawing, annotationMarks } from './annotationPrimitives';
import { CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';
import { STAR_CASES, STAR_PAPER } from './stars.cases';

/**
 * Stars as each surface draws them — a card, a page and the canvas —
 * recorded when the mark was made (Revision 3, 18b) and checked by eye
 * beside Zach's sample (`artifacts/revision-3/18b/`): five points, one up,
 * filled with the marks' ink or outlined in a ring's pen, mitred, the page's
 * white inside; turned on the page by their own angle and sized by their own
 * scale; drawn as they are off the paper; and white inside on a References
 * step's grey face.
 */
describe('a star', () => {
  it.each(STAR_CASES.map((annotation) => [annotation.id, annotation] as const))('%s draws as recorded on a card, a page and the canvas', (id, annotation) => {
    const paper = STAR_PAPER[id] ?? null;
    const card = paintAnnotations([annotation], { x: 0, y: 0, width: 400, height: 300 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE, null, { paper });
    const page = paintAnnotations([annotation], { x: 12, y: 30, width: 283.46, height: 212.6 }, 283.46, DEFAULT_DIAGRAM_STYLE, null, { paper });
    const canvas = renderToStaticMarkup(
      annotationMarks(annotationDrawing([annotation], { width: 1, height: 0.75 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE, null, paper))
    );
    expect({ card, page, canvas }).toEqual((golden as Record<string, unknown>)[id]);
  });
});
