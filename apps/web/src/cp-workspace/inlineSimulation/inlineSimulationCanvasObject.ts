import type {
  CanvasEntry,
  CanvasObjectKindRow,
  TargetOf,
} from '../canvasObjects/canvasObjectKinds';

/**
 * The inline-simulation row of the canvas-object kind table. For a window,
 * focus *is* selection, which is why its selection field is the focused id.
 */
export const inlineSimulationCanvasObjectKind: CanvasObjectKindRow<'inline-simulation'> = {
  kind: 'inline-simulation',
  selectionIdField: 'oristudioCpFocusedInlineSimulationId',
  entriesField: 'oristudioCpInlineSimulations',
  resolve(entry: CanvasEntry, id: string): TargetOf<'inline-simulation'> | null {
    if (!('view' in entry) || entry.id !== id) return null;
    return { kind: 'inline-simulation', id, simulation: entry };
  },
};
