import { useMemo } from 'react';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { foldPaneSpreadMap, type FoldPaneSpreadMap } from './foldPaneSpreadMap';
import { foldPickIndex, type FoldPickIndex } from './foldPicking';
import type { FoldStateView } from './useFoldStateView';

/** The folded pane's spread as what is picked and drawn over the paper reads it. */
export interface FoldPaneSpread {
  /** Where the pane draws the paper; null while it draws the scene as it is. */
  map: FoldPaneSpreadMap | null;
  /**
   * What the panes are picked through: the state's own index, or — while the
   * folded pane is spread — one whose folded targets are where they are
   * drawn. Null until the state's scene is in.
   */
  index: FoldPickIndex | null;
}

/**
 * The folded pane's spread (`foldPaneSpreadMap`) for the state on screen, at
 * `spread` — the one the pane paints with (`restingSpread`) — and the pick
 * index that finds the paper where the pane draws it: so the point under the
 * pointer is the point the reader sees there, its hover ring is drawn on it,
 * and a step's letters sit on the references they name. Built once per scene
 * and spread.
 */
export function useFoldPaneSpread(view: FoldStateView, spread: LayerSpreadOptions | null): FoldPaneSpread {
  const { scene, index, landmarks, markPoints } = view;
  const map = useMemo(() => (scene && spread ? foldPaneSpreadMap(scene, spread) : null), [scene, spread]);
  const picking = useMemo(
    // The index is the shown scene's once it is in; the map is that scene's spread.
    () => (index && map && index.scene === scene ? foldPickIndex(index.scene, landmarks, markPoints, map) : index),
    [index, map, scene, landmarks, markPoints]
  );
  return useMemo(() => ({ map, index: picking }), [map, picking]);
}
