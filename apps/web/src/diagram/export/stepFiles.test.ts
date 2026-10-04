import { beforeAll, describe, expect, it } from 'vitest';
import { PT_PER_MM } from '../../lib/paper/paperSvg';
import { createDiagram, createStep, createTurn, insertSteps, type DiagramDocument, type DiagramStep } from '../document/diagramDocument';
import { cpStep, referencesStep, scenePicture } from '../document/diagramSteps.fixtures';
import { FIXTURE_FONTS, fixtureSubsetter } from '../fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../fonts/fontSubset';
import { PAD_MM, pictureBoxOf } from './stepFileGeometry';
import { prepareStepFiles, stepFileMinHeightMm, STEP_FILE_TEXT_LINES, type StepFileOptions } from './stepFiles';

let subsetter: FontSubsetter;
beforeAll(async () => {
  subsetter = await fixtureSubsetter();
});

const SAME: StepFileOptions = {
  number: true,
  text: true,
  sameSize: true,
  widthMm: 80,
  heightMm: 100,
  transparent: true,
};
const LONG = 'Fold the corner up to the top edge and crease it firmly. '.repeat(8);

/**
 * Twelve steps: a one-unit sheet, an empty step, the same sheet measured as
 * two units, a References card, and more empties.
 */
function diagram(): DiagramDocument {
  const empty = (index: number) => ({ ...createStep(() => `step-empty-${index}`), text: 'Nothing yet.' });
  const steps = [
    { ...cpStep('step-one'), text: 'Fold in half, then unfold.' },
    empty(0),
    { ...cpStep('step-two', undefined, { ...scenePicture('scene-2'), paperScale: 50 }), text: LONG },
    referencesStep('step-sent'),
    ...Array.from({ length: 8 }, (_, index) => empty(index + 1)),
  ];
  return insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), steps, 0);
}

const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml');

/** The drawn sheet's width in a file, pt: its first polygon's x extent. */
function sheetWidth(svg: string): number {
  const xs = parse(svg)
    .querySelector('polygon, path')!
    .getAttribute(parse(svg).querySelector('polygon') ? 'points' : 'd')!
    .match(/-?[\d.]+/g)!
    .map(Number)
    .filter((_, index) => index % 2 === 0);
  return Math.max(...xs) - Math.min(...xs);
}

describe('prepareStepFiles', () => {
  it('makes a file for each step with a picture, named by its number, and lists the rest', () => {
    const files = prepareStepFiles(diagram(), FIXTURE_FONTS, subsetter, SAME);
    // A skipped step keeps its number: the file after it is step 3's.
    expect(files.files.map((file) => [file.number, file.fileStem])).toEqual([
      [1, 'Crane-step-01'],
      [3, 'Crane-step-03'],
      [4, 'Crane-step-04'],
    ]);
    expect(files.skipped).toEqual([2, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(files.missing).toEqual([]);
  });

  it('makes every file the canvas, and draws every sheet at one scale', () => {
    const files = prepareStepFiles(diagram(), FIXTURE_FONTS, subsetter, SAME);
    const [one, two] = [files.compose(0), files.compose(1)];
    for (const file of [one, two]) {
      expect(file.widthPt).toBeCloseTo(80 * PT_PER_MM, 3);
      expect(file.heightPt).toBeCloseTo(100 * PT_PER_MM, 3);
    }
    // The second sheet is two units across: twice the first, which is half its box.
    expect(sheetWidth(two.svg) / sheetWidth(one.svg)).toBeCloseTo(2, 2);
  });

  it('prints the number and the instruction when asked, the instruction cut to its slot', () => {
    const files = prepareStepFiles(diagram(), FIXTURE_FONTS, subsetter, SAME);
    expect(files.cut).toEqual([3]);
    const document = parse(files.compose(1).svg);
    const texts = [...document.querySelectorAll('text')];
    expect(texts[0]!.textContent).toBe('3');
    expect(texts[1]!.querySelectorAll('tspan').length).toBeGreaterThanOrEqual(STEP_FILE_TEXT_LINES);
    expect(texts[1]!.textContent!.endsWith('…')).toBe(true);
    // Its fonts embedded, so it opens anywhere as it looks here.
    expect(document.querySelector('style')!.textContent).toContain('@font-face');

    const bare = prepareStepFiles(diagram(), FIXTURE_FONTS, subsetter, { ...SAME, number: false, text: false });
    expect(parse(bare.compose(1).svg).querySelectorAll('text')).toHaveLength(0);
    expect(bare.cut).toEqual([]);
  });

  it('crops each file to its drawing, keeping the scale and the whole instruction', () => {
    const same = prepareStepFiles(diagram(), FIXTURE_FONTS, subsetter, SAME);
    const cropped = prepareStepFiles(diagram(), FIXTURE_FONTS, subsetter, { ...SAME, sameSize: false });
    expect(cropped.cut).toEqual([]);
    const one = cropped.compose(0);
    // The one-unit sheet fills half the canvas's box: its file is narrower than the canvas.
    expect(one.widthPt).toBeLessThan(80 * PT_PER_MM - 1);
    expect(sheetWidth(one.svg)).toBeCloseTo(sheetWidth(same.compose(0).svg), 3);
    const long = parse(cropped.compose(1).svg).querySelectorAll('text')[1]!;
    expect(long.textContent!.endsWith('…')).toBe(false);
    // Every line inside the file.
    const viewBox = parse(cropped.compose(1).svg).documentElement.getAttribute('viewBox')!.split(' ').map(Number);
    const lastY = Math.max(...[...long.querySelectorAll('tspan')].map((span) => Number(span.getAttribute('y'))));
    expect(lastY).toBeLessThan(viewBox[1]! + viewBox[3]!);
  });

  it('draws annotated steps as large as their marks let them, every one inside its box, at any size (review)', () => {
    // Arrows standing over the top edge. A head is the pen's size on a large sheet and a share of its
    // arrow's chord on a small one, so how far it reaches past the sheet is known only at the scale it
    // is drawn at: measured at a card's, a 12 mm box draws them 0.4 and 1 mm past it.
    const over: DiagramStep = {
      ...cpStep('step-over'),
      annotations: [{ id: 'v', kind: 'valley-arrow', from: [0.1, 0.02], to: [0.9, 0.02], bend: 0.3 }],
    };
    const short: DiagramStep = {
      ...cpStep('step-short'),
      annotations: [{ id: 's', kind: 'valley-arrow', from: [0.45, -0.05], to: [0.55, -0.05], bend: 0.6 }],
    };
    const document = insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), [over, short], 0);
    for (const widthMm of [20, 200]) {
      // Cropped to what it draws, with nothing but the picture: a file is its drawing and the pad round it.
      const options: StepFileOptions = { ...SAME, sameSize: false, number: false, text: false, widthMm, heightMm: widthMm };
      const box = pictureBoxOf(options).size;
      const files = prepareStepFiles(document, FIXTURE_FONTS, subsetter, options);
      const drawn = files.files.map((_, index) => {
        const [, , width, height] = parse(files.compose(index).svg).documentElement.getAttribute('viewBox')!.split(' ').map(Number);
        return { w: width! / PT_PER_MM - 2 * PAD_MM, h: height! / PT_PER_MM - 2 * PAD_MM };
      });
      for (const { w, h } of drawn) {
        expect(w, `${widthMm} mm`).toBeLessThanOrEqual(box + 0.02);
        expect(h, `${widthMm} mm`).toBeLessThanOrEqual(box + 0.02);
      }
      // And no smaller than that: the one that needs most room fills its box.
      expect(Math.max(...drawn.map(({ w, h }) => Math.max(w, h))), `${widthMm} mm`).toBeCloseTo(box, 1);
    }
  });

  it('puts the page’s white behind the drawing unless the file is to be transparent', () => {
    const files = prepareStepFiles(diagram(), FIXTURE_FONTS, subsetter, { ...SAME, transparent: false });
    expect(parse(files.compose(0).svg).querySelector('svg > rect')?.getAttribute('fill')).toBe('#ffffff');
    expect(parse(prepareStepFiles(diagram(), FIXTURE_FONTS, subsetter, SAME).compose(0).svg).querySelector('svg > rect')).toBeNull();
  });

  it('makes no file of a turn between steps, numbering and padding by the steps alone (D22)', () => {
    const document = diagram();
    const nine = { ...document, steps: document.steps.slice(0, 9) };
    // A turn before step 2 and one after the last: ten entries, nine steps — one digit still.
    const turning = insertSteps(
      insertSteps(nine, [createTurn({ kind: 'turn-over', axis: 'vertical' })], 1),
      [createTurn({ kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } })],
      10
    );
    const files = prepareStepFiles(turning, FIXTURE_FONTS, subsetter, SAME);
    expect(files.files.map((file) => [file.number, file.fileStem])).toEqual([
      [1, 'Crane-step-1'],
      [3, 'Crane-step-3'],
      [4, 'Crane-step-4'],
    ]);
    expect(files.skipped).toEqual([2, 5, 6, 7, 8, 9]);
  });

  it('pads the number to the step count, and keeps a skipped step’s number for the next', () => {
    const document = diagram();
    const files = prepareStepFiles({ ...document, steps: document.steps.slice(0, 9) }, FIXTURE_FONTS, subsetter, SAME);
    expect(files.files.map((file) => file.fileStem)).toEqual(['Crane-step-1', 'Crane-step-3', 'Crane-step-4']);
  });

  it('says how tall a canvas must be to leave a picture between the number and the text', () => {
    expect(stepFileMinHeightMm({ number: true, text: true })).toBeGreaterThan(stepFileMinHeightMm({ number: false, text: false }));
  });
});
