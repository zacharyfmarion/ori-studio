/**
 * The gateway's withdrawal (row H10's review): a host's signal closes the
 * dialog it opened, answering `cancelled`, and a signal already aborted opens
 * nothing. The dialog's code is stood in for: these tests open, never draw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_LAYER_ORDER_SOURCE } from '../engine/layerOrderEngine.fixtures';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';

vi.mock('../../components/layer-order/LayerOrderDialog', () => ({ LayerOrderDialog: () => null }));

import {
  openLayerOrderDialog,
  resetLayerOrderDialogGatewayForTest,
  withdrawLayerOrderDialog,
} from './layerOrderDialogGateway';
import { registerLayerOrderDialogMount, resetLayerOrderDialogStoreForTest, useLayerOrderDialogStore } from './layerOrderDialogStore';

const REQUEST: LayerOrderRequest = {
  surface: 'fold_import',
  source: FAKE_LAYER_ORDER_SOURCE,
  record: null,
  look: {
    style: DEFAULT_PAPER_STYLE,
    policy: PAPER_STYLE_POLICIES.fold,
    turnDeg: 0,
    side: 'front',
    xray: false,
    lineStyle: 'color',
    lineWidth: 1,
  },
};

afterEach(() => {
  resetLayerOrderDialogStoreForTest();
  resetLayerOrderDialogGatewayForTest();
});

describe('withdrawing a Layer order dialog', () => {
  it('closes the dialog a host’s signal aborts, answering cancelled', async () => {
    registerLayerOrderDialogMount();
    const asked = new AbortController();
    const outcome = openLayerOrderDialog(REQUEST, { signal: asked.signal });
    expect(useLayerOrderDialogStore.getState().opening?.request).toBe(REQUEST);
    asked.abort();
    expect(useLayerOrderDialogStore.getState().opening).toBeNull();
    await expect(outcome).resolves.toEqual({ kind: 'cancelled' });
  });

  it('opens nothing on a signal already aborted', async () => {
    registerLayerOrderDialogMount();
    const asked = new AbortController();
    asked.abort();
    await expect(openLayerOrderDialog(REQUEST, { signal: asked.signal })).resolves.toEqual({ kind: 'cancelled' });
    expect(useLayerOrderDialogStore.getState().opening).toBeNull();
  });

  it('leaves an answered dialog’s answer alone, and the next one open', async () => {
    registerLayerOrderDialogMount();
    const asked = new AbortController();
    const first = openLayerOrderDialog(REQUEST, { signal: asked.signal });
    const id = useLayerOrderDialogStore.getState().opening!.id;
    // Closed from outside first (the mount on a route change): answered `cancelled` once.
    expect(withdrawLayerOrderDialog(id)).toBe(true);
    expect(withdrawLayerOrderDialog(id)).toBe(false);
    await expect(first).resolves.toEqual({ kind: 'cancelled' });
    // A later dialog, opened without a signal, is not closed by the first one's.
    const second = openLayerOrderDialog(REQUEST);
    asked.abort();
    expect(useLayerOrderDialogStore.getState().opening?.request).toBe(REQUEST);
    withdrawLayerOrderDialog(useLayerOrderDialogStore.getState().opening!.id);
    await expect(second).resolves.toEqual({ kind: 'cancelled' });
  });
});
