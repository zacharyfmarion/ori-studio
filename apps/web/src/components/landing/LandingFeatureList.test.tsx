import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { LandingFeatureList, type LandingFeatureItem } from './LandingFeatureList';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS = [
  {
    id: 'edit-angles',
    figure: 'edit-angles',
    title: 'Support for non-flat creases',
    body: 'Fold angles, not just mountain and valley.',
    figureAlt: 'Fold-angle labels.',
  },
  {
    id: 'edit-media',
    figure: 'edit-media',
    title: 'Rich Images and Text',
    body: 'A reference photo beside the paper.',
    figureAlt: 'A reference photo.',
  },
  {
    id: 'edit-share',
    figure: 'edit-share',
    title: 'Share a pattern with a link',
    body: 'Send a crease pattern as a URL.',
    figureAlt: 'The share dialog.',
  },
] as const satisfies readonly LandingFeatureItem[];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderList(): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<LandingFeatureList label="Features" items={ITEMS} />));
  return container;
}

function triggers(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>('.landing-features__trigger') ?? []);
}

function openTitle(): string | undefined {
  return triggers().find((t) => t.getAttribute('aria-expanded') === 'true')?.textContent ?? undefined;
}

function visibleBody(): string | undefined {
  return Array.from(container?.querySelectorAll('.landing-features__body') ?? [])
    .find((body) => !body.hasAttribute('hidden'))
    ?.textContent ?? undefined;
}

function figureSrc(): string | null | undefined {
  return container?.querySelector('.landing-figure__image')?.getAttribute('src');
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('LandingFeatureList', () => {
  it('opens on the first feature', () => {
    renderList();

    expect(openTitle()).toBe('Support for non-flat creases');
    expect(visibleBody()).toBe('Fold angles, not just mountain and valley.');
    expect(figureSrc()).toBe('/landing/edit-angles-dark.webp');
  });

  it('opens another feature and swaps the figure with it', () => {
    renderList();

    act(() => triggers()[2].click());

    expect(openTitle()).toBe('Share a pattern with a link');
    expect(visibleBody()).toBe('Send a crease pattern as a URL.');
    expect(figureSrc()).toBe('/landing/edit-share-dark.webp');
  });

  it('keeps exactly one open', () => {
    const rendered = renderList();

    act(() => triggers()[1].click());

    const expanded = triggers().filter((t) => t.getAttribute('aria-expanded') === 'true');
    expect(expanded).toHaveLength(1);
    expect(
      Array.from(rendered.querySelectorAll('.landing-features__body')).filter(
        (b) => !b.hasAttribute('hidden')
      )
    ).toHaveLength(1);
  });

  it('keeps every title visible, so the list can be scanned', () => {
    // The reason this is a list and not a slideshow: you can see everything on
    // offer without stepping through it.
    const rendered = renderList();
    expect(rendered.querySelectorAll('.landing-features__trigger')).toHaveLength(3);
  });

  it('keeps the closed descriptions in the DOM for in-page search', () => {
    const rendered = renderList();
    const bodies = Array.from(rendered.querySelectorAll('.landing-features__body'));

    expect(bodies).toHaveLength(ITEMS.length);
    expect(bodies.filter((b) => b.hasAttribute('hidden'))).toHaveLength(ITEMS.length - 1);
  });

  it('wires each trigger to the description it reveals', () => {
    const rendered = renderList();

    for (const [index, trigger] of triggers().entries()) {
      const controlled = rendered.querySelector(`#${trigger.getAttribute('aria-controls')}`);
      expect(controlled?.textContent).toBe(ITEMS[index].body);
    }
  });

  it('puts each title in a heading, so the list is navigable structure', () => {
    const rendered = renderList();
    const headings = Array.from(rendered.querySelectorAll('h3'));

    expect(headings.map((h) => h.textContent)).toEqual(ITEMS.map((i) => i.title));
  });
});
