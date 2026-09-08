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
 * - **The arrow is upstream's.** `who_moves` already records which inputs move,
 *   per axiom (`crates/oristudio-precrease/src/predicates.rs`); its image is its
 *   reflection across the step's own line, and the arc between them is
 *   `RefDgmr::CalcArrow` ported verbatim (`stepDiagramGeometry.foldArrowArc`).
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
 *   because they are context, not the instruction.
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
import { dashRulerAlong, foldArrowArc } from './stepDiagramGeometry';
import type {
  DiagramLineStyleName,
  StepDiagramModel,
  StepDiagramPrimitive,
} from './referenceFinderDiagramToPrimitives';
import {
  chosenWitness,
  type PrecreaseDirection,
  type PrecreaseEdgeSide,
  type PrecreasePlanLine,
  type PrecreasePlanSegment,
  type PrecreasePointEntry,
  type PrecreaseRef,
  type PrecreaseSequence,
  type PrecreaseStep,
} from './precreaseSequence';

function edgeSegment(
  sheet: { width: number; height: number },
  side: PrecreaseEdgeSide
): PrecreasePlanSegment {
  const { width: w, height: h } = sheet;
  switch (side) {
    case 'left':
      return [
        [0, 0],
        [0, h],
      ];
    case 'right':
      return [
        [w, 0],
        [w, h],
      ];
    case 'bottom':
      return [
        [0, 0],
        [w, 0],
      ];
    case 'top':
      return [
        [0, h],
        [w, h],
      ];
  }
}

/** The step that folded state line `id`, if any. */
function stepForLine(sequence: PrecreaseSequence, id: number): PrecreaseStep | null {
  const entry = sequence.lines.find((line) => line.id === id);
  if (!entry || entry.step === null) return null;
  return sequence.steps.find((step) => step.id === entry.step) ?? null;
}

/** Reflect a point across `n · p = d`, `|n| = 1`. */
function reflect(
  line: PrecreasePlanLine,
  p: readonly [number, number]
): [number, number] {
  const signed = line.n[0] * p[0] + line.n[1] * p[1] - line.d;
  return [p[0] - 2 * signed * line.n[0], p[1] - 2 * signed * line.n[1]];
}

/** The in-paper segment an input reference stands for, if it is a line at all. */
function segmentOfRef(
  sequence: PrecreaseSequence,
  ref: PrecreaseRef
): PrecreasePlanSegment | null {
  if (ref.kind === 'edge') return edgeSegment(sequence.sheet, ref.side);
  if (ref.kind === 'line') return stepForLine(sequence, ref.id)?.segment ?? null;
  return null;
}

/**
 * Which sheet edge each edge line is, and which step folded each crease.
 *
 * The witnesses are the only place the *side* of an edge is written down, and
 * scanning them is a whole-sequence walk — memoised per sequence so drawing a
 * card stays proportional to the card.
 */
const sequenceLineIndex = new WeakMap<
  PrecreaseSequence,
  { edgeSides: Map<number, PrecreaseEdgeSide>; stepOfLine: Map<number, number> }
>();

function lineIndexOf(sequence: PrecreaseSequence) {
  const cached = sequenceLineIndex.get(sequence);
  if (cached) return cached;
  const edgeSides = new Map<number, PrecreaseEdgeSide>();
  const stepOfLine = new Map<number, number>();
  for (const entry of sequence.lines) {
    if (entry.step !== null) stepOfLine.set(entry.id, entry.step);
  }
  for (const step of sequence.steps) {
    for (const witness of step.witnesses) {
      for (const ref of witness.inputs) {
        if (ref.kind === 'edge') edgeSides.set(ref.id, ref.side);
      }
    }
  }
  const built = { edgeSides, stepOfLine };
  sequenceLineIndex.set(sequence, built);
  return built;
}

/**
 * The chords of the (at most two) creases that locate a mark, as of this step.
 *
 * A point in the planner's state carries every line through it, including ones
 * folded much later; drawing those would show the folder a crease that does not
 * exist yet. Cut to what has been made and ordered edge-first, then earliest,
 * so the picture agrees with the sentence.
 */
function locatingSpans(
  sequence: PrecreaseSequence,
  step: PrecreaseStep,
  point: PrecreasePointEntry
): PrecreasePlanSegment[] {
  const { edgeSides, stepOfLine } = lineIndexOf(sequence);
  const made = point.lines.filter((id) => {
    const at = stepOfLine.get(id);
    return at === undefined || at < step.id;
  });
  made.sort((a, b) => {
    const sa = stepOfLine.get(a);
    const sb = stepOfLine.get(b);
    if (sa === undefined || sb === undefined) {
      return (sa === undefined ? 0 : 1) - (sb === undefined ? 0 : 1);
    }
    return sa - sb;
  });
  return made
    .slice(0, 2)
    .map((id) => {
      const side = edgeSides.get(id);
      return segmentOfRef(sequence, side ? { kind: 'edge', id, side } : { kind: 'line', id });
    })
    .filter((span): span is PrecreasePlanSegment => span !== null);
}

/**
 * The segment between an axiom's two point inputs, or null when it does not
 * have exactly two.
 */
function markSegment(
  sequence: PrecreaseSequence,
  inputs: readonly PrecreaseRef[]
): PrecreasePlanSegment | null {
  const points = inputs.flatMap((ref) => {
    if (ref.kind !== 'point' && ref.kind !== 'corner') return [];
    const point = sequence.points.find((entry) => entry.id === ref.id);
    return point ? [[point.p[0], point.p[1]] as [number, number]] : [];
  });
  return points.length === 2 ? [points[0]!, points[1]!] : null;
}

/** Where an input sits, as the one point an arrow can be drawn from. */
function anchorOfRef(
  sequence: PrecreaseSequence,
  ref: PrecreaseRef
): [number, number] | null {
  if (ref.kind === 'point' || ref.kind === 'corner') {
    const point = sequence.points.find((entry) => entry.id === ref.id);
    return point ? [point.p[0], point.p[1]] : null;
  }
  const segment = segmentOfRef(sequence, ref);
  // A moving *line* has no single position, so the arrow is drawn from the
  // midpoint of its chord — the same place upstream's line-to-line arrows sit.
  return segment
    ? [(segment[0][0] + segment[1][0]) / 2, (segment[0][1] + segment[1][1]) / 2]
    : null;
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
  /** Draw the creases earlier steps made, as context. Default true. */
  showEarlier?: boolean;
}

/**
 * What a step actually left on the paper: the CP creases it made, the spans it
 * pinched, or — for an auxiliary fold pressed in full — its whole chord.
 *
 * Never the whole chord of a CP step. The parts of a fold the pattern does not
 * crease are not on the paper, and drawing them is the difference between a
 * diagram and a picture of a line.
 */
function creasedSpans(step: PrecreaseStep): PrecreasePlanSegment[] {
  if (step.cp_spans.length > 0) return step.cp_spans;
  if (step.extent.kind === 'pinches') return step.extent.spans;
  return [step.segment];
}

/**
 * A span as a drawable line, put on its own line's dash ruler.
 *
 * Every piece of one crease then measures its pattern from the same zero, so a
 * crease split at four crossings reads as one dashed line rather than four.
 */
function spanLine(
  span: PrecreasePlanSegment,
  style: DiagramLineStyleName
): StepDiagramPrimitive {
  const ruler = dashRulerAlong(span[0][0], span[0][1], span[1][0], span[1][1]);
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
  index: number,
  options: PlannerStepDiagramOptions = {}
): StepDiagramModel | null {
  const step = sequence.steps[index];
  if (!step) return null;
  const sheet = sequence.sheet;
  const primitives: StepDiagramPrimitive[] = [
    { kind: 'sheet', width: sheet.width, height: sheet.height },
  ];

  // The sheet as it stands: everything folded so far, over the paper and under
  // this step's own references.
  if (options.showEarlier ?? true) {
    for (let i = 0; i < index; i += 1) {
      const earlier = sequence.steps[i];
      if (!earlier) continue;
      for (const span of creasedSpans(earlier)) {
        primitives.push(spanLine(span, 'crease'));
      }
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
      const point = sequence.points.find((entry) => entry.id === ref.id);
      if (!point) return;
      pointIndex += 1;
      // The two creases that put the mark there, picked out. Without them a
      // mark on an edge is a dot with nothing determining it, and the sentence
      // says "where the left edge meets the crease from step 7" over a picture
      // that shows neither. A corner needs no such help.
      if (ref.kind === 'point') {
        for (const span of locatingSpans(sequence, step, point)) {
          primitives.push({ kind: 'line', from: span[0], to: span[1], style: 'highlight' });
        }
      }
      primitives.push({ kind: 'point', at: point.p, style: 'highlight' });
      labels.push({ kind: 'label', at: point.p, text: letter, style: 'highlight' });
      return;
    }
    const segment = segmentOfRef(sequence, ref);
    if (!segment) return;
    lineIndex += 1;
    primitives.push({ kind: 'line', from: segment[0], to: segment[1], style: 'highlight' });
    const mid: [number, number] = [
      (segment[0][0] + segment[1][0]) / 2,
      (segment[0][1] + segment[1][1]) / 2,
    ];
    labels.push({ kind: 'label', at: mid, text: letter, style: 'highlight' });
  });

  // The motion: each moving input to its image across the new crease.
  for (const which of witness?.who_moves ?? []) {
    const ref = inputs[which];
    if (!ref) continue;
    const anchor = anchorOfRef(sequence, ref);
    if (!anchor) continue;
    const arc = foldArrowArc(anchor, reflect(step.line, anchor), sheet);
    if (arc) primitives.push({ ...arc, kind: 'arc', style: 'arrow' });
  }

  // The crease this step makes, then the letters, both over the references. The
  // crate settled the direction (plan D21) — one per step, never two.
  const direction = step.direction;
  const made = styleOf(direction, true);
  if (step.extent.kind === 'pinches') {
    // The fold runs the width of the sheet either way — the pinch is where it
    // is pressed. Drawing only the spans would say "fold this short line".
    primitives.push({
      kind: 'line',
      from: step.segment[0],
      to: step.segment[1],
      style: 'unfolded',
    });
    // A pinch is a crease, so it carries its own direction rather than a colour
    // of its own.
    const pinch: DiagramLineStyleName =
      direction === 'mountain'
        ? 'pinch-mountain'
        : direction === 'valley'
          ? 'pinch-valley'
          : 'pinch';
    for (const span of step.extent.spans) {
      primitives.push(spanLine(span, pinch));
    }
  } else if (step.cp_spans.length > 0) {
    // The fold crosses the sheet, but the pattern only wants creases where its
    // own segments are — the same thing the canvas draws. Show the rest of the
    // chord faintly, so the picture still says the fold runs the full width.
    primitives.push({
      kind: 'line',
      from: step.segment[0],
      to: step.segment[1],
      style: 'unfolded',
    });
    for (const span of step.cp_spans) {
      primitives.push(spanLine(span, made));
    }
  } else {
    // An auxiliary fold leaves no crease in the pattern, so the whole chord is
    // the instruction. O1 is the exception: "crease through these two marks"
    // means the marks are, so the crease is drawn between them.
    const through = witness?.axiom === 1 ? markSegment(sequence, inputs) : null;
    const segment = through ?? step.segment;
    primitives.push({
      kind: 'line',
      from: segment[0],
      to: segment[1],
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
  after: number | null
): StepDiagramModel {
  const sheet = sequence.sheet;
  const primitives: StepDiagramPrimitive[] = [
    { kind: 'sheet', width: sheet.width, height: sheet.height },
  ];
  for (let i = 0; after !== null && i <= after && i < sequence.steps.length; i += 1) {
    const step = sequence.steps[i];
    if (!step) continue;
    for (const span of creasedSpans(step)) {
      primitives.push(spanLine(span, 'crease'));
    }
  }
  primitives.push(...turnOverSymbol(sheet));
  return { sheet: { width: sheet.width, height: sheet.height }, primitives };
}

/** How wide the turn-over glyph is, as a share of the sheet's shorter side. */
const TURN_OVER_SIZE = 0.42;

/**
 * The turn-over symbol, centred on the sheet.
 *
 * The glyph itself is transcribed from the house's own drawing
 * (`stepDiagramGeometry.ts`, `TURN_OVER_PATH`): a stroke that comes in from one
 * side, loops once, and leaves the other with the arrowhead. Sized against the
 * shorter side so it reads the same on a square and on a long rectangle.
 */
function turnOverSymbol(sheet: { width: number; height: number }): StepDiagramPrimitive[] {
  return [
    {
      kind: 'turn-over',
      at: [sheet.width / 2, sheet.height / 2],
      size: Math.min(sheet.width, sheet.height) * TURN_OVER_SIZE,
    },
  ];
}

/**
 * The finished pattern, each crease in the direction it was made.
 *
 * Which is not, on a mixed line, the direction the pattern ends up assigning
 * every one of its creases — a precrease sequence puts the crease in the right
 * place, and the collapse settles the rest (plan D26).
 */
export function plannerFinishedDiagram(sequence: PrecreaseSequence): StepDiagramModel {
  const sheet = sequence.sheet;
  const primitives: StepDiagramPrimitive[] = [
    { kind: 'sheet', width: sheet.width, height: sheet.height },
  ];
  for (const step of sequence.steps) {
    const style = styleOf(step.direction, true);
    for (const span of creasedSpans(step)) {
      primitives.push(spanLine(span, style));
    }
  }
  return { sheet: { width: sheet.width, height: sheet.height }, primitives };
}
