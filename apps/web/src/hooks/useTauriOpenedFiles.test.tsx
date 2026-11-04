import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type OpenedFilesHandler = (event: { payload: string[] }) => void;

/** The desktop shell's half: the `opened-files` event, and the paths it held from launch. */
const shell = vi.hoisted(() => ({
  handler: null as OpenedFilesHandler | null,
  launchPaths: [] as string[],
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => (command === 'take_opened_files' ? shell.launchPaths.splice(0) : undefined)),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, handler: OpenedFilesHandler) => {
    shell.handler = handler;
    return () => {
      shell.handler = null;
    };
  }),
}));
vi.mock('../platform/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/runtime')>()),
  isDesktopRuntime: () => true,
}));
const toasts = vi.hoisted(() => ({ message: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

import { useTauriOpenedFiles } from './useTauriOpenedFiles';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CRANE = '/Users/someone/origami/crane.osf';
const CLOSE_THE_DIALOG = 'Close the dialog to open another file';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let dialog: HTMLElement | null = null;
const openPath = vi.fn(async (_path: string) => undefined);

function Host() {
  useTauriOpenedFiles(true, openPath);
  return null;
}

async function mount() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Host />);
  });
  await vi.waitFor(() => expect(shell.handler).not.toBeNull());
}

function unmount() {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
}

/** A file double-clicked in the Finder while the app runs. */
function openFromFinder(path: string) {
  if (!shell.handler) throw new Error('nothing listens for opened files');
  shell.handler({ payload: [path] });
}

/** What every modal the app marks a barrier renders (`useModalDialog`). */
function openModal() {
  dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('data-shortcut-barrier', '');
  document.body.append(dialog);
}

function closeModal() {
  dialog?.remove();
  dialog = null;
}

/**
 * A file the OS opens while a modal dialog is up would replace the document
 * the dialog was opened on, as the native File ▸ Open did before the menus held
 * it back. Refused with a toast, never opened under the dialog.
 */
describe('files the OS opens', () => {
  beforeEach(() => {
    shell.handler = null;
    shell.launchPaths = [];
    openPath.mockClear();
    toasts.message.mockClear();
  });

  afterEach(() => {
    unmount();
    closeModal();
  });

  it('opens one from the Finder with no dialog open', async () => {
    await mount();

    openFromFinder(CRANE);

    expect(openPath).toHaveBeenCalledWith(CRANE);
    expect(toasts.message).not.toHaveBeenCalled();
  });

  it('refuses one while a dialog is open, and says to close it first', async () => {
    await mount();
    openModal();

    openFromFinder(CRANE);

    expect(openPath).not.toHaveBeenCalled();
    expect(toasts.message).toHaveBeenCalledWith(CLOSE_THE_DIALOG);
  });

  it('opens the next one once the dialog has closed', async () => {
    await mount();
    openModal();
    openFromFinder(CRANE);
    closeModal();

    openFromFinder(CRANE);

    expect(openPath).toHaveBeenCalledOnce();
    expect(toasts.message).toHaveBeenCalledOnce();
  });

  it('is not held back by a dialog that is not a barrier', async () => {
    // A sheet or drawer is `aria-modal` too, and covers no document of its own.
    await mount();
    openModal();
    dialog?.removeAttribute('data-shortcut-barrier');

    openFromFinder(CRANE);

    expect(openPath).toHaveBeenCalledWith(CRANE);
  });

  it('opens the file the app was launched on, and refuses it the same way under a dialog', async () => {
    shell.launchPaths = [CRANE];
    await mount();
    await vi.waitFor(() => expect(openPath).toHaveBeenCalledWith(CRANE));
    unmount();
    openPath.mockClear();

    shell.launchPaths = [CRANE];
    openModal();
    await mount();

    await vi.waitFor(() => expect(toasts.message).toHaveBeenCalledWith(CLOSE_THE_DIALOG));
    expect(openPath).not.toHaveBeenCalled();
  });
});
