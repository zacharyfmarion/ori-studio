/** Texture coordinates follow the prepared, unfolded sheet, never the current pose. */
export type SheetUvFailure = 'invalid-sheet' | 'nonplanar-sheet';

export type SheetUvs =
  | { uvs: Float32Array; reason: null }
  | { uvs: null; reason: SheetUvFailure };

/**
 * Upstream saveSTL.js::saveOBJ normalizes X/Z by their longest span. One scale
 * preserves the sheet's aspect and the relative placement of disconnected
 * pieces. Ori Studio already lifts its y-down input to [x, 0, -y], so there is
 * no second vertical flip here. All indices belong to the prepared mesh.
 */
export function sheetUvs(rest: Float32Array): SheetUvs {
  if (rest.length < 9 || rest.length % 3 !== 0 || !rest.every(Number.isFinite)) {
    return { uvs: null, reason: 'invalid-sheet' };
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < rest.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, rest[i + axis]!);
      max[axis] = Math.max(max[axis]!, rest[i + axis]!);
    }
  }
  const width = max[0]! - min[0]!;
  const height = max[2]! - min[2]!;
  const span = Math.max(width, height);
  const outOfPlane = max[1]! - min[1]!;
  if (outOfPlane > Math.max(span, outOfPlane) * 1e-6) {
    return { uvs: null, reason: 'nonplanar-sheet' };
  }
  if (!(width > 0 && height > 0)) return { uvs: null, reason: 'invalid-sheet' };
  const uvs = new Float32Array((rest.length / 3) * 2);
  for (let i = 0; i < rest.length / 3; i += 1) {
    uvs[i * 2] = (rest[i * 3]! - min[0]!) / span;
    uvs[i * 2 + 1] = (rest[i * 3 + 2]! - min[2]!) / span;
  }
  return { uvs, reason: null };
}
