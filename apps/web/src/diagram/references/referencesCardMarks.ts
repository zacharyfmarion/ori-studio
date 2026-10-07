/**
 * A References card split at the pull (17d, §1, §2 and §5 of
 * `implementation-plans/diagram-references-annotations.md`): the paper stays
 * the picture — the sheet, the creases already made, the pattern's aux lines,
 * the band wash, the uncreased rest of a fold, a pinch with no direction, the
 * finished card's pattern — and what the step asks the folder to do lifts
 * into annotations, each tagged `untouched`:
 *
 * - its own valley and mountain folds, and its pinches with a direction, as
 *   valley and mountain lines, the pieces of one fold that touch end to end
 *   merged into one line (RM10);
 * - its reference lines (`highlight`) as solid lines in References' magenta;
 * - every ring as a circle, so an arrow still stops at its rim;
 * - every letter as Text set as References sets it — magenta, bold, haloed,
 *   9 pt — hung from the point it names by the offset References' own layout
 *   gives it at the 50 mm cards and the canvas draw (RM1, L3);
 * - every fold arrow as a fold-and-unfold arrow through the same arc.
 *
 * Nothing is parsed: a card is already a list of typed pieces in known
 * coordinates, and `stepDiagramToPicture` is the map its picture draws them
 * by, so a lifted mark lands where the card drew it. The marks the Show menu
 * leaves out (RM4) are not pulled at all; rings stay, as in export.
 *
 * Pure: no store, no DOM.
 */
import { seenFromTheBack } from '../../cp-workspace/references/diagram/diagramModel';
import type { StepDiagramModel, StepDiagramPrimitive } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import { referencesStepDiagramMarks } from '../../cp-workspace/references/referencesStepExport';
import { arcExtent, type DiagramArc } from '../../cp-workspace/references/stepDiagramGeometry';
import { DEFAULT_PAPER_SIZE_MM } from '../../lib/paper/paperPage';
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import type { PaperExportMarks } from '../../lib/paperExportSettings';
import { REFERENCE_LINE_COLOR } from '../annotate/annotationColors';
import { cleanAnnotation, MAX_STEP_ANNOTATIONS, textEms, type PicturePoint } from '../annotate/annotationModel';
import { LABEL_BASELINE } from '../annotate/annotationPrimitives';
import {
  liftedStepDiagramKey,
  randomDiagramId,
  type DiagramAnnotationKind,
  type DiagramIdFactory,
  type DiagramStepDiagramPicture,
  type DiagramStyle,
  type KnownDiagramAnnotation,
  type LiftedCard,
} from '../document/diagramDocument';
import { storedAnnotations } from '../document/diagramFile';
import { storedStepDiagramModel } from '../document/stepDiagramModelFile';
import { stepDiagramLetters, stepDiagramToPicture } from '../pictures/paintStepDiagram';

/** A card split: its sheet — the paper as it stands, in the card's own frame — and its marks, in picture units. */
export interface LiftedCardMarks {
  sheet: StepDiagramModel;
  annotations: KnownDiagramAnnotation[];
}

/**
 * The size a pulled letter is laid out at, once: the sheet's longer side the
 * 50 mm the cards and the canvas draw a References step at. At any other size
 * it keeps its distance from its ring in pt, where a page today lays its
 * letters out again and can move one to another side (RM1).
 */
export const LIFT_SHEET_MM = DEFAULT_PAPER_SIZE_MM;

/** A pulled letter's size, in pt: References' 9.6 ink letter (`DIAGRAM_LABEL_INK`), 12 CSS px. */
export const PULLED_LETTER_PT = 9;

/** Which annotation a line style lifts to, and the reference lines' colour; none for a line that is the paper. */
const LIFTED_LINES: Partial<Record<string, { kind: DiagramAnnotationKind; color?: string }>> = {
  valley: { kind: 'valley-line' },
  mountain: { kind: 'mountain-line' },
  'pinch-valley': { kind: 'valley-line' },
  'pinch-mountain': { kind: 'mountain-line' },
  highlight: { kind: 'solid-line', color: REFERENCE_LINE_COLOR },
};

/** A lifted line before merging: the piece, the style it was drawn in, and where it came in the card. */
interface LinePiece {
  index: number;
  style: string;
  kind: DiagramAnnotationKind;
  color?: string;
  from: PicturePoint;
  to: PicturePoint;
}

/**
 * The card `model`, seen from the back when `mirrored`, split into its sheet
 * and its marks (17d): only the marks `marks` shows, the letters laid out as
 * the diagram's `style` draws its pages at 50 mm (the ring's rim is the
 * style's arrow pen's). Each mark is already in the form a file reads back and
 * an edit would leave it in. Null when the marks are more than a step holds
 * (`MAX_STEP_ANNOTATIONS`): the card is then pulled with its marks in its
 * picture, as before.
 */
export function liftCardMarks(
  model: StepDiagramModel,
  mirrored: boolean,
  marks: PaperExportMarks,
  style: DiagramStyle,
  newId: DiagramIdFactory = randomDiagramId
): LiftedCardMarks | null {
  // What the Show menu leaves out is not pulled, nor left in the picture.
  const card = referencesStepDiagramMarks(model, marks);
  // Which way each fold goes is said from the face the card shows.
  const named = mirrored ? seenFromTheBack(card.primitives) : card.primitives;
  const toPicture = stepDiagramToPicture(card, mirrored);
  const letters = card.primitives.some((primitive) => primitive.kind === 'label')
    ? stepDiagramLetters(card, mirrored, style, LIFT_SHEET_MM)
    : null;

  const lifted = new Set<number>();
  const pieces: LinePiece[] = [];
  const others: { index: number; mark: Omit<KnownDiagramAnnotation, 'id'> }[] = [];
  named.forEach((primitive, index) => {
    const mark = liftedMark(primitive, index);
    if (mark === null) return;
    lifted.add(index);
    if ('style' in mark) pieces.push(mark);
    else others.push({ index, mark });
  });

  /** One primitive as a mark, a line as a piece to merge; null for what stays the paper. */
  function liftedMark(primitive: StepDiagramPrimitive, index: number): LinePiece | Omit<KnownDiagramAnnotation, 'id'> | null {
    switch (primitive.kind) {
      case 'line': {
        const lifts = LIFTED_LINES[primitive.style];
        if (!lifts) return null;
        return { index, style: primitive.style, ...lifts, from: toPicture(primitive.from), to: toPicture(primitive.to) };
      }
      case 'point': {
        const at = toPicture(primitive.at);
        return { kind: 'circle', from: at, to: at };
      }
      case 'fold-arrow':
        return foldUnfoldArrow(primitive.out, toPicture);
      case 'label': {
        const placement = letters?.placements.get(index);
        if (!letters || !placement) return null;
        const at = toPicture(primitive.at);
        const { project } = letters;
        // The letter's em as the card sets it, and its glyph's centre: References anchors it at its
        // edge nearest its point; Text is centred, so the anchor is moved by half the letter's advance in
        // Noto Sans Bold, the face a page sets both in. Its baseline is the same line either way.
        const size = project.marks.labelSize * project.ink;
        const advance = textEms(primitive.text, true) * size;
        const centreX =
          placement.anchor === 'start'
            ? placement.x + advance / 2
            : placement.anchor === 'end'
              ? placement.x - advance / 2
              : placement.x;
        const centreY = placement.y - LABEL_BASELINE * size;
        const point = project(primitive.at);
        return {
          kind: 'label',
          from: at,
          to: at,
          text: primitive.text,
          color: REFERENCE_LINE_COLOR,
          bold: true,
          halo: true,
          sizePt: PULLED_LETTER_PT,
          offsetPt: [(centreX - point.x) / PT_TO_CSS_PX, (centreY - point.y) / PT_TO_CSS_PX],
        };
      }
      default:
        return null;
    }
  }

  // Every lifted mark in the card's order, each merged line where its first piece was.
  const ordered = [
    ...mergedLines(pieces, Math.max(card.sheet.width, card.sheet.height)).map(({ index, kind, color, from, to }) => ({
      index,
      mark: { kind, from, to, ...(color !== undefined ? { color } : {}) },
    })),
    ...others,
  ].sort((a, b) => a.index - b.index);
  if (ordered.length > MAX_STEP_ANNOTATIONS) return null;
  const annotations = storedAnnotations(
    ordered.map(({ mark }) => cleanAnnotation({ ...mark, id: newId('annotation'), imported: 'untouched' }))
  );
  // The paper as it stands: the card's own primitives, unflipped — the painter turns it over itself — less every one
  // lifted and every one the Show menu can hide, shown or not, so one card has one sheet whatever the menu says (§6):
  // a reference line drawn as an arc, which nothing draws today and nothing lifts, is never the paper.
  const taken = new Set(card.primitives.filter((_, index) => lifted.has(index)));
  for (const primitive of hideable(model)) taken.add(primitive);
  const sheet: StepDiagramModel = { ...model, primitives: model.primitives.filter((primitive) => !taken.has(primitive)) };
  return { sheet, annotations };
}

/** The pieces of a card the Show menu can hide: its letters and its reference lines. */
function hideable(model: StepDiagramModel): StepDiagramPrimitive[] {
  const shown = new Set(referencesStepDiagramMarks(model, { letters: false, highlights: false }).primitives);
  return model.primitives.filter((primitive) => !shown.has(primitive));
}

/**
 * A card's picture with its marks lifted (17d), as a step keeps it: the
 * sheet as the file reads it back, keyed by the card and `-marks`, and the
 * marks. Null for a card whose marks are more than a step holds, or whose
 * sheet the file would not keep.
 */
export function liftedCardPicture(
  picture: DiagramStepDiagramPicture,
  marks: PaperExportMarks,
  style: DiagramStyle,
  newId?: DiagramIdFactory
): LiftedCard | null {
  const split = liftCardMarks(picture.model, picture.mirrored, marks, style, newId);
  const sheet = split && storedStepDiagramModel(split.sheet);
  if (!split || !sheet) return null;
  return {
    picture: { kind: 'step-diagram', model: sheet, mirrored: picture.mirrored, key: liftedStepDiagramKey(picture.key, picture.mirrored) },
    annotations: split.annotations,
  };
}

/**
 * A card's picture as the browser shows it under the Show menu (17d): the
 * marks it hides taken out, so what is seen is what is pulled; the picture
 * itself when every mark shows. Keyed apart from the card's own, which is
 * never stored.
 */
export function shownCardPicture(picture: DiagramStepDiagramPicture, marks: PaperExportMarks): DiagramStepDiagramPicture {
  if (marks.letters && marks.highlights) return picture;
  return {
    ...picture,
    model: referencesStepDiagramMarks(picture.model, marks),
    key: `${picture.key}|shows-${marks.letters ? 'l' : ''}${marks.highlights ? 'h' : ''}`,
  };
}

/**
 * A card's fold arrow as a fold-and-unfold arrow: its arc's two ends mapped,
 * and its bend read off where the arc's middle is mapped to — never assumed —
 * so it compiles back to the same arc. A mirrored card's flips its own sign.
 */
function foldUnfoldArrow(
  arc: DiagramArc,
  toPicture: (point: readonly [number, number]) => [number, number]
): Omit<KnownDiagramAnnotation, 'id'> | null {
  const sweep = arcExtent(arc);
  const middle = arc.ccw ? arc.from + sweep / 2 : arc.from - sweep / 2;
  const on = (angle: number): [number, number] => [
    arc.center[0] + arc.radius * Math.cos(angle),
    arc.center[1] + arc.radius * Math.sin(angle),
  ];
  const from = toPicture(on(arc.from));
  const to = toPicture(on(arc.to));
  const apex = toPicture(on(middle));
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const chord = Math.hypot(dx, dy);
  if (!(chord > 0)) return null;
  // The sagitta, in chords, to the left of its travel (`arrowApex`).
  const left: PicturePoint = [dy / chord, -dx / chord];
  const mid: PicturePoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const bend = ((apex[0] - mid[0]) * left[0] + (apex[1] - mid[1]) * left[1]) / chord;
  if (!Number.isFinite(bend) || bend === 0) return null;
  return { kind: 'fold-unfold-arrow', from, to, bend };
}

/**
 * The line pieces as lines (RM10): pieces of one style that lie on one line
 * and touch or overlap end to end are one fold, drawn as one line that runs
 * from the first's start the way it runs; disjoint pieces — two pinches —
 * stay apart. `extent`, the sheet's longer side, scales what counts as
 * touching.
 */
function mergedLines(pieces: readonly LinePiece[], extent: number): LinePiece[] {
  const epsilon = 1e-7 * Math.max(extent, Number.EPSILON);
  const lines: LinePiece[] = [];
  for (const piece of pieces) lines.push({ ...piece });
  // Joined until nothing joins: a piece can bridge two found before it.
  let joined = true;
  while (joined) {
    joined = false;
    for (let i = 0; i < lines.length && !joined; i += 1) {
      for (let j = i + 1; j < lines.length && !joined; j += 1) {
        const merged = joinedLine(lines[i]!, lines[j]!, epsilon);
        if (!merged) continue;
        lines[i] = merged;
        lines.splice(j, 1);
        joined = true;
      }
    }
  }
  return lines;
}

/** `a` and `b` as one line when they are of one style, on one line, and touch or overlap; else null. */
function joinedLine(a: LinePiece, b: LinePiece, epsilon: number): LinePiece | null {
  if (a.style !== b.style) return null;
  const [dx, dy] = [a.to[0] - a.from[0], a.to[1] - a.from[1]];
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  const [ux, uy] = [dx / length, dy / length];
  // Each end of `b` on `a`'s line, and how far along it from `a`'s start.
  const along = (p: PicturePoint) => (p[0] - a.from[0]) * ux + (p[1] - a.from[1]) * uy;
  const off = (p: PicturePoint) => Math.abs((p[0] - a.from[0]) * uy - (p[1] - a.from[1]) * ux);
  if (off(b.from) > epsilon || off(b.to) > epsilon) return null;
  const [b0, b1] = [along(b.from), along(b.to)].sort((x, y) => x - y) as [number, number];
  if (b0 > length + epsilon || b1 < -epsilon) return null;
  const start = Math.min(0, b0);
  const end = Math.max(length, b1);
  const at = (t: number): PicturePoint => [a.from[0] + ux * t, a.from[1] + uy * t];
  return {
    ...a,
    index: Math.min(a.index, b.index),
    from: start === 0 ? a.from : at(start),
    to: end === length ? a.to : at(end),
  };
}
