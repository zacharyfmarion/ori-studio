/**
 * Every line on the paper, split at the fold: what stays and what moves.
 *
 * A fold along a chord swings one side of the sheet over, creases and all. So
 * while a pose is set the crease pattern's own stroke buffer is divided in
 * two — the pieces on the resting side keep drawing where they are, and the
 * pieces on the flap ride the surface — and a crease that crosses the line
 * becomes two. Done on the *packed* geometry, after `applyCreaseVisibility`,
 * so a moving piece inherits the dimming, the settled direction and the
 * emphasis of the crease it came from.
 *
 * A stroke on the line itself stays: the fold line is the hinge, and it is
 * drawn by the diagram anyway.
 */
import type { Point } from '../../../lib/geometry';
import type { PointGeometry, StrokeGeometry } from '../../renderer/types';
import { sideOf } from '../diagram/plannerDiagram';
import type { FoldFlapScene } from './foldScene';

/** The strokes that ride a flap, with the appearance each came with. */
export interface FlapStrokes {
  a: Float32Array;
  b: Float32Array;
  color: Float32Array;
  widthMul: Float32Array;
  dashSlot: Float32Array;
  dashPhase: Float32Array;
  /** Which of the scene's flaps each stroke rides. */
  flap: Uint8Array;
  count: number;
  dashPatterns?: readonly (readonly number[])[];
}

export interface SplitStrokes {
  base: StrokeGeometry;
  flap: FlapStrokes;
}

interface Piece {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Model units of dash pattern before this piece's start. */
  phase: number;
  /** Index into the source geometry, for its appearance. */
  source: number;
  /** The flap it rides, or −1 for the base. */
  flap: number;
}

type Flap = Pick<FoldFlapScene, 'chord' | 'side' | 'whole'>;

/** Where `[a, b]` crosses the chord's line, as a fraction along it, or null. */
function crossing(a: Point, b: Point, chord: readonly [Point, Point]): number | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = chord[1].x - chord[0].x;
  const sy = chord[1].y - chord[0].y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((chord[0].x - a.x) * sy - (chord[0].y - a.y) * sx) / denominator;
  return t > 1e-9 && t < 1 - 1e-9 ? t : null;
}

/** A piece against one flap: itself, moved; itself, staying; or cut in two. */
function divide(piece: Piece, flap: Flap, index: number): Piece[] {
  if (piece.flap >= 0) return [piece];
  // The whole sheet turns: everything on it goes with it, the line included.
  if (flap.whole) return [{ ...piece, flap: index }];
  const a = { x: piece.ax, y: piece.ay };
  const b = { x: piece.bx, y: piece.by };
  const sa = sideOf(flap.chord, a);
  const sb = sideOf(flap.chord, b);
  // On the line at both ends: the hinge, which stays.
  if (sa === 0 && sb === 0) return [piece];
  const on = (side: number) => side === 0 || side === flap.side;
  if (on(sa) && on(sb)) return [{ ...piece, flap: index }];
  if (!on(sa) && !on(sb)) return [piece];
  const t = crossing(a, b, flap.chord);
  if (t === null) return [piece];
  const cx = a.x + (b.x - a.x) * t;
  const cy = a.y + (b.y - a.y) * t;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const first: Piece = { ...piece, bx: cx, by: cy, flap: on(sa) ? index : -1 };
  const second: Piece = {
    ...piece,
    ax: cx,
    ay: cy,
    phase: piece.phase + length * t,
    flap: on(sb) ? index : -1,
  };
  return [first, second];
}

/**
 * Split a stroke buffer at every flap's line. Strokes the buffer has already
 * hidden (alpha 0) stay in the base untouched; nothing they could contribute
 * to the flap would be drawn.
 */
export function splitStrokesAtFolds(
  strokes: StrokeGeometry,
  flaps: readonly Flap[]
): SplitStrokes {
  const pieces: Piece[] = [];
  for (let i = 0; i < strokes.count; i += 1) {
    const piece: Piece = {
      ax: strokes.a[i * 2]!,
      ay: strokes.a[i * 2 + 1]!,
      bx: strokes.b[i * 2]!,
      by: strokes.b[i * 2 + 1]!,
      phase: strokes.dashPhase?.[i] ?? 0,
      source: i,
      flap: -1,
    };
    if (strokes.color[i * 4 + 3] === 0) {
      pieces.push(piece);
      continue;
    }
    let current = [piece];
    flaps.forEach((flap, index) => {
      current = current.flatMap((part) => divide(part, flap, index));
    });
    pieces.push(...current);
  }
  const staying = pieces.filter((piece) => piece.flap < 0);
  const moving = pieces.filter((piece) => piece.flap >= 0);
  return { base: pack(strokes, staying), flap: { ...pack(strokes, moving), flap: flapsOf(moving) } };
}

function flapsOf(pieces: readonly Piece[]): Uint8Array {
  const out = new Uint8Array(pieces.length);
  pieces.forEach((piece, i) => {
    out[i] = piece.flap;
  });
  return out;
}

/** Pieces as a stroke buffer, each carrying its source stroke's appearance. */
function pack(
  source: StrokeGeometry,
  pieces: readonly Piece[]
): StrokeGeometry & { dashSlot: Float32Array; dashPhase: Float32Array } {
  const count = pieces.length;
  const a = new Float32Array(count * 2);
  const b = new Float32Array(count * 2);
  const color = new Float32Array(count * 4);
  const widthMul = new Float32Array(count);
  const dashSlot = new Float32Array(count);
  const dashPhase = new Float32Array(count);
  pieces.forEach((piece, i) => {
    a[i * 2] = piece.ax;
    a[i * 2 + 1] = piece.ay;
    b[i * 2] = piece.bx;
    b[i * 2 + 1] = piece.by;
    const s = piece.source;
    color[i * 4] = source.color[s * 4]!;
    color[i * 4 + 1] = source.color[s * 4 + 1]!;
    color[i * 4 + 2] = source.color[s * 4 + 2]!;
    color[i * 4 + 3] = source.color[s * 4 + 3]!;
    widthMul[i] = source.widthMul[s]!;
    // Absent means slot 1 for every stroke — the uniform-dash case.
    dashSlot[i] = source.dashSlot ? source.dashSlot[s]! : 1;
    dashPhase[i] = piece.phase;
  });
  return {
    a,
    b,
    color,
    widthMul,
    count,
    dashSlot,
    dashPhase,
    ...(source.dashPatterns ? { dashPatterns: source.dashPatterns } : {}),
  };
}

/**
 * The point layer without the marks on a flap: a dot left at a vertex's
 * resting place under a lifted flap gives the fold away, and the point
 * program has no depth to lift it with.
 */
export function dropPointsOnFlaps(points: PointGeometry, flaps: readonly Flap[]): PointGeometry {
  const keep: number[] = [];
  for (let i = 0; i < points.count; i += 1) {
    const p = { x: points.center[i * 2]!, y: points.center[i * 2 + 1]! };
    const moves = flaps.some((flap) => flap.whole || sideOf(flap.chord, p) === flap.side);
    if (!moves) keep.push(i);
  }
  if (keep.length === points.count) return points;
  const count = keep.length;
  const out: PointGeometry = {
    center: new Float32Array(count * 2),
    radius: new Float32Array(count),
    screenSpace: new Float32Array(count),
    fill: new Float32Array(count * 4),
    stroke: new Float32Array(count * 4),
    count,
  };
  keep.forEach((s, i) => {
    out.center[i * 2] = points.center[s * 2]!;
    out.center[i * 2 + 1] = points.center[s * 2 + 1]!;
    out.radius[i] = points.radius[s]!;
    out.screenSpace[i] = points.screenSpace[s]!;
    for (let k = 0; k < 4; k += 1) {
      out.fill[i * 4 + k] = points.fill[s * 4 + k]!;
      out.stroke[i * 4 + k] = points.stroke[s * 4 + k]!;
    }
  });
  return out;
}
