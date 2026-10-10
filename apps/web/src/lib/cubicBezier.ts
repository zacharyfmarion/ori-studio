/**
 * Cubic Bézier curves, and paths of them, as plain arithmetic: where a curve
 * is and which way it runs, a piece of it, how long it is, the point on it
 * nearest a press, and the straight runs it can be drawn as.
 *
 * In whatever units the points are in — a picture's, a drawing's — and
 * either handedness: nothing here asks which way is up. A path is a list of
 * cubics, each starting where the one before it ends.
 *
 * Pure: no DOM.
 */

export type Vec2 = readonly [number, number];

/** A cubic's four control points: its start, its two handles, its end. */
export type Cubic = readonly [Vec2, Vec2, Vec2, Vec2];

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const minus = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const norm = (v: Vec2) => Math.hypot(v[0], v[1]);

/** The point at parameter `t`. */
export function cubicPoint([p0, p1, p2, p3]: Cubic, t: number): Vec2 {
  const s = 1 - t;
  const a = s * s * s;
  const b = 3 * s * s * t;
  const c = 3 * s * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/**
 * The box the curve itself lies in — its ends, and where it turns back along
 * either axis — not its handles', which may stand well off it.
 */
export function cubicBounds(cubic: Cubic): { minX: number; minY: number; maxX: number; maxY: number } {
  const ts = [0, 1];
  for (const axis of [0, 1] as const) {
    // Where the velocity along the axis is nothing: a quadratic in t.
    const [p0, p1, p2, p3] = cubic.map((point) => point[axis]) as [number, number, number, number];
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) ts.push(-c / b);
    } else {
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        ts.push((-b + root) / (2 * a), (-b - root) / (2 * a));
      }
    }
  }
  const points = ts.filter((t) => t >= 0 && t <= 1).map((t) => cubicPoint(cubic, t));
  return {
    minX: Math.min(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxX: Math.max(...points.map(([x]) => x)),
    maxY: Math.max(...points.map(([, y]) => y)),
  };
}

/** The velocity at parameter `t`: which way, and how fast, the curve runs there. */
export function cubicDerivative([p0, p1, p2, p3]: Cubic, t: number): Vec2 {
  const s = 1 - t;
  const a = 3 * s * s;
  const b = 6 * s * t;
  const c = 3 * t * t;
  return [
    a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]),
    a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1]),
  ];
}

/**
 * The direction of travel at `t`, unit length, or null for a curve that is a
 * point. Where the velocity vanishes — a handle drawn back onto its node —
 * the direction is the limit it tends to, which is the next control point
 * that is not on the node.
 */
export function cubicTangent(cubic: Cubic, t: number): Vec2 | null {
  const [p0, p1, p2, p3] = cubic;
  const velocity = cubicDerivative(cubic, t);
  const scale = Math.max(norm(minus(p3, p0)), norm(minus(p1, p0)), norm(minus(p2, p3)));
  const unit = (v: Vec2) => {
    const length = norm(v);
    return length > 1e-12 * Math.max(scale, 1e-300) ? ([v[0] / length, v[1] / length] as Vec2) : null;
  };
  const direct = unit(velocity);
  if (direct) return direct;
  const fallbacks: Vec2[] =
    t < 0.5 ? [minus(p2, p0), minus(p3, p0), minus(p3, p1)] : [minus(p3, p1), minus(p3, p0), minus(p2, p0)];
  for (const v of fallbacks) {
    const direction = unit(v);
    if (direction) return direction;
  }
  return null;
}

/** The curve cut at `t` into the piece before and the piece after, each a cubic of its own (de Casteljau). */
export function splitCubic([p0, p1, p2, p3]: Cubic, t: number): [Cubic, Cubic] {
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const f = lerp(d, e, t);
  return [
    [p0, a, d, f],
    [f, e, c, p3],
  ];
}

/** The piece of a curve between parameters `t0` and `t1`, as a cubic of its own. */
export function subCubic(cubic: Cubic, t0: number, t1: number): Cubic {
  if (t0 <= 0 && t1 >= 1) return cubic;
  if (!(t1 > t0)) {
    const at = cubicPoint(cubic, Math.min(1, Math.max(0, t0)));
    return [at, at, at, at];
  }
  const [before] = t1 >= 1 ? [cubic] : splitCubic(cubic, t1);
  if (t0 <= 0) return before;
  return splitCubic(before, Math.min(1, t0 / t1))[1];
}

/** How many straight runs each segment is measured along: far under a pen's width on any arrow a page draws. */
const MEASURE_STEPS = 64;

/**
 * A path measured along its length: what a stroke is trimmed by and a head
 * placed at, since a cubic's parameter does not run evenly along it.
 */
export interface PathMeasure {
  path: readonly Cubic[];
  length: number;
  /** Where each segment starts, along the path. */
  starts: readonly number[];
  /** Per segment, how far along it each of its `MEASURE_STEPS + 1` evenly spaced parameters lies. */
  table: readonly Float64Array[];
}

export function measurePath(path: readonly Cubic[]): PathMeasure {
  const starts: number[] = [];
  const table: Float64Array[] = [];
  let length = 0;
  for (const cubic of path) {
    starts.push(length);
    const along = new Float64Array(MEASURE_STEPS + 1);
    let last = cubic[0];
    for (let step = 1; step <= MEASURE_STEPS; step += 1) {
      const next = cubicPoint(cubic, step / MEASURE_STEPS);
      along[step] = along[step - 1]! + norm(minus(next, last));
      last = next;
    }
    table.push(along);
    length += along[MEASURE_STEPS]!;
  }
  return { path, length, starts, table };
}

/** Which segment, and where on it, lies `distance` along the path: clamped to its ends. */
export function pathLocationAt(measure: PathMeasure, distance: number): { segment: number; t: number } {
  const { path, starts, table } = measure;
  if (path.length === 0) return { segment: 0, t: 0 };
  const s = Math.min(measure.length, Math.max(0, distance));
  let segment = path.length - 1;
  while (segment > 0 && starts[segment]! > s) segment -= 1;
  const along = table[segment]!;
  const local = s - starts[segment]!;
  const total = along[MEASURE_STEPS]!;
  if (local >= total) return { segment, t: 1 };
  let low = 0;
  let high = MEASURE_STEPS;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (along[middle]! <= local) low = middle;
    else high = middle;
  }
  const span = along[high]! - along[low]!;
  const fraction = span > 0 ? (local - along[low]!) / span : 0;
  return { segment, t: (low + fraction) / MEASURE_STEPS };
}

/** The point `distance` along the path. */
export function pathPointAt(measure: PathMeasure, distance: number): Vec2 {
  const { segment, t } = pathLocationAt(measure, distance);
  return cubicPoint(measure.path[segment]!, t);
}

/**
 * The direction of travel `distance` along the path, or null where it has
 * none. A segment of no length — a node stacked on its neighbour — has none
 * of its own, so it takes the path's where the path goes on from it, or, at
 * the path's end, where it came from.
 */
export function pathTangentAt(measure: PathMeasure, distance: number): Vec2 | null {
  const { segment, t } = pathLocationAt(measure, distance);
  const own = cubicTangent(measure.path[segment]!, t);
  if (own) return own;
  for (let next = segment + 1; next < measure.path.length; next += 1) {
    const ahead = cubicTangent(measure.path[next]!, 0);
    if (ahead) return ahead;
  }
  for (let back = segment - 1; back >= 0; back -= 1) {
    const behind = cubicTangent(measure.path[back]!, 1);
    if (behind) return behind;
  }
  return null;
}

/** The stretch of a path between two distances along it, as a path of its own: empty when there is none. */
export function trimPath(measure: PathMeasure, from: number, to: number): Cubic[] {
  if (!(to > from)) return [];
  const start = pathLocationAt(measure, from);
  const end = pathLocationAt(measure, to);
  const out: Cubic[] = [];
  for (let segment = start.segment; segment <= end.segment; segment += 1) {
    const t0 = segment === start.segment ? start.t : 0;
    const t1 = segment === end.segment ? end.t : 1;
    // A piece of no length where a cut lands on a node.
    if (t1 - t0 <= 1e-12) continue;
    out.push(subCubic(measure.path[segment]!, t0, t1));
  }
  return out;
}

/** How far a control point may stand off its chord and the curve still be drawn as the chord. */
function flatEnough([p0, p1, p2, p3]: Cubic, tolerance: number): boolean {
  const chord = minus(p3, p0);
  const length = norm(chord);
  const off = (p: Vec2) =>
    length > 1e-12 ? Math.abs((p[0] - p0[0]) * chord[1] - (p[1] - p0[1]) * chord[0]) / length : norm(minus(p, p0));
  return off(p1) <= tolerance && off(p2) <= tolerance;
}

/**
 * The curve as straight runs, from its start to its end: cut in half until
 * each piece's handles stand within `tolerance` of its chord — so the runs
 * stay within it of the curve — and no run is longer than `longest`.
 */
export function flattenCubic(cubic: Cubic, tolerance: number, longest = Infinity): Vec2[] {
  const points: Vec2[] = [cubic[0]];
  const visit = (piece: Cubic, depth: number) => {
    if (depth >= 18 || (flatEnough(piece, tolerance) && norm(minus(piece[3], piece[0])) <= longest)) {
      points.push(piece[3]);
      return;
    }
    const [before, after] = splitCubic(piece, 0.5);
    visit(before, depth + 1);
    visit(after, depth + 1);
  };
  visit(cubic, 0);
  return points;
}

/** A whole path as straight runs ({@link flattenCubic}), each node once. */
export function flattenPath(path: readonly Cubic[], tolerance: number, longest = Infinity): Vec2[] {
  const points: Vec2[] = [];
  path.forEach((cubic, index) => {
    const runs = flattenCubic(cubic, tolerance, longest);
    points.push(...(index === 0 ? runs : runs.slice(1)));
  });
  return points;
}

/** The point of a path nearest `point`: which segment, where on it, and how far off. */
export function nearestOnPath(
  path: readonly Cubic[],
  point: Vec2
): { segment: number; t: number; at: Vec2; distance: number } | null {
  const samples = 32;
  const distance = (at: Vec2) => norm(minus(point, at));
  let best: { segment: number; t: number; at: Vec2; distance: number } | null = null;
  // Each segment's nearest sample, narrowed by thirds within a sample either
  // side of it: every segment's, since the nearest point may lie just past a
  // node that is itself the nearest sample.
  path.forEach((cubic, segment) => {
    let nearest = 0;
    let least = Infinity;
    for (let step = 0; step <= samples; step += 1) {
      const d = distance(cubicPoint(cubic, step / samples));
      if (d < least) {
        least = d;
        nearest = step / samples;
      }
    }
    let low = Math.max(0, nearest - 1 / samples);
    let high = Math.min(1, nearest + 1 / samples);
    for (let round = 0; round < 40; round += 1) {
      const a = low + (high - low) / 3;
      const b = high - (high - low) / 3;
      if (distance(cubicPoint(cubic, a)) <= distance(cubicPoint(cubic, b))) high = b;
      else low = a;
    }
    const narrowed = (low + high) / 2;
    const t = distance(cubicPoint(cubic, narrowed)) < least ? narrowed : nearest;
    const at = cubicPoint(cubic, t);
    const d = distance(at);
    if (!best || d < best.distance) best = { segment, t, at, distance: d };
  });
  return best;
}

/**
 * Twice the signed area between a path and its chord, closed back from its
 * end to its start, by the shoelace over its runs. Negative when the path
 * lies on the side its travel's `(−y, x)` points to — the left, in a frame
 * whose y is up — positive on the other: which side of its chord a path
 * bulges to, in either handedness.
 */
export function pathChordArea(points: readonly Vec2[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return twice;
}

/**
 * Which side of its chord a path of `length` lies on, as the sign of
 * {@link pathChordArea}: measured from its first point, so the answer does not
 * drift with where the path is drawn or at what scale, and 0 for a path that
 * lies on neither — an area under a billionth of its length squared is the
 * rounding of a straight path, and two surfaces drawing one arrow must not
 * read opposite sides from it.
 */
export function chordSide(points: readonly Vec2[], length: number): -1 | 0 | 1 {
  const first = points[0];
  if (!first || points.length < 3) return 0;
  let twice = 0;
  for (let i = 1; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    twice += (a[0] - first[0]) * (b[1] - first[1]) - (b[0] - first[0]) * (a[1] - first[1]);
  }
  if (!(Math.abs(twice) > 1e-9 * length * length)) return 0;
  return twice < 0 ? -1 : 1;
}

/**
 * The cubic from the first of `points` to the last that best follows the
 * points between (least squares, Schneider's method): its handles along
 * `startTangent` and `endTangent` — unit directions pointing into the curve
 * from each end — their lengths fitted to the points at their chord-length
 * parameters, which Newton steps then move to the curve's nearest, ten times over. A
 * handle that would come out non-positive, or a fit with too few points,
 * takes a third of the chord, as a straight-ish run would.
 */
export function fitCubic(points: readonly Vec2[], startTangent: Vec2, endTangent: Vec2): Cubic {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const chord = norm(minus(last, first));
  const fallback = (): Cubic => [
    first,
    [first[0] + startTangent[0] * chord / 3, first[1] + startTangent[1] * chord / 3],
    [last[0] + endTangent[0] * chord / 3, last[1] + endTangent[1] * chord / 3],
    last,
  ];
  if (points.length < 3 || !(chord > 0)) return fallback();
  // Chord-length parameters.
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1]! + norm(minus(points[i]!, points[i - 1]!)));
  const total = lengths[lengths.length - 1]!;
  if (!(total > 0)) return fallback();
  let u = lengths.map((length) => length / total);
  let cubic = fallback();
  for (let pass = 0; pass < 10; pass += 1) {
    let c00 = 0;
    let c01 = 0;
    let c11 = 0;
    let x0 = 0;
    let x1 = 0;
    points.forEach((point, i) => {
      const t = u[i]!;
      const s = 1 - t;
      const b0 = s * s * s;
      const b1 = 3 * s * s * t;
      const b2 = 3 * s * t * t;
      const b3 = t * t * t;
      const a1: Vec2 = [startTangent[0] * b1, startTangent[1] * b1];
      const a2: Vec2 = [endTangent[0] * b2, endTangent[1] * b2];
      c00 += a1[0] * a1[0] + a1[1] * a1[1];
      c01 += a1[0] * a2[0] + a1[1] * a2[1];
      c11 += a2[0] * a2[0] + a2[1] * a2[1];
      const rest: Vec2 = [
        point[0] - (first[0] * (b0 + b1) + last[0] * (b2 + b3)),
        point[1] - (first[1] * (b0 + b1) + last[1] * (b2 + b3)),
      ];
      x0 += a1[0] * rest[0] + a1[1] * rest[1];
      x1 += a2[0] * rest[0] + a2[1] * rest[1];
    });
    const det = c00 * c11 - c01 * c01;
    let alpha1 = Math.abs(det) > 1e-12 ? (x0 * c11 - x1 * c01) / det : 0;
    let alpha2 = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : 0;
    const floor = chord * 1e-6;
    if (!(alpha1 > floor) || !(alpha2 > floor)) alpha1 = alpha2 = chord / 3;
    cubic = [
      first,
      [first[0] + startTangent[0] * alpha1, first[1] + startTangent[1] * alpha1],
      [last[0] + endTangent[0] * alpha2, last[1] + endTangent[1] * alpha2],
      last,
    ];
    // Each parameter moved to where the curve passes nearest its point (one Newton step).
    u = u.map((t, i) => newtonParameter(cubic, points[i]!, t));
  }
  return cubic;
}

/** One Newton step toward the parameter whose point on `cubic` is nearest `point`, kept in [0, 1]. */
function newtonParameter(cubic: Cubic, point: Vec2, t: number): number {
  const [p0, p1, p2, p3] = cubic;
  const at = cubicPoint(cubic, t);
  const d1 = cubicDerivative(cubic, t);
  // The second derivative.
  const s = 1 - t;
  const d2: Vec2 = [
    6 * s * (p2[0] - 2 * p1[0] + p0[0]) + 6 * t * (p3[0] - 2 * p2[0] + p1[0]),
    6 * s * (p2[1] - 2 * p1[1] + p0[1]) + 6 * t * (p3[1] - 2 * p2[1] + p1[1]),
  ];
  const diff = minus(at, point);
  const numerator = diff[0] * d1[0] + diff[1] * d1[1];
  const denominator = d1[0] * d1[0] + d1[1] * d1[1] + diff[0] * d2[0] + diff[1] * d2[1];
  if (!(Math.abs(denominator) > 1e-12)) return t;
  return Math.max(0, Math.min(1, t - numerator / denominator));
}
