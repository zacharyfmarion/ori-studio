import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CP_DEFAULT_SNAP_RADIUS,
  CP_MAX_SNAP_RADIUS,
  CP_MIN_SNAP_RADIUS,
} from '../lib/cpSnapRadiusSetting';
import { useSettingsStore } from './settingsStore';

const analytics = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../analytics')>();
  return { ...actual, track: analytics.track };
});

const initialSettingsState = useSettingsStore.getInitialState();

const CP_SNAP_RADIUS_KEY = 'oristudio:cp-snap-radius';

/** Hydration runs once, at store creation, so a stored value needs a fresh one. */
async function hydrateWith(stored: string): Promise<number> {
  localStorage.setItem(CP_SNAP_RADIUS_KEY, stored);
  vi.resetModules();
  const { useSettingsStore: freshStore } = await import('./settingsStore');
  return freshStore.getState().cpSnapRadius;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
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

  it('defaults the crease-pattern canvas to scroll-pans and persists a change', () => {
    expect(useSettingsStore.getState().cpWheelGesture).toBe('pan');

    useSettingsStore.getState().setCpWheelGesture('zoom');
    expect(useSettingsStore.getState().cpWheelGesture).toBe('zoom');
    expect(localStorage.getItem('oristudio:cp-wheel-gesture')).toBe('zoom');

    useSettingsStore.getState().setCpWheelGesture('pan');
    expect(localStorage.getItem('oristudio:cp-wheel-gesture')).toBe('pan');
  });

  it('defaults the fold warning to enabled and toggles it', () => {
    expect(useSettingsStore.getState().foldWarningEnabled).toBe(true);

    useSettingsStore.getState().setFoldWarningEnabled(false);
    expect(useSettingsStore.getState().foldWarningEnabled).toBe(false);

    useSettingsStore.getState().setFoldWarningEnabled(true);
    expect(useSettingsStore.getState().foldWarningEnabled).toBe(true);
  });

  it('defaults the snap radius to upstream’s mouseRadius and persists a change', () => {
    expect(useSettingsStore.getState().cpSnapRadius).toBe(CP_DEFAULT_SNAP_RADIUS);

    useSettingsStore.getState().setCpSnapRadius(24);

    expect(useSettingsStore.getState().cpSnapRadius).toBe(24);
    expect(localStorage.getItem(CP_SNAP_RADIUS_KEY)).toBe('24');
  });

  it('clamps what the setter is handed, so state never leaves the slider', () => {
    useSettingsStore.getState().setCpSnapRadius(1000);
    expect(useSettingsStore.getState().cpSnapRadius).toBe(CP_MAX_SNAP_RADIUS);

    useSettingsStore.getState().setCpSnapRadius(0);
    expect(useSettingsStore.getState().cpSnapRadius).toBe(CP_MIN_SNAP_RADIUS);

    useSettingsStore.getState().setCpSnapRadius(12.6);
    expect(useSettingsStore.getState().cpSnapRadius).toBe(13);
  });

  it('reports a snap-radius change as a bucket, never as the number', () => {
    useSettingsStore.getState().setCpSnapRadius(40);

    expect(analytics.track).toHaveBeenCalledWith('cp snap radius changed', {
      snap_radius: '<=50',
    });
  });

  it('hydrates a stored radius, and degrades a hand-edited one', async () => {
    expect(await hydrateWith('30')).toBe(30);
    // Out of range clamps in; unreadable falls back to the default.
    expect(await hydrateWith('9000')).toBe(CP_MAX_SNAP_RADIUS);
    expect(await hydrateWith('tiny')).toBe(CP_DEFAULT_SNAP_RADIUS);
    expect(await hydrateWith('')).toBe(CP_DEFAULT_SNAP_RADIUS);
  });
});
