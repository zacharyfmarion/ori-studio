import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from './settingsStore';

const initialSettingsState = useSettingsStore.getInitialState();

beforeEach(() => {
  useSettingsStore.setState(initialSettingsState, true);
});

describe('settingsStore', () => {
  it('opens and closes the settings modal', () => {
    useSettingsStore.getState().openSettings();

    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialTab).toBeNull();

    useSettingsStore.getState().closeSettings();

    expect(useSettingsStore.getState().isSettingsOpen).toBe(false);
    expect(useSettingsStore.getState().settingsInitialTab).toBeNull();
  });

  it('tracks the requested initial tab', () => {
    useSettingsStore.getState().openSettings('workspace');

    expect(useSettingsStore.getState().isSettingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialTab).toBe('workspace');
  });

  it('defaults the fold warning to enabled and toggles it', () => {
    expect(useSettingsStore.getState().foldWarningEnabled).toBe(true);

    useSettingsStore.getState().setFoldWarningEnabled(false);
    expect(useSettingsStore.getState().foldWarningEnabled).toBe(false);

    useSettingsStore.getState().setFoldWarningEnabled(true);
    expect(useSettingsStore.getState().foldWarningEnabled).toBe(true);
  });
});
