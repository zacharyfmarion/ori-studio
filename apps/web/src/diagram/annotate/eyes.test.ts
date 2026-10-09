import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import golden from './__fixtures__/eyesGolden.json';
import { annotationDrawing, annotationMarks } from './annotationPrimitives';
import { EYE_CASES, EYE_PAPER } from './eyes.cases';
import { CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';

/**
 * Eyes as each surface draws them — a card, a page and the canvas —
 * recorded when the mark was made (Revision 3, 18c) and checked by eye
 * beside Zach's note (`artifacts/revision-3/18c/`): two straight lids meeting
 * at a mitred point behind, a cornea arc across them and a small iris inside
 * it, outline only, in the aux lines' pen and the marks' ink; looking its own
 * way and sized by its own scale; drawn as it is off the paper, and on a
 * References step's grey face.
 */
describe('an eye', () => {
  it.each(EYE_CASES.map((annotation) => [annotation.id, annotation] as const))('%s draws as recorded on a card, a page and the canvas', (id, annotation) => {
    const paper = EYE_PAPER[id] ?? null;
    const card = paintAnnotations([annotation], { x: 0, y: 0, width: 400, height: 300 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE, null, { paper });
    const page = paintAnnotations([annotation], { x: 12, y: 30, width: 283.46, height: 212.6 }, 283.46, DEFAULT_DIAGRAM_STYLE, null, { paper });
    const canvas = renderToStaticMarkup(
      annotationMarks(annotationDrawing([annotation], { width: 1, height: 0.75 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE, null, paper))
    );
    expect({ card, page, canvas }).toEqual((golden as Record<string, unknown>)[id]);
  });
});
