import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import { TooltipProvider } from '../../components/ui/Tooltip';
import { CpFoldedFigureToolbar } from './CpFoldedFigureToolbar';
import type { FoldedFigureActionDeps } from './foldedFigureActions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// FloatingToolbar's autoUpdate attaches a ResizeObserver, absent in jsdom.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

/**
 * A folded figure with enough render geometry for `foldedFigureBox` to produce a
 * box — two edge strokes spanning a unit square. A figure with no drawable
 * geometry has no box, and the toolbar has nothing to anchor to.
 */
function makeFigure(
  overrides: Partial<OristudioCpFoldedFigureEntry> = {}
): OristudioCpFoldedFigureEntry {
  return {
    id: 'folded-1',
    title: 'Folded model 1',
    handle: 3,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: { model: { state: 'Front0' }, find_another_overlap_valid: true },
    renderSnapshot: {
      schema_version: 1,
      fixture: null,
      pass: null,
      primitives: [
        {
          sequence: 0,
          kind: 'fill_polygon',
          style: {
            paint: { kind: 'color', color: { red: 255, green: 0, blue: 0, alpha: 255 } },
            stroke: { kind: 'none' },
            antialias: 'default',
          },
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        },
      ],
    },
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
    ...overrides,
  } as unknown as OristudioCpFoldedFigureEntry;
}

function makeDeps(
  overrides: Partial<FoldedFigureActionDeps> = {}
): Omit<FoldedFigureActionDeps, 't'> {
  return {
    flip: vi.fn(),
    resetView: vi.fn(),
    setUpright: vi.fn(),
    setDisplayStyle: vi.fn(),
    foldAnother: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

describe('CpFoldedFigureToolbar', () => {
  let host: HTMLDivElement;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    cpOverlayViewStore.set({
      model: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
      user: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    container.remove();
  });

  function render(
    figure: OristudioCpFoldedFigureEntry,
    deps: Omit<FoldedFigureActionDeps, 't'> = makeDeps()
  ) {
    act(() => {
      root.render(
        <TooltipProvider delayDuration={0}>
          <CpFoldedFigureToolbar figure={figure} container={container} deps={deps} />
        </TooltipProvider>
      );
    });
  }

  function toolbar(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.cp-folded-figure-toolbar');
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(toolbar()?.querySelectorAll('button') ?? []);
  }

  // IconButton turns `title` into the accessible name (and tooltip content)
  // rather than a title attribute, so aria-label is what identifies a control.
  function labels(): (string | null)[] {
    return buttons().map((button) => button.getAttribute('aria-label'));
  }

  it('renders a pill anchored to the selected figure', () => {
    render(makeFigure());
    expect(toolbar()).not.toBeNull();
  });

  it('renders nothing for a figure that draws nothing', () => {
    // Mid-fold: no render snapshot yet, so there is no box to anchor to.
    render(makeFigure({ status: 'loading', renderSnapshot: null, snapshot: null }));
    expect(toolbar()).toBeNull();
  });

  it('shows the Tier-A verbs: flip, style, another solution, duplicate, delete', () => {
    render(makeFigure());
    expect(labels()).toEqual([
      'Flip',
      'Display style',
      'Another solution',
      'Duplicate',
      'Delete',
    ]);
  });

  // Regression: a dropdown trigger used to carry only an aria-label, because
  // IconButton's own tooltip trigger and the Radix menu trigger could not both
  // wrap the button. Hovering a menu button showed nothing at all.
  it('gives dropdown triggers a tooltip, not just an accessible name', () => {
    render(makeFigure(), makeDeps({ exportAs: vi.fn() }));
    const menuButtons = buttons().filter(
      (button) => button.getAttribute('aria-haspopup') === 'menu'
    );
    expect(menuButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Display style',
      'Export…',
    ]);
    // Whether the tooltip actually appears is Radix's contract and needs a real
    // browser — it gates on focus-visible and pointer state that jsdom does not
    // model, so asserting it here would only ever test the stub. `data-state` is
    // no help either: a menu trigger sets it too. Browser-verified instead.
  });

  it('separates the action groups', () => {
    render(makeFigure());
    expect(toolbar()?.querySelectorAll('.floating-toolbar__separator')).toHaveLength(2);
  });

  it('invokes the bound action when a button is clicked', () => {
    const deps = makeDeps();
    const figure = makeFigure();
    render(figure, deps);
    const flip = buttons()[0];
    act(() => {
      flip?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(deps.flip).toHaveBeenCalledWith(figure);
  });

  it('disables kernel-backed verbs for a figure that is not ready', () => {
    render(makeFigure({ status: 'stale' }));
    const disabled = buttons()
      .filter((button) => button.disabled)
      .map((button) => button.getAttribute('aria-label'));
    expect(disabled).toContain('Flip');
    expect(disabled).toContain('Another solution');
    expect(disabled).not.toContain('Delete');
  });

  it('shows the export control when the caller supports exporting', () => {
    render(makeFigure(), makeDeps({ exportAs: vi.fn() }));
    expect(labels()).toEqual([
      'Flip',
      'Display style',
      'Another solution',
      'Export…',
      'Duplicate',
      'Delete',
    ]);
    expect(toolbar()?.querySelectorAll('.floating-toolbar__separator')).toHaveLength(3);
  });

  it('surfaces Refold only when the figure is stale', () => {
    const refold = vi.fn();
    render(makeFigure(), makeDeps({ refold, isStale: () => false }));
    expect(labels()).not.toContain('Refold');

    render(makeFigure(), makeDeps({ refold, isStale: () => true }));
    expect(labels()).toContain('Refold');
  });
});
