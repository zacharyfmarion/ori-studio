import type { UserBounds } from '../../cp-workspace/renderer/camera';
import { useFoldPickPreparation } from './useFoldPickPreparation';
import type { FoldScene } from '../engine/foldEngineWire';
import { foldPickDrawing } from './foldRenderGeometry';
import type { FoldLiveRenderer, FoldRenderPayload, FoldRenderSource } from './foldRenderProtocol';
import type { FoldSheetBindings } from './foldPickPreparation';
import { useConnectedSpread } from '../../layer-spread/useConnectedSpread';
import type { PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import { useCallback, useMemo, useState } from 'react';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { foldPaneSpreadMap, type FoldPaneSpreadMap } from './foldPaneSpreadMap';
import { foldPickIndex, foldPickData, hydratePanePick, type FoldPickIndex } from './foldPicking';
import type { FoldStateView } from './useFoldStateView';

/** The folded pane's spread as what is picked and drawn over the paper reads it. */
export interface FoldPaneSpread {
  renderer: FoldLiveRenderer | null;
  bounds: UserBounds | null;
  connected: PreparedConnectedSpread | null;
  status: 'idle' | 'preparing' | 'ready' | 'unavailable';
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
export function useFoldPaneSpread(view: FoldStateView, spread: LayerSpreadOptions | null, previewScene: FoldScene | null = null): FoldPaneSpread {
  const { landmarks, markPoints } = view;
  const previewPicking = useFoldPickPreparation(previewScene, landmarks, markPoints);
  const scene = previewScene ?? view.scene;
  const pickingPreparation = previewScene ? previewPicking.prepared : view.picking;
  const index = previewScene ? pickingPreparation?.index ?? null : view.index;
  const { prepared: connected, status } = useConnectedSpread(scene, spread?.kind === 'connected', true);
  const source = useMemo<FoldRenderSource | null>(() => connected && index?.scene === scene && scene
    ? { scene, prepared: connected, landmarks, marks: markPoints, picking: foldPickData(index) } : null,
    [scene, connected, index, landmarks, markPoints]);
  const [displayed, setDisplayed] = useState<{ source: FoldRenderSource; index: FoldPickIndex; map: FoldPaneSpreadMap; bindings: FoldSheetBindings; bounds: UserBounds } | null>(null);
  const present = useCallback((payload: FoldRenderPayload) => {
    if (!source || !index || spread?.kind !== 'connected') return;
    setDisplayed(was => {
      const bindings = payload.bindings ?? (was?.source === source ? was.bindings : new Map());
      const map = foldPaneSpreadMap(source.scene, spread, source.prepared, bindings, foldPickDrawing(source, payload.positions))!;
      return { source, bindings, map, bounds: payload.bounds, index: { ...index, spread: map, folded: hydratePanePick(payload.folded) } };
    });
  }, [source, index, spread]);
  const renderer = useMemo<FoldLiveRenderer | null>(() => source && spread?.kind === 'connected' ? { source, spread, present } : null, [source, spread, present]);
  const legacyMap = useMemo(() => scene && spread && spread.kind !== 'connected'
    ? foldPaneSpreadMap(scene, spread, undefined, pickingPreparation?.bindings) : null, [scene, spread, pickingPreparation?.bindings]);
  const legacyIndex = useMemo(() => index && legacyMap && index.scene === scene
    ? foldPickIndex(index.scene, landmarks, markPoints, legacyMap, index) : index, [index, legacyMap, scene, landmarks, markPoints]);
  const shown = renderer && displayed?.source === source ? displayed : null;
  const map = spread?.kind === 'connected' ? shown?.map ?? null : legacyMap;
  const picking = spread?.kind === 'connected' ? shown?.index ?? null : legacyIndex;
  const readiness = previewScene && previewPicking.status === 'preparing' ? 'preparing'
    : previewScene && previewPicking.status === 'error' ? 'unavailable' : status;
  const bounds = shown?.bounds ?? null;
  return useMemo(() => ({ renderer, bounds, map, index: picking, connected, status: readiness }), [renderer, bounds, map, picking, connected, readiness]);
}
