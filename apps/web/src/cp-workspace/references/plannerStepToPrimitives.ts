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
import { foldArrowArc } from './stepDiagramGeometry';
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
      const spans =
        earlier.extent.kind === 'pinches' ? earlier.extent.spans : [earlier.segment];
      for (const span of spans) {
        primitives.push({ kind: 'line', from: span[0], to: span[1], style: 'crease' });
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
      primitives.push({ kind: 'line', from: span[0], to: span[1], style: pinch });
    }
  } else {
    // O1 is "crease through these two marks": the marks are the instruction, so
    // the crease is drawn between them rather than across the whole sheet.
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
 * The turn-over card: the sheet as it stands, with the arrow that says to flip
 * it.
 *
 * Standard diagramming draws the turn-over as a hooked arrow passing around the
 * paper's edge. Here it is one arc across the sheet with a head at each end,
 * which is the same gesture and survives being 128px wide.
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
    const spans = step.extent.kind === 'pinches' ? step.extent.spans : [step.segment];
    for (const span of spans) {
      primitives.push({ kind: 'line', from: span[0], to: span[1], style: 'crease' });
    }
  }
  const mid = sheet.height / 2;
  const arc = foldArrowArc([0, mid], [sheet.width, mid], sheet);
  if (arc) primitives.push({ ...arc, kind: 'arc', style: 'arrow' });
  return { sheet: { width: sheet.width, height: sheet.height }, primitives };
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
    const spans = step.extent.kind === 'pinches' ? step.extent.spans : [step.segment];
    const style = styleOf(step.direction, true);
    for (const span of spans) {
      primitives.push({ kind: 'line', from: span[0], to: span[1], style });
    }
  }
  return { sheet: { width: sheet.width, height: sheet.height }, primitives };
}
