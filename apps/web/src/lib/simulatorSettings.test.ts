import { describe, expect, it } from 'vitest';
import {
  clampSimulatorSetting,
  DEFAULT_SIMULATOR_SETTINGS,
  normalizeSimulatorSettings,
  simulatorMaterialOptions,
} from './simulatorSettings';

describe('simulatorSettings', () => {
  it('passes the integrator to the engine with the material', () => {
    // The solver picks its integrator from the same options object as stiffness,
    // so a UI change must arrive through here or it never reaches the backend.
    const options = simulatorMaterialOptions({
      ...DEFAULT_SIMULATOR_SETTINGS,
      integrationType: 'verlet',
    });
    expect(options.integrationType).toBe('verlet');
    expect(options.timeStepScale).toBe(DEFAULT_SIMULATOR_SETTINGS.timeStepScale);
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
      integrationType: 'symplectic',
      colorMode: 'rainbow',
      damping: 'lots',
      lighting: false,
      creaseStiffness: 2,
    });

    expect(restored.integrationType).toBe('euler');
    expect(restored.colorMode).toBe('paper');
    expect(restored.damping).toBe(DEFAULT_SIMULATOR_SETTINGS.damping);
    expect(restored.lighting).toBe(false);
    expect(restored.creaseStiffness).toBe(2);
  });
});
