import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorFallback } from './ErrorFallback';
import type { ErrorReportContext } from '../../lib/errorReport';

let container: HTMLDivElement;
let root: Root;
let writeText: ReturnType<typeof vi.fn>;

const context: ErrorReportContext = {
  surface: 'panel:crease-pattern',
  runtime: 'web',
  userAgent: 'test-agent',
  locale: 'en',
  workspace: 'edit',
  editingContext: 'crease-pattern',
  document: 'crease pattern · 12 lines',
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function renderFallback(overrides: Partial<Parameters<typeof ErrorFallback>[0]> = {}): void {
  act(() =>
    root.render(
      <ErrorFallback
        variant="pane"
        surface="panel:crease-pattern"
        error={new Error('kaboom')}
        componentStack={'\n    at CreasePatternPanel'}
        context={context}
        onRetry={() => undefined}
        {...overrides}
      />
    )
  );
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(label)
  );
  if (!button) throw new Error(`no button labelled ${label}`);
  return button;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('ErrorFallback', () => {
  it('shows the disclosure text that Copy details actually copies', async () => {
    renderFallback();

    const shown = container.querySelector('.error-fallback__report-text')?.textContent ?? '';
    expect(shown).toContain('### Ori Studio error report');
    expect(shown).toContain('panel:crease-pattern');

    await click(findButton('Copy details'));

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toBe(shown);
  });

  it('confirms a successful copy', async () => {
    renderFallback();
    await click(findButton('Copy details'));
    expect(container.textContent).toContain('Copied');
  });

  it('says so when the copy fails instead of claiming success', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'));
    // jsdom does not implement execCommand at all, so define the legacy
    // fallback path copyTextToClipboard reaches for and have it fail too.
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });

    renderFallback();
    await click(findButton('Copy details'));

    expect(container.textContent).toContain("Couldn't copy");
    expect(container.textContent).not.toContain('Copied');
  });

  it('calls onRetry from Try again', async () => {
    const onRetry = vi.fn();
    renderFallback({ onRetry });
    await click(findButton('Try again'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('builds a report even when context collection failed', () => {
    renderFallback({ context: null });
    const shown = container.querySelector('.error-fallback__report-text')?.textContent ?? '';
    expect(shown).toContain('unavailable');
    expect(shown).toContain('Error: kaboom');
  });

  it('lets a crashed dialog be dismissed, since its own Escape handling died with it', async () => {
    renderFallback({ variant: 'overlay' });
    expect(container.querySelector('.error-fallback')).not.toBeNull();

    await click(findButton('Dismiss'));

    expect(container.querySelector('.error-fallback')).toBeNull();
  });

  it('keeps the strip variant to a single row with no disclosure', () => {
    renderFallback({ variant: 'strip' });
    expect(container.querySelector('.error-fallback--strip')).not.toBeNull();
    expect(container.querySelector('.error-fallback__details')).toBeNull();
  });

  describe('mini variant', () => {
    // `strip` is a horizontal row; the workspace rail it used to be mounted in
    // is a ~48px vertical column, which wrapped the message to one character
    // per line. `mini` is the column-shaped answer.
    it('renders icon-only, with no prose to wrap', () => {
      renderFallback({ variant: 'mini' });

      expect(container.querySelector('.error-fallback--mini')).not.toBeNull();
      expect(container.querySelector('.error-fallback__description')).toBeNull();
      expect(container.querySelector('.error-fallback__message')).toBeNull();
      expect(container.querySelector('.error-fallback__details')).toBeNull();
      expect(container.querySelectorAll('button')).toHaveLength(2);
    });

    it('keeps retry and the error text reachable through tooltips', () => {
      renderFallback({ variant: 'mini' });

      const titles = [...container.querySelectorAll('button')].map(
        (button) => button.getAttribute('title') ?? button.getAttribute('aria-label') ?? ''
      );
      expect(titles[0]).toContain('Try again');
      expect(titles[0]).toContain('Error: kaboom');
      expect(titles[1]).toContain('Copy details');
    });

    it('names the sidebar rather than claiming a panel broke', () => {
      renderFallback({ variant: 'mini' });
      const label = container.querySelector('svg[role="img"]')?.getAttribute('aria-label');
      expect(label).toBe('This sidebar stopped working');
    });

    it('still retries and copies', async () => {
      const onRetry = vi.fn();
      renderFallback({ variant: 'mini', onRetry });

      const [retry, copy] = [...container.querySelectorAll('button')];
      await click(retry as HTMLElement);
      expect(onRetry).toHaveBeenCalledOnce();

      await click(copy as HTMLElement);
      expect(writeText).toHaveBeenCalledOnce();
      expect(writeText.mock.calls[0][0]).toContain('panel:crease-pattern');
    });
  });
});
