import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFolded3dAuxLines,
} from '../../engine/oristudioCpTypes';
import type { FoldedFigureSpread } from './foldedFigureSpread';
import { spatialSpreadService } from '../../layer-spread/spatialService';
import {
  prepareSpatialMaterial,
  spatialMaterialMesh,
  type SpatialMaterial,
  type SpatialSpreadSolution,
} from './folded3dMaterial';
import type { Folded3dMesh } from './folded3dMesh';

const sources = new WeakMap<OristudioCpFolded3dRenderModel, SpatialMaterial>();
export function spatialSource(
  model: OristudioCpFolded3dRenderModel
): SpatialMaterial {
  let source = sources.get(model);
  if (!source) {
    source = prepareSpatialMaterial(model);
    sources.set(model, source);
  }
  return source;
}
const meshes = new WeakMap<
  OristudioCpFolded3dRenderModel,
  {
    aux: OristudioCpFolded3dAuxLines | null;
    solution: SpatialSpreadSolution;
    mesh: Folded3dMesh;
  }
>();

/** Amount is a uniform on this immutable geometry, never a new solve or upload. */
export function spatialBaseMesh(
  model: OristudioCpFolded3dRenderModel,
  aux: OristudioCpFolded3dAuxLines | null,
  solution: SpatialSpreadSolution
): Folded3dMesh {
  const previous = meshes.get(model);
  if (previous?.aux === aux && previous.solution === solution)
    return previous.mesh;
  const source = spatialSource(model);
  const rest = spatialMaterialMesh(model, source, solution, 0, aux);
  const opened = spatialMaterialMesh(model, source, solution, 1, aux);
  rest.displacement = Float32Array.from(
    opened.positions,
    (v, i) => v - rest.positions[i]!
  );
  meshes.set(model, { aux, solution, mesh: rest });
  return rest;
}

export function spatialAmount(figure: {
  spread?: FoldedFigureSpread | null;
  displayStyle: string;
}): number | null {
  return figure.spread?.kind === 'spatial' && figure.displayStyle === 'Paper5'
    ? figure.spread.amount
    : null;
}

/** CPU capture consumes the same Float32 rest and displacement as the GPU. */
export function posedSpatialMesh(
  figure: { spread?: FoldedFigureSpread | null; displayStyle: string },
  model: OristudioCpFolded3dRenderModel,
  aux: OristudioCpFolded3dAuxLines | null
): Folded3dMesh | null {
  const amount = spatialAmount(figure);
  if (amount == null || amount === 0) return null;
  const source = spatialSource(model);
  const solution =
    meshes.get(model)?.solution ?? spatialSpreadService().peek(source.input);
  if (!solution) return null;
  const base = spatialBaseMesh(model, aux, solution);
  return {
    ...base,
    positions: Float32Array.from(
      base.positions,
      (v, i) => v + amount * base.displacement![i]!
    ),
  };
}

export async function ensureSpatialSpread(
  model: OristudioCpFolded3dRenderModel,
  aux: OristudioCpFolded3dAuxLines | null = null,
  signal?: AbortSignal
): Promise<Folded3dMesh> {
  if (signal?.aborted)
    throw new DOMException('Capture cancelled', 'AbortError');
  const lease = spatialSpreadService().acquire(spatialSource(model).input);
  let rejectAbort: ((error: Error) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    lease.release();
    rejectAbort?.(new DOMException('Capture cancelled', 'AbortError'));
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const solution = await Promise.race([lease.promise, aborted]);
    if (signal?.aborted)
      throw new DOMException('Capture cancelled', 'AbortError');
    return spatialBaseMesh(model, aux, solution);
  } finally {
    signal?.removeEventListener('abort', cancel);
    lease.release();
  }
}
