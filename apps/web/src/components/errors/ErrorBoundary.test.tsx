import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import {
  handleShortcutRuntimeKeyDown,
  registerViewportShortcutExecutor,
} from '../../keyboard/shortcutRuntime';

let container: HTMLDivElement;
let root: Root;

/**
 * React logs every boundary-caught error through `console.error`, which is
 * exactly the behavior `componentDidCatch` is supposed to preserve — so these
 * tests silence it deliberately rather than letting a passing run look broken.
 */
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(node: ReactNode): void {
  act(() => root.render(node));
}

function Boom({ message = 'boom' }: { message?: string }): never {
  throw new Error(message);
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(label),
  );
}

function click(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Zoom in — a viewport-scoped shortcut, so it reaches the registered executor. */
function dispatchZoomIn(): boolean {
  return handleShortcutRuntimeKeyDown(
    new KeyboardEvent('keydown', { key: '=', metaKey: true, bubbles: true, cancelable: true }),
    { context: { activeEditingContext: 'crease-pattern' }, menu: () => undefined },
  );
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary surface="panel:test" variant="pane">
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('all good');
    expect(container.querySelector('.error-fallback')).toBeNull();
  });

  it('renders the fallback and the error message when a child throws', () => {
    render(
      <ErrorBoundary surface="panel:test" variant="pane">
        <Boom message="panel exploded" />
      </ErrorBoundary>,
    );

    const fallback = container.querySelector('.error-fallback');
    expect(fallback).not.toBeNull();
    expect(fallback?.classList.contains('error-fallback--pane')).toBe(true);
    expect(container.textContent).toContain('This panel stopped working');
    expect(container.textContent).toContain('Error: panel exploded');
  });

  it('still logs the caught error, so containment is not silence', () => {
    render(
      <ErrorBoundary surface="panel:test" variant="pane">
        <Boom />
      </ErrorBoundary>,
    );

    const logged = vi
      .mocked(console.error)
      .mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && arg.includes('error boundary "panel:test"')),
      );
    expect(logged).toBe(true);
  });

  it('mounts children afresh on Try again', () => {
    // The flag is external rather than derived from a render counter: React
    // retries a failed concurrent render synchronously, so anything counting
    // renders would "recover" on its own and prove nothing.
    let failing = true;
    let mounts = 0;
    function Subject() {
      useEffect(() => {
        mounts += 1;
      }, []);
      if (failing) throw new Error('bad input');
      return <p>recovered</p>;
    }

    render(
      <ErrorBoundary surface="panel:test" variant="pane">
        <Subject />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('This panel stopped working');
    // A render that throws never commits, so no effect ran.
    expect(mounts).toBe(0);

    failing = false;
    const retry = findButton('Try again');
    expect(retry).toBeDefined();
    click(retry as HTMLButtonElement);

    expect(container.textContent).toContain('recovered');
    expect(container.querySelector('.error-fallback')).toBeNull();
    expect(mounts).toBe(1);
  });

  it('clears itself when a reset key changes', () => {
    function Subject({ ok }: { ok: boolean }) {
      if (!ok) throw new Error('bad document');
      return <p>good document</p>;
    }

    render(
      <ErrorBoundary surface="panel:test" variant="pane" resetKeys={[1]}>
        <Subject ok={false} />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('This panel stopped working');

    render(
      <ErrorBoundary surface="panel:test" variant="pane" resetKeys={[2]}>
        <Subject ok />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('good document');
  });

  it('does not reset when the reset keys are unchanged', () => {
    render(
      <ErrorBoundary surface="panel:test" variant="pane" resetKeys={[1]}>
        <Boom />
      </ErrorBoundary>,
    );
    render(
      <ErrorBoundary surface="panel:test" variant="pane" resetKeys={[1]}>
        <p>would be fine now</p>
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('This panel stopped working');
  });

  it('reports to onError without letting a failing reporter mask the error', () => {
    const onError = vi.fn(() => {
      throw new Error('the reporter itself is broken');
    });

    expect(() =>
      render(
        <ErrorBoundary surface="panel:test" variant="pane" onError={onError}>
          <Boom message="original failure" />
        </ErrorBoundary>,
      ),
    ).not.toThrow();

    expect(onError).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Error: original failure');
  });

  // A panel that dies must release what it registered globally. The Crease
  // Pattern and Design panels register viewport shortcut executors from
  // effects; if a boundary swapped in the fallback without unmounting them, a
  // dead panel would keep answering keystrokes app-wide. This asserts against
  // the real shortcut runtime rather than a stand-in effect.
  it('releases a crashed panel’s global registrations', () => {
    const executor = vi.fn(() => true);

    function Subject({ ok }: { ok: boolean }) {
      useEffect(() => registerViewportShortcutExecutor('crease-pattern', executor), []);
      if (!ok) throw new Error('panel exploded');
      return <p>alive</p>;
    }

    render(
      <ErrorBoundary surface="panel:crease-pattern" variant="pane">
        <Subject ok />
      </ErrorBoundary>,
    );
    expect(dispatchZoomIn()).toBe(true);
    expect(executor).toHaveBeenCalledOnce();

    render(
      <ErrorBoundary surface="panel:crease-pattern" variant="pane">
        <Subject ok={false} />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('This panel stopped working');

    executor.mockClear();
    expect(dispatchZoomIn()).toBe(false);
    expect(executor).not.toHaveBeenCalled();
  });

  it('sizes the fallback to what was lost', () => {
    render(
      <ErrorBoundary surface="overlay:settings" variant="overlay">
        <Boom />
      </ErrorBoundary>,
    );
    expect(container.querySelector('.error-fallback--overlay')).not.toBeNull();
    expect(container.textContent).toContain('This dialog stopped working');
  });
});
