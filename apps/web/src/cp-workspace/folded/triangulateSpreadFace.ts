import earcut from 'earcut';
import type { Point, Triangle } from '@oristudio/layer-spread';

const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const area = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const length2 = (a: Point, b: Point) => (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;

/** Earcut may omit collinear boundary vertices. They are material crease
 * vertices, with independent solved heights, so put them back by splitting the
 * spanning boundary triangle. Never weld or discard material vertices.
 */
function restoreBoundary(ids: number[], triangles: Triangle[]) {
  const used = new Set(triangles.flat());
  if (ids.every((id) => used.has(id))) return;
  for (let i = 0; i < ids.length; i++) {
    if (!used.has(ids[i]!)) continue;
    const chain = [ids[i]!];
    let j = (i + 1) % ids.length;
    while (!used.has(ids[j]!)) {
      chain.push(ids[j]!);
      j = (j + 1) % ids.length;
    }
    if (chain.length === 1) continue;
    chain.push(ids[j]!);
    const a = chain[0]!,
      b = chain[chain.length - 1]!;
    const t = triangles.findIndex((corners) => corners.includes(a) && corners.includes(b));
    if (t < 0) throw new Error('Layer spread could not preserve a crease boundary');
    const corners = triangles[t]!;
    if (corners[(corners.indexOf(a) + 1) % 3] !== b) chain.reverse();
    const opposite = corners.find((id) => id !== a && id !== b)!;
    const split: Triangle[] = chain.slice(1).map((id, k) => [chain[k]!, id, opposite]);
    triangles[t] = split[0]!;
    triangles.push(...split.slice(1));
  }
}

/** Triangulate without changing any original face or crease. A collinear ear
 * can become a tiny, ill-conditioned triangle when the solver prepares Float32
 * XY. Flip its internal diagonal instead of deleting it (which would skip a
 * shared crease vertex and let the two adjoining faces separate).
 */
export function triangulateSpreadFace(ids: number[], xy: Point[]): Triangle[] {
  const corners = earcut(ids.flatMap((v) => xy[v]!));
  if (corners.length < 3) throw new Error('Layer spread could not triangulate a face');
  const triangles: Triangle[] = [];
  for (let i = 0; i < corners.length; i += 3)
    triangles.push([ids[corners[i]!]!, ids[corners[i + 1]!]!, ids[corners[i + 2]!]!]);
  // Original triangular faces have no alternative diagonal or omitted corner.
  if (ids.length === 3) return triangles;
  restoreBoundary(ids, triangles);

  // Dimensionless area / longest edge squared. Test both the canonical points
  // and the solver's Float32 preparation, but do not remove narrow real faces.
  const rounded = new Map(ids.map((id) => [id, xy[id]!.map(Math.fround) as Point]));
  const quality = (t: Triangle) => {
    const [a, b, c] = t.map((id) => xy[id]!) as [Point, Point, Point];
    const [u, v, w] = t.map((id) => rounded.get(id)!) as [Point, Point, Point];
    return (
      Math.min(area(a, b, c), area(u, v, w)) / Math.max(length2(a, b), length2(b, c), length2(c, a), Number.MIN_VALUE)
    );
  };
  const threshold = 1e-8;
  const pending = triangles.flatMap((t, i) => (quality(t) <= threshold ? [i] : []));
  if (!pending.length) return triangles;

  const edges = new Map<string, Set<number>>();
  const updateEdges = (t: Triangle, index: number, add: boolean) => {
    t.forEach((a, k) => {
      const key = edgeKey(a, t[(k + 1) % 3]!);
      if (add) {
        if (!edges.has(key)) edges.set(key, new Set());
        edges.get(key)!.add(index);
      } else edges.get(key)?.delete(index);
    });
  };
  triangles.forEach((t, i) => updateEdges(t, i, true));
  for (let next = 0; next < pending.length && next < triangles.length * 3; next++) {
    const i = pending[next]!,
      t = triangles[i]!;
    if (quality(t) > threshold) continue;
    let longest = 0;
    for (let k = 1; k < 3; k++)
      if (length2(xy[t[k]!]!, xy[t[(k + 1) % 3]!]!) > length2(xy[t[longest]!]!, xy[t[(longest + 1) % 3]!]!))
        longest = k;
    const u = t[longest]!,
      v = t[(longest + 1) % 3]!,
      middle = t[(longest + 2) % 3]!;
    const adjacent = edges.get(edgeKey(u, v))!;
    if (adjacent.size !== 2) continue; // A genuine narrow boundary, not an artificial ear.
    const j = [...adjacent].find((index) => index !== i)!,
      neighbor = triangles[j]!;
    const opposite = neighbor.find((id) => id !== u && id !== v)!;
    const a: Triangle = [v, middle, opposite],
      b: Triangle = [middle, u, opposite];
    // Positive areas also ensure the replacement diagonal lies in the two
    // original triangles. Refuse a flip that merely moves a degeneracy around.
    if (Math.min(quality(a), quality(b)) <= Math.max(threshold, Math.min(quality(t), quality(neighbor)))) continue;
    updateEdges(t, i, false);
    updateEdges(neighbor, j, false);
    triangles[i] = a;
    triangles[j] = b;
    updateEdges(a, i, true);
    updateEdges(b, j, true);
    // A formerly unrepairable ear may now have a usable neighboring triangle.
    for (const triangle of [a, b])
      triangle.forEach((id, k) => {
        for (const n of edges.get(edgeKey(id, triangle[(k + 1) % 3]!))!)
          if (quality(triangles[n]!) <= threshold) pending.push(n);
      });
  }
  return triangles;
}
