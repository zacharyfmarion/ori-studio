/**
 * The one rule for when a Layer order engine failure is the browser failing
 * to load it (shown, never reported) rather than the engine failing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';

const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

import { LAYER_ORDER_CALL_FAILURES } from './layerOrderEngine';
import { isLayerOrderLoadFailure, layerOrderReloadAction, sayLayerOrderUnavailable } from './layerOrderLoadFailure';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

const unavailable = (message: string) => ({ code: LAYER_ORDER_CALL_FAILURES.unavailable, message });

afterEach(() => {
  vi.unstubAllGlobals();
  toasts.error.mockClear();
});

describe('what a load failure offers', () => {
  it('is Reload, which reloads the page only when the user presses it', () => {
    const host = { location: { reload: vi.fn() } };
    const action = layerOrderReloadAction(t, host);
    expect(action.label).toBe('Reload');
    expect(host.location.reload).not.toHaveBeenCalled();
    action.onClick();
    expect(host.location.reload).toHaveBeenCalledTimes(1);
  });

  it('says an open didn’t load, worded for whether the browser is offline, with Reload', () => {
    sayLayerOrderUnavailable(t);
    vi.stubGlobal('navigator', { onLine: false });
    sayLayerOrderUnavailable(t);
    expect(toasts.error.mock.calls).toEqual([
      ['Layer order didn’t load. Reload Ori Studio to try again.', { action: { label: 'Reload', onClick: expect.any(Function) } }],
      [
        'Layer order didn’t load while offline. Reconnect, then reload Ori Studio to try again.',
        { action: { label: 'Reload', onClick: expect.any(Function) } },
      ],
    ]);
  });
});

describe('a load failure', () => {
  it('is a worker that never ran, or the runtime’s loss for one', () => {
    expect(isLayerOrderLoadFailure({ worker: 'layer-order', kind: 'error', message: 'x', loadFailed: true })).toBe(true);
    expect(isLayerOrderLoadFailure({ code: 'layer_order_engine_lost', reason: 'unloaded', message: 'x', loadFailed: true })).toBe(
      true
    );
    // A worker that threw while running, and a crash, are the engine's.
    expect(isLayerOrderLoadFailure({ worker: 'layer-order', kind: 'error', message: 'x', loadFailed: false })).toBe(false);
    expect(isLayerOrderLoadFailure({ code: 'layer_order_engine_lost', reason: 'crashed', message: 'x' })).toBe(false);
  });

  it('is an engine that did not start because the Fold wasm did not arrive, as each browser words it', () => {
    for (const message of [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Load failed',
      'The network connection was lost.',
      'The Internet connection appears to be offline.',
      'WebAssembly.instantiateStreaming(): HTTP status code is not ok',
      "Incorrect response MIME type. Expected 'application/wasm'.",
      'WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 64 6f @+0',
      'wasm validation error: at offset 4: failed to match magic number',
      "WebAssembly.Module doesn't parse at byte 0: module doesn't start with '\\0asm'",
    ]) {
      expect(isLayerOrderLoadFailure(unavailable(message))).toBe(true);
    }
    // An engine that did not start for another reason is a defect.
    expect(isLayerOrderLoadFailure(unavailable('WebAssembly.Memory(): could not allocate memory'))).toBe(false);
  });

  it('is a lazy chunk that did not load', () => {
    expect(isLayerOrderLoadFailure(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'))).toBe(true);
    expect(isLayerOrderLoadFailure(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isLayerOrderLoadFailure(new TypeError('Load failed'))).toBe(true);
    // A module that loaded and threw is a defect.
    expect(isLayerOrderLoadFailure(new ReferenceError('x is not defined'))).toBe(false);
  });

  it('is any failure to start or to load while the browser is offline, but never a trap or another engine error', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isLayerOrderLoadFailure(unavailable('WebAssembly.Memory(): could not allocate memory'))).toBe(true);
    expect(isLayerOrderLoadFailure(new ReferenceError('x is not defined'))).toBe(true);
    expect(isLayerOrderLoadFailure({ code: LAYER_ORDER_CALL_FAILURES.trapped, trap: 'wasm_trap', message: 'unreachable' })).toBe(
      false
    );
    expect(isLayerOrderLoadFailure({ code: 'session_internal', message: 'Failed to fetch' })).toBe(false);
    expect(isLayerOrderLoadFailure({ code: 'layer_order_engine_lost', reason: 'crashed', message: 'x' })).toBe(false);
  });

  it('is never what is not an object', () => {
    for (const value of [null, undefined, 'Failed to fetch', 0]) expect(isLayerOrderLoadFailure(value)).toBe(false);
  });
});
