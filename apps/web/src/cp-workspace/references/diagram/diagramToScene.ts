/**
 * A step's primitives split between the two things that draw them.
 *
 * The crease pattern's own renderer draws straight lines by the hundred
 * thousand and cannot draw an arc, a filled triangle or a letter. A DOM layer
 * draws all three and should not be asked for a thousand lines. So the seam is
 * simply that: **lines to the GPU, symbols to the DOM.** Both halves come off
 * one primitive list, so neither can invent anything the card does not have.
 *
 * The symbol count is bounded by axiom arity — at most about a dozen per step,
 * whatever the pattern's size — which is what makes the DOM half safe. The same
 * reasoning, in the same words, is why `CpMeasureLayer` exists.
 */
import type { Rgba } from '../../renderer/types';
import type { StrokeGeometry } from '../../renderer/types';
import type {
  DiagramLineStyleName,
  StepDiagramPrimitive,
} from '../referenceFinderDiagramToPrimitives';
import {
  erodeCreaseOnSheet,
  paperSpan,
  type DiagramSheet,
  type SheetPoint,
} from '../stepDiagramGeometry';
import { DEFAULT_DIAGRAM_CREASES, canLeavePaper, type DiagramCreaseOptions } from './DiagramPrimitives';
import {
  DIAGRAM_LINE_INK,
  diagramDashPatterns,
  diagramDashSlot,
  type DiagramPens,
} from './diagramInk';

export interface DiagramScene {
  /** The straight lines, ready for the preview channel. */
  strokes: StrokeGeometry | null;
  /** Arcs, arrowheads, the turn-over glyph, mark rings and letters. */
  symbols: StepDiagramPrimitive[];
}

/** One colour per line style, resolved from the theme by the caller. */
export type DiagramInkColors = Record<DiagramLineStyleName, Rgba>;

export interface DiagramSceneOptions {
  /** The pens; the table unless the paper style has re-penned a role. */
  pens?: DiagramPens;
  /** The paper the primitives were measured against, for erode's edge. */
  sheet?: DiagramSheet;
  /** Whether the pattern's aux lines are drawn, and how far aux-pen lines stop short of the edge. */
  creases?: DiagramCreaseOptions;
  /**
   * The paper, for a line in the arrow's pen, which can leave it: the outline
   * the canvas fills (`sheetOutline`, convex, in the primitives' space) and the
   * ink such a line takes off it — the theme's (`diagramGroundInk`). Absent,
   * every line is drawn in its style's ink wherever it lies.
   *
   * The paper at rest. While a fold plays, a piece riding the flap keeps the
   * ink it was cut in, where the symbol layer's clip follows the pose; no
   * step draws such a line today — ReferenceFinder's arrow is an arc
   * (`refDgmr.cpp` draws `LINESTYLE_ARROW` through `DrawArc` alone), and a
   * planner step has no arrow-pen line — so the two cannot disagree yet.
   */
  paper?: { outline: readonly SheetPoint[]; ground: Rgba };
}

/** A line to pack, and the ink it is drawn in when that is not its style's. */
type DiagramLine = Extract<StepDiagramPrimitive, { kind: 'line' }> & { ink?: Rgba };

/**
 * Split a step's primitives, and pack the lines for upload.
 *
 * `inkCss` is the pen in CSS pixels — fixed by the paper at fit rather than by
 * the live camera, or a ten-times zoom arrives with a ten-times nib. It scales
 * the dash runs, which the program wants in screen pixels, and it is the base
 * width each style's own multiplier rides on.
 *
 * A line in the aux pen — a crease an earlier step made, or one of the
 * pattern's aux lines — is pulled back from the sheet's edge by the style's
 * erode, and an aux line is left out when they are not shown: the same rules
 * the card applies (`erodeCreaseOnSheet`), so the two pictures of a step agree.
 *
 * A line in the arrow's pen is cut where it crosses the paper's outline, given
 * one, and each piece off the paper is drawn in the ground's ink — the rule the
 * card applies to the same line by clipping (X11 of the paper export plan).
 */
export function diagramToScene(
  primitives: readonly StepDiagramPrimitive[],
  colors: DiagramInkColors,
  inkCss: number,
  options: DiagramSceneOptions = {}
): DiagramScene {
  const pens = options.pens ?? DIAGRAM_LINE_INK;
  const creases = options.creases ?? DEFAULT_DIAGRAM_CREASES;
  const symbols: StepDiagramPrimitive[] = [];
  const lines: DiagramLine[] = [];
  for (const primitive of primitives) {
    if (primitive.kind === 'line') {
      if (canLeavePaper(primitive) && options.paper) lines.push(...splitAtPaper(primitive, options.paper));
      else if (primitive.style !== 'crease' && primitive.style !== 'aux') lines.push(primitive);
      else if (primitive.style === 'crease' || creases.showAux) {
        const ends = options.sheet
          ? erodeCreaseOnSheet(primitive.from, primitive.to, options.sheet, creases.erode)
          : ([primitive.from, primitive.to] as [SheetPoint, SheetPoint]);
        if (ends) lines.push({ ...primitive, from: ends[0], to: ends[1] });
      }
    }
    // The canvas has the document's own border creases under everything, so a
    // sheet rectangle over them would be a second paper.
    else if (primitive.kind !== 'sheet') symbols.push(primitive);
  }
  return { strokes: pack(lines, colors, inkCss, pens), symbols };
}

/** Shorter than this share of a line, a piece is a rounding error at the outline, not a piece. */
const PIECE_EPSILON = 1e-9;

/**
 * A line cut where it crosses the paper's outline: the piece on the paper in
 * its style's ink, each piece off it in the ground's. Every piece carries the
 * dash phase of where it starts along the whole line, so the pattern runs on
 * across the cut as if nothing had happened to it.
 */
function splitAtPaper(
  line: DiagramLine,
  paper: NonNullable<DiagramSceneOptions['paper']>
): DiagramLine[] {
  const span = paperSpan(line.from, line.to, paper.outline);
  if (!span) return [{ ...line, ink: paper.ground }];
  const [t0, t1] = span;
  const length = Math.hypot(line.to[0] - line.from[0], line.to[1] - line.from[1]);
  const at = (t: number): SheetPoint => [
    line.from[0] + (line.to[0] - line.from[0]) * t,
    line.from[1] + (line.to[1] - line.from[1]) * t,
  ];
  const piece = (from: number, to: number, ink?: Rgba): DiagramLine => ({
    ...line,
    from: at(from),
    to: at(to),
    dashPhase: (line.dashPhase ?? 0) + length * from,
    ...(ink ? { ink } : {}),
  });
  const pieces: DiagramLine[] = [];
  if (t0 > PIECE_EPSILON) pieces.push(piece(0, t0, paper.ground));
  pieces.push(t0 <= PIECE_EPSILON && t1 >= 1 - PIECE_EPSILON ? line : piece(t0, t1));
  if (t1 < 1 - PIECE_EPSILON) pieces.push(piece(t1, 1, paper.ground));
  return pieces;
}

function pack(
  lines: readonly DiagramLine[],
  colors: DiagramInkColors,
  inkCss: number,
  pens: DiagramPens
): StrokeGeometry | null {
  if (lines.length === 0) return null;
  const count = lines.length;
  const a = new Float32Array(count * 2);
  const b = new Float32Array(count * 2);
  const color = new Float32Array(count * 4);
  const widthMul = new Float32Array(count);
  const dashSlot = new Float32Array(count);
  const dashPhase = new Float32Array(count);
  lines.forEach((line, i) => {
    const pen = pens[line.style];
    a[i * 2] = line.from[0];
    a[i * 2 + 1] = line.from[1];
    b[i * 2] = line.to[0];
    b[i * 2 + 1] = line.to[1];
    const ink = line.ink ?? colors[line.style];
    color[i * 4] = ink[0];
    color[i * 4 + 1] = ink[1];
    color[i * 4 + 2] = ink[2];
    // The style's own opacity rides in the colour: the program has no separate
    // alpha, and a crease drawn as context is meant to be quieter than one the
    // step is about.
    color[i * 4 + 3] = ink[3] * (pen.opacity ?? 1);
    widthMul[i] = pen.width;
    dashSlot[i] = diagramDashSlot(line.style);
    dashPhase[i] = line.dashPhase ?? 0;
  });
  return {
    a,
    b,
    color,
    widthMul,
    count,
    dashPatterns: diagramDashPatterns(inkCss, pens),
    dashSlot,
    dashPhase,
  };
}
