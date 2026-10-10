import type { DiagramPleatKinks, KnownDiagramAnnotation } from '../document/diagramDocument';
import type { PicturePoint } from './annotationModel';

/** A pleat arrow from `from` to `to`, its Zs unsaid when one, as the model writes one. */
function pleat(
  id: string,
  from: PicturePoint,
  to: PicturePoint,
  kinks?: DiagramPleatKinks,
  mirrored?: true
): KnownDiagramAnnotation {
  return { id, kind: 'pleat-arrow', from, to, ...(kinks ? { kinks } : {}), ...(mirrored ? { mirrored } : {}) };
}

/**
 * The pleat arrows (Phase 15c) a card, a page and the canvas are checked
 * against: a crimp's one Z, rising, as Zach's step 129 has; a pleat's two, as
 * step 92's; three and five along a level arrow; one mirrored; one too short
 * for its Z, drawn smaller; and one starting off the picture.
 */
export const PLEAT_ARROW_CASES: readonly KnownDiagramAnnotation[] = [
  pleat('crimp', [0.62, 0.42], [0.18, 0.5]),
  pleat('pleat', [0.2, 0.62], [0.58, 0.24], 2),
  pleat('three', [0.1, 0.3], [0.9, 0.3], 3),
  pleat('five', [0.08, 0.6], [0.92, 0.6], 5),
  pleat('mirrored', [0.25, 0.15], [0.8, 0.2], undefined, true),
  pleat('short', [0.45, 0.45], [0.53, 0.43]),
  pleat('off-picture', [-0.12, 0.5], [0.35, 0.5]),
];
