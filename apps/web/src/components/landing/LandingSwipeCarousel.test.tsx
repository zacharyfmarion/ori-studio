import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingSwipeCarousel, type LandingSwipeItem } from './LandingSwipeCarousel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS = [
  {
    id: 'design-bp',
    figure: 'design-bp',
    title: 'Box Pleating',
    body: 'Flaps on a grid.',
    figureAlt: 'A grid.',
  },
  {
    id: 'design-treemaker',
    figure: 'design-treemaker',
    title: 'Circle Packing',
    body: 'A tree and circles.',
    figureAlt: 'A tree.',
  },
  {
    id: 'design-explori',
    figure: 'design-explori',
    title: 'ExplOri',
    body: 'Search the archive.',
    figureAlt: 'Results.',
  },
] as const satisfies readonly LandingSwipeItem[];

const SLIDE_WIDTH = 600;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/**
 * jsdom lays nothing out, so `clientWidth` is 0 and `scrollTo` does not exist —
 * both of which the carousel's arithmetic depends on. Stub them so the index maths
 * is exercised for real rather than short-circuited.
 */
function renderCarousel() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<LandingSwipeCarousel label="Design methods" items={ITEMS} />));

  const track = container.querySelector<HTMLElement>('.landing-swipe__track')!;
  Object.defineProperty(track, 'clientWidth', { configurable: true, value: SLIDE_WIDTH });
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    track.scrollLeft = options.left ?? 0;
  });
  Object.defineProperty(track, 'scrollTo', { configurable: true, value: scrollTo });
  return { track, scrollTo };
}

function tabs(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
}

function selectedTitle(): string | undefined {
  return tabs().find((t) => t.getAttribute('aria-selected') === 'true')?.textContent ?? undefined;
}

function activeDot(): number {
  return Array.from(container?.querySelectorAll('.landing-swipe__dot') ?? []).findIndex((d) =>
    d.hasAttribute('data-active'),
  );
}

function scrollTrackTo(track: HTMLElement, left: number) {
  track.scrollLeft = left;
  act(() => {
    track.dispatchEvent(new Event('scroll'));
  });
}

function pointer(type: string, init: { id?: number; x?: number; kind?: string } = {}) {
  const event = new Event(type, { bubbles: true }) as Event & Record<string, unknown>;
  event.pointerId = init.id ?? 1;
  event.clientX = init.x ?? 0;
  event.pointerType = init.kind ?? 'mouse';
  return event as unknown as PointerEvent;
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('LandingSwipeCarousel', () => {
  it('starts on the first slide', () => {
    renderCarousel();
    expect(selectedTitle()).toBe('Box Pleating');
    expect(activeDot()).toBe(0);
  });

  it('renders every slide, which is what makes the track scrollable', () => {
    const { track } = renderCarousel();
    expect(track.querySelectorAll('.landing-swipe__slide')).toHaveLength(3);
    expect(track.querySelectorAll('.landing-figure')).toHaveLength(3);
  });

  it('scrolls to a slide when its tab is pressed', () => {
    const { scrollTo } = renderCarousel();

    act(() => tabs()[2].click());

    expect(scrollTo).toHaveBeenCalledWith({ left: 2 * SLIDE_WIDTH, behavior: 'smooth' });
    expect(selectedTitle()).toBe('ExplOri');
  });

  it('follows a swipe it never initiated', () => {
    // The whole point of reading the index off scroll position: a thumb drag
    // goes through the browser, not through this component.
    const { track } = renderCarousel();

    scrollTrackTo(track, SLIDE_WIDTH);
    expect(selectedTitle()).toBe('Circle Packing');
    expect(activeDot()).toBe(1);

    scrollTrackTo(track, 2 * SLIDE_WIDTH);
    expect(selectedTitle()).toBe('ExplOri');
  });

  it('rounds a part-way scroll to the nearest slide', () => {
    const { track } = renderCarousel();

    scrollTrackTo(track, SLIDE_WIDTH * 0.6);
    expect(selectedTitle()).toBe('Circle Packing');
    scrollTrackTo(track, SLIDE_WIDTH * 0.4);
    expect(selectedTitle()).toBe('Box Pleating');
  });

  it('moves with the arrow keys on both axes, and wraps', () => {
    renderCarousel();
    const list = container!.querySelector('[role="tablist"]')!;
    const press = (key: string) =>
      act(() => {
        list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });

    press('ArrowRight');
    expect(selectedTitle()).toBe('Circle Packing');
    press('ArrowDown');
    expect(selectedTitle()).toBe('ExplOri');
    press('ArrowRight');
    expect(selectedTitle()).toBe('Box Pleating');
    press('End');
    expect(selectedTitle()).toBe('ExplOri');
    press('Home');
    expect(selectedTitle()).toBe('Box Pleating');
  });

  it('keeps one tab stop for the whole control', () => {
    renderCarousel();
    const reachable = tabs().filter((tab) => tab.tabIndex === 0);
    expect(reachable).toHaveLength(1);
    expect(reachable[0].getAttribute('aria-selected')).toBe('true');
  });

  it('hides the slides that are not showing from assistive tech', () => {
    const { track } = renderCarousel();
    const hidden = () =>
      Array.from(track.querySelectorAll('.landing-swipe__slide')).map((s) =>
        s.getAttribute('aria-hidden'),
      );

    expect(hidden()).toEqual([null, 'true', 'true']);
    scrollTrackTo(track, SLIDE_WIDTH);
    expect(hidden()).toEqual(['true', null, 'true']);
  });

  it('jumps without animating under reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({
        matches: q.includes('reduce'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const { scrollTo } = renderCarousel();

    act(() => tabs()[1].click());

    expect(scrollTo).toHaveBeenCalledWith({ left: SLIDE_WIDTH, behavior: 'auto' });
  });

  it('snaps to the nearest slide when a mouse drag lets go', () => {
    const { track, scrollTo } = renderCarousel();

    act(() => {
      track.dispatchEvent(pointer('pointerdown', { x: 500 }));
      track.dispatchEvent(pointer('pointermove', { x: 100 })); // 400px left, past the threshold
      track.dispatchEvent(pointer('pointerup', { x: 100 }));
    });

    // Dragged 400 of a 600px slide, so it lands on the next one rather than between.
    expect(track.scrollLeft).toBe(SLIDE_WIDTH);
    expect(scrollTo).toHaveBeenCalledWith({ left: SLIDE_WIDTH, behavior: 'smooth' });
  });

  it('suspends scroll snapping for the length of a drag', () => {
    // Without this the drag does nothing at all: under `scroll-snap-type:
    // mandatory` the browser re-snaps after every scroll write, so each
    // intermediate position is undone as it is set. jsdom has no snapping, so
    // the only thing a test can check is that the flag the stylesheet keys on
    // goes on for the drag and comes off after.
    const { track } = renderCarousel();

    act(() => {
      track.dispatchEvent(pointer('pointerdown', { x: 500 }));
      track.dispatchEvent(pointer('pointermove', { x: 480 }));
    });
    expect(track.hasAttribute('data-dragging')).toBe(true);

    act(() => track.dispatchEvent(pointer('pointerup', { x: 480 })));
    expect(track.hasAttribute('data-dragging')).toBe(false);
  });

  it('never flags a drag that never started', () => {
    const { track } = renderCarousel();

    act(() => {
      track.dispatchEvent(pointer('pointerdown', { x: 500 }));
      track.dispatchEvent(pointer('pointermove', { x: 497 }));
      track.dispatchEvent(pointer('pointerup', { x: 497 }));
    });

    expect(track.hasAttribute('data-dragging')).toBe(false);
  });

  it('jumps to a slide when its dot is pressed', () => {
    // They read as controls, so they have to be controls.
    const { scrollTo } = renderCarousel();
    const dots = Array.from(container!.querySelectorAll<HTMLButtonElement>('.landing-swipe__dot'));

    expect(dots.map((d) => d.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual([
      'Box Pleating',
      'Circle Packing',
      'ExplOri',
    ]);

    act(() => dots[2].click());

    expect(selectedTitle()).toBe('ExplOri');
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 2 * SLIDE_WIDTH, behavior: 'smooth' });
  });

  it('commits on a short flick, well short of half a slide', () => {
    // The threshold is min(15% of the track, 64px) measured from where the drag
    // began — not "round to the nearest slide", which on a 600px track would
    // have needed 300px of travel before anything moved.
    const { track, scrollTo } = renderCarousel();

    act(() => {
      track.dispatchEvent(pointer('pointerdown', { x: 500 }));
      track.dispatchEvent(pointer('pointermove', { x: 430 })); // 70px, over the 64px threshold
      track.dispatchEvent(pointer('pointerup', { x: 430 }));
    });

    expect(selectedTitle()).toBe('Circle Packing');
    expect(scrollTo).toHaveBeenLastCalledWith({ left: SLIDE_WIDTH, behavior: 'smooth' });
  });

  it('returns to where it started when the drag is smaller than that', () => {
    const { track } = renderCarousel();

    act(() => {
      track.dispatchEvent(pointer('pointerdown', { x: 500 }));
      track.dispatchEvent(pointer('pointermove', { x: 460 })); // 40px, under the threshold
      track.dispatchEvent(pointer('pointerup', { x: 460 }));
    });

    expect(selectedTitle()).toBe('Box Pleating');
  });

  it('takes more than one slide when the drag covers more than one', () => {
    const { track } = renderCarousel();

    act(() => {
      track.dispatchEvent(pointer('pointerdown', { x: 1400 }));
      track.dispatchEvent(pointer('pointermove', { x: 200 })); // 1200px == two slides
      track.dispatchEvent(pointer('pointerup', { x: 200 }));
    });

    expect(selectedTitle()).toBe('ExplOri');
  });

  it('does not run off the end of the track', () => {
    const { track } = renderCarousel();

    act(() => {
      track.dispatchEvent(pointer('pointerdown', { x: 5000 }));
      track.dispatchEvent(pointer('pointermove', { x: 0 })); // far past the last slide
      track.dispatchEvent(pointer('pointerup', { x: 0 }));
    });

    expect(selectedTitle()).toBe('ExplOri');
  });

  it('leaves a click alone when the pointer barely moved', () => {
    const { track, scrollTo } = renderCarousel();

    act(() => {
      track.dispatchEvent(pointer('pointerdown', { x: 500 }));
      track.dispatchEvent(pointer('pointermove', { x: 497 })); // 3px, under the threshold
      track.dispatchEvent(pointer('pointerup', { x: 497 }));
    });

    expect(track.scrollLeft).toBe(0);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('ignores touch, which the browser already handles better', () => {
    const { track } = renderCarousel();

    act(() => {
      track.dispatchEvent(pointer('pointerdown', { x: 500, kind: 'touch' }));
      track.dispatchEvent(pointer('pointermove', { x: 100, kind: 'touch' }));
    });

    expect(track.scrollLeft).toBe(0);
  });

  it('steps with the arrow buttons', () => {
    const { scrollTo } = renderCarousel();
    const arrows = () =>
      Array.from(container!.querySelectorAll<HTMLButtonElement>('.landing-swipe__arrow'));
    const [prev, next] = arrows();

    act(() => next.click());
    expect(selectedTitle()).toBe('Circle Packing');
    expect(scrollTo).toHaveBeenLastCalledWith({ left: SLIDE_WIDTH, behavior: 'smooth' });

    act(() => prev.click());
    expect(selectedTitle()).toBe('Box Pleating');
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' });
  });

  it('clamps the arrows at the ends rather than wrapping', () => {
    // The track is a scroll container, not a loop: a "next" that scrolls all the
    // way back to the start is a jump, not a step.
    renderCarousel();
    const arrows = () =>
      Array.from(container!.querySelectorAll<HTMLButtonElement>('.landing-swipe__arrow'));

    expect(arrows().map((a) => a.disabled)).toEqual([true, false]);

    act(() => arrows()[1].click());
    expect(arrows().map((a) => a.disabled)).toEqual([false, false]);

    act(() => arrows()[1].click());
    expect(selectedTitle()).toBe('ExplOri');
    expect(arrows().map((a) => a.disabled)).toEqual([false, true]);
  });

  it('names the arrows, since a chevron alone says nothing', () => {
    renderCarousel();
    const labels = Array.from(container!.querySelectorAll('.landing-swipe__arrow')).map((a) =>
      a.getAttribute('aria-label'),
    );

    expect(labels).toEqual(['Previous', 'Next']);
  });

  it('drops the tabs and titles each slide instead when asked', () => {
    // The phone shape. The pill row costs a row or two of vertical space to
    // duplicate what a swipe already does, so the title moves onto the slide,
    // under its own screenshot.
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(<LandingSwipeCarousel label="Design methods" items={ITEMS} showTabs={false} />),
    );

    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(0);
    expect(
      Array.from(container.querySelectorAll('.landing-swipe__slide-title')).map(
        (h) => h.textContent,
      ),
    ).toEqual(['Box Pleating', 'Circle Packing', 'ExplOri']);

    // No tablist means no tabpanels either; calling them that would be a lie.
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(0);
    const track = container.querySelector('.landing-swipe__track')!;
    expect(track.getAttribute('role')).toBe('group');
    expect(track.getAttribute('aria-label')).toBe('Design methods');
  });

  it('reports where it came to rest, not every slide it passed', () => {
    vi.useFakeTimers();
    const { track } = renderCarousel();

    scrollTrackTo(track, SLIDE_WIDTH);
    scrollTrackTo(track, 2 * SLIDE_WIDTH);
    act(() => vi.advanceTimersByTime(400));

    // Both changes happened inside the settle window, so only the landing slide
    // is worth an event — the middle one was passed through, not opened.
    expect(selectedTitle()).toBe('ExplOri');
  });
});
