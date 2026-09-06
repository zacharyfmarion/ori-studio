/**
 * A planner step as the primitives `StepDiagram` draws — the breakdown's
 * thumbnails, in the same picture language as ReferenceFinder's own.
 *
 * ReferenceFinder ships a diagram per step and
 * `referenceFinderDiagramToPrimitives.ts` only translates the style codes. The
 * planner ships *witnesses* instead, so the picture is synthesised here from
 * the typed references: the sheet, the lines and marks the fold is made
 * against, and the crease it produces — drawn as short spans when the pinch
 * pass reduced it to marks, which is the one thing a thumbnail must get right
 * because a pinch and a full crease are different instructions.
 *
 * Coordinates stay in the planner's unit frame, y up, exactly as the RF
 * adapter's are, so one projector (`stepDiagramGeometry.ts`) serves both.
 */
import type { StepDiagramModel, StepDiagramPrimitive } from './referenceFinderDiagramToPrimitives';
import {
  chosenWitness,
  type PrecreaseEdgeSide,
  type PrecreasePlanSegment,
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

/**
 * The thumbnail for `sequence.steps[index]`.
 *
 * Only the step's own inputs are drawn, never the whole folded state: at
 * 100 × 100 the sheet plus three or four references is already the limit of
 * what reads, and the CP view beside it is the full picture (plan: "the CP
 * view itself is the diagram"). Null when the index names no step.
 */
export function plannerStepDiagram(
  sequence: PrecreaseSequence,
  index: number
): StepDiagramModel | null {
  const step = sequence.steps[index];
  if (!step) return null;
  const sheet = sequence.sheet;
  const primitives: StepDiagramPrimitive[] = [
    { kind: 'sheet', width: sheet.width, height: sheet.height },
  ];

  const witness = chosenWitness(step);
  for (const ref of witness?.inputs ?? []) {
    switch (ref.kind) {
      case 'edge': {
        const [from, to] = edgeSegment(sheet, ref.side);
        primitives.push({ kind: 'line', from, to, style: 'highlight' });
        break;
      }
      case 'line': {
        const source = stepForLine(sequence, ref.id);
        if (!source) break;
        primitives.push({
          kind: 'line',
          from: source.segment[0],
          to: source.segment[1],
          style: 'highlight',
        });
        break;
      }
      case 'corner':
      case 'point': {
        const point = sequence.points.find((entry) => entry.id === ref.id);
        if (!point) break;
        primitives.push({ kind: 'point', at: point.p, style: 'highlight' });
        break;
      }
    }
  }

  // The crease this step makes, last so it draws over its references.
  if (step.extent.kind === 'pinches') {
    for (const span of step.extent.spans) {
      primitives.push({ kind: 'line', from: span[0], to: span[1], style: 'pinch' });
    }
  } else {
    primitives.push({
      kind: 'line',
      from: step.segment[0],
      to: step.segment[1],
      style: 'valley',
    });
  }

  return { sheet: { width: sheet.width, height: sheet.height }, primitives };
}

/**
 * The thumbnail for a whole group row: its first step's picture, with every
 * other member of the group drawn faintly so a row that stands for seven
 * parallel creases looks like seven parallel creases.
 */
export function plannerGroupDiagram(
  sequence: PrecreaseSequence,
  stepIds: readonly number[]
): StepDiagramModel | null {
  if (stepIds.length === 0) return null;
  const first = sequence.steps.findIndex((step) => step.id === stepIds[0]);
  const base = plannerStepDiagram(sequence, first);
  if (!base || stepIds.length === 1) return base;
  const rest = stepIds.slice(1);
  const extra: StepDiagramPrimitive[] = [];
  for (const id of rest) {
    const step = sequence.steps.find((entry) => entry.id === id);
    if (!step) continue;
    extra.push({
      kind: 'line',
      from: step.segment[0],
      to: step.segment[1],
      style: 'crease',
    });
  }
  return { sheet: base.sheet, primitives: [...base.primitives, ...extra] };
}
