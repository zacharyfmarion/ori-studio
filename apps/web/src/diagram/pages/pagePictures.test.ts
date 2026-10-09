import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_PAGE } from '../../lib/paper/paperPage';
import { DEFAULT_PAPER_STYLE, PEN_WIDTH_RANGE } from '../../lib/paper/paperStyle';
import { mmToCssPx, pageMarginPt, PT_PER_MM } from '../../lib/paper/paperSvg';
import {
  createDiagram,
  createStep,
  DEFAULT_DIAGRAM_STYLE,
  insertSteps,
  type DiagramStep,
  type DiagramStyle,
  type KnownDiagramAsset,
} from '../document/diagramDocument';
import { cpStep, fixedPicture, referencesStep, scenePicture } from '../document/diagramSteps.fixtures';
import type { FontMetrics } from '../fonts/fontMetrics';
import { sanitizeSvg, SVG_NS } from '../upload/svgSanitize';
import { diagramScenePaintStyle } from '../pictures/diagramPaperStyle';
import { stepDiagramScene } from '../pictures/paintStepDiagram';
import { pictureExtent } from './diagramPageLayout';
import { layoutDiagram } from './diagramPages';
import { estimateTextSetter } from './estimateTextSetter';
import { fontTextSetter } from './fontTextSetter';
import { cellPicture, layoutPicture, type PictureText } from './pagePictures';

const style = DEFAULT_DIAGRAM_STYLE;
/** How far a crease pattern's ink reaches past its lines, in mm: the margin the painter's own page leaves it. */
const patternInkMm = (drawn: DiagramStyle) =>
  pageMarginPt(diagramScenePaintStyle(drawn, 'pattern'), { ...DEFAULT_PAPER_PAGE, paddingMm: 0 }) / PT_PER_MM;
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
  it('measures a capture by its paper scale, and what has none by its frame’s longer side', () => {
    // The fixture's sheet is 100 scene px at 100 px per unit: one unit; its ink half its widest pen past it.
    const none = { width: 0, height: 0 };
    const nowhere = { grows: 0, beyond: 0 };
    const sides = { left: nowhere, right: nowhere, top: nowhere, bottom: nowhere };
    const ink = patternInkMm(style);
    const pattern = layoutPicture(cpStep('step-cp'), {}, style)!;
    expect(pattern).toMatchObject({ kind: 'paper', width: 1, height: 1, frame: { width: 1, height: 1 } });
    expect(pattern.marks.width).toBeCloseTo(2 * ink, 9);
    expect(pattern.marks.height).toBeCloseTo(2 * ink, 9);
    for (const side of Object.values(pattern.sides!)) {
      expect(side.grows).toBeCloseTo(0, 9);
      expect(side.beyond).toBeCloseTo(ink, 9);
    }
    // 300 × 200 px at 100 px per unit.
    expect(layoutPicture(bitmapStep(100), assets, style)).toEqual({ kind: 'paper', width: 3, height: 2, frame: { width: 3, height: 2 }, marks: none, sides });
    const upload = layoutPicture(bitmapStep(null), assets, style)!;
    expect(upload.kind).toBe('fit');
    expect(upload.width).toBeCloseTo(1, 9);
    expect(upload.height).toBeCloseTo(2 / 3, 9);
    const threeD = cpStep('step-3d', undefined, { ...scenePicture(), paperScale: null });
    expect(layoutPicture(threeD, {}, style)).toMatchObject({ kind: 'fit', width: 1, height: 1 });
    expect(layoutPicture({ ...createStep(() => 'step-fixed'), picture: fixedPicture() }, {}, style)).toEqual({
      kind: 'fit',
      width: 1,
      height: 0.5,
      frame: { width: 1, height: 0.5 },
      marks: none,
      sides,
    });
    expect(layoutPicture(createStep(() => 'step-empty'), {}, style)).toBeNull();
  });

  it('measures a References step by its sheet, its letters reaching further on a small one', () => {
    const step = referencesStep('step-sent');
    const atCard = layoutPicture(step, {}, style);
    const small = layoutPicture(step, {}, style, { mmPerUnit: 10 });
    if (atCard?.kind !== 'paper' || small?.kind !== 'paper') throw new Error('paper');
    // A unit sheet in the margin its scene keeps around it, which grows with it: on a card its letters lie within it.
    expect(atCard.frame.width).toBeCloseTo(1, 9);
    expect(atCard.width).toBeCloseTo(1.25, 6);
    expect(atCard.marks.width).toBeCloseTo(0, 9);
    // On a 10 mm sheet a letter, at its pt size, reaches past the margin: the reach measured there is the drawing's.
    if (step.picture?.kind !== 'step-diagram') throw new Error('References');
    const { bounds } = stepDiagramScene(step.picture.model, step.picture.mirrored, style, 10);
    const drawn = (bounds.maxX - bounds.minX) / mmToCssPx(1);
    expect(drawn).toBeGreaterThan(12.5 + 1);
    expect(pictureExtent(small, 10).width).toBeCloseTo(drawn, 6);
  });

  it('measures what an annotation reaches past any picture, one with no paper too', () => {
    const reaching = { ...bitmapStep(null), annotations: [{ id: 'a', kind: 'push-arrow' as const, from: [-0.4, 0.5] as [number, number], to: [0.1, 0.5] as [number, number] }] };
    const atCard = layoutPicture(reaching, assets, style);
    expect(atCard?.kind).toBe('fit');
    // Its tail out to the left of its frame, where it lies: wider by that, whatever the frame's size.
    expect(atCard!.width).toBeCloseTo(1.4, 2);
    expect(atCard!.height).toBeCloseTo(2 / 3, 2);
    expect(layoutPicture(reaching, assets, style, { frameMm: 20 })!.width).toBeCloseTo(atCard!.width, 6);
    // Its outline's pen and its head's width, at their pt size: a few mm.
    expect(atCard!.marks.width).toBeGreaterThan(0);
    expect(atCard!.marks.width).toBeLessThan(6);
    const fixed = { ...createStep(() => 'step-fixed'), picture: fixedPicture(), annotations: reaching.annotations };
    expect(layoutPicture(fixed, {}, style)!.width).toBeCloseTo(1.4, 2);
  });

  it('measures where the reach lies past each edge, which the whole is (third review)', () => {
    // A push's tail out to the left; nothing past the right edge but its pen.
    const reaching = { ...bitmapStep(null), annotations: [{ id: 'a', kind: 'push-arrow' as const, from: [-0.4, 0.5] as [number, number], to: [0.1, 0.5] as [number, number] }] };
    const pushed = layoutPicture(reaching, assets, style)!;
    expect(pushed.sides!.left.grows).toBeCloseTo(0.4, 2);
    expect(pushed.sides!.right).toEqual({ grows: 0, beyond: 0 });
    // A turn-over larger than its paper near the paper's foot: past the top by less as the paper grows, past the
    // bottom too, nearly as much; at the scale measured, the paper and its two sides are the whole.
    const glyph: DiagramStep = {
      ...cpStep('step-glyph'),
      annotations: [{ id: 't', kind: 'turn-over', from: [0.5, 0.95], to: [0.5, 0.95], axis: 'horizontal' }],
    };
    const at = 3;
    const measured = layoutPicture(glyph, {}, style, { mmPerUnit: at })!;
    const { top, bottom } = measured.sides!;
    expect(top.grows).toBeCloseTo(-0.95, 2);
    expect(bottom.grows).toBeCloseTo(-0.05, 2);
    expect(bottom.grows * at + bottom.beyond).toBeGreaterThan(top.grows * at + top.beyond);
    const whole = measured.frame.height * at + top.grows * at + top.beyond + bottom.grows * at + bottom.beyond;
    expect(whole).toBeCloseTo(pictureExtent(measured, at).height, 6);
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
    // A scene's frame is its bounds: the fixture's unit sheet, 30 mm across; its ink half its widest pen past it.
    const scene = cellPicture(cpStep('step-cp'), {}, style, { ...cell, frameMm: 30 }, 'c0-', TEXT)!;
    expect(scene.boundsPt.width).toBeCloseTo((30 + 2 * patternInkMm(style)) * PT_PER_MM, 2);
  });

  it('bounds a References step’s lines’ ink past its sheet, which a small sheet’s band does not hold at a heavy pen (review 4)', () => {
    const heavy: DiagramStyle = { style: { ...DEFAULT_PAPER_STYLE, edges: { ...DEFAULT_PAPER_STYLE.edges, width: PEN_WIDTH_RANGE.max } } };
    // An 8 mm sheet: the band a card keeps round it is 1 mm, half the edge pen 2.1. The markup is to a hundredth of a pt.
    const picture = cellPicture(referencesStep('step-sent'), {}, heavy, { ...cell, frameMm: 8 }, 'c0-', TEXT)!;
    const [, dx = '0', dy = '0'] = /^<g transform="translate\(([-\d.]+) ([-\d.]+)\)">/.exec(picture.markup) ?? [];
    const ink = [...picture.markup.matchAll(/<line [^>]*x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"[^>]*stroke-width="([\d.]+)"/g)];
    expect(ink.length).toBeGreaterThan(3);
    const { x, y, width, height } = picture.boundsPt;
    for (const [, x1, y1, x2, y2, pen] of ink) {
      const half = Number(pen) / 2;
      for (const [lx, ly] of [
        [Number(x1) + Number(dx), Number(y1) + Number(dy)],
        [Number(x2) + Number(dx), Number(y2) + Number(dy)],
      ]) {
        expect(lx! - half).toBeGreaterThanOrEqual(x - 0.01);
        expect(ly! - half).toBeGreaterThanOrEqual(y - 0.01);
        expect(lx! + half).toBeLessThanOrEqual(x + width + 0.01);
        expect(ly! + half).toBeLessThanOrEqual(y + height + 0.01);
      }
    }
  });

  it('keeps a scene’s ink in its room, half its widest pen past its lines, at the heaviest edge pen (review 4)', () => {
    const heavy: DiagramStyle = { style: { ...DEFAULT_PAPER_STYLE, edges: { ...DEFAULT_PAPER_STYLE.edges, width: PEN_WIDTH_RANGE.max } } };
    const document = { ...insertSteps(createDiagram({ title: 'Crane', hanStyle: 'sc' }), [cpStep('step-cp')], 0), style: heavy };
    const laid = layoutDiagram(document, estimateTextSetter).pages[0]!.cells[0]!;
    const picture = cellPicture(document.steps[0] as DiagramStep, {}, heavy, laid, 'c0-', TEXT)!;
    // The sheet as drawn — its face's outline and its lines, where it was moved to settle in its room — and
    // the box the picture says it draws: half the edge pen past them.
    const [, dx = '0', dy = '0'] = /^<g transform="translate\(([-\d.]+) ([-\d.]+)\)">/.exec(picture.markup) ?? [];
    const outline = [...picture.markup.matchAll(/<path d="([^"]*)"/g)].flatMap((match) =>
      [...match[1]!.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((pair) => [Number(pair[1]), Number(pair[2])])
    );
    const lines = [...picture.markup.matchAll(/<line [^>]*x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)].flatMap((match) => [
      [Number(match[1]), Number(match[2])],
      [Number(match[3]), Number(match[4])],
    ]);
    const ends = [...outline, ...lines].map(([lx, ly]) => [lx! + Number(dx), ly! + Number(dy)]);
    expect(outline.length).toBeGreaterThan(3);
    const half = PEN_WIDTH_RANGE.max / 2;
    const { x, y, width, height } = picture.boundsPt;
    expect(x).toBeCloseTo(Math.min(...ends.map(([lx]) => lx!)) - half, 1);
    expect(y).toBeCloseTo(Math.min(...ends.map(([, ly]) => ly!)) - half, 1);
    expect(x + width).toBeCloseTo(Math.max(...ends.map(([lx]) => lx!)) + half, 1);
    expect(y + height).toBeCloseTo(Math.max(...ends.map(([, ly]) => ly!)) + half, 1);
    // All of it in the room the layout drew for it.
    const room = laid.drawMm;
    expect(x).toBeGreaterThanOrEqual(room.x * PT_PER_MM - 1e-6);
    expect(y).toBeGreaterThanOrEqual(room.y * PT_PER_MM - 1e-6);
    expect(x + width).toBeLessThanOrEqual((room.x + room.w) * PT_PER_MM + 1e-6);
    expect(y + height).toBeLessThanOrEqual((room.y + room.h) * PT_PER_MM + 1e-6);
  });

  it('draws a picture centred in the room the layout drew for it, which may be taller than its box', () => {
    const room = { ...cell, mmPerUnit: 5, drawMm: { x: 5, y: 20, w: 50, h: 70 } };
    const picture = cellPicture(bitmapStep(100), assets, style, room, 'c0-', TEXT)!;
    const [, x, y, width, height] = /<svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(picture.markup)!.map(Number);
    // 3 × 2 units at 5 mm, centred in 50 × 70 mm.
    expect(width).toBeCloseTo(15 * PT_PER_MM, 2);
    expect(height).toBeCloseTo(10 * PT_PER_MM, 2);
    expect(x! + width! / 2).toBeCloseTo(30 * PT_PER_MM, 2);
    expect(y! + height! / 2).toBeCloseTo(55 * PT_PER_MM, 2);
    // A fitted picture fills the room's narrower side.
    const fitted = cellPicture(bitmapStep(null), assets, style, { ...cell, drawMm: { x: 5, y: 20, w: 30, h: 70 } }, 'c0-', TEXT)!;
    expect(fitted.boundsPt.width).toBeCloseTo(30 * PT_PER_MM, 2);
  });

  it('draws nothing past its room, and no number that is not one, in a room of no size', () => {
    for (const step of [bitmapStep(null), cpStep('step-cp'), { ...createStep(() => 'step-fixed'), picture: fixedPicture() }]) {
      const empty = { pictureMm: { x: 10, y: 20, size: 0 }, mmPerUnit: null, frameMm: 0, drawMm: { x: 10, y: 20, w: 40, h: 0 } };
      const picture = cellPicture(step, assets, style, empty, 'c0-', TEXT);
      expect(picture?.markup ?? '').not.toContain('NaN');
      for (const value of Object.values(picture?.boundsPt ?? {})) expect(Number.isFinite(value)).toBe(true);
    }
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
      const reach = layoutPicture(step, assets, style, { mmPerUnit: 5 })!;
      const bare = layoutPicture(bitmapStep(100), assets, style, { mmPerUnit: 5 })!;
      // The push out to its left: the picture with its marks is wider than the picture by more than its tail.
      expect(pictureExtent(reach, 5).width).toBeGreaterThan(pictureExtent(bare, 5).width * 1.3);
      const plain = cellPicture(bitmapStep(100), assets, style, { ...cell, mmPerUnit: 5 }, 'c0-', TEXT)!;
      const picture = cellPicture(step, assets, style, { ...cell, mmPerUnit: 5 }, 'c0-', TEXT)!;
      const width = (markup: string) => Number(/ width="([\d.]+)"/.exec(markup)![1]);
      expect(width(picture.markup)).toBeCloseTo(width(plain.markup), 2);
    });

    it('draws a picture at the cell’s frame whatever its annotations reach, when the layout left them room', () => {
      const frameMm = 20;
      // The room the layout leaves: the picture and its marks, measured at that frame, fit the box.
      const measured = layoutPicture(annotated(bitmapStep(null)), assets, style, { frameMm })!;
      expect(Math.max(measured.width, measured.height) * frameMm).toBeLessThan(40);
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

    it('keeps the frame the layout found, and the paper in its room when its marks are more than it holds', () => {
      const plain = cellPicture(bitmapStep(null), assets, style, { ...cell, frameMm: 40 }, 'c0-', TEXT)!;
      const picture = cellPicture(annotated(bitmapStep(null)), assets, style, { ...cell, frameMm: 40 }, 'c0-', TEXT)!;
      const svg = (markup: string) => /<svg x="([\d.-]+)" y="[\d.-]+" width="([\d.]+)"/.exec(markup)!.slice(1).map(Number);
      const [, width] = svg(plain.markup);
      expect(svg(picture.markup)[1]).toBeCloseTo(width!, 2);
      // The marks reach out of the 40 mm box; the paper, moved with them, stays in it.
      expect(picture.boundsPt.width).toBeGreaterThan(40 * PT_PER_MM);
      const shift = /translate\(([-\d.]+) /.exec(picture.markup);
      const left = svg(picture.markup)[0]! + (shift ? Number(shift[1]) : 0);
      expect(left).toBeGreaterThanOrEqual(10 * PT_PER_MM - 0.01);
      expect(left + width!).toBeLessThanOrEqual(50 * PT_PER_MM + 0.01);
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

    describe('a close-up (15f)', () => {
      const zoom = {
        id: 'z',
        kind: 'close-up' as const,
        from: [0.5, 0.5] as [number, number],
        to: [1.25, 0.5] as [number, number],
        radius: 0.1,
        scale: 2,
      };

      it('paints the picture again inside it, twice as large, clipped to its ring, its ids its own', () => {
        const picture = cellPicture({ ...bitmapStep(null), annotations: [zoom] }, assets, style, cell, 'c0-', TEXT)!;
        const widths = [...picture.markup.matchAll(/<svg x="[\d.-]+" y="[\d.-]+" width="([\d.]+)"/g)].map(([, width]) => Number(width));
        expect(widths).toHaveLength(2);
        expect(widths[1]).toBeCloseTo(2 * widths[0]!, 2);
        expect(picture.markup).toContain('<clipPath id="c0-annotation-close-up-0">');
        expect(picture.markup).toContain('clip-path="url(#c0-annotation-close-up-0)"');
        // What the cell draws, and a file is cropped to, reaches as far as the close-up's ring beside the picture.
        expect(picture.boundsPt.width).toBeGreaterThan(1.4 * widths[0]!);
      });

      it('counts the letters a References step sets inside it, in the page’s font', () => {
        const step = { ...referencesStep('step-sent'), annotations: [zoom] };
        const picture = cellPicture(step, {}, style, { ...cell, mmPerUnit: 20 }, 'c1-', TEXT)!;
        expect(picture.markup.match(/font-family="'Noto Sans', sans-serif"/g)).toHaveLength(2);
        expect(picture.text).toEqual([{ face: 'latin-700', characters: 'AA' }]);
      });
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
