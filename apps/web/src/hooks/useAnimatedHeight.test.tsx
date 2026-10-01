import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnimatedHeight } from './useAnimatedHeight';

/**
 * jsdom does no layout and has no ResizeObserver, so both are stood in for:
 * the observer is fired by hand, and the frame reports whatever height its
 * inline style pins it at, or its "natural" height when it is left to `auto`.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let observers: FakeResizeObserver[] = [];

class FakeResizeObserver {
  readonly observed = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.observed.clear();
  }
  fire(targets: Element[]) {
    const entries = targets
      .filter((target) => this.observed.has(target))
      .map((target) => ({ target }) as ResizeObserverEntry);
    if (entries.length > 0) this.callback(entries, this as unknown as ResizeObserver);
  }
}

let natural = 100;
let scrollerHeight = 70;
let reducedMotion = false;
let container: HTMLDivElement;
let root: Root;

function Probe({ collapsed }: { collapsed: boolean }) {
  const { attachFrame, attachContent, attachScroller, closing } = useAnimatedHeight({
    collapsed,
  });
  return (
    <section ref={attachFrame} data-testid="frame">
      <header>Title</header>
      {(!collapsed || closing) && (
        <div ref={attachScroller} data-testid="scroller" inert={closing}>
          <div ref={attachContent} data-testid="content" />
        </div>
      )}
    </section>
  );
}

const frame = () => container.querySelector<HTMLElement>('[data-testid="frame"]')!;
const content = () => container.querySelector<HTMLElement>('[data-testid="content"]');
const scroller = () => container.querySelector<HTMLElement>('[data-testid="scroller"]');

/** What the frame measures: its pinned height, or its content's when it is left to `auto`. */
function stubLayout() {
  const element = frame();
  element.getBoundingClientRect = () => {
    const pinned = Number.parseFloat(element.style.height);
    return { height: Number.isFinite(pinned) ? pinned : natural } as DOMRect;
  };
  const part = scroller();
  if (part) part.getBoundingClientRect = () => ({ height: scrollerHeight }) as DOMRect;
}

function render(collapsed = false) {
  act(() => root.render(<Probe collapsed={collapsed} />));
  stubLayout();
}

/** The content's observer reports a change, as it would after a layout. */
function contentResized() {
  act(() => {
    const target = content();
    for (const observer of observers) observer.fire(target ? [target, frame()] : [frame()]);
  });
}

function transitionEnded() {
  act(() => {
    const event = new Event('transitionend');
    Object.defineProperty(event, 'propertyName', { value: 'height' });
    frame().dispatchEvent(event);
  });
}

beforeEach(() => {
  observers = [];
  natural = 100;
  scrollerHeight = 70;
  reducedMotion = false;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reducedMotion }))
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useAnimatedHeight', () => {
  it('places the first height without animating', () => {
    render();
    contentResized();

    expect(frame().style.height).toBe('');
    expect(frame().dataset.resizing).toBeUndefined();
  });

  it('moves from the old height to the new one, then lets go', () => {
    render();
    contentResized();

    natural = 150;
    contentResized();

    expect(frame().style.height).toBe('150px');
    expect(frame().dataset.resizing).toBe('');

    transitionEnded();

    expect(frame().style.height).toBe('');
    expect(frame().dataset.resizing).toBeUndefined();
  });

  it('jumps under reduced motion', () => {
    reducedMotion = true;
    render();
    contentResized();

    natural = 150;
    contentResized();

    expect(frame().style.height).toBe('');
    expect(frame().dataset.resizing).toBeUndefined();
  });

  it('stops waiting when no transitionend comes', () => {
    vi.useFakeTimers();
    render();
    contentResized();

    natural = 60;
    contentResized();
    expect(frame().dataset.resizing).toBe('');

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(frame().style.height).toBe('');
    expect(frame().dataset.resizing).toBeUndefined();
  });

  it('keeps a collapsing part, inert, until the frame has closed over it', () => {
    render();
    contentResized();

    render(true);

    // Shrinks to what is left without the scroller.
    expect(frame().style.height).toBe(`${natural - scrollerHeight}px`);
    expect(scroller()).not.toBeNull();
    expect(scroller()?.hasAttribute('inert')).toBe(true);

    transitionEnded();

    expect(scroller()).toBeNull();
    expect(frame().style.height).toBe('');
  });

  it('collapses at once when nothing can move', () => {
    reducedMotion = true;
    render();
    contentResized();

    render(true);

    expect(scroller()).toBeNull();
    expect(frame().style.height).toBe('');
  });
});
