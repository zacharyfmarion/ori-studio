import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gateway = vi.hoisted(() => ({
  loadedWorkspace: vi.fn<() => { resetForStartScreen: () => void } | null>(() => null),
  prefetchWorkspace: vi.fn(),
  startActions: {
    createCreasePattern: vi.fn(),
    createDesign: vi.fn(),
    openPicked: vi.fn(),
    dropFiles: vi.fn(),
  },
}));
vi.mock('./workspaceGateway', () => gateway);

const files = vi.hoisted(() => ({ openTextFile: vi.fn() }));
vi.mock('../platform/fileService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/fileService')>()),
  getFileService: () => ({ openTextFile: files.openTextFile }),
}));

import { WelcomeRoute } from './WelcomeRoute';

/**
 * The start screen with the workspace behind the gateway: what loads when, and that each
 * action reaches the workspace the way the browser requires.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const router = createMemoryRouter(
    [
      { path: '/welcome', element: <WelcomeRoute /> },
      { path: '/edit', element: <p>edit workspace</p> },
    ],
    { initialEntries: ['/welcome'] }
  );
  act(() => root?.render(<RouterProvider router={router} />));
  return router;
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(container?.querySelectorAll('button') ?? []).find((element) =>
    element.textContent?.includes(label)
  );
  expect(match).toBeDefined();
  return match as HTMLButtonElement;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('WelcomeRoute', () => {
  it('is ready at first paint and loads nothing until asked', () => {
    render();

    expect(button('Create a CP').disabled).toBe(false);
    expect(gateway.prefetchWorkspace).not.toHaveBeenCalled();
    expect(Object.values(gateway.startActions).some((action) => action.mock.calls.length > 0)).toBe(false);
  });

  it('takes over a prerendered copy of itself when it mounts, where the reader left it', () => {
    // The first paint of a first visit (`seo/staticPaint.ts`): the copy, scrolled by the
    // reader before the app arrived.
    const copy = document.createElement('div');
    copy.id = 'seo-content';
    copy.setAttribute('data-scroll-top', '420');
    document.body.prepend(copy);
    document.documentElement.setAttribute('data-static-paint', 'shown');

    render();

    expect(document.getElementById('seo-content')).toBeNull();
    expect(document.documentElement.hasAttribute('data-static-paint')).toBe(false);
    expect(container?.querySelector<HTMLElement>('.welcome-page')?.scrollTop).toBe(420);
  });

  it('warms the workspace when focus reaches an action', () => {
    render();
    act(() => button('Create a design').focus());
    expect(gateway.prefetchWorkspace).toHaveBeenCalled();
  });

  it('goes where a start action says once it has run', async () => {
    gateway.startActions.createCreasePattern.mockResolvedValue({ kind: 'navigate', path: '/edit' });
    const router = render();

    await act(async () => button('Create a CP').click());

    expect(router.state.location.pathname).toBe('/edit');
    expect(container?.textContent).toContain('edit workspace');
  });

  it('holds the actions while one runs, and reports why it failed', async () => {
    let finish: (outcome: unknown) => void = () => undefined;
    gateway.startActions.createDesign.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render();

    act(() => button('Create a design').click());
    expect(button('Open a file').disabled).toBe(true);
    expect(container?.textContent).toContain('Preparing the editor...');

    await act(async () => finish({ kind: 'error', message: 'The engine could not start.' }));
    expect(button('Open a file').disabled).toBe(false);
    expect(container?.querySelector('.start-screen__status')?.textContent).toContain(
      'The engine could not start.'
    );
  });

  it('opens the file dialog inside the click, before anything is awaited', () => {
    const picked = Promise.resolve(null);
    files.openTextFile.mockReturnValue(picked);
    gateway.startActions.openPicked.mockResolvedValue({ kind: 'stay' });
    render();

    act(() => button('Open a file').click());

    expect(files.openTextFile).toHaveBeenCalledTimes(1);
    expect(gateway.startActions.openPicked).toHaveBeenCalledWith(picked);
  });

  it('clears transient state on arrival, but only once the workspace exists', () => {
    render();
    act(() => root?.unmount());
    root = null;

    const resetForStartScreen = vi.fn();
    gateway.loadedWorkspace.mockReturnValue({ resetForStartScreen });
    render();
    expect(resetForStartScreen).toHaveBeenCalledOnce();
  });

  it('warms on a file drag and hands the drop to the workspace', async () => {
    gateway.startActions.dropFiles.mockResolvedValue({ kind: 'stay' });
    render();
    const page = container!.querySelector<HTMLElement>('.app-layout')!;
    const file = new File(['1 0 0 400 0\n'], 'crane.cp');
    const fire = (type: string, withFiles: File[] = []) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: { types: ['Files'], items: [{ kind: 'file', type: '' }], files: withFiles, dropEffect: 'none' },
      });
      act(() => page.dispatchEvent(event));
    };

    fire('dragenter');
    expect(gateway.prefetchWorkspace).toHaveBeenCalled();

    fire('drop', [file]);
    await vi.waitFor(() => expect(gateway.startActions.dropFiles).toHaveBeenCalledWith([file]));
  });
});
