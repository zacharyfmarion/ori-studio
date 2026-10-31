/// <reference lib="webworker" />
import init, { solve_layer_spread } from '../generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm';
import type { SpreadRequest, SpreadResponse } from './protocol';
import type { SpreadSolution } from '@oristudio/layer-spread';
import { validSolution } from './protocol';

const ready = init();
self.onmessage = async ({ data }: MessageEvent<SpreadRequest>) => {
  const { generation, input } = data;
  let response: SpreadResponse;
  try {
    await ready;
    const solution = solve_layer_spread(input) as SpreadSolution;
    if (!validSolution(solution, input)) throw new Error('Invalid layer spread result');
    response = { generation, kind: 'ready', solution };
  } catch (error) {
    response = { generation, kind: 'unavailable', message: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
