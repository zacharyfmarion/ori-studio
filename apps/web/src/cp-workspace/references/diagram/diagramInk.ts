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
import type { Pen } from '../../../lib/paper/paperStyle';
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
 * The fold arrow's weight — and the accent's over the lines a step lines up:
 * both are marks of the step drawn over the paper, and a heavier accent than
 * the arrow read as a line of the pattern rather than a mark.
 */
const MARK_WIDTH = 1.4;

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
export type DiagramPens = Readonly<Record<DiagramLineStyleName, DiagramStrokeInk>>;

export const DIAGRAM_LINE_INK: DiagramPens = {
  // Its opacity is the theme's, not the pen's: `--references-crease-alpha`,
  // read by the card's CSS and by `diagramColors.ts` for the canvas, because
  // how far a grey sits back from the ground depends on the ground.
  crease: { ...LINE, width: 0.75 },
  // The pattern's own aux lines: the same pen as a made crease.
  aux: { ...LINE, width: 0.75 },
  edge: { ...LINE },
  highlight: { ...LINE, width: MARK_WIDTH },
  valley: { ...LINE, width: 1.6, dash: [12.8, 6.4], cap: 'butt' },
  mountain: { ...LINE, width: 1.6, dash: [6.4, 3.2, 1.6, 3.2], cap: 'butt' },
  // The finished pattern's lines weigh what a step's fold does: the table has
  // one convention, and the paper style is what tells a pattern's line from an
  // instruction (`cardDiagramPens`, `canvasDiagramPens`).
  'fold-valley': { ...LINE, width: 1.6, dash: [12.8, 6.4], cap: 'butt' },
  'fold-mountain': { ...LINE, width: 1.6, dash: [6.4, 3.2, 1.6, 3.2], cap: 'butt' },
  arrow: { ...LINE, width: MARK_WIDTH },
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
 * The ring round a reference mark: its radius, and its stroke as a share of
 * the arrow's pen (`markRingWidth`).
 *
 * Three quarters of the arrow, because a printed diagram draws the circle that
 * pins a point exactly lighter than its arrow, so it reads as a precise mark
 * rather than a second arrow. A share rather than a pen of its own, so the two
 * stay in proportion when the arrow pen changes. It was the arrow's whole
 * width, then half — which set beside the arrow read as too faint.
 *
 * `3.07` is four fifths of the `3.84` the reference diagrams draw — 4% of the
 * paper on a card, `0.04 × 96` — which set beside a printed diagram on a
 * step's page read as a ring too big for the point it marks. In ink rather
 * than as a share of the sheet because the same picture is also drawn over the
 * crease pattern, where the "paper" is whatever the camera is showing and a
 * share of it is a ring that inflates as you zoom in.
 */
export const DIAGRAM_MARK_INK = { radius: 3.07, ofArrow: 0.75 } as const;

/**
 * A right-angle mark (decision 11 of the Annotate plan): the side of the open
 * square it draws in the corner, in ink. At an annotation's ink (1.25 CSS px,
 * 0.331 mm) it prints 2.3 mm a side: big enough to read as a square beside
 * the lines it sits between, small enough to stay inside a narrow flap. Its
 * stroke is a ring's (`markRingWidth`): a precise mark, lighter than an arrow.
 */
export const DIAGRAM_RIGHT_ANGLE_INK = { side: 7 } as const;

/**
 * An angle marked halved (15b of the second Annotate plan): the radius of the
 * arc it draws across the angle, in ink — at an annotation's ink (0.331 mm)
 * 5 mm, twice the first sketch's, which Zach found "way too small" — and each
 * tick across it: half its length, and how far apart two or three lie along
 * the arc. Its stroke is a ring's (`markRingWidth`), as a right angle's is.
 */
export const DIAGRAM_ANGLE_MARK_INK = { radius: 15, tick: 1.8, spacing: 1.8 } as const;

/**
 * An arrowhead: its length, tip to barbs, and the cap for a short arrow as a
 * share of the chord it spans.
 *
 * `8.5` is a printed diagram's head: at the default pen over the crease
 * pattern (1.25 CSS px to the ink) it is 10.6 px, so on a step's page about
 * 8 pt — 2.8 mm long and, at `ARROWHEAD_ASPECT`, 1.65 mm wide. It was `10.56`,
 * upstream's `0.11` of the paper on a card, until a reader set a step's page
 * beside a printed diagram and found the heads too big. The cap stays a share
 * of the arrow's own chord — it is about that arrow, not about the pen — so a
 * short motion still gets a head rather than a blob.
 */
export const DIAGRAM_ARROWHEAD_INK = { length: 8.5, ofChord: 0.26 } as const;

/**
 * How far to the side a fold-and-unfold arrow's return ends, and the same cap
 * for a short arrow as the head's.
 *
 * `10.56` — upstream's `0.11` of the paper on a card — is the head's old
 * length. The return used to be offset by one head, so when the head was made
 * smaller the offset kept the old length as its own: a smaller head is no
 * reason for the two strokes to crowd each other.
 */
export const DIAGRAM_FOLD_RETURN_INK = { offset: 10.56, ofChord: 0.26 } as const;

/**
 * A pleat arrow's Zs (15c of the second Annotate plan), in ink: how far each
 * steps across its shaft — the space between the bolt's parallel runs — how
 * far it steps back along the shaft as it crosses, and the run from one Z to
 * the next. A fixed print size, as every mark's is; at an annotation's ink
 * (0.331 mm) a Z steps 2.25 mm across, a little under the head's length —
 * half the first sketch's step, whose runs Zach found too far apart — and
 * two Zs stand about as far apart along the shaft.
 */
export const DIAGRAM_PLEAT_INK = { step: 6.8, back: 4.1, gap: 10.9 } as const;

/** The turn-over glyph's width: 42% of the paper's shorter side on a card. */
export const DIAGRAM_TURN_OVER_INK = 40.32;

/**
 * A push arrow's hollow shape, in ink: its head's length and half-width, its
 * shaft's half-width, and how deep its tail is cleft. Wider than a fold
 * arrow's head, so the outline reads as a shape with an inside rather than a
 * thick line.
 */
export const DIAGRAM_PUSH_INK = { head: 12, headHalf: 7.5, shaftHalf: 3.2, cleft: 4.5 } as const;

/** A white arrow's widths. */
export type DiagramWhiteArrowWidth = 'narrow' | 'regular' | 'wide';

/**
 * A white arrow's three widths, in ink: its shaft's width at the head (the
 * neck), and its head's length and width. A fixed print size, as every mark's
 * is; at an annotation's ink (1.25 CSS px, 0.331 mm) they print as:
 *
 * - **regular**, the Origami House template's tapered white arrow
 *   (`path4649`): a 3.58 mm neck, a head 3.95 mm long and 7.94 mm wide.
 * - **narrow**, the push arrow's shaft and head (2.12 mm; 3.97 × 4.96 mm), so
 *   the two hollow arrows beside each other are one weight. The template's
 *   even white arrows are about as wide: 2.0–2.1 mm necks, heads 3.2–3.7 mm
 *   long and 4.0–5.9 mm wide.
 * - **wide**, the regular one 1.4 times over (5.0 mm), for a large motion; the
 *   template has none wider than regular.
 */
export const DIAGRAM_WHITE_ARROW_INK: Readonly<
  Record<DiagramWhiteArrowWidth, { neck: number; headLength: number; headWidth: number }>
> = {
  narrow: {
    neck: 2 * DIAGRAM_PUSH_INK.shaftHalf,
    headLength: DIAGRAM_PUSH_INK.head,
    headWidth: 2 * DIAGRAM_PUSH_INK.headHalf,
  },
  regular: { neck: 10.8, headLength: 12, headWidth: 24 },
  wide: { neck: 15.12, headLength: 16.8, headWidth: 33.6 },
};

/**
 * The rotate glyph, in ink: its circle's radius, and the size of the fraction
 * set inside it. The circle is a little larger than a mark's ring is small, so
 * "1/8" fits inside with room to read.
 */
export const DIAGRAM_ROTATE_INK = { radius: 12.5, fraction: 7.2 } as const;

/** The editor's crease width law: a crease is this many CSS px per unit of line width. */
export const CP_CREASE_WIDTH_FACTOR = 1.5;

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
  return (CP_CREASE_WIDTH_FACTOR * lineWidth) / DIAGRAM_LINE_INK.edge.width;
}

/**
 * A paper-style pen as a diagram stroke of `width` ink: its dash, stated in
 * multiples of its width, becomes runs of that many ink; its cap is its own.
 */
export function penInk(pen: Pen, width: number): DiagramStrokeInk {
  return {
    width,
    ...(pen.dash ? { dash: pen.dash.map((multiple) => multiple * width) } : {}),
    cap: pen.cap,
  };
}

/**
 * The paper style's pens a diagram draws with: the edge pen for the paper's
 * edge, the diagram-crease pens for a step's fold — the instruction — the fold
 * pens for a line of the finished pattern, and the aux pen for an existing
 * crease.
 */
export interface DiagramPaperPens {
  /** Existing creases (`crease` ink) draw in this pen. */
  auxCreases: { pen: Pen };
  /** What every other pen's width is measured against. */
  edges: Pen;
  /** The finished pattern's lines (`fold-mountain`, `fold-valley`). */
  mountainFolds: Pen;
  valleyFolds: Pen;
  /** A step's own fold (`mountain`, `valley`). */
  mountainDiagramCreases: Pen;
  valleyDiagramCreases: Pen;
}

/**
 * The card's pens for a paper style: the table, with the paper's edge, the
 * folds and an existing crease drawn in the style's own pens.
 *
 * A card is a printed figure whose pen is a share of the paper, and a pen in
 * points has no meaning on a thumbnail — so what is taken from the style is
 * the *ratio*: each pen's width against the edge pen's, applied to the
 * table's edge weight. At the defaults an existing crease (0.5 pt against
 * 0.9 pt) is 0.667 ink, near the 0.75 the table drew. The dash and cap are
 * the pen's, so a style with solid folds draws them solid.
 */
export function cardDiagramPens(style: DiagramPaperPens): DiagramPens {
  const edge = Math.max(style.edges.width, Number.EPSILON);
  const at = (pen: Pen) => penInk(pen, DIAGRAM_LINE_INK.edge.width * (pen.width / edge));
  const aux = at(style.auxCreases.pen);
  return {
    ...DIAGRAM_LINE_INK,
    edge: at(style.edges),
    mountain: at(style.mountainDiagramCreases),
    valley: at(style.valleyDiagramCreases),
    'fold-mountain': at(style.mountainFolds),
    'fold-valley': at(style.valleyFolds),
    crease: aux,
    aux,
  };
}

/** A pen and its width in CSS px, as the canvas draws it. */
export interface CssPen {
  pen: Pen;
  css: number;
}

/** The paper style's pens the canvas draws a line in, each with its width in CSS px. */
export interface CanvasPaperPens {
  edge: CssPen;
  /** The finished pattern's lines, and the crease channel's (`fold-mountain`, `fold-valley`). */
  mountainFolds: CssPen;
  valleyFolds: CssPen;
  /** A step's own fold (`mountain`, `valley`). */
  mountainDiagramCreases: CssPen;
  valleyDiagramCreases: CssPen;
}

/**
 * The pens the diagram over the crease pattern is drawn with: the table, with
 * the arrow drawn by the paper style's own arrow pen, an existing crease by
 * its aux pen, and the paper's edge, a step's fold and a pattern's line by
 * theirs.
 *
 * `arrowCss` and each pen's `css` are widths in CSS pixels. Over the canvas one
 * ink is a fixed number of CSS pixels ({@link canvasDiagramInk}), so a pen's
 * weight in ink is whatever puts its stroke at exactly the pen. Without an aux
 * pen the crease keeps the table's weight, and without the style's line pens
 * the lines keep the table's (the reference diagrams drawn before there was a
 * style).
 *
 * The arrow is never lighter than the table's: a print pen of 0.75 pt is a
 * hairline beside the lettering on screen, and the arrow has to read at a
 * glance. A heavier arrow pen still draws heavier.
 */
export function canvasDiagramPens(
  lineWidth: number,
  arrowCss: number,
  aux?: CssPen,
  lines?: CanvasPaperPens
): DiagramPens {
  const ink = canvasDiagramInk(lineWidth);
  const at = ({ pen, css }: CssPen) => penInk(pen, css / ink);
  const markWidth = Math.max(arrowCss / ink, DIAGRAM_LINE_INK.arrow.width);
  return {
    ...DIAGRAM_LINE_INK,
    arrow: { ...DIAGRAM_LINE_INK.arrow, width: markWidth },
    // The accent is the arrow's weight, as in the table.
    highlight: { ...DIAGRAM_LINE_INK.highlight, width: markWidth },
    ...(aux ? { crease: at(aux), aux: at(aux) } : {}),
    ...(lines
      ? {
          edge: at(lines.edge),
          mountain: at(lines.mountainDiagramCreases),
          valley: at(lines.valleyDiagramCreases),
          'fold-mountain': at(lines.mountainFolds),
          'fold-valley': at(lines.valleyFolds),
        }
      : {}),
  };
}

/**
 * A reference letter.
 *
 * `size` and `halo` were user units rather than screen pixels before this — a
 * `font-size` inside a viewBox already scales — so they convert at 1.2 ink to
 * the user unit, not 1:1 like the strokes. The halo is the ground the letter
 * sits on: `placeLabels` pushes a label off the sheet into the padding band on
 * purpose, so it has to carry its own background out there.
 *
 * `glyph` is the box a letter is taken to fill, as shares of `size`, and it is
 * what the layout keeps clear of rings and other letters — an SVG `<text>`
 * cannot be measured before it is drawn, so its footprint is estimated from
 * the font size instead. A capital is as tall as the size, and its baseline
 * sits at 0.86 of the box because the halo reaches below it; its width is
 * the letter's own (`labelWidth`). `standoff` is the clear air kept between
 * that box and whatever it stands beside, and it is the halo's own reach: the
 * halo is painted in the ground colour, so a halo over a ring erases a piece
 * of it.
 *
 * `size` was `10.8` — `9 × 1.2` — until a step's page, where a letter keeps
 * its on-screen size beside pens drawn in pt, showed it a touch large.
 */
export const DIAGRAM_LABEL_INK = {
  size: 9.6,
  halo: 3,
  standoff: 1.5,
  glyph: { height: 1, baseline: 0.86 },
} as const;

/**
 * The marks a diagram draws beside its lines, in ink: a point's ring, a
 * letter, an arrow's head. A projector carries one set
 * (`DiagramProjector.marks`), because two kinds of surface want two sizes:
 * the step cards and every export draw these, tuned against a printed step,
 * and the References view draws {@link REFERENCES_VIEW_MARKS}.
 */
export interface DiagramMarks {
  /** A point's ring, centre to the middle of its stroke. */
  ringRadius: number;
  /** A letter's size: its em. */
  labelSize: number;
  /** An arrowhead, tip to barbs, before a short arrow's chord cap. */
  arrowheadLength: number;
}

export const DIAGRAM_MARKS: DiagramMarks = {
  ringRadius: DIAGRAM_MARK_INK.radius,
  labelSize: DIAGRAM_LABEL_INK.size,
  arrowheadLength: DIAGRAM_ARROWHEAD_INK.length,
};

/**
 * The References view's floors, in ink at the reader's line width: no part of
 * a step's instruction there is drawn smaller than it was before the marks were
 * tuned against a printed step and the lines became the paper style's pens.
 *
 * The view is an interactive full-screen picture, not a page. The paper
 * style's pens are print sizes — a 0.825 pt diagram crease is 1.1 px — and the
 * marks are a 50 mm page's; at fit on a large screen the sheet is several
 * times that page, and the instruction reads as too small for it. So each of
 * its lines and marks is the paper's size or its floor, whichever is larger: a
 * pen heavier than its floor draws as heavy as the style says, and the
 * colours, dashes and caps are always the style's. Fixed on screen, as the
 * paper's own sizes are there, so zooming moves the drawing and never resizes
 * it.
 *
 * Only the instruction — what a step asks: its fold, its accents, its arrows,
 * rings and letters. The paper and the pattern on it (the edge, the creases
 * already made, the aux lines, the pattern's folds) are the style's own sizes,
 * so the Find tab's crease pattern and the finished card draw as the style
 * says, and a step's instruction stands out against them as a diagram's does.
 */
export const REFERENCES_VIEW_FLOORS = {
  marks: { ringRadius: 3.84, labelSize: 10.8, arrowheadLength: 10.56 },
  lines: {
    highlight: 2,
    mountain: 1.6,
    valley: 1.6,
    arrow: 1.4,
  },
} as const satisfies {
  marks: DiagramMarks;
  lines: Partial<Record<DiagramLineStyleName, number>>;
};

/** The References view's marks: the print sizes, raised to the view's floors. */
export const REFERENCES_VIEW_MARKS: DiagramMarks = {
  ringRadius: Math.max(DIAGRAM_MARKS.ringRadius, REFERENCES_VIEW_FLOORS.marks.ringRadius),
  labelSize: Math.max(DIAGRAM_MARKS.labelSize, REFERENCES_VIEW_FLOORS.marks.labelSize),
  arrowheadLength: Math.max(
    DIAGRAM_MARKS.arrowheadLength,
    REFERENCES_VIEW_FLOORS.marks.arrowheadLength
  ),
};

/**
 * `pens` with each width raised to the References view's floor for it. A dash
 * is the pen's own pattern in multiples of its width, so a raised pen's runs
 * grow with it and the line keeps its pattern.
 *
 * The floors are in ink at the reader's line width; `scale` is that ink over
 * the ink `pens` are measured in, for pens measured from a heavier line width,
 * so a heavy edge pen does not raise every other line's floor with it.
 */
export function withReferencesViewFloors(pens: DiagramPens, scale = 1): DiagramPens {
  const floored: Record<DiagramLineStyleName, DiagramStrokeInk> = { ...pens };
  const floors = Object.entries(REFERENCES_VIEW_FLOORS.lines) as [DiagramLineStyleName, number][];
  for (const [name, inReaderInk] of floors) {
    const floor = inReaderInk * scale;
    const pen = floored[name];
    if (pen.width >= floor) continue;
    const grow = pen.width > 0 ? floor / pen.width : 1;
    floored[name] = {
      ...pen,
      width: floor,
      ...(pen.dash ? { dash: pen.dash.map((run) => run * grow) } : {}),
    };
  }
  return floored;
}

/**
 * How wide each capital is at the label's weight, in ems: Inter Bold's
 * advances, measured in the browser. The letters differ by half again — a Q
 * is 0.75, a P 0.62 — and a box sized by the average let a Q at the right
 * edge of a card run off it. A letter outside the table, or the fallback
 * font, gets the widest common one.
 */
const CAPITAL_WIDTHS: Readonly<Record<string, number>> = {
  A: 0.692, B: 0.64, C: 0.712, D: 0.7, E: 0.573, F: 0.548, G: 0.727, H: 0.729, I: 0.265,
  J: 0.558, K: 0.653, L: 0.543, M: 0.861, N: 0.714, O: 0.752, P: 0.618, Q: 0.752, R: 0.64,
  S: 0.631, T: 0.602, U: 0.707, V: 0.678, W: 0.965, X: 0.686, Y: 0.665, Z: 0.631,
};
const OTHER_GLYPH_WIDTH = 0.75;

/** The width of a label's text at font size `size`, in the same units. */
export function labelWidth(text: string, size: number): number {
  let ems = 0;
  for (const glyph of text) ems += CAPITAL_WIDTHS[glyph] ?? OTHER_GLYPH_WIDTH;
  return ems * size;
}

/**
 * The dash slots a diagram uses, and the patterns that fill them.
 *
 * All six the stroke program offers. The crease pattern's own table
 * (`lib/oristudioCpLineStyle`) spends its slots on Oriedita's shape-coded
 * style, and this surface replaces it rather than sharing it: the References
 * workspace is a diagram, and a diagram says mountain and valley with a
 * *pattern* — the one thing that still reads when the paper is turned over
 * and the colours change meaning. The fourth is the existing crease's, which
 * is solid in the table and takes the aux pen's dash when the style has one.
 * The last two are the fold pens': a crease pattern's lines, which the crease
 * channel draws and the finished card is, dash as the style's fold pens say —
 * apart from the diagram-crease pens a step's instruction dashes in.
 *
 * One assignment for both channels, the diagram's and the crease pattern's
 * under it, and the same patterns in both: while a fold plays the flap's
 * strokes from the two are drawn as one geometry under one table
 * (`foldPoseGeometry`), so a slot that meant one pen in one channel and
 * another in the other would draw the step's fold in the pattern's dash
 * mid-swing.
 *
 * Runs are in CSS pixels, which is what the program wants, so the pen decides
 * them. Every table pattern is at most two on/off pairs, inside the three the
 * shader walks; a pen's runs past those are dropped by the program.
 */
export const DIAGRAM_DASH_SLOTS: readonly DiagramLineStyleName[] = [
  'valley',
  'mountain',
  'dotted',
  'crease',
  'fold-valley',
  'fold-mountain',
];

/**
 * The slot a style takes; 0 is solid. The pattern's aux lines share the made
 * crease's, since they are drawn in the same pen.
 */
export function diagramDashSlot(style: DiagramLineStyleName): number {
  return DIAGRAM_DASH_SLOTS.indexOf(style === 'aux' ? 'crease' : style) + 1;
}

/** The slot table for `pens`, with every run scaled by the pen. */
export function diagramDashPatterns(inkCss: number, pens: DiagramPens = DIAGRAM_LINE_INK): number[][] {
  return DIAGRAM_DASH_SLOTS.map((style) => (pens[style].dash ?? []).map((run) => run * inkCss));
}
