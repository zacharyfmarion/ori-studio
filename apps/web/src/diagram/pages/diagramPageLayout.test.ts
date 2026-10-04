import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SETUP, type DiagramPageSetup } from '../document/diagramDocument';
import {
  FIT_SHARED_REACH,
  layoutDiagramPages,
  STEP_TEXT_LEADING_MM,
  TURN_GUTTER_MM,
  TURN_STACK_CLEAR_MM,
  turnGlyphMm,
  type LayoutStep,
  type LayoutTurn,
} from './diagramPageLayout';
import { readFontMetrics, type FontMetrics } from '../fonts/fontMetrics';
import { estimateTextSetter } from './estimateTextSetter';
import { fontTextSetter } from './fontTextSetter';
import { printPaper } from './printPaper';

const SHORT = 'Fold in half.';
const LONG =
  'Fold the bottom edge up to the top edge, crease firmly, unfold, then fold both sides in to meet the centre line and turn the model over carefully.';

function step(index: number, patch: Partial<LayoutStep> = {}): LayoutStep {
  return {
    id: `step-${index}`,
    text: SHORT,
    breakBefore: false,
    picture: { kind: 'paper', extentUnits: 400, reach: 1 },
    turnsBefore: [],
    turnsAfter: [],
    ...patch,
  };
}

const steps = (count: number, patch: (index: number) => Partial<LayoutStep> = () => ({})) =>
  Array.from({ length: count }, (_, index) => step(index, patch(index)));

function layout(list: LayoutStep[], setup: Partial<DiagramPageSetup> = {}, title = 'Crane') {
  return layoutDiagramPages(list, { ...DEFAULT_PAGE_SETUP, ...setup }, title, estimateTextSetter);
}

describe('printPaper', () => {
  it('turns the sheet for landscape, B5 being the JIS size', () => {
    expect(printPaper({ size: 'a4', orientation: 'landscape', marginMm: 12 })).toEqual({
      widthMm: 297,
      heightMm: 210,
      marginMm: 12,
    });
    expect(printPaper({ size: 'b5-jis', orientation: 'portrait', marginMm: 0 })).toMatchObject({ widthMm: 182, heightMm: 257 });
  });
});

describe('layoutDiagramPages', () => {
  it('puts every step in exactly one cell, in order, across pages, and no text below its cell', () => {
    const sizes: DiagramPageSetup['size'][] = ['a4', 'a5', 'b5-jis', 'letter'];
    for (const size of sizes) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        for (const layoutKind of ['grid', 'flow'] as const) {
          for (const [columns, rows] of [[2, 1], [3, 3], [5, 6]] as const) {
            const list = steps(23, (index) => ({ text: index % 3 ? SHORT : LONG }));
            const result = layout(list, { size, orientation, layout: layoutKind, columns, rows });
            const placed = result.pages.flatMap((page) => page.cells.map((cell) => cell.stepId));
            expect(placed).toEqual(list.map((s) => s.id));
            for (const page of result.pages) {
              for (const cell of page.cells) {
                const lastBaseline = cell.text.firstBaseline + (cell.text.lines.length - 1) * STEP_TEXT_LEADING_MM;
                if (cell.text.lines.length > 0) expect(lastBaseline).toBeLessThanOrEqual(cell.cellMm.y + cell.cellMm.h + 1e-9);
                // The picture box is inside the cell, under the number.
                expect(cell.pictureMm.x).toBeGreaterThanOrEqual(cell.cellMm.x - 1e-9);
                expect(cell.pictureMm.x + cell.pictureMm.size).toBeLessThanOrEqual(cell.cellMm.x + cell.cellMm.w + 1e-9);
                expect(cell.pictureMm.y).toBeGreaterThan(cell.numberAt.y);
                // Every line fits its slot.
                for (const line of cell.text.lines) expect(line.widthMm).toBeLessThanOrEqual(cell.text.widthMm + 1e-9);
              }
            }
          }
        }
      }
    }
  });

  it('keeps every line inside its slot with the fonts’ own advances too', () => {
    const read = (path: string) => readFontMetrics(readFileSync(resolve(process.cwd(), 'src/diagram/fonts', path)));
    const fonts: Partial<Record<string, FontMetrics>> = {
      'latin-400': read('NotoSans-Regular.ttf'),
      'latin-700': read('NotoSans-Bold.ttf'),
      'sc-400': read('fixtures/NotoSansSC-Regular.fixture.ttf'),
    };
    const setter = fontTextSetter((key, weight) => fonts[`${key}-${weight}`] ?? null, 'sc');
    const CJK = '将底角向上折至顶角，压实折痕后展开。将底角向上折至顶角，压实折痕后展开。';
    for (const [columns, rows] of [[2, 1], [3, 3], [5, 6]] as const) {
      const list = steps(12, (index) => ({ text: [SHORT, LONG, CJK][index % 3]! }));
      const result = layoutDiagramPages(list, { ...DEFAULT_PAGE_SETUP, columns, rows }, 'Crane', setter);
      for (const cell of result.pages.flatMap((page) => page.cells)) {
        for (const line of cell.text.lines) expect(line.widthMm).toBeLessThanOrEqual(cell.text.widthMm + 1e-9);
        const last = cell.text.firstBaseline + (cell.text.lines.length - 1) * STEP_TEXT_LEADING_MM;
        if (cell.text.lines.length > 0) expect(last).toBeLessThanOrEqual(cell.cellMm.y + cell.cellMm.h + 1e-9);
      }
    }
  });

  it('starts a new page at a step that asks for one', () => {
    const list = steps(5, (index) => ({ breakBefore: index === 2 }));
    const result = layout(list);
    expect(result.pages.map((page) => page.cells.map((cell) => cell.number))).toEqual([[1, 2], [3, 4, 5]]);
    // A break on a page's first step is no extra page.
    expect(layout(steps(2, (index) => ({ breakBefore: index === 0 }))).pages).toHaveLength(1);
  });

  it('draws every paper picture at one scale: the largest at which the biggest fits', () => {
    const list = [
      step(0, { picture: { kind: 'paper', extentUnits: 400, reach: 1 } }),
      step(1, { picture: { kind: 'paper', extentUnits: 200, reach: 1 } }),
    ];
    const result = layout(list, { scale: 'paper' });
    const [first, second] = result.pages[0]!.cells;
    expect(result.mmPerUnit).toBeCloseTo(first!.pictureMm.size / 400, 9);
    // The smaller model is drawn smaller: one scale, not two fits.
    expect(second!.mmPerUnit).toBe(result.mmPerUnit);
    expect(result.frameMm).toBeNull();
    expect(second!.frameMm).toBeNull();
    expect(layout(list, { scale: 'fit' }).mmPerUnit).toBeNull();
    // Uploads are fitted whatever the scale.
    const upload = layout([step(0, { picture: { kind: 'fit', reach: 1 } })], { scale: 'paper' }).pages[0]!.cells[0]!;
    expect(upload.mmPerUnit).toBeNull();
    expect(upload.frameMm).toBeNull();
  });

  it('fits each picture by default, and draws every one’s frame at one size, room left for the furthest marks', () => {
    const fit = (reach: number, kind: 'paper' | 'fit' = 'paper'): LayoutStep['picture'] =>
      kind === 'paper' ? { kind, extentUnits: 400 * reach, reach } : { kind, reach };
    const list = [step(0, { picture: fit(1) }), step(1, { picture: fit(1.08) }), step(2, { picture: fit(1, 'fit') })];
    const result = layout(list);
    expect(DEFAULT_PAGE_SETUP.scale).toBe('fit');
    const cells = result.pages[0]!.cells;
    const box = cells[0]!.pictureMm.size;
    // One size for all three — an upload's too — the largest that leaves the reaching one room.
    expect(result.frameMm).toBeCloseTo(box / 1.08, 9);
    for (const cell of cells) {
      expect(cell.frameMm).toBe(result.frameMm);
      expect(cell.mmPerUnit).toBeNull();
      expect(cell.scaleReduced).toBe(false);
    }
    // Without the reaching step, each fills its box.
    expect(layout([list[0]!, list[2]!]).frameMm).toBeCloseTo(box, 9);
  });

  it('draws a picture whose marks reach too far, or whose box gave room to text, smaller alone', () => {
    const list = [
      step(0, { picture: { kind: 'fit', reach: 1.05 } }),
      step(1, { picture: { kind: 'fit', reach: 2 } }),
      step(2, { picture: { kind: 'fit', reach: 1 }, text: `${LONG} ${LONG} ${LONG} ${LONG}` }),
    ];
    const result = layout(list);
    const [first, far, long] = result.pages[0]!.cells;
    // The far one has no say in the others' size: only a reach within the share is given room by all.
    expect(2).toBeGreaterThan(FIT_SHARED_REACH);
    expect(result.frameMm).toBeCloseTo(first!.pictureMm.size / 1.05, 9);
    expect(first!.frameMm).toBe(result.frameMm);
    expect(first!.scaleReduced).toBe(false);
    expect(far!.frameMm).toBeCloseTo(far!.pictureMm.size / 2, 9);
    expect(far!.scaleReduced).toBe(true);
    expect(long!.frameMm).toBeCloseTo(long!.pictureMm.size, 9);
    expect(long!.frameMm!).toBeLessThan(result.frameMm!);
    expect(long!.scaleReduced).toBe(true);
  });

  it('gives a long instruction room from its picture, to half of it, then cuts it with "…"', () => {
    const fits = layout([step(0)]).pages[0]!.cells[0]!;
    const longer = layout([step(0, { text: LONG })]).pages[0]!.cells[0]!;
    expect(longer.pictureMm.size).toBeLessThan(fits.pictureMm.size);
    expect(longer.pictureMm.size).toBeGreaterThanOrEqual(fits.pictureMm.size * 0.5 - 1e-9);
    expect(longer.textOverflow).toBe(false);
    const endless = layout([step(0, { text: `${LONG} ${LONG} ${LONG} ${LONG}` })]).pages[0]!.cells[0]!;
    expect(endless.pictureMm.size).toBeCloseTo(fits.pictureMm.size * 0.5, 9);
    expect(endless.textOverflow).toBe(true);
    expect(endless.text.lines.at(-1)?.ellipsis).toBe(true);
    // Its picture is drawn smaller than the shared scale, alone.
    expect(endless.scaleReduced).toBe(true);
  });

  it('gives a short instruction its lines in a cell too small for them, and none it does not need', () => {
    // A4 landscape, six rows: at the full box the first baseline is below the
    // slot by more than a leading — the instruction must still be printed.
    const cell = layout([step(0)], { orientation: 'landscape', rows: 6 }).pages[0]!.cells[0]!;
    expect(cell.text.lines.map((line) => line.text)).toEqual([SHORT]);
    expect(cell.textOverflow).toBe(false);
    // Three to a row, every setup prints a short instruction whole; and no
    // setup leaves a cell with no text at all, even five to a row.
    for (const size of ['a4', 'a5', 'b5-jis', 'letter'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        for (const layoutKind of ['grid', 'flow'] as const) {
          for (const rows of [1, 3, 6]) {
            const where = `${size} ${orientation} ${layoutKind} ${rows}`;
            const setup = { size, orientation, layout: layoutKind, rows };
            for (const placed of layout(steps(6), { ...setup, columns: 3 }).pages.flatMap((page) => page.cells)) {
              expect(placed.text.lines.map((line) => line.text).join(' '), where).toBe(SHORT);
              expect(placed.textOverflow, where).toBe(false);
            }
            for (const placed of layout(steps(6), { ...setup, columns: 5 }).pages.flatMap((page) => page.cells)) {
              expect(placed.text.lines.length, where).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  it('runs every other row right to left in flow, with a band that leaves the page where the sequence goes on', () => {
    const result = layout(steps(10), { layout: 'flow', columns: 3, rows: 2 });
    const [first] = result.pages;
    const rowTwo = first!.cells.slice(3, 6).map((cell) => cell.cellMm.x);
    expect(rowTwo).toEqual([...rowTwo].sort((a, b) => b - a));
    expect(first!.band?.at(-1)).toMatchObject({ x: -10 });
    expect(result.pages[1]!.band?.[0]).toMatchObject({ x: -10 });
    expect(layout(steps(3), { layout: 'flow', showPath: false }).pages[0]!.band).toBeNull();
  });

  it('numbers pages from the first number, odd ones on the right', () => {
    const result = layout(steps(12), { pageNumbers: { enabled: true, first: 4 } });
    expect(result.pages.map((page) => [page.number, page.pageNumberAt?.anchor])).toEqual([
      [4, 'start'],
      [5, 'end'],
    ]);
    expect(layout(steps(1), { pageNumbers: { enabled: false, first: 1 } }).pages[0]!.pageNumberAt).toBeNull();
  });

  it('cuts a title too long for the page with "…", inside its tab', () => {
    const long = 'Traditional Crane, folded from one fifteen centimetre square with a colour change on both wings';
    const result = layout(steps(1), { size: 'a5' }, long);
    const { tab, line, textAt, rule } = result.title!;
    expect(line.ellipsis).toBe(true);
    expect(tab.x + tab.w).toBeLessThanOrEqual(result.paper.widthMm - result.paper.marginMm + 1e-9);
    expect(textAt.x + line.widthMm).toBeLessThanOrEqual(tab.x + tab.w + 1e-9);
    expect(rule.x2).toBeGreaterThanOrEqual(rule.x1);
  });

  it('sizes the title tab to the title, and has no header without one', () => {
    const titled = layout(steps(1), {}, 'Crane');
    expect(titled.title?.tab.w).toBeCloseTo(titled.title!.line.widthMm + 8, 9);
    expect(layout(steps(1), {}, '   ').title).toBeNull();
    expect(layout(steps(1), { showTitle: false }).title).toBeNull();
    // Without the header the cells start at the margin.
    expect(layout(steps(1), { showTitle: false }).pages[0]!.cells[0]!.cellMm.y).toBe(DEFAULT_PAGE_SETUP.marginMm);
  });

  it('runs the title tab and rule on past the paper’s edge on a page with no margin, for a print shop’s bleed', () => {
    const edge = layout(steps(1), { marginMm: 0 }, 'Crane');
    const { tab, textAt, rule } = edge.title!;
    expect(tab.x).toBeLessThan(-3);
    expect(tab.y).toBeLessThan(-3);
    // The tab's inner edges and its text stay where the paper puts them.
    expect(tab.x + tab.w).toBeCloseTo(edge.title!.line.widthMm + 8, 9);
    expect(tab.y + tab.h).toBeCloseTo(7, 9);
    expect(textAt.x).toBe(4);
    expect(rule.x2).toBeGreaterThan(edge.paper.widthMm + 3);
    // With a margin, nothing reaches the edge, and nothing runs past it.
    const kept = layout(steps(1), {}, 'Crane').title!;
    expect(kept.tab.x).toBe(DEFAULT_PAGE_SETUP.marginMm);
    expect(kept.rule.x2).toBe(layout(steps(1)).paper.widthMm - DEFAULT_PAGE_SETUP.marginMm);
  });

  it('lays out an empty diagram as one empty page', () => {
    const result = layout([]);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.cells).toEqual([]);
  });
});

describe('turns between steps on the page (D22)', () => {
  const over = (id: string): LayoutTurn => ({ id, turn: { kind: 'turn-over', axis: 'vertical' } });
  const centreOf = (cell: { pictureMm: { x: number; y: number; size: number } }) => ({
    x: cell.pictureMm.x + cell.pictureMm.size / 2,
    y: cell.pictureMm.y + cell.pictureMm.size / 2,
  });

  it('keeps a gutter between all the pictures of a diagram with a turn: one scale, a little smaller', () => {
    // Landscape A4 at 5 × 2: cells narrow enough that their width, not their height, sets the box.
    const setup = { orientation: 'landscape', columns: 5, rows: 2 } as const;
    const plain = layout(steps(4), setup);
    const turning = layout(steps(4, (index) => (index === 2 ? { turnsBefore: [over('turn-a')] } : {})), setup);
    const box = (result: typeof plain) => result.pages[0]!.cells[0]!.pictureMm.size;
    expect(box(turning)).toBeCloseTo(box(plain) - (TURN_GUTTER_MM - 6), 6);
    // Every picture, not only the two beside the turn.
    expect(new Set(turning.pages[0]!.cells.map((cell) => cell.pictureMm.size)).size).toBe(1);
  });

  it('prints a turn midway between two pictures on a row, at their height', () => {
    const result = layout(steps(3, (index) => (index === 1 ? { turnsBefore: [over('turn-a')] } : {})));
    const [a, b] = result.pages[0]!.cells;
    const [turn] = result.pages[0]!.turns;
    expect(turn).toMatchObject({ id: 'turn-a', turn: { kind: 'turn-over' } });
    const right = a!.pictureMm.x + a!.pictureMm.size;
    expect(turn!.at.x).toBeCloseTo((right + b!.pictureMm.x) / 2, 6);
    expect(turn!.at.y).toBeCloseTo(centreOf(a!).y, 6);
  });

  it('prints one across a row or a page at the next picture’s leading edge, and one after the last at its trailing edge', () => {
    const list = steps(4, (index) =>
      index === 3 ? { turnsBefore: [over('turn-row')], turnsAfter: [over('turn-end')] } : {}
    );
    const result = layout(list, { columns: 3, rows: 3 });
    const cells = result.pages[0]!.cells;
    const byId = new Map(result.pages[0]!.turns.map((turn) => [turn.id, turn]));
    const fourth = cells[3]!;
    // Step 4 starts the second row: the turn before it sits at its left, half a gutter out.
    const gutter = fourth.cellMm.w - fourth.pictureMm.size;
    expect(byId.get('turn-row')!.at.x).toBeCloseTo(fourth.pictureMm.x - gutter / 2, 6);
    expect(byId.get('turn-row')!.at.y).toBeCloseTo(centreOf(fourth).y, 6);
    expect(byId.get('turn-end')!.at.x).toBeCloseTo(fourth.pictureMm.x + fourth.pictureMm.size + gutter / 2, 6);
  });

  it('reads a flow row that runs right to left from its right', () => {
    const list = steps(4, (index) => (index === 3 ? { turnsBefore: [over('turn-a')] } : {}));
    const result = layout(list, { layout: 'flow', columns: 2, rows: 3 });
    // Steps 3 and 4 share the second row, read right to left: the turn is between them.
    const [, , third, fourth] = result.pages[0]!.cells;
    expect(third!.pictureMm.x).toBeGreaterThan(fourth!.pictureMm.x);
    const [turn] = result.pages[0]!.turns;
    expect(turn!.at.x).toBeCloseTo((fourth!.pictureMm.x + fourth!.pictureMm.size + third!.pictureMm.x) / 2, 6);
  });

  it('stands several turns in one place one above another, each clear of the next, and keeps them on the paper', () => {
    const upright: LayoutTurn = { id: 'turn-b', turn: { kind: 'turn-over', axis: 'horizontal' } };
    const rotate: LayoutTurn = { id: 'turn-c', turn: { kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } } };
    const list = steps(2, (index) => (index === 1 ? { turnsBefore: [over('turn-a'), upright, rotate] } : {}));
    const result = layout(list, { marginMm: 0 });
    const turns = result.pages[0]!.turns;
    expect(turns.map((turn) => turn.id)).toEqual(['turn-a', 'turn-b', 'turn-c']);
    expect(new Set(turns.map((turn) => turn.at.x)).size).toBe(1);
    // Each glyph's box, by how it stands: the top-to-bottom turn-over upright.
    expect(turns.map((turn) => turn.box)).toEqual(turns.map((turn) => turnGlyphMm(turn.turn)));
    expect(turns[1]!.box.h).toBeGreaterThan(turns[1]!.box.w);
    for (let n = 1; n < turns.length; n += 1) {
      const above = turns[n - 1]!;
      const below = turns[n]!;
      expect(below.at.y - below.box.h / 2 - (above.at.y + above.box.h / 2)).toBeCloseTo(TURN_STACK_CLEAR_MM, 6);
    }
    // The stack is centred where one would be.
    const [a, b] = result.pages[0]!.cells;
    const top = turns[0]!.at.y - turns[0]!.box.h / 2;
    const bottom = turns[2]!.at.y + turns[2]!.box.h / 2;
    expect((top + bottom) / 2).toBeCloseTo((centreOf(a!).y + centreOf(b!).y) / 2, 6);
  });

  it('keeps every glyph off the pictures and on the paper, whatever the margin, grid or flow', () => {
    const rotate: LayoutTurn = { id: 'turn-r', turn: { kind: 'rotate', rotate: { amount: 'half', direction: 'ccw' } } };
    const list = steps(9, (index) =>
      index === 0
        ? { turnsBefore: [over('turn-first')] }
        : index === 3
          ? { turnsBefore: [over('turn-row'), rotate] }
          : index === 8
            ? { turnsAfter: [over('turn-end')] }
            : {}
    );
    const clash = (box: { x: number; y: number; w: number; h: number }, picture: { x: number; y: number; size: number }) =>
      box.x < picture.x + picture.size && picture.x < box.x + box.w && box.y < picture.y + picture.size && picture.y < box.y + box.h;
    for (const pageLayout of ['grid', 'flow'] as const) {
      for (const marginMm of [0, 3, 5, 8, 12, 20, 30]) {
        const result = layout(list, { layout: pageLayout, marginMm });
        const { widthMm } = result.paper;
        for (const turn of result.pages[0]!.turns) {
          const box = { x: turn.at.x - turn.box.w / 2, y: turn.at.y - turn.box.h / 2, w: turn.box.w, h: turn.box.h };
          expect(box.x, `${pageLayout} ${marginMm} ${turn.id}`).toBeGreaterThanOrEqual(0);
          expect(box.x + box.w, `${pageLayout} ${marginMm} ${turn.id}`).toBeLessThanOrEqual(widthMm);
          for (const cell of result.pages[0]!.cells) {
            expect(clash(box, cell.pictureMm), `${pageLayout} ${marginMm} ${turn.id} over step ${cell.number}`).toBe(false);
          }
        }
      }
    }
  });

  it('says which step each turn comes before, none for those after the last', () => {
    const list = steps(4, (index) =>
      index === 0 ? { turnsBefore: [over('turn-a')] } : index === 3 ? { turnsBefore: [over('turn-b')], turnsAfter: [over('turn-c')] } : {}
    );
    const turns = layout(list).pages[0]!.turns;
    expect(turns.map((turn) => [turn.id, turn.beforeStepId])).toEqual([
      ['turn-a', 'step-0'],
      ['turn-b', 'step-3'],
      ['turn-c', null],
    ]);
  });

  it('prints none on a diagram without turns, and keeps its pictures their size', () => {
    const result = layout(steps(3));
    expect(result.pages[0]!.turns).toEqual([]);
  });
});
