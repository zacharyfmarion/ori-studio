import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DiagramAnnotationLayer } from '../../components/diagram/DiagramAnnotationLayer';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';
import golden from './__fixtures__/areasGolden.json';
import { annotationDrawing } from './annotationPrimitives';
import { AREA_CASES, AREA_PAPER } from './areas.cases';
import { CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';

/**
 * Ovals and rectangles as each surface draws them — a card, a page and the
 * canvas — recorded when the shapes were made (Revision 3, 18d) and checked
 * by eye beside the turtle's ovals (`artifacts/revision-3/18d/`): an ellipse
 * or a square-cornered rectangle, outline only, in a ring's pen and the
 * marks' ink; upright and turned; painted under the step's lines and marks
 * whatever order they were drawn in; drawn as it is off the paper, and on a
 * References step's grey face.
 */
describe('an oval and a rectangle', () => {
  it.each(Object.entries(AREA_CASES))('%s draws as recorded on a card, a page and the canvas', (id, annotations) => {
    const paper = AREA_PAPER[id] ?? null;
    const card = paintAnnotations(annotations, { x: 0, y: 0, width: 400, height: 300 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE, null, { paper });
    const page = paintAnnotations(annotations, { x: 12, y: 30, width: 283.46, height: 212.6 }, 283.46, DEFAULT_DIAGRAM_STYLE, null, { paper });
    const drawing = annotationDrawing(annotations, { width: 1, height: 0.75 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE, null, paper);
    const canvas = renderToStaticMarkup(createElement(DiagramAnnotationLayer, { drawing, style: DEFAULT_DIAGRAM_STYLE }));
    expect({ card, page, canvas }).toEqual((golden as Record<string, unknown>)[id]);
  });
});
