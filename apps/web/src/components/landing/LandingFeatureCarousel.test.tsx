import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LandingFeatureCarousel,
  type LandingCarouselItem,
} from './LandingFeatureCarousel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS = [
  {
    id: 'edit-angles',
    figure: 'edit-angles',
    title: 'Creases that are not 180°',
    body: 'Fold angles, not just mountain and valley.',
    figureAlt: 'Fold-angle labels.',
  },
  {
    id: 'edit-media',
    figure: 'edit-media',
    title: 'Images and text',
    body: 'A reference photo beside the paper.',
    figureAlt: 'A reference photo.',
  },
  {
    id: 'edit-share',
    figure: 'edit-share',
    title: 'Share a link',
    body: 'Send a crease pattern as a URL.',
    figureAlt: 'The share dialog.',
  },
] as const satisfies readonly LandingCarouselItem[];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderCarousel(): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<LandingFeatureCarousel label="Features" items={ITEMS} />));
  return container;
}

function tabs(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
}

function selected(): string | undefined {
  return tabs().find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent ?? undefined;
}

function figureSrc(): string | null | undefined {
  return container?.querySelector('.landing-figure__image')?.getAttribute('src');
}

function pressKey(key: string) {
  act(() => {
    container
      ?.querySelector('[role="tablist"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('LandingFeatureCarousel', () => {
  it('starts on the first feature with its figure showing', () => {
    renderCarousel();

    expect(selected()).toContain('Creases that are not 180°');
    expect(figureSrc()).toBe('/landing/edit-angles-dark.webp');
  });

  it('swaps the figure and the body when another feature is chosen', () => {
    const rendered = renderCarousel();

    act(() => tabs()[2].click());

    expect(selected()).toContain('Share a link');
    expect(figureSrc()).toBe('/landing/edit-share-dark.webp');
    expect(rendered.querySelector('.landing-carousel__body[data-active]')?.textContent).toBe(
      'Send a crease pattern as a URL.'
    );
  });

  it('keeps every body mounted so the panel cannot change height between slides', () => {
    // A panel that grows by a line as slides change re-centres the tab list
    // beside it and nudges the rest of the page. All the bodies share one grid
    // cell instead, and only the active one is visible.
    const rendered = renderCarousel();
    const bodies = rendered.querySelectorAll('.landing-carousel__body');

    expect(bodies).toHaveLength(ITEMS.length);
    expect(rendered.querySelectorAll('.landing-carousel__body[data-active]')).toHaveLength(1);

    act(() => tabs()[1].click());
    expect(rendered.querySelectorAll('.landing-carousel__body')).toHaveLength(ITEMS.length);
    expect(rendered.querySelector('.landing-carousel__body[data-active]')?.textContent).toBe(
      'A reference photo beside the paper.'
    );
  });

  it('keeps every feature visible rather than hiding them behind the current one', () => {
    // The reason this is a tab list and not a slideshow: you can see what is on
    // offer and jump straight to it.
    const rendered = renderCarousel();
    expect(rendered.querySelectorAll('[role="tab"]')).toHaveLength(3);
  });

  it('moves with the arrow keys, in both orientations', () => {
    renderCarousel();

    // The list is a column when wide and a row when narrow, so both axes work.
    pressKey('ArrowDown');
    expect(selected()).toContain('Images and text');
    pressKey('ArrowRight');
    expect(selected()).toContain('Share a link');
    pressKey('ArrowUp');
    expect(selected()).toContain('Images and text');
    pressKey('ArrowLeft');
    expect(selected()).toContain('Creases that are not 180°');
  });

  it('wraps around the ends', () => {
    renderCarousel();

    pressKey('ArrowUp');
    expect(selected()).toContain('Share a link');
    pressKey('ArrowDown');
    expect(selected()).toContain('Creases that are not 180°');
  });

  it('jumps to the ends with Home and End', () => {
    renderCarousel();

    pressKey('End');
    expect(selected()).toContain('Share a link');
    pressKey('Home');
    expect(selected()).toContain('Creases that are not 180°');
  });

  it('keeps exactly one tab stop, so the list is not three stops in the sequence', () => {
    renderCarousel();

    const reachable = tabs().filter((tab) => tab.tabIndex === 0);
    expect(reachable).toHaveLength(1);
    expect(reachable[0].getAttribute('aria-selected')).toBe('true');
  });

  it('wires the panel to the tab that controls it', () => {
    const rendered = renderCarousel();
    const panel = rendered.querySelector('[role="tabpanel"]');

    expect(tabs()[0].getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.getAttribute('aria-labelledby')).toBe(tabs()[0].id);

    act(() => tabs()[1].click());
    expect(panel?.getAttribute('aria-labelledby')).toBe(tabs()[1].id);
  });
});
