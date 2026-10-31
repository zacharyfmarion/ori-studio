import { bounds, SpreadComplexityError, type VisibleFragment } from './fragments.js';
import type { Point, Point3, ProjectedSpread } from './types.js';

interface Interval {
  lo: number;
  hi: number;
  side: number;
  face: number;
}

type Box = ReturnType<typeof bounds>;
interface BoxNode { box: Box; ids?: number[]; left?: BoxNode; right?: BoxNode }
function boxTree(boxes: Box[], ids: number[]): BoxNode {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const id of ids) for (let k = 0; k < 4; k++)
    box[k] = k < 2 ? Math.min(box[k], boxes[id][k]) : Math.max(box[k], boxes[id][k]);
  if (ids.length <= 8) return { box, ids };
  const axis = box[2] - box[0] >= box[3] - box[1] ? 0 : 1;
  ids.sort((a, b) => boxes[a][axis] + boxes[a][axis + 2] - boxes[b][axis] - boxes[b][axis + 2]);
  const mid = ids.length >>> 1;
  return { box, left: boxTree(boxes, ids.slice(0, mid)), right: boxTree(boxes, ids.slice(mid)) };
}
const overlap = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Find missing ink along original paper edges, reusing the resolved fill
 * arrangement. A hidden mask can expose a boundary between two other faces.
 * It is a contour only when the visible faces on its two sides differ. Testing
 * the analytic sides avoids a pixel-sized probe that could skip thin layers.
 * This is capture-worker work, never part of the interactive GPU path.
 */
export function createContourClipper(fragments: readonly VisibleFragment[], budget = 2_000_000, groups?: readonly number[]) {
  const polygons = fragments.map(fragment => {
    const p = fragment.polygon;
    const area = p.reduce((sum, a, i) => {
      const b = p[(i + 1) % p.length];
      return sum + (a[0] - p[0][0]) * (b[1] - p[0][1]) - (a[1] - p[0][1]) * (b[0] - p[0][0]);
    }, 0);
    const sign = area >= 0 ? 1 : -1;
    const edges = p.map((a, i) => {
      const b = p[(i + 1) % p.length];
      const ex = sign * (b[0] - a[0]), ey = sign * (b[1] - a[1]);
      return { x: a[0], y: a[1], ex, ey, magnitude: Math.max(Math.abs(a[0]), Math.abs(a[1])),
        tolerance: 64 * Number.EPSILON * (Math.abs(ex) + Math.abs(ey)) };
    });
    return { face: fragment.face, box: bounds(p), edges };
  }).sort((a, b) => a.box[0] - b.box[0]);
  const boxes = polygons.map(p => p.box);
  const tree = boxTree(boxes, polygons.map((_, i) => i));
  let work = 0;
  const charge = () => { if (++work > budget) throw new SpreadComplexityError(); };
  const neighbors = (box: Box) => {
    const out: number[] = [];
    const visit = (node: BoxNode) => {
      charge();
      if (!overlap(box, node.box)) return;
      if (node.ids) for (const id of node.ids) { if (overlap(box, boxes[id])) out.push(id); }
      else { visit(node.left!); visit(node.right!); }
    };
    visit(tree);
    return out.sort((a, b) => a - b);
  };
  return (owners: readonly number[], a: Point3, b: Point3): Point[] => {
    const box = bounds([a, b]);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.hypot(dx, dy) < 1e-14) return [];
    const magnitude = Math.max(1, Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1]));
    const intervals: Interval[] = [];
    const cuts: number[] = [];
    for (const id of neighbors(box)) {
      const { edges, face: f } = polygons[id];
      let lo = 0, hi = 1, side = 3;
      for (const edge of edges) {
        charge();
        const { ex, ey, x, y } = edge;
        const va = ex * (a[1] - y) - ey * (a[0] - x);
        const vb = ex * (b[1] - y) - ey * (b[0] - x);
        const tolerance = edge.tolerance * Math.max(magnitude, edge.magnitude);
        if (Math.abs(va) <= tolerance && Math.abs(vb) <= tolerance) {
          side &= ex * dx + ey * dy >= 0 ? 1 : 2;
        } else if (va < 0 && vb < 0) {
          hi = lo;
          break;
        } else if (va < 0) lo = Math.max(lo, va / (va - vb));
        else if (vb < 0) hi = Math.min(hi, va / (va - vb));
      }
      if (hi - lo <= 1e-9 || !side) continue;
      intervals.push({ lo, hi, side, face: f });
      cuts.push(lo, hi);
    }
    cuts.sort((a, b) => a - b);
    const out: Point[] = [];
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1], hi = cuts[i];
      if (hi - lo <= 1e-9) continue;
      const t = (lo + hi) / 2;
      let left = -1, right = -1;
      for (const interval of intervals) {
        charge();
        if (t <= interval.lo || t >= interval.hi) continue;
        if (interval.side & 1) left = interval.face;
        if (interval.side & 2) right = interval.face;
      }
      // Original ink handles an edge when its owner is visible. No extra line
      // for same-face triangulation seams or outside the surviving paper.
      if (left < 0 || right < 0 || left === right || owners.includes(left) || owners.includes(right)) continue;
      if (groups && groups[left] === groups[right]) continue;
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - lo) < 1e-9) last[1] = hi;
      else out.push([lo, hi]);
    }
    return out;
  };
}


/** Only original material edges can create these contours. Shared edges are
 * visited once; auxiliary lines and triangulation edges never enter the pass. */
export function visibleContours(mesh: ProjectedSpread, rings: readonly number[][], fragments: readonly VisibleFragment[], groups?: readonly number[]): { a: Point; b: Point }[] {
  if (mesh.visibility.ranks) return [];
  const clip = createContourClipper(fragments, 2_000_000, groups);
  const masksOthers = new Set(mesh.visibility.above.flat());
  const edges = new Map<string, { a: number; b: number; owners: number[] }>();
  rings.forEach((ring, face) => ring.forEach((v, i) => {
    const w = ring[(i + 1) % ring.length];
    const a = Math.min(v, w), b = Math.max(v, w), key = `${a}:${b}`;
    const edge = edges.get(key);
    if (edge) edge.owners.push(face);
    else edges.set(key, { a, b, owners: [face] });
  }));
  const out: { a: Point; b: Point }[] = [];
  for (const edge of edges.values()) {
    if (!edge.owners.some(face => masksOthers.has(face))) continue;
    const a = mesh.positions[edge.a], b = mesh.positions[edge.b];
    const at = (t: number): Point => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    for (const [lo, hi] of clip(edge.owners, a, b)) out.push({ a: at(lo), b: at(hi) });
  }
  return out;
}
