import type { ExploriDocument } from './document';
import { exploriTreeIsSymmetric } from './document';
import { EXPLORI_SYMMETRY_TOLERANCE } from './symmetry';
import type { ExploriGraph } from './types';

/**
 * Where to draw a result tree: a mirror fan.
 *
 * A tiling's tree arrives with no positions — upstream serializes it with bare
 * ids — but with an exact `length` on every edge, and for a tiling from a
 * `book` or `diag` database those lengths carry a mirror: two flaps that are
 * reflections of each other on the paper have bit-identical lengths. Drawing
 * that mirror is the whole point of showing the tree beside the pattern, and a
 * radial layout from the busiest node throws it away.
 *
 * The involution is found by **maximal pairing**. Root the tree at its centre,
 * give every rooted subtree a metric canonical form, and at each node group the
 * children by `(length, form)`: a class of k isomorphic siblings yields ⌊k/2⌋
 * **pairs** and, when k is odd, one **fixed** child whose subtree is
 * self-mirrored. Pairing more never costs anything — the fixed children are
 * exactly the ones nobody could pair — so this is the unique involution that
 * moves the most nodes, and it exists for every tree: a rigid tree has no pairs
 * and every child fixed, and gets the same drawing rule as everything else.
 *
 * Placement: each node has an outgoing direction (the root points up *and*
 * down), and its children fan out around it in wedges proportional to their
 * leaf counts, capped at 180° below the root so branches grow outward, each
 * child at exactly its edge length along its wedge's centre. Pairs take mirrored
 * wedges, and the right-hand member is the *reflection of the left-hand
 * member's finished layout* — never an independent layout — so the two are
 * exact by construction. Fixed children take the wedges nearest the axis: the
 * first continues the line (two of them may at the root), which keeps its own
 * fan symmetric about the same line, and the recursion carries the symmetry all
 * the way down.
 *
 * A second fixed child at the same node has nowhere on the line to go — two
 * flaps drawn along one ray put a leaf's dot in the middle of another's edge —
 * so it is **tilted**: it books mirrored room on both sides of the axis as a
 * pair would, uses one side, and lays its own subtree out symmetric about its
 * tilted direction. Pairs stay exact; the tilted branch is the only asymmetry.
 * Over the local archive this is the common case for the largest database, not
 * a corner (3650 of 4765 `6 book` trees), and the excess is a single flap eight
 * times in ten — see `implementation-plans/explori-symmetric-tree-render.md`.
 *
 * Two centres whose halves are mirror images are drawn **crossing**: the
 * central edge crosses the line and every node is paired. Otherwise both
 * centres sit on the line.
 *
 * `scripts/explori/mirror.py` is this module's Python twin, used to tag the
 * exported corpus; `treeLayout.corpus.test.ts` holds the two to the same answer
 * on every local tree. Change one, change both.
 */

export type ExploriTreeMirrorKind = 'empty' | 'rigid' | 'crossing' | 'strict' | 'tilted';

/** Which side of the root a tree's leaves weigh toward: `1` up, `-1` down. */
export type ExploriLeafSide = 1 | -1;

export interface ExploriTreeLayout {
  /** Model coordinates, y up, mirror on `x = 0`. Only the laid-out component. */
  positions: Map<string, [number, number]>;
  /** The involution drawn, σ. A fixed node maps to itself. */
  mirrorOf: Map<string, string>;
  /** Parent in the drawing's rooting; `null` for the root(s). */
  parentOf: Map<string, string | null>;
  /** Unordered pairs `{v, σv}` with `v ≠ σv`. Zero means σ is the identity. */
  pairCount: number;
  /** Self-mirrored subtree roots drawn off the line, at nodes on the line. */
  tilted: string[];
  crossing: boolean;
  kind: ExploriTreeMirrorKind;
  /** There is a mirror and the drawing is its exact reflection about `x = 0`. */
  strict: boolean;
}

export interface ExploriTreeLayoutOptions {
  /**
   * Which side of the root the leaves should weigh toward: `1` up, `-1` down.
   *
   * A mirror drawing is free to flip top for bottom. The default puts the
   * heavier side down; a symmetric query tree overrides it with its own side,
   * see {@link exploriQueryLeafSide}. Ignored when `paper` decides.
   */
  leafSide?: ExploriLeafSide;
  /**
   * Where the nodes sit on the paper and which way the pattern mirrors
   * (`paperTree.ts`). With it, the line is the pattern's: up is along
   * `mirror`, and at a node with several self-mirrored branches the one that
   * reaches farthest along the mirror keeps the line while the rest tilt —
   * the long flap on the symmetry line stays on it. Without it, the deepest
   * chain keeps the line.
   */
  paper?: { positions: Map<string, [number, number]>; mirror: [number, number] };
}

/**
 * Lengths are bucketed at this fraction of the longest edge before comparison.
 *
 * Mirror strips have bit-identical lengths, so this only has to survive the
 * sums `merge_edges` makes when it removes degree-2 nodes — commutative, so
 * identical too — and any future drift in how upstream rounds.
 */
const REL_QUANTUM = 1e-6;
const UP = Math.PI / 2;
const HALF_TURN = Math.PI;

interface Adjacent {
  id: string;
  length: number;
}

interface Forest {
  /** Node id → position in the input, the only tie-break that is never a guess. */
  order: Map<string, number>;
  adjacency: Map<string, Adjacent[]>;
}

/**
 * Ids as strings, self-loops and duplicates dropped, non-lengths made 1 — and
 * any edge that would close a cycle dropped too. A result is a tree, but the
 * shape is not checked upstream of here, and the canonical forms below recurse
 * on children: a cycle would recurse forever rather than draw badly.
 */
function readGraph(graph: ExploriGraph): Forest {
  const order = new Map<string, number>();
  for (const node of graph.nodes) {
    const id = String(node.id);
    if (!order.has(id)) order.set(id, order.size);
  }
  const adjacency = new Map<string, Adjacent[]>();
  for (const id of order.keys()) adjacency.set(id, []);
  const seen = new Set<string>();
  const root = new Map<string, string>();
  const find = (id: string): string => {
    let top = id;
    while ((root.get(top) ?? top) !== top) top = root.get(top) as string;
    while (id !== top) {
      const next = root.get(id) ?? id;
      root.set(id, top);
      id = next;
    }
    return top;
  };
  for (const edge of graph.edges) {
    const u = String(edge.u);
    const v = String(edge.v);
    if (u === v || !order.has(u) || !order.has(v)) continue;
    const key = (order.get(u) ?? 0) <= (order.get(v) ?? 0) ? `${u}\u0000${v}` : `${v}\u0000${u}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ru = find(u);
    const rv = find(v);
    if (ru === rv) continue;
    root.set(ru, rv);
    const length =
      typeof edge.length === 'number' && Number.isFinite(edge.length) && edge.length > 0
        ? edge.length
        : 1;
    adjacency.get(u)?.push({ id: v, length });
    adjacency.get(v)?.push({ id: u, length });
  }
  return { order, adjacency };
}

/** The largest connected component, ties to the one holding the earliest node. */
function largestComponent(forest: Forest): string[] {
  const visited = new Set<string>();
  let best: string[] = [];
  for (const start of forest.order.keys()) {
    if (visited.has(start)) continue;
    const component: string[] = [start];
    visited.add(start);
    for (let i = 0; i < component.length; i += 1) {
      for (const next of forest.adjacency.get(component[i]) ?? []) {
        if (visited.has(next.id)) continue;
        visited.add(next.id);
        component.push(next.id);
      }
    }
    if (component.length > best.length) best = component;
  }
  return best;
}

/**
 * The tree's centre — one node, or the two ends of a central edge — by
 * stripping leaves a layer at a time. Every automorphism fixes it, which is
 * what makes it the place to root the search for one.
 */
export function treeCenter(component: readonly string[], adjacency: Map<string, Adjacent[]>): string[] {
  const degree = new Map<string, number>();
  const remaining = new Set<string>(component);
  let layer: string[] = [];
  for (const id of component) {
    const d = (adjacency.get(id) ?? []).filter((edge) => remaining.has(edge.id)).length;
    degree.set(id, d);
    if (d <= 1) layer.push(id);
  }
  while (remaining.size > 2 && layer.length > 0) {
    const next: string[] = [];
    for (const leaf of layer) {
      remaining.delete(leaf);
      for (const edge of adjacency.get(leaf) ?? []) {
        if (!remaining.has(edge.id)) continue;
        const d = (degree.get(edge.id) ?? 0) - 1;
        degree.set(edge.id, d);
        if (d === 1) next.push(edge.id);
      }
    }
    layer = next;
  }
  return [...remaining];
}

/** Metric canonical forms and the maximal pairing they induce, memoized. */
class MetricTree {
  private readonly quantum: number;
  private readonly canonMemo = new Map<string, string>();
  private readonly sizeMemo = new Map<string, number>();
  private readonly leafMemo = new Map<string, number>();
  private readonly decomposeMemo = new Map<string, Decomposition>();
  private readonly depthMemo = new Map<string, number>();

  /** Each node's coordinate along the paper's mirror, when the paper is known. */
  private readonly along = new Map<string, number>();
  private readonly reachMemo = new Map<string, [number, number]>();

  constructor(
    readonly forest: Forest,
    component: readonly string[],
    paper?: ExploriTreeLayoutOptions['paper']
  ) {
    let longest = 0;
    for (const id of component) {
      for (const edge of forest.adjacency.get(id) ?? []) longest = Math.max(longest, edge.length);
    }
    this.quantum = (longest || 1) * REL_QUANTUM;
    if (paper) {
      for (const [id, [x, y]] of paper.positions) this.along.set(id, x * paper.mirror[0] + y * paper.mirror[1]);
    }
  }

  hasPaper(): boolean {
    return this.along.size > 0;
  }

  alongMirror(id: string): number | undefined {
    return this.along.get(id);
  }

  /**
   * How far the fixed part of `v`'s subtree extends along the mirror, as the
   * least and greatest coordinate over `v` and its fixed descendants.
   */
  fixedReach(v: string, parent: string | null): [number, number] {
    const key = `${v}\u0000${parent ?? ''}`;
    const memo = this.reachMemo.get(key);
    if (memo) return memo;
    const own = this.along.get(v);
    let lo = own ?? Infinity;
    let hi = own ?? -Infinity;
    for (const child of this.decompose(v, parent).fixed) {
      const [a, b] = this.fixedReach(child, v);
      lo = Math.min(lo, a);
      hi = Math.max(hi, b);
    }
    const result: [number, number] = [lo, hi];
    this.reachMemo.set(key, result);
    return result;
  }

  order(id: string): number {
    return this.forest.order.get(id) ?? 0;
  }

  bucket(length: number): number {
    return Math.round(length / this.quantum);
  }

  children(v: string, parent: string | null): Adjacent[] {
    return (this.forest.adjacency.get(v) ?? []).filter((edge) => edge.id !== parent);
  }

  edgeLength(v: string, child: string): number {
    return (this.forest.adjacency.get(v) ?? []).find((edge) => edge.id === child)?.length ?? 1;
  }

  /** The subtree below `v`, seen from `parent`, as a string equal iff isomorphic with equal lengths. */
  canon(v: string, parent: string | null): string {
    const key = `${v}\u0000${parent ?? ''}`;
    const memo = this.canonMemo.get(key);
    if (memo !== undefined) return memo;
    const parts = this.children(v, parent)
      .map((edge) => `${this.bucket(edge.length)}:${this.canon(edge.id, v)}`)
      .sort(compareStrings);
    const result = `(${parts.join(',')})`;
    this.canonMemo.set(key, result);
    return result;
  }

  size(v: string, parent: string | null): number {
    const key = `${v}\u0000${parent ?? ''}`;
    const memo = this.sizeMemo.get(key);
    if (memo !== undefined) return memo;
    const result = 1 + this.children(v, parent).reduce((sum, edge) => sum + this.size(edge.id, v), 0);
    this.sizeMemo.set(key, result);
    return result;
  }

  leafCount(v: string, parent: string | null): number {
    const key = `${v}\u0000${parent ?? ''}`;
    const memo = this.leafMemo.get(key);
    if (memo !== undefined) return memo;
    const children = this.children(v, parent);
    const result =
      children.length === 0 ? 1 : children.reduce((sum, edge) => sum + this.leafCount(edge.id, v), 0);
    this.leafMemo.set(key, result);
    return result;
  }

  /**
   * The maximal pairing of `v`'s children, and the fixed ones in the order the
   * axis is offered to them: deepest fixed chain first, then largest, then
   * canonical key, then longest edge, then input order — never a guess.
   */
  decompose(v: string, parent: string | null): Decomposition {
    const key = `${v}\u0000${parent ?? ''}`;
    const memo = this.decomposeMemo.get(key);
    if (memo) return memo;
    const classes = new Map<string, Adjacent[]>();
    for (const edge of this.children(v, parent)) {
      const classKey = `${this.bucket(edge.length)}:${this.canon(edge.id, v)}`;
      const members = classes.get(classKey);
      if (members) members.push(edge);
      else classes.set(classKey, [edge]);
    }
    const pairs: [string, string][] = [];
    const fixed: { id: string; bucket: number; canon: string }[] = [];
    for (const members of classes.values()) {
      members.sort((a, b) => this.order(a.id) - this.order(b.id));
      for (let i = 0; i + 1 < members.length; i += 2) pairs.push([members[i].id, members[i + 1].id]);
      if (members.length % 2 === 1) {
        const last = members[members.length - 1];
        fixed.push({ id: last.id, bucket: this.bucket(last.length), canon: this.canon(last.id, v) });
      }
    }
    fixed.sort(
      (a, b) =>
        this.fixedDepth(b.id, v) - this.fixedDepth(a.id, v) ||
        this.size(b.id, v) - this.size(a.id, v) ||
        compareStrings(a.canon, b.canon) ||
        b.bucket - a.bucket ||
        this.order(a.id) - this.order(b.id)
    );
    const result: Decomposition = { pairs, fixed: fixed.map((entry) => entry.id) };
    this.decomposeMemo.set(key, result);
    return result;
  }

  /** Nodes on the longest chain of fixed children below `v`, `v` included. */
  fixedDepth(v: string, parent: string | null): number {
    const key = `${v}\u0000${parent ?? ''}`;
    const memo = this.depthMemo.get(key);
    if (memo !== undefined) return memo;
    const result = 1 + Math.max(0, ...this.decompose(v, parent).fixed.map((id) => this.fixedDepth(id, v)));
    this.depthMemo.set(key, result);
    return result;
  }

  /**
   * The node correspondence between two isomorphic subtrees, as `[a, b]` pairs
   * with `a` under the first root. Children with equal keys are matched in
   * input order, which for isomorphic subtrees is the only choice there is.
   */
  match(a: string, aParent: string | null, b: string, bParent: string | null, into: [string, string][]): void {
    into.push([a, b]);
    const keyed = (v: string, parent: string | null) =>
      this.children(v, parent)
        .map((edge) => ({ id: edge.id, key: `${this.bucket(edge.length)}:${this.canon(edge.id, v)}` }))
        .sort((x, y) => compareStrings(x.key, y.key) || this.order(x.id) - this.order(y.id));
    const left = keyed(a, aParent);
    const right = keyed(b, bParent);
    for (let i = 0; i < left.length && i < right.length; i += 1) {
      this.match(left[i].id, a, right[i].id, b, into);
    }
  }
}

interface Decomposition {
  pairs: [string, string][];
  fixed: string[];
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `point` reflected across the line through `origin` with direction `angle`. */
function reflectAcross(point: [number, number], origin: [number, number], angle: number): [number, number] {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const wx = point[0] - origin[0];
  const wy = point[1] - origin[1];
  const along = wx * dx + wy * dy;
  return [origin[0] + 2 * along * dx - wx, origin[1] + 2 * along * dy - wy];
}

interface Placement {
  positions: Map<string, [number, number]>;
  mirrorOf: Map<string, string>;
  parentOf: Map<string, string | null>;
  tilted: string[];
  pairCount: number;
}

interface FanFrame {
  /** Direction the node points away from its parent; the root points up. */
  direction: number;
  /** Half the arc its children may use. π at the root, at most π/2 below it. */
  halfWidth: number;
  /** How many fixed children may continue the line: two at the root, else one. */
  axisSlots: 1 | 2;
  /** Whether this node sits on the global mirror, so a tilt here is reported. */
  onAxis: boolean;
  /** Whether σ and tilts are recorded; off inside a pair's left member, which is reflected instead. */
  record: boolean;
  /** Which way along the paper's mirror this node's outgoing direction runs: `1` toward it, `-1` away. */
  paperSign: 1 | -1;
}

/**
 * Which fixed children continue the line: one forward, and at the root one
 * back. Without the paper, the first of `fixed` (already in the order the line
 * is offered) and, at the root, the second. With it, in each direction the
 * child whose fixed subtree reaches farthest that way along the mirror; a
 * child that reaches nowhere that way — one pointing back toward the parent
 * on the paper, or sitting on the parent's own point — is tilted instead.
 */
function chooseAxis(
  tree: MetricTree,
  v: string,
  fixed: readonly string[],
  frame: FanFrame
): { forward: string | null; backward: string | null; tilted: string[] } {
  const here = tree.alongMirror(v);
  if (!tree.hasPaper() || here === undefined) {
    return {
      forward: fixed[0] ?? null,
      backward: frame.axisSlots === 2 ? (fixed[1] ?? null) : null,
      tilted: fixed.slice(frame.axisSlots),
    };
  }
  const reachOf = (child: string, sign: 1 | -1): number => {
    const [lo, hi] = tree.fixedReach(child, v);
    return sign > 0 ? hi - here : here - lo;
  };
  const pick = (sign: 1 | -1, taken: string | null): string | null => {
    let best: string | null = null;
    let bestReach = 1e-9;
    for (const child of fixed) {
      if (child === taken) continue;
      const reach = reachOf(child, sign);
      if (reach > bestReach) {
        bestReach = reach;
        best = child;
      }
    }
    return best;
  };
  const forward = pick(frame.paperSign, null);
  const backward = frame.axisSlots === 2 ? pick(frame.paperSign > 0 ? -1 : 1, forward) : null;
  return { forward, backward, tilted: fixed.filter((child) => child !== forward && child !== backward) };
}

/** Lay out `v` and everything below it. */
function place(
  tree: MetricTree,
  v: string,
  parent: string | null,
  at: [number, number],
  frame: FanFrame,
  out: Placement
): void {
  out.positions.set(v, at);
  out.parentOf.set(v, parent);
  if (frame.record) out.mirrorOf.set(v, v);
  const { pairs, fixed } = tree.decompose(v, parent);
  if (pairs.length === 0 && fixed.length === 0) return;

  const { forward, backward, tilted } = chooseAxis(tree, v, fixed, frame);
  const axis = [forward, backward].filter((child): child is string => child !== null);
  if (frame.record && frame.onAxis) out.tilted.push(...tilted);

  const weight = (child: string) => tree.leafCount(child, v);
  const total =
    axis.reduce((sum, child) => sum + weight(child), 0) +
    2 * tilted.reduce((sum, child) => sum + weight(child), 0) +
    2 * pairs.reduce((sum, [left]) => sum + weight(left), 0);
  const arc = 2 * frame.halfWidth;
  const wedge = (child: string) => (arc * weight(child)) / total;

  // Which side is "right" for this direction — the side a lone tilted branch
  // and a pair's left member go to first. Only the sign of sin(direction)
  // matters: pointing up, clockwise is +x; pointing down, counter-clockwise is.
  const firstSide: 1 | -1 = Math.sin(frame.direction) > 1e-12 ? -1 : 1;

  const placeChild = (
    child: string,
    angle: number,
    halfWidth: number,
    onAxis: boolean,
    record: boolean,
    paperSign: 1 | -1
  ) => {
    const length = tree.edgeLength(v, child);
    const position: [number, number] = [at[0] + Math.cos(angle) * length, at[1] + Math.sin(angle) * length];
    place(
      tree,
      child,
      v,
      position,
      { direction: angle, halfWidth: Math.min(UP, halfWidth), axisSlots: 1, onAxis, record, paperSign },
      out
    );
  };
  /** Which way along the mirror a child not on the line runs: the paper's answer, else this node's. */
  const signToward = (child: string): 1 | -1 => {
    const here = tree.alongMirror(v);
    const there = tree.alongMirror(child);
    if (here === undefined || there === undefined || Math.abs(there - here) <= 1e-9) return frame.paperSign;
    return there > here ? 1 : -1;
  };

  // The line itself: one fixed child straight on, at the root another straight
  // back. Their wedges straddle the line, so their own fans are symmetric
  // about it.
  const forwardWedge = forward ? wedge(forward) : 0;
  const backwardWedge = backward ? wedge(backward) : 0;
  if (forward) placeChild(forward, frame.direction, forwardWedge / 2, frame.onAxis, frame.record, frame.paperSign);
  if (backward) {
    placeChild(backward, frame.direction + HALF_TURN, backwardWedge / 2, frame.onAxis, frame.record, frame.paperSign > 0 ? -1 : 1);
  }

  // Everything else walks outward from the line, the same sizes in the same
  // order on both sides, so the arrangement is symmetric whatever fills it.
  // Tilted children first, nearest the line; then pairs by canonical key.
  interface Item {
    child: string;
    size: number;
    /** A tilted child's side, or `null` for a pair, which uses both. */
    side: 1 | -1 | null;
    partner: string | null;
  }
  const items: Item[] = tilted.map((child, index) => ({
    child,
    size: wedge(child),
    side: index % 2 === 0 ? firstSide : (-firstSide as 1 | -1),
    partner: null,
  }));
  const orderedPairs = [...pairs].sort(
    (p, q) => compareStrings(tree.canon(p[0], v), tree.canon(q[0], v)) || tree.order(p[0]) - tree.order(q[0])
  );
  for (const [left, right] of orderedPairs) items.push({ child: left, size: wedge(left), side: null, partner: right });

  let offset = forwardWedge / 2;
  for (const item of items) {
    const centre = offset + item.size / 2;
    offset += item.size;
    if (item.side !== null) {
      placeChild(item.child, frame.direction + item.side * centre, item.size / 2, false, frame.record, signToward(item.child));
      continue;
    }
    // A pair: lay out the left member, then reflect it onto the right.
    const partner = item.partner as string;
    const correspondence: [string, string][] = [];
    tree.match(item.child, v, partner, v, correspondence);
    placeChild(item.child, frame.direction + firstSide * centre, item.size / 2, false, false, signToward(item.child));
    for (const [left, right] of correspondence) {
      const position = out.positions.get(left);
      if (position) out.positions.set(right, reflectAcross(position, at, frame.direction));
      out.parentOf.set(right, right === partner ? v : (out.mirrorOf.get(out.parentOf.get(left) ?? '') ?? null));
      if (frame.record) {
        out.mirrorOf.set(left, right);
        out.mirrorOf.set(right, left);
      }
    }
    // The reflected member's parents are the reflections of the left member's:
    // fix up the ones the line above could not resolve because σ was not yet
    // recorded for them.
    for (const [left, right] of correspondence) {
      if (right === partner) continue;
      const leftParent = out.parentOf.get(left);
      const rightParent = leftParent ? correspondence.find(([l]) => l === leftParent)?.[1] ?? null : null;
      out.parentOf.set(right, rightParent);
    }
    if (frame.record) out.pairCount += tree.size(item.child, v);
  }
}

function emptyLayout(kind: ExploriTreeMirrorKind): ExploriTreeLayout {
  return {
    positions: new Map(),
    mirrorOf: new Map(),
    parentOf: new Map(),
    pairCount: 0,
    tilted: [],
    crossing: false,
    kind,
    strict: false,
  };
}

export function layoutExploriTree(
  graph: ExploriGraph,
  options: ExploriTreeLayoutOptions = {}
): ExploriTreeLayout {
  const forest = readGraph(graph);
  if (forest.order.size === 0) return emptyLayout('empty');
  const component = largestComponent(forest);
  const out: Placement = {
    positions: new Map(),
    mirrorOf: new Map(),
    parentOf: new Map(),
    tilted: [],
    pairCount: 0,
  };
  if (component.length === 1) {
    out.positions.set(component[0], [0, 0]);
    out.mirrorOf.set(component[0], component[0]);
    out.parentOf.set(component[0], null);
    return { ...out, crossing: false, kind: 'rigid', strict: false };
  }

  const tree = new MetricTree(forest, component, options.paper);
  const centers = treeCenter(component, forest.adjacency).sort((a, b) => tree.order(a) - tree.order(b));
  let crossing = false;
  if (centers.length === 2) {
    const [c1, c2] = centers;
    const length = tree.edgeLength(c1, c2);
    if (tree.canon(c1, c2) === tree.canon(c2, c1)) {
      // Two mirror-image halves: the central edge crosses the line, and the
      // right half is the reflection of the left. Nothing is fixed, nothing
      // can tilt, and σ pairs every node.
      crossing = true;
      place(
        tree,
        c1,
        c2,
        [-length / 2, 0],
        { direction: HALF_TURN, halfWidth: UP, axisSlots: 1, onAxis: false, record: false, paperSign: 1 },
        out
      );
      const correspondence: [string, string][] = [];
      tree.match(c1, c2, c2, c1, correspondence);
      for (const [left, right] of correspondence) {
        const position = out.positions.get(left);
        if (position) out.positions.set(right, [-position[0], position[1]]);
        out.mirrorOf.set(left, right);
        out.mirrorOf.set(right, left);
      }
      for (const [left, right] of correspondence) {
        const leftParent = out.parentOf.get(left);
        out.parentOf.set(
          right,
          right === c2 ? c1 : leftParent ? correspondence.find(([l]) => l === leftParent)?.[1] ?? null : null
        );
      }
      out.parentOf.set(c1, null);
      out.parentOf.set(c2, null);
      out.pairCount = tree.size(c1, c2);
    } else {
      // Both centres on the line, a virtual root at the midpoint of their edge.
      // With the paper, the one farther along the mirror goes up.
      const a1 = tree.alongMirror(c1);
      const a2 = tree.alongMirror(c2);
      const [up, down] = a1 !== undefined && a2 !== undefined && a2 > a1 + 1e-9 ? [c2, c1] : [c1, c2];
      place(
        tree,
        up,
        down,
        [0, length / 2],
        { direction: UP, halfWidth: UP, axisSlots: 1, onAxis: true, record: true, paperSign: 1 },
        out
      );
      place(
        tree,
        down,
        up,
        [0, -length / 2],
        { direction: -UP, halfWidth: UP, axisSlots: 1, onAxis: true, record: true, paperSign: -1 },
        out
      );
      out.parentOf.set(c1, null);
      out.parentOf.set(c2, null);
    }
  } else {
    place(
      tree,
      centers[0],
      null,
      [0, 0],
      { direction: UP, halfWidth: HALF_TURN, axisSlots: 2, onAxis: true, record: true, paperSign: 1 },
      out
    );
  }

  // Orientation: the drawing may flip top for bottom without losing anything —
  // unless the paper has already said which way is up.
  if (!tree.hasPaper()) {
    const leaves = component.filter((id) => (forest.adjacency.get(id)?.length ?? 0) <= 1);
    const centroidY = leaves.reduce((sum, id) => sum + (out.positions.get(id)?.[1] ?? 0), 0) / Math.max(1, leaves.length);
    const leafSide = options.leafSide ?? -1;
    if (Math.abs(centroidY) > 1e-9 && Math.sign(centroidY) !== leafSide) {
      for (const [id, [x, y]] of out.positions) out.positions.set(id, [x, -y]);
    }
  }

  const kind: ExploriTreeMirrorKind =
    out.pairCount === 0 ? 'rigid' : crossing ? 'crossing' : out.tilted.length > 0 ? 'tilted' : 'strict';
  return { ...out, crossing, kind, strict: out.pairCount > 0 && out.tilted.length === 0 };
}

/**
 * Which side of its centre the drawn tree's leaves weigh toward, when it is
 * symmetric about the editor's mirror — or `null`, when it is not, or when the
 * leaves balance within the mirror tolerance.
 *
 * The one orientation cue a query can give a result. Its centre is found the
 * same way a result's is, so the comparison is like with like.
 */
export function exploriQueryLeafSide(document: ExploriDocument): ExploriLeafSide | null {
  if (document.nodes.length < 2 || !exploriTreeIsSymmetric(document)) return null;
  const forest = readGraph({
    nodes: document.nodes.map((node) => ({ id: node.id })),
    edges: document.edges.map((edge) => ({ u: edge.vertices[0], v: edge.vertices[1], length: edge.length })),
  });
  const component = largestComponent(forest);
  if (component.length < 2) return null;
  const y = new Map(document.nodes.map((node) => [String(node.id), node.loc.y] as const));
  const centers = treeCenter(component, forest.adjacency);
  const centerY = centers.reduce((sum, id) => sum + (y.get(id) ?? 0), 0) / centers.length;
  const leaves = component.filter((id) => (forest.adjacency.get(id)?.length ?? 0) <= 1);
  if (leaves.length === 0) return null;
  const centroidY = leaves.reduce((sum, id) => sum + (y.get(id) ?? 0), 0) / leaves.length;
  const lean = centroidY - centerY;
  if (Math.abs(lean) <= EXPLORI_SYMMETRY_TOLERANCE) return null;
  return lean > 0 ? 1 : -1;
}

/** The connected component holding `start`, in traversal order. */
function componentOf(forest: Forest, start: string): string[] {
  const seen = new Set<string>([start]);
  const out = [start];
  for (let i = 0; i < out.length; i += 1) {
    for (const next of forest.adjacency.get(out[i]) ?? []) {
      if (seen.has(next.id)) continue;
      seen.add(next.id);
      out.push(next.id);
    }
  }
  return out;
}

/**
 * The node correspondence between two trees that are the same metric tree —
 * same shape, same lengths — as a map from `a`'s ids to `b`'s, or `null` when
 * they differ. Both are quantized on one scale, so a length that agrees to
 * floating-point precision on both sides lands in the same bucket.
 *
 * Isomorphic siblings are matched in input order, which is the only choice
 * there is; for a mirrored tree that is the mirror's own ambiguity.
 */
export function matchExploriTrees(a: ExploriGraph, b: ExploriGraph): Map<string, string> | null {
  if (a.nodes.length === 0 || a.nodes.length !== b.nodes.length) return null;
  const tag = (side: 'a' | 'b', id: number | string) => `${side}\u0001${id}`;
  const forest = readGraph({
    nodes: [...a.nodes.map((n) => ({ id: tag('a', n.id) })), ...b.nodes.map((n) => ({ id: tag('b', n.id) }))],
    edges: [
      ...a.edges.map((e) => ({ u: tag('a', e.u), v: tag('a', e.v), length: e.length })),
      ...b.edges.map((e) => ({ u: tag('b', e.u), v: tag('b', e.v), length: e.length })),
    ],
  });
  const ca = componentOf(forest, tag('a', a.nodes[0].id));
  const cb = componentOf(forest, tag('b', b.nodes[0].id));
  if (ca.length !== cb.length || ca.length !== a.nodes.length) return null;
  const tree = new MetricTree(forest, [...ca, ...cb]);
  const centersA = treeCenter(ca, forest.adjacency).sort((x, y) => tree.order(x) - tree.order(y));
  const centersB = treeCenter(cb, forest.adjacency).sort((x, y) => tree.order(x) - tree.order(y));
  if (centersA.length !== centersB.length) return null;
  const pairs: [string, string][] = [];
  if (centersA.length === 1) {
    if (tree.canon(centersA[0], null) !== tree.canon(centersB[0], null)) return null;
    tree.match(centersA[0], null, centersB[0], null, pairs);
  } else {
    const [a1, a2] = centersA;
    const [b1, b2] = centersB;
    const fits = (x: string, y: string) =>
      tree.canon(a1, a2) === tree.canon(x, y) && tree.canon(a2, a1) === tree.canon(y, x);
    const [x, y] = fits(b1, b2) ? [b1, b2] : fits(b2, b1) ? [b2, b1] : [null, null];
    if (!x || !y) return null;
    tree.match(a1, a2, x, y, pairs);
    tree.match(a2, a1, y, x, pairs);
  }
  const strip = (id: string) => id.slice(2);
  return new Map(pairs.map(([x, y]) => [strip(x), strip(y)]));
}
