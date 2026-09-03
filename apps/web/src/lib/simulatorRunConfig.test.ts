import { describe, expect, it } from 'vitest';
import { simulatorRunConfig } from './simulatorRunConfig';

describe('simulatorRunConfig', () => {
  it('leaves whole-model simulator timing on the existing standard preset', () => {
    const whole = simulatorRunConfig();

    expect(whole.initialSettleSteps).toBe(300);
    expect(whole.foldStepPercent).toBe(5);
    // Whole-model runs keep the default work budget but shrink the integration
    // step: the stability bound ignores crease stiffness, so dense real patterns
    // diverge at 1.0 (see bench:gpu-stability).
    expect(whole.solverOptions).toEqual({ timeStepScale: 0.35 });
  });
});
