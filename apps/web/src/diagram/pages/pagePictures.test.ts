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
    expect(layoutPicture(cpStep('step-cp'), {}, style)).toEqual({ kind: 'paper', extentUnits: 1 });
    expect(layoutPicture(bitmapStep(100), assets, style)).toEqual({ kind: 'paper', extentUnits: 3 });
    expect(layoutPicture(bitmapStep(null), assets, style)).toEqual({ kind: 'fit' });
    const threeD = cpStep('step-3d', undefined, { ...scenePicture(), paperScale: null });
    expect(layoutPicture(threeD, {}, style)).toEqual({ kind: 'fit' });
    expect(layoutPicture({ ...createStep(() => 'step-fixed'), picture: fixedPicture() }, {}, style)).toEqual({ kind: 'fit' });
    expect(layoutPicture(createStep(() => 'step-empty'), {}, style)).toBeNull();
  });

  it('measures a References step by its sheet, its letters reaching further on a small one', () => {
    const step = referencesStep('step-sent');
    const atCard = layoutPicture(step, {}, style);
    const small = layoutPicture(step, {}, style, 10);
    if (atCard?.kind !== 'paper' || small?.kind !== 'paper') throw new Error('paper');
    // A unit sheet, and a letter past its edge.
    expect(atCard.extentUnits).toBeGreaterThan(1);
    expect(small.extentUnits).toBeGreaterThan(atCard.extentUnits);
  });
});

describe('cellPicture', () => {
  const cell = { pictureMm: { x: 10, y: 20, size: 40 }, mmPerUnit: null };

  it('fits a picture with no paper scale to its box, centred', () => {
    const picture = cellPicture(bitmapStep(null), assets, style, cell, 'c0-', TEXT)!;
    const [, x, y, width, height] = /<svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(picture.markup)!.map(Number);
    expect(width).toBeCloseTo(40 * PT_PER_MM, 2);
    expect(height).toBeCloseTo((40 * PT_PER_MM * 2) / 3, 2);
    expect(x).toBeCloseTo(10 * PT_PER_MM, 2);
    expect(y! + height! / 2).toBeCloseTo((20 + 20) * PT_PER_MM, 2);
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
