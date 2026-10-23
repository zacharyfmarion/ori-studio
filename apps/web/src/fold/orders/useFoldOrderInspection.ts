import { useState } from 'react';
import type { FoldScene } from '../engine/foldEngineWire';

export function orderStackRegions(scene: FoldScene, baseline: FoldScene | null) {
  const previous = new Map(baseline?.subfaces.map((cell) => [JSON.stringify(cell.polygon), cell.faces_top_to_bottom.join(',')]));
  return scene.subfaces.filter((cell) => cell.faces_top_to_bottom.length > 1).map((cell, index) => ({
    ...cell, index,
    changed: baseline !== null && previous.get(JSON.stringify(cell.polygon)) !== cell.faces_top_to_bottom.join(','),
  }));
}

export type FoldOrderInspection = ReturnType<typeof useFoldOrderInspection>;

/** Compare local overlap stacks, never infer a global stack from a silhouette. */
export function useFoldOrderInspection(key: string | null, scene: FoldScene | null) {
  const [baseline, setBaseline] = useState<{ key: string; scene: FoldScene } | null>(null);
  const [selected, setSelected] = useState<{ key: string | null; index: number | null }>({ key: null, index: null });
  if (key && scene && baseline?.key !== key) setBaseline({ key, scene });
  const rows = scene ? orderStackRegions(scene, baseline?.key === key ? baseline.scene : null) : [];
  return { rows, selected: selected.key === key ? selected.index : null, select: (index: number | null) => setSelected({ key, index }) };
}
