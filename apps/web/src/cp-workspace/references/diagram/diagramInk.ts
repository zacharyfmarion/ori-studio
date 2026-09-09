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
 *   context, not an instruction.
 * - **valley 8:4** and **mountain 4:2:1:2**, in units of the stroke width — so
 *   at 1.6 wide they are `12.8 6.4` and `6.4 3.2 1.6 3.2`. `butt` caps because
 *   `round` inflates every mark until the mountain reads as a solid line.
 */
export const DIAGRAM_LINE_INK: Record<DiagramLineStyleName, DiagramStrokeInk> = {
  crease: { ...LINE, width: 0.75, opacity: 0.75 },
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

/** The ring round a reference mark: its stroke. The radius is in sheet units. */
export const DIAGRAM_MARK_INK = { width: 1.2 } as const;

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
