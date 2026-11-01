/**
 * The dialog's opening state over a long open: "Working out the layer
 * orders…", then, after `LAYER_ORDER_LONG_OPEN_MS`, a quieter line that
 * large figures can take up to a minute, beside Cancel as before.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYER_ORDER_LIMITS, keepTrying } from '../../layer-order/engine/layerOrderEngine';
import { LAYER_ORDER_LONG_OPEN_MS } from '../../layer-order/dialog/useLayerOrderLongOpen';
import type { LayerOrderSessionStatus } from '../../layer-order/dialog/useLayerOrderSession';
import { byRole } from '../../test/roleQueries';
import { TooltipProvider } from '../ui/Tooltip';
import { LayerOrderDialogFrame } from './LayerOrderDialogFrame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG = 'Large figures can take up to a minute.';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
});

const onCancel = vi.fn();

function render(status: LayerOrderSessionStatus) {
  act(() =>
    root.render(
      <TooltipProvider>
        <LayerOrderDialogFrame
          name="Kabuto"
          status={status}
          letters={null}
          returnFocus={null}
          phonePane={null}
          onPhonePaneChange={() => {}}
          panes={<div />}
          onRetry={() => {}}
          onCancel={onCancel}
          onApply={() => {}}
          applying={false}
          applyRefusal={null}
        />
      </TooltipProvider>
    )
  );
}

const statusText = () => document.querySelector('[role="status"]')?.textContent ?? '';
const later = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('the opening state', () => {
  it('adds that large figures can take up to a minute once an open has run a few seconds', () => {
    render({ kind: 'opening', limits: LAYER_ORDER_LIMITS.open });
    expect(statusText()).toBe('Working out the layer orders…');
    later(LAYER_ORDER_LONG_OPEN_MS - 1);
    expect(statusText()).not.toContain(LONG);
    later(1);
    expect(statusText()).toBe(`Working out the layer orders…${LONG}`);
    // Cancel stays, and still cancels.
    act(() => byRole(document, 'button', 'Cancel').click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('says so on a restore too, which has the same minute', () => {
    render({ kind: 'opening', limits: LAYER_ORDER_LIMITS.restore });
    later(LAYER_ORDER_LONG_OPEN_MS);
    expect(statusText()).toContain(LONG);
  });

  it('starts over at each open, and says nothing past a minute on Keep trying', () => {
    render({ kind: 'opening', limits: LAYER_ORDER_LIMITS.open });
    later(LAYER_ORDER_LONG_OPEN_MS);
    expect(statusText()).toContain(LONG);
    const limits = LAYER_ORDER_LIMITS.open;
    const ranOut = { code: 'session_timed_out', limit: 'deadline', nodes: 10 } as const;
    render({ kind: 'refused', refusal: ranOut, limits });
    // Keep trying opens again with four times the deadline, which the line would understate.
    render({ kind: 'opening', limits: keepTrying(limits) });
    later(4 * LAYER_ORDER_LONG_OPEN_MS);
    expect(statusText()).toBe('Working out the layer orders…');
    // A fresh open with the usual minute: the line waits its few seconds again.
    render({ kind: 'refused', refusal: ranOut, limits });
    render({ kind: 'opening', limits });
    expect(statusText()).not.toContain(LONG);
    later(LAYER_ORDER_LONG_OPEN_MS);
    expect(statusText()).toContain(LONG);
  });
});
