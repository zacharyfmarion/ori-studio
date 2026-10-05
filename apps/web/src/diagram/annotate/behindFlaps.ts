/**
 * Where a mark lies behind a flap (15e of the second Annotate plan). The
 * author says, of each end of a mark, whether it is behind, and how many of
 * the layers at that end lie over it; from that end the mark is dotted until
 * it first comes out from under them, and drawn as ever after — so a crimp
 * arrow that starts under a flap and crosses the paper again in front reads
 * right (decision 1).
 *
 * The layers over an end are the top `n` faces at it as the picture paints
 * them, and every face over those: painted after one of them and overlapping
 * it, and so on up. A flat fold is the one picture that knows its layers
 * (`PictureGeometry.layers`): its faces are whole, cut only at folded creases
 * and painted back to front, so "over" is "painted after, where they
 * overlap". Inside a woven patch the stored order is patched rather than
 * true, and "over" can be wrong there.
 *
 * Pure: no DOM, no store. In picture units.
 */
import type { PicturePoint } from './annotationModel';
import { PICTURE_POINT_EPSILON, type PictureCover, type PictureLayers } from './pictureGeometry';

/** A stretch of a mark behind a flap: where it starts and ends, as shares of the mark's length from its start. */
export type HiddenStretch = readonly [number, number];

/** How many layers lie over each end of a mark that is behind; an end not named is in front. */
export interface BehindEnds {
  from?: number;
  to?: number;
}

/**
 * How far along the mark an end is read: a hair, so an end snapped onto a
 * face's corner or edge is read in the face the mark goes into, as a right
 * angle's corner is read in the face it opens into.
 */
const HAIR = 4 * PICTURE_POINT_EPSILON;

/**
 * Whether `[x, y]` is under a face: inside it, and farther than a point's
 * tolerance from its rim — on a rim it is under neither face that meets
 * there — unless `rims` counts a point on its rim as on it too.
 */
function under({ ring, box: [minX, minY, maxX, maxY] }: PictureCover, [x, y]: PicturePoint, rims = false): boolean {
  const reach = rims ? PICTURE_POINT_EPSILON : 0;
  if (x <= minX - reach || x >= maxX + reach || y <= minY - reach || y >= maxY + reach) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (distanceToSegment([x, y], [xj, yj], [xi, yi]) <= PICTURE_POINT_EPSILON) return rims;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment([px, py]: PicturePoint, [ax, ay]: PicturePoint, [bx, by]: PicturePoint): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The faces at a point, the top first: those it is under — and, with `rims`, those it is on the rim of too. */
export function facesAt(layers: PictureLayers, at: PicturePoint, rims = false): PictureCover[] {
  return layers.covers.filter((cover) => under(cover, at, rims)).sort((a, b) => b.order - a.order);
}

/**
 * Where `a`→`b` crosses `c`→`d`: how far along each (0 to 1), ends included;
 * null for segments that miss or run along one another, whose overlap a
 * point between the crossings either side of it tells.
 */
function crossing(a: PicturePoint, b: PicturePoint, c: PicturePoint, d: PicturePoint): { t: number; u: number } | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-15) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

/** Strictly between its ends: a crossing there is through, not a meeting at a corner. */
const through = (t: number) => t > 1e-9 && t < 1 - 1e-9;

/** The middle of a ring's fan triangle from its first corner: a point inside a convex face, or tested where it is not. */
function insidePoints(cover: PictureCover): PicturePoint[] {
  const { ring } = cover;
  const points: PicturePoint[] = [];
  const [ox, oy] = ring[0]!;
  for (let i = 1; i + 1 < ring.length; i += 1) {
    const [bx, by] = ring[i]!;
    const [cx, cy] = ring[i + 1]!;
    points.push([(ox + bx + cx) / 3, (oy + by + cy) / 3]);
  }
  // Each corner, a hair toward the middle: a face laid over another along a
  // shared side and an offset has no other point inside it.
  const mx = ring.reduce((sum, [x]) => sum + x, 0) / ring.length;
  const my = ring.reduce((sum, [, y]) => sum + y, 0) / ring.length;
  for (const [x, y] of ring) {
    const length = Math.hypot(mx - x, my - y);
    if (length > HAIR) points.push([x + ((mx - x) / length) * HAIR, y + ((my - y) / length) * HAIR]);
  }
  return points.filter((point) => under(cover, point));
}

/**
 * Whether two faces overlap: share some of their insides, not only a side or
 * a corner. Their sides cross through each other, or a point inside one is
 * inside the other — which a face laid exactly on another, as a flat fold
 * stacks them, says where no side crosses.
 */
function overlaps(a: PictureCover, b: PictureCover): boolean {
  const [aMinX, aMinY, aMaxX, aMaxY] = a.box;
  const [bMinX, bMinY, bMaxX, bMaxY] = b.box;
  if (aMinX >= bMaxX || bMinX >= aMaxX || aMinY >= bMaxY || bMinY >= aMaxY) return false;
  for (let i = 0; i < a.ring.length; i += 1) {
    const p = a.ring[i]!;
    const q = a.ring[(i + 1) % a.ring.length]!;
    for (let j = 0; j < b.ring.length; j += 1) {
      // Through each other, not meeting at a corner: the crossing is inside both.
      const met = crossing(p, q, b.ring[j]!, b.ring[(j + 1) % b.ring.length]!);
      if (met && through(met.t) && through(met.u)) return true;
    }
  }
  return insidePoints(a).some((point) => under(b, point)) || insidePoints(b).some((point) => under(a, point));
}

/** `faces`, and every face over them: painted after one of them and overlapping it, and every face over those. */
export function facesOver(layers: PictureLayers, faces: readonly PictureCover[]): PictureCover[] {
  const found = new Set<PictureCover>(faces);
  const waiting = [...faces];
  while (waiting.length > 0) {
    const face = waiting.pop()!;
    for (const cover of layers.covers) {
      if (cover.order <= face.order || found.has(cover) || !overlaps(face, cover)) continue;
      found.add(cover);
      waiting.push(cover);
    }
  }
  return [...found];
}

/**
 * The faces over a mark's end `deep` layers down: the top `deep` at it, read
 * a hair along the mark toward `toward`, and every face over them. None for
 * an end on no face: nothing is over it.
 */
export function facesOverEnd(layers: PictureLayers, end: PicturePoint, toward: PicturePoint, deep: number): PictureCover[] {
  const length = Math.hypot(toward[0] - end[0], toward[1] - end[1]);
  const at: PicturePoint =
    length > 0 ? [end[0] + ((toward[0] - end[0]) / length) * HAIR, end[1] + ((toward[1] - end[1]) / length) * HAIR] : end;
  return over(layers, facesAt(layers, at), deep);
}

/** The top `deep` of `faces` at a point, and every face over them. */
function over(layers: PictureLayers, faces: readonly PictureCover[], deep: number): PictureCover[] {
  const top = faces.slice(0, Math.max(0, Math.floor(deep)));
  return top.length > 0 ? facesOver(layers, top) : [];
}

/**
 * Where a run of lines is under any of `faces`, as runs of its length from
 * its start: each line cut where it crosses a face's side, and each piece
 * under or not by a point in its middle. Closed, for a ring, it runs on from
 * its last point to its first.
 */
function piecesUnder(
  line: readonly PicturePoint[],
  faces: readonly PictureCover[],
  closed = false
): { pieces: { start: number; end: number; under: boolean }[]; length: number } {
  const points = closed ? [...line, line[0]!] : line;
  const pieces: { start: number; end: number; under: boolean }[] = [];
  let walked = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(run > 0)) continue;
    const cuts = [0, 1];
    for (const { ring } of faces) {
      for (let j = 0; j < ring.length; j += 1) {
        const met = crossing(a, b, ring[j]!, ring[(j + 1) % ring.length]!);
        if (met) cuts.push(met.t);
      }
    }
    cuts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < cuts.length; k += 1) {
      const [t0, t1] = [cuts[k]!, cuts[k + 1]!];
      if (t1 - t0 < 1e-12) continue;
      const middle = (t0 + t1) / 2;
      const at: PicturePoint = [a[0] + (b[0] - a[0]) * middle, a[1] + (b[1] - a[1]) * middle];
      const covered = faces.some((face) => under(face, at));
      const start = walked + t0 * run;
      const end = walked + t1 * run;
      const last = pieces[pieces.length - 1];
      if (last && last.under === covered && Math.abs(last.end - start) < 1e-12) last.end = end;
      else pieces.push({ start, end, under: covered });
    }
    walked += run;
  }
  return { pieces, length: walked };
}

/**
 * How far from its start a run of lines lies under `faces`, as a share of
 * its length: up to where it first comes out from under them all. Nothing
 * when it starts out from under them.
 */
export function shareUnder(line: readonly PicturePoint[], faces: readonly PictureCover[]): number {
  if (faces.length === 0) return 0;
  const { pieces, length } = piecesUnder(line, faces);
  if (!(length > 0)) return 0;
  const out = pieces.find((piece) => !piece.under);
  return out ? out.start / length : 1;
}

/** Stretches that touch or overlap, one; in order. */
function merged(stretches: HiddenStretch[]): HiddenStretch[] {
  const sorted = [...stretches].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1] + 1e-12) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * A mark's stretches behind flaps, as shares of its length from its start
 * (`line`, its centreline from its `from` to its `to`): from each end that is
 * behind, to where it first comes out from under the layers over that end.
 * Both ends behind, two stretches, one where they meet.
 */
export function hiddenStretches(line: readonly PicturePoint[], behind: BehindEnds, layers: PictureLayers): HiddenStretch[] {
  if (line.length < 2) return [];
  const stretches: HiddenStretch[] = [];
  if (behind.from) {
    const share = shareUnder(line, facesOverEnd(layers, line[0]!, line[1]!, behind.from));
    if (share > 0) stretches.push([0, share]);
  }
  if (behind.to) {
    const back = [...line].reverse();
    const share = shareUnder(back, facesOverEnd(layers, back[0]!, back[1]!, behind.to));
    if (share > 0) stretches.push([1 - share, 1]);
  }
  return merged(stretches);
}

/** The sides a circle's ring is drawn with when it is worked out where it lies under a flap. */
const RING_SIDES = 96;

/**
 * A circle's arcs behind flaps (decision 1): where its ring, `radius` round
 * its centre, lies under the layers over its centre `deep` down — as shares
 * of the ring from its rightmost point, the way the page's y-down picture
 * turns clockwise. An arc across that point is two.
 */
export function hiddenArcs(centre: PicturePoint, radius: number, deep: number, layers: PictureLayers): HiddenStretch[] {
  // A circle is put on a point: its centre on the rims of the faces that meet there, it is on each of them.
  const faces = over(layers, facesAt(layers, centre, true), deep);
  if (faces.length === 0 || !(radius > 0)) return [];
  const ring = Array.from({ length: RING_SIDES }, (_, i): PicturePoint => {
    const angle = (2 * Math.PI * i) / RING_SIDES;
    return [centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)];
  });
  const { pieces, length } = piecesUnder(ring, faces, true);
  if (!(length > 0)) return [];
  return merged(pieces.filter((piece) => piece.under).map((piece) => [piece.start / length, piece.end / length]));
}
