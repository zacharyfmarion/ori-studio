import type { StoreApi } from 'zustand';
import type { WorkspaceState } from './types';
import { useSettingsStore } from '../settingsStore';
import { folded3dRenderModel } from '../../cp-workspace/folded/folded3dRenderModels';
import { folded3dAuxLinesOf } from '../../cp-workspace/folded/folded3dAuxLines';
import { settledSpatialFigure } from '../../cp-workspace/folded/settledSpatialFigures';
import { setFoldedFigureSpreadStatus } from '../../cp-workspace/folded/foldedFigureSpreadStatus';
import { spatialAmount } from '../../cp-workspace/folded/folded3dSpread';

/** Own settled pictures outside the window lifetime: undo, rehydrate and an
 * unwindowed figure all prepare exactly the recipe the store currently holds. */
export function installSpatialSpreadScenes(
  store: StoreApi<WorkspaceState>
): () => void {
  const pending = new Map<string, { key: unknown[]; cancel: () => void }>();
  const run = () => {
    const figures = store.getState().oristudioCpFoldedFigures;
    const active = new Set<string>();
    for (const figure of figures) {
      if (
        !figure.folded3d ||
        figure.handle == null ||
        (spatialAmount(figure) ?? 0) <= 0
      )
        continue;
      active.add(figure.id);
      const key = [
        figure.handle,
        folded3dRenderModel(figure.handle),
        folded3dAuxLinesOf(figure.handle),
        figure.spread,
        figure.camera,
        figure.appearance,
        useSettingsStore.getState().paperStyle.display,
      ];
      const before = pending.get(figure.id);
      if (before && key.every((v, i) => v === before.key[i])) continue;
      before?.cancel();
      const controller = new AbortController();
      const task = {
        key,
        cancel: () => {
          clearTimeout(timer);
          controller.abort();
        },
      };
      const timer = setTimeout(() => {
        setFoldedFigureSpreadStatus(figure.id, 'preparing');
        void settledSpatialFigure(figure, controller.signal)
          .then((settled) => {
            if (controller.signal.aborted || pending.get(figure.id) !== task)
              return;
            setFoldedFigureSpreadStatus(figure.id, 'ready');
            store.setState((state) => ({
              oristudioCpFoldedFigures: state.oristudioCpFoldedFigures.map(
                (f) => (f.id === figure.id ? { ...f, scene: settled.scene } : f)
              ),
            }));
          })
          .catch(() => {
            if (!controller.signal.aborted)
              setFoldedFigureSpreadStatus(figure.id, 'unavailable');
          });
      }, 180);
      pending.set(figure.id, task);
    }
    for (const [id, task] of pending)
      if (!active.has(id)) {
        task.cancel();
        pending.delete(id);
        setFoldedFigureSpreadStatus(id, null);
      }
  };
  const unsubscribe = store.subscribe((s, p) => {
    if (s.oristudioCpFoldedFigures !== p.oristudioCpFoldedFigures) run();
  });
  const settings = useSettingsStore.subscribe((s, p) => {
    if (s.paperStyle.display !== p.paperStyle.display) run();
  });
  run();
  return () => {
    unsubscribe();
    settings();
    for (const task of pending.values()) task.cancel();
    pending.clear();
  };
}
