import { AT_TOP_THRESHOLD_PX } from '../components/landing/scrollCueThreshold';
import { detectDownloadOs } from '../platform/downloadOs';
import { THEME_TYPE_ATTRIBUTE } from '../themes/applyThemeVariables';
import { SEO_CONTENT_ID } from './siteMeta';
import {
  PHONE_COPY_TEMPLATE_ID,
  STATIC_PAINT_ATTRIBUTE,
  STATIC_PAINT_SHOWN,
  STATIC_SCROLL_ATTRIBUTE,
  type StaticPaintBodyConfig,
} from './staticPaint';

/**
 * The body half of the static first paint (see `staticPaint.ts`), inline after the copy and
 * its phone variant: by the time it runs, the parser has read all of both, and nothing of
 * either has been shown. Everything here happens in one task, so the browser renders the
 * finished page or nothing.
 */

/** The phone variant, in the desktop copy's place. */
function swapInPhoneCopy(copy: HTMLElement, template: HTMLElement | null): HTMLElement {
  const phone = template instanceof HTMLTemplateElement ? template.content.firstElementChild : null;
  // Never the desktop copy on a phone: without its variant, the copy goes.
  if (!(phone instanceof HTMLElement)) throw new Error('no phone copy');
  copy.replaceWith(phone);
  return phone;
}

/** The static render cannot know the platform; the live one names it on the button. */
function labelDownloads(page: HTMLElement, label: string): void {
  for (const link of page.querySelectorAll('.ui-split-button__primary')) {
    const text = [...link.childNodes].reverse().find((node) => node.nodeType === Node.TEXT_NODE);
    if (text) text.nodeValue = label;
  }
}

/** Screenshots come in a light and a dark master; the copy was rendered with the dark ones. */
function lightFigures(page: HTMLElement): void {
  for (const image of page.querySelectorAll('img.landing-figure__image')) {
    for (const attribute of ['src', 'srcset']) {
      const value = image.getAttribute(attribute);
      if (value) image.setAttribute(attribute, value.replace(/-dark(?=(?:-\d+w)?\.webp)/g, '-light'));
    }
  }
}

/**
 * The lazy screenshots, held back until the copy's paint is recorded (see {@link startApp}).
 * None is in the first screenful, but lazy loading reaches 1250–2500 px past it, so the frame
 * that paints the copy would otherwise request most of them — and PageSpeed charges LCP for
 * every byte requested before it, which put a third of a megabyte of screenshots nobody could
 * see yet between the landing and its score. Their frames are sized by CSS, so nothing moves;
 * `alt` goes too, or the empty frame would paint its text.
 */
const HELD_ATTRIBUTES = ['srcset', 'src', 'alt'] as const;
const HELD_PREFIX = 'data-held-';

function holdImages(page: HTMLElement): void {
  for (const image of page.querySelectorAll('img[loading="lazy"]')) {
    for (const name of HELD_ATTRIBUTES) {
      const value = image.getAttribute(name);
      if (value === null) continue;
      image.setAttribute(`${HELD_PREFIX}${name}`, value);
      image.removeAttribute(name);
    }
  }
}

function releaseImages(doc: Document): void {
  for (const image of doc.querySelectorAll(`img[${HELD_PREFIX}src]`)) {
    for (const name of HELD_ATTRIBUTES) {
      const value = image.getAttribute(`${HELD_PREFIX}${name}`);
      if (value === null) continue;
      image.setAttribute(name, value);
      image.removeAttribute(`${HELD_PREFIX}${name}`);
    }
  }
}

/** Keep the cue and the scroll position where the live page will expect them. */
function followScroll(page: HTMLElement): void {
  const scroller = page.querySelector<HTMLElement>('.welcome-page');
  const cue = page.querySelector('.welcome-scroll-cue');
  scroller?.addEventListener(
    'scroll',
    () => {
      page.setAttribute(STATIC_SCROLL_ATTRIBUTE, String(scroller.scrollTop));
      if (scroller.scrollTop < AT_TOP_THRESHOLD_PX) cue?.removeAttribute('data-hidden');
      else cue?.setAttribute('data-hidden', 'true');
    },
    { passive: true }
  );
}

/**
 * How long past the first frame the app waits for the browser to record the copy's paint,
 * when it never says so — input before the first paint stops the recording, for one.
 */
const RECORD_WAIT_MS = 500;

/**
 * Start the app. With a copy on screen, only once the browser has recorded the copy's paint.
 * The entry is already downloading (the HTML preloads it), and evaluating it sooner would
 * hold the very frame that paints the copy — or, on a fast network, run ahead of it.
 *
 * Recorded, not merely presented: Chrome enters a paint as the page's largest some time
 * after presenting it, and a copy the app has replaced by then is dropped — so the metric
 * reports the app's identical render instead, later, for a page that looked the same all
 * along. That is how PageSpeed came to date the landing's LCP to React. The entry arrives
 * 6–21 ms after the paint (measured), about the two frames waited where there is no entry
 * to wait for: the first callback runs before its frame renders. A hidden tab renders no
 * frames, and has no paint to protect.
 */
function startApp(entry: string, afterPaint: boolean, win: Window): void {
  const doc = win.document;
  let observer: PerformanceObserver | null = null;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    observer?.disconnect();
    releaseImages(doc);
    const script = doc.createElement('script');
    script.type = 'module';
    script.setAttribute('crossorigin', '');
    script.src = entry;
    doc.head.append(script);
  };
  if (!afterPaint || doc.visibilityState !== 'visible') return start();
  const Observer = (win as Window & typeof globalThis).PerformanceObserver;
  if (!Observer?.supportedEntryTypes?.includes('largest-contentful-paint')) {
    win.requestAnimationFrame(() => win.requestAnimationFrame(start));
    return;
  }
  const recorded = new Observer(start);
  observer = recorded;
  recorded.observe({ type: 'largest-contentful-paint', buffered: true });
  // From the first frame, not from now: until the stylesheet arrives there is no frame, and
  // a timer started here could run out before the copy had ever been painted.
  win.requestAnimationFrame(() => win.setTimeout(start, RECORD_WAIT_MS));
}

/**
 * Finish the copy the head script chose, or remove it, and start the app. Returns whether
 * the copy stayed. Never throws: a failure removes the copy instead, and either way the app
 * starts — no head decision at all (the head script failed, or never ran) counts as `off`.
 */
export function finishStaticPaint(config: StaticPaintBodyConfig, win: Window = window): boolean {
  const doc = win.document;
  const root = doc.documentElement;
  const decision = root.getAttribute(STATIC_PAINT_ATTRIBUTE);
  const template = doc.getElementById(PHONE_COPY_TEMPLATE_ID);
  let kept = false;
  try {
    const copy = doc.getElementById(SEO_CONTENT_ID);
    if (!copy || (decision !== 'desktop' && decision !== 'phone')) throw new Error('not this page');
    const page = decision === 'phone' ? swapInPhoneCopy(copy, template) : copy;
    labelDownloads(page, config.downloadLabels[detectDownloadOs(win.navigator) ?? 'none']);
    if (root.getAttribute(THEME_TYPE_ATTRIBUTE) === 'light') lightFigures(page);
    holdImages(page);
    followScroll(page);
    root.setAttribute(STATIC_PAINT_ATTRIBUTE, STATIC_PAINT_SHOWN);
    kept = true;
  } catch {
    doc.getElementById(SEO_CONTENT_ID)?.remove();
    root.removeAttribute(STATIC_PAINT_ATTRIBUTE);
  } finally {
    template?.remove();
    startApp(config.entry, kept, win);
  }
  return kept;
}
