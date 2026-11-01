import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';

/** Packs `(upper, lower)` into one sortable number; faces stay far below it. */
const FACE_SPAN = 2 ** 26;

/**
 * The order a host's paper scene draws, as the relations the Fold bridge's
 * `layer_open_showing` takes (`implementation-plans/layer-order-dialog.md`,
 * row E7): for every subface, each face above each face below it, flat
 * `[upper, lower, …]`, `upper` nearer a viewer of the starting face's front.
 * A rear-pass scene (`flipped`) reads its stacks the other way up. Each pair
 * once, ascending by `(upper, lower)`.
 *
 * It mirrors `oristudio_fold::steer::scene_relations` pair for pair. The host
 * already holds the scene it shows (an Edit figure's, a Diagram step's), so
 * the pairs are read here rather than by sending the whole scene into the
 * wasm to come back as pairs.
 */
export function layerOrderSceneRelations(
  scene: Pick<OristudioCpFoldedPaperScene, 'flipped' | 'subfaces'>
): Uint32Array {
  const keys = new Set<number>();
  for (const { faces_top_to_bottom: stack } of scene.subfaces) {
    for (let i = 0; i < stack.length; i += 1) {
      for (let j = i + 1; j < stack.length; j += 1) {
        const [upper, lower] = scene.flipped ? [stack[j]!, stack[i]!] : [stack[i]!, stack[j]!];
        keys.add(upper * FACE_SPAN + lower);
      }
    }
  }
  const sorted = Array.from(keys).sort((a, b) => a - b);
  const relations = new Uint32Array(sorted.length * 2);
  sorted.forEach((key, i) => {
    relations[2 * i] = Math.floor(key / FACE_SPAN);
    relations[2 * i + 1] = key % FACE_SPAN;
  });
  return relations;
}
