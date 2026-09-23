import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boot = vi.hoisted(() => ({ ensureEngineBooted: vi.fn(async () => undefined) }));
vi.mock('../store/workspaceStore/engineBoot', () => boot);

import i18n from '../i18n';
import { humanizeError } from '../lib/toastMessages';
import type { FileService } from '../platform/fileService';
import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import {
  createCreasePatternFromStart,
  createDesignFromStart,
  openProjectFromStart,
  resetForStartScreen,
} from './workspaceEntry';

/**
 * The start screen's actions, run against the real store with only the engine boot
 * stubbed: what a press waits for, and what it tells the page to do afterwards.
 */

const initialState = useWorkspaceStore.getState();
const failure = { code: 'engine_error', message: 'the kernel refused' };

beforeEach(() => {
  useWorkspaceStore.setState({ engineReady: true, status: 'ready', error: null });
});

afterEach(() => {
  useWorkspaceStore.setState(initialState, true);
  vi.clearAllMocks();
});

describe('start actions', () => {
  it('create a crease pattern once the engine is up, then head to Edit', async () => {
    const createNewCreasePattern = vi.fn(async () => {
      expect(boot.ensureEngineBooted).toHaveBeenCalled();
    });
    useWorkspaceStore.setState({ createNewCreasePattern });

    await expect(createCreasePatternFromStart()).resolves.toEqual({ kind: 'navigate', path: '/edit' });
    expect(createNewCreasePattern).toHaveBeenCalledOnce();
  });

  it('start a design on the method chooser', async () => {
    const startNewDesign = vi.fn();
    useWorkspaceStore.setState({ startNewDesign });

    await expect(createDesignFromStart()).resolves.toEqual({ kind: 'navigate', path: '/design' });
    expect(startNewDesign).toHaveBeenCalledOnce();
  });

  it('report an error the action raised, in words', async () => {
    useWorkspaceStore.setState({
      createNewCreasePattern: vi.fn(async () => {
        useWorkspaceStore.setState({ status: 'error', error: failure });
      }),
    });

    await expect(createCreasePatternFromStart()).resolves.toEqual({
      kind: 'error',
      message: humanizeError(failure, i18n.t),
    });
  });

  it('ignore an error left over from an earlier attempt', async () => {
    useWorkspaceStore.setState({
      status: 'error',
      error: failure,
      createNewCreasePattern: vi.fn(async () => undefined),
    });

    await expect(createCreasePatternFromStart()).resolves.toEqual({ kind: 'navigate', path: '/edit' });
  });

  it('stop at an engine that failed to boot', async () => {
    const createNewCreasePattern = vi.fn(async () => undefined);
    useWorkspaceStore.setState({ engineReady: false, status: 'error', error: failure, createNewCreasePattern });

    await expect(createCreasePatternFromStart()).resolves.toEqual({
      kind: 'error',
      message: humanizeError(failure, i18n.t),
    });
    expect(createNewCreasePattern).not.toHaveBeenCalled();
  });

  it('open the file the start screen already picked, keeping its save target', async () => {
    const picked = { text: '1 0 0 400 0\n', name: 'crane.cp', path: 'web-save:1' };
    let service: FileService | null = null;
    useWorkspaceStore.setState({
      openProject: vi.fn(async (fileService?: FileService) => {
        service = fileService ?? null;
        useLayoutStore.getState().setActiveWorkspace('edit');
        return true;
      }),
    });

    await expect(openProjectFromStart(Promise.resolve(picked))).resolves.toEqual({
      kind: 'navigate',
      path: '/edit',
    });
    await expect(service!.openTextFile({ title: 'ignored', extensions: [] })).resolves.toEqual(picked);
  });

  it('stay put when the pick was cancelled', async () => {
    useWorkspaceStore.setState({ openProject: vi.fn(async () => false) });

    await expect(openProjectFromStart(Promise.resolve(null))).resolves.toEqual({ kind: 'stay' });
  });
});

describe('resetForStartScreen', () => {
  it('clears what a discarded session left behind', () => {
    useWorkspaceStore.setState({ dirty: true, status: 'error', error: failure, projectMessage: 'Saved' });
    useLayoutStore.getState().setActiveWorkspace('edit');

    resetForStartScreen();

    const state = useWorkspaceStore.getState();
    expect(state).toMatchObject({ dirty: false, error: null, projectMessage: null, status: 'ready' });
    expect(useLayoutStore.getState().activeWorkspace).toBe('design');
  });
});
