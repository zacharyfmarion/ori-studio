import { SpreadService } from './spreadService';
import type {
  SpatialSpreadInput,
  SpatialSpreadSolution,
} from '../cp-workspace/folded/folded3dMaterial';

import { validSpatialSolution } from './spatialProtocol';
export { validSpatialSolution } from './spatialProtocol';
let shared:
  SpreadService<SpatialSpreadInput, SpatialSpreadSolution> | undefined;
export function spatialSpreadService(): SpreadService<
  SpatialSpreadInput,
  SpatialSpreadSolution
> {
  return (shared ??= new SpreadService<
    SpatialSpreadInput,
    SpatialSpreadSolution
  >(
    () =>
      new Worker(new URL('./spatial.worker.ts', import.meta.url), {
        type: 'module',
      }),
    32 * 1024 * 1024,
    25_000,
    validSpatialSolution,
    solution => 2 * JSON.stringify(solution).length,
    'recycle'
  ));
}
