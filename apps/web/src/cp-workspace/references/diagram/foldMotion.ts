/**
 * What a step moves: the fold line, which side of it swings, and where the
 * paper is pressed along it.
 *
 * The card's arrow already decides which side of the fold is the flap — the
 * moving input's side, the arm that lands on crease for a bisection, the
 * shorter arm for a perpendicular — in `plannerDiagram.ts`. An animation of
 * the same step has to swing the same flap, so this reads that decision
 * rather than making one of its own, and `foldMotion.test.ts` pins that the
 * side the arrow starts from and the side that swings are one value.
 *
 * Where the card draws no arrow — O1, whose crease is sighted through two
 * marks and brings nothing onto anything, and a press, which refolds a line
 * that is already there — a folder still picks something up: the smaller
 * flap. A pleat is not one fold, so a grid step has no motion at all.
 */
import type { Point } from '../../../lib/geometry';
import type { DiagramFrame, DiagramSegment } from './diagramFrames';
import {
  anchorOfRef,
  clipPolygonToSide,
  creasedSpans,
  flapArea,
  landingPairs,
  movingInputs,
  movingSide,
  perpendicularMotion,
  polygonArea,
  reflectAcross,
  segmentOfRef,
  sheetPolygon,
  sideOf,
  spansOfRef,
} from './plannerDiagram';
import {
  chosenWitness,
  type PrecreaseSequence,
  type PrecreaseStep,
  type PrecreaseWitness,
} from '../precreaseSequence';

/** Which side of the chord swings: the sign `sideOf` gives a point there. */
export type FoldSide = 1 | -1;

export interface FoldFlap {
  /** The fold line across the sheet, in the frame's coordinates. */
  chord: DiagramSegment;
  side: FoldSide;
  /**
   * What the step presses along the line — the stretches that go sharp once
   * the flap is down. The pattern's pieces joined and carried to references,
   * a pinch's worth at each mark, or the whole chord of an auxiliary fold
   * pressed in full (`creasedSpans`) — and a pinch's worth centred on every
   * mark the fold passes through, since a fold "through P" is registered on
   * P by pressing there (markhor 68, Zach 2026-09-16).
   */
  creased: readonly DiagramSegment[];
}

/**
 * How much of the line is pressed around a mark the fold passes through, as
 * a share of the sheet's short side: a pinch, the crate's own measure.
 */
export const MARK_PRESS_SHARE = 0.06;

/** A pinch's worth of the chord centred on each input mark that lies on it. */
export function pressesAtMarks(
  frame: DiagramFrame,
  chord: DiagramSegment,
  witnesses: readonly (PrecreaseWitness | null | undefined)[]
): DiagramSegment[] {
  const dx = chord[1].x - chord[0].x;
  const dy = chord[1].y - chord[0].y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [];
  const t = { x: dx / length, y: dy / length };
  const half = (MARK_PRESS_SHARE * Math.min(frame.sheet.width, frame.sheet.height)) / 2;
  const along = (p: Point): number => (p.x - chord[0].x) * t.x + (p.y - chord[0].y) * t.y;
  const at = (distance: number): Point => ({
    x: chord[0].x + t.x * distance,
    y: chord[0].y + t.y * distance,
  });
  const out: DiagramSegment[] = [];
  const seen = new Set<number>();
  for (const witness of witnesses) {
    for (const ref of witness?.inputs ?? []) {
      if (ref.kind !== 'point' && ref.kind !== 'corner') continue;
      const mark = frame.point(ref.id);
      if (!mark || sideOf(chord, mark) !== 0 || seen.has(ref.id)) continue;
      seen.add(ref.id);
      const centre = along(mark);
      const from = Math.max(0, centre - half);
      const to = Math.min(length, centre + half);
      if (to > from) out.push([at(from), at(to)]);
    }
  }
  return out;
}

export type FoldMotionKind = 'cp' | 'aux' | 'press';

export interface FoldMotion {
  kind: FoldMotionKind;
  /** One flap, or two for a twin pair, in the order the card names them. */
  flaps: readonly FoldFlap[];
}

/**
 * The side the card's arrow starts from, or null when the card draws none.
 *
 * The same reading of the witness the arrow makes, case for case: a
 * perpendicular swings the shorter arm's corner; a bisection swings the side
 * `movingSide` picks; otherwise the first of the picture's movers
 * (`movingInputs`: the crate's, unless they sit on the larger flap) — from
 * the place on it that a mark lands when it carries one, else from where
 * the input sits.
 */
function arrowSide(
  sequence: PrecreaseSequence,
  frame: DiagramFrame,
  step: PrecreaseStep,
  chord: DiagramSegment,
  witness: PrecreaseWitness
): FoldSide | null {
  const sign = (side: number): FoldSide | null => (side > 0 ? 1 : side < 0 ? -1 : null);
  if (witness.axiom === 4) {
    const motion = perpendicularMotion(sequence, frame, step, witness);
    return motion ? sign(motion.moving) : null;
  }
  const moving = movingInputs(sequence, frame, step, witness);
  if (moving.length === 0) return null;
  const runsOf = (index: number) => {
    const ref = witness.inputs[index];
    return ref ? spansOfRef(sequence, frame, step, ref) : [];
  };
  if (witness.axiom === 3) {
    const which = witness.inputs.findIndex((_, i) => moving.includes(i));
    const other = witness.inputs.findIndex((_, i) => i !== which);
    const ref = which >= 0 ? witness.inputs[which] : undefined;
    const source = ref ? segmentOfRef(sequence, frame, ref) : null;
    if (!source || other < 0) return null;
    return sign(movingSide(frame, chord, source, runsOf(which), runsOf(other)));
  }
  const landings = landingPairs(witness);
  for (const which of moving) {
    const ref = witness.inputs[which];
    if (!ref) continue;
    const carried = landings.get(which);
    const mark = carried === undefined ? undefined : witness.inputs[carried];
    const at = mark && (mark.kind === 'point' || mark.kind === 'corner') ? frame.point(mark.id) : null;
    const start = at
      ? reflectAcross(chord, [at.x, at.y])
      : anchorOfRef(sequence, frame, chord, ref);
    if (!start) continue;
    const side = sign(sideOf(chord, { x: start[0], y: start[1] }));
    if (side) return side;
  }
  return null;
}

/**
 * The smaller flap, which is what a folder picks up when the step says
 * nothing about it. Equal halves — a fold through the sheet's middle — go
 * to the side holding the first sheet corner off the line, so both frames
 * name the same physical side rather than the same sign.
 */
function smallerFlap(frame: DiagramFrame, chord: DiagramSegment): FoldSide | null {
  const sheet = sheetPolygon(frame);
  if (!sheet) return null;
  const whole = polygonArea(sheet);
  if (whole <= 0) return null;
  const left = flapArea(frame, chord, 1);
  const right = flapArea(frame, chord, -1);
  if (Math.abs(left - right) > 1e-9 * whole) return left < right ? 1 : -1;
  for (const corner of sheet) {
    const side = sideOf(chord, corner);
    if (side !== 0) return side > 0 ? 1 : -1;
  }
  return null;
}

function flapOf(sequence: PrecreaseSequence, frame: DiagramFrame, step: PrecreaseStep): FoldFlap | null {
  if (step.grid) return null;
  const chord = frame.chord(step);
  if (!chord) return null;
  const witness = chosenWitness(step);
  const side =
    (witness ? arrowSide(sequence, frame, step, chord, witness) : null) ??
    smallerFlap(frame, chord);
  if (side === null) return null;
  return {
    chord,
    side,
    creased: [...creasedSpans(frame, step), ...pressesAtMarks(frame, chord, [witness, step.also])],
  };
}

/** A point inside the flap, for a test or a caller that needs one. */
export function flapCentroid(frame: DiagramFrame, flap: FoldFlap): Point | null {
  const sheet = sheetPolygon(frame);
  if (!sheet) return null;
  const polygon = clipPolygonToSide(sheet, flap.chord, flap.side);
  if (polygon.length === 0) return null;
  return {
    x: polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length,
    y: polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length,
  };
}

/**
 * What `sequence.steps[index]` moves, in the frame's coordinates — with its
 * twin's flap after it when the card shows the pair. The two are played one
 * after the other, so they may overlap. Null for a grid step, and for an
 * index that names no step.
 */
export function stepFoldMotion(
  sequence: PrecreaseSequence,
  frame: DiagramFrame,
  index: number,
  twin?: number
): FoldMotion | null {
  const step = sequence.steps[index];
  if (!step || step.grid) return null;
  const flap = flapOf(sequence, frame, step);
  if (!flap) return null;
  const flaps: FoldFlap[] = [flap];
  const twinStep = twin === undefined ? undefined : sequence.steps[twin];
  const second = twinStep ? flapOf(sequence, frame, twinStep) : null;
  if (second) flaps.push(second);
  const kind: FoldMotionKind =
    step.kind === 'press' ? 'press' : step.kind === 'aux' ? 'aux' : 'cp';
  return { kind, flaps };
}
