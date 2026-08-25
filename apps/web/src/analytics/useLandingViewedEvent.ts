import { useEffect } from 'react';
import type { LandingSectionId, LandingSurface } from './events';
import { track } from './runtime';

/**
 * Emit `landing viewed` when `/welcome` mounts, saying which register it drew.
 *
 * The `surface` split used to be the denominator for `mobile block bypassed` —
 * how many people met the desktop-only notice against how many pushed past it,
 * which is what decided whether phone support was worth building. It was, the
 * gate is gone, and the split now answers the plainer question of how much of
 * the audience arrives on a phone at all.
 *
 * Lives in the view component, the idiomatic home for a "viewed" event, rather
 * than in a store subscription.
 */
export function useLandingViewedEvent(surface: LandingSurface): void {
  useEffect(() => {
    track('landing viewed', { surface });
  }, [surface]);
}

/**
 * Report the first time each landing section scrolls into view.
 *
 * How far down people actually read is the only signal that says which sections
 * earn their place; without it a landing page just accretes. Fired once per
 * section per mount — `observer.unobserve` on the first hit, so a section
 * scrolled past repeatedly does not inflate its own count.
 *
 * `scrollerRef` is the observer root, not just the thing being watched: the page
 * scrolls inside an element rather than the viewport, so the default root would
 * never intersect.
 *
 * `sections` must be a stable reference — a module constant, not an array built
 * in render — since it is what the effect re-subscribes on.
 */
export function useLandingSectionViewedEvents(
  scrollerRef: React.RefObject<HTMLElement | null>,
  sections: ReadonlyArray<{ id: string; section: LandingSectionId }>
): void {
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root || typeof IntersectionObserver !== 'function') return;

    const bySection = new Map<Element, LandingSectionId>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const section = bySection.get(entry.target);
          if (!section) continue;
          observer.unobserve(entry.target);
          track('landing section viewed', { section });
        }
      },
      // A third of a section on screen is "read", not "scrolled past".
      { root, threshold: 0.33 }
    );

    for (const { id, section } of sections) {
      const element = root.querySelector(`#${id}`);
      if (!element) continue;
      bySection.set(element, section);
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, [scrollerRef, sections]);
}
