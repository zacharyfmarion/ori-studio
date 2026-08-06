import { singleDesignTab } from '../../store/workspaceStore/designTabs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DockviewApi, SerializedDockview } from 'dockview';
import type { TFunction } from 'i18next';
import { designKind } from '../../designKinds';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DesignPaneLayout, buildLayout, restoreLayout } from './DesignPaneLayout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(state: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(), ...state }, true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider>
        <DesignPaneLayout />
      </TooltipProvider>
    );
  });
  return container;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

/**
 * A tab that has chosen no kind has no panes — its kind is what declares them —
 * so the chooser is the layout host's own state rather than any kind's pane.
 */
describe('DesignPaneLayout — a tab with no kind', () => {
  it('shows the method chooser', () => {
    const host = render({ ...singleDesignTab(null) });

    expect(host.textContent).toContain('Start a new design');
  });

  it('leaves the Box-pleated method available before the treemaker engine loads', () => {
    const host = render({ engineReady: false, ...singleDesignTab(null) });

    const button = (label: string) =>
      Array.from(host.querySelectorAll('button')).find((element) =>
        element.textContent?.includes(label)
      );
    // Box-pleating runs on the BP worker, so it must not wait on the engine…
    expect(button('Box-pleated')?.disabled).toBe(false);
    // …while circle-packing genuinely does.
    expect(button('Circle-packed')?.disabled).toBe(true);
  });
});

describe('the pane layout a kind declares', () => {
  const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

  /** A dockview api recorded rather than driven — the arrangement is the subject. */
  function fakeDock() {
    const panels = new Map<string, { id: string; group: { id: string }; api: { setActive: Mock } }>();
    const calls: Record<string, unknown>[] = [];
    const api = {
      addGroup: vi.fn((options: Record<string, unknown>) => ({ id: 'g0', ...options })),
      addPanel: vi.fn((options: Record<string, unknown>) => {
        calls.push(options);
        const panel = {
          id: options.id as string,
          group: { id: `${options.id as string}-group` },
          api: { setActive: vi.fn() },
        };
        panels.set(panel.id, panel);
        return panel;
      }),
      getPanel: vi.fn((id: string) => panels.get(id) ?? null),
      clear: vi.fn(),
      fromJSON: vi.fn(),
    };
    return { api: api as unknown as DockviewApi, calls, raw: api };
  }

  it('gives circle-packed a headerless canvas and one tool column', () => {
    const { api, calls, raw } = fakeDock();

    buildLayout(api, designKind('treemaker')!, t);

    expect(calls.map((options) => options.id)).toEqual([
      'design',
      'inspector',
      'diagnostics',
      'conditions',
    ]);
    // A canvas beside a tool column needs no header of its own; the column
    // labels itself. This is the rule the hand-written layout followed.
    expect(raw.addGroup).toHaveBeenCalledWith({ direction: 'right', hideHeader: true });
    expect(calls[1]).toMatchObject({ initialWidth: 320 });
    // Diagnostics and Conditions are *tabs* of the inspector's column, not
    // columns of their own — the reason this is a dock and not a grid.
    expect(calls[2]).toMatchObject({ position: { referenceGroup: 'inspector-group' }, inactive: true });
    expect(calls[3]).toMatchObject({ position: { referenceGroup: 'inspector-group' }, inactive: true });
  });

  it('gives box-pleat two headered canvases side by side', () => {
    const { api, calls, raw } = fakeDock();

    buildLayout(api, designKind('box-pleat')!, t);

    expect(calls.map((options) => options.id)).toEqual(['design', 'bp-editor']);
    // Two peer canvases need naming, so neither group hides its header.
    expect(raw.addGroup).not.toHaveBeenCalled();
    expect(calls[1]).toMatchObject({ position: { referencePanel: 'design', direction: 'right' } });
  });
});

describe('restoring a saved pane layout', () => {
  const layoutOf = (...ids: string[]) =>
    ({ panels: Object.fromEntries(ids.map((id) => [id, {}])) }) as unknown as SerializedDockview;

  function fakeDock() {
    const api = { fromJSON: vi.fn(), clear: vi.fn(), addPanel: vi.fn(), getPanel: vi.fn() };
    return { api: api as unknown as DockviewApi, raw: api };
  }

  it('restores a layout naming exactly the kind\'s panes', () => {
    const { api, raw } = fakeDock();
    const saved = layoutOf('design', 'inspector', 'diagnostics', 'conditions');

    expect(restoreLayout(api, designKind('treemaker')!, saved)).toBe(true);
    expect(raw.fromJSON).toHaveBeenCalledWith(saved);
  });

  it('refuses a layout written for another kind', () => {
    // Two kinds' layouts coexist in one file. Restoring box-pleat's into a
    // circle-packed tab would mount a dock with panels that have no components.
    const { api, raw } = fakeDock();

    expect(restoreLayout(api, designKind('treemaker')!, layoutOf('design', 'bp-editor'))).toBe(false);
    expect(raw.fromJSON).not.toHaveBeenCalled();
  });

  it('refuses a layout missing a pane the kind has since gained', () => {
    const { api } = fakeDock();
    expect(restoreLayout(api, designKind('treemaker')!, layoutOf('design', 'inspector'))).toBe(false);
  });

  it('falls back to the default when dockview rejects the layout', () => {
    const { api, raw } = fakeDock();
    raw.fromJSON.mockImplementation(() => {
      throw new Error('corrupt');
    });

    expect(restoreLayout(api, designKind('treemaker')!, layoutOf('design', 'inspector', 'diagnostics', 'conditions'))).toBe(false);
    // Whatever it managed to build before throwing is cleared, so the caller
    // builds the default into an empty dock rather than half a restored one.
    expect(raw.clear).toHaveBeenCalled();
  });

  it('has nothing to restore for a design that never saved one', () => {
    const { api } = fakeDock();
    expect(restoreLayout(api, designKind('treemaker')!, null)).toBe(false);
  });
});
