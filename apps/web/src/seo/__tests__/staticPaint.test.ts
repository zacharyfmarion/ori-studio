import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storageKey, STORAGE_KEYS } from '../../lib/storage';
import { PHONE_MEDIA_QUERY } from '../../platform/phoneLayoutQuery';
import { LIGHT_SCHEME_QUERY } from '../../themes/initialTheme';
import { SEO_CONTENT_ID } from '../siteMeta';
import {
  PHONE_COPY_TEMPLATE_ID,
  STATIC_PAINT_ATTRIBUTE,
  STATIC_SCROLL_ATTRIBUTE,
  type StaticPaintBodyConfig,
  type StaticPaintHeadConfig,
} from '../staticPaint';
import { finishStaticPaint } from '../staticPaintBody';
import { decideStaticPaint } from '../staticPaintHead';

/**
 * The two inline scripts that let the prerendered landing be a first visit's first paint.
 * `scripts/static-paint-check.mjs` holds the result to zero differing pixels in real
 * browsers; these pin the decisions that lane cannot enumerate — every visitor the copy
 * must never be shown to, and every way the body script can fail — without a build.
 */

const HEAD: StaticPaintHeadConfig = {
  paths: ['/', '/welcome'],
  locale: 'en',
  themes: {
    Night: { type: 'dark', variables: [['--bg-primary', '#101417']] },
    Day: { type: 'light', variables: [['--bg-primary', '#fbfaf6']] },
  },
  presetNames: ['Night', 'Day', 'Dracula'],
  defaultThemes: { dark: 'Night', light: 'Day' },
};

const BODY: StaticPaintBodyConfig = {
  downloadLabels: {
    macos: 'Download for macOS',
    windows: 'Download for Windows',
    linux: 'Download for Linux',
    none: 'Download the desktop app',
  },
  entry: '/assets/index-test.js',
};

const MAC = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 };

const root = document.documentElement;

/** A window the scripts can be run against, answering media queries as told. */
function headWindow({
  path = '/',
  phone = false,
  light = false,
  extra = {},
}: { path?: string; phone?: boolean; light?: boolean; extra?: Record<string, unknown> } = {}): Window {
  return {
    document,
    location: { pathname: path },
    matchMedia: (query: string) => ({
      matches: (query === PHONE_MEDIA_QUERY && phone) || (query === LIGHT_SCHEME_QUERY && light),
    }),
    ...extra,
  } as unknown as Window;
}

function resetRoot() {
  root.removeAttribute(STATIC_PAINT_ATTRIBUTE);
  root.removeAttribute('data-theme-type');
  root.removeAttribute('data-theme-name');
  root.removeAttribute('style');
}

describe('decideStaticPaint', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRoot();
  });
  afterEach(resetRoot);

  it('paints the desktop copy for an English reader with nothing saved, in the dark default', () => {
    expect(decideStaticPaint(HEAD, headWindow())).toBe('desktop');
    expect(root.getAttribute(STATIC_PAINT_ATTRIBUTE)).toBe('desktop');
    expect(root.style.getPropertyValue('--bg-primary')).toBe('#101417');
    expect(root.getAttribute('data-theme-type')).toBe('dark');
    expect(root.getAttribute('data-theme-name')).toBe('Night');
  });

  it('answers /welcome, with or without its trailing slash, as the same page', () => {
    expect(decideStaticPaint(HEAD, headWindow({ path: '/welcome' }))).toBe('desktop');
    expect(decideStaticPaint(HEAD, headWindow({ path: '/welcome/' }))).toBe('desktop');
  });

  it('paints the phone copy on a phone-shaped touch screen', () => {
    expect(decideStaticPaint(HEAD, headWindow({ phone: true }))).toBe('phone');
  });

  it('wears the theme the app will open in: the system’s, unless a default was saved', () => {
    decideStaticPaint(HEAD, headWindow({ light: true }));
    expect(root.style.getPropertyValue('--bg-primary')).toBe('#fbfaf6');
    expect(root.getAttribute('data-theme-type')).toBe('light');

    localStorage.setItem(storageKey(STORAGE_KEYS.theme), 'Night');
    decideStaticPaint(HEAD, headWindow({ light: true }));
    expect(root.getAttribute('data-theme-name')).toBe('Night');
  });

  it('paints for a reader who left "Show welcome on startup" on', () => {
    localStorage.setItem(storageKey(STORAGE_KEYS.showWelcomeOnStartup), 'true');
    expect(decideStaticPaint(HEAD, headWindow())).toBe('desktop');
  });

  it.each([
    ['the desktop app', () => headWindow({ extra: { __TAURI_INTERNALS__: {} } })],
    ['a path this file is only the SPA fallback for', () => headWindow({ path: '/edit' })],
    [
      '"Show welcome on startup" turned off',
      () => {
        localStorage.setItem(storageKey(STORAGE_KEYS.showWelcomeOnStartup), 'false');
        return headWindow();
      },
    ],
    [
      'a reader who pinned another language',
      () => {
        localStorage.setItem(storageKey(STORAGE_KEYS.locale), 'ja');
        return headWindow();
      },
    ],
    [
      'a saved theme the copy was not painted in',
      () => {
        localStorage.setItem(storageKey(STORAGE_KEYS.theme), 'Dracula');
        return headWindow();
      },
    ],
  ])('never paints for %s, and leaves the theme to the app', (_who, makeWindow) => {
    expect(decideStaticPaint(HEAD, makeWindow())).toBe('off');
    expect(root.getAttribute(STATIC_PAINT_ATTRIBUTE)).toBe('off');
    expect(root.getAttribute('data-theme-type')).toBeNull();
    expect(root.style.length).toBe(0);
  });

  it('answers off rather than throwing', () => {
    const broken = {
      ...headWindow(),
      matchMedia: () => {
        throw new Error('no media queries here');
      },
    } as unknown as Window;
    expect(decideStaticPaint(HEAD, broken)).toBe('off');
    expect(root.getAttribute(STATIC_PAINT_ATTRIBUTE)).toBe('off');
  });
});

/** Enough of the welcome page for the body script: the button, a screenshot, the scroller. */
function welcomeCopy(surface?: 'phone') {
  return (
    `<div id="${SEO_CONTENT_ID}"><div class="app-layout"${surface ? ` data-surface="${surface}"` : ''}>` +
    '<main class="welcome-page">' +
    '<div class="ui-split-button"><a class="ui-split-button__primary" href="#"><svg></svg>Download the desktop app</a></div>' +
    '<figure class="landing-figure"><img class="landing-figure__image" src="/landing/overview-dark.webp" ' +
    'srcset="/landing/overview-dark-640w.webp 640w, /landing/overview-dark.webp 3456w" alt="The workspace" loading="lazy"></figure>' +
    '</main><button class="welcome-scroll-cue"></button></div></div>'
  );
}

function paintedBody({ template = true }: { template?: boolean } = {}) {
  document.body.innerHTML =
    welcomeCopy() +
    (template ? `<template id="${PHONE_COPY_TEMPLATE_ID}">${welcomeCopy('phone')}</template>` : '') +
    '<div id="root"></div>';
}

/** Records what the body script schedules, so a test can run each step when it chooses. */
function bodyWindow({ lcp = true }: { lcp?: boolean } = {}) {
  const frames: Array<() => void> = [];
  const timers: Array<() => void> = [];
  const observers: Array<{ callback: () => void; disconnected: boolean; type?: string }> = [];
  class FakeObserver {
    static supportedEntryTypes = lcp ? ['paint', 'largest-contentful-paint'] : ['paint'];
    record: (typeof observers)[number];
    constructor(callback: () => void) {
      this.record = { callback, disconnected: false };
      observers.push(this.record);
    }
    observe({ type }: { type: string }) {
      this.record.type = type;
    }
    disconnect() {
      this.record.disconnected = true;
    }
  }
  const win = {
    document,
    navigator: MAC,
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    setTimeout: (callback: () => void) => timers.push(callback),
    PerformanceObserver: FakeObserver,
  } as unknown as Window;
  const runFrame = () => frames.splice(0).forEach((callback) => callback());
  return { win, frames, timers, observers, runFrame };
}

const entryScript = () => document.head.querySelector<HTMLScriptElement>(`script[src="${BODY.entry}"]`);
const copies = () => document.querySelectorAll(`#${SEO_CONTENT_ID}`);
const screenshot = () => document.querySelector<HTMLImageElement>('img.landing-figure__image')!;

describe('finishStaticPaint', () => {
  beforeEach(() => {
    resetRoot();
    paintedBody();
  });
  afterEach(() => {
    resetRoot();
    document.body.innerHTML = '';
    entryScript()?.remove();
  });

  it('shows the desktop copy finished: named for the platform, the template gone', () => {
    root.setAttribute(STATIC_PAINT_ATTRIBUTE, 'desktop');
    expect(finishStaticPaint(BODY, bodyWindow().win)).toBe(true);
    expect(root.getAttribute(STATIC_PAINT_ATTRIBUTE)).toBe('shown');
    expect(copies()).toHaveLength(1);
    expect(document.querySelector('.app-layout')?.hasAttribute('data-surface')).toBe(false);
    expect(document.querySelector('.ui-split-button__primary')?.textContent).toBe('Download for macOS');
    expect(document.getElementById(PHONE_COPY_TEMPLATE_ID)).toBeNull();
  });

  it('puts the phone copy in the desktop copy’s place on a phone', () => {
    root.setAttribute(STATIC_PAINT_ATTRIBUTE, 'phone');
    expect(finishStaticPaint(BODY, bodyWindow().win)).toBe(true);
    expect(copies()).toHaveLength(1);
    expect(document.querySelector(`#${SEO_CONTENT_ID} .app-layout`)?.getAttribute('data-surface')).toBe('phone');
    expect(document.querySelector('.ui-split-button__primary')?.textContent).toBe('Download for macOS');
  });

  it('holds the screenshots back until the copy’s paint is recorded, then starts the app', () => {
    root.setAttribute(STATIC_PAINT_ATTRIBUTE, 'desktop');
    const { win, observers, runFrame } = bodyWindow();
    finishStaticPaint(BODY, win);
    // Nothing a lazy screenshot could fetch, and no alt text for the empty frame to paint.
    for (const name of ['src', 'srcset', 'alt']) expect(screenshot().hasAttribute(name)).toBe(false);
    runFrame();
    runFrame();
    expect(entryScript()).toBeNull();

    const [observer] = observers;
    expect(observer.type).toBe('largest-contentful-paint');
    observer.callback();
    const script = entryScript();
    expect(script?.type).toBe('module');
    expect(script?.hasAttribute('crossorigin')).toBe(true);
    expect(observer.disconnected).toBe(true);
    expect(screenshot().getAttribute('src')).toBe('/landing/overview-dark.webp');
    expect(screenshot().getAttribute('srcset')).toContain('overview-dark-640w.webp 640w');
    expect(screenshot().getAttribute('alt')).toBe('The workspace');
    expect(screenshot().getAttributeNames().filter((name) => name.startsWith('data-held-'))).toEqual([]);
  });

  it('starts the app once, however many of its triggers fire', () => {
    root.setAttribute(STATIC_PAINT_ATTRIBUTE, 'desktop');
    const { win, observers, timers, runFrame } = bodyWindow();
    finishStaticPaint(BODY, win);
    observers[0].callback();
    runFrame();
    timers.forEach((timer) => timer());
    expect(document.head.querySelectorAll(`script[src="${BODY.entry}"]`)).toHaveLength(1);
  });

  it('gives up waiting for the record a while after the first frame', () => {
    root.setAttribute(STATIC_PAINT_ATTRIBUTE, 'desktop');
    const { win, timers, runFrame } = bodyWindow();
    finishStaticPaint(BODY, win);
    // Not from the script: until the stylesheet arrives there is no frame to time from.
    expect(timers).toHaveLength(0);
    runFrame();
    expect(timers).toHaveLength(1);
    timers[0]();
    expect(entryScript()).not.toBeNull();
  });

  it('waits two frames where the browser cannot say when a paint is recorded', () => {
    root.setAttribute(STATIC_PAINT_ATTRIBUTE, 'desktop');
    const { win, observers, runFrame } = bodyWindow({ lcp: false });
    finishStaticPaint(BODY, win);
    expect(observers).toHaveLength(0);
    runFrame();
    expect(entryScript()).toBeNull();
    runFrame();
    expect(entryScript()).not.toBeNull();
  });

  it('starts the app at once in a hidden tab, which renders no frames to wait for', () => {
    root.setAttribute(STATIC_PAINT_ATTRIBUTE, 'desktop');
    // An own property shadows the prototype's getter; deleting it restores jsdom's.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      finishStaticPaint(BODY, bodyWindow().win);
      expect(entryScript()).not.toBeNull();
      expect(screenshot().hasAttribute('src')).toBe(true);
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
  });

  it('uses the light screenshots under a light theme', () => {
    root.setAttribute(STATIC_PAINT_ATTRIBUTE, 'desktop');
    root.setAttribute('data-theme-type', 'light');
    const { win, observers } = bodyWindow();
    finishStaticPaint(BODY, win);
    observers[0].callback();
    expect(screenshot().getAttribute('src')).toBe('/landing/overview-light.webp');
    expect(screenshot().getAttribute('srcset')).toBe(
      '/landing/overview-light-640w.webp 640w, /landing/overview-light.webp 3456w'
    );
  });

  it.each([
    ['decided against it', 'off'],
    ['never decided (the head script did not run)', null],
  ])('removes the copy when the head %s, and starts the app at once', (_case, decision) => {
    if (decision) root.setAttribute(STATIC_PAINT_ATTRIBUTE, decision);
    expect(finishStaticPaint(BODY, bodyWindow().win)).toBe(false);
    expect(copies()).toHaveLength(0);
    expect(document.getElementById(PHONE_COPY_TEMPLATE_ID)).toBeNull();
    expect(root.hasAttribute(STATIC_PAINT_ATTRIBUTE)).toBe(false);
    expect(entryScript()).not.toBeNull();
  });

  it('never shows a phone the desktop copy: without its variant, the copy goes', () => {
    paintedBody({ template: false });
    root.setAttribute(STATIC_PAINT_ATTRIBUTE, 'phone');
    expect(finishStaticPaint(BODY, bodyWindow().win)).toBe(false);
    expect(copies()).toHaveLength(0);
    expect(entryScript()).not.toBeNull();
  });

  it('records the reader’s scroll for the live page, and hides the cue past the top', () => {
    root.setAttribute(STATIC_PAINT_ATTRIBUTE, 'desktop');
    finishStaticPaint(BODY, bodyWindow().win);
    const scroller = document.querySelector<HTMLElement>('.welcome-page')!;
    const cue = document.querySelector('.welcome-scroll-cue')!;
    scroller.scrollTop = 400;
    scroller.dispatchEvent(new Event('scroll'));
    expect(copies()[0].getAttribute(STATIC_SCROLL_ATTRIBUTE)).toBe('400');
    expect(cue.getAttribute('data-hidden')).toBe('true');
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
    expect(cue.hasAttribute('data-hidden')).toBe(false);
  });
});
