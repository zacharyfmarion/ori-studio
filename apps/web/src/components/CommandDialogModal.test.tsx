import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  requestChoice,
  requestConfirmation,
  requestCreasePatternExportOptions,
  requestPositiveNumber,
  useCommandDialogStore,
} from '../store/commandDialogStore';
import { DEFAULT_CREASE_EXPORT_OPTIONS } from '../lib/creaseExport';
import type { CreaseExportDialogResult } from '../store/commandDialogStore';
import { segmentFoldDocument } from '../lib/creasePatternSegmentation';
import type { FoldDocument } from '../engine/types';
import type { OristudioCpFoldedRenderSnapshot } from '../engine/oristudioCpTypes';
import { IDENTITY_CP_MODEL_TO_FOLD } from '../lib/creaseExportFold';
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

/** A minimal folded figure: one white facet. */
function foldedSnapshot(): OristudioCpFoldedRenderSnapshot {
  return {
    schema_version: 1,
    fixture: null,
    pass: null,
    primitives: [
      {
        sequence: 0,
        kind: 'fill_polygon',
        style: {
          paint: { kind: 'color', color: { red: 255, green: 255, blue: 255, alpha: 255 } },
          stroke: { kind: 'none' },
          antialias: 'default',
        },
        geometry: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      },
    ],
  };
}

/** Expand a collapsed controls section by clicking its caret. */
function openSection(container: HTMLElement, title: string) {
  const toggle = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.export-modal__section-toggle')
  ).find((button) => button.textContent === title);
  expect(toggle).toBeDefined();
  if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
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

/** Choice options carry a label and a description, so match on the label span. */
function findOption(label: string): HTMLButtonElement {
  const option = Array.from(
    container?.querySelectorAll<HTMLButtonElement>('.choice-dialog__option') ?? []
  ).find((element) => element.querySelector('.choice-dialog__option-label')?.textContent === label);
  expect(option).toBeDefined();
  return option as HTMLButtonElement;
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
    let result = Promise.resolve<CreaseExportDialogResult | null>(null);

    act(() => {
      result = requestCreasePatternExportOptions({
        title: 'Export SVG',
        format: 'svg',
        fold,
        segments,
        initialOptions: { ...DEFAULT_CREASE_EXPORT_OPTIONS },
        foldSegment: null,
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
      options: {
        ...DEFAULT_CREASE_EXPORT_OPTIONS,
        includeUnassigned: false,
        showBackgroundColor: false,
      },
      content: { foldedFigure: null },
    });
  });

  it('lists rendered thumbnails for a multi-pattern document', async () => {
    const rendered = renderModalHost();
    const fold = twoPatternExportFold();
    const segments = segmentFoldDocument(fold);
    let result = Promise.resolve<CreaseExportDialogResult | null>(null);

    act(() => {
      result = requestCreasePatternExportOptions({
        title: 'Export SVG',
        format: 'svg',
        fold,
        segments,
        initialOptions: { ...DEFAULT_CREASE_EXPORT_OPTIONS },
        foldSegment: null,
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

    await expect(result).resolves.toMatchObject({ options: { segmentId: segments[0]!.id } });
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
        foldSegment: null,
        confirmLabel: 'Export SVG',
      });
    });

    expect(rendered.querySelector('.export-modal__patterns')).toBeNull();
  });

  it('resolves the export theme and caption', async () => {
    const rendered = renderModalHost();
    const fold = exportFold();
    const segments = segmentFoldDocument(fold);
    let result = Promise.resolve<CreaseExportDialogResult | null>(null);

    act(() => {
      result = requestCreasePatternExportOptions({
        title: 'Export PNG',
        format: 'png',
        fold,
        segments,
        initialOptions: { ...DEFAULT_CREASE_EXPORT_OPTIONS },
        foldSegment: null,
        confirmLabel: 'Export PNG',
      });
    });

    act(() => {
      openSection(rendered, 'Appearance');
      openSection(rendered, 'Text');
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
      options: {
        theme: 'dark',
        caption: { title: 'Crane', subtitle: 'Traditional', description: 'Folded from a square.' },
      },
    });
  });

  it('folds the selected pattern and resolves the previewed figure', async () => {
    const rendered = renderModalHost();
    const fold = exportFold();
    const segments = segmentFoldDocument(fold);
    const foldSegment = vi.fn(async () => ({
      snapshot: foldedSnapshot(),
      discoveredCases: 1,
      transform: IDENTITY_CP_MODEL_TO_FOLD,
    }));
    let result = Promise.resolve<CreaseExportDialogResult | null>(null);

    act(() => {
      result = requestCreasePatternExportOptions({
        title: 'Export SVG',
        format: 'svg',
        fold,
        segments,
        initialOptions: { ...DEFAULT_CREASE_EXPORT_OPTIONS },
        foldSegment,
        confirmLabel: 'Export SVG',
      });
    });

    const toggle = rendered.querySelector(
      '[aria-label="Include folded figure"]'
    ) as HTMLButtonElement;
    expect(toggle.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      toggle.click();
    });
    await act(async () => {
      findButton('Export SVG').click();
      await result;
    });

    expect(foldSegment).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toMatchObject({
      options: { includeFoldedFigure: true },
      content: {
        foldedFigure: { primitives: expect.any(Array) },
        foldedFigureTransform: IDENTITY_CP_MODEL_TO_FOLD,
      },
    });
  });

  it('offers only front and back for the folded side', async () => {
    const rendered = renderModalHost();
    const fold = exportFold();
    const segments = segmentFoldDocument(fold);
    const foldSegment = vi.fn(async () => ({
      snapshot: foldedSnapshot(),
      discoveredCases: 1,
      transform: IDENTITY_CP_MODEL_TO_FOLD,
    }));

    act(() => {
      void requestCreasePatternExportOptions({
        title: 'Export SVG',
        format: 'svg',
        fold,
        segments,
        initialOptions: { ...DEFAULT_CREASE_EXPORT_OPTIONS },
        foldSegment,
        confirmLabel: 'Export SVG',
      });
    });

    await act(async () => {
      (rendered.querySelector('[aria-label="Include folded figure"]') as HTMLButtonElement).click();
    });
    act(() => {
      openSection(rendered, 'Folded figure');
    });

    const sides = rendered.querySelector('[role="group"][aria-label="Side"]');
    expect(sides).not.toBeNull();
    // The overlay states the kernel also has — Both and Transparent — are not
    // views the product offers, here or on the canvas.
    expect(
      Array.from(sides?.querySelectorAll('button') ?? []).map((button) => button.title)
    ).toEqual(['Front', 'Back']);
  });

  it('disables the folded figure without an editable crease pattern', () => {
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
        foldSegment: null,
        confirmLabel: 'Export SVG',
      });
    });

    const toggle = rendered.querySelector('[aria-label="Include folded figure"]');
    expect(toggle?.hasAttribute('disabled')).toBe(true);
    expect(rendered.textContent).toContain('Open an editable crease pattern to fold it');
  });

  it('drops the folded figure when the fold fails, so preview and export agree', async () => {
    const rendered = renderModalHost();
    const fold = exportFold();
    const segments = segmentFoldDocument(fold);
    const foldSegment = vi.fn(async () => {
      throw new Error('This crease pattern has no foldable creases');
    });
    let result = Promise.resolve<CreaseExportDialogResult | null>(null);

    act(() => {
      result = requestCreasePatternExportOptions({
        title: 'Export SVG',
        format: 'svg',
        fold,
        segments,
        initialOptions: { ...DEFAULT_CREASE_EXPORT_OPTIONS },
        foldSegment,
        confirmLabel: 'Export SVG',
      });
    });

    await act(async () => {
      (rendered.querySelector('[aria-label="Include folded figure"]') as HTMLButtonElement).click();
    });

    expect(rendered.textContent).toContain('no foldable creases');
    await act(async () => {
      findButton('Export SVG').click();
      await result;
    });

    await expect(result).resolves.toMatchObject({
      options: { includeFoldedFigure: false },
      content: { foldedFigure: null },
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

  describe('choice dialog', () => {
    const dropChoice = {
      title: 'Open or import design.cp?',
      message: 'design.cp is a crease pattern.',
      options: [
        {
          id: 'import',
          label: 'Import beside the current pattern',
          description: 'Merged as one undoable edit.',
        },
        {
          id: 'open',
          label: 'Open as a new file',
          description: 'Discards unsaved changes.',
          tone: 'danger' as const,
        },
      ],
    };

    it('resolves the id of the option that was picked', async () => {
      const rendered = renderModalHost();
      let result = Promise.resolve<string | null>(null);

      act(() => {
        result = requestChoice(dropChoice);
      });

      expect(rendered.textContent).toContain('design.cp is a crease pattern.');
      expect(rendered.textContent).toContain('Merged as one undoable edit.');

      await act(async () => {
        findOption('Import beside the current pattern').click();
        await result;
      });

      await expect(result).resolves.toBe('import');
    });

    it('marks a destructive option so it reads as the risky one', () => {
      renderModalHost();
      act(() => {
        void requestChoice(dropChoice);
      });

      expect(findOption('Open as a new file').dataset.tone).toBe('danger');
      expect(findOption('Import beside the current pattern').dataset.tone).toBeUndefined();
    });

    it('resolves null when dismissed', async () => {
      renderModalHost();
      let result = Promise.resolve<string | null>('import');

      act(() => {
        result = requestChoice(dropChoice);
      });
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await result;
      });

      await expect(result).resolves.toBeNull();
    });

    it('resolves null with no modal host mounted', async () => {
      await expect(requestChoice(dropChoice)).resolves.toBeNull();
    });
  });
});
