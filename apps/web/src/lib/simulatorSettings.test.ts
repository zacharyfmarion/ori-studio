import { describe, expect, it } from 'vitest';
import {
  clampSimulatorSetting,
  DEFAULT_SIMULATOR_SETTINGS,
  normalizeSimulatorSettings,
  simulatorMaterialOptions,
  SIMULATOR_COLOR_KEYS,
  SIMULATOR_SETTING_RANGES,
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
  it('keeps a valid persisted colour and drops anything else', () => {
    // These come back from localStorage, so a bad value must not reach a
    // renderer. Null is meaningful (follow the theme) and has to survive.
    const restored = normalizeSimulatorSettings({
      paperFront: '#ff8800',
      paperBack: 'rebeccapurple',
      mountainColor: null,
      valleyColor: '#abc',
      borderColor: 42,
    });

    expect(restored.paperFront).toBe('#ff8800');
    expect(restored.paperBack).toBeNull();
    expect(restored.mountainColor).toBeNull();
    // Three-digit hex is rejected too: every consumer here assumes six.
    expect(restored.valleyColor).toBeNull();
    expect(restored.borderColor).toBeNull();
  });

  it('defaults every colour to null, so the theme stays in charge', () => {
    // A concrete default would freeze the paper the first time settings were
    // persisted, and switching theme would stop moving it.
    for (const key of SIMULATOR_COLOR_KEYS) {
      expect(DEFAULT_SIMULATOR_SETTINGS[key]).toBeNull();
    }
  });

  it('validates the export background and clamps the crease weight', () => {
    expect(normalizeSimulatorSettings({ exportBackground: 'chartreuse' }).exportBackground).toBe(
      DEFAULT_SIMULATOR_SETTINGS.exportBackground
    );
    expect(normalizeSimulatorSettings({ exportBackground: 'white' }).exportBackground).toBe('white');
    expect(normalizeSimulatorSettings({ creaseWidth: 999 }).creaseWidth).toBe(
      SIMULATOR_SETTING_RANGES.creaseWidth.max
    );
  });
});
