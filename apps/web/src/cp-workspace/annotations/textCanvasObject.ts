import type {
  CanvasEntry,
  CanvasObjectKindRow,
  TargetOf,
} from '../canvasObjects/canvasObjectKinds';

/** The text-box row of the canvas-object kind table. */
export const textCanvasObjectKind: CanvasObjectKindRow<'text'> = {
  kind: 'text',
  selectionIdField: 'oristudioCpSelectedAnnotationId',
  entriesField: 'oristudioCpAnnotations',
  resolve(entry: CanvasEntry, id: string): TargetOf<'text'> | null {
    if (!('kind' in entry) || entry.kind !== 'text' || entry.id !== id) return null;
    return { kind: 'text', id, annotation: entry };
  },
};
