/**
 * A step's marks compiled once per cell (17e): a page measures them for the
 * picture's room and draws them where the picture settles, from the one
 * compile (`placeAnnotations`). Painting them twice cost a lifted References
 * diagram's Pages view a third more than its baked steps (17d's verify).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { liftedCardPicture } from '../references/referencesCardMarks';
import { pointsCard } from '../references/referencesCardMarks.fixtures';
import { createStep, type DiagramStep, type DiagramStyle } from '../document/diagramDocument';
import { referencesSource } from '../document/diagramSteps.fixtures';
import { cellPicture } from './pagePictures';
import { estimateTextSetter } from './estimateTextSetter';

const compiles = vi.hoisted(() => ({ count: 0 }));
vi.mock('../annotate/annotationPrimitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../annotate/annotationPrimitives')>();
  return {
    ...actual,
    annotationDrawing: (...args: Parameters<typeof actual.annotationDrawing>) => {
      compiles.count += 1;
      return actual.annotationDrawing(...args);
    },
  };
});

const STYLE: DiagramStyle = { preset: 'diagram' };
const TEXT = { hanStyle: 'sc' as const, runs: estimateTextSetter.runs };

/** Zach's screenshot's kind of card, pulled lifted: nine marks over its paper. */
function pulledStep(): DiagramStep {
  const card = { kind: 'step-diagram' as const, model: pointsCard(), mirrored: false, key: 'steps-p' };
  const lifted = liftedCardPicture(card, { letters: true, highlights: true }, STYLE)!;
  return {
    ...createStep(() => 'step-p'),
    source: referencesSource(),
    picture: lifted.picture,
    annotations: lifted.annotations,
    annotatedPictureKey: lifted.picture.key,
  };
}

beforeEach(() => {
  compiles.count = 0;
});

describe('a step’s marks on its page', () => {
  it('are compiled once, at the size the cell draws them', () => {
    const step = pulledStep();
    const placed = cellPicture(step, {}, STYLE, { pictureMm: { x: 10, y: 20, size: 60 }, mmPerUnit: null, frameMm: 50 }, 'c0-', TEXT);
    expect(placed).not.toBeNull();
    expect(compiles.count).toBe(1);
  });
});
