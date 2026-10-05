import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANNOTATE_TOOL_GROUPS, annotateToolLabel } from '../../diagram/annotate/annotateTools';
import { stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import i18n from '../../i18n';
import { STORAGE_KEYS, storageKey } from '../../lib/storage';
import { COARSE_POINTER_QUERY } from '../../platform/pointerSurface';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramAnnotateCanvas } from './DiagramAnnotateCanvas';

/**
 * Annotate's tool window (decision 7), as the canvas mounts it: the tool in
 * hand named, how to use it, and its keys — in this platform's names, and
 * none for a finger — over the canvas's bottom right, while the diagram can
 * change.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
let host: HTMLDivElement;
let root: Root;
let coarse = false;
const realRect = HTMLElement.prototype.getBoundingClientRect;

/** Override the fields `platform/runtime` reads, as `lib/platform.test.ts` does. */
function platform(fields: { platform: string; userAgent?: string }) {
  for (const [key, value] of Object.entries({ maxTouchPoints: 0, ...fields })) {
    Object.defineProperty(navigator, key, { configurable: true, value });
  }
}

beforeEach(() => {
  useWorkspaceStore.setState(initialState, true);
  localStorage.clear();
  coarse = false;
  platform({ platform: 'MacIntel' });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query === COARSE_POINTER_QUERY,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  // jsdom lays nothing out: the canvas's view is given Edit's layout, its
  // right edge the seam with a 260 px pane, so the window has a place to be.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.hasAttribute('data-tool')
      ? ({ left: 0, top: 0, right: 764, bottom: 700, width: 764, height: 700, x: 0, y: 0 } as DOMRect)
      : realRect.call(this);
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  HTMLElement.prototype.getBoundingClientRect = realRect;
  for (const key of ['platform', 'userAgent', 'maxTouchPoints']) Reflect.deleteProperty(navigator, key);
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** A step with a picture, open in Annotate, and the canvas on it. */
function mount({ readOnly = false } = {}) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
  act(() => {
    state().addDiagramPictures([{ id: 'asset-1', kind: 'svg', svg, widthPx: 400, heightPx: 300, bytes: svg.length }]);
  });
  act(() => {
    state().openDiagramStep(state().diagramSelectedStepId!, 'annotate');
  });
  rerender(readOnly);
}

function rerender(readOnly = false) {
  const { diagram } = state();
  const step = stepsIn(diagram!).find((candidate) => candidate.id === state().diagramSelectedStepId)!;
  act(() =>
    root.render(
      <TooltipProvider>
        <DiagramAnnotateCanvas step={step} assets={diagram!.assets} style={diagram!.style} readOnly={readOnly} />
      </TooltipProvider>
    )
  );
}

const windowEl = () => document.querySelector<HTMLElement>('section[aria-label="Annotate tool instructions"]');
const title = () => windowEl()?.querySelector('button[aria-expanded]')?.textContent ?? '';
const intro = () => windowEl()?.querySelector('p')?.textContent ?? null;
const keys = () => [...(windowEl()?.querySelectorAll('li') ?? [])].map((item) => item.textContent);
const tool = (kind: Parameters<ReturnType<typeof state>['setDiagramAnnotateTool']>[0]) =>
  act(() => state().setDiagramAnnotateTool(kind));

describe('DiagramAnnotateToolWindow', () => {
  it('names every tool and says how to use it, over the canvas rather than in it', () => {
    mount();
    for (const each of ANNOTATE_TOOL_GROUPS.flatMap((group) => group.tools).filter((each) => each !== null)) {
      tool(each);
      expect(title()).toContain(annotateToolLabel(i18n.t.bind(i18n), each));
      expect(intro()).toBeTruthy();
    }
    // Portaled past the view, so it can overhang the seam with the Step pane.
    expect(windowEl()?.parentElement).toBe(document.body);
    expect(windowEl()?.style.left).toBe(`${764 - 50}px`);
  });

  it('says what a drawing tool does and the key that puts it down anywhere', () => {
    mount();
    tool('valley-arrow');
    expect(title()).toContain('Valley Fold Arrow');
    expect(title()).toContain('Instructions');
    expect(intro()).toBe('Drag from where the paper starts to where it lands.');
    expect(keys()).toEqual(['Hold Cmd to put an end down anywhere, without snapping.']);
    tool('right-angle');
    expect(keys()).toEqual([
      'Shift-drag to open it in 45° steps where it finds no right angle.',
      'Hold Cmd to put its corner down anywhere, without snapping.',
    ]);
    // A sign is clicked down where it goes, and no key changes that.
    tool('turn-over');
    expect(intro()).toBe('Click where the sign goes.');
    expect(keys()).toEqual([]);
  });

  it('is not shown with Select in hand, where Annotate rests, as Edit’s is not with Box Select (review)', () => {
    // Up whenever Annotate was open, it lay over the Step pane's last fields, the instruction's among them.
    mount();
    expect(windowEl()).toBeNull();
    tool('valley-arrow');
    expect(title()).toContain('Valley Fold Arrow');
    tool(null);
    expect(windowEl()).toBeNull();
  });

  it('says what Edit Path can shape, by what is selected, and its keys', () => {
    mount();
    const stepId = state().diagramSelectedStepId!;
    act(() =>
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'a-1', kind: 'valley-arrow', from: [0.2, 0.3], to: [0.6, 0.3], bend: 0.1 },
        { id: 'a-2', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'B' },
      ])
    );
    rerender();
    tool('edit-path');
    expect(title()).toContain('Edit Path');
    expect(intro()).toBe('Select a fold arrow or a white arrow to shape it.');
    act(() => state().selectDiagramAnnotation('a-2'));
    expect(intro()).toBe('Only fold arrows and white arrows can be shaped.');
    act(() => state().selectDiagramAnnotation('a-1'));
    expect(intro()).toMatch(/^Drag an arrow’s nodes/);
    expect(keys()).toEqual([
      'Shift-drag a node to move it only across, up and down, or at 45°.',
      'Shift-drag a handle to turn it in 15° steps.',
      'Option-drag a smooth node’s handle to move it alone: the node becomes a corner.',
    ]);
  });

  it('names the keys as Windows and Linux do', () => {
    platform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    mount();
    tool('circle');
    expect(keys()).toEqual(['Hold Ctrl to put it down anywhere, without snapping.']);
    tool('edit-path');
    expect(keys()[2]).toMatch(/^Alt-drag/);
  });

  it('offers a finger no keys to hold', () => {
    coarse = true;
    mount();
    tool('circle');
    expect(intro()).toBe('Click a point to circle it.');
    expect(windowEl()?.querySelector('ul')).toBeNull();
  });

  it('is not shown on a diagram that cannot change, as Edit’s is not', () => {
    mount({ readOnly: true });
    tool('valley-arrow');
    expect(windowEl()).toBeNull();
  });

  it('collapses on its own, apart from Edit’s and the Simulator’s windows', () => {
    mount();
    tool('valley-arrow');
    act(() => windowEl()!.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
    expect(intro()).toBeNull();
    expect(localStorage.getItem(storageKey(STORAGE_KEYS.diagramToolHintCollapsed))).toBe('true');
    expect(localStorage.getItem(storageKey(STORAGE_KEYS.cpToolHintCollapsed))).toBeNull();
    // Still collapsed with another tool in hand, and after Select, still saying which.
    tool(null);
    tool('circle');
    expect(intro()).toBeNull();
    expect(title()).toContain('Circle');
  });
});
