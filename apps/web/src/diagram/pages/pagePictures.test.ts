import { describe, expect, it } from 'vitest';
import { PT_PER_MM } from '../../lib/paper/paperSvg';
import { createStep, DEFAULT_DIAGRAM_STYLE, type DiagramStep, type KnownDiagramAsset } from '../document/diagramDocument';
import { cpStep, fixedPicture, referencesStep, scenePicture } from '../document/diagramSteps.fixtures';
import type { FontMetrics } from '../fonts/fontMetrics';
import { sanitizeSvg, SVG_NS } from '../upload/svgSanitize';
import { estimateTextSetter } from './estimateTextSetter';
import { fontTextSetter } from './fontTextSetter';
import { cellPicture, layoutPicture, prefixIds, type PictureText } from './pagePictures';

const style = DEFAULT_DIAGRAM_STYLE;
const BITMAP: KnownDiagramAsset = {
  id: 'asset-raster',
  kind: 'raster',
  src: 'data:image/png;base64,AAAA',
  widthPx: 300,
  heightPx: 200,
  bytes: 4,
};

function bitmapStep(paperScale: number | null): DiagramStep {
  return {
    ...createStep(() => 'step-bitmap'),
    picture: { kind: 'asset', assetId: BITMAP.id, paperScale, key: `raster-${BITMAP.id}` },
  };
}

const assets = { [BITMAP.id]: BITMAP };
const TEXT: PictureText = { hanStyle: 'sc', runs: estimateTextSetter.runs };

describe('layoutPicture', () => {
  it('measures a capture by its paper scale, and fits what has none', () => {
    // The fixture's sheet is 100 scene px at 100 px per unit: one unit.
    expect(layoutPicture(cpStep('step-cp'), {}, style)).toEqual({ kind: 'paper', extentUnits: 1, reach: 1 });
    expect(layoutPicture(bitmapStep(100), assets, style)).toEqual({ kind: 'paper', extentUnits: 3, reach: 1 });
    expect(layoutPicture(bitmapStep(null), assets, style)).toEqual({ kind: 'fit', reach: 1 });
    const threeD = cpStep('step-3d', undefined, { ...scenePicture(), paperScale: null });
    expect(layoutPicture(threeD, {}, style)).toEqual({ kind: 'fit', reach: 1 });
    expect(layoutPicture({ ...createStep(() => 'step-fixed'), picture: fixedPicture() }, {}, style)).toEqual({ kind: 'fit', reach: 1 });
    expect(layoutPicture(createStep(() => 'step-empty'), {}, style)).toBeNull();
  });

  it('measures a References step by its sheet, its letters reaching further on a small one', () => {
    const step = referencesStep('step-sent');
    const atCard = layoutPicture(step, {}, style);
    const small = layoutPicture(step, {}, style, { mmPerUnit: 10 });
    if (atCard?.kind !== 'paper' || small?.kind !== 'paper') throw new Error('paper');
    // A unit sheet, and a letter past its edge.
    expect(atCard.extentUnits).toBeGreaterThan(1);
    expect(small.extentUnits).toBeGreaterThan(atCard.extentUnits);
    expect(small.reach).toBe(small.extentUnits);
    // Under `fit`, at the frame's size: a small frame, the letters reaching further.
    const frame = layoutPicture(step, {}, style, { frameMm: 10 });
    expect(frame?.reach).toBeCloseTo(small.reach, 9);
  });

  it('measures what an annotation reaches past any picture, one with no paper too', () => {
    const reaching = { ...bitmapStep(null), annotations: [{ id: 'a', kind: 'push-arrow' as const, from: [-0.4, 0.5] as [number, number], to: [0.1, 0.5] as [number, number] }] };
    const atCard = layoutPicture(reaching, assets, style);
    expect(atCard?.kind).toBe('fit');
    expect(atCard!.reach).toBeGreaterThan(1.3);
    // Its head keeps its pt size: on a smaller frame it reaches further.
    expect(layoutPicture(reaching, assets, style, { frameMm: 20 })!.reach).toBeGreaterThan(atCard!.reach);
    const fixed = { ...createStep(() => 'step-fixed'), picture: fixedPicture(), annotations: reaching.annotations };
    expect(layoutPicture(fixed, {}, style)!.reach).toBeGreaterThan(1.3);
  });
});

describe('cellPicture', () => {
  const cell = { pictureMm: { x: 10, y: 20, size: 40 }, mmPerUnit: null, frameMm: null };

  it('fits a picture with no paper scale to its box, centred', () => {
    const picture = cellPicture(bitmapStep(null), assets, style, cell, 'c0-', TEXT)!;
    const [, x, y, width, height] = /<svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(picture.markup)!.map(Number);
    expect(width).toBeCloseTo(40 * PT_PER_MM, 2);
    expect(height).toBeCloseTo((40 * PT_PER_MM * 2) / 3, 2);
    expect(x).toBeCloseTo(10 * PT_PER_MM, 2);
    expect(y! + height! / 2).toBeCloseTo((20 + 20) * PT_PER_MM, 2);
  });

  it('draws a picture’s frame at the cell’s size under fit, centred, whatever its paper', () => {
    for (const step of [bitmapStep(null), bitmapStep(100)]) {
      const picture = cellPicture(step, assets, style, { ...cell, frameMm: 30 }, 'c0-', TEXT)!;
      const [, x, y, width, height] = /<svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(picture.markup)!.map(Number);
      expect(width).toBeCloseTo(30 * PT_PER_MM, 2);
      expect(height).toBeCloseTo(20 * PT_PER_MM, 2);
      expect(x! + width! / 2).toBeCloseTo(30 * PT_PER_MM, 2);
      expect(y! + height! / 2).toBeCloseTo(40 * PT_PER_MM, 2);
    }
    // A scene's frame is its bounds: the fixture's unit sheet, 30 mm across.
    const scene = cellPicture(cpStep('step-cp'), {}, style, { ...cell, frameMm: 30 }, 'c0-', TEXT)!;
    expect(scene.boundsPt.width).toBeCloseTo(30 * PT_PER_MM, 2);
  });

  it('draws a capture at the cell’s scale, whatever its box', () => {
    const picture = cellPicture(bitmapStep(100), assets, style, { ...cell, mmPerUnit: 5 }, 'c0-', TEXT)!;
    // Three units at 5 mm each.
    expect(Number(/ width="([\d.]+)"/.exec(picture.markup)![1])).toBeCloseTo(15 * PT_PER_MM, 2);
  });

  it('sets a References step’s letters in the page’s font, and says which', () => {
    const picture = cellPicture(referencesStep('step-sent'), {}, style, { ...cell, mmPerUnit: 20 }, 'c1-', TEXT)!;
    expect(picture.markup).toContain(`font-family="'Noto Sans', sans-serif"`);
    expect(picture.text).toEqual([{ face: 'latin-700', characters: 'A' }]);
  });

  describe('annotations', () => {
    const annotated = (step: DiagramStep): DiagramStep => ({
      ...step,
      annotations: [
        { id: 'a-1', kind: 'valley-line', from: [0, 0.5], to: [1, 0.5] },
        { id: 'a-2', kind: 'push-arrow', from: [-0.4, 0.5], to: [0.1, 0.5] },
        { id: 'a-3', kind: 'label', from: [0.5, 0.1], to: [0.5, 0.1], text: 'B 折' },
        { id: 'a-4', kind: 'rotate', from: [0.8, 0.8], to: [0.8, 0.8], rotate: { amount: 'half', direction: 'cw' } },
      ],
    });

    it('draws them on the picture’s frame, at the cell’s size', () => {
      const inside: DiagramStep = {
        ...bitmapStep(null),
        annotations: [{ id: 'a-1', kind: 'valley-line', from: [0.1, 0.3], to: [0.9, 0.3] }],
      };
      const plain = cellPicture(bitmapStep(null), assets, style, cell, 'c0-', TEXT)!;
      const picture = cellPicture(inside, assets, style, cell, 'c0-', TEXT)!;
      // Kept to the picture: the picture where it was, the line across its frame.
      expect(picture.markup.startsWith(plain.markup)).toBe(true);
      const [, x1, , x2] = /<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)"/.exec(picture.markup)!.map(Number);
      expect(x1).toBeCloseTo(plain.boundsPt.x + 0.1 * plain.boundsPt.width, 1);
      expect(x2).toBeCloseTo(plain.boundsPt.x + 0.9 * plain.boundsPt.width, 1);
    });

    it('says what their text sets, its Han in the diagram’s style', () => {
      const picture = cellPicture(annotated(bitmapStep(null)), assets, style, cell, 'c0-', { ...TEXT, hanStyle: 'jp' })!;
      expect(picture.markup).toContain(`font-family="'Noto Sans JP', sans-serif"`);
      const faces = Object.fromEntries(picture.text.map(({ face, characters }) => [face, characters]));
      expect(faces['jp-400']).toBe('折');
      expect(faces['latin-400']).toContain('B');
      // A text's spaces are set in Noto Sans at its weight, as an upload's are.
      expect(faces['latin-700']).toBe(' 1/2');
    });

    it('makes room in the cell for what reaches past the picture, and crops a file to it', () => {
      const plain = cellPicture(bitmapStep(null), assets, style, cell, 'c0-', TEXT)!;
      const picture = cellPicture(annotated(bitmapStep(null)), assets, style, cell, 'c0-', TEXT)!;
      const box = { x: 10 * PT_PER_MM, y: 20 * PT_PER_MM, size: 40 * PT_PER_MM };
      // The picture and its annotations together, inside the box the layout gave the picture.
      expect(picture.boundsPt.x).toBeGreaterThanOrEqual(box.x - 0.01);
      expect(picture.boundsPt.x + picture.boundsPt.width).toBeLessThanOrEqual(box.x + box.size + 0.01);
      expect(picture.boundsPt.y).toBeGreaterThanOrEqual(box.y - 0.01);
      expect(picture.boundsPt.y + picture.boundsPt.height).toBeLessThanOrEqual(box.y + box.size + 0.01);
      // The picture itself drawn smaller to make that room: its width in the nested svg.
      const width = (markup: string) => Number(/<svg x="[\d.-]+" y="[\d.-]+" width="([\d.]+)"/.exec(markup)![1]);
      expect(width(picture.markup)).toBeLessThan(width(plain.markup) * 0.85);
    });

    it('leaves a picture at the shared scale at it, and the layout leaves it room', () => {
      const step = annotated(bitmapStep(100));
      const reach = layoutPicture(step, assets, style, { mmPerUnit: 5 });
      const bare = layoutPicture(bitmapStep(100), assets, style, { mmPerUnit: 5 });
      expect(reach?.kind === 'paper' && bare?.kind === 'paper' && reach.extentUnits > bare.extentUnits * 1.3).toBe(true);
      const plain = cellPicture(bitmapStep(100), assets, style, { ...cell, mmPerUnit: 5 }, 'c0-', TEXT)!;
      const picture = cellPicture(step, assets, style, { ...cell, mmPerUnit: 5 }, 'c0-', TEXT)!;
      const width = (markup: string) => Number(/ width="([\d.]+)"/.exec(markup)![1]);
      expect(width(picture.markup)).toBeCloseTo(width(plain.markup), 2);
    });

    it('draws a picture at the cell’s frame whatever its annotations reach, when the layout left them room', () => {
      const frameMm = 20;
      // The room the layout leaves: the picture and its marks, measured at that frame, fit the box.
      expect(layoutPicture(annotated(bitmapStep(null)), assets, style, { frameMm })!.reach * frameMm).toBeLessThan(40);
      const plain = cellPicture(bitmapStep(null), assets, style, { ...cell, frameMm }, 'c0-', TEXT)!;
      const picture = cellPicture(annotated(bitmapStep(null)), assets, style, { ...cell, frameMm }, 'c0-', TEXT)!;
      const width = (markup: string) => Number(/<svg x="[\d.-]+" y="[\d.-]+" width="([\d.]+)"/.exec(markup)![1]);
      expect(width(picture.markup)).toBeCloseTo(width(plain.markup), 2);
      expect(width(plain.markup)).toBeCloseTo(frameMm * PT_PER_MM, 2);
      // And the two together inside the box.
      const box = { x: 10 * PT_PER_MM, y: 20 * PT_PER_MM, size: 40 * PT_PER_MM };
      expect(picture.boundsPt.x).toBeGreaterThanOrEqual(box.x - 0.01);
      expect(picture.boundsPt.x + picture.boundsPt.width).toBeLessThanOrEqual(box.x + box.size + 0.01);
    });

    it('shrinks a picture at the cell’s frame only as far as its box needs, where its marks outgrow it', () => {
      const picture = cellPicture(annotated(bitmapStep(null)), assets, style, { ...cell, frameMm: 40 }, 'c0-', TEXT)!;
      const box = { x: 10 * PT_PER_MM, size: 40 * PT_PER_MM };
      expect(picture.boundsPt.x).toBeGreaterThanOrEqual(box.x - 0.01);
      expect(picture.boundsPt.x + picture.boundsPt.width).toBeLessThanOrEqual(box.x + box.size + 0.01);
      expect(picture.boundsPt.width).toBeGreaterThan(box.size * 0.99);
    });

    it('draws an arrow as References draws its own on the same page: one pen, one head', () => {
      // The References card's fold arrow, and an annotation of the same arrow beside it.
      const step = {
        ...referencesStep('step-sent'),
        annotations: [{ id: 'a', kind: 'fold-unfold-arrow' as const, from: [0.2, 0.2] as [number, number], to: [0.8, 0.2] as [number, number], bend: 0.134 }],
      };
      const picture = cellPicture(step, {}, style, { ...cell, mmPerUnit: 20 }, 'c1-', TEXT)!;
      const scales = [...picture.markup.matchAll(/<g transform="translate\([^)]*\) scale\(([\d.]+)\)">/g)].map((match) => Number(match[1]));
      // Both are placed at the page's own scale, a CSS px a CSS px.
      expect(new Set(scales)).toEqual(new Set([0.75]));
      const widths = [...picture.markup.matchAll(/<path d="M [^"]*A [^"]*"[^>]*stroke-width="([\d.]+)"/g)].map((match) => Number(match[1]));
      // Two strokes from the card's arrow, two from the annotation's: one pen.
      expect(widths.length).toBeGreaterThanOrEqual(4);
      expect(new Set(widths).size).toBe(1);
    });

    it('measures a References step’s from its sheet, not its letters', () => {
      const step = { ...referencesStep('step-sent'), annotations: [{ id: 'a', kind: 'valley-line' as const, from: [0, 0] as [number, number], to: [1, 1] as [number, number] }] };
      const picture = cellPicture(step, {}, style, { ...cell, mmPerUnit: 20 }, 'c1-', TEXT)!;
      const [, x1, y1, x2, y2] = /<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"[^>]*stroke-dasharray/
        .exec(picture.markup.slice(picture.markup.lastIndexOf('stroke-linejoin')))!
        .map(Number);
      // One sheet unit at 20 mm: the diagonal spans the sheet.
      expect(x2! - x1!).toBeCloseTo(20 * PT_PER_MM, 1);
      expect(y2! - y1!).toBeCloseTo(20 * PT_PER_MM, 1);
    });
  });

  describe('an upload’s text', () => {
    const upload = (body: string): KnownDiagramAsset => {
      const result = sanitizeSvg(`<svg xmlns="${SVG_NS}" viewBox="0 0 100 50">${body}</svg>`, {
        idPrefix: 'asset-svg',
        mode: 'load',
      });
      if (!result.ok) throw new Error(result.error);
      return { id: 'asset-svg', kind: 'svg', svg: result.svg, widthPx: 100, heightPx: 50, bytes: 0 };
    };
    const uploadStep: DiagramStep = {
      ...createStep(() => 'step-upload'),
      picture: { kind: 'asset', assetId: 'asset-svg', paperScale: null, key: 'svg-asset-svg' },
    };
    const SVG = upload('<text x="1" y="20" font-weight="bold">Fold → <tspan>折</tspan></text>');

    it('sets its Han in the diagram’s style, and says what each face sets, its spaces too', () => {
      const picture = cellPicture(uploadStep, { [SVG.id]: SVG }, style, cell, 'c0-', { ...TEXT, hanStyle: 'tc' })!;
      expect(picture.markup).toContain(`<tspan font-family="'Noto Sans TC', sans-serif" font-weight="700">折</tspan>`);
      expect(picture.markup).not.toContain('Noto Sans SC');
      expect(picture.text).toEqual([
        { face: 'latin-700', characters: ' Fold → ' },
        { face: 'tc-700', characters: '折' },
      ]);
    });

    it('moves a character its font lacks to one that has it, and reports one none has', () => {
      const metrics = (has: (codePoint: number) => boolean): FontMetrics => ({
        unitsPerEm: 1000,
        has,
        advance: () => 500,
        codePoints: () => [],
      });
      const latin = metrics((codePoint) => codePoint < 0x2000);
      const han = metrics((codePoint) => codePoint === 0x2192 || codePoint === 0x6298 || codePoint === 0x20);
      const setter = fontTextSetter((key) => (key === 'latin' ? latin : key === 'sc' ? han : null), 'sc');
      const asset = upload('<text>Fold → ✂</text>');
      const picture = cellPicture(uploadStep, { [asset.id]: asset }, style, cell, 'c0-', {
        hanStyle: 'sc',
        runs: setter.runs,
      })!;
      expect(picture.markup).toContain(
        `<text font-family="'Noto Sans', sans-serif" font-weight="400">` +
          `<tspan font-family="'Noto Sans', sans-serif">Fold </tspan>` +
          `<tspan font-family="'Noto Sans SC', sans-serif">→</tspan>` +
          `<tspan font-family="'Noto Sans', sans-serif"> ✂</tspan></text>`
      );
      expect([...setter.missing]).toEqual(['✂']);
    });
  });
});

describe('prefixIds', () => {
  it('renames ids and every reference to them, in tags only', () => {
    const markup =
      '<g id="a"><use href="#a"/><use xlink:href="#b"/><rect fill="url(#g)" style="fill:url(\'#g\')"/>' +
      '<text>id="a" url(#g)</text></g>';
    expect(prefixIds(markup, 'c2-')).toBe(
      '<g id="c2-a"><use href="#c2-a"/><use xlink:href="#c2-b"/><rect fill="url(#c2-g)" style="fill:url(\'#c2-g\')"/>' +
        '<text>id="a" url(#g)</text></g>'
    );
  });
});
