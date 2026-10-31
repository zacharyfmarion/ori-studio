import { useEffect, useState } from 'react';
import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import type { PreparedConnectedSpread } from './connectedScene';
import { prepareConnected } from './prepareConnected';

export function useConnectedSpread(
  scene: OristudioCpFoldedPaperScene | null,
  enabled: boolean,
  yUp = false,
): {
  prepared: PreparedConnectedSpread | null;
  status: 'idle' | 'preparing' | 'ready' | 'unavailable';
} {
  const [result, setResult] = useState<{
    scene: OristudioCpFoldedPaperScene;
    yUp: boolean;
    prepared: PreparedConnectedSpread | null;
  } | null>(null);
  useEffect(() => {
    if (!scene || !enabled) return;
    const lease = prepareConnected(scene, yUp);
    let live = true;
    void lease.promise.then(
      (prepared) => {
        if (live) setResult({ scene, yUp, prepared });
      },
      () => {
        if (live) setResult({ scene, yUp, prepared: null });
      },
    );
    return () => {
      live = false;
      lease.release();
    };
  }, [scene, enabled, yUp]);
  if (!scene || !enabled) return { prepared: null, status: 'idle' };
  if (result?.scene !== scene || result.yUp !== yUp) return { prepared: null, status: 'preparing' };
  return { prepared: result.prepared, status: result.prepared ? 'ready' : 'unavailable' };
}
