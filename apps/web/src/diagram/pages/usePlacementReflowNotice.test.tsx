import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createDiagram, insertSteps, setPageSetup, stepById } from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { usePlacementReflowNotice } from './usePlacementReflowNotice';

vi.mock('sonner', () => ({ toast: { message: vi.fn() } }));
vi.mock('../../analytics/trackDiagram', () => ({ trackDiagramPlacementsReflowed: vi.fn() }));
const state = () => useWorkspaceStore.getState();
function Notice() {
  usePlacementReflowNotice();
  return null;
}
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(toast.message).mockClear();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  const document = setPageSetup(insertSteps(createDiagram(), [cpStep('s0'), cpStep('s1')], 0), {
    layout: 'grid',
    columns: 2,
  });
  state().installDiagram({ document, readOnly: false, raw: {} });
  state().setDiagramStepPlace('s0', { frame: [2, 3] });
  host = window.document.createElement('div');
  root = createRoot(host);
  act(() => root.render(<Notice />));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
function reflow() {
  act(() => state().setDiagramPage({ columns: 3 }));
}
function undoNotice() {
  const action = vi.mocked(toast.message).mock.calls.at(-1)![1]!.action;
  if (!action || typeof action !== 'object' || !('onClick' in action)) throw new Error('Missing Undo action');
  act(() => action.onClick({} as never));
}
it('announces each reflow once across remounts and restores its edit with Undo', () => {
  reflow();
  expect(toast.message).toHaveBeenCalledTimes(1);
  expect(stepById(state().diagram!, 's0')?.place?.frame).toBeUndefined();
  act(() => root.render(null));
  act(() => root.render(<Notice />));
  expect(toast.message).toHaveBeenCalledTimes(1);
  undoNotice();
  expect(stepById(state().diagram!, 's0')?.place?.frame).toEqual([2, 3]);
  expect(state().diagram!.page.columns).toBe(2);
});
it('does not undo an intervening edit or an unrelated newly loaded diagram', () => {
  reflow();
  act(() => state().setDiagramStepPlace('s1', { text: [1, 2] }));
  const edited = state().diagram;
  undoNotice();
  expect(state().diagram).toBe(edited);
  act(() => state().installDiagram({ document: createDiagram(), readOnly: false, raw: {} }));
  const loaded = state().diagram;
  undoNotice();
  expect(state().diagram).toBe(loaded);
});
