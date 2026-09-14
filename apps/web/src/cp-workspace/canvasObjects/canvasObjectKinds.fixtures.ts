import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import { createCpImage } from '../images/cpImage';
import { createTextAnnotation } from '../annotations/textAnnotation';
import { createCpSuppressionRegion } from '../annotations/suppressionRegion';
import type { InlineSimulation } from '../inlineSimulation/inlineSimulation';
import type { CanvasSelectionFields } from './canvasObjectKinds';

/**
 * Test fixtures for the canvas-object kind table: one entry of every kind plus
 * an empty selection. A `.fixtures.ts` module so the kind tests, the hook test
 * and the store invariant test seed the same objects.
 */

export const IMAGE = createCpImage({
  id: 'image-1',
  src: 'data:image/png;base64,AAAA',
  naturalWidth: 10,
  naturalHeight: 10,
  center: { x: 0, y: 0 },
  width: 1,
  height: 1,
});

export const TEXT = createTextAnnotation({ id: 'text-1', center: { x: 0.5, y: 0.5 } });

export const REGION = createCpSuppressionRegion({
  id: 'region-1',
  center: { x: 0.5, y: 0.5 },
  width: 0.4,
  height: 0.4,
});

export const SOLVE_REGION = createCpSuppressionRegion({
  id: 'region-solve',
  center: { x: 0.5, y: 0.5 },
  width: 0.4,
  height: 0.4,
  solveInput: { schema: 'test' },
});

export function foldedFigure(
  id: string,
  sourceKind: OristudioCpFoldedFigureEntry['sourceKind'] = 'generated-from-current-cp'
): OristudioCpFoldedFigureEntry {
  return {
    id,
    title: id,
    handle: null,
    sourceKind,
    sourceCpRevision: 0,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'loading',
    snapshot: null,
    renderSnapshot: null,
    placement: IDENTITY_FOLDED_PLACEMENT,
    error: null,
  };
}

export const FIGURE = foldedFigure('figure-1');
export const IMPORTED_FIGURE = foldedFigure('figure-imported', 'imported-folded-form');

export const WINDOW: InlineSimulation = {
  id: 'inline-simulation-1',
  box: { center: { x: 0, y: 0 }, width: 120, height: 120, rotation: 0 },
  z: 1,
  view: { yaw: 0, pitch: 0, zoom: 1 },
  sourceBoundary: null,
  sourceBounds: null,
  sourceFingerprint: null,
  segmentIdHint: null,
};

export function selectionFields(
  patch: Partial<CanvasSelectionFields> = {}
): CanvasSelectionFields {
  return {
    oristudioCpSelectedAnnotationId: null,
    oristudioCpActiveFoldedFigureId: null,
    oristudioCpFocusedInlineSimulationId: null,
    oristudioCpAnnotations: [IMAGE, TEXT, REGION, SOLVE_REGION],
    oristudioCpFoldedFigures: [FIGURE, IMPORTED_FIGURE],
    oristudioCpInlineSimulations: [WINDOW],
    ...patch,
  };
}
