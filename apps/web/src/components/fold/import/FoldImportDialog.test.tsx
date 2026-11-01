import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { FoldImportOpened } from '../../../fold/engine/foldEngineIoWire';
import type { FoldImportFlow, FoldImportFlowState } from '../../../fold/io/foldImportFlow';

/** The flow the dialog drives: its state set by the test, its verbs spied on. */
const harness = vi.hoisted(() => ({
  flow: null as unknown as FoldImportFlow,
  store: null as unknown as StoreApi<FoldImportFlowState>,
}));
vi.mock('../../../fold/io/useFoldImport', async () => {
  const { useStore } = await import('zustand');
  return {
    useFoldImportFlow: () => ({ flow: harness.flow, state: useStore(harness.store) }),
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
    expect(button('Drop a .cp, .fold, .ori or .orh file')).toBeDefined();
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
