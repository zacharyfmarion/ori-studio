import { describe, expect, it, vi } from 'vitest';
import type { CanvasObjectKind } from './canvasObjectKinds';
import { mergeCanvasLayerBindings, type CanvasLayerBinding } from './canvasLayerBindings';
import type { TransformableCanvasObject } from './transformableObject';

/**
 * The merge is pure: concatenate what the layers project, and dispatch an id
 * to the layer whose kinds include the kind the table says it is.
 */
function transformable(id: string): TransformableCanvasObject {
  return {
    id,
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    rotation: 0,
    aspectLock: 'free',
  } as unknown as TransformableCanvasObject;
}

function binding(kinds: CanvasObjectKind[], ids: string[]): CanvasLayerBinding {
  return {
    kinds,
    transformables: ids.map(transformable),
    overlayBoxes: ids.map(() => ({
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      rotation: 0,
      hidden: false,
    })),
    inertBodyIds: new Set(ids.filter((id) => id.startsWith('inert'))),
    select: vi.fn(),
    release: vi.fn(),
    applyBoxUpdate: vi.fn(),
    beginGesture: vi.fn(() => true),
    commitGesture: vi.fn(),
    cancelGesture: vi.fn(),
    remove: vi.fn(),
    contextMenu: vi.fn(() => null),
  };
}

const KIND_OF: Record<string, CanvasObjectKind> = {
  'image-1': 'image',
  'text-1': 'text',
  'inert-region': 'suppressionRegion',
  'figure-1': 'folded-figure',
  'inert-window': 'inline-simulation',
};
const kindOf = (id: string) => KIND_OF[id] ?? null;

describe('mergeCanvasLayerBindings', () => {
  it('concatenates every layer in order and unions the inert bodies', () => {
    const annotations = binding(['image', 'text', 'suppressionRegion'], ['image-1', 'text-1', 'inert-region']);
    const folded = binding(['folded-figure'], ['figure-1']);
    const windows = binding(['inline-simulation'], ['inert-window']);
    const merged = mergeCanvasLayerBindings([annotations, folded, windows], kindOf);

    expect(merged.transformables.map((object) => object.id)).toEqual([
      'image-1',
      'text-1',
      'inert-region',
      'figure-1',
      'inert-window',
    ]);
    expect(merged.overlayBoxes).toHaveLength(5);
    expect([...merged.inertBodyIds].sort()).toEqual(['inert-region', 'inert-window']);
  });

  it('dispatches an id to the layer that answers for its kind', () => {
    const annotations = binding(['image', 'text', 'suppressionRegion'], ['image-1']);
    const folded = binding(['folded-figure'], ['figure-1']);
    const windows = binding(['inline-simulation'], ['inert-window']);
    const merged = mergeCanvasLayerBindings([annotations, folded, windows], kindOf);

    expect(merged.byId('image-1')).toBe(annotations);
    expect(merged.byId('inert-region')).toBe(annotations);
    expect(merged.byId('figure-1')).toBe(folded);
    expect(merged.byId('inert-window')).toBe(windows);
    // An id the table does not know reaches no layer, whatever shape it has.
    expect(merged.byId('image-9')).toBeNull();
  });

  it('releases every layer, each its own way', () => {
    const layers = [binding(['image'], []), binding(['folded-figure'], [])];
    mergeCanvasLayerBindings(layers, kindOf).releaseAll();
    for (const layer of layers) expect(layer.release).toHaveBeenCalledTimes(1);
  });

  it('takes a new kind as one more binding, with no dispatch edit', () => {
    // The point of the shape: a kind the table gains is a row in the table and
    // a binding from its layer; nothing in the merge names one.
    const stubKind = 'stub' as CanvasObjectKind;
    const stub = binding([stubKind], ['stub-1']);
    const merged = mergeCanvasLayerBindings(
      [binding(['image'], ['image-1']), stub],
      (id) => (id === 'stub-1' ? stubKind : kindOf(id))
    );
    expect(merged.byId('stub-1')).toBe(stub);
    merged.byId('stub-1')?.applyBoxUpdate('stub-1', { width: 2 });
    expect(stub.applyBoxUpdate).toHaveBeenCalledWith('stub-1', { width: 2 });
    expect(merged.byId('stub-1')?.beginGesture('stub-1')).toBe(true);
  });
});
