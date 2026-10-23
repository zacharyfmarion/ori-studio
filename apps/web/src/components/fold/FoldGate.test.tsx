import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fold's code, as the gateway imports it: a stand-in, so what is under test
 * is the gate — what shows while the code comes, and once it has, or has not.
 */
vi.mock('../../workspaces/foldEntry', () => ({
  FoldPanel: () => <section aria-label="Fold">fold panel</section>,
  FoldStepPanel: () => <section aria-label="Step">fold step</section>,
  FoldPaperPanel: () => <section aria-label="Paper">fold paper</section>,
  FoldImportModal: () => <div role="dialog">import</div>,
}));
const importMocks = vi.hoisted(() => ({
  importOrReload: vi.fn(<T,>(load: () => Promise<T>) => load()),
}));
vi.mock('../../lib/importOrReload', () => importMocks);
const offlineOnce = () => importMocks.importOrReload.mockImplementationOnce(() => Promise.reject(new Error('offline')));

import { loadFold, resetFoldForTest } from '../../workspaces/foldGateway';
import { FoldGate, FoldImportOverlay, LazyFoldPanel, LazyFoldStepPanel } from './FoldGate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetFoldForTest();
  vi.clearAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('FoldGate', () => {
  it('shows the loading state while Fold’s code comes, then the pane', async () => {
    act(() => root!.render(<LazyFoldPanel />));
    expect(container!.querySelector('[role="status"]')?.textContent).toBe('Loading Fold…');
    await settle();
    expect(container!.querySelector('section[aria-label="Fold"]')).not.toBeNull();
    expect(container!.querySelector('[role="status"]')).toBeNull();
  });

  it('renders at once once Fold’s code has loaded', async () => {
    await act(async () => {
      await loadFold();
    });
    act(() => root!.render(<LazyFoldStepPanel />));
    expect(container!.querySelector('section[aria-label="Step"]')).not.toBeNull();
  });

  it('says it did not load, and loads on Try again', async () => {
    offlineOnce();
    act(() => root!.render(<LazyFoldPanel />));
    await settle();
    const alert = container!.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Fold did not load');
    const retry = [...alert!.querySelectorAll('button')].find((button) => button.textContent === 'Try again');
    act(() => retry!.click());
    await settle();
    expect(container!.querySelector('section[aria-label="Fold"]')).not.toBeNull();
  });

  it('shows nothing for an overlay until it comes, and reports a failed load', async () => {
    offlineOnce();
    const failed = vi.fn();
    act(() =>
      root!.render(
        <FoldGate pending="none" onFailed={failed}>
          {() => <div role="dialog">browser</div>}
        </FoldGate>
      )
    );
    expect(container!.innerHTML).toBe('');
    await settle();
    expect(container!.innerHTML).toBe('');
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('never asks for Fold’s code for the Import CP dialog, which only opens over Fold', async () => {
    act(() => root!.render(<FoldImportOverlay />));
    await settle();
    expect(container!.innerHTML).toBe('');
    await act(async () => {
      await loadFold();
    });
    expect(container!.querySelector('[role="dialog"]')?.textContent).toBe('import');
  });
});
