import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileOpenAppLink } from './MobileOpenAppLink';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderLink(onOpenAnyway = vi.fn()) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<MobileOpenAppLink onOpenAnyway={onOpenAnyway} />));
  return { container, onOpenAnyway };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('MobileOpenAppLink', () => {
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

  it('is one small control, not a screenful', () => {
    const { container: rendered } = renderLink();

    expect(rendered.querySelectorAll('button')).toHaveLength(1);
    expect(rendered.querySelector('h1')).toBeNull();
    expect(rendered.querySelector('p')).toBeNull();
  });
});
