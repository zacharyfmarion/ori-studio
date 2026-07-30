import { expose } from 'comlink';
import { createSimulatorSession } from '../simulator/simulatorSession';

// Thin comlink wrapper. All behaviour lives in simulatorSession so it can be
// exercised without a Worker (jsdom tests, Node).
export type {
  SimulatorWorkerApi,
  SimulatorLoadOptions,
  SimulatorModelInfo,
  SimulatorFramePayload,
} from '../simulator/simulatorSession';
export { EDGE_ASSIGNMENT_CODES } from '../simulator/simulatorSession';

expose(createSimulatorSession());
