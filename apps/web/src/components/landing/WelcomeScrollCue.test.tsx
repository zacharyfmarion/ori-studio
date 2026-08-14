import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WelcomeScrollCue } from './WelcomeScrollCue';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/**
 * A stand-in scroller. jsdom does not lay anything out, so `scrollTop` is just a
 * number here — which is all the cue reads — and the scroll event is dispatched
 * by hand.
 *
 * Worth having precisely because the browser pane cannot check this: it runs
 * `visibilityState: hidden` with no animation frames, and scroll events are
 * frame-driven, so they never fire there.
 */
function renderCue(options: { onActivate?: () => void } = {}) {
  container = document.createElement('div');
  document.body.append(container);

  const scroller = document.createElement('div');
  const target = document.createElement('div');
  target.id = 'landing-what';
  target.scrollIntoView = vi.fn();
  scroller.append(target);
  container.append(scroller);

  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement | null }).current = scroller;

  const mount = document.createElement('div');
  container.append(mount);
  root = createRoot(mount);
  act(() =>
    root?.render(
      <WelcomeScrollCue scrollerRef={ref} targetId="landing-what" onActivate={options.onActivate} />
    )
  );

  return { scroller, target, cue: () => mount.querySelector('.welcome-scroll-cue')! };
}

function scrollTo(scroller: HTMLElement, top: number) {
  scroller.scrollTop = top;
  act(() => {
    scroller.dispatchEvent(new Event('scroll'));
  });
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('WelcomeScrollCue', () => {
  it('shows while the page is at the top', () => {
    const { cue } = renderCue();
    expect(cue().hasAttribute('data-hidden')).toBe(false);
  });

  it('hides once the page has scrolled', () => {
    const { scroller, cue } = renderCue();

    scrollTo(scroller, 400);
    expect(cue().hasAttribute('data-hidden')).toBe(true);
  });

  it('comes back when the page returns to the top', () => {
    const { scroller, cue } = renderCue();

    scrollTo(scroller, 400);
    scrollTo(scroller, 0);
    expect(cue().hasAttribute('data-hidden')).toBe(false);
  });

  it('tolerates a few pixels of drift before hiding', () => {
    // Momentum and rubber-banding leave the scroller a hair off zero; flickering
    // the cue at 1px of travel would be worse than a small dead zone.
    const { scroller, cue } = renderCue();

    scrollTo(scroller, 8);
    expect(cue().hasAttribute('data-hidden')).toBe(false);
  });

  it('scrolls to its target and reports the activation', () => {
    const onActivate = vi.fn();
    const { target, cue } = renderCue({ onActivate });

    act(() => cue().querySelector('button')!.click());

    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('is a real control, reachable and named', () => {
    // It used to be aria-hidden with tabIndex -1, which was defensible while it
    // was a faint pill and is not now that it is the most prominent thing on the
    // first screen.
    const { cue } = renderCue();
    const button = cue().querySelector('button')!;

    expect(button.getAttribute('aria-hidden')).toBeNull();
    expect(button.tabIndex).toBe(0);
    expect(button.textContent).toContain('See what it does');
  });

  it('drops its listener when it goes away', () => {
    const { scroller } = renderCue();
    const remove = vi.spyOn(scroller, 'removeEventListener');

    act(() => root?.unmount());
    root = null;

    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
