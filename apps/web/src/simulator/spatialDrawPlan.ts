import {
  spatialPlaneSide,
  spatialVisibility,
  type SpatialPlane,
} from '@oristudio/layer-spread';
import type { SpatialMeshOrder } from '../cp-workspace/folded/folded3dMaterial';
import type { Folded3dRange } from '../cp-workspace/folded/folded3dMesh';

export interface SpatialDrawGroup {
  faces: number[];
  blockers: readonly number[];
  maskRanges: { start: number; count: number }[];
}
export interface SpatialDrawPlane {
  plane: SpatialPlane;
  cyclic: boolean;
  front: SpatialDrawGroup[];
  back: SpatialDrawGroup[];
}

/** Immutable per-mesh schedules. Only the eye's side of each source plane
 * changes during orbit; rebuilding the expanded relations per frame is waste.
 * Adjacent faces with identical blockers can share a mask. Preserve face order
 * so equal-depth ties keep the same winner as the unbatched renderer. */
export function prepareSpatialDrawPlan(
  order: SpatialMeshOrder
): SpatialDrawPlane[] {
  const eye: [number, number, number] = [0, 0, 0];
  const { above } = spatialVisibility(order.ranges.length, order.planes, eye);
  const below = above.map(() => [] as number[]);
  above.forEach((blockers, face) =>
    blockers.forEach((b) => below[b]!.push(face))
  );
  return order.planes.map((plane) => {
    const front = spatialPlaneSide(plane, eye) === 'front';
    return {
      plane,
      cyclic: hasCycle(plane.faces, above),
      front: groupRuns(plane.faces, front ? above : below, order.ranges),
      back: groupRuns(plane.faces, front ? below : above, order.ranges),
    };
  });
}

function groupRuns(
  faces: readonly number[],
  above: readonly number[][],
  ranges: readonly Folded3dRange[]
): SpatialDrawGroup[] {
  const groups: SpatialDrawGroup[] = [];
  for (const face of faces) {
    const blockers = above[face]!;
    const previous = groups.at(-1);
    if (
      previous &&
      previous.blockers.length === blockers.length &&
      previous.blockers.every((b, i) => b === blockers[i])
    ) {
      previous.faces.push(face);
    } else
      groups.push({
        faces: [face],
        blockers,
        maskRanges: mergeMaskRanges(blockers, ranges),
      });
  }
  return groups;
}

/** Mask draws only union coverage, so adjacent index runs can be submitted in
 * one call. Never bridge a gap: that would add an unrelated blocker. Actual
 * painted faces retain their individual draws and original tie ordering. */
function mergeMaskRanges(
  blockers: readonly number[],
  ranges: readonly Folded3dRange[]
) {
  const merged: { start: number; count: number }[] = [];
  for (const face of blockers) {
    const { faceIndexStart: start, faceIndexCount: count } = ranges[face]!;
    if (!count) continue;
    const previous = merged.at(-1);
    if (previous && previous.start + previous.count === start)
      previous.count += count;
    else merged.push({ start, count });
  }
  return merged;
}

/** A DAG cannot have an all-masked pixel: any nonempty covering subset has a
 * maximal member. Cycles still need the exact per-pixel survivor union and
 * fallback; this check never replaces direct blockers with transitive ranks. */
function hasCycle(
  faces: readonly number[],
  above: readonly number[][]
): boolean {
  const indegree = new Map(faces.map((f) => [f, 0]));
  for (const f of faces)
    for (const b of above[f]!) indegree.set(b, indegree.get(b)! + 1);
  const ready = faces.filter((f) => indegree.get(f) === 0);
  for (let i = 0; i < ready.length; i++) {
    for (const b of above[ready[i]!]!) {
      const remaining = indegree.get(b)! - 1;
      indegree.set(b, remaining);
      if (!remaining) ready.push(b);
    }
  }
  return ready.length !== faces.length;
}
