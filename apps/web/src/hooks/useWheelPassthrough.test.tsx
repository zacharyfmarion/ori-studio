import { act, useCallback, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWheelPassthrough } from './useWheelPassthrough';

/**
 * Chrome floating over a canvas, and the canvas it is covering.
 *
 * Two things are asserted throughout. `defaultPrevented` on the original: a
 * trackpad pinch arrives as ctrl+wheel, so anything not claimed here becomes
 * browser page zoom. And the deltas and modifiers arriving intact on the target,
 * since a copy that loses `ctrlKey` turns a pinch into a pan.
 */

/** Where the chrome should forward to. */
type Target = 'canvas' | 'self' | 'none';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let forwarded: WheelEvent[] = [];

function Harness({ target, wired = true }: { target: Target; wired?: boolean }): ReactNode {
  const [chrome, setChrome] = useState<HTMLDivElement | null>(null);
  const resolve = useCallback(() => {
    if (target === 'none') return null;
    return host?.querySelector(target === 'canvas' ? 'canvas' : '.inner') ?? null;
  }, [target]);

  useWheelPassthrough(chrome, wired ? resolve : undefined);

  return (
    <>
      <div className="chrome" ref={setChrome}>
        <span className="inner" />
      </div>
      <canvas />
    </>
  );
}

function render(target: Target, wired?: boolean) {
  act(() => {
    root?.render(<Harness target={target} wired={wired} />);
  });
}

function chromeElement(): HTMLElement {
  const element = host?.querySelector('.chrome');
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

/** Dispatch a trackpad pinch at the chrome; the browser reports one as ctrl+wheel. */
function pinchChrome(): WheelEvent {
  const event = new WheelEvent('wheel', {
    deltaY: -120,
    deltaX: 7,
    deltaMode: 1,
    clientX: 40,
    clientY: 50,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    chromeElement().dispatchEvent(event);
  });
  return event;
}

/** Anything that reaches the canvas, however it got there. */
function collect(event: Event) {
  if (event instanceof WheelEvent && (event.target as Element | null)?.tagName === 'CANVAS') {
    forwarded.push(event);
  }
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  forwarded = [];
  document.addEventListener('wheel', collect, true);
});

afterEach(() => {
  document.removeEventListener('wheel', collect, true);
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('useWheelPassthrough', () => {
  it('claims the gesture and hands it to the target', () => {
    render('canvas');

    const original = pinchChrome();

    expect(original.defaultPrevented).toBe(true);
    expect(forwarded).toHaveLength(1);
  });

  it('copies the deltas and the modifiers that tell a pinch from a pan', () => {
    render('canvas');

    pinchChrome();

    const copy = forwarded[0];
    expect(copy.ctrlKey).toBe(true);
    expect(copy.deltaY).toBe(-120);
    expect(copy.deltaX).toBe(7);
    // Firefox reports line-mode deltas; a copy that drops the mode runs ~16x off.
    expect(copy.deltaMode).toBe(1);
    expect(copy.clientX).toBe(40);
    expect(copy.clientY).toBe(50);
  });

  it('does not let the copy bubble back through the chrome that forwarded it', () => {
    render('canvas');

    pinchChrome();

    expect(forwarded[0].bubbles).toBe(false);
  });

  it('still claims the gesture when no target resolves', () => {
    render('none');

    const original = pinchChrome();

    // Dropping it is the point: escalating to the browser would zoom the page,
    // which is never what a wheel over canvas chrome meant.
    expect(original.defaultPrevented).toBe(true);
    expect(forwarded).toHaveLength(0);
  });

  it('refuses to forward into its own subtree', () => {
    render('self');

    const original = pinchChrome();

    expect(original.defaultPrevented).toBe(true);
    expect(forwarded).toHaveLength(0);
  });

  it('leaves the wheel alone when no resolver is supplied', () => {
    render('canvas', false);

    const original = pinchChrome();

    // Chrome floating over ordinary scrollable content must still scroll it.
    expect(original.defaultPrevented).toBe(false);
    expect(forwarded).toHaveLength(0);
  });

  it('stops listening once unmounted', () => {
    render('canvas');
    const chrome = chromeElement();

    act(() => root?.unmount());
    root = null;

    const event = new WheelEvent('wheel', {
      deltaY: -120,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    chrome.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(forwarded).toHaveLength(0);
  });
});
