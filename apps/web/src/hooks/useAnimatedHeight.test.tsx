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

function Probe({ collapsed, startKey }: { collapsed: boolean; startKey?: string }) {
  const { attachFrame, attachContent, attachScroller, closing } = useAnimatedHeight({
    collapsed,
    ...(startKey !== undefined ? { startKey } : {}),
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

function render(collapsed = false, startKey?: string) {
  act(() => root.render(<Probe collapsed={collapsed} {...(startKey !== undefined ? { startKey } : {})} />));
  stubLayout();
}

/** A scroller whose content outgrows it, its scroll position kept as a browser keeps one. */
function stubScrolling(): { top: () => number; scrollTo: (top: number) => void } {
  const part = scroller()!;
  let top = 0;
  Object.defineProperty(part, 'scrollHeight', { configurable: true, get: () => 300 });
  Object.defineProperty(part, 'clientHeight', { configurable: true, get: () => 100 });
  Object.defineProperty(part, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, 200));
    },
  });
  return { top: () => top, scrollTo: (value) => (part.scrollTop = value) };
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

  it('holds the content at its width while the frame moves, so a scrollbar the move takes away cannot reflow it', () => {
    render();
    // Laid out beside a scrollbar: the frame was capped and scrolled.
    content()!.getBoundingClientRect = () => ({ width: 262, height: 613 }) as DOMRect;
    contentResized();

    natural = 150;
    contentResized();

    // Pinned in the observer's own callback, before the frame stops scrolling.
    expect(frame().dataset.resizing).toBe('');
    expect(content()?.style.width).toBe('262px');

    transitionEnded();

    expect(content()?.style.width).toBe('');
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

  it('keeps the pinned edge in view once a capped frame has moved, as a pressed control there stays put', () => {
    render();
    const scrolling = stubScrolling();
    contentResized();
    natural = 150;
    contentResized();
    transitionEnded();
    expect(scrolling.top()).toBe(200);
  });

  it('shows content that started over from its top, and keeps the pinned edge for changes under one key', () => {
    render(false, 'valley:locate');
    const scrolling = stubScrolling();
    contentResized();
    scrolling.scrollTo(120);

    // A new key: to the top at once, laid out from there while the frame moves, and left there.
    render(false, 'valley:preview');
    expect(scrolling.top()).toBe(0);
    natural = 150;
    contentResized();
    expect(frame().dataset.resizing).toBe('start');
    transitionEnded();
    expect(scrolling.top()).toBe(0);

    // A change under the same key keeps the pinned edge, as without a key.
    natural = 180;
    contentResized();
    expect(frame().dataset.resizing).toBe('');
    transitionEnded();
    expect(scrolling.top()).toBe(200);
  });

  it('opens keyed content at its top', () => {
    render(false, 'valley:preview');
    contentResized();
    // Collapsed to its header…
    render(true, 'valley:preview');
    natural = 100 - scrollerHeight;
    transitionEnded();
    expect(scroller()).toBeNull();
    // …and opened again.
    natural = 100;
    render(false, 'valley:preview');
    const scrolling = stubScrolling();
    contentResized();
    expect(frame().dataset.resizing).toBe('start');
    transitionEnded();
    expect(scrolling.top()).toBe(0);
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
