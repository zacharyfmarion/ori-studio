import { describe, expect, it } from 'vitest';
import { simulatorRunConfig } from './simulatorRunConfig';

describe('simulatorRunConfig', () => {
  it('leaves whole-model simulator timing on the existing standard preset', () => {
    const whole = simulatorRunConfig('whole', 'accurate');

    expect(whole.initialSettleSteps).toBe(300);
    expect(whole.foldStepPercent).toBe(5);
    // Whole-model runs keep the default work budget but shrink the integration
    // step: the stability bound ignores crease stiffness, so dense real patterns
    // diverge at 1.0 (see bench:gpu-stability).
    expect(whole.solverOptions).toEqual({ timeStepScale: 0.35 });
  });

  it('uses more work and a smaller adaptive timestep for accurate step simulation', () => {
    const fast = simulatorRunConfig('step', 'fast');
    const accurate = simulatorRunConfig('step', 'accurate');

    expect(accurate.initialSettleSteps).toBeGreaterThan(fast.initialSettleSteps);
    expect(accurate.foldChangeImmediateSteps).toBeGreaterThan(fast.foldChangeImmediateSteps);
    expect(accurate.foldStepPercent).toBeLessThan(fast.foldStepPercent);
    expect(accurate.foldPlayPercentPerSecond).toBeLessThan(fast.foldPlayPercentPerSecond);
    expect(accurate.solverOptions.timeStepScale).toBeLessThan(1);
  });
});
