import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CP_COARSE_POINTER_QUERY,
  CP_COARSE_POINTER_SNAP_RADIUS,
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
const CP_WHEEL_GESTURE_KEY = 'oristudio:cp-wheel-gesture';

/**
 * Stub `matchMedia` — jsdom has none — so {@link CP_COARSE_POINTER_QUERY} answers
 * as the given pointer would, and hand back a `set` that changes the answer and
 * fires the listener, the way attaching an iPad's Magic Keyboard does.
 */
function mockPointer(pointer: 'coarse' | 'fine') {
  const state = { pointer };
  const listeners = new Set<() => void>();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === CP_COARSE_POINTER_QUERY && state.pointer === 'coarse',
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  return {
    set(next: 'coarse' | 'fine') {
      state.pointer = next;
      for (const listener of listeners) listener();
    },
  };
}

/** Hydration runs once, at store creation, so a stored value needs a fresh one. */
async function freshSettingsStore(): Promise<typeof useSettingsStore> {
  vi.resetModules();
  const { useSettingsStore: freshStore } = await import('./settingsStore');
  return freshStore;
}

/** `null` stands for a snap-radius key nobody ever wrote. */
async function hydrateWith(
  stored: string | null,
  pointer: 'coarse' | 'fine' = 'fine'
): Promise<number> {
  if (stored === null) localStorage.removeItem(CP_SNAP_RADIUS_KEY);
  else localStorage.setItem(CP_SNAP_RADIUS_KEY, stored);
  mockPointer(pointer);
  return (await freshSettingsStore()).getState().cpSnapRadius;
}

/** Same, for the wheel preference; `null` stands for a key nobody ever wrote. */
async function hydrateWheelGestureWith(stored: string | null): Promise<string> {
  if (stored === null) localStorage.removeItem(CP_WHEEL_GESTURE_KEY);
  else localStorage.setItem(CP_WHEEL_GESTURE_KEY, stored);
  return (await freshSettingsStore()).getState().cpWheelGesture;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useSettingsStore.setState(initialSettingsState, true);
});

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
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

  it('defaults the crease-pattern canvas to scroll-zooms and persists a change', () => {
    expect(useSettingsStore.getState().cpWheelGesture).toBe('zoom');

    useSettingsStore.getState().setCpWheelGesture('pan');
    expect(useSettingsStore.getState().cpWheelGesture).toBe('pan');
    expect(localStorage.getItem(CP_WHEEL_GESTURE_KEY)).toBe('pan');

    useSettingsStore.getState().setCpWheelGesture('zoom');
    expect(localStorage.getItem(CP_WHEEL_GESTURE_KEY)).toBe('zoom');
  });

  it('reports a wheel-gesture change as the chosen enum member', () => {
    useSettingsStore.getState().setCpWheelGesture('pan');

    expect(analytics.track).toHaveBeenCalledWith('cp wheel gesture changed', {
      wheel_gesture: 'pan',
    });
  });

  it('keeps an explicitly chosen scroll-pans across the default moving to zoom', async () => {
    // The key is only written by picking a radio, so a stored `pan` is somebody
    // who chose it and must not be flipped by the new default.
    expect(await hydrateWheelGestureWith('pan')).toBe('pan');
    expect(await hydrateWheelGestureWith('zoom')).toBe('zoom');
    // Never chosen, or unreadable, follows the default.
    expect(await hydrateWheelGestureWith(null)).toBe('zoom');
    expect(await hydrateWheelGestureWith('sideways')).toBe('zoom');
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

  it('starts a coarse pointer wider, and still lets a stored choice win', async () => {
    expect(await hydrateWith(null, 'coarse')).toBe(CP_COARSE_POINTER_SNAP_RADIUS);
    expect(await hydrateWith(null, 'fine')).toBe(CP_DEFAULT_SNAP_RADIUS);
    // Storing upstream's own number is the case a "is it still the default"
    // check would get wrong: this is a choice, and survives onto a touch screen.
    expect(await hydrateWith(String(CP_DEFAULT_SNAP_RADIUS), 'coarse')).toBe(
      CP_DEFAULT_SNAP_RADIUS
    );
    expect(await hydrateWith('9000', 'coarse')).toBe(CP_MAX_SNAP_RADIUS);
  });

  it('follows the pointer changing under a live session, until a choice is stored', async () => {
    const pointer = mockPointer('fine');
    const freshStore = await freshSettingsStore();
    expect(freshStore.getState().cpSnapRadius).toBe(CP_DEFAULT_SNAP_RADIUS);

    // Detaching an iPad's keyboard hands the session back to a fingertip.
    pointer.set('coarse');
    expect(freshStore.getState().cpSnapRadius).toBe(CP_COARSE_POINTER_SNAP_RADIUS);

    freshStore.getState().setCpSnapRadius(30);
    pointer.set('fine');
    expect(freshStore.getState().cpSnapRadius).toBe(30);
  });
});
