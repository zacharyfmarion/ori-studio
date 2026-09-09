/**
 * A planner step as the primitives `StepDiagram` draws — the breakdown's
 * thumbnails, in the same picture language as ReferenceFinder's own.
 *
 * ReferenceFinder ships a diagram per step and
 * `referenceFinderDiagramToPrimitives.ts` only translates the style codes. The
 * planner ships *witnesses* instead, so the picture is synthesised here from
 * the typed references: the sheet, the lines and marks the fold is made
 * against, the motion arrow, and the crease it produces — drawn as short spans
 * when the pinch pass reduced it to marks, which is the one thing a thumbnail
 * must get right because a pinch and a full crease are different instructions.
 *
 * Two things make it read like a diagram rather than a diagram-shaped picture:
 *
 * - **The arrow is upstream's, drawn for what the step is.** `who_moves` already
 *   records which inputs move, per axiom
 *   (`crates/oristudio-precrease/src/predicates.rs`); its image is its
 *   reflection across the step's own line, and the arc between them is
 *   `RefDgmr::CalcArrow` ported verbatim (`stepDiagramGeometry.foldArrowArc`).
 *   Every step here is a precrease — folded and released — so that arc is the
 *   outgoing half of a round trip rather than the whole symbol
 *   (`foldAndUnfoldArrow`).
 *   An empty `who_moves` — O1 and O4, where nothing is brought onto anything —
 *   draws no arrow, which is honest rather than invented.
 * - **The inputs are lettered.** ReferenceFinder labels lines `A B C…` and marks
 *   `P Q R…`, and the sentence beside the picture uses those letters. The
 *   planner's sentences name references in words ("the top-left corner"), so the
 *   letters here are the picture's own index — assigned in the axiom's input
 *   order, which is the order the sentence reads them in.
 *
 * Coordinates stay in the planner's unit frame, y up, exactly as the RF
 * adapter's are, so one projector (`stepDiagramGeometry.ts`) serves both.
 *
 * Two more things make it a diagram rather than a picture of one line:
 *
 * - **Earlier creases are drawn.** A card used to be a bare square with one
 *   fold on it, which said nothing about where in the sequence you were. They
 *   take the template's "Crease Lines" weight — solid, a third of a fold line —
 *   because they are context, not the instruction. On a surface that already
 *   has the crease pattern under it, only the marks the pattern does not hold
 *   are drawn; see `PlannerStepDiagramOptions.earlier`.
 * - **The new crease is drawn in the direction it is made.** The crate settles
 *   that — one direction per step, by the majority of the line's creased length
 *   (plan D21) — so `Step.direction` is read straight off the step.
 *
 * An **O1** step is the one exception to drawing the full chord: it is a crease
 * *through two marks* and nothing moves, so there is no arrow to draw and the
 * crease runs between the marks. Every alignment fold keeps its chord and, when
 * the crate says something moves, its arc. O4 also moves nothing (a
 * perpendicular is sighted, not swung), so it too draws without an arrow —
 * that comes from `who_moves` being empty and needs no special case here.
 */
import { dashRulerAlong, foldArrowArc } from '../stepDiagramGeometry';
import type { DiagramFrame, DiagramSegment } from './diagramFrames';
import type {
  DiagramLineStyleName,
  StepDiagramModel,
  StepDiagramPrimitive,
} from '../referenceFinderDiagramToPrimitives';
import {
  chosenWitness,
  type PrecreaseDirection,
  type PrecreaseRef,
  type PrecreaseSequence,
  type PrecreaseStep,
} from '../precreaseSequence';

/** A frame segment as the primitives' own tuples. */
const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y];

/** The in-paper segment an input reference stands for, if it is a line at all. */
function segmentOfRef(
  sequence: PrecreaseSequence,
  frame: DiagramFrame,
  ref: PrecreaseRef
): DiagramSegment | null {
  if (ref.kind === 'edge') return frame.edge(ref.side);
  if (ref.kind !== 'line') return null;
  const entry = sequence.lines.find((line) => line.id === ref.id);
  if (!entry || entry.step === null) return null;
  const step = sequence.steps.find((s) => s.id === entry.step);
  return step ? frame.chord(step) : null;
}

/**
 * The segment between an axiom's two point inputs, or null when it does not
 * have exactly two.
 */
function markSegment(
  frame: DiagramFrame,
  inputs: readonly PrecreaseRef[]
): DiagramSegment | null {
  const points = inputs.flatMap((ref) => {
    if (ref.kind !== 'point' && ref.kind !== 'corner') return [];
    const point = frame.point(ref.id);
    return point ? [point] : [];
  });
  return points.length === 2 ? [points[0]!, points[1]!] : null;
}

/** Where an input sits, as the one point an arrow can be drawn from. */
function anchorOfRef(
  sequence: PrecreaseSequence,
  frame: DiagramFrame,
  ref: PrecreaseRef
): [number, number] | null {
  if (ref.kind === 'point' || ref.kind === 'corner') {
    const point = frame.point(ref.id);
    return point ? xy(point) : null;
  }
  const segment = segmentOfRef(sequence, frame, ref);
  // A moving *line* has no single position, so the arrow is drawn from the
  // midpoint of its chord — the same place upstream's line-to-line arrows sit.
  return segment
    ? [(segment[0].x + segment[1].x) / 2, (segment[0].y + segment[1].y) / 2]
    : null;
}

/**
 * Reflect `p` across the line through a segment.
 *
 * Taken from the drawn chord rather than from `step.line`, because the chord is
 * the one thing every frame supplies and the line's `n · p = d` form is only
 * written down in the planner's own units. A similarity carries a reflection to
 * a reflection, so the two agree wherever both exist.
 */
function reflectAcross(segment: DiagramSegment, p: readonly [number, number]): [number, number] {
  const dx = segment[1].x - segment[0].x;
  const dy = segment[1].y - segment[0].y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [p[0], p[1]];
  const n: [number, number] = [-dy / length, dx / length];
  const d = n[0] * segment[0].x + n[1] * segment[0].y;
  const signed = n[0] * p[0] + n[1] * p[1] - d;
  return [p[0] - 2 * signed * n[0], p[1] - 2 * signed * n[1]];
}

/** `A B C…` for lines and edges, `P Q R…` for marks — ReferenceFinder's scheme. */
function refLetter(ref: PrecreaseRef, lineIndex: number, pointIndex: number): string {
  return ref.kind === 'point' || ref.kind === 'corner'
    ? String.fromCharCode('P'.charCodeAt(0) + (pointIndex % 11))
    : String.fromCharCode('A'.charCodeAt(0) + (lineIndex % 15));
}

/**
 * The thumbnail for `sequence.steps[index]`.
 *
 * Only the step's own inputs are drawn, never the whole folded state: at
 * 100 × 100 the sheet plus three or four references is already the limit of
 * what reads, and the CP view beside it is the full picture (plan: "the CP
 * view itself is the diagram"). Null when the index names no step.
 */
export interface PlannerStepDiagramOptions {
  /**
   * How much of the sheet as it stands to draw under the step.
   *
   * `all` is a card: it is the entire picture, so it carries every mark the
   * earlier steps left. `unpatterned` is the canvas, which has the document's
   * own creases beneath it in the document's own ink — so the only earlier
   * marks left to draw there are the ones the pattern does not contain: the
   * pinches, and the auxiliary folds that leave no crease behind. Drawing the
   * rest a second time is not a heavier line, it is two lines a fraction apart,
   * each filling the other's dash gaps.
   */
  earlier?: 'all' | 'unpatterned';
}

/**
 * What a step actually left on the paper: the CP creases it made, the spans it
 * pinched, or — for an auxiliary fold pressed in full — its whole chord.
 *
 * Never the whole chord of a CP step. The parts of a fold the pattern does not
 * crease are not on the paper, and drawing them is the difference between a
 * diagram and a picture of a line.
 */
function creasedSpans(
  frame: DiagramFrame,
  step: PrecreaseStep,
  patterned = true
): readonly DiagramSegment[] {
  const creases = frame.creases(step);
  // `patterned` false means something else is already drawing exactly these,
  // out of the crease pattern itself. The two branches below are not in the
  // pattern by definition, so they are drawn either way.
  if (creases.length > 0) return patterned ? creases : [];
  const pinches = frame.pinches(step);
  if (pinches.length > 0) return pinches;
  const chord = frame.chord(step);
  return chord ? [chord] : [];
}

/**
 * A span as a drawable line, put on its own line's dash ruler.
 *
 * Every piece of one crease then measures its pattern from the same zero, so a
 * crease split at four crossings reads as one dashed line rather than four.
 */
function spanLine(span: DiagramSegment, style: DiagramLineStyleName): StepDiagramPrimitive {
  const ruler = dashRulerAlong(span[0].x, span[0].y, span[1].x, span[1].y);
  return {
    kind: 'line',
    from: [ruler.ax, ruler.ay],
    to: [ruler.bx, ruler.by],
    style,
    dashPhase: ruler.phase,
  };
}

/** The style a crease of `direction` draws in, made or already made. */
function styleOf(direction: PrecreaseDirection, made: boolean): DiagramLineStyleName {
  if (!made) return 'crease';
  if (direction === 'mountain') return 'mountain';
  if (direction === 'valley') return 'valley';
  // An auxiliary line: creased, but the pattern assigns it nothing, so it takes
  // the neutral ink rather than borrowing a direction it does not have.
  return 'crease';
}

export function plannerStepDiagram(
  sequence: PrecreaseSequence,
  frame: DiagramFrame,
  index: number,
  options: PlannerStepDiagramOptions = {}
): StepDiagramModel | null {
  const step = sequence.steps[index];
  if (!step) return null;
  const sheet = frame.sheet;
  const primitives: StepDiagramPrimitive[] = [];
  if (frame.outline) {
    primitives.push({ kind: 'sheet', width: sheet.width, height: sheet.height });
  }

  // The sheet as it stands: everything folded so far, over the paper and under
  // this step's own references.
  const patterned = (options.earlier ?? 'all') === 'all';
  for (let i = 0; i < index; i += 1) {
    const earlier = sequence.steps[i];
    if (!earlier) continue;
    for (const span of creasedSpans(frame, earlier, patterned)) {
      primitives.push(spanLine(span, 'crease'));
    }
  }

  const witness = chosenWitness(step);
  const inputs = witness?.inputs ?? [];
  const labels: StepDiagramPrimitive[] = [];
  let lineIndex = 0;
  let pointIndex = 0;
  inputs.forEach((ref) => {
    const letter = refLetter(ref, lineIndex, pointIndex);
    if (ref.kind === 'point' || ref.kind === 'corner') {
      const point = frame.point(ref.id);
      if (!point) return;
      pointIndex += 1;
      primitives.push({ kind: 'point', at: xy(point), style: 'highlight' });
      labels.push({ kind: 'label', at: xy(point), text: letter, style: 'highlight' });
      return;
    }
    const segment = segmentOfRef(sequence, frame, ref);
    if (!segment) return;
    lineIndex += 1;
    primitives.push({
      kind: 'line',
      from: xy(segment[0]),
      to: xy(segment[1]),
      style: 'highlight',
    });
    const mid: [number, number] = [
      (segment[0].x + segment[1].x) / 2,
      (segment[0].y + segment[1].y) / 2,
    ];
    labels.push({ kind: 'label', at: mid, text: letter, style: 'highlight' });
  });

  // The motion: each moving input to its image across the new crease.
  const chord = frame.chord(step);
  for (const which of witness?.who_moves ?? []) {
    const ref = inputs[which];
    if (!ref || !chord) continue;
    const anchor = anchorOfRef(sequence, frame, ref);
    if (!anchor) continue;
    const out = foldArrowArc(anchor, reflectAcross(chord, anchor), xy(frame.centre));
    if (out) primitives.push({ kind: 'fold-arrow', out });
  }

  // The crease this step makes, then the letters, both over the references. The
  // crate settled the direction (plan D21) — one per step, never two.
  const direction = step.direction;
  const made = styleOf(direction, true);
  const pinches = frame.pinches(step);
  const creases = frame.creases(step);
  if (pinches.length > 0) {
    // A pinch is a crease, so it carries its own direction rather than a colour
    // of its own.
    const pinch: DiagramLineStyleName =
      direction === 'mountain'
        ? 'pinch-mountain'
        : direction === 'valley'
          ? 'pinch-valley'
          : 'pinch';
    for (const span of pinches) primitives.push(spanLine(span, pinch));
  } else if (creases.length > 0) {
    // The pattern only wants creases where its own segments are, so that is all
    // the picture draws. The rest of the chord used to be shown faintly, to say
    // the fold still runs the full width — but a crease pattern's line is not
    // an instruction to crease all of it, and the faint stand-in read as one.
    for (const span of creases) primitives.push(spanLine(span, made));
  } else if (chord) {
    // An auxiliary fold leaves no crease in the pattern, so the whole chord is
    // the instruction. O1 is the exception: "crease through these two marks"
    // means the marks are, so the crease is drawn between them.
    const through = witness?.axiom === 1 ? markSegment(frame, inputs) : null;
    const segment = through ?? chord;
    primitives.push({
      kind: 'line',
      from: xy(segment[0]),
      to: xy(segment[1]),
      style: made,
    });
  }
  primitives.push(...labels);

  return { sheet: { width: sheet.width, height: sheet.height }, primitives };
}

/**
 * The turn-over card: the sheet as it stands, with the symbol that says to flip
 * it.
 *
 * The symbol is the standard one — a ring with an arrow looping over it, as the
 * house template draws it — rather than a chord across the sheet with a head at
 * each end, which is a *fold* arrow and said the wrong thing. It sits on the
 * paper at a fixed fraction of the shorter side, so it reads the same on a
 * square and on a long rectangle.
 *
 * `after` is the last planner step folded by this point, or null when nothing
 * is — a plan that opens with a mountain turns the paper over before its first
 * fold. Drawing every step's crease regardless would show the finished pattern
 * on a card the folder reaches a third of the way through.
 */
export function plannerTurnOverDiagram(
  sequence: PrecreaseSequence,
  frame: DiagramFrame,
  after: number | null
): StepDiagramModel {
  const sheet = frame.sheet;
  const primitives: StepDiagramPrimitive[] = [];
  if (frame.outline) {
    primitives.push({ kind: 'sheet', width: sheet.width, height: sheet.height });
  }
  for (let i = 0; after !== null && i <= after && i < sequence.steps.length; i += 1) {
    const step = sequence.steps[i];
    if (!step) continue;
    for (const span of creasedSpans(frame, step)) {
      primitives.push(spanLine(span, 'crease'));
    }
  }
  primitives.push(...turnOverSymbol(frame));
  return { sheet: { width: sheet.width, height: sheet.height }, primitives };
}

/**
 * The turn-over symbol, centred on the sheet.
 *
 * The glyph itself is transcribed from the house's own drawing
 * (`stepDiagramGeometry.ts`, `TURN_OVER_PATH`): a stroke that comes in from one
 * side, loops once, and leaves the other with the arrowhead. How big it is
 * belongs to the drawing, not to the paper — see the primitive.
 */
function turnOverSymbol(frame: DiagramFrame): StepDiagramPrimitive[] {
  return [{ kind: 'turn-over', at: xy(frame.centre) }];
}

/**
 * The finished pattern, each crease in the direction it was made.
 *
 * Which is not, on a mixed line, the direction the pattern ends up assigning
 * every one of its creases — a precrease sequence puts the crease in the right
 * place, and the collapse settles the rest (plan D26).
 */
export function plannerFinishedDiagram(
  sequence: PrecreaseSequence,
  frame: DiagramFrame
): StepDiagramModel {
  const sheet = frame.sheet;
  const primitives: StepDiagramPrimitive[] = [];
  if (frame.outline) {
    primitives.push({ kind: 'sheet', width: sheet.width, height: sheet.height });
  }
  for (const step of sequence.steps) {
    const style = styleOf(step.direction, true);
    for (const span of creasedSpans(frame, step)) {
      primitives.push(spanLine(span, style));
    }
  }
  return { sheet: { width: sheet.width, height: sheet.height }, primitives };
}
