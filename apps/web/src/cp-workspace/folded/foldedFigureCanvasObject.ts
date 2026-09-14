import type {
  CanvasEntry,
  CanvasObjectKindRow,
  TargetOf,
} from '../canvasObjects/canvasObjectKinds';
import { isFoldedFromCurrentCpSourceKind } from '../../engine/oristudioCpTypes';

/**
 * The folded-figure row of the canvas-object kind table.
 *
 * Only generated figures resolve — the same `isFoldedFromCurrentCpSourceKind`
 * test `useFoldedFigures` applies before it will call a figure selected, so an
 * imported or preserved-frame figure is never a target here while the toolbar
 * declines it there. Readiness is not a condition: a figure mid-fold or in
 * error is still the selected object, and it is the properties catalog that
 * answers what can be edited on it.
 */
export const foldedFigureCanvasObjectKind: CanvasObjectKindRow<'folded-figure'> = {
  kind: 'folded-figure',
  selectionIdField: 'oristudioCpActiveFoldedFigureId',
  entriesField: 'oristudioCpFoldedFigures',
  resolve(entry: CanvasEntry, id: string): TargetOf<'folded-figure'> | null {
    if (!('sourceKind' in entry) || entry.id !== id) return null;
    if (!isFoldedFromCurrentCpSourceKind(entry.sourceKind)) return null;
    return { kind: 'folded-figure', id, figure: entry };
  },
};
