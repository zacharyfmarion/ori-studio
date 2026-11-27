/**
 * The one list of how browsers word a network failure, shared by the detector,
 * References and Layer order.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNetworkFailure, isNetworkFailureMessage, offlineFlag } from './networkFailure';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a network failure', () => {
  it('is a fetch the network refused, as each browser words it', () => {
    for (const message of [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Load failed',
      'The network connection was lost.',
      'The Internet connection appears to be offline.',
    ]) {
      expect(isNetworkFailureMessage(message)).toBe(true);
    }
  });

  it('is a download cut off partway, the detector’s wasm in ORI-STUDIO-15 among them', () => {
    expect(
      isNetworkFailureMessage('WebAssembly compilation aborted: Network error: Response body loading was aborted')
    ).toBe(true);
    expect(isNetworkFailureMessage('Response body loading was aborted')).toBe(true);
    expect(isNetworkFailureMessage('WebAssembly compilation aborted')).toBe(true);
  });

  it('is matched anywhere in the message, since the reporting SDK appends the host to a fetch’s', () => {
    expect(isNetworkFailureMessage('Failed to fetch (oristudio.dev)')).toBe(true);
    expect(isNetworkFailureMessage('Load failed (oristudio.dev)')).toBe(true);
  });

  it('is read off an Error or a worker’s envelope alike', () => {
    expect(isNetworkFailure(new TypeError('Load failed'))).toBe(true);
    // comlink hands a worker's thrown TypeError over as an Error named TypeError.
    expect(isNetworkFailure(Object.assign(new Error('Load failed'), { name: 'TypeError' }))).toBe(true);
    expect(isNetworkFailure({ code: 'precrease_unavailable', message: 'Failed to fetch' })).toBe(true);
  });

  it('is never a failure of our own, nor what has no message', () => {
    expect(isNetworkFailure(new RangeError('memory access out of bounds'))).toBe(false);
    expect(isNetworkFailure({ code: 'cp_detect', message: 'The CP detector manifest names no model' })).toBe(false);
    expect(isNetworkFailure(new TypeError('Cannot read properties of undefined (reading x)'))).toBe(false);
    for (const value of [null, undefined, 'Failed to fetch', 0, { code: 'x' }]) {
      expect(isNetworkFailure(value)).toBe(false);
    }
  });
});

describe('offlineFlag', () => {
  it('says whether the browser says it is offline', () => {
    expect(offlineFlag()).toBe('no');
    vi.stubGlobal('navigator', { onLine: false });
    expect(offlineFlag()).toBe('yes');
  });
});
