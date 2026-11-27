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
import { spatialOpeningGain } from '../../layer-spread/spatialOpening';
import type { SpatialSpreadSolution } from './folded3dMaterial';

function useSpatialSolution(model: OristudioCpFolded3dRenderModel | undefined, enabled: boolean) {
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
  return { solution: enabled && model && solved?.model === model ? solved.solution : null, status };
}

/** A legacy spread's Update shares the renderer's solve, without building another mesh. */
export function useSpatialOpeningGain(model: OristudioCpFolded3dRenderModel | undefined) {
  const { solution } = useSpatialSolution(model, !!model);
  return model && solution ? spatialOpeningGain(spatialSource(model).input, solution) : null;
}

export function usePreparedSpatialMesh(
  model: OristudioCpFolded3dRenderModel | undefined,
  aux: OristudioCpFolded3dAuxLines | null,
  enabled: boolean
) {
  const { solution, status } = useSpatialSolution(model, enabled);
  const built = useMemo(() => {
    try {
      return {
        mesh:
          model && solution
            ? spatialBaseMesh(model, aux, solution)
            : null,
        failed: false,
      };
    } catch {
      return { mesh: null, failed: true };
    }
  }, [model, aux, solution]);
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
