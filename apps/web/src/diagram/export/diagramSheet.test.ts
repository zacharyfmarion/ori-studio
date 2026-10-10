// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createDiagram, createStep, insertSteps, type DiagramDocument, type DiagramPageSide } from '../document/diagramDocument';
import { fixedPicture } from '../document/diagramSteps.fixtures';
import { FIXTURE_FONTS, fixtureSubsetter } from '../fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../fonts/fontSubset';
import { preparedPages } from '../pages/diagramPages';
import { prefixIds } from '../pictures/prefixIds';
import { composeEveryPage, diagramPdfInput } from './diagramPdf';
import { xrayCase } from '../xray/xray.cases';
import { diagramSheetFile, diagramSheetLayout, diagramSheetSvg, sheetPagePrefix, SPREAD_GAP_MM } from './diagramSheet';

let subsetter: FontSubsetter;
beforeAll(async () => {
  subsetter = await fixtureSubsetter();
});

const A4 = { width: 210, height: 297 };

/** Each page's side, as the layout gives it: alternating from the first page's. */
function sides(count: number, first: DiagramPageSide): DiagramPageSide[] {
  return Array.from({ length: count }, (_, index) => ((index % 2 === 0) === (first === 'left') ? 'left' : 'right'));
}

/** A picture with ids of its own: a gradient its path is filled with. */
const GRADIENT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10">' +
  '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>' +
  '<path id="p" d="M0 0L20 10" fill="url(#g)" stroke="#000"/><use href="#p"/></svg>';

/** `count` steps, each with that picture and a sentence, in a flow of 3 × 3 a page. */
function diagram(count: number, firstPageSide: DiagramPageSide = 'left'): DiagramDocument {
  const steps = Array.from({ length: count }, (_, index) => ({
    ...createStep(() => `step-${index}`),
    picture: fixedPicture(`fixed-${index}`, GRADIENT_SVG),
    text: index % 2 === 0 ? 'Fold in half.' : 'Unfold, then fold the corner up.',
  }));
  const document = insertSteps(createDiagram({ title: 'Crane & <Frog>' }), steps, 0);
  return { ...document, page: { ...document.page, firstPageSide } };
}

describe('diagramSheetLayout', () => {
  it('pairs pages from a left first page — 1|2, 3|4 — and leaves an odd last page on the left', () => {
    expect(diagramSheetLayout(sides(4, 'left'), A4).spreads).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(diagramSheetLayout(sides(5, 'left'), A4).spreads).toEqual([
      [0, 1],
      [2, 3],
      [4, null],
    ]);
  });

  it('puts a right first page alone on the right, then pairs 2|3, 4|5', () => {
    expect(diagramSheetLayout(sides(4, 'right'), A4).spreads).toEqual([
      [null, 0],
      [1, 2],
      [3, null],
    ]);
    expect(diagramSheetLayout(sides(5, 'right'), A4).spreads).toEqual([
      [null, 0],
      [1, 2],
      [3, 4],
    ]);
    expect(diagramSheetLayout(sides(2, 'right'), A4).spreads).toEqual([
      [null, 0],
      [1, null],
    ]);
  });

  it('is two pages wide, the spreads a gap apart, the pages meeting at the spine', () => {
    const layout = diagramSheetLayout(sides(5, 'right'), A4);
    expect(layout.across).toBe(2);
    expect(layout.widthMm).toBe(420);
    expect(layout.heightMm).toBe(3 * 297 + 2 * SPREAD_GAP_MM);
    expect(layout.places).toEqual([
      { x: 210, y: 0 },
      { x: 0, y: 297 + SPREAD_GAP_MM },
      { x: 210, y: 297 + SPREAD_GAP_MM },
      { x: 0, y: 2 * (297 + SPREAD_GAP_MM) },
      { x: 210, y: 2 * (297 + SPREAD_GAP_MM) },
    ]);
  });

  it('is one page wide for a single page, whichever side it is on', () => {
    for (const first of ['left', 'right'] as const) {
      const layout = diagramSheetLayout(sides(1, first), { width: 279.4, height: 215.9 });
      expect(layout).toMatchObject({ across: 1, widthMm: 279.4, heightMm: 215.9, spreads: [[0, null]] });
      expect(layout.places).toEqual([{ x: 0, y: 0 }]);
    }
  });
});

describe('diagramSheetSvg', () => {
  it('writes the sheet in mm, a viewport for each page in its place, and the title', () => {
    const document = diagram(20);
    const prepared = preparedPages(document, FIXTURE_FONTS, subsetter);
    expect(prepared.layout.pages).toHaveLength(3);
    const { svg, layout } = diagramSheetFile(document, prepared, FIXTURE_FONTS, subsetter);
    expect(layout.spreads).toEqual([
      [0, 1],
      [2, null],
    ]);
    const height = 2 * 297 + SPREAD_GAP_MM;
    expect(svg).toContain(`width="420mm" height="${height}mm" viewBox="0 0 420 ${height}"`);
    expect(svg).toContain('<title>Crane &amp; &lt;Frog&gt;</title>');
    // Each page on white, its viewport the page's own pt viewBox.
    const viewports = [...svg.matchAll(/<svg x="([\d.]+)" y="([\d.]+)" width="210" height="297" viewBox="0 0 595.276 841.89">/g)];
    expect(viewports.map((match) => [Number(match[1]), Number(match[2])])).toEqual([
      [0, 0],
      [210, 0],
      [0, 297 + SPREAD_GAP_MM],
    ]);
    expect(svg.match(/<rect x="[\d.]+" y="[\d.]+" width="210" height="297" fill="#ffffff"\/>/g)).toHaveLength(3);
    // Nothing outside the document.
    expect(svg).not.toMatch(/(?:href|src)="(?!#|data:)/);
  });

  it('keeps every id unique across the pages, and every reference on its own page', () => {
    const document = diagram(20);
    const { svg } = diagramSheetFile(document, preparedPages(document, FIXTURE_FONTS, subsetter), FIXTURE_FONTS, subsetter);
    const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]!);
    // A gradient and a path in each of the twenty pictures, and the pages' own groups.
    expect(ids.length).toBeGreaterThanOrEqual(43);
    expect(new Set(ids).size).toBe(ids.length);
    const pages = svg.split(/<g id="page-\d+">/).slice(1);
    pages.forEach((page, index) => {
      const references = [...page.matchAll(/(?:href="#|url\(#)([^")]*)/g)].map((match) => match[1]!);
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) {
        expect(reference.startsWith(sheetPagePrefix(index))).toBe(true);
        expect(page).toContain(`id="${reference}"`);
      }
    });
  });

  it('draws x-ray windows on the sheet, each clip its page’s own (Revision 3, 18f)', () => {
    // A page of x-rayed crane steps, over and over: windows on many cells and on more than one page.
    const steps = Array.from({ length: 14 }, (_, index) => ({ ...xrayCase(index % 2 ? 'crane-marks' : 'crane-enlarged'), id: `step-${index}` }));
    const document = insertSteps(createDiagram({ title: 'Crane' }), steps, 0);
    const prepared = preparedPages(document, FIXTURE_FONTS, subsetter);
    expect(prepared.layout.pages.length).toBeGreaterThan(1);
    const { svg } = diagramSheetFile(document, prepared, FIXTURE_FONTS, subsetter);
    expect(svg.match(/<g data-x-ray-window="">/g)).toHaveLength(7 * 2 + 7);
    const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]!);
    expect(new Set(ids).size).toBe(ids.length);
    svg.split(/<g id="page-\d+">/).slice(1).forEach((page, index) => {
      for (const [, reference] of page.matchAll(/url\(#([^)]*x-ray[^)]*)\)/g)) {
        expect(reference!.startsWith(sheetPagePrefix(index))).toBe(true);
        expect(page).toContain(`id="${reference}"`);
      }
    });
  });

  it('draws each page as the PDF does: the very markup the writer is handed', () => {
    const document = diagram(12, 'right');
    const prepared = preparedPages(document, FIXTURE_FONTS, subsetter);
    const { svg } = diagramSheetFile(document, prepared, FIXTURE_FONTS, subsetter);
    const pdf = diagramPdfInput(document, FIXTURE_FONTS, subsetter, 'home');
    expect(pdf.pages).toHaveLength(2);
    pdf.pages.forEach((page, index) => {
      const body = page.replace(/^[\s\S]*?<\/defs>\s*/, '').replace(/<\/svg>\s*$/, '').trim();
      expect(svg).toContain(prefixIds(body, sheetPagePrefix(index)));
    });
  });

  it('embeds each face once, cut to what every page sets in it, beside one copy of the set-text rules', () => {
    const document = diagram(20);
    const prepared = preparedPages(document, FIXTURE_FONTS, subsetter);
    const { svg } = diagramSheetFile(document, prepared, FIXTURE_FONTS, subsetter);
    const faces = [...svg.matchAll(/@font-face\{font-family:'([^']*)';font-weight:(\d+)/g)].map(
      (match) => `${match[1]} ${match[2]}`
    );
    // Noto Sans: Regular for the instructions, Bold for the title, numbers and page numbers.
    expect(faces).toEqual(['Noto Sans 400', 'Noto Sans 700']);
    expect(svg.match(/<style>/g)).toHaveLength(1);
    expect(svg.match(/text\{font-kerning:none/g)).toHaveLength(1);
    // The faces are the ones the pages set, across all of them.
    const { usage } = composeEveryPage(document, prepared);
    expect([...usage.keys()].sort()).toEqual(['latin-400', 'latin-700']);
    expect(usage.get('latin-400')).toContain('U');
  });

  it('dedupes rules the pages repeat, and refuses what is not a composed page', () => {
    const page = (body: string) =>
      '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10pt" height="20pt" viewBox="0 0 10 20">\n' +
      `<defs><style>text{a:b}</style></defs>\n${body}\n</svg>`;
    const layout = diagramSheetLayout(['left', 'right'], { width: 10, height: 20 });
    const svg = diagramSheetSvg({
      pages: [page('<path id="x"/>'), page('<path id="x"/>')],
      layout,
      fonts: "@font-face{font-family:'A'}",
      title: '',
    });
    expect(svg).not.toContain('<title>');
    expect(svg).toContain("<defs><style>\n@font-face{font-family:'A'}\ntext{a:b}\n</style></defs>");
    expect(svg).toContain('<path id="p1-x"/>');
    expect(svg).toContain('<path id="p2-x"/>');
    expect(() => diagramSheetSvg({ pages: ['<g/>'], layout, fonts: '', title: '' })).toThrow(/not a composed page/);
  });
});
