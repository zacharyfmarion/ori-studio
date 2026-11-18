import type { Point, Point3, Visibility } from './types.js';
import { orderSide } from './visibility.js';

/** Known relations apply to whole display layers, including new overlaps.
 * Witnesses retain the source support; no transitive relation is invented.
 * Opposed witnesses are a known cycle, never an unknown/guessed order. */
export interface SpatialPlane {
  normal: Point3;
  origin: Point3;
  faces: number[];
  groups: number[];
  orders: Point[];
  witnesses: { cell: number; stack: number[] }[];
}

export function spatialPlaneSide(
  plane: Pick<SpatialPlane, 'normal' | 'origin'>,
  eye: Point3,
  previous?: 'front' | 'back'
): 'front' | 'back' {
  const delta = eye.map((v, i) => v - plane.origin[i]);
  const distance = Math.hypot(...delta);
  return orderSide(
    plane.normal.reduce((s, v, i) => s + v * delta[i], 0) /
      Math.max(distance, 1e-20),
    previous
  );
}

/** The executable CPU contract used by picks, vector fragments and GPU masks. */
export function spatialVisibility(
  faceCount: number,
  planes: readonly SpatialPlane[],
  eye: Point3
): Visibility {
  const above = Array.from({ length: faceCount }, () => new Set<number>());
  let work = 0;
  const planeOf = Array<number>(faceCount).fill(-1);
  planes.forEach((plane, id) => {
    const members = new Map<number, number[]>();
    const groupOf = new Map<number, number>();
    plane.faces.forEach((face, i) => {
      if (
        !Number.isInteger(face) ||
        face < 0 ||
        face >= faceCount ||
        planeOf[face] !== -1
      )
        throw new Error('Invalid spatial face identity');
      planeOf[face] = id;
      const group = plane.groups[i];
      if (!Number.isInteger(group))
        throw new Error('Invalid spatial display layer');
      groupOf.set(face, group);
      members.set(group, [...(members.get(group) ?? []), face]);
    });
    const back = spatialPlaneSide(plane, eye) === 'back';
    for (const pair of plane.orders) {
      const [lo, hi] = back ? [pair[1], pair[0]] : pair;
      const lower = groupOf.get(lo),
        upper = groupOf.get(hi);
      if (lower === undefined || upper === undefined)
        throw new Error('Order crosses source planes');
      if (lower === upper) continue;
      for (const l of members.get(lower)!)
        for (const h of members.get(upper)!) {
          if (++work > 250_000)
            throw new Error('Spatial visibility exceeds mask budget');
          above[l].add(h);
        }
    }
  });
  if (planeOf.includes(-1)) throw new Error('Missing spatial face');
  // The mask path is intentional even for DAGs: ranks would invent relations
  // through an absent face, and cannot express independent spatial planes.
  return {
    ranks: null,
    cyclic: true,
    above: above.map((s) => [...s].sort((a, b) => a - b)),
    planeOf,
  };
}
