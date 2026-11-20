import { EDGE_CODE } from '@treemaker/origami-simulator';
import type { SpatialMeshOrder } from '../cp-workspace/folded/folded3dMaterial';
import type { SpatialDrawPlane } from './spatialDrawPlan';
import { spatialInkOwnership } from '../cp-workspace/folded/spatialInkOwnership';

type Range = { start: number; count: number };
export interface SpatialInkOwner {
  plane: SpatialDrawPlane;
  front: readonly Range[];
  back: readonly Range[];
}
export interface SpatialInkGroup {
  owners: SpatialInkOwner[];
  edges: Range;
  /** Whether any of its edges is an aux crease, which every group draws first. */
  hasAux: boolean;
}

/** A hinge has one stroke and an owner on each incident source plane. Both
 * planes' known covers apply: drawing a second copy with only the other
 * plane's masks lets buried hinges poke through their covering paper.
 * Coplanar folds keep their separate owners (either exposed side can draw
 * that outline). Auxiliary segments have their own material vertex IDs. */
export function prepareSpatialInkPlan(
  order: SpatialMeshOrder,
  planes: readonly SpatialDrawPlane[],
  indices: Uint32Array,
  assignments: Uint8Array
): SpatialInkGroup[] {
  const owners: SpatialInkOwner[] = [];
  for (const plane of planes) {
    for (const group of plane.front)
      for (const face of group.faces)
        owners[face] = { plane, front: group.maskRanges, back: [] };
    for (const group of plane.back)
      for (const face of group.faces) owners[face]!.back = group.maskRanges;
  }
  const groups: SpatialInkGroup[] = [];
  spatialInkOwnership(order, indices).forEach((faces, e) => {
    if (!faces) return;
    const row = faces.map((f) => owners[f]!);
    const aux = assignments[e] === EDGE_CODE.aux;
    const previous = groups.at(-1);
    if (
      previous &&
      previous.edges.start + previous.edges.count === e &&
      previous.owners.length === row.length &&
      previous.owners.every((o, i) => o === row[i])
    ) {
      previous.edges.count++;
      previous.hasAux ||= aux;
    } else groups.push({ owners: row, edges: { start: e, count: 1 }, hasAux: aux });
  });
  return groups;
}
