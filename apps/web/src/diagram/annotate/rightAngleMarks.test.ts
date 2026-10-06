import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE, type KnownDiagramAnnotation } from '../document/diagramDocument';
import golden from './__fixtures__/rightAngleGolden.json';
import { annotationDrawing, annotationMarks } from './annotationPrimitives';
import { rightAngleAt, type PicturePoint } from './annotationModel';
import { CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';

/** A right angle in the corner `at`, opening along `opens`, as the model writes one. */
function mark(id: string, at: PicturePoint, opens: PicturePoint): KnownDiagramAnnotation {
  return { id, kind: 'right-angle', ...rightAngleAt(at, opens) };
}

/**
 * The right-angle marks as each surface draws them — a card, a page and the
 * canvas — recorded when the mark was made (Phase 14e) and again when it took
 * Revision 2's look, an ∟ set into the angle with a closed square in its
 * corner, checked by eye beside Zach's sketch
 * (`artifacts/revision-2/16a/goldens.png`): square into the frame's corner,
 * up and to the right as an ∟'s is, turned off the axes, off the picture, and
 * at reach's very edge, where its corner was drawn in so the way it opens is
 * kept.
 */
const RIGHT_ANGLE_CASES: readonly KnownDiagramAnnotation[] = [
  mark('frame-corner', [0, 0], [1, 1]),
  mark('up-right', [0.3, 0.6], [1, -1]),
  mark('turned', [0.55, 0.35], [Math.cos(0.3), Math.sin(0.3)]),
  mark('off-picture', [-0.2, 0.9], [1, -1]),
  mark('at-reach', [4, 0.5], [1, 0]),
];

describe('a right-angle mark', () => {
  it.each(RIGHT_ANGLE_CASES.map((annotation) => [annotation.id, annotation] as const))(
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
