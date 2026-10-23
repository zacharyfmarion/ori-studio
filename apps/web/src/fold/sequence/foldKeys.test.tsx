import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The app's session is the worker-bound one; these tests hand the keys one over a fake engine. */
const app = vi.hoisted(() => ({ session: null as import('../session/foldSession').FoldSession | null }));
vi.mock('../../store/workspaceStore/foldSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/workspaceStore/foldSession')>()),
  foldSession: () => {
    if (!app.session) throw new Error('no session');
    return app.session;
  },
}));

/** The menu rows a key runs, as the chokepoint is asked for them. */
const menu = vi.hoisted(() => ({ actions: [] as string[] }));
vi.mock('../../commands/menuActions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commands/menuActions')>()),
  handleMenuAction: (id: string) => {
    menu.actions.push(id);
    return Promise.resolve(true);
  },
}));

import { installAppKeyboardListener } from '../../lib/appKeyboard';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { foldSessionDocumentSource } from '../../store/workspaceStore/foldSession';
import { valleyAt } from '../document/foldSequence.fixtures';
import { createFoldSession } from '../session/foldSession';
import { fakeFoldEngine, inProcessFoldRuntime, settle } from '../session/foldSession.fixtures';
import { registerFoldCancel, registerFoldKeyHandler, useFoldKeyboard } from './foldKeys';

/**
 * Fold's keys through the whole path a keypress takes: the real document
 * listener, the registry's `fold` scope and viewport surface, and the store —
 * as `escapeStopsFold.test.tsx` drives the Edit canvas's.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Keys() {
  useFoldKeyboard();
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let uninstall: (() => void) | null = null;

const state = () => useWorkspaceStore.getState();
const cursor = () => state().foldReader?.cursor ?? null;

function press(key: string, target: EventTarget = document) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

beforeEach(async () => {
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(), activePanelId: 'fold' }, true);
  app.session = createFoldSession({
    document: foldSessionDocumentSource(useWorkspaceStore),
    runtime: inProcessFoldRuntime(() => fakeFoldEngine()),
  });
  app.session.retain();
  await settle();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Keys />));
  uninstall = installAppKeyboardListener({
    getActiveEditingContext: () => 'fold',
    getSelection: () => ({ kind: 'none' }) as never,
    handleMenuAction: () => undefined,
    selectNone: () => undefined,
  });
});

afterEach(() => {
  uninstall?.();
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  app.session?.dispose();
  app.session = null;
});

/** sheet → a → b, with c a branch beside b, the reader on c. */
async function foldBranches() {
  const a = await app.session!.commitStep(valleyAt(0.5));
  const b = await app.session!.commitStep(valleyAt(0.25));
  if (a.status !== 'committed' || b.status !== 'committed') throw new Error('not committed');
  state().moveFoldCursor(a.stepId);
  const c = await app.session!.commitStep(valleyAt(0.75));
  if (c.status !== 'committed') throw new Error('not committed');
  await settle();
  return { a: a.stepId, b: b.stepId, c: c.stepId };
}

describe('Fold’s keys', () => {
  it('steps along the path on ← → and [ ], to the sheet at most and the tip at the end', async () => {
    const { a, c } = await foldBranches();
    expect(cursor()).toBe(c);
    press('ArrowLeft');
    expect(cursor()).toBe(a);
    press('[');
    expect(cursor()).toBeNull();
    press('ArrowLeft');
    expect(cursor()).toBeNull();
    press(']');
    press('ArrowRight');
    expect(cursor()).toBe(c);
    press('ArrowRight');
    expect(cursor()).toBe(c);
  });

  it('chooses the branch at the step on ↑ ↓, and the path follows it', async () => {
    const { b, c } = await foldBranches();
    press('ArrowUp');
    expect(cursor()).toBe(b);
    expect(app.session!.store.getState().activePath.at(-1)).toBe(b);
    press('ArrowUp');
    expect(cursor()).toBe(b);
    press('ArrowDown');
    expect(cursor()).toBe(c);
  });

  it('leaves the arrows to a focused control that uses them', async () => {
    const { c } = await foldBranches();
    const tabs = document.createElement('div');
    tabs.setAttribute('role', 'tablist');
    const tab = document.createElement('button');
    tabs.append(tab);
    container!.append(tabs);
    tab.focus();
    press('ArrowLeft', tab);
    expect(cursor()).toBe(c);
  });

  it('hands every other Fold key to the handlers surfaces register', async () => {
    await foldBranches();
    const handler = vi.fn(() => true);
    const release = registerFoldKeyHandler(handler);
    press('ArrowLeft');
    expect(handler).toHaveBeenCalledWith('fold.previousStep');
    release();
  });

  it('runs Unfold to step on Shift+E and Repeat on the other side on Shift+R, through their menu rows', () => {
    menu.actions.length = 0;
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', shiftKey: true, bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(menu.actions).toEqual(['fold.unfold-to', 'fold.repeat']);
  });

  it('runs Escape through the rungs surfaces arm, newest first, then lets go of the step being folded', async () => {
    const rung = vi.fn(() => true);
    const release = registerFoldCancel(rung);
    press('Escape');
    expect(rung).toHaveBeenCalledOnce();
    release();

    await act(async () => {
      await app.session!.preview(valleyAt(0.5));
    });
    expect(app.session!.store.getState().pending.status).toBe('landed');
    press('Escape');
    expect(app.session!.store.getState().pending.status).toBe('idle');
  });
});
