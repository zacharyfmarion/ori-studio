import type { SimulatorOptions } from '@treemaker/origami-simulator';

export type SimulatorScope = 'whole' | 'step';
export type StepSimulationAccuracy = 'fast' | 'accurate';

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

const STEP_FAST_RUN_CONFIG: SimulatorRunConfig = {
  ...WHOLE_RUN_CONFIG,
};

const STEP_ACCURATE_RUN_CONFIG: SimulatorRunConfig = {
  initialSettleSteps: 1200,
  foldChangeImmediateSteps: 900,
  foldChangeSettleBatch: 900,
  foldChangeSettleFrames: 90,
  foldPlayStepBatch: 520,
  foldPlayPercentPerSecond: 12,
  foldStepPercent: 2,
  solverOptions: {
    timeStepScale: 0.35,
    stepsPerFrame: 240,
  },
};

export const STEP_SIMULATION_ACCURACY_OPTIONS: Array<{
  value: StepSimulationAccuracy;
  label: string;
  title: string;
}> = [
  { value: 'fast', label: 'Fast', title: 'Step preview with standard simulator work' },
  {
    value: 'accurate',
    label: 'Accurate',
    title: 'Step preview with smaller solver increments and more settling',
  },
];

export function simulatorRunConfig(
  scope: SimulatorScope,
  stepAccuracy: StepSimulationAccuracy,
): SimulatorRunConfig {
  if (scope === 'whole') return WHOLE_RUN_CONFIG;
  return stepAccuracy === 'accurate' ? STEP_ACCURATE_RUN_CONFIG : STEP_FAST_RUN_CONFIG;
}
