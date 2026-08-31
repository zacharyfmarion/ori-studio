import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import {
  useContextMenuController,
  type ContextMenuController,
  type ContextMenuOpenRequest,
} from './useContextMenuController';

// `vi.mock` is hoisted above every top-level binding, so the spy has to be too.
const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  track,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let controller: ContextMenuController | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe() {
  const value = useContextMenuController('crease-pattern');
  // Published from an effect, not during render: writing to module state while
  // rendering is a side effect, and `act` flushes effects — so `controller` is
  // current by the time any assertion below runs.
  useEffect(() => {
    controller = value;
  });
  return null;
}

function action(id: string): ContextMenuItem {
  return { kind: 'action', id, label: id, onSelect: () => {} };
}

function request(overrides: Partial<ContextMenuOpenRequest> = {}): ContextMenuOpenRequest {
  return {
    clientX: 40,
    clientY: 90,
    targetKind: 'selection',
    hasSelection: true,
    build: () => [action('a'), action('b')],
    ...overrides,
  };
}

beforeEach(() => {
  track.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Probe />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  controller = null;
  root = null;
  container = null;
});

describe('useContextMenuController', () => {
  it('starts closed and builds nothing', () => {
    const build = vi.fn(() => [action('a')]);
    // Rendering alone must not touch the builder — that is the whole point of it
    // being a thunk. A canvas re-renders on every edit; a closed menu costs zero.
    act(() => {
      root?.render(<Probe />);
    });

    expect(controller?.open).toBe(false);
    expect(build).not.toHaveBeenCalled();
  });

  it('opens at the requested viewport point with the built rows', () => {
    act(() => controller?.request(request()));

    expect(controller).toMatchObject({ open: true, x: 40, y: 90 });
    expect(controller?.items).toHaveLength(2);
  });

  it('builds exactly once per open', () => {
    const build = vi.fn(() => [action('a')]);

    act(() => controller?.request(request({ build })));

    expect(build).toHaveBeenCalledOnce();
  });

  it('does not open on an empty item list, and reports no menu', () => {
    act(() => controller?.request(request({ build: () => [] })));

    expect(controller?.open).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });

  it('tracks one open, with the surface, target and bucketed size', () => {
    act(() => controller?.request(request({ targetKind: 'crease' })));

    expect(track).toHaveBeenCalledWith('context menu opened', {
      surface: 'crease-pattern',
      target_kind: 'crease',
      has_selection: true,
      source: 'pointer',
      item_count: '<=3',
    });
  });

  it('excludes separators from the item count', () => {
    act(() =>
      controller?.request(
        request({ build: () => [action('a'), { kind: 'separator' }, action('b')] })
      )
    );

    expect(track.mock.calls[0]?.[1]).toMatchObject({ item_count: '<=3' });
  });

  it('records how the menu was raised', () => {
    act(() => controller?.request(request({ source: 'keyboard' })));

    expect(track.mock.calls[0]?.[1]).toMatchObject({ source: 'keyboard' });
  });

  it('replaces an open menu when a second request arrives', () => {
    act(() => controller?.request(request()));
    act(() => controller?.request(request({ clientX: 500, build: () => [action('c')] })));

    expect(controller).toMatchObject({ open: true, x: 500 });
    expect(controller?.items.map((item) => ('id' in item ? item.id : null))).toEqual(['c']);
  });

  it('closes on request and on an external close', () => {
    act(() => controller?.request(request()));
    act(() => controller?.close());
    expect(controller?.open).toBe(false);

    act(() => controller?.request(request()));
    act(() => controller?.onOpenChange(false));
    expect(controller?.open).toBe(false);
  });

  it('hands focus back by default', () => {
    const event = new Event('close');
    const prevented = vi.spyOn(event, 'preventDefault');

    act(() => controller?.onCloseAutoFocus(event));

    expect(prevented).not.toHaveBeenCalled();
  });

  it('leaves focus alone for one close after deferFocus, then resumes', () => {
    const first = new Event('close');
    const firstPrevented = vi.spyOn(first, 'preventDefault');
    act(() => {
      controller?.deferFocus();
      controller?.onCloseAutoFocus(first);
    });
    expect(firstPrevented).toHaveBeenCalledOnce();

    // The deferral is per-close. Left latched, the next menu would strand focus
    // wherever the last dialog left it.
    const second = new Event('close');
    const secondPrevented = vi.spyOn(second, 'preventDefault');
    act(() => controller?.onCloseAutoFocus(second));
    expect(secondPrevented).not.toHaveBeenCalled();
  });
});
