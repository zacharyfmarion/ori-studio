import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { RELEASES_URL, REPOSITORY_URL } from '../../constants/release';
import { FIRST_LANDING_SECTION_ID, WelcomeLanding } from './WelcomeLanding';

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
  it('renders the four sections in order', () => {
    const rendered = renderLanding();
    const ids = Array.from(rendered.querySelectorAll('.landing-section')).map((s) => s.id);

    expect(ids).toEqual([
      'landing-what',
      'landing-workspaces',
      'landing-compatibility',
      'landing-get',
    ]);
  });

  it('starts with the section the scroll affordance jumps to', () => {
    const rendered = renderLanding();
    expect(rendered.querySelector('.landing-section')?.id).toBe(FIRST_LANDING_SECTION_ID);
  });

  it('names the three workspaces', () => {
    const rendered = renderLanding();
    const titles = Array.from(rendered.querySelectorAll('.landing-card__title')).map(
      (card) => card.textContent
    );

    expect(titles).toEqual(['Design', 'Edit', 'Simulate']);
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

    for (const extension of ['.cp', '.fold', '.ori', '.orh', '.tmd5', '.bps']) {
      expect(formats).toContain(extension);
    }
  });

  it('points its calls to action at the release and repository URLs', () => {
    renderLanding();

    expect(link('Download for macOS').getAttribute('href')).toBe(RELEASES_URL);
    expect(link('View the source').getAttribute('href')).toBe(REPOSITORY_URL);
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
