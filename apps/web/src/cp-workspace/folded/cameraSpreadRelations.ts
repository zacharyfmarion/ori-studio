/** Solved partial order, independent of the arbitrary order used to paint flat faces. */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { CameraPaintPiece } from './cameraSpreadVisibility';

export interface CameraLayerRelations {
  count: number;
  /** Row = covered face, column = covering face: 1 above, 2 below, 3 same woven component. */
  data: Uint8Array;
}
const cache = new WeakMap<OristudioCpFoldedPaperScene, CameraLayerRelations>();

export function cameraLayerRelations(kernel: OristudioCpFoldedPaperScene): CameraLayerRelations {
  const held = cache.get(kernel);
  if (held) return held;
  const count = kernel.faces.length;
  const data = new Uint8Array(count * count);
  const below = Array.from({ length: count }, () => new Set<number>());
  for (const { faces_top_to_bottom: stack } of kernel.subfaces)
    for (let i = 1; i < stack.length; i++) below[stack[i - 1]!]!.add(stack[i]!);
  const visited = new Int32Array(count).fill(-1);
  for (let upper = 0; upper < count; upper++) {
    const pending = [upper];
    while (pending.length) {
      const lower = pending.pop()!;
      if (visited[lower] === upper) continue;
      visited[lower] = upper;
      data[lower * count + upper]! |= 1;
      data[upper * count + lower]! |= 2;
      pending.push(...below[lower]!);
    }
  }
  const result = { count, data };
  cache.set(kernel, result);
  return result;
}

/** Woven cycles keep their local patch plan; incomparable faces never mask each other. */
export function cameraLayerCovers(
  relations: CameraLayerRelations,
  cover: Pick<CameraPaintPiece, 'face' | 'rank'>,
  covered: Pick<CameraPaintPiece, 'face' | 'rank'>,
  back: boolean
): boolean {
  const relation = relations.data[covered.face * relations.count + cover.face];
  if (relation === 3) return cover.rank > covered.rank;
  return relation === (back ? 2 : 1);
}
