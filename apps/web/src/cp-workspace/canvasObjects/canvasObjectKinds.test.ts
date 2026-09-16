import { describe, expect, it } from 'vitest';
import {
  CANVAS_OBJECT_KINDS,
  CANVAS_SELECTION_ID_FIELDS,
  canvasObjectKindOf,
  resolveCanvasObjectById,
  resolveSelectedCanvasObject,
  selectedCanvasObjectIdOf,
  type CanvasObjectKindRow,
  type CanvasObjectKindTable,
} from './canvasObjectKinds';
import { selectedCanvasObjectId } from './transformableObject';
import {
  FIGURE,
  IMAGE,
  IMPORTED_FIGURE,
  REGION,
  SOLVE_REGION,
  TEXT,
  WINDOW,
  selectionFields,
} from './canvasObjectKinds.fixtures';

describe('canvas object kind table', () => {
  it('derives the selection precedence from the table in table order', () => {
    expect(CANVAS_SELECTION_ID_FIELDS).toEqual([
      'oristudioCpSelectedAnnotationId',
      'oristudioCpActiveFoldedFigureId',
      'oristudioCpFocusedInlineSimulationId',
    ]);
    // The precedence the panel-facing adapter has always had.
    const both = selectionFields({
      oristudioCpSelectedAnnotationId: IMAGE.id,
      oristudioCpActiveFoldedFigureId: FIGURE.id,
    });
    expect(selectedCanvasObjectIdOf(both)).toBe(IMAGE.id);
    expect(
      selectedCanvasObjectId({
        annotationId: IMAGE.id,
        foldedFigureId: FIGURE.id,
        inlineSimulationId: WINDOW.id,
      })
    ).toBe(IMAGE.id);
    expect(
      selectedCanvasObjectId({ annotationId: null, foldedFigureId: null, inlineSimulationId: WINDOW.id })
    ).toBe(WINDOW.id);
  });

  it('resolves each kind to its own target', () => {
    expect(
      resolveSelectedCanvasObject(selectionFields({ oristudioCpSelectedAnnotationId: IMAGE.id }))
    ).toEqual({ kind: 'image', id: IMAGE.id, annotation: IMAGE });
    expect(
      resolveSelectedCanvasObject(selectionFields({ oristudioCpSelectedAnnotationId: TEXT.id }))
    ).toEqual({ kind: 'text', id: TEXT.id, annotation: TEXT });
    expect(
      resolveSelectedCanvasObject(selectionFields({ oristudioCpActiveFoldedFigureId: FIGURE.id }))
    ).toEqual({ kind: 'folded-figure', id: FIGURE.id, figure: FIGURE });
    expect(
      resolveSelectedCanvasObject(
        selectionFields({ oristudioCpFocusedInlineSimulationId: WINDOW.id })
      )
    ).toEqual({ kind: 'inline-simulation', id: WINDOW.id, simulation: WINDOW });
  });

  it('tells a solve region from a plain region by its attached solve input, not a kind', () => {
    const plain = resolveSelectedCanvasObject(
      selectionFields({ oristudioCpSelectedAnnotationId: REGION.id })
    );
    const solve = resolveSelectedCanvasObject(
      selectionFields({ oristudioCpSelectedAnnotationId: SOLVE_REGION.id })
    );
    expect(plain).toEqual({
      kind: 'suppressionRegion',
      id: REGION.id,
      annotation: REGION,
      solvable: false,
    });
    expect(solve).toMatchObject({ kind: 'suppressionRegion', solvable: true });
  });

  it('resolves nothing for a dangling id or an empty selection', () => {
    expect(resolveSelectedCanvasObject(selectionFields())).toBeNull();
    expect(
      resolveSelectedCanvasObject(selectionFields({ oristudioCpSelectedAnnotationId: 'gone' }))
    ).toBeNull();
    expect(
      resolveSelectedCanvasObject(selectionFields({ oristudioCpActiveFoldedFigureId: 'gone' }))
    ).toBeNull();
    expect(canvasObjectKindOf(selectionFields(), 'gone')).toBeNull();
  });

  it('declines an imported folded figure, as the toolbar does', () => {
    expect(
      resolveSelectedCanvasObject(
        selectionFields({ oristudioCpActiveFoldedFigureId: IMPORTED_FIGURE.id })
      )
    ).toBeNull();
    expect(canvasObjectKindOf(selectionFields(), IMPORTED_FIGURE.id)).toBeNull();
  });

  it('answers the kind of any id, selected or not', () => {
    const state = selectionFields();
    expect(canvasObjectKindOf(state, IMAGE.id)).toBe('image');
    expect(canvasObjectKindOf(state, TEXT.id)).toBe('text');
    expect(canvasObjectKindOf(state, REGION.id)).toBe('suppressionRegion');
    expect(canvasObjectKindOf(state, FIGURE.id)).toBe('folded-figure');
    expect(canvasObjectKindOf(state, WINDOW.id)).toBe('inline-simulation');
    expect(resolveCanvasObjectById(state, WINDOW.id)?.kind).toBe('inline-simulation');
  });

  it('reads a stub kind through the same loop with no edit to the resolvers', () => {
    // A stub row that answers for windows under a new name, to prove the loop
    // is driven by the table and not by a hand-written switch.
    const stub: CanvasObjectKindRow<'inline-simulation'> = {
      ...CANVAS_OBJECT_KINDS['inline-simulation'],
      resolve: (entry, id) =>
        'view' in entry && entry.id === id
          ? { kind: 'inline-simulation', id, simulation: entry }
          : null,
    };
    const kinds: CanvasObjectKindTable = {
      ...CANVAS_OBJECT_KINDS,
      'inline-simulation': stub,
    };
    expect(
      resolveSelectedCanvasObject(
        selectionFields({ oristudioCpFocusedInlineSimulationId: WINDOW.id }),
        kinds
      )
    ).toMatchObject({ kind: 'inline-simulation', id: WINDOW.id });
  });
});
