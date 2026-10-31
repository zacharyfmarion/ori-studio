import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadFold } from '../../workspaces/foldGateway';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { useConnectedSpread } from '../../layer-spread/useConnectedSpread';
import type { DiagramFoldStepSource } from '../document/diagramDocument';

/** Only the open Pose retains a source. Cards never start a solve on mount. */
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
  const [read, setRead] = useState<{ key: string; scene: OristudioCpFoldedPaperScene } | null>(null);
  useEffect(() => {
    if (!live || !key || !source) return;
    let current = true;
    void loadFold()
      .then(async (fold) => {
        const session = fold.foldSession(),
          release = session.retain();
        try {
          const result = await fold.readFoldStepCapture(session, source, t);
          if (!current || result.status !== 'ready' || source.render.mode !== 'folded-flat') return;
          const { foldScenePattern } = await import('./foldStepPicture');
          if (current) setRead({ key, scene: foldScenePattern(result.input.picture.shown, source.render.side) });
        } finally {
          release();
        }
      })
      .catch(() => {
        if (current) setRead(null);
      });
    return () => {
      current = false;
    };
    // A source's pose is deliberately excluded: only its model and side matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, live, t]);
  const scene = key && read?.key === key ? read.scene : null;
  const { prepared } = useConnectedSpread(scene, live && !!key);
  return useMemo(() => (scene && prepared ? { scene, prepared } : null), [scene, prepared]);
}
