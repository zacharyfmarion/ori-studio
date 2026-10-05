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
 *   picture box, down to half the box, and only then is cut with "…" — but
 *   always keeps one line, in a cell too short for even that at half.
 *
 * A picture is drawn in its cell's room: the cell's width less the gutter,
 * and the height its text leaves — taller than the square box where the text
 * is short, so a tall model keeps its scale and its cell runs taller rather
 * than the model shrinking. The text then starts below it.
 *
 * Under the `paper` scale every picture that knows its paper's size is drawn
 * at one millimetre per document unit for the whole diagram: the largest at
 * which each fits its room. A picture in a cell whose box gave room to text,
 * and no longer fits there at that scale, is drawn smaller, alone. Uploads and
 * 3D pictures are fitted to their boxes.
 *
 * Under `fit` the paper keeps one scale from step to step while it can
 * ({@link scaleRuns}): a run of steps shares the largest scale at which each
 * fits its room, and a new run zooms in where the model has grown much
 * smaller, or out where it has grown for good. Pictures with no paper keep
 * one size of frame the same way.
 *
 * A turn between two steps (D22) has no cell: its glyph prints in the gutter
 * between the two pictures — midway on a row; at the next picture's leading
 * edge across a row or a page; at the last picture's trailing edge after it.
 * A diagram with any turn keeps a gutter wide enough between all its
 * pictures, so its one paper scale stays one scale.
 *
 * Measurement is injected ({@link TextSetter}): the composer sets text from
 * the font's own advances, tests with an estimate.
 *
 * Pure.
 */
import type { DiagramPageSetup, DiagramTurnKind } from '../document/diagramDocument';
import type { DiagramFontFace } from '../fonts/diagramFontFaces';
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
/**
 * How far art that reaches the paper's edge runs on past it: the flow band
 * where the sequence goes on, and the title tab and rule on a page with no
 * margin. Past any bleed a print shop asks for, so the cut never shows paper.
 */
const OFF_PAGE_MM = 10;
/** Flow: every other cell of a row steps down by this share of the cell, and the text gives up as much. */
const FLOW_STEP = 0.06;
/** The room beside a picture box in its cell, together: the gutter between two pictures. */
const PICTURE_SIDE_ROOM_MM = 6;
/**
 * Under `fit`, what a change of scale between two steps costs, against how
 * much smaller than it could be each picture is drawn — the log of the
 * ratio, summed over the pictures (`scaleRuns`). One: as much as five
 * pictures drawn a fifth smaller, or one at under two fifths of its size.
 */
export const FIT_RUN_BREAK = 1;
/** Under `fit`, scales this near each other are one: the larger drawn at the smaller, wherever in the diagram. */
export const FIT_SAME = 1.06;
/**
 * Under `fit`, the least change of scale from one step to the next: a
 * smaller one does not read as a zoom, only as the paper changing size, so
 * two runs nearer than this are drawn as one at the smaller of their scales.
 */
export const FIT_ZOOM = 1.3;
/**
 * The most of its room what a picture's marks keep at their pt size may
 * take — letters, glyphs, heads — in a room cut down to a few mm for its
 * text: past it, they reach out of the room rather than the paper shrink to
 * a dot inside them. Where marks lie, which grows with the picture, is
 * always given room.
 */
export const MARKS_FLOOR = 0.5;
/**
 * The gutter a diagram with turns keeps between its pictures (D22): the
 * turn-over glyph, the wider of the two at its printed size, and room either
 * side of it.
 */
export const TURN_GUTTER_MM = 14;
/**
 * A turn's glyph as it prints (`composeDiagramPage`, at the pictures' line
 * width), its ink measured with room for the stroke: the turn-over's long and
 * short sides — lying on its side when it turns top to bottom — and the
 * rotation's circle with its heads.
 */
const TURN_OVER_GLYPH_MM = { long: 11.6, short: 5.6 } as const;
const ROTATE_GLYPH_MM = 8.8;
/** The clear space between two turns standing in one gutter, one above another. */
export const TURN_STACK_CLEAR_MM = 1.5;

/** The box a turn's glyph prints in, in mm, centred on its place. */
export function turnGlyphMm(turn: DiagramTurnKind): { w: number; h: number } {
  if (turn.kind === 'rotate') return { w: ROTATE_GLYPH_MM, h: ROTATE_GLYPH_MM };
  const { long, short } = TURN_OVER_GLYPH_MM;
  return turn.axis === 'horizontal' ? { w: short, h: long } : { w: long, h: short };
}

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
  /** One line: a title or a number, cut with "…" at `maxWidthMm` when one is given. */
  line: (text: string, sizeMm: number, weight: 400 | 700, maxWidthMm?: number) => SetLine;
  /**
   * A run of an upload's text (`uploadText.ts`), set in `face`, in the faces
   * that set it: its own, or for a character its own lacks, the first font
   * that has it. Nothing is measured: the upload places its own text.
   */
  runs: (text: string, face: DiagramFontFace) => { face: DiagramFontFace; text: string }[];
}

/** What the layout needs of a step. */
export interface LayoutStep {
  id: string;
  text: string;
  breakBefore: boolean;
  /**
   * The picture with what its marks reach past it — annotations, a
   * References step's letters — for the scale policy, in two parts: where
   * its marks lie, which grows with the picture — its width and height in
   * document units when it knows its paper (`paper`), or per its frame's
   * longer side when it is only fitted (`fit`) — and what they reach past
   * that at their pt size, in mm (`marks`). Its frame alone in the first
   * units. And where the reach lies: how far past each edge of the frame, in
   * the same two parts (`sides`; across, `width` is the frame's and the left
   * and right sides' growth together, `marks` their pt parts) — absent, its
   * marks are taken as even on both sides. Null for a step with no picture.
   */
  picture: {
    kind: 'paper' | 'fit';
    width: number;
    height: number;
    frame: { width: number; height: number };
    marks: { width: number; height: number };
    sides?: ReachSides;
  } | null;
  /**
   * The largest scale at which the picture fits a room `across` × `down` mm,
   * where how far its marks reach depends on its scale: found by measuring
   * it there (`layoutDiagram`). Absent, `pictureFit` of `picture`.
   */
  fitIn?: (across: number, down: number) => number | null;
  /**
   * The most the picture is drawn at, alone, whatever its run's scale: one
   * whose marks reach out unevenly may hold its room at its fit and not at a
   * smaller scale its run draws it at (`layoutDiagram`).
   */
  atMost?: number;
  /** The turns between the step before and this one (D22), in order. */
  turnsBefore: readonly LayoutTurn[];
  /** The turns after the last step; empty on every other. */
  turnsAfter: readonly LayoutTurn[];
}

/**
 * How far a picture's reach lies past one edge of its frame, in mm at a
 * scale: `grows × scale + beyond`, as measured near that scale.
 */
export interface ReachLine {
  grows: number;
  beyond: number;
}

/** A picture's reach past each edge of its frame (`ReachLine`). */
export interface ReachSides {
  left: ReachLine;
  right: ReachLine;
  top: ReachLine;
  bottom: ReachLine;
}

/** A turn between two steps, as the layout places it. */
export interface LayoutTurn {
  id: string;
  turn: DiagramTurnKind;
}

export interface LayoutCell {
  stepId: string;
  /** 1-based, as printed. */
  number: number;
  cellMm: { x: number; y: number; w: number; h: number };
  /** The picture's square box: where a fitted picture goes, and an empty step's placeholder. */
  pictureMm: { x: number; y: number; size: number };
  /**
   * Where the picture is drawn, centred: as wide as the cell's room, and as
   * tall as the square box or the picture at its scale, whichever is taller —
   * from the box's top. The text starts below it.
   */
  drawMm: { x: number; y: number; w: number; h: number };
  /** Millimetres per document unit for a paper picture; null when it is fitted (or there is none). */
  mmPerUnit: number | null;
  /**
   * Under `fit`, the longer side a picture with no paper is drawn at, in mm,
   * as its run keeps it ({@link scaleRuns}). Null under `paper`, for a paper
   * picture, and for a step with no picture.
   */
  frameMm: number | null;
  /** The picture drawn smaller than its scale's run: its box gave room to text, or it reached too far. */
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
  /**
   * The turns on the page (D22), in the document's order: each glyph's centre
   * and printed box, and the step it comes before — null for those after the
   * last step.
   */
  turns: (LayoutTurn & { at: { x: number; y: number }; box: { w: number; h: number }; beforeStepId: string | null })[];
  pageNumberAt: { x: number; y: number; anchor: 'start' | 'end' } | null;
}

export interface DiagramPagesLayout {
  paper: PrintPaper;
  pages: LayoutPage[];
  cellMm: { w: number; h: number };
  /** The shared mm per document unit under `paper`; null under `fit` (each run has its own) or with no paper picture. */
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

/**
 * The largest scale at which a picture fits its cell's room: with its text
 * in full (`own`), and for the runs, with a long text's cut to its box left
 * aside (`shared`) — such a picture is drawn smaller alone, as under `paper`.
 */
export interface ScaleFit {
  own: number;
  shared: number;
}

/**
 * Under `fit`, the scale each picture is drawn at, in order, so that the
 * paper keeps one size from step to step where it can — a diagram's steps
 * draw the model alike — and changes it only where the model has grown
 * smaller or larger for long enough to be worth it, and by enough to read as
 * a zoom.
 *
 * The pictures are cut into runs, each drawn at one scale no picture in it is
 * too big for, so as to cost least: every picture drawn smaller than it could
 * be costs the log of how much smaller, and every change of scale between
 * runs {@link FIT_RUN_BREAK}. Two runs side by side are at least
 * {@link FIT_ZOOM} apart: a smaller change does not read as a zoom, only as
 * the paper changing size. So a model smaller for one step is drawn at its
 * neighbours' scale, one smaller for several zooms in, and a step that needs
 * more room (a flap's outline far above it) lowers its run or stands alone —
 * drawn a zoom under its neighbours if it needs a little more room than that
 * — whichever costs least. A run is drawn at its smallest picture's scale, or
 * a zoom under another's, but never a whole zoom under its own smallest: a
 * run that small would be there only to part the runs either side, letting
 * them differ by less than a zoom. The least-cost cut and scales among those
 * are found exactly (dynamic programming over where the last run starts and
 * its scale), the same answer read from either end.
 *
 * Runs whose scales are within {@link FIT_SAME} are then drawn at one,
 * wherever in the diagram, where that keeps each a zoom from its neighbours.
 * A picture is drawn at its run's scale, or its own when that is smaller
 * (`reduced`: a long instruction took its room). Pure.
 */
export function scaleRuns(fits: readonly ScaleFit[]): { scale: number; reduced: boolean }[] {
  const count = fits.length;
  if (count === 0) return [];
  // A fit of nothing — a room of no size — is a picture drawn at nothing, alone.
  const shares = fits.map(({ shared }) => (Number.isFinite(shared) && shared > 0 ? shared : Number.MIN_VALUE));
  const logs = shares.map(Math.log);
  const zoom = Math.log(FIT_ZOOM);
  // The scales a run may be drawn at, as logs, each with the scale it is: a
  // picture's own, or a zoom under one.
  const scaleAt = new Map<number, number>();
  shares.forEach((share, index) => scaleAt.set(logs[index]!, share));
  shares.forEach((share, index) => {
    if (!scaleAt.has(logs[index]! - zoom)) scaleAt.set(logs[index]! - zoom, share / FIT_ZOOM);
  });
  const levels = [...scaleAt.keys()].sort((a, b) => a - b);
  const width = levels.length;
  // For each level, the highest a zoom or more below it and the lowest a zoom or more above it.
  const apart = zoom * (1 - 1e-9);
  const below = new Int32Array(width);
  const above = new Int32Array(width);
  for (let v = 0, u = -1; v < width; v += 1) {
    while (u + 1 < width && levels[u + 1]! <= levels[v]! - apart) u += 1;
    below[v] = u;
  }
  for (let v = width - 1, u = width; v >= 0; v -= 1) {
    while (u - 1 >= 0 && levels[u - 1]! >= levels[v]! + apart) u -= 1;
    above[v] = u;
  }

  // best[j][v]: the least the first j pictures cost with their last run at
  // level v; from[j][v], where that run starts, and before[j][v], the level
  // of the run before it (-1 for none).
  const best = new Float64Array((count + 1) * width).fill(Infinity);
  const from = new Int32Array((count + 1) * width);
  const before = new Int32Array((count + 1) * width);
  // next[i][v]: the least the first i pictures cost with their last run a
  // zoom or more from level v, and that run's level.
  const next = new Float64Array((count + 1) * width).fill(Infinity);
  const nextAt = new Int32Array((count + 1) * width).fill(-1);
  const lowest = new Float64Array(width);
  const lowestAt = new Int32Array(width);
  const highest = new Float64Array(width);
  const highestAt = new Int32Array(width);
  const ended = (i: number) => {
    const row = i * width;
    for (let u = 0; u < width; u += 1) {
      const cost = best[row + u]!;
      const better = u === 0 || cost < lowest[u - 1]!;
      lowest[u] = better ? cost : lowest[u - 1]!;
      lowestAt[u] = better ? u : lowestAt[u - 1]!;
    }
    for (let u = width - 1; u >= 0; u -= 1) {
      const cost = best[row + u]!;
      const better = u === width - 1 || cost < highest[u + 1]!;
      highest[u] = better ? cost : highest[u + 1]!;
      highestAt[u] = better ? u : highestAt[u + 1]!;
    }
    for (let v = 0; v < width; v += 1) {
      const down = below[v]! >= 0 ? lowest[below[v]!]! : Infinity;
      const up = above[v]! < width ? highest[above[v]!]! : Infinity;
      next[row + v] = Math.min(down, up);
      nextAt[row + v] = down <= up ? (below[v]! >= 0 ? lowestAt[below[v]!]! : -1) : highestAt[above[v]!]!;
    }
  };
  for (let j = 1; j <= count; j += 1) {
    let low = Infinity;
    let sum = 0;
    for (let i = j - 1; i >= 0; i -= 1) {
      low = Math.min(low, logs[i]!);
      sum += logs[i]!;
      const pictures = j - i;
      for (let v = 0; v < width && levels[v]! <= low; v += 1) {
        // Never a whole zoom under its own smallest picture: it would only part
        // the runs either side, a step drawn small to let them differ by less.
        if (levels[v]! <= low - apart) continue;
        const earlier = i === 0 ? 0 : next[i * width + v]! + FIT_RUN_BREAK;
        if (earlier === Infinity) continue;
        const cost = earlier + sum - pictures * levels[v]!;
        const at = j * width + v;
        if (cost < best[at]!) {
          best[at] = cost;
          from[at] = i;
          before[at] = i === 0 ? -1 : nextAt[i * width + v]!;
        }
      }
    }
    if (j < count) ended(j);
  }
  // The cheapest end, the larger scale on a tie.
  let level = width - 1;
  for (let v = width - 1; v >= 0; v -= 1) if (best[count * width + v]! < best[count * width + level]!) level = v;
  const runs: { from: number; to: number; scale: number }[] = [];
  for (let j = count; j > 0; ) {
    const at = j * width + level;
    runs.unshift({ from: from[at]!, to: j, scale: scaleAt.get(levels[level]!)! });
    j = from[at]!;
    level = before[at]!;
  }

  // Near enough is one, wherever in the diagram: each scale joins the
  // smallest within FIT_SAME below it that leads its own, so a chain of near
  // scales does not drift down. A run takes it only where it still reads as a
  // zoom from each neighbour, as drawn and as snapped — every run decided at
  // once, so the answer does not depend on which end is read first.
  const leaders = new Map<number, number>();
  let leader = -Infinity;
  for (const scale of [...new Set(runs.map(({ scale }) => scale))].sort((a, b) => a - b)) {
    if (!(scale <= leader * FIT_SAME)) leader = scale;
    leaders.set(scale, leader);
  }
  const reads = (a: number, b: number) => a === b || Math.max(a, b) / Math.min(a, b) >= FIT_ZOOM * (1 - 1e-9);
  const snapped = runs.map(({ scale }) => leaders.get(scale)!);
  const taken = runs.map((_, k) =>
    [k - 1, k + 1].every((n) => n < 0 || n >= runs.length || (reads(snapped[k]!, runs[n]!.scale) && reads(snapped[k]!, snapped[n]!)))
  );
  runs.forEach((run, k) => {
    if (taken[k]) run.scale = snapped[k]!;
  });

  const scaleOf = new Float64Array(count);
  for (const { from, to, scale } of runs) scaleOf.fill(scale, from, to);
  return fits.map(({ own }, index) => {
    const run = scaleOf[index]!;
    const drawn = Math.min(run, own);
    return { scale: drawn, reduced: drawn < run * (1 - 1e-9) };
  });
}

/**
 * The largest scale at which a picture fits a room `across` × `down` mm, in
 * mm per its unit: its reach as measured (`width × scale + marks`), what is
 * past the line it grows along taking at most {@link MARKS_FLOOR} of the
 * room — past it the marks reach out of the room rather than the paper shrink
 * to a dot — and the paper itself in the room always. A reach that does not
 * grow with the picture there (a glyph larger than the paper) asks nothing
 * of the scale: the paper fills its room. Null for no picture, or one with
 * no size.
 */
export function pictureFit(picture: LayoutStep['picture'], across: number, down: number): number | null {
  if (!picture) return null;
  const side = (room: number, grows: number, beyond: number, frame: number): number => {
    if (![grows, beyond, frame].every(Number.isFinite)) return Number.NaN;
    const paper = frame > 0 ? room / frame : Infinity;
    if (!(grows > 0)) return paper;
    return Math.min(paper, Math.max(room - beyond, room * (1 - MARKS_FLOOR)) / grows);
  };
  const fit = Math.min(
    side(across, picture.width, picture.marks.width, picture.frame.width),
    side(down, picture.height, picture.marks.height, picture.frame.height)
  );
  return Number.isFinite(fit) && fit >= 0 ? fit : null;
}

/**
 * How far a picture reaches with its marks, in mm, drawn at `scale`: as
 * measured, near the scale it was measured at, and never less than its
 * frame.
 */
export function pictureExtent(picture: NonNullable<LayoutStep['picture']>, scale: number): { width: number; height: number } {
  return {
    width: Math.max(picture.width * scale + picture.marks.width, picture.frame.width * scale),
    height: Math.max(picture.height * scale + picture.marks.height, picture.frame.height * scale),
  };
}

/**
 * Which steps go on which page, as indices: in order, a new page when one is
 * full or a step starts one. An empty diagram is one empty page.
 */
export function splitIntoPages(steps: readonly Pick<LayoutStep, 'breakBefore'>[], perPage: number): number[][] {
  const pages: number[][] = [];
  steps.forEach((step, index) => {
    const current = pages.at(-1);
    if (!current || current.length >= perPage || (step.breakBefore && current.length > 0)) pages.push([index]);
    else current.push(index);
  });
  return pages.length === 0 ? [[]] : pages;
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
  const turning = steps.some((step) => step.turnsBefore.length > 0 || step.turnsAfter.length > 0);
  // A turn at a row's end prints in the half gutter outside the outer picture,
  // which a narrow margin cannot give: the boxes give up what it lacks.
  const outerShortfall = turning ? Math.max(0, TURN_GUTTER_MM / 2 - m) : 0;
  // A picture's room across the cell: the cell less the gutter between pictures.
  const roomW = Math.max(12, cellW - (turning ? TURN_GUTTER_MM : PICTURE_SIDE_ROOM_MM) - 2 * outerShortfall);
  const fullBox = Math.max(12, Math.min(roomW, cellH * 0.64));
  const textWidth = cellW * 0.8;
  const perPage = setup.columns * setup.rows;

  const pagesOfSteps = splitIntoPages(steps, perPage).map((page) =>
    page.map((index) => ({ step: steps[index]!, index }))
  );

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
  /** How far below the box's top the text's last line may sit, and how many lines fit there. */
  const slotBottom = (cellTop: number) => cellTop + cellH * (flow ? 1 - FLOW_STEP : 1) - TEXT_DESCENT_MM;
  const firstBaselineOf = (cellTop: number, box: number) => cellTop + PICTURE_TOP_MM + box + TEXT_GAP_MM;
  const slotLines = (cellTop: number, box: number) =>
    Math.max(
      0,
      Math.floor((slotBottom(cellTop) - firstBaselineOf(cellTop, box)) / STEP_TEXT_LEADING_MM + 1e-9) + 1
    );
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
        // Text first: the picture gives up the room the text's last line is
        // short of — measured, not counted in lines, since a slot can be
        // short of more than it holds — down to its floor.
        const lastBaseline = firstBaselineOf(y, box) + (full.linesNeeded - 1) * STEP_TEXT_LEADING_MM;
        box = Math.max(fullBox * PICTURE_FLOOR, box - (lastBaseline - slotBottom(y)));
        maxLines = slotLines(y, box);
        if (maxLines === 0) {
          // A cell so short that half a picture leaves no line at all: the
          // picture gives way further, for one line — a cut instruction says
          // so; a missing one says nothing.
          box = Math.max(0, slotBottom(y) - (firstBaselineOf(y, box) - box));
          maxLines = slotLines(y, box);
        }
      }
      const text =
        full.linesNeeded <= maxLines ? full : setter.paragraph(step.text, textWidth, STEP_TEXT_SIZE_MM, maxLines);
      return { step, index, x, y, box, text, overflow: full.linesNeeded > maxLines };
    })
  );

  // Each picture's room: across, the cell less its gutter; down, what its
  // text leaves, at least its box. It fits where both its sides do.
  const roomH = ({ y, box, text }: Placed) =>
    Math.max(
      box,
      slotBottom(y) -
        (y + PICTURE_TOP_MM) -
        (text.lines.length > 0 ? TEXT_GAP_MM + (text.lines.length - 1) * STEP_TEXT_LEADING_MM : 0)
    );
  const fitOf = ({ step, ...placed }: Placed): ScaleFit | null => {
    const down = roomH({ step, ...placed });
    const fit = (across: number, room: number) => (step.fitIn ? step.fitIn(across, room) : pictureFit(step.picture, across, room));
    const own = fit(roomW, down);
    const shared = fit(roomW, Math.max(down, fullBox));
    if (own !== null && step.atMost !== undefined) return shared === null ? null : { own: Math.min(own, step.atMost), shared };
    return own === null || shared === null ? null : { own, shared };
  };
  const scales = new Map<Placed, { mmPerUnit: number | null; frameMm: number | null; reduced: boolean }>();
  const all = placedPages.flat();
  let mmPerUnit: number | null = null;
  if (setup.scale === 'paper') {
    // One scale for every paper picture: the largest at which each fits its room.
    const paper = all.flatMap((placed) => {
      const fit = placed.step.picture?.kind === 'paper' ? fitOf(placed) : null;
      return fit ? [{ placed, fit }] : [];
    });
    for (const { fit } of paper) mmPerUnit = mmPerUnit === null ? fit.shared : Math.min(mmPerUnit, fit.shared);
    for (const { placed, fit } of paper) {
      const scale = Math.min(mmPerUnit!, fit.own);
      scales.set(placed, { mmPerUnit: scale, frameMm: null, reduced: scale < mmPerUnit! * (1 - 1e-9) });
    }
  } else {
    // The paper in runs, by the mm per document unit; pictures with no paper
    // the same way by their frames, a run of their own.
    for (const kind of ['paper', 'fit'] as const) {
      const pictures = all.flatMap((placed) => {
        const fit = placed.step.picture?.kind === kind ? fitOf(placed) : null;
        return fit ? [{ placed, fit }] : [];
      });
      scaleRuns(pictures.map(({ fit }) => fit)).forEach(({ scale, reduced }, at) => {
        scales.set(pictures[at]!.placed, {
          mmPerUnit: kind === 'paper' ? scale : null,
          frameMm: kind === 'fit' ? scale : null,
          reduced,
        });
      });
    }
  }

  const pages: LayoutPage[] = placedPages.map((placed, pageIndex) => {
    const number = setup.pageNumbers.first + pageIndex;
    const cells: LayoutCell[] = placed.map((entry) => {
      const { step, index, x, y, box, text, overflow } = entry;
      const pictureX = x + (cellW - box) / 2;
      const pictureY = y + PICTURE_TOP_MM;
      const scale = scales.get(entry);
      const at = scale?.mmPerUnit ?? scale?.frameMm ?? null;
      // A picture taller at its scale than its box runs on down its room.
      const drawnH = at !== null && step.picture ? pictureExtent(step.picture, at).height : 0;
      const drawH = Math.min(Math.max(box, drawnH), roomH(entry));
      return {
        stepId: step.id,
        number: index + 1,
        cellMm: { x, y, w: cellW, h: cellH },
        pictureMm: { x: pictureX, y: pictureY, size: box },
        drawMm: { x: x + (cellW - roomW) / 2, y: pictureY, w: roomW, h: drawH },
        mmPerUnit: scale?.mmPerUnit ?? null,
        frameMm: scale?.frameMm ?? null,
        scaleReduced: scale?.reduced ?? false,
        numberAt: { x: x + STEP_NUMBER_INSET_MM, y: y + STEP_NUMBER_BASELINE_MM },
        text: {
          x: x + cellW * 0.1,
          firstBaseline: pictureY + drawH + TEXT_GAP_MM,
          widthMm: textWidth,
          lines: text.lines,
        },
        textOverflow: overflow,
      };
    });
    const band =
      flow && setup.showPath && cells.length > 0 ? flowBand(cells, pageIndex, placedPages.length, W, cellW) : null;
    const turns = placeTurns(placed.map(({ step }) => step), cells, setup.columns, flow, W);
    const right = number % 2 === 1;
    return {
      number,
      cells,
      band,
      turns,
      pageNumberAt: setup.pageNumbers.enabled
        ? { x: right ? W - m : m, y: H - m - PAGE_NUMBER_RAISE_MM, anchor: right ? 'end' : 'start' }
        : null,
    };
  });

  let titleLayout: DiagramPagesLayout['title'] = null;
  if (showTitle) {
    // Cut to the page: the tab never runs past the margin, nor the title past the tab.
    const line = setter.line(title.trim(), TITLE_SIZE_MM, 700, W - 2 * m - 2 * TAB_PADDING_MM);
    const tabW = line.widthMm + 2 * TAB_PADDING_MM;
    // With no margin the tab and the rule reach the paper's edge: they run on past it.
    const reach = m > 0 ? 0 : OFF_PAGE_MM;
    titleLayout = {
      tab: { x: m - reach, y: m - reach, w: tabW + reach, h: TAB_HEIGHT_MM + reach },
      textAt: { x: m + TAB_PADDING_MM, y: m + TITLE_BASELINE_MM },
      line,
      rule: { x1: m + tabW, x2: W - m + reach, y: m + TITLE_RULE_Y_MM },
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
 * Where the turns on a page print (D22): between two pictures on one row,
 * midway between them at their centres' height; before a picture that starts
 * a row or the page, at its leading edge — the right one on a flow row that
 * runs right to left; after the last picture, at its trailing edge. Several
 * in one place stand one above another, each glyph clear of the next, the
 * stack centred on the place. Kept on the paper.
 */
function placeTurns(
  steps: readonly LayoutStep[],
  cells: readonly LayoutCell[],
  columns: number,
  flow: boolean,
  pageWidth: number
): LayoutPage['turns'] {
  const placed: LayoutPage['turns'] = [];
  const rowOf = (k: number) => Math.floor(k / columns);
  const backwards = (k: number) => flow && rowOf(k) % 2 === 1;
  // The middle of the picture as drawn, which a tall one has lower than its box's.
  const centre = (cell: LayoutCell) => ({
    x: cell.pictureMm.x + cell.pictureMm.size / 2,
    y: cell.drawMm.y + cell.drawMm.h / 2,
  });
  /** The edge of a picture facing the gutter before (`lead`) or after it, half a gutter out. */
  const edge = (k: number, lead: boolean) => {
    const cell = cells[k]!;
    const gutter = cell.cellMm.w - cell.pictureMm.size;
    const left = lead !== backwards(k);
    const x = left ? cell.pictureMm.x - gutter / 2 : cell.pictureMm.x + cell.pictureMm.size + gutter / 2;
    return { x, y: centre(cell).y };
  };
  const stack = (turns: readonly LayoutTurn[], at: { x: number; y: number }, beforeStepId: string | null) => {
    const x = Math.min(pageWidth - TURN_GUTTER_MM / 2, Math.max(TURN_GUTTER_MM / 2, at.x));
    const boxes = turns.map((turn) => turnGlyphMm(turn.turn));
    const height = boxes.reduce((sum, box) => sum + box.h, 0) + (turns.length - 1) * TURN_STACK_CLEAR_MM;
    let top = at.y - height / 2;
    turns.forEach((turn, n) => {
      const box = boxes[n]!;
      placed.push({ ...turn, at: { x, y: top + box.h / 2 }, box, beforeStepId });
      top += box.h + TURN_STACK_CLEAR_MM;
    });
  };
  steps.forEach((step, k) => {
    if (step.turnsBefore.length > 0) {
      if (k > 0 && rowOf(k - 1) === rowOf(k)) {
        const a = centre(cells[k - 1]!);
        const b = centre(cells[k]!);
        const facing = (edge(k - 1, false).x + edge(k, true).x) / 2;
        stack(step.turnsBefore, { x: facing, y: (a.y + b.y) / 2 }, step.id);
      } else {
        stack(step.turnsBefore, edge(k, true), step.id);
      }
    }
    if (step.turnsAfter.length > 0) stack(step.turnsAfter, edge(k, false), null);
  });
  return placed;
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
    y: cell.drawMm.y + cell.drawMm.h / 2,
    row: Math.round((cell.cellMm.y - cells[0]!.cellMm.y) / cell.cellMm.h),
  }));
  const points: { x: number; y: number }[] = [];
  if (pageIndex > 0) points.push({ x: -OFF_PAGE_MM, y: centres[0]!.y });
  centres.forEach((a, n) => {
    points.push({ x: a.x, y: a.y });
    const b = centres[n + 1];
    if (b && b.row !== a.row) points.push({ x: a.x + (a.row % 2 ? -1 : 1) * cellW * 0.46, y: (a.y + b.y) / 2 });
  });
  const last = centres.at(-1)!;
  if (pageIndex < pageCount - 1) {
    points.push({ x: last.row % 2 ? -OFF_PAGE_MM : pageWidth + OFF_PAGE_MM, y: last.y });
  }
  return points;
}
