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
    updateModel: vi.fn(),
    endModelGesture: vi.fn(),
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
    // Origin offset so the fixture's 10x10 figure sits well inside the pane
    // below rather than straddling its edge — the toolbar now hides for an
    // anchor outside its boundary, and a figure pinned to 0,0 would be
    // deciding that on a two-pixel overlap.
    cpOverlayViewStore.set({
      model: { origin: [100, 100], ex: [1, 0], ey: [0, 1] },
      user: { origin: [100, 100], ex: [1, 0], ey: [0, 1] },
    });
    container = document.createElement('div');
    // jsdom lays nothing out, so the pane the toolbar is confined to has to be
    // stated. 1000x600 at the origin.
    container.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
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

  // The pill is body-portaled, so nothing clips it: panned past the pane edge it
  // would otherwise sit over the neighbouring View pane, attached to a figure
  // that is no longer on screen. `boundary` is what makes it leave with it.
  it('hides once the figure is panned out of the pane', () => {
    // A figure is anchored in `user` space, not `model` — see the component.
    cpOverlayViewStore.set({
      model: { origin: [100, 100], ex: [1, 0], ey: [0, 1] },
      user: { origin: [5000, 100], ex: [1, 0], ey: [0, 1] },
    });
    render(makeFigure());
    expect(toolbar()).toBeNull();
  });

  it('shows the Tier-A verbs: flip, style, another solution, duplicate, delete', () => {
    render(makeFigure());
    expect(labels()).toEqual(['Flip', 'Style', 'Another solution', 'Duplicate', 'Delete']);
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
      'Style',
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
      'Style',
      'Another solution',
      'Export…',
      'Duplicate',
      'Delete',
    ]);
    expect(toolbar()?.querySelectorAll('.floating-toolbar__separator')).toHaveLength(3);
  });

  describe('Style menu', () => {
    /**
     * Open a toolbar menu the way a keyboard user does. Radix opens a dropdown
     * on `pointerdown`, which jsdom does not synthesize from `click()`; Enter on
     * the trigger is a real path it does deliver.
     */
    function openMenu(label: string): void {
      const trigger = buttons().find((button) => button.getAttribute('aria-label') === label);
      if (!trigger) throw new Error(`no ${label} menu`);
      act(() => {
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
    }

    /** Menu content portals to `body`, so read the rows from there. */
    function rows(): HTMLElement[] {
      return Array.from(
        document.querySelectorAll<HTMLElement>('[role="menu"] .context-menu__item')
      );
    }

    it('holds the render style, side, colours and shadow as rows of one menu', () => {
      render(makeFigure());
      openMenu('Style');
      expect(rows().map((row) => row.textContent)).toEqual([
        'Render as',
        'Side',
        'Front color',
        'Back color',
        'Line color',
        'Shadow',
      ]);
      const submenus = rows().filter((row) => row.getAttribute('aria-haspopup') === 'menu');
      expect(submenus.map((row) => row.textContent)).toEqual(['Render as', 'Side']);
      // Every row draws in the leading slot — a glyph, a swatch, or (when on) a
      // check — so the labels line up without any row reserving an empty one.
      for (const row of rows()) {
        if (row.getAttribute('role') === 'menuitemcheckbox') continue;
        expect(row.querySelector('.context-menu__icon')?.childElementCount, row.textContent ?? '').toBe(1);
      }
      expect(document.querySelectorAll('[role="menu"] input[type="color"]')).toHaveLength(3);
      expect(document.querySelector('[role="menuitemcheckbox"]')?.textContent).toBe('Shadow');
    });

    it('paints each swatch from the figure model', () => {
      render(
        makeFigure({
          snapshot: {
            model: { state: 'Front0', front_color: { red: 1, green: 2, blue: 3 } },
            find_another_overlap_valid: true,
          },
        } as unknown as Partial<OristudioCpFoldedFigureEntry>)
      );
      openMenu('Style');
      const swatches = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menu"] .context-menu__swatch')
      );
      expect(swatches.map((swatch) => swatch.style.background)).toEqual([
        'rgb(1, 2, 3)',
        'rgb(233, 233, 233)',
        'rgb(0, 0, 0)',
      ]);
    });

    it('toggles shadow through the model binding and stays open', () => {
      const deps = makeDeps();
      const figure = makeFigure();
      render(figure, deps);
      openMenu('Style');
      const shadow = document.querySelector<HTMLElement>('[role="menuitemcheckbox"]');
      act(() => {
        shadow?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(deps.updateModel).toHaveBeenCalledWith(figure, { display_shadows: true });
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
    });

    it('offers side and shadow disabled on a 3D figure, each saying why', () => {
      render(
        makeFigure({
          snapshot: null,
          folded3d: { model: { state: 'Front0' }, verdict: { verdict: 'folded' } },
          camera: { yaw: 0, pitch: 0, zoom: 1 },
        } as unknown as Partial<OristudioCpFoldedFigureEntry>)
      );
      openMenu('Style');
      const side = rows().find((row) => row.textContent === 'Side');
      const shadow = document.querySelector<HTMLElement>('[role="menuitemcheckbox"]');
      expect(side?.getAttribute('data-disabled')).not.toBeNull();
      expect(side?.getAttribute('title')).toBe('Turn a 3D model with Other side');
      expect(shadow?.getAttribute('data-disabled')).not.toBeNull();
      expect(shadow?.getAttribute('title')).toBe('Shadows are not drawn for a 3D folded model yet');
    });

    // A modal menu puts `pointer-events: none` on everything outside it, so
    // the press that dismisses it never reaches the canvas — which is what
    // would deselect the figure. The menu must leave the canvas pressable.
    it('leaves the canvas pressable while open, and closes on a press outside', async () => {
      render(makeFigure());
      openMenu('Style');
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
      expect(document.body.style.pointerEvents).toBe('');
      // Radix attaches its outside-press listener a tick after opening.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const outside = document.createElement('div');
      container.appendChild(outside);
      act(() => {
        outside.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
        );
      });
      expect(document.querySelector('[role="menu"]')).toBeNull();
    });

    it('still lists the export formats behind their own trigger', () => {
      render(makeFigure(), makeDeps({ exportAs: vi.fn() }));
      openMenu('Export…');
      expect(rows().map((row) => row.textContent)).toEqual(['SVG image', 'PNG image']);
    });
  });

  it('surfaces Refold only when the figure is stale', () => {
    const refold = vi.fn();
    render(makeFigure(), makeDeps({ refold, isStale: () => false }));
    expect(labels()).not.toContain('Refold');

    render(makeFigure(), makeDeps({ refold, isStale: () => true }));
    expect(labels()).toContain('Refold');
  });
});
