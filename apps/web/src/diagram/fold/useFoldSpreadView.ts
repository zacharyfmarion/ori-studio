import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { loadFold } from '../../workspaces/foldGateway';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { useConnectedSpread } from '../../layer-spread/useConnectedSpread';
import type { ConnectedSpreadView } from '../../layer-spread/view';
import type { DiagramFoldStepSource } from '../document/diagramDocument';

/**
 * The view each open Pose has solved, by the model and side it is of: a
 * reader of the same step that does not solve — the Step pane beside the
 * detail — reads it rather than reading and solving the step a second time.
 */
const solved = new Map<string, ConnectedSpreadView>();
const solvedListeners = new Set<() => void>();

function subscribeSolved(listener: () => void): () => void {
  solvedListeners.add(listener);
  return () => solvedListeners.delete(listener);
}

function setSolved(key: string, view: ConnectedSpreadView | null): void {
  if (view) solved.set(key, view);
  else solved.delete(key);
  for (const listener of solvedListeners) listener();
}

/**
 * Only the open Pose retains a source and solves it (`live`): its `view`.
 * Cards never start a solve on mount. `solved` is the view any open Pose of
 * the same model and side has solved, for a reader that is not live to
 * measure from (the Step pane's Update, `useEqualOpeningUpdate`); it never
 * draws, so a card does not start showing a live view because Pose is open.
 */
export function useFoldSpreadView(source: DiagramFoldStepSource | null, live: boolean) {
  const { t } = useTranslation();
  const key =
    source?.render.mode === 'folded-flat' && source.render.spread?.kind === 'connected'
      ? JSON.stringify([
          source.sequence,
          source.step,
          source.through,
          source.moment,
          source.path,
          source.state,
          source.render.side,
        ])
      : null;
  const [read, setRead] = useState<{ key: string; scene: OristudioCpFoldedPaperScene | null } | null>(null);
  useEffect(() => {
    if (!live || !key || !source) return;
    let current = true;
    void loadFold()
      .then(async (fold) => {
        const session = fold.foldSession(),
          release = session.retain();
        try {
          const result = await fold.readFoldStepCapture(session, source, t);
          if (!current) return;
          if (result.status !== 'ready' || source.render.mode !== 'folded-flat') {
            setRead({ key, scene: null });
            return;
          }
          const { foldScenePattern } = await import('./foldStepPicture');
          if (current) setRead({ key, scene: foldScenePattern(result.input.picture.shown, source.render.side) });
        } finally {
          release();
        }
      })
      .catch(() => {
        if (current) setRead({ key, scene: null });
      });
    return () => {
      current = false;
    };
    // A source's pose is deliberately excluded: only its model and side matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live, t]);
  const scene = key && read?.key === key ? read.scene : null;
  const { prepared, status } = useConnectedSpread(scene, live && !!key);
  const view = useMemo(() => (scene && prepared ? { scene, prepared } : null), [scene, prepared]);
  useEffect(() => {
    if (!live || !key || !view) return;
    setSolved(key, view);
    return () => {
      if (solved.get(key) === view) setSolved(key, null);
    };
  }, [live, key, view]);
  const shared = useSyncExternalStore(subscribeSolved, () => (key ? (solved.get(key) ?? null) : null));
  const preparing = !!(live && key && (read?.key !== key || status === 'preparing'));
  return { view, preparing, solved: view ?? shared };
}
