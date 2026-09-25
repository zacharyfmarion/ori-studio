import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/Tooltip';
import { PHONE_MEDIA_QUERY } from '../../platform/phoneLayout';
import {
  buildReferencesActions,
  referencesCommands,
  type ReferencesActionState,
} from './referencesActions';
import { ReferencesViewportToolbar } from './ReferencesViewportToolbar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The bar is the shared `ViewportToolbar`, whose collapsing and menu are its
 * own tests' subject. What this file pins is the References declaration: which
 * verbs are on the bar, that every one of them runs through the panel's one
 * executor, and that the set survives the touch layouts unchanged — there is
 * nothing here to collapse, so no `⋯` on any pointer.
 */

// The catalog only ever calls t(key, defaultValue); the default is the English UI.
const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

function stubLayoutApis() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('DOMRect', class {});
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

/** A tablet is a coarse pointer; a phone is that and a phone-sized viewport. */
function stubDevice(device: 'desktop' | 'tablet' | 'phone') {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        if (query === PHONE_MEDIA_QUERY) return device === 'phone';
        return query.includes('pointer: coarse') ? device !== 'desktop' : false;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const run = vi.fn();
const setZoomPercent = vi.fn();

function commandsFor(overrides: Partial<ReferencesActionState> = {}) {
  return referencesCommands(
    buildReferencesActions(
      {
        stepCount: 0,
        activeStep: 0,
        candidateCount: 0,
        activeCandidate: 0,
        wayCount: 0,
        activeWay: 0,
        canRecompute: true,
        hasView: true,
        fold: { available: true, playing: false, folded: false, pleat: false },
        ...overrides,
      },
      { t }
    )
  );
}

function render(overrides: Partial<ReferencesActionState> = {}) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <TooltipProvider>
        <ReferencesViewportToolbar
          zoomPercent={100}
          setZoomPercent={setZoomPercent}
          commands={commandsFor(overrides)}
          run={run}
        />
      </TooltipProvider>
    )
  );
}

const toolbar = () => container?.querySelector<HTMLElement>('.viewport-toolbar');
const button = (label: string) =>
  toolbar()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

/** Accessible names of the bar's own buttons. */
function inlineLabels(): string[] {
  return [...(toolbar()?.querySelectorAll('button') ?? [])].map(
    (element) => element.getAttribute('aria-label') ?? element.textContent ?? ''
  );
}

function press(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
    );
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  stubLayoutApis();
  stubDevice('desktop');
  run.mockClear();
  setZoomPercent.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const BAR = ['Zoom Out', '100%', 'Zoom In', 'Fit', 'Play Fold', 'Recompute References'];

describe('ReferencesViewportToolbar', () => {
  it('holds the zoom cluster, Fit and Recompute, and nothing to overflow', () => {
    render();

    expect(toolbar()?.getAttribute('aria-label')).toBe('References viewport controls');
    expect(inlineLabels()).toEqual(BAR);
    expect(button('More view controls')).toBeFalsy();
  });

  it('runs every verb through the panel executor, by registry id', () => {
    // The chord, the context-menu row and the button are then one path — what
    // the header buttons did before the bar, kept.
    render();

    press(button('Zoom In'));
    press(button('Zoom Out'));
    press(button('Fit'));
    press(button('Recompute References'));

    expect(run.mock.calls.map(([id]) => id)).toEqual([
      'references.zoomIn',
      'references.zoomOut',
      'references.resetView',
      'references.recompute',
    ]);
  });

  it('shows the fold verb as what pressing it does next: play, pause, or unfold', () => {
    render({ fold: { available: true, playing: true, folded: false, pleat: false } });
    expect(button('Pause Fold')).toBeTruthy();
    press(button('Pause Fold'));
    expect(run).toHaveBeenLastCalledWith('references.playFold');
    act(() => root?.unmount());
    render({ fold: { available: true, playing: false, folded: true, pleat: false } });
    expect(button('Unfold')).toBeTruthy();
    act(() => root?.unmount());
    render({ fold: { available: false, playing: false, folded: false, pleat: true } });
    expect(button('Play Fold')?.disabled).toBe(true);
  });

  it("takes Recompute's gating from the catalog", () => {
    // Decided once, for the bar, the context menu and the chord alike.
    render({ canRecompute: false });

    expect(button('Recompute References')?.disabled).toBe(true);
  });

  it('hands a zoom preset to the camera as a percentage', () => {
    // The readout's presets are the one control that is not a registry verb:
    // a chord cannot say "50%", so the camera's own setter takes it.
    render();

    press(toolbar()?.querySelector('.viewport-toolbar__zoom-button'));
    const preset = [...(toolbar()?.querySelectorAll('.viewport-toolbar__dropdown-item') ?? [])].find(
      (item) => item.textContent === '50%'
    );
    press(preset);

    expect(setZoomPercent).toHaveBeenCalledWith(50);
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps the whole set inline on a tablet', () => {
    // Zoom and Fit are pinned by the bar; Recompute is pinned here, because a
    // `⋯` with one row in it is a worse control than the button.
    stubDevice('tablet');

    render();

    expect(inlineLabels()).toEqual(BAR);
    expect(button('More view controls')).toBeFalsy();
  });

  it('keeps the whole set inline on a phone, ending with the step navigation', () => {
    // The Edit bar hands its phone strip over to the favourite tools and drops
    // the zoom buttons for a pinch; this surface has nothing better to put
    // there, so the view controls stay — and Previous and Next step come
    // last, at the thumb's end, taken off the filmstrip, where two touch
    // targets either side of the cards left a 375px strip room for barely one.
    stubDevice('phone');

    render({ stepCount: 3, activeStep: 1 });

    expect(inlineLabels()).toEqual([...BAR, 'Previous Step', 'Next Step']);
    expect(button('More view controls')).toBeFalsy();
    press(button('Next Step'));
    expect(run).toHaveBeenLastCalledWith('references.nextStep');
  });

  it('leaves the stepping to the filmstrip everywhere but the phone', () => {
    stubDevice('tablet');

    render({ stepCount: 3, activeStep: 1 });

    expect(inlineLabels()).toEqual(BAR);
  });
});
