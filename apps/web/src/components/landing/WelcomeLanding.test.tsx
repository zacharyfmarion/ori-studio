import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCORD_URL, REPOSITORY_URL } from '../../constants/release';
import { RELEASES_LATEST_URL } from '../../platform/desktopDownload';
import { resetDesktopReleaseCache } from '../../platform/desktopRelease';
import {
  FIRST_LANDING_SECTION_ID,
  LANDING_SECTIONS,
  WelcomeLanding,
} from './WelcomeLanding';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderLanding(): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<WelcomeLanding />));
  return container;
}

function link(label: string): HTMLAnchorElement {
  const match = Array.from(container?.querySelectorAll('a') ?? []).find((element) =>
    element.textContent?.includes(label)
  );
  expect(match, `no link labelled "${label}"`).toBeDefined();
  return match as HTMLAnchorElement;
}

beforeEach(() => {
  // The download button asks GitHub for the newest release on mount. Left alone
  // it would make every case in this file a network test; refused, the button
  // renders the state this suite is actually about — its fallback.
  resetDesktopReleaseCache();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  // Pinned, because jsdom's user agent is built from `process.platform` — so an
  // unpinned run reads the *runner's* OS, and the button is labelled "Download
  // for macOS" here and "Download for Linux" in CI.
  vi.stubGlobal('navigator', {
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    maxTouchPoints: 0,
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('WelcomeLanding', () => {
  it('renders the six sections in order', () => {
    const rendered = renderLanding();
    const ids = Array.from(rendered.querySelectorAll('.landing-section')).map((s) => s.id);

    expect(ids).toEqual([
      'landing-what',
      'landing-edit',
      'landing-design',
      'landing-simulate',
      'landing-compatibility',
      'landing-get',
    ]);
  });

  it('keeps LANDING_SECTIONS in step with what it renders', () => {
    // The route hands this list to the scroll observer; a section whose id drifts
    // would silently stop reporting rather than fail.
    const rendered = renderLanding();
    const ids = Array.from(rendered.querySelectorAll('.landing-section')).map((s) => s.id);

    expect(LANDING_SECTIONS.map((s) => s.id)).toEqual(ids);
  });

  it('starts with the section the scroll affordance jumps to', () => {
    const rendered = renderLanding();
    expect(rendered.querySelector('.landing-section')?.id).toBe(FIRST_LANDING_SECTION_ID);
  });

  it('names the three design methods', () => {
    const rendered = renderLanding();
    const titles = Array.from(rendered.querySelectorAll('#landing-design [role="tab"]')).map(
      (tab) => tab.textContent
    );

    expect(titles).toEqual(['Box Pleating', 'Circle Packing', 'ExplOri']);
  });

  it('credits every upstream the app is ported from', () => {
    const rendered = renderLanding();
    const compatibility = rendered.querySelector('#landing-compatibility')?.textContent ?? '';

    for (const upstream of ['Oriedita', 'TreeMaker', 'Box Pleating Studio']) {
      expect(compatibility).toContain(upstream);
    }
  });

  it('does not credit Flat-Folder, which nothing shipping uses', () => {
    const rendered = renderLanding();
    expect(rendered.textContent).not.toMatch(/flat[\s-]?folder/i);
  });

  it('shows the interchange formats, which is the claim this audience checks', () => {
    const rendered = renderLanding();
    const formats = Array.from(rendered.querySelectorAll('.landing-file__ext')).map(
      (file) => file.textContent
    );

    for (const extension of ['.ori', '.cp', '.fold', '.bps', '.tmd5', '.svg', '.osf']) {
      expect(formats).toContain(extension);
    }
  });

  it('points its calls to action at Discord and the repository', () => {
    renderLanding();

    expect(link('Join the Discord').getAttribute('href')).toBe(DISCORD_URL);
    expect(link('Source and issues').getAttribute('href')).toBe(REPOSITORY_URL);
  });

  it('offers the desktop app, which is released', () => {
    // The inverse of this used to be asserted here — the page withheld the claim
    // while no build existed. It exists now (see
    // implementation-plans/desktop-download-links.md), so the guard runs the
    // other way: a page that stopped offering one would be the regression.
    const rendered = renderLanding();

    expect(link('Download').getAttribute('href')).toBeTruthy();
    expect(rendered.textContent).toMatch(/desktop app/i);
  });

  it('links somewhere real before — and without — a resolved release', () => {
    // The fetch is refused in this suite, which is the interesting case: a
    // rate-limited or offline visitor must still get a working link, and the
    // prerendered markup a crawler reads is rendered in exactly this state.
    renderLanding();

    expect(link('Download').getAttribute('href')).toBe(RELEASES_LATEST_URL);
  });

  it('does not advertise CP detection, which ships only in dev builds', () => {
    const rendered = renderLanding();

    // Narrow on purpose: "T-junction detection" is a real shipped feature, so
    // this targets the image-import claim rather than the word "detect".
    expect(rendered.textContent).not.toMatch(/(from|out of) an image/i);
  });

  it('asks for a themed screenshot per figure', () => {
    const rendered = renderLanding();
    const sources = Array.from(rendered.querySelectorAll<HTMLImageElement>('.landing-figure__image'))
      .map((image) => image.getAttribute('src'));

    // The Edit carousel mounts only its selected slide; the Design one is a
    // scroll track, so all three of its slides are present — that is what there
    // is to scroll. The default theme is dark; `LandingFigure` re-resolves on
    // change.
    expect(sources).toEqual([
      '/landing/overview-dark.webp',
      '/landing/edit-angles-dark.webp',
      '/landing/design-bp-dark.webp',
      '/landing/design-treemaker-dark.webp',
      '/landing/design-explori-dark.webp',
      '/landing/simulate-dark.webp',
    ]);
  });

  it('falls back to a placeholder naming the file it wants', () => {
    const rendered = renderLanding();
    // jsdom never fetches images, so the failure has to be delivered by hand —
    // it is what a browser does for a screenshot nobody has added yet.
    act(() => {
      for (const image of rendered.querySelectorAll('.landing-figure__image')) {
        image.dispatchEvent(new Event('error'));
      }
    });

    const wanted = Array.from(
      rendered.querySelectorAll('.landing-figure--placeholder .landing-figure__path')
    ).map((code) => code.textContent);

    expect(wanted).toEqual([
      'landing/overview-dark.webp',
      'landing/edit-angles-dark.webp',
      'landing/design-bp-dark.webp',
      'landing/design-treemaker-dark.webp',
      'landing/design-explori-dark.webp',
      'landing/simulate-dark.webp',
    ]);
  });

  it('labels each section by its own heading', () => {
    const rendered = renderLanding();

    for (const section of rendered.querySelectorAll('.landing-section')) {
      const labelledBy = section.getAttribute('aria-labelledby');
      expect(labelledBy).toBe(`${section.id}-title`);
      expect(rendered.querySelector(`#${labelledBy}`)?.tagName).toBe('H2');
    }
  });
});
