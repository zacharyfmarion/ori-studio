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
}

export interface FoldScene {
  kind: FoldMotionKind;
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
): 'fold' | 'pleat' | 'other' {
  const target = viewSteps[activeStep];
  if (!target || target.kind !== 'fold') return 'other';
  const step = variants[target.component]?.sequence.steps[target.step];
  if (!step) return 'other';
  return step.grid ? 'pleat' : 'fold';
}

/**
 * The fold the reader is looking at, or null when the card is not a fold —
 * a turn-over, the finished pattern, a pleat — or there is nothing to draw
 * it on.
 */
export function planFoldScene(
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  activeStep: number
): FoldScene | null {
  const target = viewSteps[activeStep];
  if (!target || target.kind !== 'fold') return null;
  const variant = variants[target.component];
  if (!variant) return null;
  const frame = modelFrame(variant.sequence, variant.model);
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
