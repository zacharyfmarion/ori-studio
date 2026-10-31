/**
 * `simulator backend used`, once per backend per page.
 *
 * Every load reports a backend, and a page loads many models: counting each
 * would weigh a busy session over a quiet one. Once per backend per page
 * counts the machines a backend ran on, which is the question while WebGPU
 * is opt-in: on how many machines that asked for it did it actually run.
 */
import type { SimulatorBackendId } from '../simulator/simulatorSession';
import { ANALYTICS_EVENTS } from './events';
import { track } from './runtime';

const reported = new Set<SimulatorBackendId>();

export function trackSimulatorBackendUsed(input: { backend: SimulatorBackendId; webgpuEnabled: boolean }): void {
  if (reported.has(input.backend)) return;
  reported.add(input.backend);
  track(ANALYTICS_EVENTS.simulatorBackendUsed, {
    backend: input.backend,
    webgpu_enabled: input.webgpuEnabled ? 'yes' : 'no',
  });
}
