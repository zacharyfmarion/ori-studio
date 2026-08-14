import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasPhoneOverride,
  isPhoneSurface,
  isWorkspaceBlocked,
  PHONE_MEDIA_QUERY,
  setPhoneOverride,
  useIsPhoneSurface,
  useIsWorkspaceBlocked,
} from './mobileSurface';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listeners = {
  add: vi.fn(),
  remove: vi.fn(),
};

/**
 * Stub `matchMedia` so only {@link PHONE_MEDIA_QUERY} reports `matches`, and only
 * when `phone` is true. Returns the same handle each call so a test can assert on
 * the listener registered against it.
 */
function mockViewport(phone: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: phone && query === PHONE_MEDIA_QUERY,
      media: query,
      onchange: null,
      addEventListener: listeners.add,
      removeEventListener: listeners.remove,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/** Make `getRuntimeSurface()` report the Tauri desktop shell. */
function mockTauriHost() {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    writable: true,
    value: {},
  });
}

beforeEach(() => {
  localStorage.clear();
  listeners.add.mockClear();
  listeners.remove.mockClear();
  mockViewport(false);
});

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

describe('isPhoneSurface', () => {
  it('is true when the pointer is coarse and the viewport is phone-sized', () => {
    mockViewport(true);
    expect(isPhoneSurface()).toBe(true);
  });

  it('is false on a wide or fine-pointer viewport', () => {
    expect(isPhoneSurface()).toBe(false);
  });

  it('is false in the Tauri shell whatever the viewport reports', () => {
    mockViewport(true);
    mockTauriHost();
    expect(isPhoneSurface()).toBe(false);
  });

  it('is false when the host cannot answer media queries', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    expect(isPhoneSurface()).toBe(false);
  });
});

describe('isWorkspaceBlocked', () => {
  it('blocks a phone that has not asked to get in', () => {
    mockViewport(true);
    expect(isWorkspaceBlocked()).toBe(true);
  });

  it('lets a phone through once the override is set', () => {
    mockViewport(true);
    setPhoneOverride(true);
    expect(hasPhoneOverride()).toBe(true);
    expect(isWorkspaceBlocked()).toBe(false);
    // The device is still a phone — only the gate opened. Layout keys off this.
    expect(isPhoneSurface()).toBe(true);
  });

  it('never blocks a desktop viewport', () => {
    expect(isWorkspaceBlocked()).toBe(false);
  });
});

describe('the override', () => {
  it('persists under the namespaced key so a reload keeps the choice', () => {
    setPhoneOverride(true);
    expect(localStorage.getItem('oristudio:phone-override')).toBe('true');
  });

  it('can be taken back', () => {
    setPhoneOverride(true);
    setPhoneOverride(false);
    expect(hasPhoneOverride()).toBe(false);
  });
});

describe('the reactive bindings', () => {
  it('installs one media listener for two hooks and removes it with the last', () => {
    mockViewport(true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    function Probe() {
      // Both hooks share one subscription, so mounting them together must not
      // register the change listener twice.
      return `${useIsPhoneSurface()}/${useIsWorkspaceBlocked()}`;
    }

    act(() => root.render(createElement(Probe)));
    expect(container.textContent).toBe('true/true');
    expect(listeners.add).toHaveBeenCalledTimes(1);
    expect(listeners.remove).not.toHaveBeenCalled();

    act(() => root.unmount());
    expect(listeners.remove).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it('re-renders when the override opens the gate', () => {
    mockViewport(true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    act(() => root.render(createElement(() => `${useIsWorkspaceBlocked()}`)));
    expect(container.textContent).toBe('true');

    act(() => setPhoneOverride(true));
    expect(container.textContent).toBe('false');

    act(() => root.unmount());
    container.remove();
  });
});
