import { describe, expect, it } from 'vitest';
import {
  annotationAsTransformable,
  foldedFigureAsTransformable,
  selectedCanvasObjectId,
} from './transformableObject';
import { createCpImage } from '../images/cpImage';
import { createTextAnnotation } from '../annotations/textAnnotation';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import type {
  FoldedFigurePlacement,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedRenderPrimitive,
} from '../../engine/oristudioCpTypes';

function image() {
  return createCpImage({
    src: 'data:image/png;base64,AAAA',
    naturalWidth: 10,
    naturalHeight: 10,
    center: { x: 2, y: 3 },
    width: 4,
    height: 2,
  });
}

const squarePrimitive: OristudioCpFoldedRenderPrimitive = {
  sequence: 0,
  kind: 'fill_polygon',
  style: {
    paint: { kind: 'color', color: { red: 255, green: 0, blue: 0, alpha: 255 } },
    stroke: { kind: 'none' },
    antialias: 'default',
  },
  geometry: {
    kind: 'polygon',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  },
};

function foldedFigure(
  placement: FoldedFigurePlacement = IDENTITY_FOLDED_PLACEMENT,
  primitives: OristudioCpFoldedRenderPrimitive[] = [squarePrimitive]
): OristudioCpFoldedFigureEntry {
  return {
    id: 'generated-1',
    title: 'Folded model 1',
    handle: 1,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: null,
    startingFaceId: null,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    renderSnapshot: { schema_version: 1, fixture: null, pass: null, primitives },
    placement,
    error: null,
  };
}

describe('annotationAsTransformable', () => {
  it('projects an image to a model-space box that keeps its aspect unless Shift', () => {
    const object = annotationAsTransformable(image());
    expect(object.space).toBe('model');
    expect(object.box).toEqual({
      center: { x: 2, y: 3 },
      width: 4,
      height: 2,
      rotation: 0,
    });
    expect(object.aspectLock).toBe('default-on');
  });

  it('leaves a text box free to resize by default', () => {
    const object = annotationAsTransformable(createTextAnnotation({ center: { x: 0, y: 0 } }));
    expect(object.space).toBe('model');
    expect(object.aspectLock).toBe('default-off');
  });

  it('carries lock and hide through', () => {
    const locked = annotationAsTransformable({ ...image(), locked: true, hidden: true });
    expect(locked.locked).toBe(true);
    expect(locked.hidden).toBe(true);
  });
});

describe('foldedFigureAsTransformable', () => {
  it('projects to a user-space box that is always proportional', () => {
    const object = foldedFigureAsTransformable(foldedFigure())!;
    expect(object.space).toBe('user');
    expect(object.aspectLock).toBe('always');
    expect(object.box.width).toBeGreaterThan(0);
    expect(object.box.height).toBeGreaterThan(0);
  });

  it('reflects the placement in the box', () => {
    const base = foldedFigureAsTransformable(foldedFigure())!;
    const placed = foldedFigureAsTransformable(
      foldedFigure({ offset: { x: 30, y: -10 }, scale: 2, rotation: 0.75 })
    )!;
    expect(placed.box.center.x).toBeCloseTo(base.box.center.x + 30);
    expect(placed.box.center.y).toBeCloseTo(base.box.center.y - 10);
    expect(placed.box.width).toBeCloseTo(base.box.width * 2);
    expect(placed.box.rotation).toBeCloseTo(0.75);
  });

  it('is null for a figure with nothing drawable, so it cannot be grabbed', () => {
    expect(foldedFigureAsTransformable(foldedFigure(IDENTITY_FOLDED_PLACEMENT, []))).toBeNull();
    expect(
      foldedFigureAsTransformable({ ...foldedFigure(), renderSnapshot: null })
    ).toBeNull();
  });
});

describe('which canvas object holds the selection', () => {
  const none = { annotationId: null, foldedFigureId: null, inlineSimulationId: null };

  it('is null when nothing is selected', () => {
    expect(selectedCanvasObjectId(none)).toBeNull();
  });

  it('names an inline simulation window', () => {
    // The overlay draws handles for this id and no other, so omitting windows
    // here left them with no way to resize or rotate at all.
    expect(selectedCanvasObjectId({ ...none, inlineSimulationId: 'sim-1' })).toBe('sim-1');
  });

  it('names an annotation', () => {
    expect(selectedCanvasObjectId({ ...none, annotationId: 'img-1' })).toBe('img-1');
  });

  it('names a folded figure', () => {
    expect(selectedCanvasObjectId({ ...none, foldedFigureId: 'fig-1' })).toBe('fig-1');
  });

  it('resolves a transient overlap rather than returning nothing', () => {
    // The three clear each other on select, so this only covers the frame
    // between two store writes; it must still name exactly one.
    expect(
      selectedCanvasObjectId({
        annotationId: 'img-1',
        foldedFigureId: 'fig-1',
        inlineSimulationId: 'sim-1',
      })
    ).toBe('img-1');
  });
});
