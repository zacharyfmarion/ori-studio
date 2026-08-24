import { singleDesignTab } from '../../store/workspaceStore/designTabs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DockviewApi, SerializedDockview } from 'dockview';
import type { TFunction } from 'i18next';
import { designKind, type DesignKindDescriptor } from '../../designKinds';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';

/**
 * The real dock needs a laid-out DOM jsdom cannot give it, and the tests below
 * drive its api directly anyway. Mounting it here only has to record the options
 * it was handed.
 */
const { dockviewProps } = vi.hoisted(() => ({
  dockviewProps: [] as Record<string, unknown>[],
}));

vi.mock('dockview', () => ({
  DockviewReact: (props: Record<string, unknown>) => {
    dockviewProps.push(props);
    return null;
  },
}));

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
  dockviewProps.length = 0;
  vi.unstubAllGlobals();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

/** The phone query (`platform/phoneLayout`), which also contains "pointer: coarse". */
const PHONE_QUERY = 'max-width: 600px';

function matchTablet(query: string, coarse: boolean) {
  return {
    matches: query.includes('pointer: coarse') && !query.includes(PHONE_QUERY) ? coarse : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function matchPhone(query: string) {
  return {
    matches: query.includes('pointer: coarse'),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

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

  it('gives box-pleat two headerless canvases side by side', () => {
    const { api, calls, raw } = fakeDock();

    buildLayout(api, designKind('box-pleat')!, t);

    expect(calls.map((options) => options.id)).toEqual(['design', 'bp-editor']);
    // Neither canvas wears a tab header. They used to, on the reasoning that two
    // side by side need naming — in use they do not, and the header reads as a
    // tab that could be closed or dragged, which it cannot. `hideHeader` belongs
    // to the *group*, so each canvas gets its own; the sash between the two
    // groups is the resize this arrangement exists for.
    expect(raw.addGroup).toHaveBeenCalledTimes(2);
    for (const [options] of raw.addGroup.mock.calls) {
      expect(options).toMatchObject({ hideHeader: true });
    }
    expect(calls[1]).toMatchObject({ position: { referenceGroup: expect.anything() } });
  });

  it('gives the search kind the same headerless pair', () => {
    const { api, calls, raw } = fakeDock();

    buildLayout(api, designKind('explori')!, t);

    expect(calls.map((options) => options.id)).toEqual(['explori-tree', 'explori-results']);
    expect(raw.addGroup).toHaveBeenCalledTimes(2);
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

/**
 * The acceptance criterion for "a third design kind is trivial to add".
 *
 * A stub kind that ships nowhere gets a working pane layout out of the same
 * builder the two real kinds use — no branch, no registration in a switch, no
 * edit to this file. Every kind-specific `if` that survived elsewhere would show
 * up here as a stub that lays out wrong.
 */
describe('a third design kind lays out with no code change', () => {
  const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

  const stubKind = {
    id: 'stub',
    panes: [
      {
        id: 'canvas',
        component: 'design',
        title: () => 'Stub canvas',
        placement: { kind: 'primary' as const },
      },
      {
        id: 'tools',
        component: 'inspector',
        title: () => 'Stub tools',
        placement: { kind: 'side' as const, group: 'tools', initialWidth: 240 },
      },
      {
        id: 'more-tools',
        component: 'diagnostics',
        title: () => 'More stub tools',
        placement: { kind: 'side' as const, group: 'tools', inactive: true },
      },
    ],
  } as unknown as DesignKindDescriptor;

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

  it('builds the panes it declares, in the arrangement it declares', () => {
    const { api, calls, raw } = fakeDock();

    buildLayout(api, stubKind, t);

    expect(calls.map((options) => options.id)).toEqual(['design', 'inspector', 'diagnostics']);
    expect(raw.addGroup).toHaveBeenCalledWith({ direction: 'right', hideHeader: true });
    expect(calls[1]).toMatchObject({ initialWidth: 240 });
    expect(calls[2]).toMatchObject({ position: { referenceGroup: 'inspector-group' } });
  });

  it('restores a layout of its own panes and refuses another kind\'s', () => {
    const { api } = fakeDock();
    const layoutOf = (...ids: string[]) =>
      ({ panels: Object.fromEntries(ids.map((id) => [id, {}])) }) as unknown as SerializedDockview;

    expect(restoreLayout(api, stubKind, layoutOf('design', 'inspector', 'diagnostics'))).toBe(true);
    expect(restoreLayout(api, stubKind, layoutOf('design', 'bp-editor'))).toBe(false);
  });

  it('reports a kind that declares no canvas rather than building half a dock', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api, raw } = fakeDock();

    buildLayout(api, { id: 'broken', panes: [] } as unknown as DesignKindDescriptor, t);

    expect(raw.addPanel).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

/**
 * Creating a design is a wasm cold start — seconds on a first visit.
 *
 * Without feedback the chooser sat there looking untouched, and a second click
 * started a second creation on the same tab.
 */
describe('the chooser while a design is being created', () => {
  it('marks the chosen card busy and refuses a second click', async () => {
    let resolveChoice: ((created: boolean) => void) | undefined;
    const choose = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveChoice = resolve;
        })
    );
    const host = render({
      ...singleDesignTab(null),
      engineReady: true,
      status: 'ready',
      chooseDesignMethod: choose,
    });
    const cards = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.design-method-card'));

    act(() => {
      cards()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(cards()[0].getAttribute('aria-busy')).toBe('true');
    expect(cards()[0].textContent).toContain('Preparing the editor');
    // Every card is out of action, not just the one clicked: a tab authors one
    // design, so the other choice is not available either.
    expect(cards().every((card) => card.disabled)).toBe(true);

    act(() => {
      cards()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(choose).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveChoice?.(true);
    });
  });

  it('recovers when creation fails instead of spinning forever', async () => {
    // The creators catch their own errors and report `false`; the chooser used
    // to clear its spinner in a `.catch()`, so the rejection it waited for never
    // came. Offline, choosing box-pleat left every card disabled and one of them
    // spinning — with the failure already in the store, unread.
    let resolveChoice: ((created: boolean) => void) | undefined;
    const choose = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveChoice = resolve;
        })
    );
    const host = render({
      ...singleDesignTab(null),
      engineReady: true,
      status: 'ready',
      chooseDesignMethod: choose,
      oristudioBpError: 'failed to fetch',
    });
    const cards = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.design-method-card'));

    act(() => {
      cards()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      resolveChoice?.(false);
    });

    expect(cards().every((card) => card.disabled)).toBe(false);
    expect(cards()[0].getAttribute('aria-busy')).toBe('false');
    const failure = host.querySelector('.design-method-chooser__failure');
    expect(failure).not.toBeNull();
    expect(failure?.textContent).toContain('failed to fetch');
    expect(failure?.querySelector('button')).not.toBeNull();
  });

  it('becomes usable again when the creation fails', async () => {
    const choose = vi.fn(async () => {
      throw new Error('engine unavailable');
    });
    const host = render({
      ...singleDesignTab(null),
      engineReady: true,
      status: 'ready',
      chooseDesignMethod: choose,
    });
    const cards = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.design-method-card'));

    await act(async () => {
      cards()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // The chooser is still on screen — leaving it dead would strand the tab.
    expect(cards()[0].getAttribute('aria-busy')).toBe('false');
    expect(cards().some((card) => !card.disabled)).toBe(true);
  });
});

/**
 * This dock's arrangement is the only layout that leaves the device: it rides in
 * the `.osf` as `viewState.paneLayout`, where the workspace dock's lives in local
 * storage and stays put. So it must be written back under the same rules
 * everywhere — a pointer-dependent lock here would let an iPad session hand the
 * desktop an arrangement the desktop would not have produced.
 */
describe('the design pane dock', () => {
  function stubPointer(coarse: boolean) {
    // A *tablet*: coarse, and wide enough that the phone layout does not apply.
    // The distinction is load-bearing here — `PHONE_MEDIA_QUERY` also contains
    // "pointer: coarse", so a stub matching on that substring alone would put
    // this dock-lock test on the phone branch, where there is no dock at all.
    vi.stubGlobal('matchMedia', vi.fn((query: string) => matchTablet(query, coarse)));
  }

  function mountedProps(coarse: boolean) {
    stubPointer(coarse);
    render(singleDesignTab('treemaker'));
    return dockviewProps.at(-1) ?? {};
  }

  it('locks panel drag-and-drop on every device, not only touch ones', () => {
    expect(mountedProps(false).disableDnd).toBe(true);
  });

  it('is no more locked on a touch device than on a desktop', () => {
    const desktop = mountedProps(false);
    act(() => root?.unmount());
    dockviewProps.length = 0;

    expect(mountedProps(true).disableDnd).toBe(desktop.disableDnd);
  });
});

/**
 * A design's panes are a split — a tree beside a packing editor, a tree beside
 * its results, a canvas beside a tabbed tool column. At 440pt that is ~220pt
 * each, which is not a design surface. The phone layout shows one and switches.
 */
describe('DesignPaneLayout on a phone', () => {
  function renderPhone(kind: 'treemaker' | 'box-pleat' | 'explori', activePanelId?: string) {
    vi.stubGlobal('matchMedia', vi.fn(matchPhone));
    return render({
      ...singleDesignTab(kind),
      ...(activePanelId ? { activePanelId } : {}),
    });
  }

  it('mounts no dock at all', () => {
    // Not a dock with hidden groups: no dock is what makes the two promises
    // below structural rather than remembered — `onDidLayoutChange` cannot fire
    // if there is nothing to fire it.
    renderPhone('box-pleat');

    expect(dockviewProps).toHaveLength(0);
    expect(container?.querySelector('.design-pane-single')).not.toBeNull();
  });

  it('never writes a pane layout into the document', () => {
    // This dock's arrangement rides in the `.osf` as `viewState.paneLayout`, so
    // a one-pane layout written here would travel to the author's desktop and to
    // anyone they sent the file to.
    const setDesignPaneLayout = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn(matchPhone));
    render({ ...singleDesignTab('box-pleat'), setDesignPaneLayout });

    expect(setDesignPaneLayout).not.toHaveBeenCalled();
  });

  it('opens on the kind’s primary pane', () => {
    renderPhone('box-pleat');

    expect(useWorkspaceStore.getState().activePanelId).toBe('design');
  });

  it('shows the pane the store names, and reports it', () => {
    // `activePanelId` is what drives `activeEditingContext` — the menus, the
    // undo stack, the shortcut scope — so a pane on screen that the store does
    // not know about is a workspace operating on something else.
    renderPhone('box-pleat', 'bp-editor');

    expect(useWorkspaceStore.getState().activePanelId).toBe('bp-editor');
  });

  it('falls back to the primary pane when the active id is not this kind’s', () => {
    // A tab switch leaves the previous design's pane in `activePanelId` until
    // something re-reports; rendering nothing would be the alternative.
    renderPhone('explori', 'bp-editor');

    expect(useWorkspaceStore.getState().activePanelId).toBe('explori-tree');
  });

  it('lets activatePanel reach a pane that is not docked', async () => {
    // `activatePanel('inspector')` is the BP long-press and the View menu. With
    // no dock there is no `IDockviewPanel` to call `setActive` on, so without
    // the registered selector it would silently do nothing.
    const { useLayoutStore } = await import('../../store/layoutStore');
    renderPhone('treemaker');

    act(() => useLayoutStore.getState().activatePanel('conditions'));

    expect(useWorkspaceStore.getState().activePanelId).toBe('conditions');
  });

  it('declines an id this design does not own', async () => {
    // The layout store has no business knowing a kind's panes, so it asks — and
    // an unrecognised id has to leave the active pane alone rather than setting
    // an editing context nothing can render.
    const { useLayoutStore } = await import('../../store/layoutStore');
    renderPhone('box-pleat');

    act(() => useLayoutStore.getState().activatePanel('conditions'));

    expect(useWorkspaceStore.getState().activePanelId).toBe('design');
  });
});
