import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

/**
 * The session is Fold's code, which the gateway loads: a stand-in holds a
 * snapshot store and counts who holds it, so what is under test is when the
 * link context asks for the code, holds the session, and reads its replay.
 */
const session = vi.hoisted(() => {
  const release = vi.fn();
  return { release, retain: vi.fn(() => release), store: null as unknown };
});
vi.mock('../../workspaces/foldEntry', () => ({ foldSession: () => session }));
const importMocks = vi.hoisted(() => ({
  importOrReload: vi.fn(<T,>(load: () => Promise<T>) => load()),
}));
vi.mock('../../lib/importOrReload', () => importMocks);

import { loadedFold, resetFoldForTest } from '../../workspaces/foldGateway';
import type { FoldLinkContext } from './foldStepLink';
import { foldLinkContextNow, useFoldLinkContext } from './useFoldLinkContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sheet = { status: 'ok', fingerprint: 'fs1:sheet' };
const nodes = new Map([['fstep-1', { status: 'ok', fingerprint: 'fs1:a' }]]);

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const seen: { context: FoldLinkContext | null } = { context: null };

function Probe({ wants }: { wants: boolean }) {
  const context = useFoldLinkContext(wants);
  useLayoutEffect(() => {
    seen.context = context;
  });
  return null;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  session.store = createStore(() => ({ live: true, sequence: { id: 'fseq-1' }, sheet, nodes }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  seen.context = null;
  resetFoldForTest();
  vi.clearAllMocks();
});

describe('useFoldLinkContext', () => {
  it('asks for nothing while the diagram has no Fold link to tell', async () => {
    act(() => root!.render(<Probe wants={false} />));
    await settle();
    expect(importMocks.importOrReload).not.toHaveBeenCalled();
    expect(loadedFold()).toBeNull();
    expect(seen.context?.replay).toBeNull();
    expect(foldLinkContextNow().replay).toBeNull();
  });

  it('loads Fold’s code for a link to tell, holds the session, and reads its replay', async () => {
    act(() => root!.render(<Probe wants />));
    // Before the code lands there is no replay to read: every such link reads `unknown`.
    expect(seen.context?.replay).toBeNull();
    await settle();
    expect(session.retain).toHaveBeenCalledTimes(1);
    expect(seen.context?.replay).toEqual({ sequenceId: 'fseq-1', sheet, nodes });
    expect(foldLinkContextNow().replay).toEqual({ sequenceId: 'fseq-1', sheet, nodes });

    act(() => root!.render(<Probe wants={false} />));
    expect(session.release).toHaveBeenCalledTimes(1);
  });
});
