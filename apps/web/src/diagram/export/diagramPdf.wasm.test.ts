// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDiagram, createStep, insertSteps, type DiagramDocument } from '../document/diagramDocument';
import { cpStep, referencesStep } from '../document/diagramSteps.fixtures';
import { DIAGRAM_FONT_FAMILY, type DiagramFontKey, type DiagramFontWeight } from '../fonts/diagramFontFaces';
import type { DiagramFonts } from '../fonts/diagramFonts';
import { readFontMetrics } from '../fonts/fontMetrics';
import { createFontSubsetter, type FontSubsetter } from '../fonts/fontSubset';
import { diagramPdfInput, PRINT_SHOP_BLEED_MM, PRINT_SHOP_SLUG_MM, type PdfWriter } from './diagramPdf';
import { craneStep } from '../zoom/zoom.fixtures';
import { xrayCase } from '../xray/xray.cases';

/**
 * A diagram through the real writer (`crates/oristudio-pdf-wasm`), in node.
 * Skipped where the bridge has not been built (a fresh worktree before
 * `build:wasm`); CI builds it before the web tests run.
 */
const ROOT = process.cwd();
const WASM = resolve(ROOT, 'src/generated/oristudio-pdf-wasm/oristudio_pdf_wasm_bg.wasm');
const available = existsSync(WASM);
const PT = 72 / 25.4;

const FONT_DIR = resolve(ROOT, 'src/diagram/fonts');
const FILES: Partial<Record<string, string>> = {
  'latin-400': 'NotoSans-Regular.ttf',
  'latin-700': 'NotoSans-Bold.ttf',
  'sc-400': 'fixtures/NotoSansSC-Regular.fixture.ttf',
  'sc-700': 'fixtures/NotoSansSC-Bold.fixture.ttf',
};
const FONTS: DiagramFonts = {
  font(key: DiagramFontKey, weight: DiagramFontWeight) {
    const file = FILES[`${key}-${weight}`];
    if (!file) return null;
    const bytes = new Uint8Array(readFileSync(resolve(FONT_DIR, file)));
    return { key, weight, family: DIAGRAM_FONT_FAMILY[key], tier: 'common', bytes, metrics: readFontMetrics(bytes) };
  },
  unavailable: [],
};

let subsetter: FontSubsetter;
let write: PdfWriter;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  subsetter = await createFontSubsetter(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')));
  if (!available) return;
  const wasm = await import('../../generated/oristudio-pdf-wasm/oristudio_pdf_wasm');
  wasm.initSync({ module: readFileSync(WASM) });
  write = async (pages, fonts, options) => wasm.pages_to_pdf(pages, fonts, options);
});

function diagram(steps = 12): DiagramDocument {
  const list = Array.from({ length: steps }, (_, index) =>
    index % 3 === 0
      ? { ...cpStep(`step-${index}`), text: 'Fold in half, then unfold.' }
      : index % 3 === 1
        ? referencesStep(`step-${index}`)
        : { ...createStep(() => `step-${index}`), text: '将底角向上折至顶角，压实折痕后展开。' }
  );
  const document = insertSteps(createDiagram({ title: 'Crane · 千纸鹤', hanStyle: 'sc' }), list, 0);
  return { ...document, page: { ...document.page, layout: 'flow' } };
}

/** The numbers in each `key [ … ]` of the file. */
function boxes(pdf: Uint8Array, key: string): number[][] {
  const text = new TextDecoder('latin1').decode(pdf);
  return [...text.matchAll(new RegExp(`${key.replace('/', '\\/')}\\s*\\[([^\\]]*)\\]`, 'g'))].map((match) =>
    match[1]!.trim().split(/\s+/).map(Number)
  );
}

describe.skipIf(!available)('a diagram as one PDF', () => {
  it('prints every page at home on its trim, with the fonts it sets embedded once', async () => {
    const input = diagramPdfInput(diagram(), FONTS, subsetter, 'home');
    expect(input.missing).toEqual([]);
    // Four faces: Noto Sans and the Chinese face, each Regular and Bold.
    expect(input.fonts).toHaveLength(4);
    const pdf = await write(input.pages, input.fonts, input.options);
    const media = boxes(pdf, '/MediaBox');
    expect(media).toHaveLength(2);
    for (const box of media) {
      expect(box[2]).toBeCloseTo(210 * PT, 1);
      expect(box[3]).toBeCloseTo(297 * PT, 1);
    }
    expect(boxes(pdf, '/TrimBox')).toEqual([]);
    const text = new TextDecoder('latin1').decode(pdf);
    for (const face of ['NotoSans-Regular', 'NotoSans-Bold', 'NotoSansSC']) expect(text).toContain(face);
    // One embedded file per face, whatever the page count.
    expect(text.match(/\/FontFile2/g)).toHaveLength(4);
  });

  it('gives a print shop its bleed art, boxes and marks', async () => {
    const input = diagramPdfInput(diagram(), FONTS, subsetter, 'print-shop');
    // Each page is drawn past its trim by the bleed.
    expect(input.pages[0]).toContain(`viewBox="${-Math.round(PRINT_SHOP_BLEED_MM * PT * 1000) / 1000} `);
    const pdf = await write(input.pages, input.fonts, input.options);
    const margin = PRINT_SHOP_BLEED_MM + PRINT_SHOP_SLUG_MM;
    expect(boxes(pdf, '/MediaBox')[0]![2]).toBeCloseTo((210 + 2 * margin) * PT, 1);
    expect(boxes(pdf, '/TrimBox')[0]).toEqual(
      [margin, margin, 210 + margin, 297 + margin].map((value) => expect.closeTo(value * PT, 1))
    );
    expect(new TextDecoder('latin1').decode(pdf)).toContain('/Separation/All');
  });

  it('writes the same bytes for the same diagram', async () => {
    const first = diagramPdfInput(diagram(4), FONTS, subsetter, 'home');
    const second = diagramPdfInput(diagram(4), FONTS, subsetter, 'home');
    expect(await write(first.pages, first.fonts, first.options)).toEqual(
      await write(second.pages, second.fonts, second.options)
    );
  });

  it('prints an upload’s text in the diagram’s fonts, its Han in the diagram’s style', async () => {
    // As the sanitizer stores it (`svgSanitize.ts`), with the spaces between runs left to the text.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">' +
      `<text x="4" y="20" font-size="9" font-family="'Noto Sans', sans-serif" font-weight="400">` +
      `<tspan font-family="'Noto Sans', sans-serif" font-weight="400">Fold</tspan> ` +
      `<tspan font-family="'Noto Sans SC', sans-serif" font-weight="700">折痕</tspan></text></svg>`;
    const asset = { id: 'asset-up', kind: 'svg' as const, svg, widthPx: 100, heightPx: 50, bytes: svg.length };
    const step = {
      ...createStep(() => 'step-up'),
      picture: { kind: 'asset' as const, assetId: asset.id, paperScale: null, key: 'svg-asset-up' },
    };
    const document = { ...insertSteps(createDiagram({ title: '', hanStyle: 'sc' }), [step], 0), assets: { [asset.id]: asset } };
    const input = diagramPdfInput(document, FONTS, subsetter, 'home');
    expect(input.missing).toEqual([]);
    const pdf = await write(input.pages, input.fonts, input.options);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text).toContain('NotoSans-Regular');
    expect(text).toMatch(/NotoSansSC-Bold/);
  });

  it('prints a callout’s words in the diagram’s fonts, its Han in the diagram’s style', async () => {
    const step = cpStep('step-callout');
    const callout = { id: 'c-1', kind: 'callout' as const, from: [0.2, 0.8] as [number, number], to: [0.6, 0.3] as [number, number], text: 'Repeat 将底角' };
    const document = insertSteps(createDiagram({ title: '', hanStyle: 'sc' }), [
      { ...step, annotations: [callout], annotatedPictureKey: step.picture!.key },
    ], 0);
    const input = diagramPdfInput(document, FONTS, subsetter, 'home');
    expect(input.missing).toEqual([]);
    const pdf = await write(input.pages, input.fonts, input.options);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text).toContain('NotoSans-Regular');
    expect(text).toMatch(/NotoSansSC-Regular/);
  });

  it('prints enlarged steps through their clips — a turned rounded frame, a cut circle — and the arrow between (Revision 2)', async () => {
    const crane = craneStep('S.none');
    const key = crane.picture!.key;
    const area = { id: 'area-1', kind: 'zoom' as const, from: [0.37, 0.13] as [number, number], to: [0.37, 0.13] as [number, number], radius: 0.13 };
    const steps = [
      { ...crane, id: 'step-area', annotations: [area], annotatedPictureKey: key, text: 'Fold the head down.' },
      { ...crane, id: 'step-cut', zoom: { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.37, 0.13] as [number, number], radius: 0.13 } }, annotatedPictureKey: key },
      {
        ...crane,
        id: 'step-turned',
        zoom: { from: 'area-1', shape: 'rounded' as const, frame: { centre: [0.37, 0.52] as [number, number], size: [0.3, 0.18] as [number, number], angle: 30 } },
        annotatedPictureKey: key,
      },
    ];
    const document = insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), steps, 0);
    const input = diagramPdfInput(document, FONTS, subsetter, 'home');
    const [page] = input.pages;
    // The page as composed: two clips, one a rect turned by its frame's angle; the cut circle's arcs; the arrow.
    expect(page!.match(/<clipPath id="[^"]*zoom-clip">/g)).toHaveLength(2);
    expect(page).toMatch(/<clipPath id="[^"]*zoom-clip"><rect [^>]*transform="rotate\(30 /);
    expect(page).toMatch(/<path d="M [-\d.]+ [-\d.]+ A [-\d.]+ [-\d.]+ 0 [01] [01] /);
    // The writer takes the page whole: its clips and arcs are SVG it already prints (15f's close-ups).
    const pdf = await write(input.pages, input.fonts, input.options);
    expect(boxes(pdf, '/MediaBox')).toHaveLength(1);
    if (process.env.ZOOM_PDF_OUT) writeFileSync(process.env.ZOOM_PDF_OUT, pdf);
  });

  it('prints x-ray windows through their clips — on a step, and held to an enlarged step’s frame (Revision 3, 18f)', async () => {
    const steps = ['crane-spread', 'crane-marks', 'crane-enlarged'].map((id) => ({ ...xrayCase(id), id: `step-${id}` }));
    const document = insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), steps, 0);
    const input = diagramPdfInput(document, FONTS, subsetter, 'home');
    const pages = input.pages.join('');
    // Four windows, each its own clip on the page; the enlarged step's held to its frame too.
    const clips = pages.match(/<clipPath id="[^"]*annotation-x-ray-\d-clip">/g)!;
    expect(clips).toHaveLength(4);
    expect(new Set(clips).size).toBe(4);
    expect(pages.match(/<clipPath id="[^"]*annotation-x-ray-\d-bound"><polygon /g)).toHaveLength(1);
    // The writer takes the page whole: its clips are SVG it already prints (15f's close-ups).
    const pdf = await write(input.pages, input.fonts, input.options);
    expect(boxes(pdf, '/MediaBox').length).toBe(input.pages.length);
    if (process.env.XRAY_PDF_OUT) writeFileSync(process.env.XRAY_PDF_OUT, pdf);
  });

  it('refuses a diagram with a character no font has, rather than print a box', async () => {
    const document = diagram(1);
    const input = diagramPdfInput(
      { ...document, steps: [{ ...document.steps[0]!, text: 'Fold 𠀀' }] },
      FONTS,
      subsetter,
      'home'
    );
    expect(input.missing).toEqual(['𠀀']);
    await expect(write(input.pages, input.fonts, input.options)).rejects.toMatchObject({ code: 'text' });
    // And a text of nothing but such characters, which draws only boxes.
    const alone = diagramPdfInput(
      { ...document, steps: [{ ...document.steps[0]!, text: '𠀀' }] },
      FONTS,
      subsetter,
      'home'
    );
    await expect(write(alone.pages, alone.fonts, alone.options)).rejects.toMatchObject({ code: 'text' });
  });
});
