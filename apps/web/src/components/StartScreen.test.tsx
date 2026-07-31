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

  /**
   * The tutorial is reachable at /learn, but deliberately not advertised here
   * until there is a NUX designed around it. Re-adding the tile should be a
   * decision, not a merge artifact.
   */
  it('does not offer the tutorial', () => {
    const rendered = renderStartScreen().container;

    expect(rendered.textContent).not.toContain('tutorial');
    expect(rendered.querySelectorAll('.start-action')).toHaveLength(3);
  });

  it('uses the authored crease-pattern image for the preview', () => {
    const rendered = renderStartScreen().container;
    const image = rendered.querySelector<HTMLImageElement>('.start-screen__preview-image');

    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toContain('/start/crease-pattern-preview.png');
    expect(image?.getAttribute('alt')).toBe('');
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
