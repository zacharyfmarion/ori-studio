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
    // The header's own prose, which is the tagline and nothing else. The
    // figure's designer credit is excluded rather than counted: raising the
    // number to two would turn a guard against creeping copy into a guard
    // against the number two.
    const prose = [...rendered.querySelectorAll('p')].filter(
      (node) => !node.closest('.start-figure')
    );
    expect(prose).toHaveLength(1);
  });

  it('leads with the folded figure, above the masthead', () => {
    // The phone gets no start screen, so this is the only place the product's
    // own artefact appears above the fold. Order matters as much as presence: a
    // figure under the tagline is a figure most visitors scroll past.
    const { container } = renderLink();

    const figure = container.querySelector('.welcome-mobile-header__figure');
    const brand = container.querySelector('.welcome-mobile-header__brand');
    expect(figure).not.toBeNull();
    expect(brand).not.toBeNull();
    expect(figure?.querySelector('.start-figure')).not.toBeNull();
    const brandFollowsFigure =
      (figure?.compareDocumentPosition(brand as Node) ?? 0) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    expect(brandFollowsFigure).toBeTruthy();

    // The *stage* is decorative and hides itself; the wrapper must not, or the
    // designer credit inside would be a focusable link a screen reader never
    // announces.
    expect(figure?.getAttribute('aria-hidden')).toBeNull();
    expect(
      figure?.querySelector('.start-figure__stage')?.getAttribute('aria-hidden')
    ).toBe('true');
  });
});
