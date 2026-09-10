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
import { inputLetters } from './inputLetters';
import type { Point } from '../../../lib/geometry';
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
  chord: DiagramSegment,
  ref: PrecreaseRef
): [number, number] | null {
  if (ref.kind === 'point' || ref.kind === 'corner') {
    const point = frame.point(ref.id);
    return point ? xy(point) : null;
  }
  const segment = segmentOfRef(sequence, frame, ref);
  // A moving *line* has no single position, so the arrow is drawn from the
  // midpoint of the part of it that moves — the same place upstream's
  // line-to-line arrows sit. Not the whole chord's midpoint: for an edge folded
  // onto the midline that is the very point the fold passes through, which
  // reflects to itself and leaves nothing to draw.
  return segment ? xy(midpoint(movingPortion(frame, chord, segment))) : null;
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

/** Where a segment crosses a line, as a fraction along the segment, or null. */
function crossingParameter(segment: DiagramSegment, chord: DiagramSegment): number | null {
  const [a, b] = segment;
  const [c, d] = chord;
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  return t > 1e-9 && t < 1 - 1e-9 ? t : null;
}

/** Where two segments' lines meet, extended as far as needed; null if parallel. */
function linesMeet(p: DiagramSegment, q: DiagramSegment): Point | null {
  const [a, b] = p;
  const [c, d] = q;
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

const midpoint = (seg: DiagramSegment): Point => lerp(seg[0], seg[1], 0.5);

/**
 * How an O4 is performed, when it can be drawn as a motion at all.
 *
 * The crate says nothing moves — a perpendicular is sighted, not swung — but a
 * folder makes one by folding the line onto itself with the mark as the hinge:
 * the corner at the far end of the line's shorter arm swings over and lands on
 * the other arm. `corner` is that point; `moving` and `receiving` are the
 * fold's two sides. Null when the picture has no such corner to offer.
 */
export function perpendicularMotion(
  sequence: PrecreaseSequence,
  frame: DiagramFrame,
  step: PrecreaseStep,
  witness: { axiom: number; inputs: readonly PrecreaseRef[] }
): { lineAt: number; corner: Point; moving: number; receiving: number } | null {
  const chord = frame.chord(step);
  if (witness.axiom !== 4 || !chord) return null;
  const lineAt = witness.inputs.findIndex((r) => r.kind === 'line' || r.kind === 'edge');
  if (lineAt < 0) return null;
  const ref = witness.inputs[lineAt]!;
  const whole = segmentOfRef(sequence, frame, ref);
  const foot = whole ? linesMeet(whole, chord) : null;
  if (!whole || !foot) return null;
  const reach = (q: Point) => Math.hypot(q.x - foot.x, q.y - foot.y);
  // The shorter arm is the one to swing: less paper to move.
  const end = reach(whole[0]) <= reach(whole[1]) ? whole[0] : whole[1];
  const side = sideOf(chord, end);
  if (side === 0) return null;
  // The corner that moves is the far end of the crease on that arm.
  const runs = spansOfRef(sequence, frame, step, ref).flatMap((span) => {
    const kept = clipToSide(chord, side, span);
    return kept ? [kept] : [];
  });
  const corner = runs
    .flatMap((r) => [...r])
    .reduce<Point | null>((far, q) => (far === null || reach(q) > reach(far) ? q : far), null);
  return corner ? { lineAt, corner, moving: side, receiving: -side } : null;
}

/**
 * The part of a line a fold actually moves.
 *
 * A fold along `chord` swings one side of the paper over; a line crossing the
 * fold has one half on each side, and only the half whose reflection lands on
 * the sheet goes anywhere. The other half stays where it is, and painting it
 * as an input — or anchoring the motion arrow on the whole line's midpoint,
 * which for an edge folded onto the midline sits *on* the fold and reflects
 * to itself, so no arrow is drawn at all — tells the folder to move something
 * that does not move. Where the fold does not cross the segment, all of it
 * moves.
 */
function movingPortion(
  frame: DiagramFrame,
  chord: DiagramSegment,
  segment: DiagramSegment
): DiagramSegment {
  const t = crossingParameter(segment, chord);
  if (t === null) return segment;
  const at = lerp(segment[0], segment[1], t);
  const halves: DiagramSegment[] = [
    [segment[0], at],
    [at, segment[1]],
  ];
  const lands = (half: DiagramSegment) => {
    const m = midpoint(half);
    const r = reflectAcross(chord, [m.x, m.y]);
    return frame.inPaper({ x: r[0], y: r[1] });
  };
  return halves.find(lands) ?? segment;
}

/**
 * What is actually creased along an input line as of `step`: an edge whole, a
 * made line wherever the pattern (or the pinch pass) pressed it, plus every
 * press an earlier step put on it. The chord is the wrong thing to highlight —
 * the folder lines up against the crease that is there — and the making step
 * alone is not enough either: a pinch pressed on the line later is crease too,
 * and is sometimes the only crease the fold lines up against.
 */
function spansOfRef(
  sequence: PrecreaseSequence,
  frame: DiagramFrame,
  step: PrecreaseStep,
  ref: PrecreaseRef
): DiagramSegment[] {
  if (ref.kind === 'edge') {
    const edge = frame.edge(ref.side);
    return edge ? [edge] : [];
  }
  if (ref.kind !== 'line') return [];
  const upTo = sequence.steps.indexOf(step);
  const before = upTo < 0 ? sequence.steps : sequence.steps.slice(0, upTo);
  return mergeRuns(
    before.filter((s) => s.line_id === ref.id).flatMap((s) => creasedSpans(frame, s))
  );
}

/**
 * Collinear spans that touch, merged into the runs a folder actually made.
 *
 * A crease pattern splits a line wherever its assignment changes, so one
 * crease that runs the width of the sheet arrives as several pieces meeting at
 * interior points — and those points are not places the crease stops, they
 * are places it changes colour. The step that made it made it in one go, and
 * everything here is relative to what the folder folded, not to how the file
 * cut it up. The crate's `crease_runs` does the same merge for the same
 * reason.
 */
function mergeRuns(spans: readonly DiagramSegment[]): DiagramSegment[] {
  if (spans.length < 2) return [...spans];
  // Parameterise along the first span's direction; every span is collinear.
  const [a, b] = spans[0]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const scale = Math.hypot(dx, dy) || 1;
  const ux = dx / scale;
  const uy = dy / scale;
  const at = (p: Point) => (p.x - a.x) * ux + (p.y - a.y) * uy;
  const runs = spans
    .map((span): [number, number] => {
      const [u, v] = [at(span[0]), at(span[1])];
      return u <= v ? [u, v] : [v, u];
    })
    .sort((p, q) => p[0] - q[0]);
  const slack = 1e-9 * Math.max(scale, 1);
  const merged: [number, number][] = [];
  for (const [u, v] of runs) {
    const last = merged[merged.length - 1];
    if (last && u <= last[1] + slack) last[1] = Math.max(last[1], v);
    else merged.push([u, v]);
  }
  return merged.map(([u, v]) => [
    { x: a.x + ux * u, y: a.y + uy * u },
    { x: a.x + ux * v, y: a.y + uy * v },
  ]);
}

const length = (seg: DiagramSegment): number =>
  Math.hypot(seg[1].x - seg[0].x, seg[1].y - seg[0].y);

/** Which side of `chord` the point is on: +1, −1, or 0 on the line. */
function sideOf(chord: DiagramSegment, p: Point): number {
  const [a, b] = chord;
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const scale = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.abs(cross) <= 1e-9 * scale ? 0 : Math.sign(cross);
}

/**
 * The part of a segment on one side of `chord`: all of it, none of it, or the
 * piece from the crossing outward. A point on the fold itself belongs to both
 * sides, so an arm that starts at the fold keeps its whole length.
 */
function clipToSide(chord: DiagramSegment, side: number, seg: DiagramSegment): DiagramSegment | null {
  const s0 = sideOf(chord, seg[0]);
  const s1 = sideOf(chord, seg[1]);
  const on = (v: number) => v === 0 || v === side;
  if (on(s0) && on(s1)) return s0 === 0 && s1 === 0 ? null : seg;
  if (!on(s0) && !on(s1)) return null;
  const t = crossingParameter(seg, chord);
  if (t === null) return on(s0) ? seg : null;
  const at = lerp(seg[0], seg[1], t);
  return on(s0) ? [seg[0], at] : [at, seg[1]];
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

  // A press carries the witness of the fold that made its line, so it draws
  // exactly as that fold did — the same references, the same motion — with a
  // pinch for its extent. It is not a different kind of picture.
  const witness = chosenWitness(step);
  const inputs: PrecreaseRef[] = witness?.inputs ?? [];
  const labels: StepDiagramPrimitive[] = [];
  const letters = inputLetters(inputs);
  const chord = frame.chord(step);
  // O3 folds one line onto another, and the fold bisects the angle between
  // them. Only the arms of that angle take part: the moving line's half that
  // swings over, and the receiving line on the side it lands. The other arms
  // stay put and are not inputs to anything. Each arm is shown to the full
  // extent of the crease actually on the paper — not just to where the edge
  // happens to land on it — because that crease is the thing the folder lines
  // up against.
  const moving = new Set(witness?.who_moves ?? []);
  // O4 is a perpendicular to a line through a mark. The crate says nothing
  // moves — the fold is sighted, not swung — but a folder makes one by folding
  // the line onto itself with the mark as the hinge: hold the mark, bring the
  // corner at the end of the line's shorter arm over, and it lands on the
  // other arm. So the picture shows the mark, that corner, and the arm it
  // lands on, with the motion drawn — and nothing else, because that is all
  // a folder needs.
  const perpendicular = witness ? perpendicularMotion(sequence, frame, step, witness) : null;
  const interior = (() => {
    if (perpendicular) return { moving: perpendicular.moving, receiving: perpendicular.receiving };
    if (witness?.axiom !== 3 || !chord) return null;
    const which = witness.inputs.findIndex((_, i) => moving.has(i));
    const source = which >= 0 ? segmentOfRef(sequence, frame, witness.inputs[which]!) : null;
    if (!source) return null;
    // The side of the fold the moving half is on, and the side its image is.
    const swung = midpoint(movingPortion(frame, chord, source));
    const side = sideOf(chord, swung);
    return side === 0 ? null : { moving: side, receiving: -side };
  })();
  const shown = (
    which: number,
    ref: PrecreaseRef,
    spans: readonly DiagramSegment[]
  ): DiagramSegment[] => {
    if (!interior || !chord) return [...spans];
    const side =
      moving.has(which) && !perpendicular ? interior.moving : interior.receiving;
    const arm = spans.flatMap((span) => {
      const kept = clipToSide(chord, side, span);
      return kept ? [kept] : [];
    });
    if (arm.length <= 1) return arm;
    // A line creased in separate pieces: the reference is the one unbroken
    // run that comes out of the angle's vertex, where the fold meets this
    // line. Another piece further along the same line is on the same side
    // and is not what the folder lines up against.
    const whole = segmentOfRef(sequence, frame, ref);
    const vertex = whole ? linesMeet(whole, chord) : null;
    if (!vertex) return arm;
    const gap = (seg: DiagramSegment) =>
      Math.min(...seg.map((q) => Math.hypot(q.x - vertex.x, q.y - vertex.y)));
    return [arm.reduce((a, b) => (gap(b) < gap(a) ? b : a))];
  };
  inputs.forEach((ref, which) => {
    const letter = letters.byInput[which]!;
    if (ref.kind === 'point' || ref.kind === 'corner') {
      const point = frame.point(ref.id);
      if (!point) return;
      primitives.push({ kind: 'point', at: xy(point), style: 'highlight' });
      labels.push({ kind: 'label', at: xy(point), text: letter, style: 'highlight' });
      return;
    }
    const segments = shown(which, ref, spansOfRef(sequence, frame, step, ref));
    if (segments.length === 0) return;
    for (const segment of segments) {
      primitives.push({
        kind: 'line',
        from: xy(segment[0]),
        to: xy(segment[1]),
        style: 'highlight',
      });
    }
    // The letter sits on the longest piece. Ties go to the first, and a tie is
    // judged with slack: two equal pinches must pick the same one in both
    // frames, and model-space rounding would otherwise split them.
    const longest = segments.reduce((a, b) =>
      length(b) > length(a) * (1 + 1e-6) ? b : a
    );
    labels.push({ kind: 'label', at: xy(midpoint(longest)), text: letter, style: 'highlight' });
  });

  // O4: the corner that swings, and its motion onto the other arm.
  if (perpendicular && chord) {
    const { corner } = perpendicular;
    const at = xy(corner);
    primitives.push({ kind: 'point', at, style: 'highlight' });
    labels.push({ kind: 'label', at, text: letters.nextPoint, style: 'highlight' });
    const out = foldArrowArc(at, reflectAcross(chord, at), xy(frame.centre));
    if (out) primitives.push({ kind: 'fold-arrow', out });
  }

  // The motion: each moving input to its image across the new crease.
  for (const which of witness?.who_moves ?? []) {
    const ref = inputs[which];
    if (!ref || !chord) continue;
    const anchor = anchorOfRef(sequence, frame, chord, ref);
    if (!anchor) continue;
    const out = foldArrowArc(anchor, reflectAcross(chord, anchor), xy(frame.centre));
    if (out) primitives.push({ kind: 'fold-arrow', out });
  }

  // The crease this step makes, then the letters, both over the references. The
  // crate settled the direction (plan D21) — one per step, never two.
  // The pattern's direction, read from the front. A card of the paper's
  // back renames every line for that face in one place, `seenFromTheBack`
  // — never here, or a mirrored card renames it twice.
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
