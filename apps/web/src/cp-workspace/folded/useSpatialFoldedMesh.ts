import { useFoldedFigureSpreadStatus } from './foldedFigureSpreadStatus';
import { useEffect, useMemo, useState } from 'react';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFolded3dRenderModel,
  OristudioCpFolded3dAuxLines,
} from '../../engine/oristudioCpTypes';
import { spatialSpreadService } from '../../layer-spread/spatialService';
import {
  spatialAmount,
  spatialBaseMesh,
  spatialSource,
} from './folded3dSpread';
import type { SpatialSpreadSolution } from './folded3dMaterial';

export function usePreparedSpatialMesh(
  model: OristudioCpFolded3dRenderModel | undefined,
  aux: OristudioCpFolded3dAuxLines | null,
  enabled: boolean
) {
  const [solved, setSolved] = useState<{
    model: OristudioCpFolded3dRenderModel;
    solution: SpatialSpreadSolution;
  } | null>(null);
  const [status, setStatus] = useState<'preparing' | 'ready' | 'unavailable'>(
    'preparing'
  );
  useEffect(() => {
    if (!enabled || !model) return;
    let live = true;
    let release: (() => void) | undefined;
    setStatus('preparing');
    try {
      const lease = spatialSpreadService().acquire(spatialSource(model).input);
      release = lease.release;
      void lease.promise
        .then((solution) => {
          if (!live) return;
          setSolved({ model, solution });
          setStatus('ready');
        })
        .catch(() => {
          if (live) setStatus('unavailable');
        });
    } catch {
      setStatus('unavailable');
    }
    return () => {
      live = false;
      release?.();
    };
  }, [model, enabled]);
  const built = useMemo(() => {
    try {
      return {
        mesh:
          enabled && model && solved?.model === model
            ? spatialBaseMesh(model, aux, solved.solution)
            : null,
        failed: false,
      };
    } catch {
      return { mesh: null, failed: true };
    }
  }, [enabled, model, aux, solved]);
  return {
    mesh: built.mesh,
    status: built.failed ? ('unavailable' as const) : status,
  };
}

export function useSpatialFoldedMesh(
  figure: OristudioCpFoldedFigureEntry,
  model: OristudioCpFolded3dRenderModel | undefined,
  aux: OristudioCpFolded3dAuxLines | null
) {
  const amount = spatialAmount(figure);
  const status = useFoldedFigureSpreadStatus(figure.id);
  const prepared = usePreparedSpatialMesh(model, aux, amount !== null && figure.folded3d?.verdict.verdict === 'folded');
  return status === 'unavailable' ? null : prepared.mesh;
}
