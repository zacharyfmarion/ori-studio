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

type Device = { pointer: 'coarse' | 'fine'; width: number; height: number };

/**
 * Evaluate {@link PHONE_MEDIA_QUERY} against a device by reading the query's own
 * terms, rather than restating the threshold here.
 *
 * jsdom does not implement `matchMedia` at all, so these tests have to supply the
 * answer — and a stub handed a boolean would only assert what the test told it.
 * The defect this guards against lived in the constant (`max-width: 820px`
 * matching a device that is exactly 820), which a boolean stub cannot see.
 */
function matchesPhoneQuery(device: Device): boolean {
  // A comma-separated media query list is an OR, so each clause is evaluated on
  // its own and any match wins — the same way a browser reads it.
  const clauses = PHONE_MEDIA_QUERY.split(',');
  if (clauses.length === 0) throw new Error(`unparsed media query: ${PHONE_MEDIA_QUERY}`);
  return clauses.some((clause) => {
    const pointer = /\(pointer:\s*([a-z]+)\)/.exec(clause);
    const maxWidth = /\(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(clause);
    const maxHeight = /\(max-height:\s*(\d+(?:\.\d+)?)px\)/.exec(clause);
    if (!pointer || (!maxWidth && !maxHeight)) {
      throw new Error(`unparsed media query clause: ${clause}`);
    }
    if (device.pointer !== pointer[1]) return false;
    // Both bounds are inclusive, which is exactly how the iPad regression
    // happened: a base iPad is *exactly* 820 and the gate read `max-width: 820`.
    if (maxWidth && device.width > Number(maxWidth[1])) return false;
    if (maxHeight && device.height > Number(maxHeight[1])) return false;
    return true;
  });
}

/**
 * Stub `matchMedia` so only {@link PHONE_MEDIA_QUERY} is answered, and answered as
 * the given device would. Returns the same handle each call so a test can assert
 * on the listener registered against it.
 */
function mockDevice(device: Device) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === PHONE_MEDIA_QUERY && matchesPhoneQuery(device),
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

/**
 * Portrait CSS widths of the devices the gate has to get right. The iPhone and
 * base-iPad figures are measured — `window.innerWidth` in Safari on an iPhone 15
 * and an iPad (A16) simulator — not quoted from a spec sheet.
 */
const DEVICES = {
  iPhoneSE: { pointer: 'coarse', width: 375, height: 667 },
  iPhone15: { pointer: 'coarse', width: 393, height: 852 },
  iPhone16ProMax: { pointer: 'coarse', width: 440, height: 956 },
  iPadMini: { pointer: 'coarse', width: 744, height: 1133 },
  iPad: { pointer: 'coarse', width: 820, height: 1180 },
  iPadPro13: { pointer: 'coarse', width: 1024, height: 1366 },
  narrowDesktop: { pointer: 'fine', width: 700, height: 900 },
  desktop: { pointer: 'fine', width: 1440, height: 900 },

  // Landscape. A width-only gate let every one of these through: an iPhone SE
  // turned sideways is 667px wide, comfortably past a 600px width bound.
  iPhoneSELandscape: { pointer: 'coarse', width: 667, height: 375 },
  iPhone16ProMaxLandscape: { pointer: 'coarse', width: 956, height: 440 },
  iPadMiniLandscape: { pointer: 'coarse', width: 1133, height: 744 },
  iPadLandscape: { pointer: 'coarse', width: 1180, height: 820 },
} satisfies Record<string, Device>;

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
  mockDevice(DEVICES.desktop);
});

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

describe('isPhoneSurface', () => {
  it('is true when the pointer is coarse and the viewport is phone-sized', () => {
    mockDevice(DEVICES.iPhone15);
    expect(isPhoneSurface()).toBe(true);
  });

  it('is false on a wide or fine-pointer viewport', () => {
    expect(isPhoneSurface()).toBe(false);
  });

  it('is false in the Tauri shell whatever the viewport reports', () => {
    mockDevice(DEVICES.iPhone15);
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

  /**
   * The classification the threshold exists to produce. Every iPad keeps the app
   * — the base iPad at 820 is the one that regressed, and the mini at 744 is the
   * narrowest tablet the boundary has to clear.
   */
  it.each([
    ['iPhone SE portrait', 'a phone', DEVICES.iPhoneSE],
    ['iPhone 16 Pro Max portrait', 'a phone', DEVICES.iPhone16ProMax],
    ['iPad mini portrait', 'not a phone', DEVICES.iPadMini],
    ['base iPad portrait', 'not a phone', DEVICES.iPad],
    ['iPad Pro 13" portrait', 'not a phone', DEVICES.iPadPro13],
    ['a narrow desktop window', 'not a phone', DEVICES.narrowDesktop],
    // Turning a phone sideways does not make it a drafting table. These are the
    // cases a width-only gate got wrong.
    ['iPhone SE landscape', 'a phone', DEVICES.iPhoneSELandscape],
    ['iPhone 16 Pro Max landscape', 'a phone', DEVICES.iPhone16ProMaxLandscape],
    ['iPad mini landscape', 'not a phone', DEVICES.iPadMiniLandscape],
    ['base iPad landscape', 'not a phone', DEVICES.iPadLandscape],
  ] as const)('calls %s %s', (_name, verdict, device) => {
    mockDevice(device);
    expect(isPhoneSurface()).toBe(verdict === 'a phone');
  });

  it('leaves room on both sides of the phone/tablet boundary', () => {
    // A threshold pinned to either edge of the gap re-breaks on the next device
    // that ships a few points off. Assert the clearance, not just the answers.
    const maxWidth = Number(/\(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(PHONE_MEDIA_QUERY)![1]);
    expect(maxWidth).toBeGreaterThan(DEVICES.iPhone16ProMax.width + 100);
    expect(maxWidth).toBeLessThan(DEVICES.iPadMini.width - 100);
  });
});

describe('isWorkspaceBlocked', () => {
  it('blocks a phone that has not asked to get in', () => {
    mockDevice(DEVICES.iPhone15);
    expect(isWorkspaceBlocked()).toBe(true);
  });

  it('lets a phone through once the override is set', () => {
    mockDevice(DEVICES.iPhone15);
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
    mockDevice(DEVICES.iPhone15);
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
    mockDevice(DEVICES.iPhone15);
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
