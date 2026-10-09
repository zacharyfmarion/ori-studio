/**
 * How much of their insides two faces of a flat fold share (Revision 3,
 * 18.0 results, 2): what "over" asks when an x-ray takes a flap away.
 *
 * 15e's test (`behindFlaps.ts`, `overlaps`) takes two faces as overlapping
 * where their sides cross through each other. Two faces that meet along a
 * fold do not overlap, but their corners, rounded to the stored scene's step,
 * can cross there by a hair — about 1e-5 of the picture on Zach's heart, #16,
 * where a true overlap is 0.086 — and the test then counts one over the
 * other. So here "overlap" is a part shared that is wider than a tolerance:
 * its area over half its perimeter, its mean width.
 *
 * Faces are convex in almost every flat fold; a face that is not is cut into
 * triangles, and the parts shared by each pair of convex pieces summed. The
 * width so measured is never more than the true one — the cuts only add to
 * the perimeter — so a sliver along a fold stays under the tolerance, and a
 * true overlap, some hundreds of times wider, clears it.
 *
 * Pure: no DOM, no store. In whatever units the rings are in.
 */
import type { PicturePoint } from './annotationModel';

type Pt = PicturePoint;

/**
 * What "over" is read with (18.0 results, 2): a part shared wider than this
 * many picture units, about three of the stored scene's 0.01 px steps on the
 * crane, and a tenth of the narrowest true overlap 18.0 found.
 */
export const OVER_MIN_WIDTH = 1e-4;

/** Twice a ring's signed area: positive for one that turns counter-clockwise with y up. */
function twiceArea(ring: readonly Pt[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return twice;
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Whether a ring is convex: every turn one way, corners along a side allowed. */
export function isConvexRing(ring: readonly Pt[]): boolean {
  let sign = 0;
  const span = Math.max(...ring.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))), 1);
  const flat = 1e-12 * span * span;
  for (let i = 0; i < ring.length; i += 1) {
    const turn = cross(ring[i]!, ring[(i + 1) % ring.length]!, ring[(i + 2) % ring.length]!);
    if (Math.abs(turn) <= flat) continue;
    if (sign === 0) sign = Math.sign(turn);
    else if (Math.sign(turn) !== sign) return false;
  }
  return true;
}

/** Whether `p` is inside the triangle `a b c` turning `sign`'s way, its sides included. */
function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt, sign: number): boolean {
  return sign * cross(a, b, p) >= 0 && sign * cross(b, c, p) >= 0 && sign * cross(c, a, p) >= 0;
}

/**
 * A simple ring cut into triangles by its ears; a corner along a side is
 * dropped. What is left when no ear is found — a ring that crosses itself —
 * is given up rather than guessed at.
 */
export function triangulate(ring: readonly Pt[]): Pt[][] {
  const sign = Math.sign(twiceArea(ring)) || 1;
  const left = ring.map((_, index) => index);
  const out: Pt[][] = [];
  for (let guard = 0; left.length > 3 && guard < ring.length * ring.length; guard += 1) {
    let cut = false;
    for (let i = 0; i < left.length; i += 1) {
      const [p, q, r] = [ring[left[(i + left.length - 1) % left.length]!]!, ring[left[i]!]!, ring[left[(i + 1) % left.length]!]!];
      const turn = sign * cross(p, q, r);
      if (turn < 0) continue;
      if (turn === 0) {
        // A corner along a side: no ear, and nothing lost without it.
        left.splice(i, 1);
        cut = true;
        break;
      }
      const blocked = left.some((index) => {
        const point = ring[index]!;
        if (point === p || point === q || point === r) return false;
        return inTriangle(point, p, q, r, sign);
      });
      if (blocked) continue;
      out.push([p, q, r]);
      left.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (left.length === 3) out.push(left.map((index) => ring[index]!));
  return out;
}

/** A ring as convex pieces: itself when it is convex, else its triangles. */
export function convexPieces(ring: readonly Pt[]): readonly (readonly Pt[])[] {
  return isConvexRing(ring) ? [ring] : triangulate(ring);
}

/** `subject` clipped to the convex `clip` (Sutherland–Hodgman). */
function clipToConvex(subject: readonly Pt[], clip: readonly Pt[]): Pt[] {
  const orient = Math.sign(twiceArea(clip)) || 1;
  let out: Pt[] = subject.slice();
  for (let i = 0; i < clip.length && out.length > 0; i += 1) {
    const p = clip[i]!;
    const q = clip[(i + 1) % clip.length]!;
    const side = (point: Pt) => orient * cross(p, q, point);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j += 1) {
      const s = input[j]!;
      const e = input[(j + 1) % input.length]!;
      const [ss, se] = [side(s), side(e)];
      if (ss >= 0) out.push(s);
      if (ss >= 0 !== se >= 0) {
        const t = ss / (ss - se);
        out.push([s[0] + t * (e[0] - s[0]), s[1] + t * (e[1] - s[1])]);
      }
    }
  }
  return out;
}

function perimeter(ring: readonly Pt[]): number {
  let length = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return length;
}

/**
 * What two rings share, as convex pieces with an inside: each convex piece of
 * one clipped to each of the other's. None for rings that only meet along a
 * side or a corner.
 */
export function sharedPieces(a: readonly Pt[], b: readonly Pt[]): Pt[][] {
  return piecesShared(convexPieces(a), convexPieces(b));
}

/** {@link sharedPieces} of two rings already cut into convex pieces ({@link convexPieces}). */
export function piecesShared(a: readonly (readonly Pt[])[], b: readonly (readonly Pt[])[]): Pt[][] {
  const pieces: Pt[][] = [];
  for (const pa of a) {
    for (const pb of b) {
      const part = clipToConvex(pa, pb);
      if (part.length >= 3 && Math.abs(twiceArea(part)) > 0) pieces.push(part);
    }
  }
  return pieces;
}

/** Convex pieces clipped to the convex ring `clip`: the parts of them inside it. */
export function piecesWithin(pieces: readonly (readonly Pt[])[], clip: readonly Pt[]): Pt[][] {
  const within: Pt[][] = [];
  for (const piece of pieces) {
    const part = clipToConvex(piece, clip);
    if (part.length >= 3 && Math.abs(twiceArea(part)) > 0) within.push(part);
  }
  return within;
}

/** Convex pieces' area, and their mean width: their area over half their perimeter (see the module's note). */
export function piecesPart(pieces: readonly (readonly Pt[])[]): { area: number; width: number } {
  let area = 0;
  let around = 0;
  for (const piece of pieces) {
    area += Math.abs(twiceArea(piece)) / 2;
    around += perimeter(piece);
  }
  return { area, width: around > 0 ? (2 * area) / around : 0 };
}

/**
 * What two rings share: its area, and its mean width — its area over half
 * its perimeter, measured piece by piece where a ring is not convex (see the
 * module's note). Nothing for rings that only meet along a side or a corner.
 */
export function sharedPart(a: readonly Pt[], b: readonly Pt[]): { area: number; width: number } {
  return piecesPart(sharedPieces(a, b));
}

/** Whether two rings overlap by a part wider than `minWidth`: a box apart first, as the cheap answer. */
export function overlapsWider(
  a: { ring: readonly Pt[]; box: readonly [number, number, number, number] },
  b: { ring: readonly Pt[]; box: readonly [number, number, number, number] },
  minWidth: number = OVER_MIN_WIDTH
): boolean {
  const [aMinX, aMinY, aMaxX, aMaxY] = a.box;
  const [bMinX, bMinY, bMaxX, bMaxY] = b.box;
  if (aMinX >= bMaxX || bMinX >= aMaxX || aMinY >= bMaxY || bMinY >= aMaxY) return false;
  return sharedPart(a.ring, b.ring).width > minWidth;
}
