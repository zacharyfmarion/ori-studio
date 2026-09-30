import { afterEach, describe, expect, it, vi } from 'vitest';

const importMocks = vi.hoisted(() => ({
  importOrReload: vi.fn(<T>(load: () => Promise<T>) => load()),
}));
vi.mock('../lib/importOrReload', () => importMocks);

const entry = vi.hoisted(() => ({
  ensureEngineBooted: vi.fn(async () => undefined),
  createCreasePatternFromStart: vi.fn(async () => ({ kind: 'navigate', path: '/edit' })),
  createDesignFromStart: vi.fn(async () => ({ kind: 'navigate', path: '/design' })),
  openProjectFromStart: vi.fn(async () => ({ kind: 'stay' })),
  dropOnStart: vi.fn(async () => ({ kind: 'stay' })),
}));
vi.mock('./workspaceEntry', () => entry);

import {
  loadedWorkspace,
  loadWorkspace,
  prefetchWorkspace,
  resetWorkspaceForTest,
  startActions,
} from './workspaceGateway';

afterEach(() => {
  resetWorkspaceForTest();
  vi.clearAllMocks();
});

describe('workspaceGateway', () => {
  it('loads the workspace once, whoever asks', async () => {
    expect(loadedWorkspace()).toBeNull();
    const [first, second] = await Promise.all([loadWorkspace(), loadWorkspace()]);
    expect(first).toBe(second);
    expect(loadedWorkspace()).toBe(first);
    expect(importMocks.importOrReload).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed load, so the next ask retries', async () => {
    importMocks.importOrReload.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    await expect(loadWorkspace()).rejects.toThrow('offline');
    expect(loadedWorkspace()).toBeNull();

    await expect(loadWorkspace()).resolves.toBeTruthy();
    expect(importMocks.importOrReload).toHaveBeenCalledTimes(2);
  });

  it('boots the engine when warmed on intent', async () => {
    prefetchWorkspace();
    await vi.waitFor(() => expect(entry.ensureEngineBooted).toHaveBeenCalledTimes(1));
  });

  it('swallows a failed warm-up: the action that follows reports it', async () => {
    importMocks.importOrReload.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      prefetchWorkspace();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('runs each start action through the loaded workspace', async () => {
    const picked = Promise.resolve(null);
    const files = [new File(['x'], 'a.cp')];

    await expect(startActions.createCreasePattern()).resolves.toEqual({ kind: 'navigate', path: '/edit' });
    await expect(startActions.createDesign()).resolves.toEqual({ kind: 'navigate', path: '/design' });
    await startActions.openPicked(picked);
    await startActions.dropFiles(files);

    expect(entry.openProjectFromStart).toHaveBeenCalledWith(picked);
    expect(entry.dropOnStart).toHaveBeenCalledWith(files);
  });
});
