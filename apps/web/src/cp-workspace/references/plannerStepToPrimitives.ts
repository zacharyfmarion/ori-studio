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
 * - **The new crease is drawn in the direction it will end up.** The planner
 *   knows the line but not which way it folds; the caller resolves that from the
 *   crease pattern (`referencesFoldDirection.ts`) and hands it in.
 */
import { foldArrowArc } from './stepDiagramGeometry';
import type { PrecreaseFoldDirection } from './referencesFoldDirection';
import type {
  DiagramLineStyleName,
  StepDiagramModel,
  StepDiagramPrimitive,
} from './referenceFinderDiagramToPrimitives';
import {
  chosenWitness,
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
  /**
   * Which way each step's crease folds, parallel to `sequence.steps`. Omit for
   * a sequence whose directions are unknown; every crease is then drawn as a
   * valley, which is what a precrease made from the front actually is.
   */
  directions?: readonly PrecreaseFoldDirection[];
  /** Draw the creases earlier steps made, as context. Default true. */
  showEarlier?: boolean;
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

  // The crease this step makes, then the letters, both over the references.
  // A precrease made from the front is a valley; `directions` says when the
  // pattern wants the other one.
  const direction = options.directions?.[index];
  const made: DiagramLineStyleName = direction === 'mountain' ? 'mountain' : 'valley';
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
    primitives.push({
      kind: 'line',
      from: step.segment[0],
      to: step.segment[1],
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
 */
export function plannerTurnOverDiagram(
  sequence: PrecreaseSequence,
  options: PlannerStepDiagramOptions = {}
): StepDiagramModel {
  const sheet = sequence.sheet;
  const primitives: StepDiagramPrimitive[] = [
    { kind: 'sheet', width: sheet.width, height: sheet.height },
  ];
  for (const step of sequence.steps) {
    const spans = step.extent.kind === 'pinches' ? step.extent.spans : [step.segment];
    for (const span of spans) {
      primitives.push({ kind: 'line', from: span[0], to: span[1], style: 'crease' });
    }
  }
  void options;
  const mid = sheet.height / 2;
  const arc = foldArrowArc([0, mid], [sheet.width, mid], sheet);
  if (arc) primitives.push({ ...arc, kind: 'arc', style: 'arrow' });
  return { sheet: { width: sheet.width, height: sheet.height }, primitives };
}

/**
 * The reverse card: the sheet from the back, with the creases to turn over
 * picked out.
 *
 * `lineIds` are the editor's, so the geometry comes from the steps that made
 * them rather than from the document — the diagram works in the planner's unit
 * frame and the document does not.
 */
export function plannerReverseDiagram(
  sequence: PrecreaseSequence,
  reversedStepIndices: ReadonlySet<number>
): StepDiagramModel {
  const sheet = sequence.sheet;
  const primitives: StepDiagramPrimitive[] = [
    { kind: 'sheet', width: sheet.width, height: sheet.height },
  ];
  sequence.steps.forEach((step, index) => {
    const spans = step.extent.kind === 'pinches' ? step.extent.spans : [step.segment];
    // From the back, a crease the front wants as a mountain is a valley.
    const style: DiagramLineStyleName = reversedStepIndices.has(index) ? 'valley' : 'crease';
    for (const span of spans) {
      primitives.push({ kind: 'line', from: span[0], to: span[1], style });
    }
  });
  return { sheet: { width: sheet.width, height: sheet.height }, primitives };
}

/** The finished pattern, in the directions it ends up with. */
export function plannerFinishedDiagram(
  sequence: PrecreaseSequence,
  directions: readonly PrecreaseFoldDirection[]
): StepDiagramModel {
  const sheet = sequence.sheet;
  const primitives: StepDiagramPrimitive[] = [
    { kind: 'sheet', width: sheet.width, height: sheet.height },
  ];
  sequence.steps.forEach((step, index) => {
    const spans = step.extent.kind === 'pinches' ? step.extent.spans : [step.segment];
    const direction = directions[index];
    const style: DiagramLineStyleName =
      direction === 'mountain' ? 'mountain' : direction === 'valley' ? 'valley' : 'crease';
    for (const span of spans) {
      primitives.push({ kind: 'line', from: span[0], to: span[1], style });
    }
  });
  return { sheet: { width: sheet.width, height: sheet.height }, primitives };
}
