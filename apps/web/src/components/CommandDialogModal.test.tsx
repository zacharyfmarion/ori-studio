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

/** Two disjoint squares, so segmentation yields two crease patterns. */
function twoPatternExportFold(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [3, 0],
      [4, 0],
      [4, 1],
      [3, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [4, 6],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'M', 'B', 'B', 'B', 'B', 'V'],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
      [4, 5, 6],
      [4, 6, 7],
    ],
  };
}

/** Set a controlled input's value the way React's onChange expects. */
function setFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(prototype.prototype, 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
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

  it('lists rendered thumbnails for a multi-pattern document', async () => {
    const rendered = renderModalHost();
    const fold = twoPatternExportFold();
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

    const cards = rendered.querySelectorAll('.export-modal__pattern-card');
    // "All patterns" plus one card per pattern, each with a rendered thumbnail.
    expect(cards).toHaveLength(segments.length + 1);
    expect(rendered.querySelectorAll('.export-modal__pattern-thumb svg')).toHaveLength(
      segments.length + 1
    );

    await act(async () => {
      (cards[1] as HTMLButtonElement).click();
    });
    await act(async () => {
      findButton('Export SVG').click();
      await result;
    });

    await expect(result).resolves.toMatchObject({ segmentId: segments[0]!.id });
  });

  it('hides the thumbnail column for a single-pattern document', () => {
    const rendered = renderModalHost();
    const fold = exportFold();
    const segments = segmentFoldDocument(fold);

    act(() => {
      void requestCreasePatternExportOptions({
        title: 'Export SVG',
        format: 'svg',
        fold,
        segments,
        initialOptions: { ...DEFAULT_CREASE_EXPORT_OPTIONS },
        confirmLabel: 'Export SVG',
      });
    });

    expect(rendered.querySelector('.export-modal__patterns')).toBeNull();
  });

  it('resolves the export theme and caption', async () => {
    const rendered = renderModalHost();
    const fold = exportFold();
    const segments = segmentFoldDocument(fold);
    let result = Promise.resolve<CreaseExportOptions | null>(null);

    act(() => {
      result = requestCreasePatternExportOptions({
        title: 'Export PNG',
        format: 'png',
        fold,
        segments,
        initialOptions: { ...DEFAULT_CREASE_EXPORT_OPTIONS },
        confirmLabel: 'Export PNG',
      });
    });

    await act(async () => {
      findButton('Dark').click();
    });
    await act(async () => {
      setFieldValue(rendered.querySelector('#export-title') as HTMLInputElement, 'Crane');
      setFieldValue(rendered.querySelector('#export-subtitle') as HTMLInputElement, 'Traditional');
      setFieldValue(
        rendered.querySelector('#export-description') as HTMLTextAreaElement,
        'Folded from a square.'
      );
    });
    await act(async () => {
      findButton('Export PNG').click();
      await result;
    });

    await expect(result).resolves.toMatchObject({
      theme: 'dark',
      caption: { title: 'Crane', subtitle: 'Traditional', description: 'Folded from a square.' },
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
