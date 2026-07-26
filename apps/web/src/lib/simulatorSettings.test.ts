import { describe, expect, it } from 'vitest';
import {
  clampSimulatorSetting,
  DEFAULT_SIMULATOR_SETTINGS,
  normalizeSimulatorSettings,
  simulatorMaterialOptions,
} from './simulatorSettings';

describe('simulatorSettings', () => {
  it('sends the material to the engine but not an integrator choice', () => {
    // Verlet is implemented on the GPU but not exposed yet (it renders wrong in
    // the app), so the settings must not push an integrator at all -- that leaves
    // the engine on its Euler default.
    const options = simulatorMaterialOptions(DEFAULT_SIMULATOR_SETTINGS);
    expect(options.timeStepScale).toBe(DEFAULT_SIMULATOR_SETTINGS.timeStepScale);
    expect(options.damping).toBe(DEFAULT_SIMULATOR_SETTINGS.damping);
    expect('integrationType' in options).toBe(false);
  });

  it('clamps numeric settings into range', () => {
    expect(clampSimulatorSetting('damping', 99)).toBe(1);
    expect(clampSimulatorSetting('timeStepScale', 0)).toBe(0.05);
    // A half-typed number field yields NaN; fall back rather than store it.
    expect(clampSimulatorSetting('creaseStiffness', Number.NaN)).toBe(
      DEFAULT_SIMULATOR_SETTINGS.creaseStiffness
    );
  });

  it('rejects unknown persisted values instead of trusting them', () => {
    const restored = normalizeSimulatorSettings({
      colorMode: 'rainbow',
      damping: 'lots',
      lighting: false,
      creaseStiffness: 2,
    });

    expect(restored.colorMode).toBe('paper');
    expect(restored.damping).toBe(DEFAULT_SIMULATOR_SETTINGS.damping);
    expect(restored.lighting).toBe(false);
    expect(restored.creaseStiffness).toBe(2);
  });
});
