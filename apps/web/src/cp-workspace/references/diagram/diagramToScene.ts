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
import { erodeCreaseOnSheet, type DiagramSheet, type SheetPoint } from '../stepDiagramGeometry';
import { DEFAULT_DIAGRAM_CREASES, type DiagramCreaseOptions } from './DiagramPrimitives';
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
  /** Whether existing creases are drawn, and how far they stop short of the edge. */
  creases?: DiagramCreaseOptions;
}

type DiagramLine = Extract<StepDiagramPrimitive, { kind: 'line' }>;

/**
 * Split a step's primitives, and pack the lines for upload.
 *
 * `inkCss` is the pen in CSS pixels — fixed by the paper at fit rather than by
 * the live camera, or a ten-times zoom arrives with a ten-times nib. It scales
 * the dash runs, which the program wants in screen pixels, and it is the base
 * width each style's own multiplier rides on.
 *
 * An existing crease (`crease` ink) is the paper style's: left out when the
 * style hides them, and pulled back from the sheet's edge by its erode — the
 * same rule the card applies (`erodeCreaseOnSheet`), so the two pictures of
 * a step agree.
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
      if (primitive.style !== 'crease') lines.push(primitive);
      else if (creases.visible) {
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
    const ink = colors[line.style];
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
