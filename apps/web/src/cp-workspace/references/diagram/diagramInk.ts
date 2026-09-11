/**
 * How heavily a step diagram is drawn, in a unit tied to the paper rather than
 * to the screen.
 *
 * Every weight in this picture used to be a fixed number of screen pixels: the
 * strokes carried `vector-effect: non-scaling-stroke`, so a 1.2 px line stayed
 * 1.2 px whether the drawing was a 118 px card or filled a pane. That is right
 * for a thumbnail and wrong for anything else — at 800 px the same SVG is a
 * hairline sketch, and the valley and mountain dashes, also pinned to screen
 * pixels, run so short against the paper that the two patterns stop being
 * distinguishable. A diagram has to be drawable at any size to be one
 * description of a step rather than one picture of it.
 *
 * So the unit is **ink**: a share of the paper's longer side. One ink is a
 * ninety-sixth of it, which on today's card — a 118 px box holding a viewBox of
 * 100 whose sheet is 80 of those units, so 94.4 CSS px of paper — comes to
 * 0.983 CSS px. That is why the numbers below are recognisably the CSS pixel
 * values they replace: at card size they render within 1.7% of what they did,
 * and they now scale with the box.
 *
 * Colour is not here. It stays in `theme.css`, where a token can follow the
 * theme; only geometry moved, because only geometry has to know how big the
 * drawing is. Nothing enforces that split but this sentence and
 * `diagramInk.test.ts`, which pins every value against the stylesheet it came
 * from.
 */
import type { DiagramLineStyleName } from '../referenceFinderDiagramToPrimitives';

/** One ink, as a share of the sheet's longer side. */
export const DIAGRAM_INK_PER_SHEET = 1 / 96;

export interface DiagramStrokeInk {
  /** Stroke width, in ink. */
  width: number;
  /** Dash pattern, in ink. Absent is solid. */
  dash?: readonly number[];
  cap: 'round' | 'butt';
  /** Absent is fully opaque. */
  opacity?: number;
}

/** The base every line and arc starts from, before its style's own overrides. */
const LINE: DiagramStrokeInk = { width: 1.2, cap: 'round' };

/**
 * Each line style's weight.
 *
 * The tuning is the standard diagramming template's, and the two derivations
 * worth keeping are:
 *
 * - **crease** is solid at a third of a fold line's weight
 *   (`origami_house_template.svg`: 2.52 against 7.56). An already-made crease is
 *   context, not an instruction — and how faint, the theme decides
 *   (`themes/referencesInk.ts`), which is why it carries no opacity here.
 * - **valley 8:4** and **mountain 4:2:1:2**, in units of the stroke width — so
 *   at 1.6 wide they are `12.8 6.4` and `6.4 3.2 1.6 3.2`. `butt` caps because
 *   `round` inflates every mark until the mountain reads as a solid line.
 */
export const DIAGRAM_LINE_INK: Record<DiagramLineStyleName, DiagramStrokeInk> = {
  // Its opacity is the theme's, not the pen's: `--references-crease-alpha`,
  // read by the card's CSS and by `diagramColors.ts` for the canvas, because
  // how far a grey sits back from the ground depends on the ground.
  crease: { ...LINE, width: 0.75 },
  edge: { ...LINE },
  highlight: { ...LINE, width: 2 },
  valley: { ...LINE, width: 1.6, dash: [12.8, 6.4], cap: 'butt' },
  mountain: { ...LINE, width: 1.6, dash: [6.4, 3.2, 1.6, 3.2], cap: 'butt' },
  arrow: { ...LINE, width: 1.4 },
  dotted: { ...LINE, dash: [1.2, 3.6], cap: 'butt' },
  // A pinch is a crease, so it takes its direction's own colour and only its
  // weight is shared: it is pressed harder than the crease it is part of, which
  // is what makes it a mark.
  pinch: { ...LINE, width: 2.4 },
  'pinch-mountain': { ...LINE, width: 2.4 },
  'pinch-valley': { ...LINE, width: 2.4 },
  unfolded: { ...LINE, width: 1, opacity: 0.28 },
};

/** The paper's own outline. */
export const DIAGRAM_SHEET_INK = { width: 1, opacity: 0.55 } as const;

/**
 * The ring round a reference mark.
 *
 * `3.84` is 4% of the paper on a card — `0.04 × 96` — which is what the
 * reference diagrams draw. In ink rather than as a share of the sheet because
 * the same picture is also drawn over the crease pattern, where the "paper" is
 * whatever the camera is showing and a share of it is a ring that inflates as
 * you zoom in.
 */
export const DIAGRAM_MARK_INK = { width: 1.2, radius: 3.84 } as const;

/**
 * An arrowhead: its length, and the cap for a short arrow as a share of the
 * chord it spans.
 *
 * `10.56` is upstream's `0.11` of the paper on a card. The cap stays a share of
 * the arrow's own chord — it is about that arrow, not about the pen — so a
 * short motion still gets a head rather than a blob.
 */
export const DIAGRAM_ARROWHEAD_INK = { length: 10.56, ofChord: 0.26 } as const;

/** The turn-over glyph's width: 42% of the paper's shorter side on a card. */
export const DIAGRAM_TURN_OVER_INK = 40.32;

/**
 * The pen a diagram is drawn with **over the crease pattern**, in CSS pixels.
 *
 * Not a share of the paper, which is the law the card uses and the wrong one
 * here. A card is a printed figure: everything in it, the paper included, is
 * the picture, so sizing the pen by the paper keeps the drawing coherent at any
 * size. The canvas is a camera onto a pattern that may be four hundred model
 * units across and any number of pixels on screen — size the pen by the paper
 * there and a fit view gets a ten-pixel arrow beside a one-pixel crease, and
 * zooming in makes it worse.
 *
 * So it is the crease pen instead: one ink is what a plain diagram line would
 * have to be to match a crease. The reader's own line-width setting therefore
 * moves both together, and the arrow can never be fatter than the creases it is
 * drawn among. Deliberately *without* the zoom-dependent `widthBoost` the
 * creases carry, so the dash patterns uploaded with the geometry stay put.
 */
export function canvasDiagramInk(lineWidth: number): number {
  const CREASE_WIDTH_FACTOR = 1.5;
  return (CREASE_WIDTH_FACTOR * lineWidth) / DIAGRAM_LINE_INK.edge.width;
}

/**
 * A reference letter.
 *
 * `size` and `halo` were user units rather than screen pixels before this — a
 * `font-size` inside a viewBox already scales — so they convert at 1.2 ink to
 * the user unit, not 1:1 like the strokes. The halo is the ground the letter
 * sits on: `labelPlacement` pushes a label off the sheet into the padding band
 * on purpose, so it has to carry its own background out there.
 */
export const DIAGRAM_LABEL_INK = { size: 10.8, halo: 3, offset: 4.2 } as const;

/**
 * The dash slots a diagram uses, and the patterns that fill them.
 *
 * Three of the four the stroke program offers. The crease pattern's own table
 * (`lib/oristudioCpLineStyle`) spends all four on Oriedita's shape-coded style,
 * and this surface replaces it rather than sharing it: the References workspace
 * is a diagram, and a diagram says mountain and valley with a *pattern* — the
 * one thing that still reads when the paper is turned over and the colours
 * change meaning.
 *
 * Runs are in CSS pixels, which is what the program wants, so the pen decides
 * them. Every pattern here is at most two on/off pairs, inside the three the
 * shader walks.
 */
export const DIAGRAM_DASH_SLOTS: readonly DiagramLineStyleName[] = [
  'valley',
  'mountain',
  'dotted',
];

/** The slot a style takes; 0 is solid. */
export function diagramDashSlot(style: DiagramLineStyleName): number {
  return DIAGRAM_DASH_SLOTS.indexOf(style) + 1;
}

/** The slot table, with every run scaled by the pen. */
export function diagramDashPatterns(inkCss: number): number[][] {
  return DIAGRAM_DASH_SLOTS.map((style) =>
    (DIAGRAM_LINE_INK[style].dash ?? []).map((run) => run * inkCss)
  );
}
