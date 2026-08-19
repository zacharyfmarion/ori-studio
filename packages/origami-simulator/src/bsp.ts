// Binary space partitioning, for drawing a folded mesh in a correct back-to-front
// order without a depth buffer.
//
// A painter's sort asks "which triangle is in front?" and a folded model has
// configurations where the question has no answer: two faces that pass through
// each other need one drawn first over part of their overlap and second over the
// rest, and three faces can cycle (A over B over C over A) with no pair
// interpenetrating at all. Sorting cannot express either. The fix is to cut the
// geometry until an order does exist, which is what this does.
//
// The tree is built in view space, where the eye is a real point at
// `depth = camDist` and plane sidedness therefore means "nearer than" — so a
// traversal that visits the far child, then the node, then the near child emits
// exactly a valid painter's order.
//
// Correctness does not depend on which plane is chosen at each node; only the
// size of the result does. Choosing arbitrarily multiplied the polygon count by
// ~13x on a real model, where picking the least-splitting candidate out of a
// small sample gives ~2.4x. See `SPLITTER_SAMPLES`.

export type Vec3 = [number, number, number];

/**
 * A face or an edge to be ordered.
 *
 * `ref` indexes the caller's own array so attributes — colour, shading,
 * assignment — survive splitting: a piece is drawn with its parent's appearance,
 * which is also the correct one, since a cut piece is coplanar with its parent.
 */
export interface BspItem {
  /** 0 = face (3 points), 1 = edge (2 points). Faces precede edges when coplanar. */
  kind: 0 | 1;
  ref: number;
  points: Vec3[];
  /**
   * Draw order among items the tree finds coplanar, lowest first. Optional, and
   * treated as 0 when absent, so a caller that has no opinion gets exactly the
   * previous behaviour.
   *
   * The tree cannot supply this and must not be asked to. Every candidate
   * splitter is promoted to the head of its own coplanar list (`subdivide`), and
   * the candidate is sampled from the middle of the array, so a caller whose
   * coplanar items carry a meaning in their array order loses it: three coplanar
   * faces pushed as `a, b, c` among mutually-straddling neighbours come back
   * `b, a, c`. Where that order is a fact about the paper — the kernel's
   * `draw_rank` within one plane — it has to travel with the item.
   */
  order?: number;
}

interface Plane {
  n: Vec3;
  d: number;
}

interface BspNode {
  plane: Plane | null;
  /** Items lying in the splitting plane, faces first. */
  coplanar: BspItem[];
  front: BspNode | null;
  back: BspNode | null;
}

/**
 * Candidate planes scored at each node, picking the one that splits the fewest
 * others. Five is where the benefit flattens — twenty measured no better, and
 * scoring costs O(samples x items) per node.
 */
const SPLITTER_SAMPLES = 5;

/**
 * Depth at which the tree stops subdividing and keeps what is left in one node.
 *
 * A guard, not a tuning knob: recursion this deep means degenerate input, and
 * emitting slightly-misordered polygons is a better failure than exhausting the
 * stack.
 */
const MAX_DEPTH = 400;

/**
 * Distance below which a point counts as lying in the plane, unless a caller
 * says otherwise.
 *
 * Right for a simulator mesh, whose vertices are the solver's own output and
 * agree with each other to near machine precision. A caller whose coplanarity is
 * decided elsewhere — the 3D folded state clusters faces into planes in the
 * kernel, under its own tolerance — has to pass that tolerance in, or the two
 * disagree about which faces share a plane and the tree cuts a stack the kernel
 * already ordered. See {@link BuildBspOptions.coplanarEps}.
 */
const EPS = 1e-7;

export interface BuildBspOptions {
  /**
   * Half the width of the ink an edge is drawn with, in the units of the items'
   * first two axes. Zero, the default, orders edges as strictly as faces.
   *
   * An edge closer to a plane than the ink it is drawn with is not split by it,
   * and is kept on the eye's side of it: ink that thin cannot show which side of
   * the plane it is on, so cutting it there buys no correctness and costs a
   * piece. A crease grazes a great many planes at that distance — it lies *in*
   * the planes of both faces it separates, and near-parallel layers abound in a
   * folded model — and each graze used to cut it again. Measured on a real
   * model: 48 pieces under 2px shrank to none, pieces under 5px fell by three
   * quarters, and the document by a tenth, with the same crease length drawn.
   *
   * Keeping the piece on the near side is the smaller half of the rule, and it
   * only sometimes helps: a face drawn after a crease it merely touches paints
   * over part of the stroke, and the crease then reads as a thin line. Across
   * three views that stayed where it was, so treat this as the tie-break it is
   * rather than a fix for that.
   */
  edgeInk?: number;
  /** Which side of a plane is the near one. Defaults to the far side of `+depth`. */
  eye?: Vec3;
  /**
   * Distance below which a point counts as lying in a plane. Defaults to
   * {@link EPS}.
   *
   * A **distance**, in the units the items' points are in — not an angle. A
   * caller whose planes come from somewhere else derives it from that source's
   * own tolerances: for the 3D folded state that is
   * `distance_relative * span + angle_radians * radius`, the offset the kernel
   * allows plus the deviation a tilt of its angle tolerance induces across the
   * patch.
   */
  coplanarEps?: number;
}

const DEFAULT_EYE: Vec3 = [0, 0, Number.MAX_SAFE_INTEGER];

/**
 * How close an item must be to a plane to count as lying in it.
 *
 * For a face, exactly on it. For an edge, within its own ink — measured on
 * screen, which is why the plane's depth component is left out: dividing by the
 * normal's screen length converts a plane distance into the screen distance to
 * the plane's trace, and it is the trace that the ink can straddle.
 */
function toleranceFor(item: BspItem, plane: Plane, edgeInk: number, coplanarEps: number): number {
  if (item.kind !== 1 || edgeInk <= 0) return coplanarEps;
  return Math.max(coplanarEps, edgeInk * Math.hypot(plane.n[0], plane.n[1]));
}

/**
 * Whether an item that stays within tolerance of a plane is *ink straddling it*
 * rather than *lying in it*.
 *
 * Split out from the tolerance because the two used to be the same test: while
 * the only tolerance above {@link EPS} was an edge's ink, `eps > EPS` said both.
 * With a caller-supplied `coplanarEps` it no longer does, and reading a face's
 * coplanarity as ink would push every face of a stack out of the coplanar list
 * and into the children — the exact stack the caller passed a tolerance to keep
 * together.
 */
function straddlesAsInk(item: BspItem, edgeInk: number, eps: number, coplanarEps: number): boolean {
  return item.kind === 1 && edgeInk > 0 && eps > coplanarEps;
}

function planeOf(points: readonly Vec3[]): Plane | null {
  const [a, b, c] = points;
  if (!a || !b || !c) return null;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (!Number.isFinite(length) || length < EPS) return null;
  const n: Vec3 = [nx / length, ny / length, nz / length];
  return { n, d: -(n[0] * a[0] + n[1] * a[1] + n[2] * a[2]) };
}

function distance(plane: Plane, v: Vec3): number {
  return plane.n[0] * v[0] + plane.n[1] * v[1] + plane.n[2] * v[2] + plane.d;
}

function crossing(from: Vec3, to: Vec3, dFrom: number, dTo: number): Vec3 {
  const t = dFrom / (dFrom - dTo);
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/** Fan-triangulate a convex polygon; a cut triangle yields a triangle and a quad. */
function fan(points: Vec3[], kind: 0 | 1, ref: number, order: number | undefined): BspItem[] {
  if (kind === 1) {
    return points.length >= 2 ? [{ kind, ref, order, points: [points[0]!, points[1]!] }] : [];
  }
  const out: BspItem[] = [];
  for (let i = 1; i + 1 < points.length; i += 1) {
    out.push({ kind, ref, order, points: [points[0]!, points[i]!, points[i + 1]!] });
  }
  return out;
}

interface Partition {
  front: BspItem[];
  back: BspItem[];
  coplanar: BspItem[];
}

/** Cut one item by a plane. Faces split into polygons, edges into segments. */
function partition(
  item: BspItem,
  plane: Plane,
  eps: number,
  nearIsFront: boolean,
  inkStraddle: boolean,
): Partition {
  const dist = item.points.map((p) => distance(plane, p));
  const anyFront = dist.some((d) => d > eps);
  const anyBack = dist.some((d) => d < -eps);
  if (!anyFront && !anyBack) {
    // Within the tolerance the whole way, so there is nothing to cut. A face
    // there is genuinely in the plane and shares the node with it; an edge
    // there is ink straddling the plane, and belongs on the near side so the
    // surface it lies on is drawn under it rather than over it.
    if (inkStraddle) {
      return nearIsFront
        ? { front: [item], back: [], coplanar: [] }
        : { front: [], back: [item], coplanar: [] };
    }
    return { front: [], back: [], coplanar: [item] };
  }
  if (!anyBack) return { front: [item], back: [], coplanar: [] };
  if (!anyFront) return { front: [], back: [item], coplanar: [] };

  const front: Vec3[] = [];
  const back: Vec3[] = [];
  const count = item.points.length;
  // An edge is an open path; a face is a closed loop, so its last vertex also
  // connects back to the first.
  const steps = item.kind === 1 ? count - 1 : count;
  for (let i = 0; i < count; i += 1) {
    const current = item.points[i]!;
    const dCurrent = dist[i]!;
    if (dCurrent >= -eps) front.push(current);
    if (dCurrent <= eps) back.push(current);
    if (i >= steps) continue;
    const next = item.points[(i + 1) % count]!;
    const dNext = dist[(i + 1) % count]!;
    if ((dCurrent > eps && dNext < -eps) || (dCurrent < -eps && dNext > eps)) {
      const cut = crossing(current, next, dCurrent, dNext);
      front.push(cut);
      back.push(cut);
    }
  }
  return {
    front: fan(front, item.kind, item.ref, item.order),
    back: fan(back, item.kind, item.ref, item.order),
    coplanar: [],
  };
}

/** The candidate plane that cuts the fewest of the others. */
function chooseSplitter(
  items: readonly BspItem[],
  edgeInk: number,
  coplanarEps: number,
): { plane: Plane; index: number } | null {
  let best: { plane: Plane; index: number; cuts: number } | null = null;
  const faces: number[] = [];
  for (let i = 0; i < items.length; i += 1) if (items[i]!.kind === 0) faces.push(i);
  if (faces.length === 0) return null;
  const step = Math.max(1, Math.floor(faces.length / SPLITTER_SAMPLES));

  for (let s = 0; s < faces.length; s += step) {
    const index = faces[s]!;
    const plane = planeOf(items[index]!.points);
    if (!plane) continue;
    let cuts = 0;
    for (let j = 0; j < items.length; j += 1) {
      if (j === index) continue;
      const eps = toleranceFor(items[j]!, plane, edgeInk, coplanarEps);
      let anyFront = false;
      let anyBack = false;
      for (const point of items[j]!.points) {
        const d = distance(plane, point);
        if (d > eps) anyFront = true;
        else if (d < -eps) anyBack = true;
        if (anyFront && anyBack) break;
      }
      if (anyFront && anyBack) cuts += 1;
    }
    if (!best || cuts < best.cuts) best = { plane, index, cuts };
    if (cuts === 0) break;
  }
  return best ? { plane: best.plane, index: best.index } : null;
}

export function buildBsp(items: BspItem[], options: BuildBspOptions = {}): BspNode | null {
  const edgeInk = options.edgeInk ?? 0;
  const eye = options.eye ?? DEFAULT_EYE;
  const coplanarEps = options.coplanarEps ?? EPS;
  return subdivide(items, edgeInk, eye, coplanarEps, 0);
}

function subdivide(
  items: BspItem[],
  edgeInk: number,
  eye: Vec3,
  coplanarEps: number,
  depth: number,
): BspNode | null {
  if (items.length === 0) return null;
  const splitter = depth < MAX_DEPTH ? chooseSplitter(items, edgeInk, coplanarEps) : null;
  if (!splitter) {
    // No usable plane (all edges, all degenerate, or the depth guard tripped).
    return { plane: null, coplanar: sortCoplanar(items), front: null, back: null };
  }

  const nearIsFront = distance(splitter.plane, eye) >= 0;
  const coplanar: BspItem[] = [items[splitter.index]!];
  const front: BspItem[] = [];
  const back: BspItem[] = [];
  for (let i = 0; i < items.length; i += 1) {
    if (i === splitter.index) continue;
    const item = items[i]!;
    const eps = toleranceFor(item, splitter.plane, edgeInk, coplanarEps);
    const parts = partition(
      item,
      splitter.plane,
      eps,
      nearIsFront,
      straddlesAsInk(item, edgeInk, eps, coplanarEps),
    );
    coplanar.push(...parts.coplanar);
    front.push(...parts.front);
    back.push(...parts.back);
  }

  return {
    plane: splitter.plane,
    coplanar: sortCoplanar(coplanar),
    front: subdivide(front, edgeInk, eye, coplanarEps, depth + 1),
    back: subdivide(back, edgeInk, eye, coplanarEps, depth + 1),
  };
}

/**
 * Faces before edges, so a crease lying in a face's plane is drawn over it —
 * the vector counterpart of the depth bias the edge shader applies — and then by
 * the caller's own {@link BspItem.order}, which the splitter promotion above
 * would otherwise destroy.
 */
function sortCoplanar(items: BspItem[]): BspItem[] {
  return items.slice().sort((l, r) => l.kind - r.kind || (l.order ?? 0) - (r.order ?? 0));
}

/**
 * Emit far-to-near from `eye`. In view space the eye sits at
 * `[0, 0, camDist]` — see the note at the top of this file.
 */
export function traverseBsp(node: BspNode | null, eye: Vec3, out: BspItem[] = []): BspItem[] {
  if (!node) return out;
  if (!node.plane) {
    out.push(...node.coplanar);
    return out;
  }
  if (distance(node.plane, eye) >= 0) {
    traverseBsp(node.back, eye, out);
    out.push(...node.coplanar);
    traverseBsp(node.front, eye, out);
  } else {
    traverseBsp(node.front, eye, out);
    out.push(...node.coplanar);
    traverseBsp(node.back, eye, out);
  }
  return out;
}
