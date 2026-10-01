/**
 * Animates an element's height when its content changes size, and when part of
 * it collapses.
 *
 * # How
 *
 * A height can only be transitioned between two lengths, and a box at rest is
 * `height: auto`. So the frame stays `auto` until its content changes; then, in
 * the `ResizeObserver` callback — after layout, before paint — it is pinned at
 * the height it had and handed the height it should have, and the stylesheet's
 * `transition: height` does the rest. When the transition ends it goes back to
 * `auto`. JS places, CSS times: the duration and the curve live in the
 * stylesheet, and this reads the duration back only to know when to give up
 * waiting for `transitionend`.
 *
 * `interpolate-size` / `calc-size()` would make most of this unnecessary, but
 * they were Chromium-only when this was written and the desktop shell is
 * WKWebView.
 *
 * # What the caller supplies
 *
 * - `attachFrame`: the element whose height moves. Give it
 *   `transition: height …` in its stylesheet.
 * - `attachContent`: an element inside it that is always its natural size — not
 *   squeezed by the frame mid-animation — whose resizing is the trigger.
 * - `attachScroller`: the part of the frame that collapsing removes, and that
 *   scrolls when the frame is clamped by a `max-height`.
 *
 * While the frame is between heights it carries `data-resizing`, set here on the
 * element itself so it lands in the same frame as the pinned height, rather than
 * a render later. The caller's stylesheet uses it to lay the content out from
 * whichever edge the frame is anchored by.
 *
 * Only the content is observed, never the frame: the frame's height is set
 * inside the observer's callback, and an observed element resized there is a
 * notification the browser cannot deliver in the same frame — it reports
 * "ResizeObserver loop completed with undelivered notifications" as an error,
 * which the app's global handler turns into a toast. Setting the frame's height
 * never changes the content's size, so watching the content alone cannot loop.
 *
 * Nothing animates under `prefers-reduced-motion: reduce`, nor where there is no
 * `ResizeObserver` or no layout to measure (jsdom): there the frame just takes
 * its new height, and a collapse unmounts at once.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** How long after the transition's own duration to stop waiting for `transitionend`. */
const SETTLE_SLACK_MS = 80;

function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** The frame's own transition duration, in milliseconds. */
function transitionMs(element: HTMLElement): number {
  const first = getComputedStyle(element).transitionDuration.split(',')[0]?.trim() ?? '';
  const value = Number.parseFloat(first);
  if (!Number.isFinite(value)) return 0;
  return first.endsWith('ms') ? value : value * 1000;
}

/** The frame's height if it were left to its content, clamped by its own max-height. */
function naturalHeight(element: HTMLElement): number {
  const { height, transition } = element.style;
  element.style.transition = 'none';
  element.style.height = 'auto';
  const natural = element.getBoundingClientRect().height;
  element.style.height = height;
  // Commit the restored height before the transition comes back, or the restore
  // itself animates.
  void element.offsetHeight;
  element.style.transition = transition;
  return natural;
}

export interface AnimatedHeight {
  attachFrame: (element: HTMLElement | null) => void;
  attachContent: (element: HTMLElement | null) => void;
  attachScroller: (element: HTMLElement | null) => void;
  /**
   * True while a collapse is closing. Keep the collapsing part mounted (and
   * inert) until it is false again; then it can go.
   */
  closing: boolean;
}

export function useAnimatedHeight({ collapsed }: { collapsed: boolean }): AnimatedHeight {
  const frame = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLElement | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  /** The frame's height at rest: where the next change starts from. */
  const restHeight = useRef<number | null>(null);
  const resizing = useRef(false);
  const settleTimer = useRef<number | undefined>(undefined);

  // A collapse keeps the collapsing part mounted until it has closed, so the
  // closing has to start in the same render that collapses — not an effect
  // later, by which time the part would already be gone.
  const [closing, setClosing] = useState(false);
  const [wasCollapsed, setWasCollapsed] = useState(collapsed);
  if (collapsed !== wasCollapsed) {
    setWasCollapsed(collapsed);
    setClosing(collapsed && motionAllowed());
  }
  // Read by the observer callback, which is built once.
  const closingRef = useRef(closing);
  useLayoutEffect(() => {
    closingRef.current = closing;
  }, [closing]);

  const settle = useCallback(() => {
    window.clearTimeout(settleTimer.current);
    resizing.current = false;
    const element = frame.current;
    if (element) {
      element.style.height = '';
      delete element.dataset.resizing;
      restHeight.current = element.getBoundingClientRect().height;
      // Clamped by its max-height, the content was laid out from the anchored
      // edge while it moved. Keep that edge in view rather than jumping back to
      // the other one now the frame scrolls again.
      const scrolling = scroller.current;
      if (scrolling && scrolling.scrollHeight > scrolling.clientHeight) {
        scrolling.scrollTop = scrolling.scrollHeight;
      }
    }
    setClosing(false);
  }, []);

  /** Moves the frame from one height to another. False when there was nothing to move. */
  const animate = useCallback(
    (from: number, to: number): boolean => {
      const element = frame.current;
      if (!element) return false;
      restHeight.current = to;
      if (Math.abs(to - from) < 0.5 || !motionAllowed()) {
        if (resizing.current) settle();
        return false;
      }
      element.style.transition = 'none';
      element.style.height = `${from}px`;
      void element.offsetHeight;
      element.style.transition = '';
      element.dataset.resizing = '';
      element.style.height = `${to}px`;
      resizing.current = true;
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(settle, transitionMs(element) + SETTLE_SLACK_MS);
      return true;
    },
    [settle]
  );

  const onResize = useCallback(
    (entries: ResizeObserverEntry[]) => {
      const element = frame.current;
      if (!element || !entries.some((entry) => entry.target === content.current)) return;
      if (closingRef.current) return;
      const from = resizing.current ? element.getBoundingClientRect().height : restHeight.current;
      const to = naturalHeight(element);
      // The first measurement places the frame; it does not animate into place.
      if (from === null) {
        restHeight.current = to;
        return;
      }
      animate(from, to);
    },
    [animate]
  );

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const next = new ResizeObserver(onResize);
    observer.current = next;
    if (content.current) next.observe(content.current);
    return () => {
      next.disconnect();
      if (observer.current === next) observer.current = null;
    };
  }, [onResize]);

  // A collapse: shrink to what is left without the scroller, then let it go.
  useLayoutEffect(() => {
    if (!closing) return;
    const element = frame.current;
    const part = scroller.current;
    if (!element || !part) {
      setClosing(false);
      return;
    }
    const from = element.getBoundingClientRect().height;
    if (!animate(from, from - part.getBoundingClientRect().height)) setClosing(false);
  }, [animate, closing]);

  // Expanded again before a collapse finished: go back to the content's height.
  useLayoutEffect(() => {
    const element = frame.current;
    if (collapsed || !element || !resizing.current) return;
    animate(element.getBoundingClientRect().height, naturalHeight(element));
  }, [animate, collapsed]);

  useLayoutEffect(() => () => window.clearTimeout(settleTimer.current), []);

  // At rest the frame is `auto`, so a resize of the window can change its height
  // (its max-height is a share of the viewport) without the content changing.
  // Remember where it went, so the next change starts from there.
  useEffect(() => {
    const remember = () => {
      if (!resizing.current && frame.current) {
        restHeight.current = frame.current.getBoundingClientRect().height;
      }
    };
    window.addEventListener('resize', remember);
    return () => window.removeEventListener('resize', remember);
  }, []);

  const onTransitionEnd = useCallback(
    (event: TransitionEvent) => {
      if (event.target === frame.current && event.propertyName === 'height') settle();
    },
    [settle]
  );

  const attachFrame = useCallback(
    (element: HTMLElement | null) => {
      const previous = frame.current;
      if (previous === element) return;
      previous?.removeEventListener('transitionend', onTransitionEnd);
      frame.current = element;
      element?.addEventListener('transitionend', onTransitionEnd);
    },
    [onTransitionEnd]
  );

  const attachContent = useCallback((element: HTMLElement | null) => {
    const previous = content.current;
    if (previous === element) return;
    if (previous) observer.current?.unobserve(previous);
    content.current = element;
    // Observing a newly mounted element reports it at once, which is what makes
    // an expand animate: its first size arrives as a change from the collapsed
    // height.
    if (element) observer.current?.observe(element);
  }, []);

  const attachScroller = useCallback((element: HTMLElement | null) => {
    scroller.current = element;
  }, []);

  return { attachFrame, attachContent, attachScroller, closing };
}
