import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartScreen } from './StartScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderStartScreen(overrides: Partial<ComponentProps<typeof StartScreen>> = {}) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const props: ComponentProps<typeof StartScreen> = {
    status: 'ready',
    errorMessage: null,
    onCreateCreasePattern: vi.fn(),
    onCreateDesign: vi.fn(),
    onOpenFile: vi.fn(),
    showWelcomeOnStartup: true,
    onToggleShowWelcomeOnStartup: vi.fn(),
    ...overrides,
  };

  act(() => {
    root?.render(<StartScreen {...props} />);
  });
  return { container, props };
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(container?.querySelectorAll('button') ?? []).find((element) =>
    element.textContent?.includes(label)
  );
  expect(match).toBeDefined();
  return match as HTMLButtonElement;
}

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

describe('StartScreen', () => {
  it('renders the three NUX choices with supported file formats', () => {
    const rendered = renderStartScreen().container;

    expect(rendered.textContent).toContain('Create a CP');
    expect(rendered.textContent).toContain('Open a file');
    expect(rendered.textContent).toContain('.osf projects');
    expect(rendered.textContent).toContain('.cp, .fold, .ori, .orh, .tmd, .tmd4, and .tmd5');
    expect(rendered.textContent).toContain('Create a design');
  });

  it('shows the 3D folded figure, over the image it falls back to', () => {
    // The preview is a live figure now, but the authored image stays mounted
    // underneath it. It is the first paint, and it is the whole answer on a
    // machine that cannot give us WebGL2 — so a test that only looked for the
    // canvas would pass on a build that had quietly lost the fallback.
    const rendered = renderStartScreen().container;

    expect(rendered.querySelector('.start-figure__canvas')).not.toBeNull();

    const image = rendered.querySelector<HTMLImageElement>('.start-figure__fallback');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toContain('/start/crease-pattern-preview.png');
    expect(image?.getAttribute('alt')).toBe('');

    // Decorative: the whole preview is aria-hidden, so neither the figure nor
    // its fallback is announced.
    expect(rendered.querySelector('.start-screen__preview')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });

  it('dispatches the selected start action', () => {
    const onCreateCreasePattern = vi.fn();
    const onOpenFile = vi.fn();
    const onCreateDesign = vi.fn();
    renderStartScreen({ onCreateCreasePattern, onOpenFile, onCreateDesign });

    act(() => {
      button('Create a CP').click();
      button('Open a file').click();
      button('Create a design').click();
    });

    expect(onCreateCreasePattern).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onCreateDesign).toHaveBeenCalledOnce();
  });

  it('disables start actions while the engine is preparing', () => {
    renderStartScreen({ status: 'loading_engine' });

    expect(button('Create a CP').disabled).toBe(true);
    expect(button('Open a file').disabled).toBe(true);
    expect(button('Create a design').disabled).toBe(true);
    expect(container?.textContent).toContain('Preparing the editor...');
  });
});
