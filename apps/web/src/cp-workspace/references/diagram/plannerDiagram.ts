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
 *
 * A **grid** step is a pleat, not a sighting: every line of one family, edge
 * to edge, mountain and valley alternating. It draws the whole family in the
 * directions the pleat gives it and nothing else — no references, no motion,
 * no letters — because that is what a folder does with "pleat into 16ths",
 * and the card of one line with an arrow on it would be the wrong instruction.
 */
import { dashRulerAlong, foldArrowArc, type DiagramSheet } from '../stepDiagramGeometry';
import { inputLetters } from './inputLetters';
import type { Point } from '../../../lib/geometry';
import type { DiagramFrame, DiagramGridLine, DiagramSegment } from './diagramFrames';
import type {
  DiagramLineStyleName,
  StepDiagramModel,
  StepDiagramPrimitive,
} from '../referenceFinderDiagramToPrimitives';
import {
  chosenWitness,
  type PrecreaseDirection,
  type PrecreaseGridBound,
  type PrecreaseRef,
  type PrecreaseSequence,
  type PrecreaseStep,
  type PrecreaseWitness,
} from '../precreaseSequence';

/** A frame segment as the primitives' own tuples. */
const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y];

/**
 * The line of a grid step that a state line id names, or null when the family
 * does not hold it.
 *
 * A grid step's own `line_id` and chord are only its family's first line; the
 * rest are in `grid.lines`. A later step sighted from any of them has to find
 * the line it means, not the family's first.
 */
function gridLineOf(
  frame: DiagramFrame,
  step: PrecreaseStep,
  lineId: number
): DiagramGridLine | null {
  const index = step.grid?.lines.findIndex((line) => line.line_id === lineId) ?? -1;
  return index >= 0 ? (frame.gridLines(step)[index] ?? null) : null;
}

/** Whether two segments run the same way, by the sign of their dot product. */
function sameWay(a: DiagramSegment, b: DiagramSegment): boolean {
  return (a[1].x - a[0].x) * (b[1].x - b[0].x) + (a[1].y - a[0].y) * (b[1].y - b[0].y) >= 0;
}

/**
 * Where a band's bound is on the paper: the bounding line, drawn by the grid
 * step that made it; the sheet's edge; or, for an odd base's band, which no
 * line bounds, the position a step further on from the band's outermost
 * line — the same stride again, which the frame map keeps straight.
 */
function gridBoundSegment(
  sequence: PrecreaseSequence,
  frame: DiagramFrame,
  step: PrecreaseStep,
  bound: PrecreaseGridBound
): DiagramSegment | null {
  const grid = step.grid;
  if (!grid) return null;
  if (bound.edge !== null) return frame.edge(bound.edge);
  if (bound.line_id !== null) {
    for (const earlier of sequence.steps) {
      if (earlier.id >= step.id) break;
      if (!earlier.grid) continue;
      const line = gridLineOf(frame, earlier, bound.line_id);
      if (line) return line.segment;
    }
    return null;
  }
  const lines = frame.gridLines(step);
  const index = grid.lines.findIndex((line) => line.index > bound.index);
  // The band's outermost line and its neighbour, extrapolated one stride
  // outward; `index` is the first line past a low bound, and the last line
  // before a high one is where the search stops.
  const [near, next] =
    index === 0
      ? [lines[0]?.segment, lines[1]?.segment]
      : [lines[grid.lines.length - 1]?.segment, lines[grid.lines.length - 2]?.segment];
  if (!near || !next) return null;
  const stride = (k: 0 | 1) => ({
    x: near[k].x - (next[k].x - near[k].x),
    y: near[k].y - (next[k].y - near[k].y),
  });
  return [stride(0), stride(1)];
}

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
  if (!step) return null;
  return step.grid ? (gridLineOf(frame, step, ref.id)?.segment ?? null) : frame.chord(step);
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
    before.flatMap((s) => {
      // A grid step creases each line of its family as far as its spans say
      // — a pleat's edge to edge — so the crease along a grid line is that,
      // and only that line, not the family the step made it with.
      if (s.grid) {
        const line = gridLineOf(frame, s, ref.id);
        return line ? [...line.spans] : [];
      }
      return s.line_id === ref.id ? creasedSpans(frame, s) : [];
    })
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

/** A segment's image across the fold. */
function reflectSegment(chord: DiagramSegment, seg: DiagramSegment): DiagramSegment {
  const [a, b] = [reflectAcross(chord, [seg[0].x, seg[0].y]), reflectAcross(chord, [seg[1].x, seg[1].y])];
  return [
    { x: a[0], y: a[1] },
    { x: b[0], y: b[1] },
  ];
}

/**
 * How far `b` lies along `a`, when the two are pieces of one line: the length
 * of their common stretch, and zero when `b` is not on `a`'s line at all.
 */
function overlapAlong(a: DiagramSegment, b: DiagramSegment): number {
  const len = length(a);
  if (len === 0) return 0;
  const ux = (a[1].x - a[0].x) / len;
  const uy = (a[1].y - a[0].y) / len;
  const off = (p: Point) => Math.abs((p.x - a[0].x) * -uy + (p.y - a[0].y) * ux);
  if (off(b[0]) > 1e-6 * len || off(b[1]) > 1e-6 * len) return 0;
  const at = (p: Point) => (p.x - a[0].x) * ux + (p.y - a[0].y) * uy;
  const [u, v] = [at(b[0]), at(b[1])].sort((p, q) => p - q);
  return Math.max(0, Math.min(len, v) - Math.max(0, u));
}

/**
 * The most any of `runs`, carried across the fold, lies along any of `onto`:
 * the alignment the fold gives the folder between these two lines, measured
 * the way the crate's `crease_overlap` measures it.
 */
function alignment(
  chord: DiagramSegment,
  runs: readonly DiagramSegment[],
  onto: readonly DiagramSegment[]
): number {
  let best = 0;
  for (const run of runs) {
    const image = reflectSegment(chord, run);
    for (const target of onto) best = Math.max(best, overlapAlong(target, image));
  }
  return best;
}

/**
 * How much paper lies on `side` of the fold: the sheet clipped to that
 * half-plane. A folder swings the smaller flap.
 */
function flapArea(frame: DiagramFrame, chord: DiagramSegment, side: number): number {
  const bottom = frame.edge('bottom');
  const top = frame.edge('top');
  if (!bottom || !top) return 0;
  let polygon: Point[] = [bottom[0], bottom[1], top[1], top[0]];
  const clipped: Point[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    const inP = sideOf(chord, p) !== -side;
    const inQ = sideOf(chord, q) !== -side;
    if (inP) clipped.push(p);
    if (inP !== inQ) {
      const t = crossingParameter([p, q], chord);
      if (t !== null) clipped.push(lerp(p, q, t));
    }
  }
  polygon = clipped;
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) / 2;
}

/** The pieces of `runs` on `side` of the fold. */
function onSide(
  chord: DiagramSegment,
  side: number,
  runs: readonly DiagramSegment[]
): DiagramSegment[] {
  return runs.flatMap((run) => {
    const kept = clipToSide(chord, side, run);
    return kept ? [kept] : [];
  });
}

/**
 * The stretch of `piece` that, carried across the fold, lies along one of
 * `onto` — the longest such, or null when none of it does.
 */
function landingStretch(
  chord: DiagramSegment,
  piece: DiagramSegment,
  onto: readonly DiagramSegment[]
): DiagramSegment | null {
  const image = reflectSegment(chord, piece);
  const len = length(image);
  if (len === 0) return null;
  const ux = (image[1].x - image[0].x) / len;
  const uy = (image[1].y - image[0].y) / len;
  const off = (p: Point) => Math.abs((p.x - image[0].x) * -uy + (p.y - image[0].y) * ux);
  const at = (p: Point) => (p.x - image[0].x) * ux + (p.y - image[0].y) * uy;
  let best: [number, number] | null = null;
  for (const run of onto) {
    if (off(run[0]) > 1e-6 * len || off(run[1]) > 1e-6 * len) continue;
    const [u, v] = [at(run[0]), at(run[1])].sort((p, q) => p - q);
    const lo = Math.max(0, u);
    const hi = Math.min(len, v);
    if (hi > lo && (!best || hi - lo > best[1] - best[0])) best = [lo, hi];
  }
  if (!best) return null;
  // Back on the moving line: the image's parameter is the piece's own.
  return [lerp(piece[0], piece[1], best[0] / len), lerp(piece[0], piece[1], best[1] / len)];
}

/**
 * Which side of the fold moves when a line is folded onto a line.
 *
 * A fold along `chord` swings one side of the paper over, and the moving
 * line's arm on that side lands on the other line's arm across the fold. The
 * reflection carries the whole line, so either side is a fold that works —
 * what decides it is what the folder has to line up: the side whose arm,
 * carried across, lands on crease the other line actually has (the crate's
 * alignment; a pinch's worth of it, at least), and of those the side with
 * less paper on it, which is the flap a folder picks up. When no side lands
 * on crease, the smaller flap whose arm lands on the paper at all; and when
 * the moving line does not cross the fold, the side it is on.
 */
function movingSide(
  frame: DiagramFrame,
  chord: DiagramSegment,
  source: DiagramSegment,
  movingRuns: readonly DiagramSegment[],
  receivingRuns: readonly DiagramSegment[]
): number {
  const t = crossingParameter(source, chord);
  const halves: DiagramSegment[] =
    t === null
      ? [source]
      : [
          [source[0], lerp(source[0], source[1], t)],
          [lerp(source[0], source[1], t), source[1]],
        ];
  const sides = [...new Set(halves.map((half) => sideOf(chord, midpoint(half))))].filter(
    (side) => side !== 0
  );
  if (sides.length === 0) return 0;
  const lands = (side: number) =>
    halves.some((half) => {
      if (sideOf(chord, midpoint(half)) !== side) return false;
      const r = reflectAcross(chord, [midpoint(half).x, midpoint(half).y]);
      return frame.inPaper({ x: r[0], y: r[1] });
    });
  const pinch = ALIGNMENT_FLOOR * Math.max(frame.sheet.width, frame.sheet.height);
  const aligned = (side: number) =>
    alignment(chord, onSide(chord, side, movingRuns), onSide(chord, -side, receivingRuns)) >= pinch;
  // An arm that lands on crease lands on the paper there, whatever its
  // midpoint does: a long arm swung over a small flap has most of its length
  // off the sheet and the stretch that matters on it.
  const usable = sides.filter(aligned);
  const landing = sides.filter(lands);
  const pool = usable.length ? usable : landing.length ? landing : sides;
  return pool.reduce((best, side) =>
    flapArea(frame, chord, side) < flapArea(frame, chord, best) ? side : best
  );
}

/**
 * The least alignment worth folding onto, as a share of the sheet: a pinch's
 * length, the crate's `MIN_ALIGNMENT`.
 */
const ALIGNMENT_FLOOR = 0.06;

/**
 * Which line inputs a point input lands on, by input index: the crate's O5
 * is `[pivot, p, m1]`, O6 `[p1, m1, p2, m2]`, O7 `[p, m1, m2]`.
 */
function landingPairs(witness: PrecreaseWitness | null): Map<number, number> {
  switch (witness?.axiom) {
    case 5:
      return new Map([[2, 1]]);
    case 6:
      return new Map([
        [1, 0],
        [3, 2],
      ]);
    case 7:
      return new Map([[1, 0]]);
    default:
      return new Map();
  }
}

/** How far `p` is from the segment `[a, b]`. */
function distanceToSegment([a, b]: DiagramSegment, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

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
  // No crossing inside the segment, yet one end is off the side asked for:
  // the segment starts on the fold and runs away from that side, whole. It
  // used to be kept here, and a crease beginning at the fold was then shown
  // as the arm on *both* sides of it.
  if (t === null) return null;
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
 * What a step actually left on the paper: the crease a CP step made — the
 * pattern's pieces joined and carried to references, or the pieces
 * themselves when the plan did not reach — the spans it pinched, or, for an
 * auxiliary fold pressed in full, its whole chord. For a grid step, every
 * line of its family, edge to edge.
 *
 * Never the whole chord of a CP step. The parts of a fold the step does not
 * crease are not on the paper, and drawing them is the difference between a
 * diagram and a picture of a line.
 */
function creasedSpans(
  frame: DiagramFrame,
  step: PrecreaseStep,
  patterned = true
): readonly DiagramSegment[] {
  // `patterned` false means something else is already drawing exactly the
  // pattern's creases, out of the crease pattern itself — so of a pleated
  // family what is left to draw is the lines the pattern lacks, and of the
  // lines it has, the stretches it does not crease: the pleat runs edge to
  // edge whatever the pattern wants of it. Of a CP step's own line, the
  // same: the stretches it creased that the pattern does not hold.
  if (step.grid) {
    return frame.gridLines(step).flatMap((line) => {
      if (patterned) return line.spans;
      return line.inPattern
        ? line.spans.flatMap((span) => uncreased(span, line.creases))
        : line.spans;
    });
  }
  // Crease pressed on past the pattern's own is not in the pattern, so it is
  // drawn either way — as are the pinch and chord cases, by definition.
  const pressedOn = frame.pressedOn(step);
  const creases = frame.creases(step);
  if (creases.length > 0) {
    const made = frame.made(step);
    return patterned
      ? [...made, ...pressedOn]
      : [...made.flatMap((span) => uncreased(span, creases)), ...pressedOn];
  }
  const pinches = frame.pinches(step);
  if (pinches.length > 0) return [...pinches, ...pressedOn];
  const chord = frame.chord(step);
  return chord ? [chord, ...pressedOn] : pressedOn;
}

/**
 * The parts of `segment` that `creases` do not cover, as segments.
 *
 * Along the segment as a parameter: the creases become intervals, merged, and
 * the gaps between them from one end to the other are what is left. A gap
 * shorter than a hair is rounding, not crease.
 */
function uncreased(
  segment: DiagramSegment,
  creases: readonly DiagramSegment[]
): DiagramSegment[] {
  const [a, b] = segment;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  if (span === 0) return [];
  const at = (p: Point) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / span;
  const covered = creases
    .map(([p, q]) => [at(p), at(q)].sort((u, v) => u - v) as [number, number])
    .sort((u, v) => u[0] - v[0]);
  const gaps: DiagramSegment[] = [];
  let cursor = 0;
  const point = (t: number): Point => ({ x: a.x + dx * t, y: a.y + dy * t });
  for (const [start, end] of covered) {
    if (start > cursor + UNCREASED_EPSILON) gaps.push([point(cursor), point(start)]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < 1 - UNCREASED_EPSILON) gaps.push([point(cursor), point(1)]);
  return gaps;
}

/** A gap along a chord shorter than this fraction of it is rounding. */
const UNCREASED_EPSILON = 1e-6;

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

  // A band step works in a stretch of the paper: each band as a wash under
  // everything but the paper itself, so "between the ¼ and ¾ lines" is a
  // place on the card before it is a sentence.
  const bands = step.grid && !step.grid.pleat ? step.grid.regions : [];
  const bandBounds = bands.map((region) =>
    region.bounds.map((bound) => gridBoundSegment(sequence, frame, step, bound))
  );
  bands.forEach((region, b) => {
    const [lo, hi] = bandBounds[b] ?? [];
    if (!lo || !hi) return;
    // A band creased part way along its lines is that much of the paper:
    // the bounds cut to the extent, which the frame map keeps as a share of
    // the chord — the bounds run the way the step's own lines do.
    const cut = (segment: DiagramSegment): DiagramSegment => {
      const [r0, r1] = region.extent ?? [0, 1];
      const at = (r: number): Point => ({
        x: segment[0].x + (segment[1].x - segment[0].x) * r,
        y: segment[0].y + (segment[1].y - segment[0].y) * r,
      });
      return [at(r0), at(r1)];
    };
    const own = frame.gridLines(step)[0]?.segment;
    const aligned = (segment: DiagramSegment): DiagramSegment =>
      own && sameWay(segment, own) ? segment : [segment[1], segment[0]];
    const a = cut(aligned(lo));
    const z = cut(aligned(hi));
    primitives.push({ kind: 'region', corners: [xy(a[0]), xy(a[1]), xy(z[1]), xy(z[0])] });
  });

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

  // A pleat: the whole family, each line full-length in the direction the
  // pleat gives it, read from the front like every other direction here.
  // Nothing is brought onto anything and nothing is named, so no arrow and
  // no letters. A band step is the same picture inside its bands, with the
  // lines each band is sighted from picked out.
  if (step.grid) {
    bands.forEach((region, b) => {
      region.bounds.forEach((bound, k) => {
        const segment = bandBounds[b]?.[k];
        if (segment && !bound.edge && bound.line_id !== null) {
          primitives.push(spanLine(segment, 'highlight'));
        }
      });
    });
    for (const line of frame.gridLines(step)) {
      for (const span of line.spans) {
        primitives.push(spanLine(span, styleOf(line.direction, true)));
      }
    }
    return { sheet: sheetOf(sheet, frame), primitives };
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
  const runsOf = (ref: PrecreaseRef) => spansOfRef(sequence, frame, step, ref);
  const interior = (() => {
    if (perpendicular) return { moving: perpendicular.moving, receiving: perpendicular.receiving };
    if (witness?.axiom !== 3 || !chord) return null;
    const which = witness.inputs.findIndex((_, i) => moving.has(i));
    const other = witness.inputs.findIndex((_, i) => i !== which);
    const source = which >= 0 ? segmentOfRef(sequence, frame, witness.inputs[which]!) : null;
    if (!source || other < 0) return null;
    // The side of the fold that moves, and the side its image lands on.
    const side = movingSide(
      frame,
      chord,
      source,
      runsOf(witness.inputs[which]!),
      runsOf(witness.inputs[other]!)
    );
    return side === 0 ? null : { moving: side, receiving: -side };
  })();
  // A point brought onto a line lands at one place on it — its image across
  // the fold — and only the arm of the line that place is on takes part: the
  // arm that swings over when the line is what moves, the arm the point lands
  // on when the point is. The other arm stays put, and highlighting it said
  // the whole edge was being folded. wolpertinger step 125: an edge folded
  // through a mark on it onto an interior mark — the stretch below the mark
  // swings, the stretch above does not.
  const landings = landingPairs(witness);
  const landingOf = (which: number): Point | null => {
    const from = landings.get(which);
    if (from === undefined || !chord) return null;
    const ref = inputs[from];
    if (!ref || (ref.kind !== 'point' && ref.kind !== 'corner')) return null;
    const at = frame.point(ref.id);
    if (!at) return null;
    const [x, y] = reflectAcross(chord, xy(at));
    return { x, y };
  };
  const shown = (
    which: number,
    ref: PrecreaseRef,
    spans: readonly DiagramSegment[]
  ): DiagramSegment[] => {
    const landing = landingOf(which);
    if (landing && chord) {
      const side = sideOf(chord, landing);
      const arm = side === 0 ? [...spans] : onSide(chord, side, spans);
      if (arm.length <= 1) return arm;
      // The piece the landing is on; else the nearest, so the folder at
      // least sees which line is meant.
      const gap = (piece: DiagramSegment) => distanceToSegment(piece, landing);
      const on = arm.filter((piece) => gap(piece) <= 1e-6 * Math.max(1, length(chord)));
      if (on.length > 0) return on;
      return [arm.reduce((a, b) => (gap(b) < gap(a) ? b : a))];
    }
    if (!interior || !chord) return [...spans];
    const isMoving = moving.has(which) && !perpendicular;
    const side = isMoving ? interior.moving : interior.receiving;
    const arm = onSide(chord, side, spans);
    if (arm.length <= 1) return arm;
    // A line creased in separate pieces: the references are the pieces the
    // fold actually brings crease onto — those that, once the fold is made,
    // lie along the other line's crease. Not the piece nearest the angle's
    // vertex: a crease that begins at the fold and runs off the other way is
    // nearest of all and is not landed on at all. Only when no piece is
    // landed on does the nearest stand in, so the folder at least sees which
    // line is meant.
    const otherIndex = inputs.findIndex(
      (_, i) => i !== which && inputs[i]!.kind !== 'point' && inputs[i]!.kind !== 'corner'
    );
    const otherRuns = otherIndex >= 0 ? onSide(chord, -side, runsOf(inputs[otherIndex]!)) : [];
    const landed = arm.filter((piece) =>
      (isMoving ? alignment(chord, [piece], otherRuns) : alignment(chord, otherRuns, [piece])) > 0
    );
    if (landed.length > 0) return landed;
    const whole = segmentOfRef(sequence, frame, ref);
    const vertex = whole ? linesMeet(whole, chord) : null;
    if (!vertex) return arm;
    const gap = (seg: DiagramSegment) =>
      Math.min(...seg.map((q) => Math.hypot(q.x - vertex.x, q.y - vertex.y)));
    return [arm.reduce((a, b) => (gap(b) < gap(a) ? b : a))];
  };
  // The pieces each line input is drawn as, kept for the arrow: a moving line
  // is swung from the piece the folder is shown, not from a half of the whole
  // chord picked over again.
  const shownPieces = new Map<number, DiagramSegment[]>();
  inputs.forEach((ref, which) => {
    const letter = letters.byInput[which]!;
    if (ref.kind === 'point' || ref.kind === 'corner') {
      const point = frame.point(ref.id);
      if (!point) return;
      primitives.push({ kind: 'point', at: xy(point), style: 'highlight' });
      labels.push({ kind: 'label', at: xy(point), text: letter, style: 'highlight' });
      return;
    }
    const segments = shown(which, ref, runsOf(ref));
    shownPieces.set(which, segments);
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

  // The motion: each moving input to its image across the new crease. A line
  // swings from the stretch of the piece it is shown as that lands on the
  // other line's crease — the longest such, or the longest piece when nothing
  // lands — so the arrow, the highlight and the landing agree on which arm
  // moves and where it goes.
  for (const which of witness?.who_moves ?? []) {
    const ref = inputs[which];
    if (!ref || !chord) continue;
    // A line that carries a point's landing swings from that very place: the
    // arrow runs from where the mark will land to the mark.
    const landing = landingOf(which);
    if (landing) {
      const from = xy(landing);
      const out = foldArrowArc(from, reflectAcross(chord, from), xy(frame.centre));
      if (out) primitives.push({ kind: 'fold-arrow', out });
      continue;
    }
    const pieces = shownPieces.get(which) ?? [];
    const otherIndex = inputs.findIndex(
      (_, i) => i !== which && inputs[i]!.kind !== 'point' && inputs[i]!.kind !== 'corner'
    );
    const onto =
      interior && otherIndex >= 0
        ? onSide(chord, interior.receiving, runsOf(inputs[otherIndex]!))
        : [];
    const stretches = pieces.flatMap((piece) => {
      const stretch = landingStretch(chord, piece, onto);
      return stretch ? [stretch] : [];
    });
    const swung = (stretches.length ? stretches : pieces).reduce<DiagramSegment | null>(
      (a, b) => (a === null || length(b) > length(a) ? b : a),
      null
    );
    const anchor = swung ? xy(midpoint(swung)) : anchorOfRef(sequence, frame, chord, ref);
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
  const creases = frame.made(step);
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
    // The crease the step makes: the pattern's pieces joined into one run and
    // carried out to the references it stops at, which is what a diagram
    // draws — never the bare chord. The rest of the chord used to be shown
    // faintly, to say the fold still runs the full width, but a crease
    // pattern's line is not an instruction to crease all of it, and the
    // faint stand-in read as one.
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
  // What the step presses on past the pattern's line, for a later step's
  // sake, is crease the folder makes now, and is drawn the same way.
  for (const span of frame.pressedOn(step)) primitives.push(spanLine(span, made));
  primitives.push(...labels);

  return { sheet: sheetOf(sheet, frame), primitives };
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
  return { sheet: sheetOf(sheet, frame), primitives };
}

/**
 * The sheet a picture is of: its size, and where its middle is in the space
 * the primitives are drawn in — which on the canvas is wherever the document
 * put the paper, not half its size from the origin.
 */
function sheetOf(sheet: { width: number; height: number }, frame: DiagramFrame): DiagramSheet {
  return { width: sheet.width, height: sheet.height, centre: [frame.centre.x, frame.centre.y] };
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
    // The pattern's own lines in the pattern's directions. An auxiliary fold
    // was made in a direction too, but the finished pattern assigns it none,
    // and this card is the pattern. A pleated family is both at once: the
    // lines the pattern holds keep their pleat direction, the rest are
    // auxiliary like any other.
    if (step.grid) {
      for (const line of frame.gridLines(step)) {
        const style = styleOf(line.inPattern ? line.direction : 'unassigned', true);
        for (const span of line.spans) {
          primitives.push(spanLine(span, style));
        }
      }
      continue;
    }
    const style = styleOf(step.kind === 'aux' ? 'unassigned' : step.direction, true);
    for (const span of creasedSpans(frame, step)) {
      primitives.push(spanLine(span, style));
    }
  }
  return { sheet: sheetOf(sheet, frame), primitives };
}
