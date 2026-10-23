/**
 * What erode pulls back on a folded figure's flat creases: which ends, and on
 * what length (D8).
 *
 * A flat crease — a precrease, or a crease a flap was unfolded along — bounds
 * faces, so the kernel's scene carries it as face edges cut at every vertex:
 * wherever another crease crosses it or ends on it. A crease mark (a pinch, a
 * segment) bounds none, but it is cut where it crosses one, an aux line per
 * face. Neither cut is an end of the crease, and two rules keep erode from
 * reading one as an end:
 *
 * - **Which ends retreat** is the shared rule (`edgeBoundary.ts` in the
 *   simulator package): an end where a border or fold meets the crease — the
 *   outline of the layer it is drawn on. A crossing with another flat crease,
 *   or a cut where a mark crosses one, is inside the layer.
 * - **What retreats** is the crease, not the piece: the run of pieces that is
 *   one straight crease on one layer, through every point where it does not
 *   retreat. Each piece carries its run as `PaperLineItem.whole`, as the mesh
 *   producer's cut pieces do, so a piece between the paper's edge and a
 *   crossing keeps what the pull leaves of it rather than collapsing on its
 *   own length.
 *
 * Other views draw these creases whole — References a line per crease, Edit
 * an aux line per face its folds make — so measured this way Fold's figure
 * erodes exactly where theirs do.
 *
 * Pure.
 */
import { EDGE_CODE, endpointOnBoundary, outlineVertexCounts } from '@treemaker/origami-simulator';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type { PaperLineItem, ScenePoint } from '../../lib/paper/paperScene';
import { namedFaces } from './foldedDisplayLayers';

/** The crease a piece belongs to, seen from the piece. */
export interface CreaseRun {
  /** How far the crease runs past the piece's first end, in lengths of the piece. */
  before: number;
  /** How far it runs past the piece's second end, in lengths of the piece. */
  after: number;
  /** Which of the crease's ends retreat under erode: the one before the piece, and the one after it. */
  onBoundary: [boolean, boolean];
}

/**
 * The erode fields (`erodeLine`) of the stretch `span` of a piece — parameters
 * along it, `[0, 1]` for all of it — whose ends are placed at `a` and `b` in
 * the scene: which of the stretch's own ends retreat, and the crease it is cut
 * from when that is more than the stretch. The crease is laid along the
 * piece, so it is wherever the piece is.
 */
export function runEnds(
  a: ScenePoint,
  b: ScenePoint,
  run: CreaseRun,
  [t0, t1]: readonly [number, number] = [0, 1]
): Pick<PaperLineItem, 'onBoundary' | 'whole'> {
  const starts = !(run.before > 0) && t0 === 0;
  const ends = !(run.after > 0) && t1 === 1;
  const onBoundary: [boolean, boolean] = [run.onBoundary[0] && starts, run.onBoundary[1] && ends];
  if (starts && ends) return { onBoundary };
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return {
    onBoundary,
    whole: {
      a: run.before > 0 ? [a[0] - dx * run.before, a[1] - dy * run.before] : a,
      b: run.after > 0 ? [b[0] + dx * run.after, b[1] + dy * run.after] : b,
      onBoundary: run.onBoundary,
    },
  };
}

/** Whether a run lets erode reach any of its pieces. */
export function runRetreats(run: CreaseRun | null | undefined): boolean {
  return run !== null && run !== undefined && (run.onBoundary[0] || run.onBoundary[1]);
}

/** An edge of a crease graph: its vertices, where they are, and whether it is a crease that erodes. */
export interface RunGraphEdge {
  u: number;
  v: number;
  /** Where `u` is. */
  from: Point;
  /** Where `v` is. */
  to: Point;
  /** A crease runs are made of; every other edge only bounds them. */
  joins: boolean;
}

/**
 * Per edge of a crease graph, the run it is a piece of, read in its own
 * direction (`u` to `v`); null for an edge that `joins` nothing. A run goes
 * on through a vertex where it does not `retreat`, to the next joining edge
 * that carries straight on — one lies on the far side of every crossing — and
 * stops at a vertex where it retreats, or where nothing carries it on. Every
 * point of a run is placed in one frame, which is the caller's to promise:
 * the sheet's, or a layer's.
 */
export function creaseRuns(
  edges: readonly RunGraphEdge[],
  retreats: (vertex: number) => boolean,
  epsilon: number
): (CreaseRun | null)[] {
  const at = new Map<number, number[]>();
  edges.forEach((edge, id) => {
    if (!edge.joins) return;
    listed(at, edge.u, id);
    listed(at, edge.v, id);
  });
  const position = (id: number, vertex: number): Point => (edges[id]!.u === vertex ? edges[id]!.from : edges[id]!.to);
  const far = (id: number, vertex: number): number => (edges[id]!.u === vertex ? edges[id]!.v : edges[id]!.u);
  // The joining edge that carries `id` on straight through `vertex`, if one does.
  const onward = (id: number, vertex: number): number | undefined => {
    if (retreats(vertex)) return undefined;
    const here = position(id, vertex);
    const back = position(id, far(id, vertex));
    const dx = here.x - back.x;
    const dy = here.y - back.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) return undefined;
    return (at.get(vertex) ?? []).find((other) => {
      if (other === id) return false;
      const next = position(other, far(other, vertex));
      const ox = next.x - here.x;
      const oy = next.y - here.y;
      return ox * dx + oy * dy > 0 && Math.abs(dx * oy - dy * ox) / length <= epsilon;
    });
  };

  const runs: (CreaseRun | null)[] = edges.map(() => null);
  edges.forEach((edge, start) => {
    if (!edge.joins || runs[start]) return;
    // Back to the run's first edge and the vertex it starts at, then along
    // it to its last; a straight run never closes, and the bounds say so.
    let first = start;
    let entry = edge.u;
    for (let step = 0; step < edges.length; step += 1) {
      const next = onward(first, entry);
      if (next === undefined || next === start) break;
      entry = far(next, entry);
      first = next;
    }
    // Each edge with the vertex the run enters it by.
    const chain: Array<{ id: number; from: number }> = [{ id: first, from: entry }];
    while (chain.length < edges.length) {
      const { id, from } = chain[chain.length - 1]!;
      const exit = far(id, from);
      const next = onward(id, exit);
      if (next === undefined || next === first) break;
      chain.push({ id: next, from: exit });
    }
    const lengths = chain.map(({ id: piece }) => {
      const { from: a, to: b } = edges[piece]!;
      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    const total = lengths.reduce((sum, length) => sum + length, 0);
    const startVertex = chain[0]!.from;
    const endVertex = far(chain[chain.length - 1]!.id, chain[chain.length - 1]!.from);
    const ends: [boolean, boolean] = [retreats(startVertex), retreats(endVertex)];
    let along = 0;
    chain.forEach(({ id: piece, from: entered }, k) => {
      const length = lengths[k]!;
      const run: CreaseRun =
        length > 0
          ? { before: along / length, after: (total - along - length) / length, onBoundary: ends }
          : { before: 0, after: 0, onBoundary: [false, false] };
      along += length;
      // In the edge's own direction, `u` to `v`.
      runs[piece] = entered === edges[piece]!.u ? run : reversed(run);
    });
  });
  return runs;
}

/** A run read from the piece's other end. */
function reversed({ before, after, onBoundary: [first, last] }: CreaseRun): CreaseRun {
  return { before: after, after: before, onBoundary: [last, first] };
}

/**
 * Which ends of a folded aux line retreat under erode: those on a border or a
 * fold of its face's outline. A flat edge of the outline is a crease the line
 * crosses inside its layer, not where the layer ends; a face that does not
 * say what its edges are is read as all outline.
 */
export function auxLineEnds(
  kernel: Pick<OristudioCpFoldedPaperScene, 'faces'>,
  { face, from, to }: { face: number; from: Point; to: Point },
  epsilon: number
): [boolean, boolean] {
  const source = kernel.faces[face];
  if (!source) return [false, false];
  const { outline, edges } = source;
  const sides =
    edges.length === outline.length
      ? edges.filter(({ kind }) => kind !== 'flat')
      : outline.map((a, i) => ({ from: a, to: outline[(i + 1) % outline.length]! }));
  const on = (point: Point) => sides.some((side) => onSegment(side.from, side.to, point, epsilon));
  return [on(from), on(to)];
}

/**
 * Per aux line, the run of the crease mark it is a piece of, in the line's
 * own direction, from `from` to `to`: its pieces on faces side by side,
 * joined where one ends on a flat crease the next goes on from. Ends retreat
 * by {@link auxLineEnds}; a line on a face the kernel could not name is its
 * own run.
 */
export function auxLineRuns(
  kernel: Pick<OristudioCpFoldedPaperScene, 'faces' | 'aux_lines'>,
  epsilon: number
): CreaseRun[] {
  const lines = kernel.aux_lines;
  const flags = lines.map((line) => auxLineEnds(kernel, line, epsilon));
  // Only a flat crease cuts a mark where it goes on: without one, each line is its mark's whole run.
  if (!hasFlatEdge(kernel)) return flags.map((onBoundary) => ({ before: 0, after: 0, onBoundary }));
  const rings = namedRings(kernel);
  // The faces round each sheet vertex, and either side of each flat sheet edge.
  const round = new Map<number, number[]>();
  const across = new Map<string, number[]>();
  rings.forEach((points, face) => {
    if (!points) return;
    const { edges } = kernel.faces[face]!;
    points.forEach((vertex, i) => {
      listed(round, vertex, face);
      if (edges[i]!.kind === 'flat') listed(across, sheetEdge(vertex, points[(i + 1) % points.length]!), face);
    });
  });
  // The faces an aux line's end at `point` on `face` may carry on into: every
  // face round the vertex it is at, or either side of the flat edge it is on.
  const neighbours = (face: number, point: Point): number[] => {
    const points = rings[face];
    if (!points) return [];
    const { outline, edges } = kernel.faces[face]!;
    const corner = outline.findIndex((at) => samePoint(at, point, epsilon));
    if (corner >= 0) return round.get(points[corner]!) ?? [];
    return edges.flatMap(({ from, to, kind }, i) => {
      if (kind !== 'flat' || !onSegment(from, to, point, epsilon)) return [];
      return across.get(sheetEdge(points[i]!, points[(i + 1) % points.length]!)) ?? [];
    });
  };
  const byFace = new Map<number, number[]>();
  lines.forEach(({ face }, k) => listed(byFace, face, k));

  // One slot per end, `2k` the line's `from` and `2k + 1` its `to`; an end
  // shares its slot with the end that carries the line on.
  const slot = Int32Array.from({ length: lines.length * 2 }, (_, i) => i);
  const root = (i: number): number => (slot[i] === i ? i : (slot[i] = root(slot[i]!)));
  const end = (k: number, which: number) => (which === 0 ? lines[k]!.from : lines[k]!.to);
  lines.forEach((line, k) => {
    for (const which of [0, 1]) {
      if (flags[k]![which]) continue;
      const point = end(k, which);
      for (const face of neighbours(line.face, point)) {
        if (face === line.face) continue;
        for (const other of byFace.get(face) ?? []) {
          const meets = [0, 1].find((side) => !flags[other]![side] && samePoint(end(other, side), point, epsilon));
          if (meets !== undefined) slot[root(other * 2 + meets)] = root(k * 2 + which);
        }
      }
    }
  });
  const runs = creaseRuns(
    lines.map(({ from, to }, k) => ({ u: root(2 * k), v: root(2 * k + 1), from, to, joins: true })),
    (vertex) => (vertex % 2 === 0 ? flags[vertex / 2]![0] : flags[(vertex - 1) / 2]![1]),
    epsilon
  );
  return runs.map((run, k) => run ?? { before: 0, after: 0, onBoundary: flags[k]! });
}

/** Whether `point` lies on the segment `a`–`b`, within `epsilon`. */
function onSegment(a: Point, b: Point, point: Point, epsilon: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > epsilon)) return samePoint(a, point, epsilon);
  const px = point.x - a.x;
  const py = point.y - a.y;
  if (Math.abs(dx * py - dy * px) / length > epsilon) return false;
  const t = (px * dx + py * dy) / (length * length);
  const slack = epsilon / length;
  return t >= -slack && t <= 1 + slack;
}

function samePoint(a: Point, b: Point, epsilon: number): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

/**
 * Per face, the sheet vertex at each corner of its outline, when the kernel
 * named every one and gave every edge its kind; null otherwise.
 */
function namedRings(kernel: Pick<OristudioCpFoldedPaperScene, 'faces'>): (readonly number[] | null)[] {
  const named = namedFaces(kernel);
  return kernel.faces.map(({ points, outline, edges }, face) =>
    named[face] && edges.length === outline.length ? points : null
  );
}

/** An edge of the sheet by its two vertices, whichever way round. */
function sheetEdge(u: number, v: number): string {
  return u < v ? `${u}_${v}` : `${v}_${u}`;
}

/** Whether any face is bounded by a flat crease: Edit's figures never are, Fold's precreased ones are. */
function hasFlatEdge(kernel: Pick<OristudioCpFoldedPaperScene, 'faces'>): boolean {
  return kernel.faces.some(({ edges }) => edges.some(({ kind }) => kind === 'flat'));
}

/** Add `value` to the list `map` keeps under `key`. */
function listed<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** The shared rule's question of a vertex: does a border or fold meet it there. */
function outlineVertex(edges: readonly RunGraphEdge[], kinds: readonly number[]): (vertex: number) => boolean {
  const vertexCount = edges.reduce((most, { u, v }) => Math.max(most, u + 1, v + 1), 0);
  const counts = outlineVertexCounts(
    { edgeIndices: edges.flatMap(({ u, v }) => [u, v]), edgeAssignments: kinds },
    vertexCount
  );
  return (vertex) => endpointOnBoundary(counts, vertex, EDGE_CODE.aux);
}

/**
 * Per face, per outline edge, the run of the flat crease the edge is a piece
 * of, in the edge's own direction; null for a border or a fold, and for every
 * edge of a face the kernel could not name, which keeps the outline's own
 * rule (`foldedFlatScene.ts`).
 *
 * An edge of the sheet is in the scene once per face it bounds. Both faces of
 * a flat edge lie in one layer, as do all the faces round a vertex no border
 * or fold meets — a flat crease turns no paper — so the folded frame places a
 * run's every piece alike, and it is measured there.
 */
export function flatEdgeRuns(
  kernel: Pick<OristudioCpFoldedPaperScene, 'faces'>,
  epsilon: number
): (CreaseRun | null)[][] {
  if (!hasFlatEdge(kernel)) return kernel.faces.map(({ edges: sides }) => sides.map(() => null));
  const rings = namedRings(kernel);
  const edges: RunGraphEdge[] = [];
  const kinds: number[] = [];
  const ids = new Map<string, number>();
  kernel.faces.forEach(({ edges: sides }, face) => {
    const points = rings[face];
    if (!points) return;
    sides.forEach(({ from, to, kind }, i) => {
      const [u, v] = [points[i]!, points[(i + 1) % points.length]!];
      const key = sheetEdge(u, v);
      if (u === v || ids.has(key)) return;
      ids.set(key, edges.length);
      edges.push({ u, v, from, to, joins: kind === 'flat' });
      kinds.push(kind === 'flat' ? EDGE_CODE.aux : kind === 'fold' ? EDGE_CODE.valley : EDGE_CODE.border);
    });
  });
  const runs = creaseRuns(edges, outlineVertex(edges, kinds), epsilon);
  return kernel.faces.map(({ edges: sides }, face) => {
    const points = rings[face];
    return sides.map(({ kind }, i) => {
      if (!points || kind !== 'flat') return null;
      const [u, v] = [points[i]!, points[(i + 1) % points.length]!];
      const id = ids.get(sheetEdge(u, v));
      const run = id === undefined ? null : runs[id];
      if (!run) return null;
      return edges[id!]!.u === u ? run : reversed(run);
    });
  });
}
