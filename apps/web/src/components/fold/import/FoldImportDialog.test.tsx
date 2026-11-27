import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { FoldImportOpened } from '../../../fold/engine/foldEngineIoWire';
import type { FoldImportFlow, FoldImportFlowState } from '../../../fold/io/foldImportFlow';
import type { FoldImportQueue, FoldImportQueueState } from '../../../fold/io/foldImportQueue';

/** The flow and the queue the dialog drives: their states set by the test, their verbs spied on. */
const harness = vi.hoisted(() => ({
  flow: null as unknown as FoldImportFlow,
  store: null as unknown as StoreApi<FoldImportFlowState>,
  queue: null as unknown as FoldImportQueue,
  progress: null as unknown as StoreApi<FoldImportQueueState>,
}));
vi.mock('../../../fold/io/useFoldImport', async () => {
  const { useStore } = await import('zustand');
  return {
    useFoldImportFlow: () => ({
      flow: harness.flow,
      state: useStore(harness.store),
      queue: harness.queue,
      progress: useStore(harness.progress),
    }),
  };
});

/** The sequence on screen: one step, the reader on it. */
vi.mock('../../../fold/session/useFoldSession', () => ({
  useFoldSessionState: (select: (snapshot: unknown) => unknown) =>
    select({
      sequence: { steps: [{ id: 'a', parent: null, op: { kind: 'valley' } }] },
      cursor: 'a',
      activePath: ['a'],
    }),
}));

import { useLayoutStore } from '../../../store/layoutStore';
import { useFoldImportUiStore } from '../../../fold/io/foldImportUiStore';
import { FoldImportModal } from './FoldImportDialog';

import { regionReferenceFor } from '../../../cp-workspace/regions/regionReference';
import { sheetRegions } from '../../../cp-workspace/sheets/cpSheetRegions';
import { twoSquaresIndex } from '../../../diagram/capture/capture.fixtures';
const sheets = sheetRegions(twoSquaresIndex()).map(sheet => ({ sheet, thumbnail: null }));
vi.mock('../../../cp-workspace/sheets/useCpPatternSheets', () => ({
  useCpPatternSheets: () => ({ status: 'ready', sheets }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const initialLayout = useLayoutStore.getInitialState();

beforeEach(() => {
  harness.store = createStore<FoldImportFlowState>(() => ({ phase: 'idle' }));
  harness.flow = {
    store: harness.store,
    open: vi.fn(async () => {}),
    choose: vi.fn(),
    accept: vi.fn(async () => {}),
    region: vi.fn(),
    commit: vi.fn(async () => {}),
    searchLonger: vi.fn(async () => {}),
    reset: vi.fn(),
    dispose: vi.fn(),
  };
  harness.progress = createStore<FoldImportQueueState>(() => ({ status: 'idle' }));
  harness.queue = { store: harness.progress, start: vi.fn(), skip: vi.fn(), dispose: vi.fn() };
  useLayoutStore.setState({ ...initialLayout, activeWorkspace: 'fold' }, true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => useFoldImportUiStore.getState().close());
  useLayoutStore.setState(initialLayout, true);
});

function open() {
  act(() => root.render(<FoldImportModal />));
  act(() => useFoldImportUiStore.getState().open());
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (name: string | RegExp) =>
  [...document.querySelectorAll('button')].find((each) =>
    typeof name === 'string' ? each.textContent?.includes(name) : name.test(each.textContent ?? '')
  );
const click = (element: Element | undefined) =>
  act(() => element?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

const OPENED: FoldImportOpened = {
  import: 1,
  summary: {} as FoldImportOpened['summary'],
  paper: null,
  count: { orders: 3, exact: true },
  components: [{ orders: 3, truncated: false }],
  nodes: 12,
};

describe('Import CP’s dialog', () => {
  it('opens only in Fold, on the Edit patterns and where the step goes', () => {
    act(() => useLayoutStore.setState({ activeWorkspace: 'edit' }));
    open();
    expect(dialog()).toBeNull();
    act(() => useLayoutStore.setState({ activeWorkspace: 'fold' }));
    expect(dialog()?.getAttribute('aria-label')).toBe('Import crease pattern');
    expect(button('Drop .cp, .fold, .ori or .orh files')).toBeDefined();
    expect(button('Pattern 1')).toBeDefined();
    expect(button('Pattern 2')).toBeDefined();
    expect(button('Waterbomb base')).toBeUndefined();
    expect(dialog()?.textContent).toContain('Adds a step after step 1');
  });

  it('links the selected Edit pattern as it is pressed', () => {
    open();
    click(button('Pattern 2'));
    expect(harness.flow.open).toHaveBeenCalledExactlyOnceWith({ kind: 'project-cp', region: regionReferenceFor(sheets[1]!.sheet) });
  });

  it('says why an import was refused, with the fix the engine leaves open', () => {
    open();
    act(() =>
      harness.store.setState({
        phase: 'refused',
        request: { kind: 'sample', sample: 'preliminary-base' },
        refusal: { kind: 'engine', refused: { refusal: { code: 'import_budget_exceeded' } } },
      })
    );
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('The search ran long');
    click(button('Search longer'));
    expect(harness.flow.searchLonger).toHaveBeenCalledOnce();
  });

  it('hands layer-order resolution to the canvas instead of keeping a modal over the sidebar', () => {
    open();
    act(() =>
      harness.store.setState({
        phase: 'choosing',
        request: { kind: 'sample', sample: 'pleat-in-eighths' },
        opened: OPENED,
        choice: [0],
        previews: new Map(),
        committing: false,
      })
    );
    expect(dialog()).toBeNull();
    expect(harness.flow.commit).not.toHaveBeenCalled();
  });

  it('steps aside while the Layer order dialog chooses the order, and comes back to say how the import went', () => {
    open();
    const request = { kind: 'file' as const, name: 'kabuto.fold', source: { format: 'fold' as const, text: '{}' } };
    act(() => harness.store.setState({ phase: 'ordering', request }, true));
    expect(dialog()).toBeNull();
    // Still open underneath: the import is under way, and its refusal is said here.
    expect(useFoldImportUiStore.getState().opening).not.toBeNull();
    act(() =>
      harness.store.setState(
        { phase: 'refused', request, refusal: { kind: 'engine', refused: { refusal: { code: 'import_no_order' } } } },
        true
      )
    );
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('hands the files dropped on it to the queue, as they were dropped', () => {
    open();
    const files = ['10.cp', '9.cp', 'notes.txt'].map((name) => new File(['1 0 0 1 1'], name));
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], items: [], files } });
    act(() => {
      dialog()?.dispatchEvent(drop);
    });
    expect(harness.queue.start).toHaveBeenCalledOnce();
    const [picked, via] = vi.mocked(harness.queue.start).mock.calls[0]!;
    expect(picked.map((file) => file.name)).toEqual(['10.cp', '9.cp', 'notes.txt']);
    expect(via).toBe('drop');
    expect(harness.flow.open).not.toHaveBeenCalled();
  });

  it('says which of several files is importing, and takes nothing new meanwhile', () => {
    open();
    act(() => harness.progress.setState({ status: 'running', index: 1, total: 19, name: '8.cp', imported: 1 }, true));
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Importing 8.cp (2 of 19)…');
    expect(button('Drop .cp, .fold, .ori or .orh files')?.disabled).toBe(true);
  });

  it('says where several files stopped, and Skip goes on with the rest', () => {
    open();
    const request = { kind: 'file' as const, name: '5.cp', source: { format: 'cp' as const, text: '' } };
    act(() => {
      harness.store.setState(
        { phase: 'refused', request, refusal: { kind: 'engine', refused: { refusal: { code: 'import_no_order' } } } },
        true
      );
      harness.progress.setState({ status: 'paused', index: 4, total: 19, name: '5.cp', imported: 4 }, true);
    });
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Stopped at 5.cp, file 5 of 19.');
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    click(button('Skip this file'));
    expect(harness.queue.skip).toHaveBeenCalledOnce();

    // The last file has nothing after it to go on with.
    act(() => harness.progress.setState({ status: 'paused', index: 18, total: 19, name: '25.cp', imported: 18 }, true));
    expect(button('Skip this file')).toBeUndefined();
  });

  it('lets a skipped file’s refusal go as soon as the next file is under way', () => {
    open();
    const request = { kind: 'file' as const, name: '5.cp', source: { format: 'cp' as const, text: '' } };
    act(() => {
      harness.store.setState(
        { phase: 'refused', request, refusal: { kind: 'engine', refused: { refusal: { code: 'import_no_order' } } } },
        true
      );
      harness.progress.setState({ status: 'paused', index: 4, total: 19, name: '5.cp', imported: 4 }, true);
    });
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    // Skip: the next file is read before the flow opens it, the flow still on the refusal.
    act(() => harness.progress.setState({ status: 'running', index: 5, total: 19, name: '6.cp', imported: 4 }, true));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Importing 6.cp (6 of 19)…');
  });

  it('stays open between the files of a batch, and closes once the last is committed', () => {
    open();
    const request = { kind: 'file' as const, name: '7.cp', source: { format: 'cp' as const, text: '' } };
    act(() => {
      harness.progress.setState({ status: 'running', index: 1, total: 2, name: '8.cp', imported: 1 }, true);
      harness.store.setState({ phase: 'done', request, stepId: 'fstep-1', origin: 'cp' }, true);
    });
    expect(useFoldImportUiStore.getState().opening).not.toBeNull();
    act(() => harness.progress.setState({ status: 'finished', total: 2, imported: 2 }, true));
    expect(useFoldImportUiStore.getState().opening).toBeNull();
  });

  it('closes itself once the step is committed', () => {
    open();
    expect(dialog()).not.toBeNull();
    act(() =>
      harness.store.setState({
        phase: 'done',
        request: { kind: 'sample', sample: 'preliminary-base' },
        stepId: 'fstep-1',
        origin: 'sample',
      })
    );
    expect(useFoldImportUiStore.getState().opening).toBeNull();
    expect(dialog()).toBeNull();
  });
});
