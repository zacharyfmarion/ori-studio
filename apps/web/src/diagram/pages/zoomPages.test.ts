import { beforeAll, describe, expect, it } from 'vitest';
import { PT_PER_MM } from '../../lib/paper/paperSvg';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import {
  createDiagram,
  createStep,
  createTurn,
  DEFAULT_DIAGRAM_STYLE,
  insertSteps,
  setPageSetup,
  stepsOf,
  type DiagramDocument,
  type DiagramStep,
  type DiagramStepZoom,
  type DiagramStyle,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { FIXTURE_FONTS, fixtureSubsetter } from '../fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../fonts/fontSubset';
import { partBox } from './pagePlacement';
import { PICTURE_TOP_MM } from './diagramPageLayout';
import { diagramLayoutSteps, enlargeArrowCount, preparedPages } from './diagramPages';
import { estimateTextSetter } from './estimateTextSetter';
import { cellPicture, layoutPicture, type CellPicture } from './pagePictures';
import { placedZoomArrows } from './zoomArrows';
import { enlargeArrowMm, paintEnlargeArrow, tallestEnlargeArrowMm } from '../zoom/enlargeArrow';

/**
 * Enlarged steps on the pages (Revision 2, 16f), from the document: the
 * arrow read from the order, the window laid out by what it prints, the
 * arrow lifted to its area, and every id on a page its own.
 */

let subsetter: FontSubsetter;
beforeAll(async () => {
  subsetter = await fixtureSubsetter();
});

const text = { hanStyle: 'sc' as const, runs: estimateTextSetter.runs };

const circleArea = (id: string, centre: [number, number], radius: number): KnownDiagramAnnotation => ({
  id,
  kind: 'zoom',
  from: centre,
  to: [centre[0], centre[1]],
  radius,
});

function withAreas(id: string, areas: KnownDiagramAnnotation[]): DiagramStep {
  const step = cpStep(id);
  return { ...step, annotations: areas, annotatedPictureKey: step.picture!.key };
}

function enlargedStep(id: string, zoom: DiagramStepZoom): DiagramStep {
  const step = cpStep(id);
  return { ...step, zoom, annotatedPictureKey: step.picture!.key };
}

/** The sheet's right edge in a circle: paper only in its left half. */
const AT_EDGE: DiagramStepZoom = { from: 'area-1', shape: 'circle', frame: { centre: [1, 0.5], radius: 0.3 } };

describe('the enlarge arrow, read from the order (Revision 2)', () => {
  it('leaves the area an enlarged step was captured from, else the first, after a step with areas, turns passed; none after one without', () => {
    const a = circleArea('area-a', [0.3, 0.3], 0.1);
    const b = circleArea('area-b', [0.6, 0.6], 0.2);
    const c = circleArea('area-c', [0.4, 0.5], 0.15);
    const document = insertSteps(
      createDiagram({ title: 'Crane' }),
      [
        withAreas('step-0', [a, b]),
        createTurn({ kind: 'turn-over', axis: 'vertical' }, () => 'turn-1'),
        enlargedStep('step-1', { ...AT_EDGE, from: 'area-b' }),
        withAreas('step-2', [c]),
        enlargedStep('step-3', { ...AT_EDGE, from: 'area-elsewhere' }),
        cpStep('step-4'),
        enlargedStep('step-5', { ...AT_EDGE, from: 'area-a' }),
      ],
      0
    );
    const box = enlargeArrowMm(document.style);
    const sizes = { box, aimedBox: expect.any(Function), tallest: tallestEnlargeArrowMm(document.style) };
    const zoom = new Map(diagramLayoutSteps(document).map((step) => [step.id, step.zoom]));
    expect(zoom.get('step-1')?.arrowFrom).toEqual({ stepId: 'step-0', areaId: 'area-b', share: expect.closeTo(0.4, 12), ...sizes });
    expect(zoom.get('step-3')?.arrowFrom).toEqual({ stepId: 'step-2', areaId: 'area-c', share: expect.closeTo(0.3, 12), ...sizes });
    expect(zoom.get('step-5')?.arrowFrom).toBeNull();
    expect(zoom.get('step-4')).toBeUndefined();
    // Its frame and window against its whole picture, which knows its paper.
    expect(zoom.get('step-1')).toMatchObject({ frameShare: expect.closeTo(0.6, 12), windowShare: expect.closeTo(0.6, 12), scale: null });
    expect(zoom.get('step-1')?.whole.kind).toBe('paper');
  });

  it('marks an enlarged step with no picture yet as waiting for its window, with no arrow before it, and counts the arrows the pages print', () => {
    const area = circleArea('area-1', [0.5, 0.4], 0.15);
    // Seeded by Insert Step After: enlarged, the source's frame copied, no picture.
    const seeded: DiagramStep = { ...createStep(() => 'step-seeded'), zoom: { from: 'area-1', shape: 'circle', frame: AT_EDGE.frame } };
    const document = insertSteps(createDiagram({ title: 'Crane' }), [withAreas('step-area', [area]), seeded, cpStep('step-plain')], 0);
    const [, laidOut, plain] = diagramLayoutSteps(document);
    expect(laidOut).toMatchObject({ id: 'step-seeded', picture: null, zoomPending: true });
    expect(laidOut!.zoom).toBeUndefined();
    expect(plain!.zoomPending).toBeUndefined();
    // No arrow prints before it, so none is counted for the step files' notice.
    expect(enlargeArrowCount(document)).toBe(0);
    expect(enlargeArrowCount(areaThenEnlarged())).toBe(1);
  });

  it('gives the arrow the box it prints in, in the diagram’s own style', () => {
    const heavy: DiagramStyle = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, width: 3 } } };
    const document = { ...areaThenEnlarged(), style: heavy };
    const [, enlarged] = diagramLayoutSteps(document);
    expect(enlarged!.zoom!.arrowFrom!.box).toEqual(enlargeArrowMm(heavy));
    expect(enlarged!.zoom!.arrowFrom!.box.w).toBeGreaterThan(enlargeArrowMm(DEFAULT_DIAGRAM_STYLE).w);
  });
});

describe('an enlarged step’s window on a page', () => {
  it('is laid out by what it prints: a cut frame its paper and boundary, a whole one its window', () => {
    const cut = layoutPicture(enlargedStep('step-cut', AT_EDGE), {}, { ...createDiagram().style }, { frameMm: 60 })!;
    expect(cut.kind).toBe('zoom');
    // The window is one unit square; the paper only in its left half, the arcs running on a little past it.
    expect(cut.frame.height).toBeCloseTo(1, 2);
    expect(cut.frame.width).toBeGreaterThan(0.5);
    expect(cut.frame.width).toBeLessThan(0.7);
    const whole = layoutPicture(enlargedStep('step-whole', { ...AT_EDGE, edge: 'whole' }), {}, createDiagram().style, { frameMm: 60 })!;
    expect(whole.kind).toBe('zoom');
    expect(whole.frame).toEqual({ width: expect.closeTo(1, 9), height: expect.closeTo(1, 9) });
  });

  it('centres what it prints in its room, the window’s empty part past it', () => {
    const cell = { pictureMm: { x: 10, y: 20, size: 60 }, drawMm: { x: 10, y: 20, w: 60, h: 60 }, mmPerUnit: null, frameMm: 60 };
    const picture = cellPicture(enlargedStep('step-cut', AT_EDGE), {}, createDiagram().style, cell, 'c0-', text)!;
    const middle = (box: CellPicture['boundsPt']) => (box.x + box.width / 2) / PT_PER_MM;
    expect(middle(picture.boundsPt)).toBeCloseTo(40, 1);
    // The window is the frame its marks are drawn on: 60 mm, hanging past the room on the right.
    expect(picture.framePt.width / PT_PER_MM).toBeCloseTo(60, 6);
    expect((picture.framePt.x + picture.framePt.width) / PT_PER_MM).toBeGreaterThan(80);
    expect(picture.boundsPt.width).toBeLessThan(picture.framePt.width * 0.75);
  });
});

describe('an enlarged step’s marks on a page (Zach, 2026-10-07)', () => {
  const line = (id: string, from: [number, number], to: [number, number]): KnownDiagramAnnotation => ({ id, kind: 'valley-line', from, to });
  const withMarks = (marks: KnownDiagramAnnotation[]) => ({ ...enlargedStep('step-cut', AT_EDGE), annotations: marks });
  // On the paper, in the window's left half.
  const inside = line('inside', [0.1, 0.5], [0.4, 0.5]);
  // Duplicate Step's copy of a long crease, from the paper down eight windows; and a mark a window off it.
  const copied = [inside, line('long', [0.3, 0.4], [0.3, 8]), line('beside', [-0.8, 0.5], [-0.4, 0.5])];

  it('is measured by what lies inside its window: a mark reaching out of it, or lying off it, sizes nothing', () => {
    const style = createDiagram().style;
    const measured = (marks: KnownDiagramAnnotation[]) => layoutPicture(withMarks(marks), {}, style, { frameMm: 60 })!;
    expect(measured(copied)).toEqual(measured([inside]));
    // Marks only off it: laid out by its content box, as with none.
    expect(measured(copied.slice(2))).toEqual(measured([]));
    expect(measured(copied.slice(2)).frame.width).toBeLessThan(0.7);
  });

  it('is kept in its room by what lies inside its window, the marks past it drawn whole, overflowing', () => {
    const cell = { pictureMm: { x: 10, y: 20, size: 60 }, drawMm: { x: 10, y: 20, w: 60, h: 60 }, mmPerUnit: null, frameMm: 60 };
    const drawn = (marks: KnownDiagramAnnotation[]) => cellPicture(withMarks(marks), {}, createDiagram().style, cell, 'c0-', text)!;
    const [alone, withCopied] = [drawn([inside]), drawn(copied)];
    expect(withCopied.boundsPt).toEqual(alone.boundsPt);
    expect(withCopied.framePt).toEqual(alone.framePt);
    // Drawn all the same: two more creases.
    const creases = (markup: string) => (markup.match(/stroke-dasharray/g) ?? []).length;
    expect(creases(withCopied.markup)).toBeGreaterThan(creases(alone.markup));
  });
});

/** A diagram of an area on step 1 and the step enlarged from it beside it, on a flow row read left to right. */
function areaThenEnlarged(area = circleArea('area-1', [0.5, 0.4], 0.15)): DiagramDocument {
  return insertSteps(
    createDiagram({ title: 'Crane' }),
    [withAreas('step-area', [area]), enlargedStep('step-zoom', { from: 'area-1', shape: 'circle', frame: { centre: [0.5, 0.4], radius: 0.15 } })],
    0
  );
}

describe('the enlarge arrow on a page', () => {
  it('is lifted to the area’s printed height, alone beside it, and printed there', () => {
    const document = areaThenEnlarged();
    const pages = preparedPages(document, FIXTURE_FONTS, subsetter);
    const page = pages.layout.pages[0]!;
    expect(page.zoomArrows).toHaveLength(1);
    expect(page.zoomArrows[0]!.liftable).toBe(true);
    const steps = new Map(stepsOf(document).map((step) => [step.id, step]));
    const area = cellPicture(steps.get('step-area')!, document.assets, document.style, page.cells[0]!, 'c0-', text)!;
    const centre = (area.framePt.y + 0.4 * Math.max(area.framePt.width, area.framePt.height)) / PT_PER_MM;
    const [lifted] = pages.zoomArrows(0);
    expect(lifted!.at.x).toBe(page.zoomArrows[0]!.at.x);
    expect(lifted!.at.y).toBeCloseTo(centre, 6);
    expect(lifted!.at.y).not.toBeCloseTo(page.zoomArrows[0]!.at.y, 1);
    // The page prints the arrow there, its box centred on the place, pointing on: nothing reads right to left.
    const svg = pages.compose(0).svg;
    const arrow = paintEnlargeArrow({ x: lifted!.at.x * PT_PER_MM, y: lifted!.at.y * PT_PER_MM }, PT_PER_MM, document.style, {
      id: 'enlarge-arrow-0',
    })!;
    expect(svg).toContain(arrow.markup);
    expect(svg).not.toContain('matrix(-1 0 0 1');
  });

  it('keeps its box in both grid pictures’ overlap, below both steps’ numbers', () => {
    const document = setPageSetup(areaThenEnlarged(circleArea('area-1', [0.5, 0.02], 0.02)), { layout: 'grid' });
    const pages = preparedPages(document, FIXTURE_FONTS, subsetter);
    const page = pages.layout.pages[0]!;
    const steps = new Map(stepsOf(document).map((step) => [step.id, step]));
    const [lifted] = pages.zoomArrows(0);
    // An area at its picture's top: the box's top where both pictures and the numbers allow.
    const tops = page.cells.map(
      (cell, index) => cellPicture(steps.get(cell.stepId)!, document.assets, document.style, cell, `c${index}-`, text)!.boundsPt.y / PT_PER_MM
    );
    const numbers = Math.max(...page.cells.map(cell => cell.flowRow === undefined ? cell.cellMm.y + PICTURE_TOP_MM : partBox(cell, 'number').y + partBox(cell, 'number').h));
    expect(lifted!.at.y - lifted!.box.h / 2).toBeCloseTo(Math.max(numbers, ...tops), 6);
    // Pictures reaching up to the numbers: the box's top below them.
    const drawn = (top: number, bottom: number): CellPicture => ({
      markup: '',
      text: [],
      boundsPt: { x: 0, y: top * PT_PER_MM, width: 10, height: (bottom - top) * PT_PER_MM },
      framePt: { x: 0, y: top * PT_PER_MM, width: (bottom - top) * PT_PER_MM, height: (bottom - top) * PT_PER_MM },
    });
    const top = page.cells[0]!.cellMm.y;
    const [under] = placedZoomArrows(page, steps, () => drawn(top, top + 60));
    expect(under!.at.y - under!.box.h / 2).toBeCloseTo(numbers, 6);
    // And an area at the foot of its picture: no lower than the pictures' overlap.
    const low = new Map(steps);
    low.set('step-area', { ...steps.get('step-area')!, annotations: [circleArea('area-1', [0.5, 1], 0.02)] });
    const [placed] = placedZoomArrows(page, low, (index) => (index === 0 ? drawn(40, 80) : drawn(45, 70)));
    expect(placed!.at.y + placed!.box.h / 2).toBeCloseTo(70, 6);
  });

  it('is not lifted beside a turn, and leads on mirrored in a row read right to left', () => {
    const document = areaThenEnlarged();
    const turned = insertSteps(document, [createTurn({ kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } })], 1);
    const pages = preparedPages(turned, FIXTURE_FONTS, subsetter);
    expect(pages.layout.pages[0]!.zoomArrows[0]!.liftable).toBe(false);
    expect(pages.zoomArrows(0)).toEqual(pages.layout.pages[0]!.zoomArrows);
    // Two to a row: the second row reads right to left.
    const rows = insertSteps(
      { ...areaThenEnlarged(), page: { ...document.page, layout: 'flow', stepsPerPage: 6 } },
      [cpStep('step-a'), cpStep('step-b')],
      0
    );
    const flowPages = preparedPages(rows, FIXTURE_FONTS, subsetter);
    const [arrow] = flowPages.layout.pages[0]!.zoomArrows;
    expect(arrow!.rightToLeft).toBe(true);
    const mirrors = [...flowPages.compose(0).svg.matchAll(/<g transform="matrix\(-1 0 0 1 ([\d.]+) 0\)">/g)].map((m) => Number(m[1]));
    expect(mirrors).toHaveLength(1);
    // Mirrored about its frame's middle, which is not its box's: the bow up, the head on the left.
    expect(mirrors[0]! / PT_PER_MM / 2).toBeCloseTo(flowPages.zoomArrows(0)[0]!.at.x, 0);
  });

  it('prints across a flow row’s end aimed at the enlarged step, as the layout aims it', () => {
    // The area's step ends the first row; the enlarged step starts the second, under it.
    const document = insertSteps(
      { ...areaThenEnlarged(), page: { ...createDiagram().page, layout: 'flow', stepsPerPage: 6 } },
      [cpStep('step-a')],
      0
    );
    const pages = preparedPages(document, FIXTURE_FONTS, subsetter);
    const [arrow] = pages.zoomArrows(0);
    expect(arrow!.aim).not.toBeNull();
    expect(Math.sin(arrow!.aim!.angle)).toBeGreaterThan(0.5);
    const svg = pages.compose(0).svg;
    const aimed = paintEnlargeArrow({ x: arrow!.at.x * PT_PER_MM, y: arrow!.at.y * PT_PER_MM }, PT_PER_MM, document.style, {
      aim: arrow!.aim,
      id: 'enlarge-arrow-0',
    })!;
    expect(svg).toContain(aimed.markup);
    // Turned, not mirrored the next row's way.
    expect(svg).not.toContain('matrix(-1 0 0 1');
  });

  it('gives every id on a page once, two windows of one picture and their clips included', () => {
    const document = insertSteps(
      areaThenEnlarged(),
      [enlargedStep('step-zoom-2', { from: 'area-1', shape: 'rounded', frame: { centre: [0.5, 0.4], size: [0.3, 0.2], angle: 30 } })],
      2
    );
    const svg = preparedPages(document, FIXTURE_FONTS, subsetter).compose(0).svg;
    const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]);
    expect(ids.filter((id) => id!.endsWith('zoom-clip'))).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, reference] of svg.matchAll(/(?:href="#|url\(#)([^")]*)/g)) expect(ids).toContain(reference);
  });
});
