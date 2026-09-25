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
import {
  smallerSideOf,
  stepFoldMotion,
  type FoldMotionKind,
  type FoldSide,
} from '../diagram/foldMotion';
import type { Point as ModelPoint } from '../../../lib/geometry';
import { clipPolygonToSide, sheetPolygon, sideOf } from '../diagram/plannerDiagram';
import type { StepDiagramModel } from '../referenceFinderDiagramToPrimitives';
import { rfSheetOfFrame, rfToModel } from '../referenceFinderStepInModel';
import type { ReferencesCandidateStep } from '../referencesCandidateSteps';
import type {
  ReferencesCandidateResult,
  ReferencesOriginals,
  ReferencesPlanVariant,
} from '../referencesResults';
import type { ReferencesViewStep } from '../referencesSequenceView';
import { cardWays } from '../referencesWays';
import { arcSamplePoints } from '../stepDiagramGeometry';
import type { PrecreaseFrame } from '../sheetFrames';

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

/**
 * A step's kind, the card between steps where the paper is turned over, or
 * a step of a ReferenceFinder construction in the Find tab.
 */
export type FoldSceneKind = FoldMotionKind | 'turn-over' | 'reference';

export interface FoldScene {
  kind: FoldSceneKind;
  /**
   * On a card that offers other ways to fold it (`referencesWays`), whether
   * this is the planner's pick or one the reader chose; absent otherwise.
   */
  way?: 'recommended' | 'alternative';
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

/** One flap of a sheet: the sheet clipped to the swinging side, and what is pressed along the line. */
function flapScene(
  sheet: readonly Point[],
  chord: readonly [Point, Point],
  side: FoldSide,
  creasedSegments: readonly (readonly [Point, Point])[]
): { flap: FoldFlapScene; reach: number } {
  const polygon = clipPolygonToSide(sheet, chord, side);
  const along = chordFrame(chord, side);
  let reach = 0;
  for (const corner of polygon) reach = Math.max(reach, inChordFrame(along, corner).u);
  const creased = creasedSegments.map((span): readonly [number, number] => {
    const a = inChordFrame(along, span[0]).s;
    const b = inChordFrame(along, span[1]).s;
    return a <= b ? [a, b] : [b, a];
  });
  return { flap: { chord, side, polygon, creased }, reach };
}

/** The styles a diagram draws a step's own new crease in: whole, or pressed only at a pinch. */
const NEW_CREASE_STYLES = new Set(['valley', 'mountain', 'pinch', 'pinch-valley', 'pinch-mountain']);

/**
 * A card of the Find tab — one step of a ReferenceFinder construction, or a
 * diagonal the answer leans on — as a fold, or null for a card that makes a
 * mark and no fold.
 *
 * ReferenceFinder's picture is the only description of its step there is,
 * so the fold is read from it: the side that swings is the one its own
 * arrow starts from (the smaller flap when it draws none), and what is
 * pressed is the crease as the diagram draws it, full or as the pinch the
 * core makes when only a mark is wanted. The line itself is the step's chord
 * in model space, already mapped when the answer landed.
 */
export function candidateFoldScene(
  frame: PrecreaseFrame,
  originals: ReferencesOriginals,
  candidate: ReferencesCandidateResult,
  step: ReferencesCandidateStep,
  diagram: StepDiagramModel | null
): FoldScene | null {
  const rf = rfSheetOfFrame(frame);
  const corner = (p: readonly [number, number]): Point => {
    const [x, y] = rfToModel(frame, p);
    return { x, y };
  };
  const sheet: Point[] = [
    corner([0, 0]),
    corner([rf.width, 0]),
    corner([rf.width, rf.height]),
    corner([0, rf.height]),
  ];
  const line =
    step.kind === 'diagonal'
      ? originals.lines[step.diagonal]
      : step.steps.map((index) => candidate.modelSteps[index]?.line).find((l) => l !== undefined);
  if (!line) return null;
  const chord: readonly [Point, Point] = [line.a, line.b];
  const arrow = diagram?.primitives.find((p) => p.kind === 'fold-arrow');
  const start = arrow && arrow.kind === 'fold-arrow' ? arcSamplePoints(arrow.out)[0] : null;
  const fromArrow = start ? sideOf(chord, { x: start[0], y: start[1] }) : 0;
  const side: FoldSide | null =
    fromArrow > 0 ? 1 : fromArrow < 0 ? -1 : smallerSideOf(sheet, chord);
  if (side === null) return null;
  // The new crease as drawn, kept to the pieces on the line itself.
  const onLine = (p: readonly [number, number]) => sideOf(chord, { x: p[0], y: p[1] }) === 0;
  const drawn = (diagram?.primitives ?? []).flatMap((p) =>
    p.kind === 'line' && NEW_CREASE_STYLES.has(p.style) && onLine(p.from) && onLine(p.to)
      ? [[{ x: p.from[0], y: p.from[1] }, { x: p.to[0], y: p.to[1] }] as const]
      : []
  );
  const { flap, reach } = flapScene(sheet, chord, side, drawn.length > 0 ? drawn : [chord]);
  return {
    kind: 'reference',
    flaps: [flap],
    sheetShortSide: Math.min(frame.width, frame.height),
    reach,
  };
}

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
    const scene = flapScene(sheet, flap.chord, flap.side, flap.creased);
    reach = Math.max(reach, scene.reach);
    return scene.flap;
  });
  const ways = cardWays(variant.sequence.steps[target.step]);
  return {
    kind: motion.kind,
    ...(ways ? { way: ways.index > 0 ? ('alternative' as const) : ('recommended' as const) } : {}),
    flaps,
    sheetShortSide: Math.min(frame.sheet.width, frame.sheet.height),
    reach,
  };
}
