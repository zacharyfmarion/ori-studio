import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingToolbar, type FloatingAnchorRect } from './FloatingToolbar';

/**
 * The toolbar's wheel behaviour.
 *
 * These toolbars hover over the crease-pattern canvas, so a scroll or pinch that
 * lands on one was aimed at the canvas. Left unclaimed it becomes browser page
 * zoom instead — a pinch is ctrl+wheel, and React registers `wheel` passively at
 * its root, so nothing declarative can stop it.
 */

// FloatingToolbar's autoUpdate attaches a ResizeObserver, absent in jsdom.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const ANCHOR: FloatingAnchorRect = { left: 10, top: 10, width: 100, height: 40 };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;

function render(options: { wired: boolean; anchor?: FloatingAnchorRect | null }) {
  act(() => {
    root?.render(
      <FloatingToolbar
        anchorRect={options.anchor === undefined ? ANCHOR : options.anchor}
        wheelTarget={options.wired ? () => canvas : undefined}
        ariaLabel="actions"
      >
        <button type="button">act</button>
      </FloatingToolbar>
    );
  });
}

function toolbar(): HTMLElement | null {
  // Body-portaled, so it is not inside the host.
  return document.querySelector('.floating-toolbar');
}

/** Dispatch a trackpad pinch at the toolbar; the browser reports one as ctrl+wheel. */
function pinchToolbar(): WheelEvent {
  const event = new WheelEvent('wheel', {
    deltaY: -90,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    toolbar()?.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  canvas?.remove();
  root = null;
  host = null;
  canvas = null;
});

describe('FloatingToolbar wheel handling', () => {
  it('forwards a pinch to the surface it floats over instead of the page', () => {
    const seen: WheelEvent[] = [];
    canvas?.addEventListener('wheel', (event) => seen.push(event as WheelEvent));
    render({ wired: true });
    expect(toolbar()).not.toBeNull();

    const original = pinchToolbar();

    expect(original.defaultPrevented).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].ctrlKey).toBe(true);
  });

  it('leaves the wheel alone without a target, so ordinary content still scrolls', () => {
    render({ wired: false });

    expect(pinchToolbar().defaultPrevented).toBe(false);
  });

  it('rewires after the toolbar is hidden and shown again', () => {
    const seen: WheelEvent[] = [];
    canvas?.addEventListener('wheel', (event) => seen.push(event as WheelEvent));
    render({ wired: true });

    // A null anchor unmounts the pill entirely; the listener has to follow the
    // element that comes back, not the one that went away.
    render({ wired: true, anchor: null });
    expect(toolbar()).toBeNull();
    render({ wired: true });

    const original = pinchToolbar();

    expect(original.defaultPrevented).toBe(true);
    expect(seen).toHaveLength(1);
  });
});
