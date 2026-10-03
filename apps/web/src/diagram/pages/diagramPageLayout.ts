/**
 * Where everything on a diagram's pages goes (D10): which steps are on which
 * page, each step's cell, its number, its picture box and the lines of its
 * instruction, the flow band, the title tab and the page numbers — in mm, with
 * the origin at the page's top-left.
 *
 * The mockup's `layout()` is the reference, with two changes the Phase 0
 * pages adopted:
 * - the picture box starts below the step number, which the mockup's formula
 *   printed over the picture;
 * - an instruction that needs more lines than its slot takes them from its
 *   picture box, down to half the box, and only then is cut with "…".
 *
 * Under the `paper` scale every picture that knows its paper's size is drawn
 * at one millimetre per document unit for the whole diagram: the largest at
 * which each fits its full box. A picture in a cell whose box gave room to
 * text, and no longer fits there at that scale, is drawn smaller, alone.
 * Uploads and 3D pictures are fitted to their boxes, as every picture is under
 * `fit`.
 *
 * Measurement is injected ({@link TextSetter}): the composer sets text from
 * the font's own advances, tests with an estimate.
 *
 * Pure.
 */
import type { DiagramPageSetup } from '../document/diagramDocument';
import { printPaper, type PrintPaper } from './printPaper';

/** The instruction's size and leading, mm. */
export const STEP_TEXT_SIZE_MM = 3.2;
export const STEP_TEXT_LEADING_MM = 4.1;
/** The step number: its size, and its baseline below the cell's top. */
export const STEP_NUMBER_SIZE_MM = 6.2;
const STEP_NUMBER_BASELINE_MM = 7;
const STEP_NUMBER_INSET_MM = 1.5;
/** The picture box's top below the cell's top: under the number. */
const PICTURE_TOP_MM = 8;
/** The instruction's first baseline below the picture box. */
const TEXT_GAP_MM = 5;
/** Room kept under the last baseline, for descenders. */
const TEXT_DESCENT_MM = 1.5;
/** The smallest a picture box gives way to text: half of it. */
const PICTURE_FLOOR = 0.5;
/** The header and the footer, when shown. */
export const HEADER_MM = 11;
export const FOOTER_MM = 8;
/** The title tab: its height, the text's inset and size, and the rule beside it. */
const TAB_HEIGHT_MM = 7;
const TAB_PADDING_MM = 4;
export const TITLE_SIZE_MM = 3.8;
const TITLE_BASELINE_MM = 4.9;
const TITLE_RULE_Y_MM = 6.8;
export const PAGE_NUMBER_SIZE_MM = 3.4;
const PAGE_NUMBER_RAISE_MM = 1.5;
/** Flow: every other cell of a row steps down by this share of the cell, and the text gives up as much. */
const FLOW_STEP = 0.06;

/** One run of a set line: a font and its text, placed from the line's start. */
export interface SetRun {
  font: string;
  text: string;
  xMm: number;
  widthMm: number;
}

export interface SetLine {
  text: string;
  widthMm: number;
  runs: SetRun[];
  /** The line ends in "…": text was cut after it. */
  ellipsis: boolean;
}

export interface SetText {
  lines: SetLine[];
  /** How many lines the whole text needs at this width. */
  linesNeeded: number;
}

/** How text is measured and set: the composer's font, or a test's estimate. */
export interface TextSetter {
  /** `text` broken into lines at most `widthMm` wide, at most `maxLines` of them (the last cut with "…"). */
  paragraph: (text: string, widthMm: number, sizeMm: number, maxLines: number) => SetText;
  /** One line, unbroken: a title or a number. */
  line: (text: string, sizeMm: number, weight: 400 | 700) => SetLine;
}

/** What the layout needs of a step. */
export interface LayoutStep {
  id: string;
  text: string;
  breakBefore: boolean;
  /**
   * The picture's size for the scale policy: its longer side in document
   * units when it knows its paper (`paper`), or only fitted (`fit`); null
   * for a step with no picture.
   */
  picture: { kind: 'paper'; extentUnits: number } | { kind: 'fit' } | null;
}

export interface LayoutCell {
  stepId: string;
  /** 1-based, as printed. */
  number: number;
  cellMm: { x: number; y: number; w: number; h: number };
  /** The picture's square box. */
  pictureMm: { x: number; y: number; size: number };
  /** Millimetres per document unit for a paper picture; null when it is fitted (or there is none). */
  mmPerUnit: number | null;
  /** The picture drawn smaller than the shared scale: its box gave room to text. */
  scaleReduced: boolean;
  numberAt: { x: number; y: number };
  text: { x: number; firstBaseline: number; widthMm: number; lines: SetLine[] };
  /** The instruction did not fit even with the picture at its floor: it ends in "…". */
  textOverflow: boolean;
}

export interface LayoutPage {
  /** As printed: the setup's first number plus the page's index. */
  number: number;
  cells: LayoutCell[];
  /** The flow band's points, in order, or null. */
  band: { x: number; y: number }[] | null;
  pageNumberAt: { x: number; y: number; anchor: 'start' | 'end' } | null;
}

export interface DiagramPagesLayout {
  paper: PrintPaper;
  pages: LayoutPage[];
  cellMm: { w: number; h: number };
  /** The shared mm per document unit under `paper`; null under `fit` or with no paper picture. */
  mmPerUnit: number | null;
  /** The title tab, when shown. */
  title: {
    tab: { x: number; y: number; w: number; h: number };
    textAt: { x: number; y: number };
    line: SetLine;
    rule: { x1: number; x2: number; y: number };
  } | null;
  /** The band's width, for the flow layout's path. */
  bandWidthMm: number;
}

/** The pages of a diagram's steps, under its page setup. */
export function layoutDiagramPages(
  steps: readonly LayoutStep[],
  setup: DiagramPageSetup,
  title: string,
  setter: TextSetter
): DiagramPagesLayout {
  const paper = printPaper(setup);
  const { widthMm: W, heightMm: H, marginMm: m } = paper;
  const flow = setup.layout === 'flow';
  const showTitle = setup.showTitle && title.trim() !== '';
  const headH = showTitle ? HEADER_MM : 0;
  const footH = setup.pageNumbers.enabled ? FOOTER_MM : 0;
  const cellW = (W - 2 * m) / setup.columns;
  const cellH = (H - 2 * m - headH - footH) / setup.rows;
  const fullBox = Math.max(12, Math.min(cellW - 6, cellH * 0.64));
  const textWidth = cellW * 0.8;
  const perPage = setup.columns * setup.rows;

  // Which steps on which page: in order, a new page when one is full or a
  // step starts one.
  const pagesOfSteps: { step: LayoutStep; index: number }[][] = [];
  steps.forEach((step, index) => {
    const current = pagesOfSteps.at(-1);
    if (!current || current.length >= perPage || (step.breakBefore && current.length > 0)) {
      pagesOfSteps.push([{ step, index }]);
    } else {
      current.push({ step, index });
    }
  });
  if (pagesOfSteps.length === 0) pagesOfSteps.push([]);

  // Each cell's box and text, before the scale is known.
  interface Placed {
    step: LayoutStep;
    index: number;
    x: number;
    y: number;
    box: number;
    text: SetText;
    overflow: boolean;
  }
  const slotLines = (cellTop: number, box: number) => {
    const firstBaseline = cellTop + PICTURE_TOP_MM + box + TEXT_GAP_MM;
    const bottom = cellTop + cellH * (flow ? 1 - FLOW_STEP : 1) - TEXT_DESCENT_MM;
    return Math.max(0, Math.floor((bottom - firstBaseline) / STEP_TEXT_LEADING_MM + 1e-9) + 1);
  };
  const placedPages: Placed[][] = pagesOfSteps.map((entries) =>
    entries.map(({ step, index }, k) => {
      const row = Math.floor(k / setup.columns);
      const k0 = k % setup.columns;
      const col = flow && row % 2 === 1 ? setup.columns - 1 - k0 : k0;
      const x = m + col * cellW;
      const y = m + headH + row * cellH + (flow && k0 % 2 === 1 ? cellH * FLOW_STEP : 0);
      let box = fullBox;
      const full = setter.paragraph(step.text, textWidth, STEP_TEXT_SIZE_MM, Number.MAX_SAFE_INTEGER);
      let maxLines = slotLines(y, box);
      if (full.linesNeeded > maxLines) {
        // Text first: the picture gives up what the text needs, to its floor.
        const short = (full.linesNeeded - maxLines) * STEP_TEXT_LEADING_MM;
        box = Math.max(fullBox * PICTURE_FLOOR, box - short);
        maxLines = slotLines(y, box);
      }
      const text =
        full.linesNeeded <= maxLines ? full : setter.paragraph(step.text, textWidth, STEP_TEXT_SIZE_MM, maxLines);
      return { step, index, x, y, box, text, overflow: full.linesNeeded > maxLines };
    })
  );

  // One scale for every paper picture: the largest at which each fits its full box.
  let mmPerUnit: number | null = null;
  if (setup.scale === 'paper') {
    for (const page of placedPages) {
      for (const { step } of page) {
        if (step.picture?.kind !== 'paper' || !(step.picture.extentUnits > 0)) continue;
        const fits = fullBox / step.picture.extentUnits;
        mmPerUnit = mmPerUnit === null ? fits : Math.min(mmPerUnit, fits);
      }
    }
  }

  const pages: LayoutPage[] = placedPages.map((placed, pageIndex) => {
    const number = setup.pageNumbers.first + pageIndex;
    const cells: LayoutCell[] = placed.map(({ step, index, x, y, box, text, overflow }) => {
      const pictureX = x + (cellW - box) / 2;
      const pictureY = y + PICTURE_TOP_MM;
      let cellScale: number | null = null;
      let scaleReduced = false;
      if (mmPerUnit !== null && step.picture?.kind === 'paper' && step.picture.extentUnits > 0) {
        const fits = box / step.picture.extentUnits;
        cellScale = Math.min(mmPerUnit, fits);
        scaleReduced = fits < mmPerUnit - 1e-12;
      }
      return {
        stepId: step.id,
        number: index + 1,
        cellMm: { x, y, w: cellW, h: cellH },
        pictureMm: { x: pictureX, y: pictureY, size: box },
        mmPerUnit: cellScale,
        scaleReduced,
        numberAt: { x: x + STEP_NUMBER_INSET_MM, y: y + STEP_NUMBER_BASELINE_MM },
        text: {
          x: x + cellW * 0.1,
          firstBaseline: pictureY + box + TEXT_GAP_MM,
          widthMm: textWidth,
          lines: text.lines,
        },
        textOverflow: overflow,
      };
    });
    const band =
      flow && setup.showPath && cells.length > 0 ? flowBand(cells, pageIndex, placedPages.length, W, cellW) : null;
    const right = number % 2 === 1;
    return {
      number,
      cells,
      band,
      pageNumberAt: setup.pageNumbers.enabled
        ? { x: right ? W - m : m, y: H - m - PAGE_NUMBER_RAISE_MM, anchor: right ? 'end' : 'start' }
        : null,
    };
  });

  let titleLayout: DiagramPagesLayout['title'] = null;
  if (showTitle) {
    const line = setter.line(title.trim(), TITLE_SIZE_MM, 700);
    const tabW = Math.min(W - 2 * m, line.widthMm + 2 * TAB_PADDING_MM);
    titleLayout = {
      tab: { x: m, y: m, w: tabW, h: TAB_HEIGHT_MM },
      textAt: { x: m + TAB_PADDING_MM, y: m + TITLE_BASELINE_MM },
      line,
      rule: { x1: m + tabW, x2: W - m, y: m + TITLE_RULE_Y_MM },
    };
  }

  return {
    paper,
    pages,
    cellMm: { w: cellW, h: cellH },
    mmPerUnit,
    title: titleLayout,
    bandWidthMm: Math.min(cellW, cellH) * 0.42,
  };
}

/**
 * The flow band through a page's pictures, in reading order: a turn out past
 * the row's end between rows, and a stub off the page's edge where the
 * sequence goes on from the page before or to the page after.
 */
function flowBand(
  cells: readonly LayoutCell[],
  pageIndex: number,
  pageCount: number,
  pageWidth: number,
  cellW: number
): { x: number; y: number }[] {
  const centres = cells.map((cell) => ({
    x: cell.pictureMm.x + cell.pictureMm.size / 2,
    y: cell.pictureMm.y + cell.pictureMm.size / 2,
    row: Math.round((cell.cellMm.y - cells[0]!.cellMm.y) / cell.cellMm.h),
  }));
  const points: { x: number; y: number }[] = [];
  if (pageIndex > 0) points.push({ x: -10, y: centres[0]!.y });
  centres.forEach((a, n) => {
    points.push({ x: a.x, y: a.y });
    const b = centres[n + 1];
    if (b && b.row !== a.row) points.push({ x: a.x + (a.row % 2 ? -1 : 1) * cellW * 0.46, y: (a.y + b.y) / 2 });
  });
  const last = centres.at(-1)!;
  if (pageIndex < pageCount - 1) points.push({ x: last.row % 2 ? -10 : pageWidth + 10, y: last.y });
  return points;
}
