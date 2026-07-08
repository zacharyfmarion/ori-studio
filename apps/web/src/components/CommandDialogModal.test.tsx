import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  requestConfirmation,
  requestCreasePatternExportOptions,
  requestPositiveNumber,
  useCommandDialogStore,
} from '../store/commandDialogStore';
import { DEFAULT_CREASE_EXPORT_OPTIONS, type CreaseExportOptions } from '../lib/creaseExport';
import { segmentFoldDocument } from '../lib/creasePatternSegmentation';
import type { FoldDocument } from '../engine/types';
import { CommandDialogModal } from './CommandDialogModal';

function exportFold(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'M'],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderModalHost() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<CommandDialogModal />);
  });
  return container;
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find(
    (element) => element.textContent === label
  );
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

beforeEach(() => {
  useCommandDialogStore.setState(useCommandDialogStore.getInitialState(), true);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  useCommandDialogStore.setState(useCommandDialogStore.getInitialState(), true);
});

describe('CommandDialogModal', () => {
  it('resolves confirmation requests from an in-app modal', async () => {
    const rendered = renderModalHost();
    let result = Promise.resolve(false);

    act(() => {
      result = requestConfirmation({
        title: 'Reset Layout',
        message: 'Restore the default panel layout?',
        confirmLabel: 'Reset',
      });
    });

    expect(rendered.textContent).toContain('Restore the default panel layout?');
    await act(async () => {
      findButton('Reset').click();
      await result;
    });

    await expect(result).resolves.toBe(true);
  });

  it('resolves numeric requests from an in-app modal', async () => {
    const rendered = renderModalHost();
    let result = Promise.resolve<number | null>(null);

    act(() => {
      result = requestPositiveNumber({
        title: 'Split Edge',
        label: 'Distance',
        initialValue: '0.5',
        confirmLabel: 'Split',
      });
    });

    expect(rendered.textContent).toContain('Split Edge');
    expect((rendered.querySelector('input') as HTMLInputElement | null)?.value).toBe('0.5');
    await act(async () => {
      findButton('Split').click();
      await result;
    });

    await expect(result).resolves.toBe(0.5);
  });

  it('resolves crease-pattern export options with a live preview', async () => {
    const rendered = renderModalHost();
    const fold = exportFold();
    const segments = segmentFoldDocument(fold);
    let result = Promise.resolve<CreaseExportOptions | null>(null);

    act(() => {
      result = requestCreasePatternExportOptions({
        title: 'Export SVG',
        format: 'svg',
        fold,
        segments,
        initialOptions: { ...DEFAULT_CREASE_EXPORT_OPTIONS },
        confirmLabel: 'Export SVG',
      });
    });

    expect(rendered.querySelector('.export-modal__preview img')).not.toBeNull();
    await act(async () => {
      (
        rendered.querySelector(
          '[aria-label="Include flat / unassigned creases"]'
        ) as HTMLButtonElement
      ).click();
      (rendered.querySelector('[aria-label="Show background color"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      findButton('Export SVG').click();
      await result;
    });

    await expect(result).resolves.toEqual({
      ...DEFAULT_CREASE_EXPORT_OPTIONS,
      includeUnassigned: false,
      showBackgroundColor: false,
    });
  });

  it('cancels requests on Escape', async () => {
    renderModalHost();
    let result = Promise.resolve(true);

    act(() => {
      result = requestConfirmation({
        title: 'Discard unsaved changes?',
        message: 'Continue and discard them?',
      });
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await result;
    });

    await expect(result).resolves.toBe(false);
  });
});
