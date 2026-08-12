import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DISCORD_URL, REPOSITORY_URL } from '../../constants/release';
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

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
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
    const titles = Array.from(
      rendered.querySelectorAll('#landing-design .landing-carousel__tab-title')
    ).map((tab) => tab.textContent);

    expect(titles).toEqual(['TreeMaker', 'Box Pleating Studio', 'ExplOri']);
  });

  it('credits every upstream the app is ported from', () => {
    const rendered = renderLanding();
    const names = Array.from(rendered.querySelectorAll('.landing-port__name')).map(
      (port) => port.textContent
    );

    expect(names).toEqual([
      'Oriedita',
      'TreeMaker 5.0.1',
      'Box Pleating Studio',
      'Flat-Folder',
    ]);
  });

  it('lists the interchange formats, which is the claim this audience checks', () => {
    const rendered = renderLanding();
    const formats = rendered.querySelector('.landing-formats')?.textContent ?? '';

    for (const extension of ['.ori', '.cp', '.fold', '.bps', '.tmd5', '.svg']) {
      expect(formats).toContain(extension);
    }
  });

  it('points its calls to action at Discord and the repository', () => {
    renderLanding();

    expect(link('Join the Discord').getAttribute('href')).toBe(DISCORD_URL);
    expect(link('Source and issues').getAttribute('href')).toBe(REPOSITORY_URL);
  });

  it('promises no desktop download, because there is not one yet', () => {
    const rendered = renderLanding();
    const hrefs = Array.from(rendered.querySelectorAll('a')).map((a) => a.getAttribute('href'));

    expect(rendered.textContent).not.toMatch(/download|install it|\.dmg|Apple Silicon/i);
    expect(hrefs).not.toContain(`${REPOSITORY_URL}/releases`);
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

    // Only the selected slide of each carousel is mounted, so this is the first
    // of each. The default theme is dark; `LandingFigure` re-resolves on change.
    expect(sources).toEqual([
      '/landing/overview-dark.png',
      '/landing/edit-angles-dark.png',
      '/landing/design-treemaker-dark.png',
      '/landing/simulate-dark.png',
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
      'landing/overview-dark.png',
      'landing/edit-angles-dark.png',
      'landing/design-treemaker-dark.png',
      'landing/simulate-dark.png',
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
