import { beforeAll, describe, expect, it } from 'vitest';
import { PT_PER_MM } from '../../lib/paper/paperSvg';
import { DEFAULT_PAPER_STYLE, PEN_WIDTH_RANGE } from '../../lib/paper/paperStyle';
import { createDiagram, createStep, createTurn, insertSteps, type DiagramDocument, type DiagramStep } from '../document/diagramDocument';
import { cpStep, referencesStep, scenePicture } from '../document/diagramSteps.fixtures';
import { FIXTURE_FONTS, fixtureSubsetter } from '../fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../fonts/fontSubset';
import { pictureExtent } from '../pages/diagramPageLayout';
import { cellPicture, layoutPicture } from '../pages/pagePictures';
import { estimateTextSetter } from '../pages/estimateTextSetter';
import { PAD_MM, pictureBoxOf } from './stepFileGeometry';
import { craneStep } from '../zoom/zoom.fixtures';
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

  it('keeps a heavy pen’s glyphs on a canvas of one size, the paper drawn smaller rather than they be cut (review)', () => {
    // Glyphs either side of the paper, at the heaviest pen: more than half a 22 mm box.
    const glyphs: DiagramStep = {
      ...cpStep('step-glyphs'),
      annotations: [
        { id: 'r', kind: 'rotate', from: [1.3, 0.5], to: [1.3, 0.5], rotate: { amount: 'half', direction: 'cw' } },
        { id: 't', kind: 'turn-over', from: [-0.3, 0.5], to: [-0.3, 0.5], axis: 'vertical' },
      ],
    };
    const style = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: PEN_WIDTH_RANGE.max } } };
    const document = { ...insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), [glyphs], 0), style };
    for (const size of [30, 40]) {
      const options: StepFileOptions = { ...SAME, number: false, text: false, widthMm: size, heightMm: size };
      const files = prepareStepFiles(document, FIXTURE_FONTS, subsetter, options);
      const at = files.mmPerUnit!;
      const reach = pictureExtent(layoutPicture(glyphs, document.assets, style, { mmPerUnit: at })!, at);
      expect(reach.width, `${size} mm`).toBeLessThanOrEqual(size + 1e-3);
      expect(reach.height, `${size} mm`).toBeLessThanOrEqual(size + 1e-3);
      // A cropped file has no canvas to keep to: its paper as large as the box's floor allows.
      const cropped = prepareStepFiles(document, FIXTURE_FONTS, subsetter, { ...options, sameSize: false });
      expect(cropped.mmPerUnit!).toBeGreaterThanOrEqual(at);
    }
  });

  it('never draws the paper smaller as a canvas of one size grows, nor under half its box’s fit for its marks (third review)', () => {
    // The glyphs either side of the paper at the heaviest pen, and a plain step drawn at the same scale.
    const glyphs: DiagramStep = {
      ...cpStep('step-glyphs'),
      annotations: [
        { id: 'r', kind: 'rotate', from: [1.3, 0.5], to: [1.3, 0.5], rotate: { amount: 'half', direction: 'cw' } },
        { id: 't', kind: 'turn-over', from: [-0.3, 0.5], to: [-0.3, 0.5], axis: 'vertical' },
      ],
    };
    const style = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: PEN_WIDTH_RANGE.max } } };
    const document = { ...insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), [glyphs, cpStep('step-plain')], 0), style };
    let last = 0;
    for (let size = 20; size <= 40; size += 1) {
      const options: StepFileOptions = { ...SAME, number: false, text: false, widthMm: size, heightMm: size };
      const at = prepareStepFiles(document, FIXTURE_FONTS, subsetter, options).mmPerUnit!;
      // Past the glyphs' own width the cap once dropped from 4.06 to 0.53 mm per unit: every file a dot.
      expect(at, `${size} mm`).toBeGreaterThanOrEqual(last * (1 - 1e-6));
      const boxFit = prepareStepFiles(document, FIXTURE_FONTS, subsetter, { ...options, sameSize: false }).mmPerUnit!;
      expect(at / boxFit, `${size} mm`).toBeGreaterThanOrEqual(0.5 * (1 - 1e-3));
      last = at;
    }
  });

  it('keeps a glyph on a canvas of one size where its whole reach fits it, placed as the box places it (third review)', () => {
    // A turn-over over the top edge and a valley line off to the right: a reach that fits a 20 mm canvas,
    // but the paper kept in its box could not centre it, and the glyph was cut 0.62 mm at the top.
    const step: DiagramStep = {
      ...cpStep('step-1'),
      annotations: [
        { id: 'v', kind: 'valley-line', from: [1.147, 0.934], to: [1.04, 0.0996] },
        { id: 't', kind: 'turn-over', from: [0.38, -0.05], to: [0.38, -0.05], axis: 'horizontal' },
      ],
    };
    const style = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: PEN_WIDTH_RANGE.max } } };
    const document = { ...insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), [step], 0), style };
    for (const size of [20, 22, 24]) {
      const options: StepFileOptions = { ...SAME, number: false, text: false, widthMm: size, heightMm: size };
      const files = prepareStepFiles(document, FIXTURE_FONTS, subsetter, options);
      const box = pictureBoxOf(options);
      const placed = cellPicture(step, document.assets, document.style, { pictureMm: box, mmPerUnit: files.mmPerUnit, frameMm: null }, 's-', {
        hanStyle: 'sc',
        runs: estimateTextSetter.runs,
      })!;
      const [top, bottom] = [placed.boundsPt.y / PT_PER_MM, (placed.boundsPt.y + placed.boundsPt.height) / PT_PER_MM];
      const [left, right] = [placed.boundsPt.x / PT_PER_MM, (placed.boundsPt.x + placed.boundsPt.width) / PT_PER_MM];
      expect(top, `${size} mm`).toBeGreaterThanOrEqual(-1e-3);
      expect(bottom, `${size} mm`).toBeLessThanOrEqual(size + 1e-3);
      expect(left, `${size} mm`).toBeGreaterThanOrEqual(-1e-3);
      expect(right, `${size} mm`).toBeLessThanOrEqual(size + 1e-3);
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

describe('an enlarged step’s file (Revision 2)', () => {
  it('is its window, clipped to its frame, as its page cell draws it', () => {
    const crane = craneStep('S.none');
    const enlarged: DiagramStep = {
      ...crane,
      id: 'step-enlarged',
      zoom: { from: 'area-1', shape: 'circle', frame: { centre: [0.37, 0.13], radius: 0.13 } },
      annotatedPictureKey: crane.picture!.key,
    };
    const document = insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), [crane, enlarged], 0);
    const files = prepareStepFiles(document, FIXTURE_FONTS, subsetter, SAME);
    const [whole, window] = [files.compose(0).svg, files.compose(1).svg];
    expect(whole).not.toContain('zoom-clip');
    expect(window).toMatch(/<clipPath id="[^"]*zoom-clip"><circle /);
    // Only the paper near the window is drawn into it.
    const faces = (svg: string) => (svg.match(/<path d="M[^"]*Z" fill=/g) ?? []).length;
    expect(faces(window)).toBeLessThan(faces(whole));
  });
});
