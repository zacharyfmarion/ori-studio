import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cpOverlayViewStore } from '../cpOverlayViewStore';
import { CpToolOptionLayer } from './CpToolOptionLayer';
import type { CpToolOptionWindow } from './toolOptionWindow';

function option(overrides: Partial<CpToolOptionWindow> = {}): CpToolOptionWindow {
  return {
    bounds: { minX: 20, minY: 20, maxX: 120, maxY: 90 },
    title: 'Fold angles',
    index: 0,
    count: 2,
    onStep: vi.fn(),
    onApply: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

/**
 * jsdom has no `ResizeObserver`, and the layer uses one to learn the area its
 * controls must stay inside. Stubbed locally rather than globally: only this
 * component needs it, and a global shim would quietly change what every other
 * test is exercising.
 */
class StubResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: 1000, height: 800 } } as ResizeObserverEntry],
      this
    );
  }
  unobserve() {}
  disconnect() {}
}

describe('CpToolOptionLayer', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    // Identity model→CSS affine, so model units are screen pixels.
    cpOverlayViewStore.set({
      model: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
      user: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const render = (value: CpToolOptionWindow | null) => {
    act(() => root.render(<CpToolOptionLayer option={value} />));
  };

  it('renders nothing when the tool has no question open', () => {
    render(null);
    expect(host.querySelector('.cp-tool-option-layer')).toBeNull();
  });

  it('frames the geometry rather than listing it', () => {
    // The point of the redesign: the creases and their angle badges are the
    // content, so a window that also spelled them out in words would say the
    // same thing twice while covering the canvas.
    render(option());
    const window = host.querySelector<HTMLElement>('.cp-tool-option');
    expect(host.querySelector('.cp-tool-option__frame')).not.toBeNull();
    expect(host.querySelector('.cp-tool-option__rows')).toBeNull();
    // Encloses the bounds, with the padding outside them.
    expect(window!.style.transform).toMatch(/translate\(4px, 4px\)/);
    expect(window!.style.width).toBe('132px');
    expect(window!.style.height).toBe('102px');
  });

  it('attaches the header to the frame rather than floating it nearby', () => {
    // One window, not a toolbar that happens to be close: the header is a child
    // of the framed box, offset by exactly its own height so they share an edge.
    render(option());
    const window = host.querySelector<HTMLElement>('.cp-tool-option')!;
    const header = host.querySelector<HTMLElement>('.cp-tool-option__header')!;
    expect(header.parentElement).toBe(window);
    // jsdom measures the header at zero height, so the offset is 0 — what
    // matters here is that it is expressed relative to the frame at all.
    expect(header.style.top).toBe('0px');
  });

  it('leaves the framed region clickable', () => {
    // The frame surrounds creases you may still want to draw over; only the
    // header takes pointer events.
    render(option());
    const layer = host.querySelector<HTMLElement>('.cp-tool-option-layer');
    const window = host.querySelector<HTMLElement>('.cp-tool-option');
    const header = host.querySelector<HTMLElement>('.cp-tool-option__header');
    expect(layer!.style.pointerEvents).toBe('none');
    expect(window!.style.pointerEvents).toBe('none');
    expect(header!.style.pointerEvents).toBe('auto');
  });

  it('steps and applies through the descriptor', () => {
    const value = option();
    render(value);
    const buttons = [...host.querySelectorAll('button')];
    const find = (label: string) =>
      buttons.find(
        (button) =>
          button.getAttribute('aria-label') === label || button.textContent?.trim() === label
      )!;
    act(() => find('Next option').click());
    expect(value.onStep).toHaveBeenCalledWith(1);
    act(() => find('Previous option').click());
    expect(value.onStep).toHaveBeenCalledWith(-1);
    act(() => find('Apply').click());
    expect(value.onApply).toHaveBeenCalled();
    act(() => find('Cancel').click());
    expect(value.onCancel).toHaveBeenCalled();
  });

  it('shows the title instead of a counter when there is nothing to step', () => {
    // "1 of 1" would claim a set with a second member to reach.
    render(option({ count: 0 }));
    expect(host.querySelector('.cp-tool-option__count')).toBeNull();
    expect(host.querySelector('.cp-tool-option__title')?.textContent).toBe('Fold angles');
  });

  it('carries the note the drawing cannot', () => {
    render(option({ note: 'one of infinitely many' }));
    expect(host.querySelector('.cp-tool-option__note')?.textContent).toBe(
      'one of infinitely many'
    );
  });

  it('resizes the frame with the camera but not the header', () => {
    render(option());
    const width = () => host.querySelector<HTMLElement>('.cp-tool-option')!.style.width;
    const before = width();
    act(() => {
      cpOverlayViewStore.set({
        model: { origin: [0, 0], ex: [4, 0], ey: [0, 4] },
        user: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
      });
    });
    expect(Number.parseFloat(width())).toBeGreaterThan(Number.parseFloat(before));
    // The header is a plain block with no camera-derived size at all — the
    // mistake this whole split exists to avoid.
    const header = host.querySelector<HTMLElement>('.cp-tool-option__header')!;
    expect(header.style.width).toBe('');
    expect(header.style.transform).toBe('');
  });
});
