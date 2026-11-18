/// <reference lib="webworker" />
import init, {
  solve_spatial_spread,
} from '../generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm';
import type {
  SpatialSpreadInput,
  SpatialSpreadSolution,
} from '../cp-workspace/folded/folded3dMaterial';
import { validSpatialSolution } from './spatialProtocol';
const ready = init();
self.onmessage = async ({
  data,
}: MessageEvent<{ generation: number; input: SpatialSpreadInput }>) => {
  try {
    await ready;
    const solution = solve_spatial_spread(data.input) as SpatialSpreadSolution;
    if (!validSpatialSolution(solution, data.input))
      throw new Error('Invalid spatial spread result');
    self.postMessage({ generation: data.generation, kind: 'ready', solution });
  } catch (error) {
    self.postMessage({
      generation: data.generation,
      kind: 'unavailable',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
