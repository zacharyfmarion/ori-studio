import type { OristudioBpLayerId } from '../engine/oristudioBpTypes';

export const BP_TREE_VIEW_LAYER_KEYS = ['grid', 'labels', 'leafCircles'] as const;
export type BpTreeViewLayerKey = (typeof BP_TREE_VIEW_LAYER_KEYS)[number];
export type BpTreeViewLayers = Record<BpTreeViewLayerKey, boolean>;

export const DEFAULT_BP_TREE_VIEW_LAYERS: BpTreeViewLayers = {
  grid: true,
  labels: true,
  leafCircles: true,
};

export const BP_PACKING_VIEW_LAYER_KEYS = [
  'grid',
  'flaps',
  'clearance',
  'dots',
  'labels',
  'rivers',
  'hinges',
  'ridges',
  'axisParallels',
  'conflicts',
  'devices',
  'selectionShade',
] as const;
export type BpPackingViewLayerKey = (typeof BP_PACKING_VIEW_LAYER_KEYS)[number];
export type BpPackingViewLayers = Record<BpPackingViewLayerKey, boolean>;

export const DEFAULT_BP_PACKING_VIEW_LAYERS: BpPackingViewLayers = {
  grid: true,
  flaps: true,
  clearance: true,
  dots: true,
  labels: true,
  rivers: true,
  hinges: true,
  ridges: true,
  axisParallels: true,
  conflicts: true,
  devices: true,
  selectionShade: true,
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeBooleanLayerMap<TKey extends string>(
  value: unknown,
  defaults: Record<TKey, boolean>,
  keys: readonly TKey[]
): Record<TKey, boolean> {
  const record = asRecord(value);
  const normalized = { ...defaults };
  for (const key of keys) {
    const layerValue = record[key];
    normalized[key] = typeof layerValue === 'boolean' ? layerValue : defaults[key];
  }
  return normalized;
}

export function normalizeBpTreeViewLayers(value: unknown): BpTreeViewLayers {
  return normalizeBooleanLayerMap(
    value,
    DEFAULT_BP_TREE_VIEW_LAYERS,
    BP_TREE_VIEW_LAYER_KEYS
  ) as BpTreeViewLayers;
}

export function normalizeBpPackingViewLayers(value: unknown): BpPackingViewLayers {
  return normalizeBooleanLayerMap(
    value,
    DEFAULT_BP_PACKING_VIEW_LAYERS,
    BP_PACKING_VIEW_LAYER_KEYS
  ) as BpPackingViewLayers;
}

export function setBpTreeLayerVisibility(
  layers: BpTreeViewLayers,
  layer: BpTreeViewLayerKey,
  visible: boolean
): BpTreeViewLayers {
  return { ...layers, [layer]: visible };
}

export function setBpPackingLayerVisibility(
  layers: BpPackingViewLayers,
  layer: BpPackingViewLayerKey,
  visible: boolean
): BpPackingViewLayers {
  return { ...layers, [layer]: visible };
}

export function isBpPackingLayerVisible(
  layers: BpPackingViewLayers,
  layer: OristudioBpLayerId
): boolean {
  switch (layer) {
    case 'grid':
    case 'sheet-border':
      return layers.grid;
    case 'flap':
      return layers.flaps;
    case 'flap-clearance':
      return layers.clearance;
    case 'flap-dot':
      return layers.dots;
    case 'flap-label':
      return layers.labels;
    case 'river':
      return layers.rivers;
    case 'hinge':
      return layers.hinges;
    case 'ridge':
      return layers.ridges;
    case 'axis-parallel':
      return layers.axisParallels;
    case 'invalid-junction':
      return layers.conflicts;
    case 'stretch':
    case 'device':
      return layers.devices;
    case 'selection-shade':
      return layers.selectionShade;
  }
}
