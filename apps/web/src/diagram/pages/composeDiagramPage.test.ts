import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PT_PER_MM } from '../../lib/paper/paperSvg';
import {
  createDiagram,
  createStep,
  DEFAULT_PAGE_SETUP,
  insertSteps,
  createTurn,
  stepsOf,
  type DiagramDocument,
  type DiagramPageSetup,
  type DiagramStep,
  type KnownDiagramAsset,
} from '../document/diagramDocument';
import {
  cpStep,
  fixedPicture,
  referencesStep,
  scenePicture,
  SENT_MODEL,
  stepDiagramPicture,
  stepsIn,
} from '../document/diagramSteps.fixtures';
import { storedSceneJson } from '../document/diagramFile';
import { face, sceneOf } from '../../lib/paper/paperScene.fixtures';
import { DIAGRAM_FONT_FAMILY, type DiagramFontKey, type DiagramFontWeight } from '../fonts/diagramFontFaces';
import type { DiagramFonts, LoadedDiagramFont } from '../fonts/diagramFonts';
import { readFontMetrics } from '../fonts/fontMetrics';
import { createFontSubsetter, type FontSubsetter } from '../fonts/fontSubset';
import { FIT_GIVE, MARKS_FLOOR, PAGE_NUMBER_SIZE_MM } from './diagramPageLayout';
import { estimateTextSetter } from './estimateTextSetter';
import { layoutDiagram, preparedPages } from './diagramPages';
import { composeDiagramPage } from './composeDiagramPage';
import { cellPicture, layoutPicture } from './pagePictures';

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

/** A scene of the fixture's paper folded tall: 60 × 140 px at the fixture's 100 px per unit. */
function tallSceneJson(): string {
  return storedSceneJson(sceneOf([face([[[30, 0], [60, 70], [30, 140], [0, 70]]])]))!;
}

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
    const document: DiagramDocument = { ...diagram(), page: { ...DEFAULT_PAGE_SETUP, scale: 'paper' } };
    for (const step of stepsIn(document).slice(0, 2)) {
      expect(layoutPicture(step, document.assets, document.style)).toMatchObject({ kind: 'paper' });
    }
    expect(layoutPicture(stepsIn(document)[2]!, document.assets, document.style)).toMatchObject({ kind: 'fit' });
    const pages = preparedPages(document, FONTS, subsetter);
    const [cp, sent] = pages.layout.pages[0]!.cells;
    expect(pages.layout.mmPerUnit).not.toBeNull();
    expect(cp!.mmPerUnit).toBe(pages.layout.mmPerUnit);
    expect(sent!.mmPerUnit).toBe(pages.layout.mmPerUnit);
  });

  /** Each scene's paper on a composed page, the first face its painter draws: its width in pt. */
  const paperWidths = (svg: string) =>
    [...svg.matchAll(/<g stroke-linejoin="round">\s*<path d="([^"]*)"/g)].map((match) => {
      const xs = [...match[1]!.matchAll(/[ML](-?[\d.]+),/g)].map((each) => Number(each[1]));
      return Math.max(...xs) - Math.min(...xs);
    });
  const SETUPS: Partial<DiagramPageSetup>[] = [
    {},
    { orientation: 'landscape', columns: 3, rows: 5 },
    { size: 'a5', columns: 4, rows: 1 },
    { size: 'a5', orientation: 'landscape', columns: 3, rows: 6 },
    { size: 'letter', columns: 2, rows: 6 },
    { columns: 5, rows: 6 },
  ];
  const setupName = (setup: Partial<DiagramPageSetup>) => JSON.stringify(setup);

  it('fits each step by default, the paper one scale whatever their marks reach a little past, on any page', () => {
    // An arrow bulging over the top edge, and a push from far off the picture.
    const over: DiagramStep = {
      ...cpStep('step-2'),
      annotations: [{ id: 'a', kind: 'valley-arrow', from: [0.2, 0.004], to: [0.8, 0.004], bend: 0.05 }],
    };
    const far: DiagramStep = {
      ...cpStep('step-4'),
      annotations: [{ id: 'b', kind: 'push-arrow', from: [-0.5, 0.5], to: [0.2, 0.5] }],
    };
    const made = insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), [cpStep('step-1'), over, cpStep('step-3'), far], 0);
    expect(made.page.scale).toBe('fit');
    for (const setup of SETUPS) {
      const document: DiagramDocument = { ...made, page: { ...made.page, ...setup } };
      const pages = preparedPages(document, FONTS, subsetter);
      const widths = paperWidths(pages.compose(0).svg);
      expect(widths, setupName(setup)).toHaveLength(4);
      expect(widths[1]! / widths[0]!, setupName(setup)).toBeCloseTo(1, 3);
      expect(widths[2]! / widths[0]!, setupName(setup)).toBeCloseTo(1, 3);
      // The far push is never drawn larger; on a square cell it fits only well under the others' scale.
      expect(widths[3]!, setupName(setup)).toBeLessThanOrEqual(widths[0]! * 1.001);
      if (Object.keys(setup).length === 0) expect(widths[3]!).toBeLessThan(widths[0]! * (1 - FIT_GIVE));
    }
  });

  it('keeps every picture and its marks inside the room the layout drew for it, at any scale and page', () => {
    // Letters on all four sides of a References sheet, which reach further the smaller it is drawn.
    const four = stepDiagramPicture(false, {
      ...SENT_MODEL,
      primitives: [
        ...SENT_MODEL.primitives,
        { kind: 'label', at: [1, 0.5], text: 'B', style: 'normal' },
        { kind: 'label', at: [0.5, 0], text: 'C', style: 'normal' },
        { kind: 'label', at: [0.5, 1], text: 'D', style: 'normal' },
      ],
    });
    const lettered: DiagramStep = { ...referencesStep('step-2'), picture: four, text: 'Fold the corner to the line.' };
    const arrowed: DiagramStep = {
      ...cpStep('step-3'),
      annotations: [{ id: 'a', kind: 'fold-unfold-arrow', from: [0.1, 0.02], to: [0.9, 0.02], bend: 0.134 }],
    };
    const long: DiagramStep = { ...referencesStep('step-4'), picture: four, text: Array(12).fill('Fold the corner to the line.').join(' ') };
    const made = insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), [cpStep('step-1'), lettered, arrowed, long], 0);
    let floored = 0;
    for (const scale of ['fit', 'paper'] as const) {
      for (const setup of SETUPS) {
        const document: DiagramDocument = { ...made, page: { ...made.page, ...setup, scale } };
        const layout = layoutDiagram(document, estimateTextSetter);
        for (const cell of layout.pages.flatMap((page) => page.cells)) {
          const step = stepsIn(document).find((each) => each.id === cell.stepId)!;
          const picture = cellPicture(step, document.assets, document.style, cell, 'c-', { hanStyle: 'sc', runs: estimateTextSetter.runs })!;
          const room = { x: cell.drawMm.x * PT_PER_MM, y: cell.drawMm.y * PT_PER_MM, w: cell.drawMm.w * PT_PER_MM, h: cell.drawMm.h * PT_PER_MM };
          const name = `${scale} ${setupName(setup)} ${cell.stepId}`;
          const at = cell.mmPerUnit;
          if (at === null) continue;
          // What the layout found the picture needs, measured at the scale it is drawn at.
          const needs = layoutPicture(step, document.assets, document.style, { mmPerUnit: at })!;
          const fits = needs.width * at <= cell.drawMm.w * (1 + 1e-3) && needs.height * at <= cell.drawMm.h * (1 + 1e-3);
          if (fits) {
            // Within a hair: the marks were measured at the scale the picture is drawn at.
            const hair = 0.002 * Math.max(room.w, room.h);
            expect(picture.boundsPt.x, name).toBeGreaterThanOrEqual(room.x - hair);
            expect(picture.boundsPt.y, name).toBeGreaterThanOrEqual(room.y - hair);
            expect(picture.boundsPt.x + picture.boundsPt.width, name).toBeLessThanOrEqual(room.x + room.w + hair);
            expect(picture.boundsPt.y + picture.boundsPt.height, name).toBeLessThanOrEqual(room.y + room.h + hair);
          } else {
            // A room its marks cannot fit: the paper alone fits, at its floor, and the marks reach out.
            expect(needs.frame.width * at, name).toBeLessThanOrEqual(cell.drawMm.w * (1 + 1e-3));
            expect(needs.frame.height * at, name).toBeLessThanOrEqual(cell.drawMm.h * (1 + 1e-3));
            const alone = Math.min(cell.drawMm.w / needs.frame.width, cell.drawMm.h / needs.frame.height);
            expect(at / alone, name).toBeCloseTo(MARKS_FLOOR, 2);
            floored += 1;
          }
        }
      }
    }
    // The small setups' long instruction leaves its References step a room its letters cannot fit.
    expect(floored).toBeGreaterThan(0);
  });

  it('draws a taller model at the run’s scale, taller than its box, its instruction below it', () => {
    // The bird base after the square base, as on Zach's crane: the same paper, folded taller.
    const tall: DiagramStep = { ...cpStep('step-2'), picture: { ...scenePicture('tall'), sceneJson: tallSceneJson() }, text: 'Petal fold.' };
    const document = insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), [cpStep('step-1'), tall], 0);
    const { layout } = preparedPages(document, FONTS, subsetter);
    const [square, bird] = layout.pages[0]!.cells;
    expect(bird!.mmPerUnit).toBe(square!.mmPerUnit);
    expect(bird!.drawMm.h).toBeGreaterThan(bird!.pictureMm.size);
    expect(bird!.text.firstBaseline).toBeGreaterThan(bird!.drawMm.y + bird!.drawMm.h);
  });

  it('draws a turn between two steps in the gutter, centred on its place, and numbers the steps on (D22)', () => {
    const document = diagram();
    const turned = insertSteps(document, [createTurn({ kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } })], 2);
    const plain = preparedPages(document, FONTS, subsetter).compose(0).svg;
    const pages = preparedPages(turned, FONTS, subsetter);
    const [turn] = pages.layout.pages[0]!.turns;
    expect(turn).toBeDefined();
    const svg = pages.compose(0).svg;
    const page = parse(svg);
    expect(page.querySelector('parsererror')).toBeNull();
    expect(svg.length).toBeGreaterThan(plain.length);
    // The glyph's "1/4" is set in the diagram's own font, and the page embeds its digits.
    const fraction = [...page.querySelectorAll('text')].find((text) => text.textContent === '1/4');
    expect(fraction?.getAttribute('font-family')).toContain(DIAGRAM_FONT_FAMILY.latin);
    let embedded: ReadonlyMap<string, string> = new Map();
    composeDiagramPage({
      layout: pages.layout,
      page: pages.layout.pages[0]!,
      steps: new Map(stepsOf(turned).map((step) => [step.id, step])),
      assets: turned.assets,
      style: turned.style,
      hanStyle: turned.hanStyle,
      setter: pages.setter,
      embedFonts: (usage) => {
        embedded = usage;
        return '';
      },
    });
    const digits = [...embedded.values()].join('');
    for (const character of '1/4') expect(digits).toContain(character);
    // Nothing on the page but the glyph sets a "/".
    const plainUsage = new Map<string, string>();
    composeDiagramPage({
      layout: preparedPages(document, FONTS, subsetter).layout,
      page: preparedPages(document, FONTS, subsetter).layout.pages[0]!,
      steps: new Map(stepsOf(document).map((step) => [step.id, step])),
      assets: document.assets,
      style: document.style,
      hanStyle: document.hanStyle,
      setter: pages.setter,
      embedFonts: (usage) => {
        for (const [face, characters] of usage) plainUsage.set(face, characters);
        return '';
      },
    });
    expect([...plainUsage.values()].join('')).not.toContain('/');
    // The third step is still number 3: the turn takes no number.
    expect(pages.layout.pages[0]!.cells.map((cell) => cell.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
