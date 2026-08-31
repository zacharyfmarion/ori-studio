import type { SimulatorOptions } from '@treemaker/origami-simulator';

export interface SimulatorRunConfig {
  initialSettleSteps: number;
  foldChangeImmediateSteps: number;
  foldChangeSettleBatch: number;
  foldChangeSettleFrames: number;
  foldPlayStepBatch: number;
  foldPlayPercentPerSecond: number;
  foldStepPercent: number;
  solverOptions: Partial<SimulatorOptions>;
}

const WHOLE_RUN_CONFIG: SimulatorRunConfig = {
  initialSettleSteps: 300,
  foldChangeImmediateSteps: 200,
  foldChangeSettleBatch: 200,
  foldChangeSettleFrames: 40,
  foldPlayStepBatch: 160,
  foldPlayPercentPerSecond: 28,
  foldStepPercent: 5,
  solverOptions: {
    // Shrinks the integration step below the axial-only stability bound, which
    // does not account for crease (bending) stiffness. Dense real-world patterns
    // destabilize at 1.0 and 0.5; 0.35 is the largest value at which
    // bench:gpu-stability keeps both backends stable over a full 12k-step ramp,
    // and the worker runs many steps per frame so the extra steps cost little.
    timeStepScale: 0.35,
  },
};

export function simulatorRunConfig(): SimulatorRunConfig {
  return WHOLE_RUN_CONFIG;
}
