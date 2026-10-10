import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE, type KnownDiagramAnnotation } from '../document/diagramDocument';
import golden from './__fixtures__/behindMarkGolden.json';
import { annotationDrawing, annotationMarks } from './annotationPrimitives';
import { BEHIND_CASES, BEHIND_LAYERS } from './behindMarks.cases';
import { CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';

const CARD = { x: 0, y: 0, width: 400, height: 300 };

/**
 * Marks behind a flap (Phase 15e) as each surface draws them — a card, a page
 * and the canvas — on a fold's layers, recorded when they were made and
 * checked by eye (`artifacts/diagram-second-pass/15e/golden-behind-marks.png`):
 * dotted from each end that is behind until they come out from under the
 * flap and every face over it, in their own pens, their heads solid.
 */
describe('a mark behind a flap', () => {
  it.each(BEHIND_CASES.map((annotation) => [annotation.id, annotation] as const))(
    '%s draws as recorded on a card, a page and the canvas',
    (id, annotation) => {
      const card = paintAnnotations([annotation], CARD, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE, BEHIND_LAYERS);
      const page = paintAnnotations(
        [annotation],
        { x: 12, y: 30, width: 283.46, height: 212.6 },
        283.46,
        DEFAULT_DIAGRAM_STYLE,
        BEHIND_LAYERS
      );
      const canvas = renderToStaticMarkup(
        annotationMarks(annotationDrawing([annotation], { width: 1, height: 0.75 }, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE, BEHIND_LAYERS))
      );
      expect({ card, page, canvas }).toEqual((golden as Record<string, unknown>)[id]);
    }
  );

  it('is drawn in front, exactly, on a picture that knows no layers', () => {
    for (const annotation of BEHIND_CASES) {
      const { behind: _behind, ...front } = annotation;
      expect(paintAnnotations([annotation], CARD, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE)).toEqual(
        paintAnnotations([front as KnownDiagramAnnotation], CARD, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE)
      );
    }
  });

  it('reaches as far behind as in front: the dots lie on the stroke', () => {
    for (const annotation of BEHIND_CASES.filter(({ kind }) => kind !== 'valley-line')) {
      const behind = paintAnnotations([annotation], CARD, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE, BEHIND_LAYERS)!;
      const front = paintAnnotations([annotation], CARD, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE)!;
      expect(behind.bounds).toEqual(front.bounds);
      expect(behind.markup).not.toBe(front.markup);
    }
  });
});
