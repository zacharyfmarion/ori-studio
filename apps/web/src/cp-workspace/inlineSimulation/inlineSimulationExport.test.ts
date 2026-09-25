import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/Tooltip';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { InlineSimulationInspector } from '../InlineSimulationInspector';
import { WINDOW } from '../canvasObjects/canvasObjectKinds.fixtures';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import type { InlineSimulation } from './inlineSimulation';
import {
  exportInlineSimulation,
  registerInlineSimulationExporter,
} from './inlineSimulationRuntime';
import { useInlineSimulations } from './useInlineSimulations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// FloatingToolbar's autoUpdate attaches one, and jsdom has none.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const exporter = () => vi.fn(async (): Promise<void> => {});

/**
 * The registry that lets a window's floating toolbar reach the window's own
 * simulator runtime. They are siblings, so there is no prop path between them,
 * and this indirection is what keeps the call out of the crease-pattern panel.
 */
describe('inline simulation view export', () => {
  it('answers false for a window that is not mounted', () => {
    // A toolbar can outlive its window by a frame; that is not a fault.
    expect(exportInlineSimulation('gone')).toBe(false);
    // Nor is another window's exporter a stand-in for it.
    const other = exporter();
    const unregister = registerInlineSimulationExporter('other', other);
    expect(exportInlineSimulation('gone')).toBe(false);
    expect(other).not.toHaveBeenCalled();
    unregister();
  });

  it('routes an export to the window that registered it, once', () => {
    const first = exporter();
    const second = exporter();
    const unregisterFirst = registerInlineSimulationExporter('a', first);
    const unregisterSecond = registerInlineSimulationExporter('b', second);

    expect(exportInlineSimulation('b')).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    unregisterFirst();
    unregisterSecond();
  });

  it('stops routing once a window unregisters', () => {
    const exportView = exporter();
    registerInlineSimulationExporter('c', exportView)();

    expect(exportInlineSimulation('c')).toBe(false);
    expect(exportView).not.toHaveBeenCalled();
  });

  it('does not let a late cleanup unregister its replacement', () => {
    // React can run the previous effect's cleanup *after* the next effect has
    // registered, when the callback identity changes. Without the guard that
    // stale cleanup silently deletes the live exporter and the button goes dead.
    const stale = exporter();
    const live = exporter();
    const unregisterStale = registerInlineSimulationExporter('d', stale);
    const unregisterLive = registerInlineSimulationExporter('d', live);

    unregisterStale();
    expect(exportInlineSimulation('d')).toBe(true);
    expect(live).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();

    unregisterLive();
    expect(exportInlineSimulation('d')).toBe(false);
  });

  it('answers at once, without waiting for the window to open its dialog', () => {
    // The dialog opens after a worker round trip; the toolbar has nothing to
    // wait for, and a rejection is the exporter's to report.
    const pending = vi.fn(() => new Promise<void>(() => {}));
    const unregister = registerInlineSimulationExporter('e', pending);

    expect(exportInlineSimulation('e')).toBe(true);
    expect(pending).toHaveBeenCalledTimes(1);

    unregister();
  });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('the inline simulation toolbar', () => {
  const VIEW = { origin: [0, 0] as const, ex: [1, 0] as const, ey: [0, 1] as const };

  function renderInspector(onExport: () => void): void {
    // The boundary the toolbar is placed against; a zero rect would hide it.
    const boundary = container;
    if (!boundary) throw new Error('not mounted');
    boundary.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
    act(() => cpOverlayViewStore.set({ model: VIEW, user: VIEW }));
    const noop = () => {};
    act(() =>
      root?.render(
        createElement(
          TooltipProvider,
          null,
          createElement(InlineSimulationInspector, {
            simulation: WINDOW,
            container: boundary,
            playing: false,
            stale: false,
            onTogglePlay: noop,
            onScrub: noop,
            onSetUpright: noop,
            onReplay: noop,
            onExport,
            onRefresh: noop,
            onDelete: noop,
          })
        )
      )
    );
  }

  it('asks for an export of its window from one button', () => {
    const onExport = vi.fn();
    renderInspector(onExport);

    const buttons = document.querySelectorAll<HTMLButtonElement>(
      '.cp-inline-simulation-inspector button[aria-label="Export view…"]'
    );
    expect(buttons).toHaveLength(1);
    act(() => buttons[0]?.click());
    expect(onExport).toHaveBeenCalledTimes(1);
    // A button, not a menu of formats: nothing opens on the toolbar itself.
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("the inline simulations' export verb", () => {
  const A: InlineSimulation = { ...WINDOW, id: 'window-a' };
  const B: InlineSimulation = { ...WINDOW, id: 'window-b', z: 2 };
  const latest: { exportView: (() => void) | null } = { exportView: null };

  function Probe(): null {
    const { exportView } = useInlineSimulations({ cpDocument: null });
    useEffect(() => {
      latest.exportView = exportView;
    }, [exportView]);
    return null;
  }

  function mount(focusedId: string | null): void {
    useWorkspaceStore.setState({
      oristudioCpInlineSimulations: [A, B],
      oristudioCpFocusedInlineSimulationId: focusedId,
    });
    act(() => root?.render(createElement(Probe)));
  }

  function exportView(): void {
    if (!latest.exportView) throw new Error('hook not mounted');
    latest.exportView();
  }

  let unregister: (() => void)[] = [];
  const exportA = exporter();
  const exportB = exporter();

  beforeEach(() => {
    latest.exportView = null;
    exportA.mockClear();
    exportB.mockClear();
    unregister = [
      registerInlineSimulationExporter(A.id, exportA),
      registerInlineSimulationExporter(B.id, exportB),
    ];
  });

  afterEach(() => {
    for (const release of unregister) release();
  });

  it('exports the focused window and no other', () => {
    mount(B.id);

    exportView();
    expect(exportB).toHaveBeenCalledTimes(1);
    expect(exportA).not.toHaveBeenCalled();
  });

  it('follows focus to the next window', () => {
    mount(B.id);
    act(() => useWorkspaceStore.setState({ oristudioCpFocusedInlineSimulationId: A.id }));

    exportView();
    expect(exportA).toHaveBeenCalledTimes(1);
    expect(exportB).not.toHaveBeenCalled();
  });

  it('exports nothing with no window focused', () => {
    mount(null);

    exportView();
    expect(exportA).not.toHaveBeenCalled();
    expect(exportB).not.toHaveBeenCalled();
  });
});
