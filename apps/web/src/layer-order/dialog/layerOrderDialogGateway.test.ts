// @vitest-environment jsdom
/**
 * The dialog's gateway when the dialog's code doesn't load: the host hears
 * `unavailable`, the user hears it once, with Reload (the only retry there
 * is once a module failed to load), and the page is never reloaded for them.
 */
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../../monitoring', () => monitoring);

// The dialog's chunk, as a browser that couldn't fetch it answers every import() of it.
vi.mock('../../lib/lazyModule', () => ({
  lazyModule: () => ({
    load: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/LayerOrderDialog-x.js')),
    loaded: () => null,
    useLoaded: () => null,
    resetForTest: () => undefined,
  }),
}));

import { FAKE_LAYER_ORDER_SOURCE } from '../engine/layerOrderEngine.fixtures';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import {
  openLayerOrderDialog,
  registerLayerOrderDialogMount,
  resetLayerOrderDialogGatewayForTest,
} from './layerOrderDialogGateway';
import { resetLayerOrderDialogStoreForTest } from './layerOrderDialogStore';

const REQUEST: LayerOrderRequest = {
  source: FAKE_LAYER_ORDER_SOURCE,
  record: null,
  look: {
    style: DEFAULT_PAPER_STYLE,
    policy: PAPER_STYLE_POLICIES['folded-flat'],
    turnDeg: 0,
    side: 'front',
    xray: false,
    lineStyle: 'color',
    lineWidth: 1,
  },
};

afterEach(() => {
  resetLayerOrderDialogGatewayForTest();
  resetLayerOrderDialogStoreForTest();
  toasts.error.mockClear();
  monitoring.reportError.mockClear();
});

describe('an open whose dialog didn’t load', () => {
  it.each([
    ['online', true, 'Layer order didn’t load. Reload Ori Studio to try again.'],
    ['offline', false, 'Layer order didn’t load while offline. Reconnect, then reload Ori Studio to try again.'],
  ] as const)('%s, answers unavailable and says so once, with Reload', async (_what, onLine, said) => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(onLine);
    onTestFinished(() => online.mockRestore());
    const unmount = registerLayerOrderDialogMount();
    onTestFinished(unmount);

    await expect(openLayerOrderDialog(REQUEST)).resolves.toEqual({ kind: 'unavailable' });
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error).toHaveBeenCalledWith(said, { action: { label: 'Reload', onClick: expect.any(Function) } });
    // The browser's, not a defect.
    expect(monitoring.reportError).not.toHaveBeenCalled();

    // Asked again, it answers the same, and says so again: no retry of ours can load it.
    await expect(openLayerOrderDialog(REQUEST)).resolves.toEqual({ kind: 'unavailable' });
    expect(toasts.error).toHaveBeenCalledTimes(2);
  });
});
