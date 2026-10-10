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
 * Every step is fitted (D10, "Fit each"), the paper keeping one scale from
 * step to step while it can ({@link scaleRuns}): a run of steps shares the
 * largest scale at which each fits its room, and a new run zooms in where the
 * model has grown much smaller, or out where it has grown for good. A picture
 * in a cell whose box gave room to text, and no longer fits there at its
 * run's scale, is drawn smaller, alone. Pictures with no paper — uploads, 3D
 * captures — keep one size of frame the same way.
 *
 * In the flow layout the rows turn back at each end, and each page's rows run
 * so that the lane carries on across a printed spread ({@link flowPagePlan}):
 * a right page the lane comes into at its spine reads from the bottom row up.
 * The lane is one smooth curve through the pictures ({@link flowLane}).
 *
 * A turn between two steps (D22) has no cell: its glyph prints in the gutter
 * between the two pictures — midway on a row; across a flow row's end, on the
 * lane in its bend between the rows; at the next picture's leading edge across a
 * grid's row or a page; at the last picture's trailing edge after it. A
 * diagram with any turn keeps a gutter wide enough between all its pictures,
 * so its one paper scale stays one scale; a step before a flow row's end with
 * turns after it keeps their room under its text, and only it gives way.
 *
 * An enlarged step (Revision 2) is laid out as its window — what its frame
 * takes in, of its content where its frame is cut — in runs of its own, never
 * the Fit each runs: as large as its room allows, at most six times the area
 * it enlarges as that prints, or at its Size times that ({@link zoomScales}).
 * The enlarge arrow before one, when the step before it shows an area, takes
 * a turn's places and gutter, after any turns standing there.
 *
 * Measurement is injected ({@link TextSetter}): the composer sets text from
 * the font's own advances, tests with an estimate.
 *
 * Pure.
 */
import type { DiagramPageSetup, DiagramPageSide, DiagramStepPlace, DiagramTurnKind } from '../document/diagramDocument';
import type { DiagramFontFace } from '../fonts/diagramFontFaces';
import {
  bendReach,
  bendXAt,
  flowLane,
  flowPagePlan,
  pageSide,
  rowRightToLeft,
  type FlowPagePlan,
  type Lane,
  type LaneStop,
} from './flowLane';
import { glyphSpot } from './glyphPacking';
import { packRibbon, rectangle, type PackingShape } from './ribbonPacking';
import { printPaper, type PrintPaper } from './printPaper';
import { normalizeStepPlace } from '../document/placeValues';
import { placeCell, placementClashes, type PageBox, type PlacementClash } from './pagePlacement';

/** The instruction's size and leading, mm. */
export const STEP_TEXT_SIZE_MM = 3.2;
export const STEP_TEXT_LEADING_MM = 4.1;
/** The step number: its size, and its baseline below the cell's top. */
export const STEP_NUMBER_SIZE_MM = 6.2;
const STEP_NUMBER_BASELINE_MM = 7;
const STEP_NUMBER_INSET_MM = 1.5;
/** The top of the step number below the cell's top: its figures stand under three quarters of its size. */
const STEP_NUMBER_TOP_MM = STEP_NUMBER_BASELINE_MM - 0.75 * STEP_NUMBER_SIZE_MM;
/** The picture box's top below the cell's top: under the number. */
export const PICTURE_TOP_MM = 8;
/** The most of a cell's height its picture box takes: the rest is its number and its text. */
export const PICTURE_HEIGHT_SHARE = 0.64;
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
 * What a change of scale between two steps costs, against how
 * much smaller than it could be each picture is drawn — the log of the
 * ratio, summed over the pictures (`scaleRuns`). One: as much as five
 * pictures drawn a fifth smaller, or one at under two fifths of its size.
 */
export const FIT_RUN_BREAK = 1;
/** Scales this near each other are one: the larger drawn at the smaller, wherever in the diagram. */
export const FIT_SAME = 1.06;
/**
 * The least change of scale from one step to the next: a
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
/**
 * Fill (Revision 2, Z4): an enlarged step prints as large as its room allows,
 * never smaller than the area it enlarges as that prints, nor more than six
 * times it; a Size is held the same.
 */
export const ZOOM_FILL = { min: 1, max: 6 } as const;

/** The box a turn's glyph prints in, in mm, centred on its place. */
export function turnGlyphMm(turn: DiagramTurnKind): { w: number; h: number } {
  if (turn.kind === 'rotate') return { w: ROTATE_GLYPH_MM, h: ROTATE_GLYPH_MM };
  const { long, short } = TURN_OVER_GLYPH_MM;
  return turn.axis === 'horizontal' ? { w: short, h: long } : { w: long, h: short };
}

/**
 * What stands in the gutter before a step: the turns between it and the step
 * before (D22), in order, then the enlarge arrow when one prints there
 * (Revision 2).
 */
type BetweenGlyph = ({ kind: 'turn' } & LayoutTurn) | { kind: 'enlarge'; arrowFrom: LayoutZoomArea };

/** The glyphs before a step, turns first. */
function glyphsBefore(step: LayoutStep): BetweenGlyph[] {
  const turns = step.turnsBefore.map((turn): BetweenGlyph => ({ kind: 'turn', ...turn }));
  const arrowFrom = step.zoom?.arrowFrom;
  return arrowFrom ? [...turns, { kind: 'enlarge', arrowFrom }] : turns;
}

/** The box a glyph prints in, in mm, centred on its place: an enlarge arrow's along its row, or aimed so. */
function glyphMm(glyph: BetweenGlyph, aim: LayoutArrowAim | null = null): { w: number; h: number } {
  if (glyph.kind === 'turn') return turnGlyphMm(glyph.turn);
  return aim ? glyph.arrowFrom.aimedBox(aim) : glyph.arrowFrom.box;
}

/**
 * How tall glyphs standing in one place are, one above another, each clear of
 * the next: an enlarge arrow at its tallest where it is `aimed` across a flow
 * row's end, before the layout knows which way.
 */
function stackHeight(glyphs: readonly BetweenGlyph[], aimed = false): number {
  const height = (glyph: BetweenGlyph) => (aimed && glyph.kind === 'enlarge' ? glyph.arrowFrom.tallest : glyphMm(glyph).h);
  return glyphs.reduce((sum, glyph) => sum + height(glyph), 0) + (glyphs.length - 1) * TURN_STACK_CLEAR_MM;
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
   * References step's letters — for its scale, in two parts: where
   * its marks lie, which grows with the picture — its width and height in
   * document units when it knows its paper (`paper`), or per its frame's
   * longer side when it is only fitted (`fit`) — and what they reach past
   * that at their pt size, in mm (`marks`). Its frame alone in the first
   * units. And where the reach lies: how far past each edge of the frame, in
   * the same two parts (`sides`; across, `width` is the frame's and the left
   * and right sides' growth together, `marks` their pt parts) — absent, its
   * marks are taken as even on both sides. Null for a step with no picture.
   *
   * An enlarged step's picture is its window (`zoom`): its frame the
   * content box — the window, or for a cut frame the paper inside it and the
   * boundary's pieces — in the window's units, its longer side one, its marks
   * as any picture's; drawn at the window's printed longer side, in mm.
   */
  picture: {
    kind: 'paper' | 'fit' | 'zoom';
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
  /** What sizes an enlarged step (Revision 2); absent on every other. */
  zoom?: LayoutZoom;
  /**
   * An enlarged step with no window to show yet — seeded by Insert Step
   * After, before its first picture lands its frame (Revision 2): it joins no
   * run of enlarged steps and parts none ({@link zoomScales}), and no arrow
   * prints before it. Absent on every other.
   */
  zoomPending?: true;
  /**
   * The step's hand placement (`implementation-plans/diagram-page-overrides.md`):
   * absent on a step placed by no one, a newer build's step, and one whose
   * placement only a newer build reads. Applied after the automatic layout,
   * before ribbon and symbol placement.
   */
  place?: DiagramStepPlace;
  /** Convex occupied paper, normalized to its frame. Absent for pictures whose ink cannot be bounded more closely. */
  footprint?: readonly { x: number; y: number }[];
}

/**
 * The enlarge area an arrow leaves: on which step, which area there, and its
 * longer side in that step's picture units; and the box the arrow prints in,
 * mm, as its outline paints it (`enlargeArrowSizes`), which this module,
 * laying out and never painting, is handed — along a row, aimed across a flow
 * row's end, and the tallest it is aimed any way.
 */
export interface LayoutZoomArea {
  stepId: string;
  areaId: string;
  share: number;
  box: { w: number; h: number };
  aimedBox: (aim: LayoutArrowAim) => { w: number; h: number };
  tallest: number;
}

/**
 * Which way an enlarge arrow points where it does not point along its row —
 * across a flow row's end, at the enlarged step it leads to (Zach,
 * 2026-10-07): the arrow that points right with its bow up, flipped about its
 * chord when `flipped` (its bow then on its right), turned `angle` radians
 * clockwise on the page, whose y runs down.
 */
export interface LayoutArrowAim {
  angle: number;
  flipped: boolean;
}

/**
 * What the layout needs of an enlarged step (Revision 2) to size it against
 * the area it enlarges, all derived from the document and never stored.
 */
export interface LayoutZoom {
  /**
   * The area the enlarge arrow before it leaves, when the step before it
   * shows one (`zoomIndex`); null where no arrow prints. What its size is
   * measured against.
   */
  arrowFrom: LayoutZoomArea | null;
  /** Its frame's longer side, in its whole picture's units. */
  frameShare: number;
  /** Its window's longer side, in its whole picture's units: one of the units it is laid out in. */
  windowShare: number;
  /**
   * Its whole picture, as the steps round it print theirs: by its pattern
   * units across its longer side when it knows its paper, else fitted. How
   * large its frame would print among them, with no arrow before it.
   */
  whole: { kind: 'paper'; units: number } | { kind: 'fit' };
  /** Its Size: so many times the area as it prints; null for Fill. */
  scale: number | null;
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
  homeMm?: PageBox;
  flowRow?: number;
  homeParts?: { number: PageBox; picture: PageBox; text: PageBox };
  numberMm?: PageBox;
  inkMm?: PageBox;
  rightToLeft?: boolean;
  placed?: {
    offsets: DiagramStepPlace;
    pin: 'applied' | 'kind' | 'empty' | null;
    auto: { mmPerUnit: number | null; frameMm: number | null; drawMm: PageBox };
  };
  clashes?: PlacementClash[];
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
   * The longer side a picture with no paper is drawn at, in mm, as its run
   * keeps it ({@link scaleRuns}) — an enlarged step's window's
   * ({@link zoomScales}). Null for a paper picture, and for a step with no
   * picture.
   */
  frameMm: number | null;
  /** The picture drawn smaller than its scale's run: its box gave room to text, or it reached too far. */
  scaleReduced: boolean;
  /**
   * An enlarged step's size against the area it enlarges (Revision 2): the
   * Size asked for (null for Fill), how many times the area it prints at, and
   * whether its room made it smaller than its run asked. Absent on a step that
   * is not enlarged, or one whose area's size is not known.
   */
  zoom?: { asked: number | null; printed: number; reduced: boolean };
  numberAt: { x: number; y: number };
  text: { x: number; firstBaseline: number; widthMm: number; lines: SetLine[] };
  /** The instruction did not fit even with the picture at its floor: it ends in "…". */
  textOverflow: boolean;
}

export interface LayoutPage {
  /** As printed: the setup's first number plus the page's index. */
  number: number;
  /** The side of its spread the page prints on: its number is at the outer corner. */
  side: DiagramPageSide;
  cells: LayoutCell[];
  /** The flow layout's lane, as drawn, or null. */
  band: Lane | null;
  flow?: Parameters<typeof flowLane>[0];
  /**
   * The turns on the page (D22), in the document's order: each glyph's centre
   * and printed box, the step it comes before — null for those after the last
   * step — and whether the row it stands in reads right to left, as every
   * other flow row does (which ones, the page's plan says).
   */
  turns: (LayoutTurn & {
    at: { x: number; y: number };
    box: { w: number; h: number };
    beforeStepId: string | null;
    rightToLeft: boolean;
  })[];
  /**
   * The enlarge arrows on the page (Revision 2), in order: each placed as a
   * turn's glyph would be before its enlarged step, after any turns there;
   * the area it leaves; whether it reads right to left; and whether it
   * stands alone in the gutter of a row it shares with the area's step, where
   * the page lifts it to the area's height (`composeDiagramPage`).
   */
  zoomArrows: LayoutZoomArrow[];
  pageNumberAt: { x: number; y: number; anchor: 'start' | 'end' } | null;
}

/** An enlarge arrow as the layout places it ({@link LayoutPage.zoomArrows}). */
export interface LayoutZoomArrow {
  at: { x: number; y: number };
  box: { w: number; h: number };
  beforeStepId: string;
  areaStepId: string;
  areaId: string;
  rightToLeft: boolean;
  liftable: boolean;
  /** Across a flow row's end, aimed at the enlarged step it leads to; null where it points along its row. */
  aim: LayoutArrowAim | null;
}

export interface DiagramPagesLayout {
  paper: PrintPaper;
  pages: LayoutPage[];
  cellMm: { w: number; h: number };
  /** The title tab, when shown. */
  title: {
    tab: { x: number; y: number; w: number; h: number };
    textAt: { x: number; y: number };
    line: SetLine;
    rule: { x1: number; x2: number; y: number };
  } | null;
  /** The band's width, for the flow layout's path: the page setup's (`DiagramPageSetup.pathWidthMm`). */
  bandWidthMm: number;
  /** The band's ink: the page setup's path colour. */
  bandInk: string;
}

/**
 * The columns and rows a flow page of `steps` steps is cut into, on a
 * printable `area` (mm): the column count that prints the largest pictures —
 * the picture box as {@link layoutDiagramPages} sizes it, the lesser of a
 * cell's width less the turn gutter and its height's picture share, a tie
 * going to fewer columns — and as many rows as the steps then fill, the last
 * one short where they do not fill it (7 steps on A4 are 3 · 3 · 1).
 *
 * Always the gutter a diagram with turns keeps, so a turn added or removed
 * never re-cuts a page. A landscape page takes wider rows than a portrait one.
 * Pure.
 */
export function flowShape(steps: number, area: { w: number; h: number }): { columns: number; rows: number } {
  const count = Math.max(1, Math.floor(steps));
  let best = { columns: 1, rows: count };
  let bestBox = -Infinity;
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const box = Math.min(area.w / columns - TURN_GUTTER_MM, (area.h / rows) * PICTURE_HEIGHT_SHARE);
    // Only a clearly larger picture takes more columns: a tie, to rounding, keeps the fewer.
    if (box > bestBox + 1e-9) {
      best = { columns, rows };
      bestBox = box;
    }
  }
  return best;
}

/**
 * The columns and rows a page's cells are cut into under a setup: what the
 * layout cuts its pages by, and what every count of a page's cells reads —
 * the page count, and which cell a step is in (`stepPlaces.ts`). A grid's are
 * its own; a flow page's are {@link flowShape}'s for its steps per page, on
 * the paper inside its margins.
 *
 * Read from the setup alone, never the title, and never less the header and
 * the footer: typing a title or turning page numbers on never re-cuts a page
 * (`implementation-plans/diagram-page-overrides.md`, Phase 1b).
 */
export function pageGrid(setup: DiagramPageSetup): { columns: number; rows: number } {
  if (setup.layout !== 'flow') return { columns: setup.columns, rows: setup.rows };
  const { widthMm: W, heightMm: H, marginMm: m } = printPaper(setup);
  return flowShape(setup.stepsPerPage, { w: W - 2 * m, h: H - 2 * m });
}

/**
 * How many steps a page holds under a setup: a grid's every cell
 * ({@link pageGrid}); a flow page its steps per page, which a short last row
 * makes fewer than its cells.
 */
export function cellsPerPage(setup: DiagramPageSetup): number {
  if (setup.layout === 'flow') return setup.stepsPerPage;
  const { columns, rows } = pageGrid(setup);
  return columns * rows;
}

/** The size of a page's cells under a setup: the page inside its margins, less the header and footer, cut into columns and rows. */
export function pageCellMm(setup: DiagramPageSetup, title: string): { w: number; h: number } {
  const { widthMm: W, heightMm: H, marginMm: m } = printPaper(setup);
  const headH = setup.showTitle && title.trim() !== '' ? HEADER_MM : 0;
  const footH = setup.pageNumbers.enabled ? FOOTER_MM : 0;
  const { columns, rows } = pageGrid(setup);
  return { w: (W - 2 * m) / columns, h: (H - 2 * m - headH - footH) / rows };
}

/**
 * The largest scale at which a picture fits its cell's room: with its text
 * in full (`own`), and for the runs, with a long text's cut to its box left
 * aside (`shared`) — such a picture is drawn smaller alone.
 */
export interface ScaleFit {
  own: number;
  shared: number;
}

/**
 * The scale each picture is drawn at, in order, so that the
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
 * some zooms under another's — under a run under another run — but never a
 * whole zoom under its own smallest: a
 * run that small would be there only to part the runs either side, letting
 * them differ by less than a zoom. The least-cost cut and scales among those
 * are found exactly (dynamic programming over where the last run starts and
 * its scale), read from the same end whichever is given, so where cuts tie
 * the same one is cut; a diagram that reads the same from either end is drawn
 * so ({@link mirroredRuns}).
 *
 * Runs whose scales are within {@link FIT_SAME} are then drawn at one,
 * wherever in the diagram, where that keeps each a zoom from its neighbours.
 * A picture is drawn at its run's scale, or its own when that is smaller
 * (`reduced`: a long instruction took its room). Pure.
 */
/**
 * The scales a run may be drawn at, as logs in order, each with the scale it
 * is: a picture's own, or any number of zooms under one — a run held a zoom
 * under one held a zoom under another — down to where no run could be drawn,
 * a whole zoom under the smallest picture. Only those some picture is less
 * than a zoom above: a run is never a whole zoom under all its pictures, so
 * no other can end one, and one fit far under the rest — a picture drawn at
 * nearly nothing — would otherwise add a level for every zoom between.
 */
export function runLevels(shares: readonly number[]): { levels: number[]; scaleAt: Map<number, number> } {
  const logs = shares.map(Math.log);
  const zoom = Math.log(FIT_ZOOM);
  const apart = zoom * (1 - 1e-9);
  const scaleAt = new Map<number, number>();
  shares.forEach((share, index) => scaleAt.set(logs[index]!, share));
  const real = logs.filter((_, index) => shares[index] !== Number.MIN_VALUE);
  const deepest = (real.length > 0 ? Math.min(...real) : 0) - apart;
  const sorted = [...logs].sort((a, b) => a - b);
  shares.forEach((share, index) => {
    for (let k = 1; logs[index]! - k * zoom > deepest; k += 1) {
      const level = logs[index]! - k * zoom;
      if (scaleAt.has(level)) continue;
      // A picture at or above the level and less than a zoom above it.
      if (!(sorted[firstAtLeast(sorted, level)]! < level + apart)) continue;
      scaleAt.set(level, share / FIT_ZOOM ** k);
    }
  });
  return { levels: [...scaleAt.keys()].sort((a, b) => a - b), scaleAt };
}

/** The first index of ascending `sorted` whose value is at least `value`; its length when none is. */
function firstAtLeast(sorted: readonly number[], value: number): number {
  let [low, high] = [0, sorted.length];
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** How near, as a share, two fits are that differ only by rounding. */
const MIRROR_SAME = 1e-9;

export function scaleRuns(fits: readonly ScaleFit[]): { scale: number; reduced: boolean }[] {
  const count = fits.length;
  if (count === 0) return [];
  // A fit of nothing — a room of no size — is a picture drawn at nothing, alone.
  const given = fits.map(({ shared }) => (Number.isFinite(shared) && shared > 0 ? shared : Number.MIN_VALUE));
  // A picture and its mirror that fit alike but for rounding — the same
  // picture in a room a row lower, its height a few ulps off — fit the same,
  // the smaller: so a diagram that reads the same either way is drawn so.
  const shares = given.map((share, index) => {
    const mirror = given[count - 1 - index]!;
    return Math.abs(share - mirror) <= MIRROR_SAME * Math.max(share, mirror) ? Math.min(share, mirror) : share;
  });
  // Read from one end whichever end is given — the one whose first picture
  // unlike its mirror's is the smaller — so where cuts tie, the same is cut.
  const turn = shares.findIndex((share, index) => share !== shares[count - 1 - index]);
  if (turn >= 0 && shares[turn]! > shares[count - 1 - turn]!) return scaleRuns([...fits].reverse()).reverse();
  const logs = shares.map(Math.log);
  const zoom = Math.log(FIT_ZOOM);
  const apart = zoom * (1 - 1e-9);
  const { levels, scaleAt } = runLevels(shares);
  const width = levels.length;
  // For each level, the highest a zoom or more below it and the lowest a zoom or more above it.
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
  // Per level, the runs that may end at the next picture, by where they
  // start: since the last picture too small for the level, each keyed by
  // what it costs before its own pictures (`earlier − S(start) + start ×
  // level`, S the logs before a picture), so that one running best per level
  // stands for them all. A run is never drawn a whole zoom under its own
  // smallest picture — it would only part the runs either side, a step drawn
  // small to let them differ by less — so a start waits (`pending`) until its
  // run holds a picture less than a zoom above the level (`eligible`).
  const eligible = new Float64Array(width).fill(Infinity);
  const eligibleAt = new Int32Array(width).fill(-1);
  const pending = new Float64Array(width).fill(Infinity);
  const pendingAt = new Int32Array(width).fill(-1);
  let total = 0;
  for (let j = 1; j <= count; j += 1) {
    const i = j - 1;
    for (let v = 0; v < width; v += 1) {
      const level = levels[v]!;
      if (level > logs[i]!) {
        // A picture too small for the level: no run at it goes past it.
        eligible[v] = pending[v] = Infinity;
        eligibleAt[v] = pendingAt[v] = -1;
        continue;
      }
      const earlier = i === 0 ? 0 : next[i * width + v]! + FIT_RUN_BREAK;
      if (earlier < Infinity) {
        const key = earlier - total + i * level;
        // The later start on a tie: the shorter last run.
        if (key <= pending[v]!) {
          pending[v] = key;
          pendingAt[v] = i;
        }
      }
      if (logs[i]! < level + apart) {
        if (pending[v]! <= eligible[v]!) {
          eligible[v] = pending[v]!;
          eligibleAt[v] = pendingAt[v]!;
        }
        pending[v] = Infinity;
        pendingAt[v] = -1;
      }
      const start = eligibleAt[v]!;
      if (start < 0) continue;
      const at = j * width + v;
      best[at] = eligible[v]! + total + logs[i]! - j * level;
      from[at] = start;
      before[at] = start === 0 ? -1 : nextAt[start * width + v]!;
    }
    total += logs[i]!;
    if (j < count) ended(j);
  }
  // The cheapest end, the larger scale on a tie.
  let level = width - 1;
  for (let v = width - 1; v >= 0; v -= 1) if (best[count * width + v]! < best[count * width + level]!) level = v;
  let runs: { from: number; to: number; scale: number }[] = [];
  for (let j = count; j > 0; ) {
    const at = j * width + level;
    runs.unshift({ from: from[at]!, to: j, scale: scaleAt.get(levels[level]!)! });
    j = from[at]!;
    level = before[at]!;
  }
  if (turn < 0) runs = mirroredRuns(runs, logs);

  // Near enough is one, wherever in the diagram: each scale joins the
  // smallest within FIT_SAME below it that leads its own, so a chain of near
  // scales does not drift down. A run takes it only where it still reads as a
  // zoom from each neighbour, as drawn and as snapped, and is still less than
  // a whole zoom under its own smallest picture, as the cut keeps it — every
  // run decided at once, so the answer does not depend on which end is read
  // first.
  const leaders = new Map<number, number>();
  let leader = -Infinity;
  for (const scale of [...new Set(runs.map(({ scale }) => scale))].sort((a, b) => a - b)) {
    if (!(scale <= leader * FIT_SAME)) leader = scale;
    leaders.set(scale, leader);
  }
  const reads = (a: number, b: number) => a === b || Math.max(a, b) / Math.min(a, b) >= FIT_ZOOM * (1 - 1e-9);
  const snapped = runs.map(({ scale }) => leaders.get(scale)!);
  const holds = runs.map(({ from, to }, k) => {
    let smallest = Infinity;
    for (let i = from; i < to; i += 1) smallest = Math.min(smallest, logs[i]!);
    return Math.log(snapped[k]!) > smallest - apart;
  });
  const taken = runs.map(
    (_, k) =>
      holds[k]! &&
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
 * A diagram that reads the same from either end, drawn so: the runs' half
 * nearer one end mirrored onto the other, whichever half costs least so. A
 * cut of least cost has two halves, and the drawings each half makes alone,
 * mirrored, cost twice that half — so one of them costs no more than the cut
 * itself, and is one of least cost too. The first half on a tie.
 */
function mirroredRuns(
  runs: { from: number; to: number; scale: number }[],
  logs: readonly number[]
): { from: number; to: number; scale: number }[] {
  const count = logs.length;
  const drawn = new Float64Array(count);
  for (const { from, to, scale } of runs) drawn.fill(scale, from, to);
  const mirrored = (nearer: (k: number, mirror: number) => number) =>
    Array.from({ length: count }, (_, k) => drawn[nearer(k, count - 1 - k)]!);
  const costOf = (scales: number[]) =>
    scales.reduce((sum, scale, k) => sum + logs[k]! - Math.log(scale) + (k > 0 && scale !== scales[k - 1] ? FIT_RUN_BREAK : 0), 0);
  const [first, last] = [mirrored(Math.min), mirrored(Math.max)];
  const chosen = costOf(last) < costOf(first) ? last : first;
  const out: { from: number; to: number; scale: number }[] = [];
  chosen.forEach((scale, k) => {
    if (k > 0 && scale === chosen[k - 1]) out[out.length - 1]!.to = k + 1;
    else out.push({ from: k, to: k + 1, scale });
  });
  return out;
}

/**
 * The largest scale at which a picture fits a room `across` × `down` mm, in
 * mm per its unit, each way ({@link overrunFit}): its reach in the room
 * where it can be, and where it cannot — marks at their pt size larger than
 * the room — reaching out of it as little as it can, evenly, the paper as
 * large as that allows; never shrinking the paper for its marks past where
 * what grows with it takes {@link MARKS_FLOOR} of the room, nor letting the
 * paper itself out of it. Its reach as measured, near the scale it was
 * measured at; where it lies, by side, when measured (`sides`), else even.
 * Past the room, a `lip` each way the reach may hang into for nothing (a
 * step file's canvas round its box), and the scales sought from `from` up
 * rather than from the floor. Null for no picture, or one with no size.
 */
export function pictureFit(
  picture: LayoutStep['picture'],
  across: number,
  down: number,
  options: { lip?: { across: number; down: number }; from?: number } = {}
): number | null {
  if (!picture) return null;
  const sides = picture.sides ?? evenSides(picture);
  const { lip = { across: 0, down: 0 }, from } = options;
  const fit = Math.min(
    overrunFit(across, picture.frame.width, sides.left, sides.right, lip.across, from),
    overrunFit(down, picture.frame.height, sides.top, sides.bottom, lip.down, from)
  );
  return Number.isFinite(fit) && fit >= 0 ? fit : null;
}

/**
 * How far a picture's reach, measured at `scale`, hangs out of a room
 * `across` × `down` mm when drawn there, the more of the two ways, placed as
 * the page places it ({@link overrunFit}): nothing when it fits.
 */
export function pictureOverrun(picture: NonNullable<LayoutStep['picture']>, across: number, down: number, scale: number): number {
  const sides = picture.sides ?? evenSides(picture);
  const way = (room: number, frame: number, before: ReachLine, after: ReachLine) =>
    Math.max(...overrunLines(room, frame, before, after, 0).map(({ slope, at }) => slope * scale + at));
  return Math.max(way(across, picture.frame.width, sides.left, sides.right), way(down, picture.frame.height, sides.top, sides.bottom));
}

/**
 * The least scale {@link pictureFit} may draw a picture at in a room, as
 * measured: where what grows with it takes {@link MARKS_FLOOR} of the room
 * the way that lets it shrink further.
 */
export function pictureFloor(picture: NonNullable<LayoutStep['picture']>, across: number, down: number): number {
  const sides = picture.sides ?? evenSides(picture);
  return Math.min(
    overrunFloor(across, picture.frame.width, sides.left, sides.right),
    overrunFloor(down, picture.frame.height, sides.top, sides.bottom)
  );
}

/** A picture's reach past each edge when only its whole is known: half on either side. */
function evenSides(picture: NonNullable<LayoutStep['picture']>): ReachSides {
  const half = (grows: number, frame: number, beyond: number): ReachLine => ({ grows: (grows - frame) / 2, beyond: beyond / 2 });
  const across = half(picture.width, picture.frame.width, picture.marks.width);
  const down = half(picture.height, picture.frame.height, picture.marks.height);
  return { left: across, right: across, top: down, bottom: down };
}

/** A line in the scale: `slope × scale + at`. */
interface ScaleLine {
  slope: number;
  at: number;
}

/**
 * The largest scale, one way, at which a picture's reach hangs past its room
 * `room` mm (and a `lip` either side it may reach into for nothing) the
 * least it can, from its floor — what grows with the picture taking half the
 * room, or the paper half of it where nothing grows; or from `from`, when
 * given — to the paper filling the room. So a reach that fits is as large as
 * fits; marks larger than the room even at the floor leave the paper at the
 * floor; and a glyph larger
 * than the paper, which no scale makes smaller, leaves it as large as its
 * room where the glyph is centred on it, and as large as still lets the
 * reach be centred where it is not, rather than hang all over one side.
 *
 * The reach is placed as the page places it (`settle` in pagePictures.ts):
 * the paper in its room, the reach centred as far as that lets. Its frame
 * `frame` per scale, and past it `before` and `after`, each at least nothing;
 * the most it then hangs out on either side, with `a` past the near edge
 * and `b` past the far one, the paper `p` and the room `h`, is
 * `max(0, (a + b)/2, b, a − (h − p))` — the largest of lines in the scale,
 * so it is least, and stays least up to a point, as convex functions are.
 */
export function overrunFit(room: number, frame: number, before: ReachLine, after: ReachLine, lip = 0, from?: number): number {
  if (![room, frame, before.grows, before.beyond, after.grows, after.beyond, lip].every(Number.isFinite)) return Number.NaN;
  const paper = frame > 0 ? room / frame : Infinity;
  const floor = Math.min(paper, from ?? overrunFloor(room, frame, before, after));
  if (!(floor < Infinity)) return paper;
  const lines = overrunLines(room, frame, before, after, lip);
  const overrun = (scale: number) => Math.max(...lines.map(({ slope, at }) => slope * scale + at));
  // The least it hangs out: at an end, or where two lines cross.
  let least = overrun(floor);
  if (paper < Infinity) least = Math.min(least, overrun(paper));
  lines.forEach((one, i) =>
    lines.slice(i + 1).forEach((other) => {
      if (one.slope === other.slope) return;
      const crossing = (other.at - one.at) / (one.slope - other.slope);
      if (crossing > floor && crossing < paper) least = Math.min(least, overrun(crossing));
    })
  );
  // The largest scale at which no line is more than that.
  const tolerance = 1e-12 * Math.max(room, 1);
  let largest = paper;
  for (const { slope, at } of lines) if (slope > 0) largest = Math.min(largest, (least + tolerance - at) / slope);
  return Math.max(floor, largest);
}

/** One way's floor ({@link overrunFit}): what grows with the picture taking half the room, or the paper half of it where nothing grows; never past the paper filling it. */
function overrunFloor(room: number, frame: number, before: ReachLine, after: ReachLine): number {
  const paper = frame > 0 ? room / frame : Infinity;
  return Math.min(paper, ((1 - MARKS_FLOOR) * room) / Math.max(frame + before.grows + after.grows, frame));
}

/** One way's overrun as lines in the scale ({@link overrunFit}): the most of them is how far the reach hangs out. */
function overrunLines(room: number, frame: number, before: ReachLine, after: ReachLine, lip: number): ScaleLine[] {
  // Each side's reach, at least nothing: its line or none, whichever is more.
  const nears: ScaleLine[] = [
    { slope: 0, at: 0 },
    { slope: before.grows, at: before.beyond },
  ];
  const fars: ScaleLine[] = [
    { slope: 0, at: 0 },
    { slope: after.grows, at: after.beyond },
  ];
  const lines: ScaleLine[] = [{ slope: 0, at: 0 }];
  for (const near of nears) {
    // Past the near edge with the far one met: the paper at the room's far side.
    lines.push({ slope: frame + near.slope, at: near.at - room - lip });
    for (const far of fars) {
      // The reach centred: the room's overrun, split.
      lines.push({ slope: (near.slope + far.slope + frame) / 2, at: (near.at + far.at - room - 2 * lip) / 2 });
    }
  }
  // Past the far edge with the near one met.
  for (const far of fars) lines.push({ slope: frame + far.slope, at: far.at - room - lip });
  return lines;
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
  const { w: cellW, h: cellH } = pageCellMm(setup, title);
  const bandWidthMm = setup.pathWidthMm;
  // An enlarge arrow stands where a turn would, and keeps the gutter a turn keeps.
  const turning = steps.some(
    (step) => step.turnsBefore.length > 0 || step.turnsAfter.length > 0 || Boolean(step.zoom?.arrowFrom)
  );
  // A turn at a row's end prints in the half gutter outside the outer picture,
  // which a narrow margin cannot give: the boxes give up what it lacks.
  const outerShortfall = turning ? Math.max(0, TURN_GUTTER_MM / 2 - m) : 0;
  // A picture's room across the cell: the cell less the gutter between pictures.
  const roomW = Math.max(12, cellW - (turning ? TURN_GUTTER_MM : PICTURE_SIDE_ROOM_MM) - 2 * outerShortfall);
  const fullBox = Math.max(12, Math.min(roomW, cellH * PICTURE_HEIGHT_SHARE));
  const textWidth = cellW * 0.8;
  const { columns, rows } = pageGrid(setup);
  const perPage = cellsPerPage(setup);

  const pagesOfSteps = splitIntoPages(steps, perPage).map((page) =>
    page.map((index) => ({ step: steps[index]!, index }))
  );
  // Which way each page's rows run: in a grid, down and left to right; in a
  // flow, so that the lane carries on across each spread.
  const plans: FlowPagePlan[] = pagesOfSteps.map((_, pageIndex) =>
    flow
      ? flowPagePlan(pageIndex, pagesOfSteps.length, setup.firstPageSide, rows)
      : { side: pageSide(pageIndex, setup.firstPageSide), up: false, firstRightToLeft: false, entry: 'none', exit: 'none' }
  );

  // Each cell's box and text, before the scale is known.
  interface Placed {
    step: LayoutStep;
    index: number;
    x: number;
    y: number;
    /** How far down the page the text's last line may sit. */
    slot: number;
    box: number;
    text: SetText;
    overflow: boolean;
    packed?: { cx: number; cy: number; row: number; scale: number; width: number };
  }
  /**
   * The top-left of a page's `k`th cell: rows down the page, or up it; a flow
   * row that runs right to left from the right, every other cell lower.
   */
  const cellAt = (plan: FlowPagePlan, k: number) => {
    const row = Math.floor(k / columns);
    const k0 = k % columns;
    const col = flow && rowRightToLeft(plan, row) ? columns - 1 - k0 : k0;
    const down = plan.up ? rows - 1 - row : row;
    return { x: m + col * cellW, y: m + headH + down * cellH + (flow && k0 % 2 === 1 ? cellH * FLOW_STEP : 0) };
  };
  /** How far down the page the text of a page's `k`th cell may sit, by its cell. */
  const cellFoot = (plan: FlowPagePlan, k: number) =>
    cellAt(plan, k).y + cellH * (flow ? 1 - FLOW_STEP : 1) - TEXT_DESCENT_MM;
  /**
   * The same, over a flow row break with turns at it: above their room over
   * the number of the step under it, clear of both (`placeTurns`). The break
   * under a cell is after it on a page read down, before it on one read up.
   */
  const slotBottom = (entries: readonly { step: LayoutStep }[], k: number, plan: FlowPagePlan) => {
    const own = cellFoot(plan, k);
    const after = plan.up ? k : k + 1;
    const next = after > 0 ? entries[after]?.step : undefined;
    const glyphs = next ? glyphsBefore(next) : [];
    if (!flow || glyphs.length === 0 || after % columns !== 0) return own;
    const under = plan.up ? after - 1 : after;
    const room = stackHeight(glyphs, true) + 2 * TURN_STACK_CLEAR_MM;
    return Math.min(own, cellAt(plan, under).y + STEP_NUMBER_TOP_MM - room - TEXT_DESCENT_MM);
  };
  const firstBaselineOf = (cellTop: number, box: number) => cellTop + PICTURE_TOP_MM + box + TEXT_GAP_MM;
  /** How many lines fit between a box and the foot of its slot. */
  const slotLines = (slot: number, cellTop: number, box: number) =>
    Math.max(0, Math.floor((slot - firstBaselineOf(cellTop, box)) / STEP_TEXT_LEADING_MM + 1e-9) + 1);
  const placedPages: Placed[][] = pagesOfSteps.map((entries, pageIndex) =>
    entries.map(({ step, index }, k) => {
      const plan = plans[pageIndex]!;
      const { x, y } = cellAt(plan, k);
      const slot = slotBottom(entries, k, plan);
      let box = fullBox;
      const full = setter.paragraph(step.text, textWidth, STEP_TEXT_SIZE_MM, Number.MAX_SAFE_INTEGER);
      let maxLines = slotLines(slot, y, box);
      if (full.linesNeeded > maxLines) {
        // Text first: the picture gives up the room the text's last line is
        // short of — measured, not counted in lines, since a slot can be
        // short of more than it holds — down to its floor.
        const lastBaseline = firstBaselineOf(y, box) + (full.linesNeeded - 1) * STEP_TEXT_LEADING_MM;
        box = Math.max(fullBox * PICTURE_FLOOR, box - (lastBaseline - slot));
        maxLines = slotLines(slot, y, box);
        if (maxLines === 0) {
          // A cell so short that half a picture leaves no line at all: the
          // picture gives way further, for one line — a cut instruction says
          // so; a missing one says nothing.
          box = Math.max(0, slot - (firstBaselineOf(y, box) - box));
          maxLines = slotLines(slot, y, box);
        }
      } else if (full.linesNeeded === 0 && slot < cellFoot(plan, k)) {
        // No text, and turns kept under it: the picture ends where text would, above them.
        box = Math.max(0, Math.min(box, slot + TEXT_DESCENT_MM - (y + PICTURE_TOP_MM)));
      }
      const text =
        full.linesNeeded <= maxLines ? full : setter.paragraph(step.text, textWidth, STEP_TEXT_SIZE_MM, maxLines);
      return { step, index, x, y, slot, box, text, overflow: full.linesNeeded > maxLines };
    })
  );

  if (flow) {
    const paperUnits = steps.flatMap((step) => step.picture?.kind === 'paper' ? [Math.max(step.picture.frame.width, step.picture.frame.height)] : []).sort((a, b) => a - b);
    const units = paperUnits[Math.floor(paperUnits.length / 2)] ?? 1;
    placedPages.forEach((entries, pageIndex) => {
      if (!entries.length) return;
      const plan = plans[pageIndex]!;
      const metricCache = new Map<Placed, Map<number, { scale: number; extent: { width: number; height: number }; width: number; text: Placed['text']; shape: PackingShape }>>();
      const metrics = (entry: Placed, size: number) => {
        let sizes = metricCache.get(entry);
        if (!sizes) { sizes = new Map(); metricCache.set(entry, sizes); }
        const cached = sizes.get(size);
        if (cached) return cached;
        const picture = entry.step.picture;
        const scale = size / (picture?.kind === 'paper' ? units : 1);
        const extent = picture ? pictureExtent(picture, scale) : { width: size, height: size };
        const width = Math.max(24, extent.width * .9);
        const text = setter.paragraph(entry.step.text, width, STEP_TEXT_SIZE_MM, 8);
        const textHeight = text.lines.length ? 2 + text.lines.length * STEP_TEXT_LEADING_MM + TEXT_DESCENT_MM : 0;
        const picturePolygon = entry.step.footprint?.length && picture
          ? entry.step.footprint.map((p) => ({ x: (p.x - .5) * extent.width, y: (p.y - .5) * extent.height }))
          : rectangle(-extent.width / 2, -extent.height / 2, extent.width, extent.height);
        const numberWidth = setter.line(String(entry.index + 1), STEP_NUMBER_SIZE_MM, 700).widthMm;
        const left = Math.min(-extent.width / 2 - numberWidth - 2, -width / 2);
        const right = Math.max(extent.width / 2, width / 2);
        const shape: PackingShape = {
          picture: picturePolygon,
          polygons: [picturePolygon, rectangle(-extent.width / 2 - numberWidth - 2, -extent.height / 2, numberWidth, STEP_NUMBER_SIZE_MM),
            ...(text.lines.length ? [rectangle(-width / 2, extent.height / 2 + 2, width, textHeight - 2)] : [])],
          bounds: { x: left, y: -extent.height / 2, w: right - left, h: extent.height + textHeight },
        };
        const value = { scale, extent, width, text, shape };
        sizes.set(size, value);
        return value;
      };
      const packed = packRibbon({
        count: entries.length,
        area: { x: m + (turning ? TURN_GUTTER_MM + 2 : 3), y: m + headH + 2, w: W - 2 * m - (turning ? 2 * (TURN_GUTTER_MM + 2) : 6), h: H - 2 * m - headH - (setup.pageNumbers.enabled ? FOOTER_MM : 0) - 4 },
        shape: (i, size) => metrics(entries[i]!, size).shape,
        oddRows: plan.exit === 'spine', up: plan.up,
        clearance: turning ? TURN_GUTTER_MM + 2 : undefined, halfWidth: bandWidthMm / 2,
      });
      if (!packed) return;
      plans[pageIndex] = { ...flowPagePlan(pageIndex, pagesOfSteps.length, setup.firstPageSide, packed.rows), firstRightToLeft: false };
      entries.forEach((entry, i) => {
        const stop = packed.stops[i]!, value = metrics(entry, packed.size);
        entry.packed = { cx: stop.x, cy: stop.y, row: stop.row, scale: value.scale, width: value.width };
        entry.text = value.text;
        entry.overflow = value.text.linesNeeded > value.text.lines.length;
      });
    });
  }

  // Each picture's room: across, the cell less its gutter; down, what its
  // text leaves, at least its box. It fits where both its sides do.
  const roomH = ({ y, slot, box, text }: Placed) =>
    Math.max(
      box,
      slot -
        (y + PICTURE_TOP_MM) -
        (text.lines.length > 0 ? TEXT_GAP_MM + (text.lines.length - 1) * STEP_TEXT_LEADING_MM : 0)
    );
  const fitOf = ({ step, ...placed }: Placed): ScaleFit | null => {
    if (placed.packed) return step.picture ? { own: Math.min(placed.packed.scale, step.atMost ?? Infinity), shared: placed.packed.scale } : null;
    const down = roomH({ step, ...placed });
    const fit = (across: number, room: number) => (step.fitIn ? step.fitIn(across, room) : pictureFit(step.picture, across, room));
    const own = fit(roomW, down);
    const shared = fit(roomW, Math.max(down, fullBox));
    if (own !== null && step.atMost !== undefined) return shared === null ? null : { own: Math.min(own, step.atMost), shared };
    return own === null || shared === null ? null : { own, shared };
  };
  const scales = new Map<Placed, { mmPerUnit: number | null; frameMm: number | null; reduced: boolean }>();
  const all = placedPages.flat();
  // The paper in runs, by the mm per document unit; pictures with no paper
  // the same way by their frames, a run of their own. An enlarged step's
  // window is neither: no run takes it, or a lone enlargement would join its
  // neighbours' run and change their size.
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
  const autoScales = new Map(scales);
  const pinStates = new Map<Placed, 'applied' | 'kind' | 'empty'>();
  for (const entry of all) {
    const pin = entry.step.place?.scale;
    if (!pin) continue;
    const picture = entry.step.picture;
    if (!picture) { pinStates.set(entry, 'empty'); continue; }
    const paperPin = 'mmPerUnit' in pin;
    if (entry.step.zoom || (picture.kind === 'paper') !== paperPin) { pinStates.set(entry, 'kind'); continue; }
    const units = paperPin ? Math.max(picture.frame.width, picture.frame.height) : 1;
    const value = Math.max(4, Math.min(Math.max(W, H) - 2 * m, (paperPin ? pin.mmPerUnit : pin.frameMm) * units)) / units;
    scales.set(entry, { mmPerUnit: paperPin ? value : null, frameMm: paperPin ? null : value, reduced: false });
    pinStates.set(entry, 'applied');
  }
  // Then the enlarged steps, every other scale known: an area's step may be on an earlier page, or after.
  const zoomed = zoomScales(all, fitOf, scales, fullBox);

  const cellPages: LayoutCell[][] = placedPages.map((placed, pageIndex) =>
    placed.map((entry, k) => {
      const { step, index, x, y, box, text, overflow } = entry;
      const pictureX = x + (cellW - box) / 2;
      const pictureY = y + PICTURE_TOP_MM;
      const scale = scales.get(entry);
      const at = scale?.mmPerUnit ?? scale?.frameMm ?? null;
      // A picture taller at its scale than its box runs on down its room.
      const drawnH = at !== null && step.picture ? pictureExtent(step.picture, at).height : 0;
      const pin = pinStates.get(entry) ?? null;
      const explicitSize = step.zoom?.scale !== null && step.zoom?.scale !== undefined;
      const unrestricted = pin === 'applied' || explicitSize;
      const drawH = unrestricted ? drawnH : Math.min(Math.max(box, drawnH), roomH(entry));
      const extent = at !== null && step.picture ? pictureExtent(step.picture, at) : { width: box, height: box };
      const drawW = unrestricted ? Math.max(roomW, extent.width) : roomW;
      const auto = autoScales.get(entry);
      const autoAt = auto?.mmPerUnit ?? auto?.frameMm ?? null;
      const autoH = autoAt !== null && step.picture ? pictureExtent(step.picture, autoAt).height : 0;
      const place = normalizeStepPlace(step.place);
      const cell: LayoutCell = {
        stepId: step.id,
        number: index + 1,
        cellMm: { x, y, w: cellW, h: cellH },
        pictureMm: { x: pictureX, y: pictureY, size: box },
        drawMm: { x: x + (cellW - drawW) / 2, y: pictureY, w: drawW, h: drawH },
        inkMm: { x: x + (cellW - extent.width) / 2, y: pictureY + (drawH - extent.height) / 2, w: extent.width, h: extent.height },
        ...(place ? { placed: { offsets: place, pin, auto: { mmPerUnit: auto?.mmPerUnit ?? null, frameMm: auto?.frameMm ?? null, drawMm: { x: x + (cellW - roomW) / 2, y: pictureY, w: roomW, h: Math.min(Math.max(box, autoH), roomH(entry)) } } } } : {}),
        mmPerUnit: scale?.mmPerUnit ?? null,
        frameMm: scale?.frameMm ?? null,
        scaleReduced: scale?.reduced ?? false,
        ...(zoomed.has(entry) ? { zoom: zoomed.get(entry)! } : {}),
        numberAt: { x: x + STEP_NUMBER_INSET_MM, y: y + STEP_NUMBER_BASELINE_MM },
        text: {
          x: x + cellW * 0.1,
          firstBaseline: pictureY + drawH + TEXT_GAP_MM,
          widthMm: textWidth,
          lines: text.lines,
        },
        textOverflow: overflow,
      };
      if (entry.packed) {
        const packed = entry.packed;
        const autoExtent = step.picture ? pictureExtent(step.picture, autoAt ?? packed.scale) : { width: box, height: box };
        const actual = step.picture ? extent : autoExtent;
        const draw = { x: packed.cx - actual.width / 2, y: packed.cy - autoExtent.height / 2, w: actual.width, h: actual.height };
        const numberWidth = setter.line(String(index + 1), STEP_NUMBER_SIZE_MM, 700).widthMm;
        cell.flowRow = packed.row;
        cell.cellMm = { x: packed.cx - autoExtent.width / 2 - numberWidth - 2, y: packed.cy - autoExtent.height / 2,
          w: autoExtent.width + numberWidth + 2, h: autoExtent.height + (text.lines.length ? TEXT_GAP_MM + (text.lines.length - 1) * STEP_TEXT_LEADING_MM + TEXT_DESCENT_MM : 0) };
        cell.drawMm = draw;
        cell.inkMm = { ...draw };
        cell.pictureMm = { x: packed.cx - Math.min(actual.width, actual.height) / 2, y: draw.y, size: Math.min(actual.width, actual.height) };
        cell.numberAt = { x: packed.cx - autoExtent.width / 2 - numberWidth - 2, y: packed.cy - autoExtent.height / 2 + STEP_NUMBER_SIZE_MM * .75 };
        cell.text = { x: packed.cx - packed.width / 2, firstBaseline: draw.y + draw.h + TEXT_GAP_MM,
          widthMm: packed.width, lines: text.lines };
        if (cell.placed) cell.placed.auto.drawMm = { x: packed.cx - autoExtent.width / 2, y: packed.cy - autoExtent.height / 2, w: autoExtent.width, h: autoExtent.height };
      }
      return placeCell(cell, step, flow && rowRightToLeft(plans[pageIndex]!, cell.flowRow ?? Math.floor(k / columns)), setter);
    })
  );

  // Only actual picture centres participate. A short page has no empty-cell tail;
  // the spine joins its last picture to the facing page's first picture.
  const stopPages: LaneStop[][] = cellPages.map((cells, pageIndex) => {
    if (!flow) return [];
    const plan = plans[pageIndex]!;
    const stop = (k: number, at: { x: number; y: number }): LaneStop => {
      const row = cells[k]?.flowRow ?? Math.floor(k / columns);
      return { ...at, row, rightToLeft: rowRightToLeft(plan, row), ...(cells[k]?.placed ? { placed: true } : {}) };
    };
    const stops = cells.map((cell, k) => stop(k, laneCentre(cell)));
    return stops;
  });
  // Across a spread the lane meets the spine at one height: halfway between
  // where it leaves the left page and where it comes into the right one.
  const spineAt = (leftIndex: number) => {
    const out = stopPages[leftIndex]?.at(-1);
    const into = stopPages[leftIndex + 1]?.[0];
    return out && into ? (out.y + into.y) / 2 : null;
  };

  const pages: LayoutPage[] = placedPages.map((placed, pageIndex) => {
    const number = setup.pageNumbers.first + pageIndex;
    const plan = plans[pageIndex]!;
    const cells = cellPages[pageIndex]!;
    const flowInput = flow && cells.length > 0 ? {
            stops: stopPages[pageIndex]!,
            packed: cells[0]?.flowRow !== undefined,
            plan,
            pageWidth: W,
            cellW,
            halfWidth: bandWidthMm / 2,
            offPage: OFF_PAGE_MM,
            spineIn: plan.entry === 'spine' ? spineAt(pageIndex - 1) : null,
            spineOut: plan.exit === 'spine' ? spineAt(pageIndex) : null,
          } : null;
    const lane = flowInput ? flowLane(flowInput) : null;
    for (const index of lane?.warnings ?? []) {
      const cell = cells[index];
      if (cell?.placed) cell.clashes = [{ kind: 'path' }];
    }
    const band = setup.showPath ? (lane?.lane ?? null) : null;
    const { turns, zoomArrows } = placeTurns(
      placed.map(({ step }) => step),
      cells,
      columns,
      flow ? plan : null,
      lane,
      W,
      H,
      bandWidthMm / 2
    );
    const right = plan.side === 'right';
    return {
      number,
      side: plan.side,
      cells,
      band,
      ...(flowInput ? { flow: flowInput } : {}),
      turns,
      zoomArrows,
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

  const result: DiagramPagesLayout = {
    paper,
    pages,
    cellMm: { w: cellW, h: cellH },
    title: titleLayout,
    bandWidthMm,
    bandInk: setup.pathColor,
  };
  placementClashes(result);
  return result;
}

/**
 * The size each enlarged step prints at (Revision 2, Z4), every other
 * picture's scale known (`scales`, which this adds the enlarged steps to):
 * in runs of their own — an enlarged step and those directly after it, up to
 * one that is not enlarged or one with an arrow before it, passing over one
 * with no window yet — each run measured against the area it enlarges as
 * that prints (`areaMm`): the area's longer side at its step's printed frame
 * when an arrow leaves it, else the run's first frame as its whole picture
 * would print among the steps round it. Every step of a run is measured
 * against that one area, whatever Size it asks for, so ×2 means the same all
 * along the run, a step captured from an earlier enlarged step included
 * (Zach, 2026-10-07): a Size starts no run of its own.
 *
 * - **Fill**: the run's Fill frames print at one size, the largest every one
 *   of them fits its room at, held to 1–6 times the area.
 * - **Size**: that many times the area, held the same.
 *
 * A step its room cannot hold at its run's size — a long instruction took
 * it — is drawn smaller, alone, and says so. A frame that is turned is
 * smaller than its window, which is what the step is laid out in. What each
 * prints at against its area is the read-out, by step; a run whose area's
 * size is not known fills its room, and has none.
 */
function zoomScales<T extends { step: LayoutStep }>(
  all: readonly T[],
  fitOf: (item: T) => ScaleFit | null,
  scales: Map<T, { mmPerUnit: number | null; frameMm: number | null; reduced: boolean }>,
  boxMm: number
): Map<T, NonNullable<LayoutCell['zoom']>> {
  const read = new Map<T, NonNullable<LayoutCell['zoom']>>();
  const byId = new Map(all.map((item) => [item.step.id, item]));
  /** The longer side `item`'s picture frame prints at, mm, at the scale it was given: an enlarged step's, its window's. */
  const printedFrame = (item: T): number | null => {
    const scale = scales.get(item);
    const picture = item.step.picture;
    if (!scale || !picture) return null;
    return scale.mmPerUnit !== null ? scale.mmPerUnit * Math.max(picture.frame.width, picture.frame.height) : scale.frameMm;
  };
  /**
   * How large `at`'s frame would print with no area to measure it by: its
   * share of its whole picture, at the scale the nearest step of its whole
   * picture's kind prints at — before it, else after — or, with none, its
   * whole picture filling the square box.
   */
  const amongNeighbours = (at: number): number => {
    const zoom = all[at]!.step.zoom!;
    const { kind } = zoom.whole;
    const nearest = (from: number, by: number): number | null => {
      for (let index = from; index >= 0 && index < all.length; index += by) {
        const other = all[index]!;
        if (other.step.zoom || other.step.picture?.kind !== kind) continue;
        const scale = scales.get(other);
        const value = kind === 'paper' ? scale?.mmPerUnit : scale?.frameMm;
        if (value !== null && value !== undefined && value > 0) return value;
      }
      return null;
    };
    const neighbour = nearest(at - 1, -1) ?? nearest(at + 1, 1);
    const whole = neighbour === null ? boxMm : zoom.whole.kind === 'paper' ? neighbour * zoom.whole.units : neighbour;
    return zoom.frameShare * whole;
  };
  /** A step's frame's longer side as a share of its window's: one but for a turned rectangle. */
  const frameInWindow = (item: T) => {
    const { frameShare, windowShare } = item.step.zoom!;
    return windowShare > 0 && frameShare > 0 ? frameShare / windowShare : 1;
  };

  const runs: number[][] = [];
  let current: number[] | null = null;
  all.forEach(({ step }, at) => {
    // An enlarged step with no window yet, or no picture, is in no run, and parts none.
    if (step.zoomPending) return;
    if (!step.zoom) {
      current = null;
      return;
    }
    if (step.picture?.kind !== 'zoom') return;
    // Only an arrow, or a step that is not enlarged, starts another run: a Size does not.
    if (current && !step.zoom.arrowFrom) current.push(at);
    else runs.push((current = [at]));
  });

  for (const run of runs) {
    const first = all[run[0]!]!;
    const zoom = first.step.zoom!;
    const area = zoom.arrowFrom ? byId.get(zoom.arrowFrom.stepId) : undefined;
    const areaFrame = area ? printedFrame(area) : null;
    const areaMm = zoom.arrowFrom && areaFrame !== null ? zoom.arrowFrom.share * areaFrame : amongNeighbours(run[0]!);
    const known = Number.isFinite(areaMm) && areaMm > 0;
    const fits = run.map((at) => fitOf(all[at]!));
    const [least, most] = [ZOOM_FILL.min * areaMm, ZOOM_FILL.max * areaMm];
    const held = (mm: number) => (known ? Math.min(most, Math.max(least, mm)) : mm);
    /** The Size a step of the run asks for, against the run's area; null for Fill, or where the area's size is not known. */
    const sizeOf = (at: number) => (known ? all[at]!.step.zoom!.scale : null);
    // The printed frame its Fill steps ask for: the most every one of their rooms holds.
    const fillMm = held(
      Math.min(...run.map((at, n) => (sizeOf(at) === null && fits[n] ? fits[n]!.shared * frameInWindow(all[at]!) : Infinity)))
    );
    run.forEach((at, n) => {
      const item = all[at]!;
      const fit = fits[n];
      if (!fit) return;
      // Its Size times the run's area, or the run's Fill.
      const size = sizeOf(at);
      const frameMm = size !== null ? held(size * areaMm) : fillMm;
      if (!(frameMm > 0) || !Number.isFinite(frameMm)) return;
      const window = frameMm / frameInWindow(item);
      const drawn = size !== null ? window : Math.min(window, fit.own);
      const reduced = drawn < window * (1 - 1e-9);
      scales.set(item, { mmPerUnit: null, frameMm: drawn, reduced });
      if (known) read.set(item, { asked: item.step.zoom!.scale, printed: (drawn * frameInWindow(item)) / areaMm, reduced });
    });
  }
  return read;
}

/** The middle of a picture as drawn, which a tall one has lower than its box's: where the lane passes behind it. */
function laneCentre(cell: LayoutCell): { x: number; y: number } {
  return { x: cell.pictureMm.x + cell.pictureMm.size / 2, y: cell.drawMm.y + cell.drawMm.h / 2 };
}

/**
 * Where the turns on a page print (D22): between two pictures on one row,
 * midway between them at their centres' height; across a flow row's end, on
 * the lane in its bend between the rows (`flowLane`, also when the lane is
 * not shown), midway from the last line of the upper step to the lower one's
 * number (the upper kept the room: `slotBottom`); before a picture that
 * starts a grid's row or the page, at its leading edge — a page's first step
 * has no row on the page to turn from, and the lane comes in at its leading
 * side; after the last picture, at its trailing edge. Several in one place
 * stand one above another, each glyph clear of the next, the stack centred on
 * the place. Kept on the paper.
 *
 * An enlarge arrow (Revision 2) takes the same places, standing after the
 * turns before its step: a turn's places are the arrow's, so the two agree
 * however D22 places them. Alone in a row's gutter, beside the area's step,
 * it is `liftable`. Across a flow row's end it is aimed from its place at the
 * middle of the enlarged step's picture, the next row's (Zach, 2026-10-07),
 * its bow on the outside of the lane's bend, the way the row before it read:
 * it leaves heading on round the bend and comes into the step.
 */
function placeTurns(
  steps: readonly LayoutStep[],
  cells: readonly LayoutCell[],
  columns: number,
  plan: FlowPagePlan | null,
  lane: ReturnType<typeof flowLane>,
  pageWidth: number,
  pageHeight: number,
  halfWidth: number
): Pick<LayoutPage, 'turns' | 'zoomArrows'> {
  const placed: LayoutPage['turns'] = [];
  const zoomArrows: LayoutZoomArrow[] = [];
  const rowOf = (k: number) => cells[k]?.flowRow ?? Math.floor(k / columns);
  const backwards = (k: number) => plan !== null && rowRightToLeft(plan, rowOf(k));
  const centre = laneCentre;
  /** How far down a cell's own ink reaches: its text's last line, with its descenders, or its picture. */
  const foot = (cell: LayoutCell) =>
    cell.text.lines.length > 0
      ? cell.text.firstBaseline + (cell.text.lines.length - 1) * STEP_TEXT_LEADING_MM + TEXT_DESCENT_MM
      : cell.drawMm.y + cell.drawMm.h;
  /** The edge of a picture facing the gutter before (`lead`) or after it, half a gutter out. */
  const edge = (k: number, lead: boolean) => {
    const cell = cells[k]!;
    if (cell.flowRow !== undefined) {
      const box = cell.inkMm ?? cell.drawMm;
      return { x: lead !== backwards(k) ? box.x - TURN_GUTTER_MM / 2 : box.x + box.w + TURN_GUTTER_MM / 2, y: centre(cell).y };
    }
    const gutter = cell.cellMm.w - cell.pictureMm.size;
    const left = lead !== backwards(k);
    const x = left ? cell.pictureMm.x - gutter / 2 : cell.pictureMm.x + cell.pictureMm.size + gutter / 2;
    return { x, y: centre(cell).y };
  };
  /**
   * `glyphs` stood at `at`, in the row of the `k`th picture, which they go the
   * way of; an enlarge arrow among them aimed at `toward`, when given, its bow
   * `outward` (+1 to the page's right, −1 to its left).
   */
  const stack = (
    glyphs: readonly BetweenGlyph[],
    at: { x: number; y: number },
    k: number,
    beforeStepId: string | null,
    { shared = false, toward = null, outward = 1 }: { shared?: boolean; toward?: { x: number; y: number } | null; outward?: number } = {}
  ) => {
    if (cells[k]?.flowRow !== undefined) {
      const sizeAt = (point: { x: number; y: number }) => {
        const angle = toward ? Math.atan2(toward.y - point.y, toward.x - point.x) : 0;
        const sizes = glyphs.map((glyph) => glyphMm(glyph, toward ? { angle, flipped: Math.sin(angle) * outward < 0 } : null));
        return { w: Math.max(...sizes.map((b) => b.w)), h: sizes.reduce((sum, b) => sum + b.h, 0) + (sizes.length - 1) * TURN_STACK_CLEAR_MM };
      };
      at = glyphSpot({ preferred: at, before: beforeStepId ? cells[k - 1] : cells[k], after: beforeStepId ? cells[k] : undefined,
        cells, lane: lane?.lane ?? null, paper: { w: pageWidth, h: pageHeight }, sizeAt,
        occupied: [...placed, ...zoomArrows].map(({ at, box }) => ({ x: at.x - box.w / 2, y: at.y - box.h / 2, ...box })) });
    }
    const x = Math.min(pageWidth - TURN_GUTTER_MM / 2, Math.max(TURN_GUTTER_MM / 2, at.x));
    const angle = toward ? Math.atan2(toward.y - at.y, toward.x - x) : 0;
    // Its bow on the `outward` side: the side unflipped is the one its turn puts its up on.
    const aim: LayoutArrowAim | null = toward ? { angle, flipped: Math.sin(angle) * outward < 0 } : null;
    const boxes = glyphs.map((glyph) => glyphMm(glyph, aim));
    let top = at.y - (boxes.reduce((sum, box) => sum + box.h, 0) + (glyphs.length - 1) * TURN_STACK_CLEAR_MM) / 2;
    glyphs.forEach((glyph, index) => {
      const box = boxes[index]!;
      const middle = { x, y: top + box.h / 2 };
      if (glyph.kind === 'turn') {
        const { kind: _kind, ...turn } = glyph;
        placed.push({ ...turn, at: middle, box, beforeStepId, rightToLeft: backwards(k) });
      } else if (beforeStepId !== null) {
        zoomArrows.push({
          at: middle,
          box,
          beforeStepId,
          areaStepId: glyph.arrowFrom.stepId,
          areaId: glyph.arrowFrom.areaId,
          rightToLeft: backwards(k),
          // Alone between the area's step and its own on one row: the page lifts it to the area.
          liftable: shared && glyphs.length === 1 && cells[k - 1]?.stepId === glyph.arrowFrom.stepId,
          aim,
        });
      }
      top += box.h + TURN_STACK_CLEAR_MM;
    });
  };
  steps.forEach((step, k) => {
    const before = glyphsBefore(step);
    if (before.length > 0) {
      if (k > 0 && rowOf(k - 1) === rowOf(k)) {
        const a = centre(cells[k - 1]!);
        const b = centre(cells[k]!);
        const facing = (edge(k - 1, false).x + edge(k, true).x) / 2;
        stack(before, { x: facing, y: (a.y + b.y) / 2 }, k, step.id, { shared: true });
      } else if (k > 0 && plan) {
        // In the gap between the two rows, under the upper step's words and
        // over the lower one's number, where the lane crosses it.
        const [previous, next] = [cells[k - 1]!, cells[k]!];
        const [upper, lower] = previous.cellMm.y < next.cellMm.y ? [previous, next] : [next, previous];
        const y = (foot(upper) + lower.numberAt.y - STEP_NUMBER_BASELINE_MM + STEP_NUMBER_TOP_MM) / 2;
        const bend = lane?.bends.get(k);
        const onLane = lane && bend !== undefined ? bendXAt(lane.lane, bend, y) : null;
        const reach = bendReach(previous.cellMm.w, Math.abs(centre(next).y - centre(previous).y) / 2, halfWidth);
        const outward = backwards(k - 1) ? -1 : 1;
        const x = onLane ?? centre(previous).x + outward * reach;
        // An arrow there points at the step it leads to, not across the page.
        stack(before, { x, y }, k, step.id, { toward: centre(next), outward });
      } else {
        stack(before, edge(k, true), k, step.id);
      }
    }
    if (step.turnsAfter.length > 0) {
      stack(
        step.turnsAfter.map((turn): BetweenGlyph => ({ kind: 'turn', ...turn })),
        edge(k, false),
        k,
        null
      );
    }
  });
  return { turns: placed, zoomArrows };
}
