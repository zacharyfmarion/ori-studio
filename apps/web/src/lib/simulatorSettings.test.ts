import { describe, expect, it } from 'vitest';
import {
  clampSimulatorSetting,
  DEFAULT_SIMULATOR_SETTINGS,
  normalizeSimulatorSettings,
  simulatorMaterialOptions,
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
      showEdges: false,
      creaseStiffness: 2,
    });

    expect(restored.colorMode).toBe('paper');
    expect(restored.damping).toBe(DEFAULT_SIMULATOR_SETTINGS.damping);
    expect(restored.showEdges).toBe(false);
    expect(restored.creaseStiffness).toBe(2);
  });

  it('carries a stored settings object forward when a setting is added', () => {
    // Everything persisted before `showViewCube` existed has no such key, and
    // the cube would be missing for every returning user if that read as false.
    const restored = normalizeSimulatorSettings({ showEdges: false });

    expect(restored.showViewCube).toBe(true);
    expect(normalizeSimulatorSettings({ showViewCube: false }).showViewCube).toBe(false);
  });

  it('drops a setting that has since been retired', () => {
    // `showHiddenLines` was persisted for months before it went (only the
    // canvas-2D fallback ever read it), the style keys moved to the paper
    // style (`settingsStore.paperStyle`), which seeds itself from them on its
    // first read, and `exportBackground` moved to the export page
    // (`settingsStore.paperExport`) the same way. Old JSON still carries them
    // all; none may come back as a stray key on the live settings.
    const restored = normalizeSimulatorSettings({
      showHiddenLines: true,
      exportBackground: 'white',
      showEdges: false,
      paperFront: '#ff8800',
      paperBack: null,
      mountainColor: '#111111',
      valleyColor: '#222222',
      borderColor: '#333333',
      creaseWidth: 2,
      creaseStyle: 'mono',
      lighting: false,
    });

    expect(restored).toEqual({ ...DEFAULT_SIMULATOR_SETTINGS, showEdges: false });
  });

  // Re-pinned: the export-background half went with the setting, which the
  // export page (`paperExportSettings`) now validates.
  it('clamps a numeric setting', () => {
    expect(normalizeSimulatorSettings({ strainClip: 999 }).strainClip).toBe(
      SIMULATOR_SETTING_RANGES.strainClip.max
    );
  });
});
