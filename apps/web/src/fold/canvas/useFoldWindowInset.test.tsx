import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CpSurfaceInset } from '../../cp-workspace/surface/useCpSurface';
import { coveredFromBottom, useFoldWindowInset } from './useFoldWindowInset';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A 375 × 812 phone's Fold viewport, under the strip and over the tab bar. */
const PANE = { left: 0, right: 375, top: 230, bottom: 740 };

describe('coveredFromBottom', () => {
  it('is how far up the pane the window reaches, its top to the pane’s bottom', () => {
    // The capped window, open: 292 px tall, 12 px above the pane's bottom.
    expect(coveredFromBottom(PANE, { left: 79, right: 367, top: 436, bottom: 728 })).toBe(304);
  });

  it('is nothing for a window beside the pane, and the whole pane for one taller than it', () => {
    expect(coveredFromBottom(PANE, { left: 400, right: 688, top: 436, bottom: 728 })).toBe(0);
    expect(coveredFromBottom(PANE, { left: 79, right: 367, top: 0, bottom: 728 })).toBe(510);
    // Not laid out yet: no box.
    expect(coveredFromBottom(PANE, { left: 0, right: 0, top: 0, bottom: 0 })).toBe(0);
  });
});

describe('useFoldWindowInset', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  const boxed = (rect: { left: number; right: number; top: number; bottom: number }): HTMLElement => {
    const element = document.createElement('div');
    element.getBoundingClientRect = () =>
      ({ ...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }) as DOMRect;
    return element;
  };

  function measure(viewport: HTMLElement | null, frame: HTMLElement | null, enabled: boolean): CpSurfaceInset | null {
    const seen: { inset: CpSurfaceInset | null } = { inset: null };
    function Probe() {
      seen.inset = useFoldWindowInset(viewport, frame, enabled);
      return null;
    }
    host ??= document.createElement('div');
    root ??= createRoot(host);
    act(() => root?.render(<Probe />));
    return seen.inset;
  }

  it('insets a phone’s pane by the bottom the window covers, in whole px', () => {
    const viewport = boxed(PANE);
    const frame = boxed({ left: 79, right: 367, top: 436.4, bottom: 728 });
    expect(measure(viewport, frame, true)).toEqual({ top: 0, right: 0, bottom: 304, left: 0 });
  });

  it('is none off a phone, and none without a window', () => {
    const viewport = boxed(PANE);
    expect(measure(viewport, boxed({ left: 79, right: 367, top: 436, bottom: 728 }), false)).toBeNull();
    expect(measure(viewport, null, true)).toBeNull();
  });

  it('follows the window as its height moves without ever observing its frame for size', async () => {
    // The frame's height is set from inside `useAnimatedHeight`'s own observer:
    // another observer on it leaves a notification undelivered, and the browser
    // fires the loop error the app shows as a background error.
    const observed: Element[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(target: Element) {
          observed.push(target);
        }
        unobserve() {}
        disconnect() {}
      }
    );
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const viewport = boxed(PANE);
    const rect = { left: 79, right: 367, top: 436, bottom: 728 };
    const frame = boxed(rect);
    frame.getBoundingClientRect = () =>
      ({ ...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }) as DOMRect;
    const seen: { inset: CpSurfaceInset | null } = { inset: null };
    function Window() {
      seen.inset = useFoldWindowInset(viewport, frame, true);
      return null;
    }
    host = document.createElement('div');
    root = createRoot(host);
    try {
      act(() => root?.render(<Window />));
      expect(seen.inset).toEqual({ top: 0, right: 0, bottom: 304, left: 0 });
      expect(observed).toEqual([viewport]);

      // The window opens further: its height is pinned and animated, `data-resizing` on it while it moves.
      rect.top = 380;
      frame.dataset.resizing = '';
      frame.style.height = '348px';
      await act(async () => {});
      expect(frames).toHaveLength(1);
      act(() => frames.shift()!(0));
      expect(seen.inset).toEqual({ top: 0, right: 0, bottom: 360, left: 0 });
      // Still moving: followed on the next frame too, until it settles.
      expect(frames).toHaveLength(1);
      rect.top = 360;
      delete frame.dataset.resizing;
      act(() => frames.shift()!(0));
      expect(seen.inset).toEqual({ top: 0, right: 0, bottom: 380, left: 0 });
      expect(observed).toEqual([viewport]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
