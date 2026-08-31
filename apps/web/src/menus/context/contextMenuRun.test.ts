import { beforeEach, describe, expect, it, vi } from 'vitest';

const reportError = vi.fn();
const toastError = vi.fn();

vi.mock('../../monitoring', () => ({ reportError }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

const { runContextMenuAction } = await import('./contextMenuRun');

describe('runContextMenuAction', () => {
  beforeEach(() => {
    reportError.mockClear();
    toastError.mockClear();
  });

  it('runs a synchronous action and reports nothing', () => {
    const run = vi.fn();

    runContextMenuAction('crease-pattern', 'cp.makeMountain', run);

    expect(run).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('reports a synchronous throw instead of letting it escape the menu', () => {
    const boom = new Error('kernel trapped');

    expect(() =>
      runContextMenuAction('crease-pattern', 'cp.makeValley', () => {
        throw boom;
      })
    ).not.toThrow();

    expect(reportError).toHaveBeenCalledWith(boom, {
      surface: 'context-menu',
      tags: { context_menu_surface: 'crease-pattern', item: 'cp.makeValley' },
    });
    expect(toastError).toHaveBeenCalledOnce();
  });

  it('reports a rejected promise, which would otherwise be an unhandled rejection', async () => {
    const boom = new Error('worker never landed');

    runContextMenuAction('bp-packing', 'bp.layout.subdivide', () => Promise.reject(boom));
    await Promise.resolve();

    expect(reportError).toHaveBeenCalledWith(boom, {
      surface: 'context-menu',
      tags: { context_menu_surface: 'bp-packing', item: 'bp.layout.subdivide' },
    });
  });

  it('leaves a resolved promise alone', async () => {
    runContextMenuAction('tree', 'edit.delete', () => Promise.resolve(true));
    await Promise.resolve();

    expect(reportError).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('keys the toast by item, so a row pressed twice replaces its own toast', () => {
    runContextMenuAction('crease-pattern', 'cp.makeEdge', () => {
      throw new Error('x');
    });

    expect(toastError.mock.calls[0]?.[1]).toMatchObject({ id: 'context-menu-failed-cp.makeEdge' });
  });
});
