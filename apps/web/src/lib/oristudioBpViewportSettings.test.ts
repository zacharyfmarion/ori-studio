import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BP_PACKING_VIEW_LAYERS,
  DEFAULT_BP_TREE_VIEW_LAYERS,
  isBpPackingLayerVisible,
  normalizeBpPackingViewLayers,
  normalizeBpTreeViewLayers,
  setBpPackingLayerVisibility,
  setBpTreeLayerVisibility,
} from './oristudioBpViewportSettings';

describe('oristudioBpViewportSettings', () => {
  it('normalizes BP tree layer preferences from partial stored values', () => {
    expect(
      normalizeBpTreeViewLayers({
        grid: false,
        labels: 'yes',
      }),
    ).toEqual({
      ...DEFAULT_BP_TREE_VIEW_LAYERS,
      grid: false,
    });
  });

  it('normalizes BP packing layer preferences from partial stored values', () => {
    expect(
      normalizeBpPackingViewLayers({
        hinges: false,
        conflicts: false,
        dots: 0,
      }),
    ).toEqual({
      ...DEFAULT_BP_PACKING_VIEW_LAYERS,
      hinges: false,
      conflicts: false,
    });
  });

  it('updates layer maps immutably', () => {
    const treeLayers = setBpTreeLayerVisibility(DEFAULT_BP_TREE_VIEW_LAYERS, 'labels', false);
    const packingLayers = setBpPackingLayerVisibility(
      DEFAULT_BP_PACKING_VIEW_LAYERS,
      'axisParallels',
      false,
    );

    expect(treeLayers).toEqual({ ...DEFAULT_BP_TREE_VIEW_LAYERS, labels: false });
    expect(DEFAULT_BP_TREE_VIEW_LAYERS.labels).toBe(true);
    expect(packingLayers).toEqual({
      ...DEFAULT_BP_PACKING_VIEW_LAYERS,
      axisParallels: false,
    });
    expect(DEFAULT_BP_PACKING_VIEW_LAYERS.axisParallels).toBe(true);
  });

  it('maps BP graphics layers to persisted packing layer visibility', () => {
    const layers = setBpPackingLayerVisibility(DEFAULT_BP_PACKING_VIEW_LAYERS, 'conflicts', false);

    expect(isBpPackingLayerVisible(layers, 'invalid-junction')).toBe(false);
    expect(isBpPackingLayerVisible(layers, 'flap')).toBe(true);
  });
});
