import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PT_PER_MM } from '../../lib/paper/paperSvg';
import {
  createDiagram,
  createStep,
  insertSteps,
  type DiagramDocument,
  type DiagramStep,
  type KnownDiagramAsset,
} from '../document/diagramDocument';
import { cpStep, fixedPicture, referencesStep } from '../document/diagramSteps.fixtures';
import { DIAGRAM_FONT_FAMILY, type DiagramFontKey, type DiagramFontWeight } from '../fonts/diagramFontFaces';
import type { DiagramFonts, LoadedDiagramFont } from '../fonts/diagramFonts';
import { readFontMetrics } from '../fonts/fontMetrics';
import { createFontSubsetter, type FontSubsetter } from '../fonts/fontSubset';
import { PAGE_NUMBER_SIZE_MM } from './diagramPageLayout';
import { preparedPages } from './diagramPages';
import { layoutPicture } from './pagePictures';

const FONT_DIR = resolve(process.cwd(), 'src/diagram/fonts');
const FILES: Partial<Record<string, string>> = {
  'latin-400': 'NotoSans-Regular.ttf',
  'latin-700': 'NotoSans-Bold.ttf',
  'sc-400': 'fixtures/NotoSansSC-Regular.fixture.ttf',
  'sc-700': 'fixtures/NotoSansSC-Bold.fixture.ttf',
};
const FONTS: DiagramFonts = {
  font(key: DiagramFontKey, weight: DiagramFontWeight): LoadedDiagramFont | null {
    const file = FILES[`${key}-${weight}`];
    if (!file) return null;
    const bytes = new Uint8Array(readFileSync(resolve(FONT_DIR, file)));
    return { key, weight, family: DIAGRAM_FONT_FAMILY[key], tier: 'common', bytes, metrics: readFontMetrics(bytes) };
  },
  unavailable: [],
};

let subsetter: FontSubsetter;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  subsetter = await createFontSubsetter(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')));
});

/** An upload with its own ids, as the sanitizer leaves them: under the asset's id. */
const UPLOAD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20">' +
  '<defs><linearGradient id="asset-up-g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>' +
  '<rect id="asset-up-r" width="40" height="20" fill="url(#asset-up-g)"/><use href="#asset-up-r"/></svg>';
const UPLOAD: KnownDiagramAsset = { id: 'asset-up', kind: 'svg', svg: UPLOAD_SVG, widthPx: 40, heightPx: 20, bytes: 1 };

function uploadStep(id: string): DiagramStep {
  return {
    ...createStep(() => id),
    source: { kind: 'upload', assetId: UPLOAD.id, rotationQuarterTurns: 0, mirrored: false },
    picture: { kind: 'asset', assetId: UPLOAD.id, paperScale: null, key: `asset:${UPLOAD.id}` },
    text: 'Swivel the flap.',
  };
}

function diagram(): DiagramDocument {
  const steps = [
    { ...cpStep('step-cp'), text: 'Fold in half, then unfold.' },
    referencesStep('step-sent'),
    uploadStep('step-up-1'),
    uploadStep('step-up-2'),
    { ...createStep(() => 'step-empty'), text: '将底角向上折至顶角，压实折痕后展开。' },
    { ...createStep(() => 'step-fixed'), source: null, picture: fixedPicture() },
  ];
  const document = insertSteps(createDiagram({ title: 'Crane · 千纸鹤', hanStyle: 'sc' }), steps, 0);
  return { ...document, assets: { [UPLOAD.id]: UPLOAD } };
}

const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('composeDiagramPage', () => {
  it('writes a well-formed page in pt, the size of the paper', () => {
    const pages = preparedPages(diagram(), FONTS, subsetter);
    const page = pages.compose(0);
    const document = parse(page.svg);
    expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(page.widthPt).toBeCloseTo(210 * PT_PER_MM, 6);
    expect(document.documentElement.getAttribute('width')).toBe(`${Math.round(210 * PT_PER_MM * 1000) / 1000}pt`);
  });

  it('gives every id on the page once, though two cells draw one upload', () => {
    const svg = preparedPages(diagram(), FONTS, subsetter).compose(0).svg;
    const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    // Every reference names an id on the page.
    for (const [, reference] of svg.matchAll(/(?:href="#|url\(#)([^")]*)/g)) expect(ids).toContain(reference);
  });

  it('embeds each face it sets, cut to its characters, and names no other', () => {
    const svg = preparedPages(diagram(), FONTS, subsetter).compose(0).svg;
    const faces = [...svg.matchAll(/@font-face\{font-family:'([^']*)';font-weight:(\d+);[^}]*base64,([^)]*)\)/g)];
    const embedded = new Map(faces.map(([, family, weight, data]) => [`${family}|${weight}`, data!]));
    expect([...embedded.keys()].sort()).toEqual(['Noto Sans SC|400', 'Noto Sans SC|700', 'Noto Sans|400', 'Noto Sans|700']);
    const document = parse(svg);
    for (const text of document.querySelectorAll('text')) {
      const weight = text.getAttribute('font-weight');
      for (const span of text.querySelectorAll('tspan')) {
        const family = /^'([^']*)'/.exec(span.getAttribute('font-family') ?? '')![1]!;
        const data = embedded.get(`${family}|${weight}`);
        expect(data, `${family} ${weight}`).toBeDefined();
        const metrics = readFontMetrics(Uint8Array.from(atob(data!), (c) => c.charCodeAt(0)));
        for (const character of span.textContent ?? '') {
          if (character !== ' ') expect(metrics.has(character.codePointAt(0)!), character).toBe(true);
        }
      }
    }
    // References' letters are set in the page's font, not the screen's.
    expect(svg).not.toContain('Inter');
  });

  it('keeps an empty step’s number and text, and draws nothing in its picture box', () => {
    const pages = preparedPages(diagram(), FONTS, subsetter);
    const cell = pages.layout.pages[0]!.cells[4]!;
    const group = parse(pages.compose(0).svg).querySelectorAll('svg > g')[4]!;
    expect(group.querySelector('svg, path, line, polygon, image')).toBeNull();
    const texts = [...group.querySelectorAll('text')].map((text) => text.textContent);
    expect(texts[0]).toBe('5');
    expect(texts[1]).toBe(cell.text.lines.map((line) => line.text).join(''));
  });

  it('places every run where the line set it, and right-aligns an odd page’s number by its width', () => {
    const pages = preparedPages(diagram(), FONTS, subsetter);
    const { layout } = pages;
    const document = parse(pages.compose(0).svg);
    const title = document.querySelector('svg > text')!;
    const spans = [...title.querySelectorAll('tspan')];
    expect(spans.map((span) => span.textContent)).toEqual(layout.title!.line.runs.map((run) => run.text));
    layout.title!.line.runs.forEach((run, index) => {
      expect(Number(spans[index]!.getAttribute('x'))).toBeCloseTo((layout.title!.textAt.x + run.xMm) * PT_PER_MM, 2);
    });
    const number = [...document.querySelectorAll('svg > text')].at(-1)!;
    const at = layout.pages[0]!.pageNumberAt!;
    expect(number.textContent).toBe('1');
    expect(at.anchor).toBe('end');
    const one = FONTS.font('latin', 700)!.metrics;
    const widthMm = (one.advance('1'.codePointAt(0)!) * PAGE_NUMBER_SIZE_MM) / one.unitsPerEm;
    const x = Number(number.querySelector('tspan')!.getAttribute('x'));
    expect(x).toBeCloseTo((at.x - widthMm) * PT_PER_MM, 2);
  });

  it('draws the linked pattern and the sent step at one scale: one pattern unit, one size', () => {
    const document = diagram();
    for (const step of document.steps.slice(0, 2)) {
      expect(layoutPicture(step, document.assets, document.style)).toMatchObject({ kind: 'paper' });
    }
    expect(layoutPicture(document.steps[2]!, document.assets, document.style)).toEqual({ kind: 'fit' });
    const pages = preparedPages(document, FONTS, subsetter);
    const [cp, sent] = pages.layout.pages[0]!.cells;
    expect(cp!.mmPerUnit).toBe(pages.layout.mmPerUnit);
    expect(sent!.mmPerUnit).toBe(pages.layout.mmPerUnit);
  });
});
