import { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_MEDIA_QUERY } from '../platform/phoneLayout';
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

/**
 * Answer the phone query on its own, not through the plain coarse-pointer one it
 * contains: a tablet is coarse and is not a phone, and this screen treats the
 * two differently.
 */
function stubViewport(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === PHONE_MEDIA_QUERY ? phone : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
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
  vi.unstubAllGlobals();
});

describe('StartScreen', () => {
  it('offers the desktop app in the corner of a viewport that could run one', () => {
    stubViewport(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    const rendered = renderStartScreen().container;

    expect(rendered.querySelector('.start-screen__download')).not.toBeNull();
  });

  it('offers no desktop download on a phone, which cannot run one', () => {
    stubViewport(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    const rendered = renderStartScreen().container;

    // The whole control, not merely its icon: it is positioned by its own root
    // class, so anything left behind would still hold the corner's margin.
    expect(rendered.querySelector('.start-screen__download')).toBeNull();
    expect(rendered.querySelector('.ui-split-button')).toBeNull();
  });

  it('renders the three NUX choices with supported file formats', () => {
    const rendered = renderStartScreen().container;

    expect(rendered.textContent).toContain('Create a CP');
    expect(rendered.textContent).toContain('Open a file');
    expect(rendered.textContent).toContain('.osf projects');
    expect(rendered.textContent).toContain('.cp, .fold, .ori, .orh, .tmd, .tmd4, and .tmd5');
    expect(rendered.textContent).toContain('Create a design');
  });

  it('shows the 3D folded figure, and no image while it loads', () => {
    // The frame starts empty. Rendering the crease-pattern image here and
    // swapping it for the figure a moment later is what made the start screen
    // flash, so its absence is the assertion — a test that only looked for the
    // canvas would pass on a build that had put the flash back.
    const rendered = renderStartScreen().container;

    expect(rendered.querySelector('.start-figure__canvas')).not.toBeNull();
    expect(rendered.querySelector('.start-figure__fallback')).toBeNull();
    expect(rendered.querySelector('.start-figure')?.getAttribute('data-status')).toBe(
      'loading'
    );

    // The decorative half hides itself, and the preview around it does not —
    // it carries the designer credit, and a link inside an `aria-hidden`
    // subtree is focusable but never announced.
    expect(
      rendered.querySelector('.start-figure__stage')?.getAttribute('aria-hidden')
    ).toBe('true');
    expect(
      rendered.querySelector('.start-screen__preview')?.getAttribute('aria-hidden')
    ).toBeNull();
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
