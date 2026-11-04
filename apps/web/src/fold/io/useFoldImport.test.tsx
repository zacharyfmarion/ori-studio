/**
 * Import CP's flow for its dialog's lifetime (`useFoldImportFlow`): let go
 * with a choice in hand — the Layer order dialog's or the chooser's, as the
 * browser's Back unmounts Import CP — it closes Import CP too, so Forward
 * finds it closed rather than importing the file again (row H10's review).
 * The flow is stood in for: this is the hook's part.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { FoldImportFlow, FoldImportFlowState, FoldImportRequest } from './foldImportFlow';

const made = vi.hoisted(() => ({ flows: [] as { store: StoreApi<FoldImportFlowState>; dispose: () => void }[] }));

vi.mock('./foldImportFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./foldImportFlow')>();
  const { createStore: create } = await import('zustand/vanilla');
  return {
    ...actual,
    createFoldImportFlow: () => {
      const flow = {
        store: create<FoldImportFlowState>(() => ({ phase: 'idle' })),
        open: vi.fn(async () => {}),
        dispose: vi.fn(),
      };
      made.flows.push(flow);
      return flow as unknown as FoldImportFlow;
    },
  };
});
vi.mock('../../store/workspaceStore/foldSession', () => ({ foldSession: () => ({}) }));

import { useFoldImportUiStore } from './foldImportUiStore';
import { useFoldImportFlow } from './useFoldImport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FILE: FoldImportRequest = { kind: 'file', name: 'kabuto.fold', source: { format: 'fold', text: '{}' } };

function Harness({ request }: { request: FoldImportRequest | null }) {
  useFoldImportFlow(request);
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  made.flows = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  host.remove();
  act(() => useFoldImportUiStore.getState().close());
});

function lastFlow() {
  const flow = made.flows.at(-1);
  if (!flow) throw new Error('no flow made');
  return flow;
}

describe('useFoldImportFlow', () => {
  it.each(['ordering', 'choosing'] as const)('closes Import CP when let go while %s', (phase) => {
    act(() => useFoldImportUiStore.getState().open(FILE));
    act(() => root.render(<Harness request={FILE} />));
    const flow = lastFlow();
    const state =
      phase === 'ordering'
        ? { phase, request: FILE }
        : ({ phase, request: FILE, opened: {}, choice: [0], previews: new Map(), committing: false, confirmed: [false], component: 0 } as never);
    act(() => flow.store.setState(state, true));
    act(() => root.unmount());
    expect(flow.dispose).toHaveBeenCalledOnce();
    expect(useFoldImportUiStore.getState().opening).toBeNull();
  });

  it('leaves Import CP open when let go with nothing in hand', () => {
    act(() => useFoldImportUiStore.getState().open(FILE));
    act(() => root.render(<Harness request={FILE} />));
    act(() => root.unmount());
    expect(lastFlow().dispose).toHaveBeenCalledOnce();
    expect(useFoldImportUiStore.getState().opening).not.toBeNull();
  });
});
