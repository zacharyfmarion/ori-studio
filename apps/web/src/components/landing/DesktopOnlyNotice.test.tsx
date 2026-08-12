import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopOnlyNotice } from './DesktopOnlyNotice';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderNotice(onOpenAnyway = vi.fn()) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<DesktopOnlyNotice onOpenAnyway={onOpenAnyway} />));
  return { container, onOpenAnyway };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('DesktopOnlyNotice', () => {
  it('says the app is desktop-only and why', () => {
    const { container: rendered } = renderNotice();

    expect(rendered.textContent).toContain('Desktop only, for now');
    expect(rendered.textContent).toContain('mouse, a keyboard');
  });

  it('is labelled by its own heading', () => {
    const { container: rendered } = renderNotice();
    const section = rendered.querySelector('section');

    expect(section?.getAttribute('aria-labelledby')).toBe('desktop-only-title');
    expect(rendered.querySelector('#desktop-only-title')?.tagName).toBe('H1');
  });

  it('offers a way through, and warns what it costs', () => {
    const { container: rendered, onOpenAnyway } = renderNotice();
    const bypass = rendered.querySelector<HTMLButtonElement>('.welcome-notice__bypass');

    expect(bypass?.textContent).toBe('Open it anyway');
    expect(rendered.textContent).toContain('no touch equivalent');

    act(() => bypass?.click());
    expect(onOpenAnyway).toHaveBeenCalledOnce();
  });

  it('offers nothing that leads into a workspace', () => {
    const { container: rendered } = renderNotice();

    // The escape hatch is the only control here. A "create a CP" or an "open a
    // file" would be an invitation into a surface the device cannot run.
    expect(rendered.querySelectorAll('button')).toHaveLength(1);
    expect(rendered.querySelectorAll('a')).toHaveLength(0);
  });
});
