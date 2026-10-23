/**
 * From what the tools picked to the step a document stores (plan D6): the op,
 * in the document's own form, and its choices — the same op the preview folds
 * and the commit appends, so the commit finds the preview's state and folds
 * nothing twice (`foldStepInputKey`).
 *
 * Everything an op stores is a sheet anchor, never a face or an index:
 *
 * - an **axiom**'s inputs are the picks' sheet points and edges, in the
 *   axiom's own slot order (`foldToolRegistry`), and the root chosen is the
 *   line it gave (`choices.root`);
 * - a **free line** is two sheet points on it, each the preimage of a point
 *   of the line inside the silhouette — found here, from the scene's
 *   subfaces and each top face's transform, since the line was clicked in the
 *   folded pane and may run off the paper at both ends;
 * - an **existing crease** is a sheet point inside its sheet segment: a fold
 *   to unfold, a precrease to refold;
 * - the **moving side**, when nothing else says it, is one sheet point whose
 *   image lies on it.
 *
 * Which side moves when nothing says: the side with less paper on it, as a
 * folder takes the smaller part to the larger — except along a fold being
 * unfolded, where the flap lies on the side with more. An equal split moves
 * the side to the right of the line as it was drawn, the book fold's half.
 * An axiom that carries a point says the side itself, and Swap turns any of
 * them round.
 *
 * Pure: no React, no store, no engine.
 */
import type { Point } from '../../lib/geometry';
import type {
  FoldChoices,
  FoldDirection,
  FoldLineInput,
  FoldLineVia,
  FoldModelLine,
  FoldOp,
  FoldPrecreaseExtent,
  FoldSeed,
  FoldSeedScope,
  SheetPoint,
} from '../document/foldSequenceDocument';
import type { FoldAxiomCandidate, FoldAxiomLine, FoldEngineRefused, FoldScene } from '../engine/foldEngineWire';
import {
  alongLine,
  applyIsometry,
  chordOfConvex,
  clipConvex,
  invertIsometry,
  lineThrough,
  pointOnLine,
  polygonArea,
  polygonCentroid,
  sceneLineOf,
  sideOf,
  toPair,
  toPoint,
} from '../canvas/foldCanvasGeometry';
import {
  pickRef,
  topSheetPointAt,
  type FoldPick,
  type FoldPickIndex,
  type FoldPointPick,
  type FoldSegmentPick,
} from '../canvas/foldPicking';
import { lineModeAxiom, type FoldKind, type FoldLineModeId, type FoldSecondLineModeId } from './foldToolCatalog';
import { inSlotOrder, lineModeInput } from './foldToolRegistry';
import type { FoldResolvedSeed } from './foldToolState';

/** What the tools have picked to locate a line, and every choice of what moves made since. */
export interface FoldLocateIntent {
  lineMode: FoldLineModeId;
  picks: readonly FoldPick[];
  /** The axiom root chosen; null until the engine has named the roots, or for another line mode. */
  candidate: FoldAxiomCandidate | null;
  swapped: boolean;
  /** The tools' seed with the top flap resolved (`tools/topFlapSeed`): a step is never built with `top`. */
  seed: FoldResolvedSeed;
}

/** What the tools have picked for a plain fold, and every choice made since. */
export interface FoldStepIntent extends FoldLocateIntent {
  kind: FoldKind;
  precreaseDirection: FoldDirection;
  /** A precrease of part of its line only: a segment, or a pinch. Absent for the whole line. */
  extent?: FoldPrecreaseExtent;
}

/** A step ready to preview and commit, with what the canvas draws and analytics names of it. */
export interface FoldBuiltStep {
  status: 'built';
  op: FoldOp;
  choices?: FoldChoices;
  /** The fold line in the scene frame, as located (before the engine snaps it). */
  sceneLine: FoldModelLine;
  /** The side that moves, against `sceneLine`'s normal. */
  movingSign: 1 | -1;
  via: FoldLineVia;
  scope: FoldSeedScope;
  /**
   * A free line drawn on the crease pattern across faces the folded form
   * puts apart: the fold runs through the two points as they lie folded, so
   * the creases it leaves are not the line drawn.
   */
  acrossLayers?: true;
}

export type FoldStepBuild =
  | FoldBuiltStep
  /** Not every click is in, or an axiom's roots are still being asked for. */
  | { status: 'unlocated' }
  /** Refused before the engine is asked: no paper lies on the side that would move. */
  | { status: 'refused'; refused: FoldEngineRefused };

/**
 * A refusal the tools can tell without the engine, under the engine's own
 * code: no paper on the side that would move, an axiom with no root here,
 * or a crimp's second line drawn off the paper, which misses its tip.
 */
export function clientRefusal(code: 'no_moving_side' | 'no_root' | 'crimp_misses_tip'): FoldEngineRefused {
  return { status: 'refused', refusal: { code }, fixes: [], faces: [], vertices: [] };
}

// ---------------------------------------------------------------------------
// The paper on each side of a line

interface PaperPiece {
  /** The piece of a subface on one side, in the scene frame. */
  polygon: Point[];
  area: number;
  /** The subface's top face: whose transform takes a point of the piece to the sheet. */
  top: number;
}

/** The paper on the `sign` side of a scene line: each subface clipped to it. */
function paperOn(index: FoldPickIndex, line: FoldModelLine, sign: 1 | -1): PaperPiece[] {
  const pieces: PaperPiece[] = [];
  for (const subface of index.subfaces) {
    const top = subface.stack[0];
    if (top === undefined) continue;
    const polygon = clipConvex(subface.polygon, line, sign);
    if (polygon.length < 3) continue;
    const area = polygonArea(polygon);
    if (area > 1e-12) pieces.push({ polygon, area, top });
  }
  return pieces;
}

const areaOf = (pieces: readonly PaperPiece[]) => pieces.reduce((sum, piece) => sum + piece.area, 0);

/** A sheet point under a point of the scene that lies on face `top`. */
function sheetOf(scene: FoldScene, top: number, at: Point): SheetPoint | null {
  const transform = scene.face_transforms[top];
  return transform ? toPair(applyIsometry(invertIsometry(transform), at)) : null;
}

/** A sheet point inside the largest piece of paper on the `sign` side: its image is on that side. */
export function movingPoint(index: FoldPickIndex, line: FoldModelLine, sign: 1 | -1): { sheet: SheetPoint; scene: Point } | null {
  const pieces = paperOn(index, line, sign);
  const largest = pieces.reduce<PaperPiece | null>((best, piece) => (best && best.area >= piece.area ? best : piece), null);
  if (!largest) return null;
  const scene = polygonCentroid(largest.polygon);
  const sheet = sheetOf(index.scene, largest.top, scene);
  return sheet ? { sheet, scene } : null;
}

/**
 * How unequal two sides may be and still count as an even split, as a share
 * of the paper: a line drawn by hand through the middle is never exactly
 * through it, and a book fold should not swap sides on a pixel.
 */
const EVEN_SPLIT = 0.02;

/**
 * The side that moves when nothing says: less paper, or along a fold being
 * unfolded more; an even split, the right of the line as drawn (its
 * negative side, the normal pointing left).
 */
export function defaultMovingSign(index: FoldPickIndex, line: FoldModelLine, unfolding: boolean): 1 | -1 {
  const positive = areaOf(paperOn(index, line, 1));
  const negative = areaOf(paperOn(index, line, -1));
  if (Math.abs(positive - negative) <= EVEN_SPLIT * (positive + negative)) return -1;
  const smaller: 1 | -1 = positive < negative ? 1 : -1;
  return unfolding ? (-smaller as 1 | -1) : smaller;
}

/**
 * The scene line `line`'s two ends on the paper, as far apart along it as the
 * paper reaches, each a tenth in from the end of the subface it crosses there
 * (clear of its corners), with that subface's top face. Null when the line
 * misses the paper.
 */
function paperEnds(index: FoldPickIndex, line: FoldModelLine): [{ at: Point; top: number }, { at: Point; top: number }] | null {
  let first: { from: number; to: number; top: number } | null = null;
  let last: { from: number; to: number; top: number } | null = null;
  for (const subface of index.subfaces) {
    const top = subface.stack[0];
    if (top === undefined) continue;
    const chord = chordOfConvex(subface.polygon, line);
    if (!chord) continue;
    const [from, to] = chord;
    if (!first || from < first.from) first = { from, to, top };
    if (!last || to > last.to) last = { from, to, top };
  }
  if (!first || !last) return null;
  return [
    { at: pointOnLine(line, first.from + (first.to - first.from) * 0.1), top: first.top },
    { at: pointOnLine(line, last.to - (last.to - last.from) * 0.1), top: last.top },
  ];
}

/**
 * The stretch of the scene line `line` across the paper, first paper to
 * last, in the scene frame: where a located line is drawn over the folded
 * pane. Null when the line misses the paper.
 */
export function lineAcrossPaper(index: FoldPickIndex, line: FoldModelLine): [Point, Point] | null {
  let from = Infinity;
  let to = -Infinity;
  for (const subface of index.subfaces) {
    const chord = chordOfConvex(subface.polygon, line);
    if (!chord) continue;
    from = Math.min(from, chord[0]);
    to = Math.max(to, chord[1]);
  }
  return to > from ? [pointOnLine(line, from), pointOnLine(line, to)] : null;
}

/**
 * A free line through the scene line `line`: two sheet points on it, as far
 * apart along it as the paper reaches, each just inside the stretch of a
 * subface it crosses. Null when the line misses the paper.
 */
export function freeLineThrough(index: FoldPickIndex, line: FoldModelLine): [SheetPoint, SheetPoint] | null {
  const ends = paperEnds(index, line);
  if (!ends) return null;
  const a = sheetOf(index.scene, ends[0].top, ends[0].at);
  const b = sheetOf(index.scene, ends[1].top, ends[1].at);
  return a && b ? [a, b] : null;
}

/**
 * The scene line `line` located as a free line, as two clicks on the folded
 * pane would locate it: its two ends on the paper, in the order that draws it
 * with `line`'s own normal, so each side of the one is that side of the
 * other. Null when the line misses the paper.
 */
export function freePicksAlong(index: FoldPickIndex, line: FoldModelLine): [FoldPick, FoldPick] | null {
  const ends = paperEnds(index, line);
  if (!ends) return null;
  const [p, q] = ends.map((end) => end.at) as [Point, Point];
  const drawn = lineThrough(p, q);
  if (!drawn) return null;
  const [from, to] = drawn.n[0] * line.n[0] + drawn.n[1] * line.n[1] < 0 ? [q, p] : [p, q];
  const free = (at: Point): FoldPick => ({ kind: 'free', pane: 'folded', scene: at, sheet: topSheetPointAt(index, at) });
  return [free(from), free(to)];
}

/** How far, in sheet units, a stretch of the drawn line may land off the fold line and still be on it. */
const ON_LINE = 1e-7;

/**
 * Whether the straight sheet line from `p` to `q` is the crease a fold along
 * the scene line `line` leaves there: every stretch of it, on whichever face
 * it crosses, lands on the fold line through that face's transform. On one
 * face, or on faces the folded form keeps in line, it does; across faces it
 * puts apart, the fold runs through `p` and `q` as they lie folded and
 * creases the sheet along another path.
 */
export function freeLineAsDrawn(scene: FoldScene, line: FoldModelLine, p: SheetPoint, q: SheetPoint): boolean {
  const drawn = lineThrough(toPoint(p), toPoint(q));
  if (!drawn) return true;
  const ends = [alongLine(drawn, toPoint(p)), alongLine(drawn, toPoint(q))];
  const [from, to] = [Math.min(...ends), Math.max(...ends)];
  for (const [face, { points }] of scene.faces.entries()) {
    const outline = points.map((vertex) => scene.sheet_points[vertex]);
    const transform = scene.face_transforms[face];
    if (!transform || outline.some((corner) => corner === undefined)) continue;
    const chord = chordOfConvex(outline as Point[], drawn);
    if (!chord) continue;
    const a = Math.max(chord[0], from);
    const b = Math.min(chord[1], to);
    if (!(b - a > ON_LINE)) continue;
    for (const t of [a, b]) {
      if (Math.abs(sideOf(line, applyIsometry(transform, pointOnLine(drawn, t)))) > ON_LINE) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// The step

function seedOf(seed: FoldResolvedSeed): FoldSeed {
  switch (seed.scope) {
    case 'all':
      return { scope: 'all' };
    case 'flaps':
      return { scope: 'flaps', at: seed.flaps.map((flap) => flap.witness) };
    case 'depth':
      return { scope: 'depth', at: seed.at, layers: seed.choice };
  }
}

const isReference = (pick: FoldPick): pick is FoldPointPick | FoldSegmentPick => pick.kind !== 'free';

/**
 * The axiom line the picks locate once every click is in — its inputs the
 * picks' sheet anchors in the axiom's own slot order — or null for another
 * line mode, or before then: what the engine is asked for the axiom's roots.
 */
export function axiomLineOfPicks(lineMode: FoldLineModeId, picks: readonly FoldPick[]): FoldAxiomLine | null {
  const axiom = lineModeAxiom(lineMode);
  if (axiom === null) return null;
  // The line mode's own clicks: a crimp's second line's come after them.
  const model = lineModeInput(lineMode);
  const slots = inSlotOrder(model, picks.slice(0, model.steps.length));
  if (!slots || !slots.every(isReference)) return null;
  return { via: 'axiom', axiom, inputs: slots.map(pickRef) };
}

export interface Located {
  line: FoldLineInput;
  sceneLine: FoldModelLine;
  implied: 1 | -1 | null;
  choices?: FoldChoices;
  crease?: FoldSegmentPick;
  acrossLayers?: true;
}

/**
 * The line the picks locate, where it lies in the scene, and the side it says
 * moves, if it says one; null until it is located, or a refusal when it is
 * located and cannot be stored — a free line that misses the paper has no
 * sheet point to be stored by, and moves nothing or everything.
 */
export function locate(intent: FoldLocateIntent, index: FoldPickIndex): Located | FoldEngineRefused | null {
  const model = lineModeInput(intent.lineMode);
  if (intent.picks.length < model.steps.length) return null;
  if (lineModeAxiom(intent.lineMode) !== null) {
    const line = axiomLineOfPicks(intent.lineMode, intent.picks);
    if (!line || !intent.candidate) return null;
    const { candidate } = intent;
    return {
      line,
      // The engine's line and side are the model frame's; the view turns
      // both alike, so the side is the same sign against the scene's line.
      sceneLine: sceneLineOf(index.scene.view_transform, candidate.line),
      implied: candidate.side === null ? null : candidate.side === 'positive' ? 1 : -1,
      choices: { root: candidate.line },
    };
  }
  if (intent.lineMode === 'free') {
    const [p, q] = intent.picks;
    if (p?.kind !== 'free' || q?.kind !== 'free') return null;
    const sceneLine = lineThrough(p.scene, q.scene);
    if (!sceneLine) return null;
    const through = freeLineThrough(index, sceneLine);
    if (!through) return clientRefusal('no_moving_side');
    // Drawn on the crease pattern, the line is where it was drawn only while
    // the faces under it lie in line in the folded form.
    const acrossLayers =
      p.pane === 'crease-pattern' &&
      q.pane === 'crease-pattern' &&
      p.sheet !== null &&
      q.sheet !== null &&
      !freeLineAsDrawn(index.scene, sceneLine, p.sheet, q.sheet);
    return { line: { via: 'free', through }, sceneLine, implied: null, ...(acrossLayers ? { acrossLayers: true } : {}) };
  }
  const [crease] = intent.picks;
  if (crease?.kind !== 'segment') return null;
  const sceneLine = lineThrough(crease.scene[0], crease.scene[1]);
  if (!sceneLine) return null;
  if (crease.creaseMark) {
    return { line: { via: 'free', through: [...crease.sheet] }, sceneLine, implied: null, crease };
  }
  const at: SheetPoint = [(crease.sheet[0][0] + crease.sheet[1][0]) / 2, (crease.sheet[0][1] + crease.sheet[1][1]) / 2];
  return { line: { via: 'crease', at }, sceneLine, implied: null, crease };
}

/**
 * A crimp's second line, from the picks past its first line's (`picks`, the
 * second line mode's clicks): a free line through two sheet points, or an
 * existing crease by a sheet point on it, with where it lies in the scene.
 * It has no side of its own — the crimp's is its first line's — and no
 * axiom, since a step stores one root. Unlocated until its clicks are in;
 * refused when a free line misses the paper, so the tip too.
 */
export function locateSecondLine(
  mode: FoldSecondLineModeId,
  picks: readonly FoldPick[],
  index: FoldPickIndex
): { line: FoldLineInput; sceneLine: FoldModelLine } | { status: 'unlocated' } | { status: 'refused'; refused: FoldEngineRefused } {
  const located = locate({ lineMode: mode, picks, candidate: null, swapped: false, seed: { scope: 'all' } }, index);
  if (!located) return { status: 'unlocated' };
  if ('status' in located) return { status: 'refused', refused: clientRefusal('crimp_misses_tip') };
  return { line: located.line, sceneLine: located.sceneLine };
}

/**
 * How far beside an unfolded bend, in the scene frame, the seed of the flap
 * hinged on it is taken: inside the face along the bend — under half the
 * minimum feature, the thinnest a piece is let be — and well clear of the
 * tolerance, so it is off the bend itself.
 */
const BESIDE_BEND = 2e-4;

/** What every fold along a located line stores, beside its kind: the line, the moving side and the seed. */
export interface FoldAlongLocated {
  line: FoldLineInput;
  /** The axiom root's line: the step's choice. */
  choices?: FoldChoices;
  along: { moving?: SheetPoint; seed: FoldSeed };
  sceneLine: FoldModelLine;
  movingSign: 1 | -1;
  /** A bend picked in the existing-crease mode with the fold to unfold it: its flap is the seed. */
  unfolding: boolean;
  acrossLayers?: true;
}

/**
 * The line the picks locate, its moving side and what moves along with it,
 * from the state `index` was made for; or why there is none yet. A plain
 * fold and a compound one along a line both start here (`unfolds`: whether a
 * bend picked in the existing-crease mode is unfolded, as a valley or
 * mountain along it is, and its flap taken). `moves` is which side moves
 * when nothing says: the one with less paper, as a folder takes the smaller
 * part over — or, for an unsink, the one with more, where the sunk point lies
 * inside the paper round it.
 */
export function locateAlongLine(
  intent: FoldLocateIntent,
  index: FoldPickIndex,
  unfolds: boolean,
  moves: 'less' | 'more' = 'less'
): FoldAlongLocated | { status: 'unlocated' } | { status: 'refused'; refused: FoldEngineRefused } {
  const located = locate(intent, index);
  if (!located) return { status: 'unlocated' };
  if ('status' in located) return { status: 'refused', refused: located };
  const { line, sceneLine, implied, choices, crease, acrossLayers } = located;
  const unfolding = crease?.segment === 'bend' && unfolds;
  const base = implied ?? defaultMovingSign(index, sceneLine, unfolding || moves === 'more');
  const movingSign: 1 | -1 = intent.swapped ? (-base as 1 | -1) : base;

  // What moves. Unfolding takes the top flap on the moving side unless the
  // folder said otherwise (plan D3): the stack just beside the bend there, one
  // layer deep, whose top face is the flap hinged on the bend — never a cell
  // chosen by area, which ties between equal flaps and rounds differently
  // from one browser to the next.
  //
  // A point names the moving side where nothing else does — an axiom that
  // carries a point, or a seed's own point — and where a swap turns round the
  // side an axiom implies, whatever the seed: the engine takes a side the
  // step names over the axiom's.
  let seed = intent.seed;
  let moving: SheetPoint | undefined;
  const swappedAxiom = implied !== null && intent.swapped;
  const needsPoint = seed.scope === 'all' ? implied === null || intent.swapped || unfolding : swappedAxiom;
  if (needsPoint) {
    // Unfolding is along an existing crease, which implies no side: its seed
    // is `all` here, which the default top flap resolves to (`topFlapProbe`).
    const point = unfolding && crease ? besideBend(index, crease, sceneLine, movingSign) : movingPoint(index, sceneLine, movingSign);
    if (!point) return { status: 'refused', refused: clientRefusal('no_moving_side') };
    if (unfolding) seed = { scope: 'depth', at: point.sheet, scene: point.scene, choice: 1 };
    else moving = point.sheet;
  }
  return {
    line,
    ...(choices ? { choices } : {}),
    along: { ...(moving ? { moving } : {}), seed: seedOf(seed) },
    sceneLine,
    movingSign,
    unfolding,
    ...(acrossLayers ? { acrossLayers } : {}),
  };
}

/** A point just beside a bend's middle on the moving side, and the sheet point of the face on top there. */
export function besideBend(
  index: FoldPickIndex,
  bend: FoldSegmentPick,
  sceneLine: FoldModelLine,
  movingSign: 1 | -1
): { sheet: SheetPoint; scene: Point } | null {
  const [p, q] = bend.scene;
  const scene: Point = {
    x: (p.x + q.x) / 2 + movingSign * BESIDE_BEND * sceneLine.n[0],
    y: (p.y + q.y) / 2 + movingSign * BESIDE_BEND * sceneLine.n[1],
  };
  const sheet = topSheetPointAt(index, scene);
  return sheet ? { sheet, scene } : null;
}

/**
 * The step the intent describes, from the state `index` was made for; or why
 * there is none yet. Pure, and cheap: the canvas asks it on every change of
 * the tools.
 */
export function buildFoldStep(intent: FoldStepIntent, index: FoldPickIndex): FoldStepBuild {
  const located = locateAlongLine(intent, index, intent.kind !== 'precrease');
  if ('status' in located) return located;
  const { line, choices, along, sceneLine, movingSign, acrossLayers } = located;
  let op: FoldOp;
  if (intent.kind === 'precrease') {
    op = { kind: 'precrease', direction: intent.precreaseDirection, line, ...along, ...(intent.extent ? { extent: intent.extent } : {}) };
  } else {
    op = { kind: intent.kind, line, ...along, landing: { kind: 'outer' } };
  }
  return {
    status: 'built',
    op,
    ...(choices ? { choices } : {}),
    sceneLine,
    movingSign,
    via: line.via,
    scope: along.seed.scope,
    ...(acrossLayers ? { acrossLayers } : {}),
  };
}
