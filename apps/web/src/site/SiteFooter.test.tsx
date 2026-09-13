import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteFooter } from './SiteFooter';
import { SITE_PAGES } from './sitePages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(): HTMLDivElement {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <MemoryRouter initialEntries={['/']}>
        <SiteFooter />
      </MemoryRouter>
    );
  });
  return container;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('SiteFooter', () => {
  it('links every page of the site, which is how a crawler on the landing finds them', () => {
    const rendered = render();
    for (const page of SITE_PAGES) {
      expect(rendered.querySelector(`a[href="${page.path}"]`), page.path).not.toBeNull();
    }
  });

  it('marks the page it is on', () => {
    const rendered = render();
    expect(rendered.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/');
  });

  it('renders nothing inside the desktop app, where the pages it links to do not exist', () => {
    vi.stubGlobal('window', { ...window, __TAURI_INTERNALS__: {} });
    const rendered = render();
    expect(rendered.textContent).toBe('');
  });
});
