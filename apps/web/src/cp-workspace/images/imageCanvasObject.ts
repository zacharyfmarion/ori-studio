import type {
  CanvasEntry,
  CanvasObjectKindRow,
  TargetOf,
} from '../canvasObjects/canvasObjectKinds';

/** The reference-image row of the canvas-object kind table. */
export const imageCanvasObjectKind: CanvasObjectKindRow<'image'> = {
  kind: 'image',
  selectionIdField: 'oristudioCpSelectedAnnotationId',
  entriesField: 'oristudioCpAnnotations',
  resolve(entry: CanvasEntry, id: string): TargetOf<'image'> | null {
    if (!('kind' in entry) || entry.kind !== 'image' || entry.id !== id) return null;
    return { kind: 'image', id, annotation: entry };
  },
};
