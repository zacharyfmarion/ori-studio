import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const menu = vi.hoisted(() => ({ handleMenuAction: vi.fn() }));
vi.mock('../../commands/menuActions', () => ({ handleMenuAction: menu.handleMenuAction }));

/** The capability layer reads the whole workspace store; the subject here is the header. */
const capabilities = vi.hoisted(() => ({
  value: {} as Record<string, { enabled: boolean; visible: boolean; label: string; reason: string }>,
}));
vi.mock('../../store/workspaceStore/useWorkspaceCapabilities', () => ({
  useWorkspaceCapabilities: () => capabilities.value,
}));

/**
 * The canvas holds the Fold engine's worker and two WebGL surfaces, neither of
 * which jsdom has; it is tested on its own (`components/fold/canvas`). The
 * subject here is the shell around it.
 */
vi.mock('../fold/canvas/FoldCanvas', () => ({ FoldCanvas: () => null }));

/** The app's session is the worker-bound one; these tests hand the panel one over a fake engine. */
const app = vi.hoisted(() => ({ session: null as import('../../fold/session/foldSession').FoldSession | null }));
vi.mock('../../store/workspaceStore/foldSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/foldSession')>()),
  foldSession: () => {
    if (!app.session) throw new Error('no session');
    return app.session;
  },
}));

import { valleyAt } from '../../fold/document/foldSequence.fixtures';
import { useFoldImportUiStore } from '../../fold/io/foldImportUiStore';
import { clearFoldStateFrames } from '../../fold/sequence/useFoldStateFrames';
import { squareScene } from '../../fold/sequence/foldScene.fixtures';
import { createFoldSession } from '../../fold/session/foldSession';
import { fakeFoldEngine, inProcessFoldRuntime, settle } from '../../fold/session/foldSession.fixtures';
import { foldTools } from '../../fold/tools/foldToolState';
import { PHONE_MEDIA_QUERY } from '../../platform/phoneLayout';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { foldSessionDocumentSource } from '../../store/workspaceStore/foldSession';
import { TooltipProvider } from '../ui/Tooltip';
import { FoldPanel } from './FoldPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialLayoutState = useLayoutStore.getInitialState();

/**
 * jsdom lays nothing out, so the strip's virtualizer is handed widths through
 * `offsetWidth`, as `StepFilmstrip.test.tsx` hands them: a 600px scroller, and
 * 136px per card.
 */
const realOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

function widthFor(element: HTMLElement): number {
  const role = element.getAttribute?.('role');
  if (role === 'listitem') return 136;
  if (role === 'list') return Number.parseFloat(element.style.width || '0');
  if (element.firstElementChild?.getAttribute('role') === 'list') return 600;
  return 0;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function stubPointer(coarse: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('pointer: coarse') ? coarse : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

async function render() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <TooltipProvider>
        <FoldPanel />
      </TooltipProvider>
    )
  );
  await act(async () => settle());
}

const panel = () => container?.querySelector<HTMLElement>('section[aria-label="Fold workspace"]');
const button = (label: string) =>
  [...(container?.querySelectorAll('button') ?? [])].find(
    (each) => each.getAttribute('aria-label') === label || each.textContent === label
  );
const stripCards = () => [...(container?.querySelectorAll('[role="list"] [role="listitem"] button') ?? [])];

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return widthFor(this);
    },
  });
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  // The thumbnails watch their size; jsdom has no ResizeObserver.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  useLayoutStore.setState({ ...initialLayoutState, activeWorkspace: 'fold' }, true);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  menu.handleMenuAction.mockClear();
  capabilities.value = {
    'edit.undo': { enabled: true, visible: true, label: 'Undo', reason: 'Undo' },
    'edit.redo': { enabled: false, visible: true, label: 'Redo', reason: 'Redo' },
    'fold.send-to-edit': { enabled: true, visible: true, label: 'Send to Edit', reason: 'Send to Edit' },
  };
  const engine = () => ({ ...fakeFoldEngine(), scene: () => squareScene() });
  app.session = createFoldSession({
    document: foldSessionDocumentSource(useWorkspaceStore),
    runtime: inProcessFoldRuntime(engine),
  });
  clearFoldStateFrames();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  if (realOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffsetWidth);
  app.session?.dispose();
  app.session = null;
  useLayoutStore.setState(initialLayoutState, true);
});

describe('the Fold panel', () => {
  it('names the workspace and offers the drawer a slot in its header', async () => {
    stubPointer(false);
    await render();

    expect(panel()?.textContent).toContain('Fold');
    // The touch drawer seats its pill here rather than in the canvas pill lane,
    // which would sit over this header.
    const slot = useLayoutStore.getState().viewDrawerSlot;
    expect(slot).not.toBeNull();
    expect(panel()?.contains(slot)).toBe(true);
    // Undo and redo are the menu bar's on a fine pointer.
    expect(button('Undo')).toBeUndefined();
  });

  it('gives a coarse pointer undo and redo in the header, through the menu chokepoint', async () => {
    stubPointer(true);
    await render();

    expect(button('Undo')?.disabled).toBe(false);
    expect(button('Redo')?.disabled).toBe(true);
    act(() => button('Undo')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(menu.handleMenuAction.mock.calls).toEqual([['edit.undo']]);
  });

  it('gives the slot back when it unmounts', async () => {
    stubPointer(true);
    await render();
    act(() => root?.unmount());
    root = null;

    expect(useLayoutStore.getState().viewDrawerSlot).toBeNull();
  });

  it('shows the strip over the canvas, the sheet first, and each step as it is committed', async () => {
    stubPointer(false);
    await render();
    // One view: the fold on screen under the strip, with no tabs to switch it.
    expect(container?.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(panel()?.textContent).toContain('0 steps');
    expect(stripCards().map((card) => card.textContent)).toEqual(['0Sheet']);
    expect(panel()?.textContent).toContain('Start with a square, front side up.');

    await act(async () => {
      await app.session!.commitStep(valleyAt(0.5));
      await settle();
    });
    expect(panel()?.textContent).toContain('1 step');
    expect(stripCards().map((card) => card.getAttribute('aria-current'))).toEqual([null, 'step']);
    expect(stripCards()[1]?.textContent).toContain('Valley');
    expect(panel()?.textContent).toContain('Valley fold along the line drawn, through all layers.');

    // A card is a step to go to.
    act(() => stripCards()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(useWorkspaceStore.getState().foldReader?.cursor).toBeNull();
  });

  it('runs the tool rail down its whole side, beside the header', async () => {
    stubPointer(false);
    foldTools().selectTool('valley');
    await render();
    const rail = () => panel()?.querySelector<HTMLElement>('aside[aria-label="Fold tools"]') ?? null;
    const railButton = (label: string) => rail()?.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`);
    // Beside the header, not under it: the header's verbs come after the rail, outside it.
    const importCp = button('Import CP…');
    expect(rail()).not.toBeNull();
    expect(rail()?.contains(importCp ?? null)).toBe(false);
    expect(rail()!.compareDocumentPosition(importCp!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The tool in hand is marked; a press takes another.
    expect(railButton('Valley fold')?.hasAttribute('data-active')).toBe(true);
    act(() => railButton('Divide line')?.click());
    expect(foldTools().store.getState().tool).toBe('divide-line');
    expect(railButton('Divide line')?.hasAttribute('data-active')).toBe(true);
  });

  it('has no rail on a phone, whose tools are a sheet on the canvas’s bar', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === PHONE_MEDIA_QUERY || query.includes('pointer: coarse'),
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    );
    await render();
    expect(panel()?.querySelector('aside[aria-label="Fold tools"]')).toBeNull();
  });

  it('runs the sequence’s verbs from its header through the commands every surface dispatches', async () => {
    stubPointer(false);
    await render();
    act(() => button('Import CP…')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(menu.handleMenuAction).toHaveBeenCalledWith('fold.import-cp');
    // Nothing on the path to send or export yet but the sheet: nothing to carry.
    expect(button('Send to Edit')?.disabled).toBe(true);
    await act(async () => {
      await app.session!.commitStep(valleyAt(0.5));
      await settle();
    });
    expect(button('Send to Edit')?.disabled).toBe(false);
    act(() => button('Send to Edit')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(menu.handleMenuAction).toHaveBeenCalledWith('fold.send-to-edit');
  });

  it('imports a crease pattern dropped anywhere on it — the strip, the header — as the panes do', async () => {
    stubPointer(false);
    await render();
    /** A drag event carrying `files`, as a browser sends one. */
    const drag = (type: string, files: File[]) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: { types: ['Files'], items: files.map((file) => ({ kind: 'file', type: file.type })), files, dropEffect: 'none' },
      });
      return event;
    };
    const cp = new File(['1 0 0 1 1'], 'crane.cp');
    const overlay = () => panel()?.querySelector('.file-drop-overlay')?.textContent ?? null;
    const dropOn = async (target: Element | null | undefined) => {
      act(() => {
        target?.dispatchEvent(drag('dragenter', [cp]));
      });
      expect(overlay()).toBe('Drop a crease pattern to import it');
      await act(async () => {
        target?.dispatchEvent(drag('drop', [cp]));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(overlay()).toBeNull();
      expect(useFoldImportUiStore.getState().opening?.request).toMatchObject({ kind: 'file', name: 'crane.cp' });
      act(() => useFoldImportUiStore.getState().close());
    };

    await dropOn(stripCards()[0]);
    await dropOn(button('Import CP…'));
  });
});
