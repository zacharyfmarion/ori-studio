import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATH_COLOR_SETTLE_MS } from '../../diagram/pages/usePathColorPick';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramPagePanel } from './DiagramPagePanel';

const analytics = vi.hoisted(() => ({ trackDiagramPageSetupChanged: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));

/** The Page pane through the store: each control one change, one undo step and one count. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useWorkspaceStore.getInitialState();
let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initialState, true);
  act(() => {
    for (let i = 0; i < 10; i += 1) useWorkspaceStore.getState().addDiagramStep();
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <TooltipProvider>
        <DiagramPagePanel />
      </TooltipProvider>
    )
  );
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

const state = () => useWorkspaceStore.getState();
const radio = (name: string) =>
  [...(host?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].find((element) =>
    element.textContent?.startsWith(name)
  )!;
/** An option of the segmented control named `group`, by its label. */
const segment = (group: string, name: string) =>
  [...(host?.querySelectorAll<HTMLElement>(`[role="group"][aria-label="${group}"] button`) ?? [])].find(
    (element) => element.textContent === name
  )!;
const toggle = (name: string) =>
  [...(host?.querySelectorAll<HTMLElement>('[role="switch"]') ?? [])].find(
    (element) => element.getAttribute('aria-label') === name || element.closest('.control-row')?.textContent?.includes(name)
  )!;

const swatch = () => host!.querySelector<HTMLInputElement>('input[type="color"]')!;
/** One move of the colour picker: it sets the swatch's value and reports it. */
const move = (color: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(swatch(), color);
  swatch().dispatchEvent(new Event('input', { bubbles: true }));
};
/** How many times the diagram itself changes from here on. */
const diagramChanges = () => {
  const changes = { count: 0, stop: () => {} };
  changes.stop = useWorkspaceStore.subscribe((next, previous) => {
    if (next.diagram !== previous.diagram) changes.count += 1;
  });
  return changes;
};

describe('DiagramPagePanel', () => {
  it('offers Flow first, and a new diagram starts in it, with its path', () => {
    const layouts = [...(host?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].map(
      (element) => element.textContent
    );
    expect(layouts[0]).toMatch(/^Flow/);
    expect(layouts[1]).toMatch(/^Grid/);
    expect(state().diagram?.page.layout).toBe('flow');
    expect(radio('Flow').getAttribute('aria-checked')).toBe('true');
    expect(host?.textContent).toContain('Show path');
    expect(host?.textContent).toContain('Steps per row');
  });

  it('lays the steps out in a grid, one undo step and one count, and takes the path away', () => {
    const past = state().diagramHistory.past.length;
    act(() => radio('Grid').click());
    expect(state().diagram?.page.layout).toBe('grid');
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(analytics.trackDiagramPageSetupChanged).toHaveBeenCalledWith('layout');
    expect(host?.textContent).not.toContain('Show path');
    expect(host?.textContent).toContain('Columns');
    act(() => radio('Flow').click());
    expect(state().diagram?.page.layout).toBe('flow');
    expect(host?.textContent).toContain('Show path');
  });

  it('sets the flow path’s width, one undo step and one count, and goes back to the steps’ own', () => {
    const field = () => host!.querySelector<HTMLInputElement>('input[aria-label="Path width (mm)"]')!;
    // A4, 3 × 3, a title: the 26 mm the path draws by itself.
    expect(field().value).toBe('26');
    expect(host?.querySelector('[aria-label="Reset Path width (mm) to default"]')).toBeNull();
    const past = state().diagramHistory.past.length;
    act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Increase Path width (mm)"]')!.click());
    expect(state().diagram?.page.pathWidthMm).toBe(27);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(analytics.trackDiagramPageSetupChanged).toHaveBeenCalledWith('path_width');
    act(() => host!.querySelector<HTMLButtonElement>('[aria-label="Reset Path width (mm) to default"]')!.click());
    expect(state().diagram?.page.pathWidthMm).toBeNull();
    expect(field().value).toBe('26');
  });

  it('shows the path’s colour as it is picked and writes it once: one store change, one undo step, one count', () => {
    expect(swatch().value).toBe('#ecece8');
    const before = state().diagram;
    const past = state().diagramHistory.past.length;
    const changes = diagramChanges();
    // The picker reports every move; the swatch follows it, and the document does not.
    for (const color of ['#d0e0f0', '#c0d8f0', '#b0d0f0']) {
      act(() => move(color));
      expect(swatch().value).toBe(color);
    }
    expect(state().diagram).toBe(before);
    expect(changes.count).toBe(0);
    expect(state().diagramHistory.past).toHaveLength(past);
    expect(analytics.trackDiagramPageSetupChanged).not.toHaveBeenCalledWith('path_color');
    // Letting go of focus writes the pick: once.
    act(() => swatch().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(changes.count).toBe(1);
    expect(state().diagram?.page.pathColor).toBe('#b0d0f0');
    expect(swatch().value).toBe('#b0d0f0');
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(analytics.trackDiagramPageSetupChanged).toHaveBeenCalledExactlyOnceWith('path_color');
    // One undo takes the whole pick back; the reset is one change of its own.
    act(() => useWorkspaceStore.getState().undoDiagram());
    expect(state().diagram?.page.pathColor).toBe('#ecece8');
    act(() => useWorkspaceStore.getState().redoDiagram());
    act(() => host!.querySelector<HTMLButtonElement>('[aria-label="Reset Path color to default"]')!.click());
    expect(state().diagram?.page.pathColor).toBe('#ecece8');
    expect(state().diagramHistory.past).toHaveLength(past + 2);
    changes.stop();
  });

  it('writes a pick that goes quiet before the picker lets go, and one that carries on is still one undo step', () => {
    vi.useFakeTimers();
    try {
      const past = state().diagramHistory.past.length;
      act(() => move('#d0e0f0'));
      act(() => move('#c0d8f0'));
      act(() => vi.advanceTimersByTime(PATH_COLOR_SETTLE_MS - 1));
      expect(state().diagram?.page.pathColor).toBe('#ecece8');
      act(() => vi.advanceTimersByTime(1));
      expect(state().diagram?.page.pathColor).toBe('#c0d8f0');
      expect(state().diagramHistory.past).toHaveLength(past + 1);
      // The same pick, on after the pause.
      act(() => move('#b0d0f0'));
      expect(state().diagram?.page.pathColor).toBe('#c0d8f0');
      act(() => vi.advanceTimersByTime(PATH_COLOR_SETTLE_MS));
      expect(state().diagram?.page.pathColor).toBe('#b0d0f0');
      act(() => swatch().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
      expect(state().diagramHistory.past).toHaveLength(past + 1);
      expect(analytics.trackDiagramPageSetupChanged).toHaveBeenCalledExactlyOnceWith('path_color');
      act(() => useWorkspaceStore.getState().undoDiagram());
      expect(state().diagram?.page.pathColor).toBe('#ecece8');
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes a pick still under way when its row goes', () => {
    act(() => move('#d0e0f0'));
    expect(state().diagram?.page.pathColor).toBe('#ecece8');
    act(() => toggle('Show path').click());
    expect(host?.textContent).not.toContain('Path color');
    expect(state().diagram?.page.pathColor).toBe('#d0e0f0');
  });

  it('offers the path’s width and colour only while the flow shows its path', () => {
    expect(host?.textContent).toContain('Path width (mm)');
    expect(host?.textContent).toContain('Path color');
    act(() => toggle('Show path').click());
    expect(host?.textContent).not.toContain('Path width (mm)');
    expect(host?.textContent).not.toContain('Path color');
    act(() => toggle('Show path').click());
    act(() => radio('Grid').click());
    expect(host?.textContent).not.toContain('Path width (mm)');
  });

  it('puts the first page on the right, one undo step and one count, in either layout', () => {
    expect(state().diagram?.page.firstPageSide).toBe('left');
    const past = state().diagramHistory.past.length;
    act(() => segment('First page', 'Right').click());
    expect(state().diagram?.page.firstPageSide).toBe('right');
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(analytics.trackDiagramPageSetupChanged).toHaveBeenCalledWith('first_page_side');
    act(() => radio('Grid').click());
    expect(segment('First page', 'Right').getAttribute('aria-pressed')).toBe('true');
    act(() => segment('First page', 'Left').click());
    expect(state().diagram?.page.firstPageSide).toBe('left');
  });

  it('says how many steps a page holds and how many pages there are', () => {
    expect(host?.textContent).toContain('9 steps per page · 2 pages');
  });

  it('shows the first page number only while numbers are on', () => {
    expect(host?.textContent).toContain('First number');
    act(() => toggle('Page numbers').click());
    expect(state().diagram?.page.pageNumbers.enabled).toBe(false);
    expect(analytics.trackDiagramPageSetupChanged).toHaveBeenCalledWith('page_numbers');
    expect(host?.textContent).not.toContain('First number');
  });

  it('changes nothing on a read-only diagram', () => {
    act(() => useWorkspaceStore.setState({ diagramReadOnly: true }));
    act(() => radio('Grid').click());
    expect(state().diagram?.page.layout).toBe('flow');
    expect(analytics.trackDiagramPageSetupChanged).not.toHaveBeenCalled();
  });
});
