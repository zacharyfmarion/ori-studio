import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/Tooltip';
import { DiagramImportDialogHost } from './DiagramImportDialog';
import { useImportDialogStore } from './importDialogStore';

const mocks = vi.hoisted(() => ({ folder: vi.fn(), files: vi.fn(), ensure: vi.fn(), run: vi.fn() }));
vi.mock('../../platform/fileService', async (original) => ({
  ...(await original<typeof import('../../platform/fileService')>()),
  getFileService: () => ({ openBinaryFiles: mocks.files }),
  pickBinaryFolder: mocks.folder,
}));
vi.mock('../../store/workspaceStore/diagramBatchImport', () => ({
  importTarget: () => ({}),
  ensureDiagramImportTarget: mocks.ensure,
}));
vi.mock('./importJob', async (original) => ({
  ...(await original<typeof import('./importJob')>()),
  runImportJob: mocks.run,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const file = { name: '1.cp', type: '', size: 1, read: async () => new Uint8Array() };
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((el) => el.textContent === label)!;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  mocks.folder.mockResolvedValue([file]);
  mocks.files.mockResolvedValue([file]);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    useImportDialogStore.getState().open();
    root.render(
      <TooltipProvider>
        <DiagramImportDialogHost />
      </TooltipProvider>
    );
  });
});
afterEach(() => {
  act(() => {
    root.unmount();
    useImportDialogStore.getState().close();
  });
  host.remove();
  vi.unstubAllGlobals();
});
it('uses the shared toggle for recursive folder picking and exposes layout number controls after selection', async () => {
  const toggle = document.querySelector<HTMLButtonElement>('[role=switch]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  await act(async () => toggle.click());
  await act(async () => button('Choose folder…').click());
  expect(mocks.folder).toHaveBeenCalledWith(true);
  expect(document.querySelector('input[aria-label=Columns]')).not.toBeNull();
  expect(document.querySelector('input[aria-label=Gap]')).not.toBeNull();
  expect(document.querySelector('input[aria-label="Max seconds per fold"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain('Auto');
  expect(document.querySelector('button[title=Reset]')).toBeNull();
  expect(document.querySelector('input[type=checkbox]:not([aria-hidden=true])')).toBeNull();
});
it('closing during Edit provisioning cancels the job and cannot reopen the dialog when provisioning finishes', async () => {
  let finish!: (value: object) => void;
  mocks.ensure.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await act(async () => button('Choose files…').click());
  await act(async () => button('Import').click());
  expect(mocks.ensure).toHaveBeenCalledOnce();
  await act(async () =>
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  );
  expect(document.querySelector('[role=dialog]')).toBeNull();
  await act(async () => finish({}));
  expect(mocks.run).not.toHaveBeenCalled();
  expect(useImportDialogStore.getState().target).toBeNull();
});
