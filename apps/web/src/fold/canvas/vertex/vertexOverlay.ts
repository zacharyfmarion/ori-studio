/**
 * What a vertex tool draws on the folded pane while it previews (plan D14),
 * from the engine's description of its flap, line or fan: the creases its
 * fold makes, as paper (`vertexCreaseLines`), and what is not a crease — its
 * vertex, a line it lands on, the choices it offers — over the paper in the
 * theme's pick accent (`vertexOverlayMarks`).
 *
 * **The creases** are drawn as the instruction a diagram draws, in the user's
 * diagram-crease pens (`withFoldCreases`), each by the letter it folds by as
 * the viewer sees it. Which letter is the engine's rule for each fold, as the
 * direction (`FoldVertexIntent.direction`, as the viewer sees it) names it,
 * and what its landed states show:
 *
 * - **Squash**: the lower layer creases the direction's way, the upper layer
 *   (on top, as seen) the other (`compound/squash.rs`; a valley squash's
 *   upper crease shows the viewer a mountain). Where the two lie on one line
 *   — the spine landing on the hinge — the line is drawn once, the
 *   direction's way, as the step's own picture draws it (`squash_action`).
 * - **Petal fold**: H the direction's way, the top layer's kite creases the
 *   other (`compound/petal.rs`: a valley petal's kites show a mountain).
 * - **Rabbit ear, swivel by its rays**: the three given rays the direction's
 *   way and the fourth crease taken the other (`compound/fan.rs`, Lang;
 *   Beloch's `flatten-rabbit-ear-*`). Before the engine has described the
 *   fan — from the moment the given rays' clicks are in — the paper draws
 *   them as its pending creases instead (`fanGeometry`'s `fanGivenCreases`).
 * - **Swivel by its edge**: its four creases from the vertex to where each
 *   leaves the last layer it cuts, each by the letter the engine gives it as
 *   seen — the ridge the odd one out (`compound/swivel.rs`). On a folded
 *   edge, its three: the swivel crease in each of the two layers (the one
 *   underneath drawn only past the one on top) and the other layer's second
 *   crease, the other layer's swivel crease the odd one out
 *   (`compound/swivel_on_edge.rs`).
 * - **Swivel by its valley and mountain**: the two named on the layer in
 *   front, by their letters, and the crease computed on the layer behind,
 *   dotted where the front layer hides it (`compound/swivel_valley_mountain.rs`).
 *
 * **The marks** stay the tool's feedback, never a pen, since none of them is
 * a crease the fold makes:
 *
 * - **Squash**: its vertex, the spine as it lies (faint), and where it lands
 *   (bold): the hinge line until a point is clicked; where it was aimed,
 *   faint, when that cannot land.
 * - **Petal fold**: the ends of the hinge and the open corner.
 * - **Rabbit ear, swivel by its rays**: the center, and the other fourth
 *   creases that land (faint); one that does not land is not drawn, as it is
 *   not offered.
 * - **Swivel by its edge**: the vertex — where the pivot clicked really sits,
 *   moved onto the line halfway between the edge and the target (on a folded
 *   edge, along it to where that line crosses it), drawn in its place —
 *   where the edge lands on the target (bold), and the other ridge when it
 *   lands too (faint). Its moving paper is lit over the paper
 *   ({@link swivelRegionsTint}), the part that carries the edge brightest.
 *
 * Each ray runs from its vertex to where it leaves the paper. Pure: the
 * colours are handed in, resolved by the pane.
 */
import type { Point } from '../../../lib/geometry';
import { joinFills, ringsFill } from '../../../cp-workspace/renderer/fillTint';
import type { FillGeometry, Rgba } from '../../../cp-workspace/renderer/types';
import type { FoldDirection } from '../../document/foldSequenceDocument';
import type { FoldFanAnalysis, FoldSwivelEdgeAnalysis, FoldVertexAnalysis } from '../../engine/foldEngineSquashWire';
import type { FoldLetter, FoldModelPoint } from '../../engine/foldEngineWire';
import { alongLine, chordOfConvex, lineThrough, pointOnLine, toPoint } from '../foldCanvasGeometry';
import type { FoldOverlayDot, FoldOverlayInks, FoldOverlayMarks, FoldOverlayStroke } from '../foldPaneOverlays';
import type { FoldPaneCreaseLine } from '../foldPaneScenes';
import type { FoldPickIndex } from '../foldPicking';

/** CSS px: a vertex's dot. */
const VERTEX_RADIUS = 4;
/** Stroke widths, as multiples of the frame's: a line, the one landed on. */
const LINE_WIDTH = 1.6;
const CHOSEN_WIDTH = 2.6;
/** How faint what is not taken is drawn: the spine as it lies, a candidate not taken. */
const FAINT = 0.4;
/** How far a ray runs, in model units, when it starts on the paper's edge and the paper gives it no length. */
const EDGE_RAY = 0.2;
/** Two of a squash's crease directions closer than this are one line. */
const SAME_DIRECTION = 1e-9;

const withAlpha = ([r, g, b, a]: Rgba, alpha: number): Rgba => [r, g, b, a * alpha];

/** What the vertex overlay reads: the description, and the choices taken of what it lists. */
export interface FoldVertexOverlayInput {
  analysis: FoldVertexAnalysis;
  /** A fan's fourth crease taken, by index into its candidates; null for none. */
  emergent: number | null;
  /** Per candidate, whether it fits; empty when unknown. */
  emergents: readonly boolean[];
  /**
   * Where a squash's spine was aimed, as a model-frame direction from its
   * vertex, when that fold was refused and the analysis drawn is the hinge
   * line's: drawn faint, so the folder sees where they aimed. Null otherwise.
   */
  aimed?: FoldModelPoint | null;
}

function rotate([x, y]: FoldModelPoint, angle: number): FoldModelPoint {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * x - s * y, s * x + c * y];
}

const other = (letter: FoldLetter): FoldLetter => (letter === 'valley' ? 'mountain' : 'valley');

/**
 * Where a ray from a point of the folded form leaves the paper: walked from
 * cell to cell of the scene as far as they carry it on. A ray along the
 * paper's edge, which no cell's inside meets, runs a fixed short way.
 */
export function rayOnPaper(index: FoldPickIndex, from: Point, toward: Point): Point {
  const line = lineThrough(from, toward);
  if (!line) return from;
  const start = alongLine(line, from);
  // Toward `toward`, whichever way the line's own direction runs.
  const sign = alongLine(line, toward) >= start ? 1 : -1;
  let reach = 0;
  for (let grown = true; grown; ) {
    grown = false;
    for (const cell of index.subfaces) {
      const chord = chordOfConvex(cell.polygon, line);
      if (!chord) continue;
      const [lo, hi] = sign > 0 ? [chord[0] - start, chord[1] - start] : [start - chord[1], start - chord[0]];
      if (lo <= reach + 1e-9 && hi > reach + 1e-9) {
        reach = hi;
        grown = true;
      }
    }
  }
  return pointOnLine(line, start + sign * (reach > 1e-9 ? reach : EDGE_RAY));
}

/** A ray from a model point along a model direction, to the paper's edge, in the scene frame. */
function ray(index: FoldPickIndex, from: FoldModelPoint, direction: FoldModelPoint): [Point, Point] {
  const a = index.toScene(toPoint(from));
  const b = index.toScene({ x: from[0] + direction[0], y: from[1] + direction[1] });
  return [a, rayOnPaper(index, a, b)];
}

/** A stretch between two model points, in the scene frame. */
function segment(index: FoldPickIndex, a: FoldModelPoint, b: FoldModelPoint): [Point, Point] {
  return [index.toScene(toPoint(a)), index.toScene(toPoint(b))];
}

/** A squash's two layer creases' directions from its vertex: the lower layer's, then the upper's. */
function squashCreaseDirections(analysis: Extract<FoldVertexAnalysis, { kind: 'squash' }>): {
  lower: FoldModelPoint;
  upper: FoldModelPoint;
} {
  const { hinge_direction: hinge, wedge, share } = analysis;
  return { lower: rotate(hinge, ((1 + share) * wedge) / 2), upper: rotate(hinge, ((1 - share) * wedge) / 2) };
}

/**
 * The creases a vertex fold makes, each by the letter it folds by as the
 * viewer sees it, for `direction` (see the module docs): what the folded
 * pane draws in the diagram-crease pens. A fan's fourth crease is drawn once
 * one is taken; the others are choices, not creases (`vertexOverlayMarks`).
 */
export function vertexCreaseLines(
  index: FoldPickIndex,
  input: Pick<FoldVertexOverlayInput, 'analysis' | 'emergent'>,
  direction: FoldDirection
): FoldPaneCreaseLine[] {
  const { analysis } = input;
  const creases: FoldPaneCreaseLine[] = [];
  const add = (line: [Point, Point], letter: FoldLetter) => creases.push({ line, letter });
  switch (analysis.kind) {
    case 'squash': {
      const { lower, upper } = squashCreaseDirections(analysis);
      add(ray(index, analysis.vertex, lower), direction);
      const apart = Math.hypot(upper[0] - lower[0], upper[1] - lower[1]) > SAME_DIRECTION;
      if (apart) add(ray(index, analysis.vertex, upper), other(direction));
      break;
    }
    case 'petal': {
      const [left, right] = analysis.ends;
      add(segment(index, left, right), direction);
      add(segment(index, left, analysis.corner), other(direction));
      add(segment(index, right, analysis.corner), other(direction));
      break;
    }
    case 'rabbit-ear':
    case 'swivel': {
      for (const given of analysis.given) add(ray(index, analysis.center, given), direction);
      const taken = input.emergent === null ? undefined : analysis.candidates[input.emergent];
      if (taken) add(ray(index, analysis.center, taken), other(direction));
      break;
    }
    case 'swivel-valley-mountain':
    case 'swivel-by-edge':
      // Each from where it is seen to where it leaves the last layer it
      // cuts, by the engine's letter as seen: on a folded edge, the swivel
      // crease of the layer underneath shows only past the one on top. By
      // its valley and mountain, the crease behind is drawn where it is
      // hidden too, dotted, as a diagram draws it.
      for (const crease of analysis.creases) {
        const [a, b] = segment(index, crease.from, crease.to);
        if (Math.hypot(b.x - a.x, b.y - a.y) <= 1e-9) continue;
        if (crease.hidden) creases.push({ line: [a, b], letter: crease.letter, hidden: true });
        else add([a, b], crease.letter);
      }
      break;
  }
  return creases;
}

function fanChoices(
  index: FoldPickIndex,
  analysis: FoldFanAnalysis,
  input: FoldVertexOverlayInput,
  accent: Rgba
): FoldOverlayStroke[] {
  const strokes: FoldOverlayStroke[] = [];
  // The fourth crease taken is a crease, drawn in its pen (`vertexCreaseLines`);
  // one that does not land is never offered, so never drawn.
  analysis.candidates.forEach((candidate, k) => {
    if (k === input.emergent || !(input.emergents[k] ?? true)) return;
    const [a, b] = ray(index, analysis.center, candidate);
    strokes.push({ a, b, color: withAlpha(accent, FAINT), widthMul: LINE_WIDTH });
  });
  return strokes;
}

/** The vertex tool's marks over the folded pane: everything but its creases (see the module docs). */
export function vertexOverlayMarks(
  index: FoldPickIndex,
  input: FoldVertexOverlayInput,
  inks: Pick<FoldOverlayInks, 'accent' | 'outline'>
): FoldOverlayMarks {
  const { analysis } = input;
  const { accent, outline } = inks;
  const dots: FoldOverlayDot[] = [];
  const strokes: FoldOverlayStroke[] = [];
  const dot = (p: FoldModelPoint) =>
    dots.push({ at: index.toScene(toPoint(p)), radius: VERTEX_RADIUS, fill: accent, stroke: outline });
  switch (analysis.kind) {
    case 'squash': {
      const { vertex, hinge_direction: hinge, wedge, share } = analysis;
      const along = (direction: FoldModelPoint, color: Rgba, widthMul: number) => {
        const [a, b] = ray(index, vertex, direction);
        strokes.push({ a, b, color, widthMul });
      };
      along(analysis.spine_direction, withAlpha(accent, FAINT), LINE_WIDTH);
      // Where the spine lands, `share` of the wedge from the hinge.
      along(rotate(hinge, share * wedge), accent, CHOSEN_WIDTH);
      if (input.aimed) along(input.aimed, withAlpha(accent, FAINT), CHOSEN_WIDTH);
      dot(vertex);
      break;
    }
    case 'petal':
      for (const p of [...analysis.ends, analysis.corner]) dot(p);
      break;
    case 'rabbit-ear':
      dot(analysis.center);
      break;
    case 'swivel':
      strokes.push(...fanChoices(index, analysis, input, accent));
      dot(analysis.center);
      break;
    case 'swivel-valley-mountain':
      dot(analysis.vertex);
      break;
    case 'swivel-by-edge':
      // Where the edge lands, on the target.
      for (const [a, b] of analysis.landed) {
        const [p, q] = segment(index, a, b);
        strokes.push({ a: p, b: q, color: accent, widthMul: CHOSEN_WIDTH });
      }
      // The other ridge, when it lands too: a choice, not a crease.
      analysis.ridges.forEach((ridge, k) => {
        if (k === input.emergent || !(input.emergents[k] ?? true)) return;
        const [a, b] = ray(index, analysis.vertex, ridge);
        strokes.push({ a, b, color: withAlpha(accent, FAINT), widthMul: LINE_WIDTH });
      });
      dot(analysis.vertex);
      break;
  }
  return { dots, strokes };
}

/**
 * How strongly a swivel's moving paper is lit, and its turning wedge over
 * that: between the shared ladder's rungs (`fillTint.ts`), since a swivel
 * lights several pieces at once.
 */
const SWIVEL_MOVING_TINT = 0.2;
const SWIVEL_TURN_TINT = 0.36;

/**
 * A swivel's paper that moves (`FoldSwivelEdgeAnalysis.regions`), lit over
 * the folded pane in the theme's accent: every piece, and the part that
 * carries it brighter — by its edge, the wedge that turns about the vertex,
 * or on a folded edge the one that swivels across the swivel crease; by its
 * valley and mountain, the flap between them, which folds across the hinge.
 * Null when the engine lists none.
 */
export function swivelRegionsTint(
  index: FoldPickIndex,
  analysis: Pick<FoldSwivelEdgeAnalysis, 'regions' | 'fold'> & { kind?: FoldVertexAnalysis['kind'] },
  accent: Rgba
): FillGeometry | null {
  const carrier = analysis.kind === 'swivel-valley-mountain' ? 'beyond' : analysis.fold ? 'near' : 'turn';
  // A piece at a time, in the engine's order, each at its own strength.
  return analysis.regions.reduce<FillGeometry | null>((fill, region) => {
    const ring = region.polygon.map((p) => index.toScene(toPoint(p)));
    const alpha = region.wedge === carrier ? SWIVEL_TURN_TINT : SWIVEL_MOVING_TINT;
    return joinFills(fill, ringsFill([ring], accent, alpha));
  }, null);
}
