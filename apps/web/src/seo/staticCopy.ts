import { SEO_CONTENT_ID } from './siteMeta';
import { STATIC_PAINT_ATTRIBUTE, STATIC_SCROLL_ATTRIBUTE } from './staticPaint';

/**
 * Replace the prerendered copy of the welcome page with the live one.
 *
 * Called from the route's layout effect: React has committed the live page into `#root`,
 * and the browser has not painted since. Removing the copy here makes the swap one frame
 * with no in-between state — and because the two renders are the same components
 * (`WelcomePage`), that frame looks exactly like the one before it. No-op when the body
 * script already removed the copy, or there never was one (dev, the desktop app).
 */
export function takeOverStaticCopy(liveScroller: HTMLElement | null): void {
  const copy = document.getElementById(SEO_CONTENT_ID);
  if (!copy) return;
  const scrolled = Number(copy.getAttribute(STATIC_SCROLL_ATTRIBUTE) ?? 0);
  if (liveScroller && scrolled > 0) liveScroller.scrollTop = scrolled;
  copy.remove();
  document.documentElement.removeAttribute(STATIC_PAINT_ATTRIBUTE);
}
