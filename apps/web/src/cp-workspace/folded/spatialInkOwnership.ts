import type { SpatialMeshOrder } from './folded3dMaterial';

/** A shared hinge is drawn once, subject to both incident planes' covers.
 * Coplanar folds keep independent copies: either exposed face can draw the
 * outline of a 180-degree fold. Auxiliary pieces have their own vertex IDs.
 * Undefined entries are the duplicate hinge copies, retained as hidden ink. */
export function spatialInkOwnership(
  order: SpatialMeshOrder,
  indices: Uint32Array
): (readonly number[] | undefined)[] {
  const planeOf: number[] = [];
  order.planes.forEach((plane, p) =>
    plane.faces.forEach((f) => {
      planeOf[f] = p;
    })
  );
  const key = (e: number) => {
    const a = indices[2 * e]!,
      b = indices[2 * e + 1]!;
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  };
  const incident = new Map<string, number[]>();
  order.edgeFaces.forEach((face, e) => {
    const id = key(e),
      faces = incident.get(id) ?? [];
    if (!faces.includes(face)) faces.push(face);
    incident.set(id, faces);
  });
  const seen = new Set<string>();
  return order.edgeFaces.map((face, e) => {
    const id = key(e),
      faces = incident.get(id)!;
    if (!faces.some((f) => planeOf[f] !== planeOf[face])) return [face];
    if (seen.has(id)) return undefined;
    seen.add(id);
    return faces;
  });
}

/** Shared crease visibility is the intersection of its owners' visible runs. */
export function intersectInkIntervals(
  a: readonly [number, number][],
  b: readonly [number, number][]
): [number, number][] {
  const result: [number, number][] = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i]![0], b[j]![0]),
      hi = Math.min(a[i]![1], b[j]![1]);
    if (hi > lo) result.push([lo, hi]);
    if (a[i]![1] < b[j]![1]) i++;
    else j++;
  }
  return result;
}
