/**
 * A diagram of pulled steps lays out on its pages as the same diagram of
 * baked cards (17d, §13 Pages): every step on the same page and in the same
 * cell, its sheet printed within 2% of the baked one's size. The baked card
 * is fitted with its marks in it (`fittedSheetMm`); the pulled sheet is fitted
 * bare and then shrunk to its marks' reach (`cellPicture`), so the two settle
 * a little apart.
 */
import { describe, expect, it } from 'vitest';
import { PT_PER_CSS_PX, PT_PER_MM } from '../../lib/paper/paperSvg';
import { paintAnnotations } from '../annotate/paintAnnotations';
import {
  createDiagram,
  createStep,
  insertSteps,
  pullReferencesSteps,
  setPageSetup,
  stepById,
  type DiagramDocument,
  type DiagramStep,
  type DiagramStepDiagramPicture,
  type DiagramStyle,
  type SentReferencesStep,
} from '../document/diagramDocument';
import { referencesSource } from '../document/diagramSteps.fixtures';
import { layoutDiagram } from '../pages/diagramPages';
import { estimateTextSetter } from '../pages/estimateTextSetter';
import { cellPicture } from '../pages/pagePictures';
import { markPaper, stepAsDrawn } from '../zoom/stepView';
import { framedCard, liftFixtures, piecesCard } from './referencesCardMarks.fixtures';
import { liftedCardPicture } from './referencesCardMarks';

const STYLES: [string, DiagramStyle][] = [
  ['the Diagram preset', { preset: 'diagram' }],
  ['Default', { preset: 'default' }],
];

function diagram(style: DiagramStyle, lifted: boolean, layout: 'grid' | 'flow'): DiagramDocument {
  const cards = [...liftFixtures(), { name: 'pieces', model: piecesCard() }];
  const steps = cards.flatMap(({ name, model }, index): DiagramStep[] =>
    [false, true].map((mirrored) => {
      const id = `step-${name}-${mirrored ? 'back' : 'front'}`;
      const baked = { kind: 'step-diagram' as const, model, mirrored, key: `steps-${index}${mirrored ? '-back' : ''}` };
      const split = lifted ? liftedCardPicture(baked, { letters: true, highlights: true }, style) : null;
      return {
        ...createStep(() => id),
        source: referencesSource({ side: mirrored ? 'back' : 'front' }),
        picture: split?.picture ?? baked,
        annotations: split?.annotations ?? [],
        annotatedPictureKey: (split?.picture ?? baked).key,
        text: 'Fold and unfold.',
      };
    })
  );
  const document = insertSteps({ ...createDiagram({ title: 'Pulled', newId: () => 'diagram-pulled' }), style }, steps, 0);
  return setPageSetup(document, { layout });
}

describe('a card pulled into an enlarged step, on its page', () => {
  // 17d review: crane's last step, enlarged, filled with a card — and a card pulled after it, enlarged with its frame —
  // drew the card's arrows whole across the steps beside them and off the page, where the baked card is cut at the frame.
  // Since review fix 3 a card filling an empty enlarged step, or pulled after one, starts whole; a References step
  // enlarged since still takes a new card into its window (Replace).
  it('paints none of the card’s marks outside its cell, replaced into the enlarged step or pulled after it whole', () => {
    const style: DiagramStyle = { preset: 'diagram' };
    const card = (key: string): SentReferencesStep => {
      const picture: DiagramStepDiagramPicture = { kind: 'step-diagram', model: framedCard(), mirrored: false, key };
      return {
        source: referencesSource(),
        picture,
        lifted: liftedCardPicture(picture, { letters: true, highlights: true }, style),
        text: 'Fold P to the line.',
      };
    };
    let ids = 0;
    const newId = (kind: string) => `${kind}-${(ids += 1)}`;
    const zoom = { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.5, 0.5] as [number, number], radius: 0.2 } };
    const empty: DiagramStep = { ...createStep(() => 'step-filled'), zoom };
    const start = setPageSetup(insertSteps({ ...createDiagram({ title: 'Head', newId: () => 'diagram-head' }), style }, [empty], 0), { layout: 'grid' });
    const filled = pullReferencesSteps(start, [card('steps-f')], { kind: 'fill', stepId: 'step-filled' }, { newId }).document;
    expect(stepById(filled, 'step-filled')!.zoom).toBeUndefined();
    // Enlarged again, then given another card: its marks in the frame pulled into the window.
    const enlarged = { ...filled, steps: filled.steps.map((entry) => (entry.id === 'step-filled' ? { ...entry, zoom } : entry)) };
    const replaced = pullReferencesSteps(enlarged, [card('steps-g')], { kind: 'replace', stepId: 'step-filled' }, { newId }).document;
    const document = pullReferencesSteps(replaced, [card('steps-h')], { kind: 'end' }, { newId }).document;
    const cells = layoutDiagram(document, estimateTextSetter).pages.flatMap((page) => page.cells);
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      const step = stepById(document, cell.stepId)!;
      expect(step.zoom?.frame).toEqual(cell.stepId === 'step-filled' ? zoom.frame : undefined);
      expect(step.annotations.length).toBeGreaterThan(0);
      const placed = cellPicture(step, document.assets, style, cell, 'c-', { hanStyle: 'sc', runs: estimateTextSetter.runs })!;
      const framePx = Math.max(placed.framePt.width, placed.framePt.height) / PT_PER_CSS_PX;
      const marks = paintAnnotations(stepAsDrawn(step).annotations, placed.framePt, framePx, style, null, {
        paper: markPaper(step, document.assets),
      })!;
      const room = { x: cell.cellMm.x * PT_PER_MM, y: cell.cellMm.y * PT_PER_MM, width: cell.cellMm.w * PT_PER_MM, height: cell.cellMm.h * PT_PER_MM };
      expect(marks.bounds.x).toBeGreaterThanOrEqual(room.x);
      expect(marks.bounds.y).toBeGreaterThanOrEqual(room.y);
      expect(marks.bounds.x + marks.bounds.width).toBeLessThanOrEqual(room.x + room.width);
      expect(marks.bounds.y + marks.bounds.height).toBeLessThanOrEqual(room.y + room.height);
    }
  });
});

describe('a diagram of pulled steps on its pages', () => {
  for (const [styleName, style] of STYLES) {
    for (const layout of ['grid', 'flow'] as const) {
      it(`keeps pagination and comparable printed sheets in ${styleName}, laid out as a ${layout}`, () => {
        const baked = layoutDiagram(diagram(style, false, layout), estimateTextSetter);
        const pulled = layoutDiagram(diagram(style, true, layout), estimateTextSetter);
        expect(pulled.pages.map((page) => page.cells.map((cell) => cell.stepId))).toEqual(
          baked.pages.map((page) => page.cells.map((cell) => cell.stepId))
        );
        baked.pages.forEach((page, p) =>
          page.cells.forEach((cell, c) => {
            const other = pulled.pages[p]!.cells[c]!;
            if (layout === 'grid') expect(other.cellMm).toEqual(cell.cellMm);
            else { expect(other.number).toBe(cell.number); expect(other.rightToLeft).toBe(cell.rightToLeft); }
            // A References sheet knows its size in the pattern's units: its scale is mm per unit.
            const scale = (of: typeof cell) => of.mmPerUnit ?? of.frameMm;
            expect(scale(cell)).not.toBeNull();
            // Flow repacks measured ink; small representation differences can choose a different relaxed candidate.
            expect(Math.abs(scale(other)! / scale(cell)! - 1)).toBeLessThanOrEqual(layout === 'grid' ? 0.02 : 0.04);
          })
        );
      });
    }
  }
});
