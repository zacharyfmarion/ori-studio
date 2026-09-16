import type {
  CanvasEntry,
  CanvasObjectKindRow,
  TargetOf,
} from '../canvasObjects/canvasObjectKinds';
import { hasAttachedSolveInput } from '../annotations/suppressionRegion';

/**
 * The region row of the canvas-object kind table. A detection solve region is
 * the same kind with `solvable` set — decided by the attached solve input, the
 * same data predicate the chip and the menu command use, never by geometry.
 */
export const regionCanvasObjectKind: CanvasObjectKindRow<'suppressionRegion'> = {
  kind: 'suppressionRegion',
  selectionIdField: 'oristudioCpSelectedAnnotationId',
  entriesField: 'oristudioCpAnnotations',
  resolve(entry: CanvasEntry, id: string): TargetOf<'suppressionRegion'> | null {
    if (!('kind' in entry) || entry.kind !== 'suppressionRegion' || entry.id !== id) return null;
    return {
      kind: 'suppressionRegion',
      id,
      annotation: entry,
      solvable: hasAttachedSolveInput(entry),
    };
  },
};
