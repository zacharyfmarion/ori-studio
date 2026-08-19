import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearHeldModifiers,
  installHeldModifierTracker,
  syncHeldModifiersFromEvent,
} from '../../keyboard/heldModifiers';
import { useCpLineColorInversion } from './useCpLineColorInversion';
import type { OristudioCpLineColor } from '../../engine/oristudioCpTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let uninstall: (() => void) | null = null;
let renders = 0;

function holdControl(held: boolean) {
  act(() => {
    syncHeldModifiersFromEvent({
      ctrlKey: held,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    });
  });
}

/** Mount the hook and return a live view of its latest result. */
function mount(base: OristudioCpLineColor, enabled = true) {
  const latest: { effectiveLineColor: OristudioCpLineColor; inverted: boolean } = {
    effectiveLineColor: base,
    inverted: false,
  };

  function Probe() {
    renders += 1;
    const result = useCpLineColorInversion(base, enabled);
    latest.effectiveLineColor = result.effectiveLineColor;
    latest.inverted = result.inverted;
    return null;
  }

  act(() => {
    root?.render(<Probe />);
  });

  return latest;
}

describe('useCpLineColorInversion', () => {
  beforeEach(() => {
    renders = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    uninstall = installHeldModifierTracker(window);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    uninstall?.();
    uninstall = null;
    clearHeldModifiers();
  });

  it('inverts mountain to valley while Control is held, and restores on release', () => {
    const result = mount('Red1');
    expect(result.effectiveLineColor).toBe('Red1');
    expect(result.inverted).toBe(false);

    holdControl(true);
    expect(result.effectiveLineColor).toBe('Blue2');
    expect(result.inverted).toBe(true);

    holdControl(false);
    expect(result.effectiveLineColor).toBe('Red1');
    expect(result.inverted).toBe(false);
  });

  it('inverts valley to mountain', () => {
    const result = mount('Blue2');

    holdControl(true);
    expect(result.effectiveLineColor).toBe('Red1');
  });

  // Upstream `changeMV()` is identity outside the M/V pair, so holding Control
  // with Edge or Auxiliary selected must be a visible no-op -- and must not
  // claim `inverted`, which drives UI affordances.
  it.each<OristudioCpLineColor>(['Black0', 'Cyan3', 'None', 'Orange4'])(
    'leaves %s alone and reports no inversion',
    (base) => {
      const result = mount(base);

      holdControl(true);
      expect(result.effectiveLineColor).toBe(base);
      expect(result.inverted).toBe(false);
    },
  );

  it('is inert when disabled, so a held key outside the Edit workspace does nothing', () => {
    const result = mount('Red1', false);

    holdControl(true);
    expect(result.effectiveLineColor).toBe('Red1');
    expect(result.inverted).toBe(false);
  });

  it('follows a real Control keypress, not just a synthetic sync', () => {
    const result = mount('Red1');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
    });
    expect(result.effectiveLineColor).toBe('Blue2');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false }));
    });
    expect(result.effectiveLineColor).toBe('Red1');
  });

  // The store notifies on *any* modifier transition. A boolean snapshot is what
  // keeps that from re-rendering the (very large) CP panel on every Shift press.
  it('does not re-render for a modifier it does not care about', () => {
    mount('Red1');
    const before = renders;

    act(() => {
      syncHeldModifiersFromEvent({
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
        metaKey: false,
      });
    });

    expect(renders).toBe(before);
  });
});
