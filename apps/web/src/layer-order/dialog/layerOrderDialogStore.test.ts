// @vitest-environment jsdom
/**
 * The Layer order dialog's store: one opening at a time, each settled once,
 * and never a host left waiting on a dialog nobody mounts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_LAYER_ORDER_SOURCE } from '../engine/layerOrderEngine.fixtures';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import {
  beginLayerOrderDialog,
  registerLayerOrderDialogMount,
  resetLayerOrderDialogStoreForTest,
  settleLayerOrderDialog,
  useLayerOrderDialogStore,
  type LayerOrderDialogBegun,
  type LayerOrderDialogOutcome,
} from './layerOrderDialogStore';

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

function begun(result: LayerOrderDialogBegun | LayerOrderDialogOutcome): LayerOrderDialogBegun {
  if (!('opening' in result)) throw new Error(`not opened: ${result.kind}`);
  return result;
}

afterEach(() => resetLayerOrderDialogStoreForTest());

describe('the Layer order dialog’s store', () => {
  it('opens on a request and settles once, closing as it settles', async () => {
    registerLayerOrderDialogMount();
    const opened = begun(beginLayerOrderDialog(REQUEST));
    expect(useLayerOrderDialogStore.getState().opening).toBe(opened.opening);
    expect(opened.opening.request).toBe(REQUEST);

    expect(settleLayerOrderDialog(opened.opening.id, { kind: 'cancelled' })).toBe(true);
    expect(useLayerOrderDialogStore.getState().opening).toBeNull();
    // A second word for the same opening finds no one.
    expect(settleLayerOrderDialog(opened.opening.id, { kind: 'unchanged' })).toBe(false);
    await expect(opened.outcome).resolves.toEqual({ kind: 'cancelled' });
  });

  it('refuses a second open while one is open, and leaves the first alone', async () => {
    registerLayerOrderDialogMount();
    const first = begun(beginLayerOrderDialog(REQUEST));
    expect(beginLayerOrderDialog(REQUEST)).toEqual({ kind: 'busy' });
    expect(useLayerOrderDialogStore.getState().opening?.id).toBe(first.opening.id);
    settleLayerOrderDialog(first.opening.id, { kind: 'cancelled' });
    // Once it has gone, the next opens, with an id of its own.
    const next = begun(beginLayerOrderDialog(REQUEST));
    expect(next.opening.id).not.toBe(first.opening.id);
  });

  it('answers unavailable at once while nothing mounts the dialog', () => {
    expect(beginLayerOrderDialog(REQUEST)).toEqual({ kind: 'unavailable' });
    expect(useLayerOrderDialogStore.getState().opening).toBeNull();
  });

  it('cancels an open dialog when its last mount goes', async () => {
    const leave = registerLayerOrderDialogMount();
    const opened = begun(beginLayerOrderDialog(REQUEST));
    leave();
    // Leaving twice counts once.
    leave();
    await expect(opened.outcome).resolves.toEqual({ kind: 'cancelled' });
    expect(useLayerOrderDialogStore.getState().opening).toBeNull();
    expect(beginLayerOrderDialog(REQUEST)).toEqual({ kind: 'unavailable' });
  });

  it('keeps where focus goes back to: what had it when the host asked', () => {
    registerLayerOrderDialogMount();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const opened = begun(beginLayerOrderDialog(REQUEST));
    expect(opened.opening.returnFocus).toBe(opener);
    opener.remove();
  });
});
