import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileLandingHeader } from './MobileLandingHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderLink(onOpenAnyway = vi.fn()) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<MobileLandingHeader onOpenAnyway={onOpenAnyway} />));
  return { container, onOpenAnyway };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('MobileLandingHeader', () => {
  it('says what it opens and warns in the same breath', () => {
    // The warning lives in the label because that is where the decision is
    // made. It replaced a full-screen notice that said the same thing in two
    // paragraphs, above the fold, before anything worth reading.
    const { container: rendered } = renderLink();
    const button = rendered.querySelector('button')!;

    expect(button.textContent).toBe('Open App (unoptimized on mobile)');
  });

  it('opens the app when taken', () => {
    const { container: rendered, onOpenAnyway } = renderLink();

    act(() => rendered.querySelector('button')!.click());

    expect(onOpenAnyway).toHaveBeenCalledOnce();
  });

  it('gives the page a masthead, and the outline its missing h1', () => {
    // Every landing section is an `h2`, so without this the phone's document
    // outline started a level down — and the page opened on "WHAT IT IS"
    // without having said what it is.
    const { container: rendered } = renderLink();

    expect(rendered.querySelector('h1')?.textContent).toBe('Ori Studio');
    expect(rendered.querySelector('.welcome-mobile-header__tagline')?.textContent).toContain(
      'origami'
    );
  });

  it('stays a header rather than becoming a screenful', () => {
    // What it replaced was a full-height notice with a heading, two paragraphs
    // and a footnote, which is what pushed the landing out of sight.
    const { container: rendered } = renderLink();

    expect(rendered.querySelectorAll('button')).toHaveLength(1);
    expect(rendered.querySelectorAll('p')).toHaveLength(1);
  });
});
