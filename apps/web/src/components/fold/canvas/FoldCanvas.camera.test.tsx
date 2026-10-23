import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The opening camera of both Fold panes, through the real canvas and the real
 * surface, with the renderer stubbed to record each pane's last frame (its
 * `userScalePx` is the camera's zoom) and the layout jsdom lacks laid on by
 * hand: the panes' box, and the observer that reports it.
 *
 * Kept apart from `FoldCanvas.test.tsx`, which runs with no WebGL: a probe
 * that once answers "supported" is cached for the module graph.
 */
const session = vi.hoisted(() => {
  const node = {
    status: 'landed' as string,
    path: null,
    state: null,
    fingerprint: null,
    summary: null as unknown,
    report: null,
    refusal: null,
  };
  const unavailable = () => Promise.resolve({ status: 'unavailable', reason: 'no-state' });
  const surface = {
    cursor: node,
    cursorId: null,
    readOnly: false,
    pending: { status: 'idle' as const },
    analysis: { status: 'idle' as const },
    error: null,
    analyse: unavailable,
    preview: unavailable,
    commitStep: unavailable,
    cancel: () => undefined,
    withState: unavailable,
    withNode: unavailable,
    withCursor: unavailable,
    query: unavailable,
    peek: () => null,
    resolveOrders: unavailable,
    axiomRoots: unavailable,
    retry: () => undefined,
  };
  const snapshot = { readOnly: false, cursor: null, sequence: null, sheet: node, nodes: new Map(), activePath: [], pending: { status: 'idle' as const } };
  return { node, surface, snapshot };
});

vi.mock('../../../fold/session/useFoldSession', () => ({
  useFoldSession: () => session.surface,
  useFoldSessionState: (selector: (snapshot: unknown) => unknown) => selector(session.snapshot),
  useFoldCursor: () => session.node,
  useFoldNode: () => null,
  useFoldNodeQuery: () => null,
  useFoldStateQuery: () => null,
}));

/** Each pane's last frame, by its canvas. */
const frames = vi.hoisted(() => new Map<HTMLCanvasElement, { userScalePx: number }>());
vi.mock('../../../cp-workspace/renderer/reglRenderer', () => ({
  createReglRenderer: (canvas: HTMLCanvasElement) =>
    new Proxy(
      {},
      {
        get: (_target, key) =>
          key === 'render' ? (frame: { userScalePx: number }) => frames.set(canvas, frame) : () => undefined,
      }
    ),
}));

import { FOLD_USER_PER_UNIT } from '../../../fold/canvas/foldCanvasGeometry';
import { resetFoldPaneDisplay } from '../../../fold/canvas/foldPaneDisplay';
import { TooltipProvider } from '../../ui/Tooltip';
import { FoldCanvas } from './FoldCanvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The unit square, as the engine's summary gives the flat sheet. */
const SHEET_SUMMARY = {
  step: 0,
  faces: 1,
  pairs: 0,
  creases: { border: 4, mountain: 0, valley: 0, flat: 0 },
  view: { flipped: false, view_transform: [1, 0, 0, 1, 0, 0] },
  residual: 0,
  sheet: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
};

/** Each pane's box: the canvas fills it. */
const PANE = { width: 300, height: 500 };
/** The fit of the sheet to a pane that size: its width decides, with the fit's padding. */
const FIT = (PANE.width / FOLD_USER_PER_UNIT) * 0.7;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const box = { width: 0, height: 0 };
const observers: (() => void)[] = [];

function render(): void {
  act(() =>
    root?.render(
      <TooltipProvider delayDuration={0}>
        <FoldCanvas />
      </TooltipProvider>
    )
  );
}

function mount(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  render();
}

/** The dock lays the panes out, and their observers say so. */
function layOut(width: number, height: number): void {
  box.width = width;
  box.height = height;
  act(() => observers.forEach((notify) => notify()));
}

/** Each pane's zoom, CSS px per user unit, from its last frame; null for a pane that has drawn nothing. */
function zooms(): { folded: number | null; creases: number | null } {
  const zoomOf = (pane: string) => {
    const canvas = host?.querySelector<HTMLCanvasElement>(`[data-testid="fold-${pane}-canvas"]`) ?? null;
    return canvas ? (frames.get(canvas)?.userScalePx ?? null) : null;
  };
  return { folded: zoomOf('folded'), creases: zoomOf('crease-pattern') };
}

/** The bar's readout: the folded pane's zoom. */
function readout(): string | null {
  const bar = host?.querySelector('[aria-label="Fold view"]');
  return bar?.textContent?.match(/(\d+)%/)?.[1] ?? null;
}

beforeEach(() => {
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    getExtension: () => ({ loseContext: () => {} }),
    isContextLost: () => false,
  } as unknown as RenderingContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        left: 0,
        top: 0,
        x: 0,
        y: 0,
        width: box.width,
        height: box.height,
        right: box.width,
        bottom: box.height,
        toJSON: () => ({}),
      }) as DOMRect
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  observers.length = 0;
  frames.clear();
  box.width = 0;
  box.height = 0;
  session.node.summary = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetFoldPaneDisplay();
});

describe('the Fold panes’ opening camera', () => {
  it('fits the sheet in both panes on a fresh open: the dock laid out, the sheet in after the panes mount', () => {
    box.width = PANE.width;
    box.height = PANE.height;
    mount();
    // Nothing to frame until the engine's summary is in.
    expect(zooms()).toEqual({ folded: null, creases: null });

    session.node.summary = SHEET_SUMMARY;
    render();
    expect(zooms().folded).toBeCloseTo(FIT);
    expect(zooms().creases).toBeCloseTo(FIT);
    expect(readout()).toBe(String(Math.round(FIT * 100)));
  });

  it('fits the sheet in both panes when they mount before the dock is sized: a reload over a saved layout, a hidden tab', () => {
    // The sheet is already in hand (the session outlives the panel), and the
    // dock restored from its saved layout has not been laid out yet.
    session.node.summary = SHEET_SUMMARY;
    box.width = PANE.width;
    box.height = 0;
    mount();
    // No fit to a canvas with nothing to draw in: it would be a dot at 0%.
    expect(zooms()).toEqual({ folded: null, creases: null });

    layOut(PANE.width, PANE.height);
    expect(zooms().folded).toBeCloseTo(FIT);
    expect(zooms().creases).toBeCloseTo(FIT);
    expect(readout()).toBe(String(Math.round(FIT * 100)));
  });

  it('fits a sheet that comes in while the dock is still unsized once the dock is laid out', () => {
    mount();
    session.node.summary = SHEET_SUMMARY;
    render();
    expect(zooms()).toEqual({ folded: null, creases: null });

    layOut(PANE.width, PANE.height);
    expect(zooms().folded).toBeCloseTo(FIT);
    expect(zooms().creases).toBeCloseTo(FIT);
  });
});
