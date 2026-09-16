/**
 * The paper of a flap in space: not a rigid plate on a hinge, but a sheet
 * that curls over and lands hovering a little above the paper, going sharp
 * only where the step presses it.
 *
 * In the fold's own frame — `s` along the line, `u` into the flap, `z`
 * toward the reader — the flap at swing angle `θ` and press `p` is a rounded
 * bend of radius `r(s)` followed by a flat plane at angle `θ`:
 *
 *     r(s) = R · (1 − p · c(s))              bend radius along the line
 *     L(s) = r(s) · θ                        how far into the flap the bend reaches
 *     u ≤ L:  ( s, r·sin(u/r) + u·cosθ,           r·(1 − cos(u/r)) + u·sinθ )
 *     u > L:  ( s, r·sinθ + u·cosθ,               r·(1 − cosθ) + u·sinθ )
 *
 * The flat part is the **rigid hinge's own position** lifted off the paper
 * by the bend's height — a point of the flap lands exactly where a sharp
 * fold would put it, and hovers `2R` above that at `θ = π`. That is a
 * deliberate stretching of the truth (Zach, 2026-09-16): real paper cannot
 * stretch, so a bend of radius `r` would spend `πr` of material and land the
 * flap that much short of the mirror — and then a mark the step brings onto
 * a line stops short of the line, which is the one thing the picture must
 * not say. So the material is stretched inside the bend instead: the arc is
 * sheared along the flap's direction by `u`, which leaves the hinge
 * continuous and the flat part exact, and the rounding shows only as the
 * bend's shading and the hover's shadow.
 *
 * `c(s)` is the creasedness: 1 on the stretches the step creases, 0 elsewhere,
 * with an eased ramp between so the surface has no seam. Pressing takes the
 * radius to zero only there, so the flap drops flat onto the paper along a
 * full crease and by a pinch's width at a pinch, and stays lifted elsewhere.
 * At `r = 0` this is the rigid hinge exactly.
 *
 * The surface is exactly linear in `u` past the bend and, over a ramp, linear
 * in `s` too — which is what lets the mesh be coarse everywhere but the bend
 * and the ramp edges, and a crease on the flap be cut only where it crosses
 * them.
 */
/** A point of the flap once posed: its chord-frame coordinates, its height, and which face is up. */
export interface PlacedPoint {
  s: number;
  v: number;
  z: number;
  /** The surface normal's component toward the reader: positive, the reader's face shows. */
  nz: number;
}

/** How a flap's paper is placed at a pose: the map from its flat `(s, u)` to space. */
export interface FoldPlacement {
  place(s: number, u: number): PlacedPoint;
}

/** A hinge with no bend: the flap turns rigidly about the line. The surface at radius zero. */
export function rigidHinge(angle: number): FoldPlacement {
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  return { place: (s, u) => ({ s, v: u * c, z: u * sn, nz: c }) };
}

export interface FoldSurfaceParams {
  /** Bend radius at rest, model units. Zero is a rigid hinge. */
  radius: number;
  /** The swing, radians. */
  angle: number;
  /** How far the creased stretches are pressed sharp, 0 to 1. */
  press: number;
  /** Stretches of the line the step presses, as `[from, to]` along it. */
  creased: readonly (readonly [number, number])[];
  /** How far past a creased stretch the paper takes to reach its full curl. */
  ramp: number;
}

export interface FoldSurface extends FoldPlacement {
  /** Where along the line the bend radius stops being constant. */
  breakpoints(): number[];
  /** How far into the flap the bend can reach, over the whole swing. */
  bendReach: number;
}

/**
 * A share of the sheet's short side: the curl's radius at rest. The flat part
 * hovers at twice this and lands π times it short of the mirror, so it is
 * kept small: the hover is a hair, and what shows is the shortfall.
 */
export const BEND_RADIUS_SHARE = 0.0075;
/**
 * A share of the sheet's short side: how far past a creased stretch the paper
 * takes to reach its full curl. Long against the shortfall it has to carry,
 * so the flap's edge bends where the crease ends rather than jogging.
 */
export const CREASE_RAMP_SHARE = 0.08;
/** Rows through the bend, which is the one curved part. */
export const BEND_ROWS = 12;
/** Columns along the line, as a share of the sheet's short side. */
export const COLUMN_SHARE = 1 / 48;

/**
 * How creased the line is at `s`: 1 on a stretch, 0 away from all, and an
 * S-curve between, so the paper leaves a crease with no kink at either end.
 */
export function creasedness(
  creased: readonly (readonly [number, number])[],
  ramp: number,
  s: number
): number {
  let best = 0;
  for (const [from, to] of creased) {
    if (s >= from && s <= to) return 1;
    const gap = s < from ? from - s : s - to;
    if (ramp > 0 && gap < ramp) {
      const t = gap / ramp;
      best = Math.max(best, 1 - t * t * (3 - 2 * t));
    }
  }
  return best;
}

export function createFoldSurface(params: FoldSurfaceParams): FoldSurface {
  const { radius, angle, press, creased, ramp } = params;
  const sinT = Math.sin(angle);
  const cosT = Math.cos(angle);
  const radiusAt = (s: number): number =>
    radius <= 0 ? 0 : radius * (1 - press * creasedness(creased, ramp, s));
  return {
    bendReach: radius * Math.PI,
    place(s, u) {
      const r = radiusAt(s);
      const bend = r * angle;
      if (r > 0 && u > 0 && u <= bend) {
        const phi = u / r;
        // The sheared arc's tangent is the sum of the arc's and the flat
        // part's directions, which bisects them: its normal is at the mean
        // of the two angles, with no degenerate case at the hinge.
        return {
          s,
          v: r * Math.sin(phi) + u * cosT,
          z: r * (1 - Math.cos(phi)) + u * sinT,
          nz: Math.cos((phi + angle) / 2),
        };
      }
      const past = Math.max(0, u);
      return {
        s,
        v: r * sinT + past * cosT,
        z: r * (1 - cosT) + past * sinT,
        nz: cosT,
      };
    },
    breakpoints() {
      if (radius <= 0 || press <= 0) return [];
      const out: number[] = [];
      for (const [from, to] of creased) out.push(from - ramp, from, to, to + ramp);
      return out;
    },
  };
}

/**
 * The whole sheet turning over about a line through it: a rigid turn of
 * `angle` about the line, lifted so the low side never passes through the
 * table. `halfWidth` is how far the sheet reaches from the line on its far
 * side. At `π` the sheet lies flat again, mirrored — the picture the next
 * card starts from.
 */
export function createTurnOverSurface(angle: number, halfWidth: number): FoldSurface {
  const sinT = Math.sin(angle);
  const cosT = Math.cos(angle);
  const lift = Math.max(0, halfWidth) * Math.abs(sinT);
  return {
    bendReach: 0,
    place: (s, u) => ({ s, v: u * cosT, z: u * sinT + lift, nz: cosT }),
    breakpoints: () => [],
  };
}

/** A point in the fold's frame, before placement. */
export interface FlatPoint {
  s: number;
  u: number;
}

const EPSILON = 1e-9;

/** The part of a convex polygon on the inside of an edge, in the fold's frame. */
function clipAgainstEdge(
  polygon: readonly FlatPoint[],
  inside: (p: FlatPoint) => number
): FlatPoint[] {
  const out: FlatPoint[] = [];
  // A corner sitting on the clipping edge is kept and then met again as the
  // crossing; a polygon with a repeated point fans into an empty triangle.
  const push = (point: FlatPoint) => {
    const last = out[out.length - 1];
    if (last && Math.abs(last.s - point.s) <= EPSILON && Math.abs(last.u - point.u) <= EPSILON) {
      return;
    }
    out.push(point);
  };
  for (let i = 0; i < polygon.length; i += 1) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    const dp = inside(p);
    const dq = inside(q);
    if (dp >= -EPSILON) push(p);
    if ((dp >= -EPSILON) !== (dq >= -EPSILON)) {
      const t = dp / (dp - dq);
      push({ s: p.s + (q.s - p.s) * t, u: p.u + (q.u - p.u) * t });
    }
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (
    out.length > 1 &&
    first &&
    last &&
    Math.abs(last.s - first.s) <= EPSILON &&
    Math.abs(last.u - first.u) <= EPSILON
  ) {
    out.pop();
  }
  return out;
}

/** Sutherland–Hodgman: a convex `cell` clipped to a convex `polygon`, either winding. */
export function clipCellToPolygon(
  cell: readonly FlatPoint[],
  polygon: readonly FlatPoint[]
): FlatPoint[] {
  if (polygon.length < 3) return [];
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    area += p.s * q.u - q.s * p.u;
  }
  const winding = area >= 0 ? 1 : -1;
  let out: FlatPoint[] = [...cell];
  for (let i = 0; i < polygon.length && out.length > 0; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    out = clipAgainstEdge(
      out,
      (p) => winding * ((b.s - a.s) * (p.u - a.u) - (b.u - a.u) * (p.s - a.s))
    );
  }
  return out;
}

/** Sorted, de-duplicated sample positions within `[lo, hi]`. */
function samples(lo: number, hi: number, spacing: number, extra: readonly number[]): number[] {
  if (hi <= lo) return [lo];
  const count = Math.max(1, Math.ceil((hi - lo) / spacing));
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) out.push(lo + ((hi - lo) * i) / count);
  for (const value of extra) if (value > lo && value < hi) out.push(value);
  out.sort((p, q) => p - q);
  const merged: number[] = [];
  for (const value of out) {
    if (merged.length === 0 || value - merged[merged.length - 1]! > EPSILON) merged.push(value);
  }
  return merged;
}

/** Rows into the flap: dense through the bend, then one to the far edge. */
export function bendRows(surface: FoldSurface, reach: number, rows = BEND_ROWS): number[] {
  const out = [0];
  const bend = Math.min(surface.bendReach, reach);
  for (let j = 1; j <= rows; j += 1) {
    const u = (bend * j) / rows;
    if (u > out[out.length - 1]! + EPSILON) out.push(u);
  }
  if (reach > out[out.length - 1]! + EPSILON) out.push(reach);
  return out;
}

export interface FlapMesh {
  /** Placed vertices, three per triangle. */
  vertices: PlacedPoint[];
}

/**
 * The flap as triangles on the surface: a grid of columns along the line and
 * rows into the flap, each cell clipped to the flap's outline and fanned.
 * Columns break at the surface's own breakpoints, rows through the bend, so
 * the only curvature the mesh has to follow is sampled where it is.
 */
export function tessellateFlap(
  polygon: readonly FlatPoint[],
  surface: FoldSurface,
  columnSpacing: number,
  rows = BEND_ROWS
): FlapMesh {
  const vertices: PlacedPoint[] = [];
  if (polygon.length < 3) return { vertices };
  let sMin = Infinity;
  let sMax = -Infinity;
  let uMin = 0;
  let uMax = 0;
  for (const p of polygon) {
    sMin = Math.min(sMin, p.s);
    sMax = Math.max(sMax, p.s);
    uMin = Math.min(uMin, p.u);
    uMax = Math.max(uMax, p.u);
  }
  const columns = samples(sMin, sMax, columnSpacing, surface.breakpoints());
  // A flap lies on one side of its line; a sheet turning over lies on both,
  // and the other side is one more row, since nothing bends there.
  const uRows = [...(uMin < -EPSILON ? [uMin] : []), ...bendRows(surface, uMax, rows)];
  for (let i = 0; i + 1 < columns.length; i += 1) {
    for (let j = 0; j + 1 < uRows.length; j += 1) {
      const cell: FlatPoint[] = [
        { s: columns[i]!, u: uRows[j]! },
        { s: columns[i + 1]!, u: uRows[j]! },
        { s: columns[i + 1]!, u: uRows[j + 1]! },
        { s: columns[i]!, u: uRows[j + 1]! },
      ];
      const piece = clipCellToPolygon(cell, polygon);
      if (piece.length < 3) continue;
      const placed = piece.map((p) => surface.place(p.s, p.u));
      for (let k = 1; k + 1 < placed.length; k += 1) {
        vertices.push(placed[0]!, placed[k]!, placed[k + 1]!);
      }
    }
  }
  return { vertices };
}

/**
 * Where a straight line on the flap has to be cut to follow the surface: at
 * every crossing of a breakpoint column and, through the bend, of a row.
 * Elsewhere the surface is linear along it, so the piece between two cuts is
 * drawn straight. The parameters returned are ascending, from 0 to 1.
 */
export function strokeCuts(
  from: FlatPoint,
  to: FlatPoint,
  surface: FoldSurface,
  reach: number,
  rows = BEND_ROWS
): number[] {
  const cuts = new Set<number>([0, 1]);
  const ds = to.s - from.s;
  const du = to.u - from.u;
  const add = (t: number) => {
    if (t > EPSILON && t < 1 - EPSILON) cuts.add(t);
  };
  if (Math.abs(ds) > EPSILON) {
    for (const s of surface.breakpoints()) add((s - from.s) / ds);
  }
  if (Math.abs(du) > EPSILON) {
    const bend = Math.min(surface.bendReach, reach);
    const lo = Math.min(from.u, to.u);
    const hi = Math.max(from.u, to.u);
    if (lo < bend) {
      for (const u of bendRows(surface, Math.min(hi, bend), rows)) add((u - from.u) / du);
    }
  }
  return [...cuts].sort((p, q) => p - q);
}

