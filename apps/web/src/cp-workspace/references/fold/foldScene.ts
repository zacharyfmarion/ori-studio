/**
 * A step's fold in the document's own coordinates, ready to be drawn: the
 * fold line, the flap's outline, and where along the line the step presses.
 *
 * `stepFoldMotion` says what moves in whatever frame it is asked in; this is
 * the model frame's caller, plus the two things a renderer needs that the
 * motion does not carry — the flap as a polygon, and the creased stretches as
 * positions along the line rather than as segments.
 */
import type { Point } from '../../../lib/geometry';
import { modelFrame } from '../diagram/diagramFrames';
import { stepFoldMotion, type FoldMotionKind, type FoldSide } from '../diagram/foldMotion';
import type { Point as ModelPoint } from '../../../lib/geometry';
import { clipPolygonToSide, sheetPolygon } from '../diagram/plannerDiagram';
import type { ReferencesPlanVariant } from '../referencesResults';
import type { ReferencesViewStep } from '../referencesSequenceView';

export interface FoldFlapScene {
  /** The fold line across the sheet, model space. */
  chord: readonly [Point, Point];
  side: FoldSide;
  /** The paper that swings: the sheet clipped to that side of the line, convex. */
  polygon: readonly Point[];
  /**
   * Stretches of the line the step presses sharp, as distances along the
   * chord from its first end, each `[from, to]` ascending.
   */
  creased: readonly (readonly [number, number])[];
  /**
   * The whole sheet, turning over about the line rather than a flap swinging
   * from it: paper on both sides of the line moves, and nothing bends.
   */
  whole?: boolean;
}

/** A step's kind, or the card between steps where the paper is turned over. */
export type FoldSceneKind = FoldMotionKind | 'turn-over';

export interface FoldScene {
  kind: FoldSceneKind;
  flaps: readonly FoldFlapScene[];
  /** The sheet's shorter side in model units: what a bend radius is a share of. */
  sheetShortSide: number;
  /** How far any point of a flap is from its own line: the height a swing reaches. */
  reach: number;
}

/**
 * The frame along a chord: its first end, the unit vector along it, and the
 * unit normal pointing into the flap. `sideOf` is the sign of a point's
 * component along `perp(t)`, so the flap's normal is `side · perp(t)`.
 */
export function chordFrame(
  chord: readonly [Point, Point],
  side: FoldSide
): { origin: Point; t: Point; n: Point; length: number } {
  const dx = chord[1].x - chord[0].x;
  const dy = chord[1].y - chord[0].y;
  const length = Math.hypot(dx, dy) || 1;
  const t = { x: dx / length, y: dy / length };
  return { origin: chord[0], t, n: { x: -t.y * side, y: t.x * side }, length };
}

/** A point's coordinates in a chord frame: along the line, and into the flap. */
export function inChordFrame(
  frame: { origin: Point; t: Point; n: Point },
  p: Point
): { s: number; u: number } {
  const dx = p.x - frame.origin.x;
  const dy = p.y - frame.origin.y;
  return { s: dx * frame.t.x + dy * frame.t.y, u: dx * frame.n.x + dy * frame.n.y };
}

/** Back from a chord frame to model space, ignoring height. */
export function fromChordFrame(
  frame: { origin: Point; t: Point; n: Point },
  s: number,
  u: number
): Point {
  return {
    x: frame.origin.x + s * frame.t.x + u * frame.n.x,
    y: frame.origin.y + s * frame.t.y + u * frame.n.y,
  };
}

/**
 * What the active card is, as far as playing goes: a fold, a pleat (a fold
 * step with many lines, not animated), or something with no fold at all.
 */
export function foldCardKind(
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  activeStep: number
): 'fold' | 'pleat' | 'turn-over' | 'other' {
  const target = viewSteps[activeStep];
  if (target?.kind === 'turn-over') return 'turn-over';
  if (!target || target.kind !== 'fold') return 'other';
  const step = variants[target.component]?.sequence.steps[target.step];
  if (!step) return 'other';
  return step.grid ? 'pleat' : 'fold';
}

const midpoint = (segment: readonly [ModelPoint, ModelPoint]): ModelPoint => ({
  x: (segment[0].x + segment[1].x) / 2,
  y: (segment[0].y + segment[1].y) / 2,
});

/**
 * What the reader is looking at moves, or null when nothing does — the
 * finished pattern, a pleat — or there is nothing to draw it on. A fold
 * card swings its flap; a turn-over card turns the whole sheet over, left
 * to right, about its vertical centre line.
 */
export function planFoldScene(
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  activeStep: number
): FoldScene | null {
  const target = viewSteps[activeStep];
  if (!target || target.kind === 'done') return null;
  const variant = variants[target.component];
  if (!variant) return null;
  const frame = modelFrame(variant.sequence, variant.model);
  if (target.kind === 'turn-over') {
    const sheet = sheetPolygon(frame);
    const bottom = frame.edge('bottom');
    const top = frame.edge('top');
    const left = frame.edge('left');
    if (!sheet || !bottom || !top || !left) return null;
    const chord: readonly [ModelPoint, ModelPoint] = [midpoint(bottom), midpoint(top)];
    // "Left to right": the hand takes the sheet's left edge, so the frame
    // puts that edge at positive `u` whichever way the document's axes run.
    const leftward = inChordFrame(chordFrame(chord, 1), midpoint(left)).u;
    const side: FoldSide = leftward >= 0 ? 1 : -1;
    const along = chordFrame(chord, side);
    let reach = 0;
    for (const corner of sheet) reach = Math.max(reach, Math.abs(inChordFrame(along, corner).u));
    return {
      kind: 'turn-over',
      flaps: [{ chord, side, polygon: sheet, creased: [], whole: true }],
      sheetShortSide: Math.min(frame.sheet.width, frame.sheet.height),
      reach,
    };
  }
  const motion = stepFoldMotion(variant.sequence, frame, target.step, target.twin);
  const sheet = sheetPolygon(frame);
  if (!motion || !sheet) return null;
  let reach = 0;
  const flaps = motion.flaps.map((flap): FoldFlapScene => {
    const polygon = clipPolygonToSide(sheet, flap.chord, flap.side);
    const along = chordFrame(flap.chord, flap.side);
    for (const corner of polygon) {
      reach = Math.max(reach, inChordFrame(along, corner).u);
    }
    const creased = flap.creased.map((span): readonly [number, number] => {
      const a = inChordFrame(along, span[0]).s;
      const b = inChordFrame(along, span[1]).s;
      return a <= b ? [a, b] : [b, a];
    });
    return { chord: flap.chord, side: flap.side, polygon, creased };
  });
  return {
    kind: motion.kind,
    flaps,
    sheetShortSide: Math.min(frame.sheet.width, frame.sheet.height),
    reach,
  };
}
