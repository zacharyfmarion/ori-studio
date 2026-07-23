import { ReferenceSolver } from './referenceSolver.js';
import { GpuMath } from './gpuMath.js';
import { OrigamiModel } from './model.js';
import type {
  CreateSimulatorConfig,
  FoldProfile,
  OrigamiSimulatorController,
  SimulationFrame,
  SimulatorOptions,
} from './types.js';

export function createOrigamiSimulator(config: CreateSimulatorConfig): OrigamiSimulatorController {
  const model = new OrigamiModel(config.model);
  const solver = new ReferenceSolver(model, config.options);
  const gpu = config.gl ? new GpuMath(config.gl) : config.canvas ? GpuMath.fromCanvas(config.canvas) : null;
  config.model.diagnostics.webglAvailable = Boolean(gpu);
  config.model.diagnostics.usedCpuFallback = !gpu;
  let raf: ReturnType<typeof requestAnimationFrame> | null = null;
  let disposed = false;

  const render = () => {
    gpu?.clear(0.97, 0.97, 0.95, 1);
  };

  const controller: OrigamiSimulatorController = {
    setFoldPercent(percent: number) {
      solver.setFoldPercent(percent);
    },
    setFoldProfile(profile: FoldProfile | null) {
      solver.setFoldProfile(profile);
    },
    setMaterial(options: Partial<SimulatorOptions>) {
      solver.setMaterial(options);
    },
    step(numSteps?: number): SimulationFrame {
      if (disposed) throw new Error('Simulator has been disposed');
      const frame = solver.step(numSteps);
      render();
      return frame;
    },
    start() {
      if (disposed || raf !== null || typeof requestAnimationFrame === 'undefined') return;
      const tick = () => {
        controller.step();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    pause() {
      if (raf !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(raf);
      }
      raf = null;
    },
    reset() {
      solver.reset();
      render();
    },
    readFrame() {
      return solver.readFrame();
    },
    dispose() {
      controller.pause();
      gpu?.dispose();
      disposed = true;
    },
  };

  render();
  return controller;
}
