import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point } from '../../lib/geometry';
import { COARSE_POINTER_QUERY } from '../../platform/pointerSurface';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import type { UserBounds } from '../renderer/camera';
import type { ReglRendererOptions } from '../renderer/reglRenderer';
import {
  CP_LINE_HIT_MIN_CSS,
  CP_LINE_HIT_MIN_CSS_COARSE,
  CP_POINT_HIT_MIN_CSS,
  CP_POINT_HIT_MIN_CSS_COARSE,
} from '../snapRadius';
import type { CpSurface, CpSurfaceHitRadii, UseCpSurfaceOptions } from './useCpSurface';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The renderer is stubbed whole: this file is about the surface's lifecycle,
 * camera and press, which `ReferencesCpView.test.tsx` covers only through what
 * one user draws. The stub keeps each construction's options so a test can
 * lose and restore the context it was built on.
 */
const regl = vi.hoisted(() => ({
  built: [] as ReglRendererOptions[],
  fail: null as Error | null,
  dispose: vi.fn(),
}));
vi.mock('../renderer/reglRenderer', () => ({
  createReglRenderer: (_canvas: HTMLCanvasElement, options: ReglRendererOptions = {}) => {
    if (regl.fail) throw regl.fail;
    regl.built.push(options);
    return new Proxy(
      {},
      { get: (_target, key) => (key === 'dispose' ? regl.dispose : () => undefined) }
    );
  },
}));
const monitoring = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('../../monitoring', () => monitoring);

const { useCpSurface } = await import('./useCpSurface');

const VIEWPORT = { left: 0, top: 0, width: 400, height: 400 };
/** Model space is user space here, so a press lands where the camera says. */
const IDENTITY = (point: Point): Point => point;
const BOUNDS: UserBounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };

/** What the harness last rendered, written from an effect rather than during render. */
const seen: { surface: CpSurface<number> | null } = { surface: null };

function Harness(props: Partial<UseCpSurfaceOptions<number>>) {
  const surface = useCpSurface<number>({
    modelToSvg: IDENTITY,
    contentBounds: BOUNDS,
    framingKey: 'doc-1',
    wheelGesture: 'zoom',
    // Tiny, so the pointer-precision floors decide the hit radii.
    snapRadius: 0.01,
    hitTest: () => null,
    sameHit: (a, b) => a === b,
    onPick: () => undefined,
    strokeWidths: ({ ratio }) => ({ strokeWidthPx: ratio }),
    errorSurface: 'test:webgl',
    ...props,
  });
  const { canvasRef } = surface;
  useEffect(() => {
    seen.surface = surface;
  });
  return <canvas ref={canvasRef} />;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function stubWebgl({ lost = false } = {}): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    getExtension: () => ({ loseContext: () => {} }),
    isContextLost: () => lost,
  } as unknown as RenderingContext);
}

function mount(props: Partial<UseCpSurfaceOptions<number>> = {}): HTMLCanvasElement {
  act(() => root?.render(<Harness {...props} />));
  const canvas = container?.querySelector('canvas') ?? null;
  if (!canvas) throw new Error('no canvas');
  return canvas;
}

function surface(): CpSurface<number> {
  if (!seen.surface) throw new Error('not mounted');
  return seen.surface;
}

function click(canvas: HTMLCanvasElement, clientX: number, clientY: number): void {
  const init = { pointerId: 1, pointerType: 'mouse', button: 0, clientX, clientY };
  act(() => {
    canvas.dispatchEvent(new PointerEvent('pointerdown', init));
    canvas.dispatchEvent(new PointerEvent('pointerup', init));
  });
}

beforeEach(() => {
  vi.stubGlobal('devicePixelRatio', 1);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...VIEWPORT,
    right: VIEWPORT.width,
    bottom: VIEWPORT.height,
    x: VIEWPORT.left,
    y: VIEWPORT.top,
    toJSON: () => ({}),
  } as DOMRect);
  // jsdom implements neither; the surface only needs them not to throw.
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  seen.surface = null;
  regl.built.length = 0;
  regl.fail = null;
  regl.dispose.mockClear();
  monitoring.reportError.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useCpSurface camera', () => {
  beforeEach(() => stubWebgl());

  it('fits on mount, keeps a zoom across re-renders, and refits on a new framing key', () => {
    const onZoomPercentChange = vi.fn<(percent: number) => void>();
    mount({ onZoomPercentChange });
    expect(onZoomPercentChange).toHaveBeenCalledTimes(1);
    const fit = onZoomPercentChange.mock.calls[0][0];

    act(() => surface().controls.zoomIn());
    const zoomed = onZoomPercentChange.mock.calls.at(-1)?.[0];
    expect(zoomed).toBe(Math.round((surface().cssPerUserUnit() ?? 0) * 100));
    expect(zoomed).toBeGreaterThan(fit);

    // The same document again — an edit, say — is not a reason to move.
    mount({ onZoomPercentChange });
    expect(onZoomPercentChange).toHaveBeenCalledTimes(2);

    mount({ onZoomPercentChange, framingKey: 'doc-2' });
    expect(onZoomPercentChange).toHaveBeenLastCalledWith(fit);
  });

  it('reports the view once per camera move, not once per redraw', () => {
    const onViewChange = vi.fn();
    mount({ onViewChange });
    expect(onViewChange).toHaveBeenCalledTimes(1);
    act(() => surface().render());
    expect(onViewChange).toHaveBeenCalledTimes(1);
    act(() => surface().controls.zoomOut());
    expect(onViewChange).toHaveBeenCalledTimes(2);
  });

  it('fits above an inset, follows it while the camera is the fit’s, and leaves a camera the user moved', () => {
    const onViewChange = vi.fn<(view: CpOverlayView) => void>();
    // A square sheet, so the height the inset takes is what the fit is limited by.
    const contentBounds: UserBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    // Where the content's middle (50, 50) lands on the 400 × 400 canvas, CSS px.
    const middle = () => {
      const view = onViewChange.mock.calls.at(-1)?.[0];
      if (!view) throw new Error('no view');
      return { x: view.origin[0] + 50 * view.ex[0], y: view.origin[1] + 50 * view.ey[1] };
    };
    const covered = { top: 0, right: 0, bottom: 200, left: 0 };
    mount({ onViewChange, contentBounds, inset: covered });
    // Fitted to the top 400 × 200 and centred on it, not on the canvas.
    expect(middle().x).toBeCloseTo(200);
    expect(middle().y).toBeCloseTo(100);
    expect(surface().cssPerUserUnit()).toBeCloseTo((200 / 100) * 0.7);

    // The window closes: the fit follows, to the whole canvas.
    mount({ onViewChange, contentBounds, inset: null });
    expect(middle().y).toBeCloseTo(200);
    expect(surface().cssPerUserUnit()).toBeCloseTo((400 / 100) * 0.7);

    // Once the user has zoomed, a window opening moves nothing.
    act(() => surface().controls.zoomIn());
    const zoomed = surface().cssPerUserUnit();
    mount({ onViewChange, contentBounds, inset: covered });
    expect(surface().cssPerUserUnit()).toBe(zoomed);
    expect(middle().y).toBeCloseTo(200);
    // Fit asks again, within the inset.
    act(() => surface().controls.fit());
    expect(middle().y).toBeCloseTo(100);
  });

  it('keeps content that changes in kind in view: a camera at its fit refits once the new content leaves it', () => {
    const zoom = () => surface().cssPerUserUnit();
    const square: UserBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    mount({ contentBounds: square, keepInViewKey: 'step-1' });
    const fitted = zoom();
    // Fitted to 0…100 with the fit's padding: user x −21.4…121.4 shows.
    expect(fitted).toBeCloseTo((400 / 100) * 0.7);

    // Other content, still in what shows: nothing moves.
    mount({ contentBounds: { minX: -10, minY: 0, maxX: 110, maxY: 100 }, keepInViewKey: 'step-2' });
    expect(zoom()).toBe(fitted);

    // Content that runs off the left edge: the camera fits it.
    const wide: UserBounds = { minX: -150, minY: 0, maxX: 100, maxY: 100 };
    mount({ contentBounds: wide, keepInViewKey: 'step-3' });
    expect(zoom()).toBeCloseTo((400 / 250) * 0.7);

    // The same content's bounds changing — not a change in kind — moves nothing.
    const refitted = zoom();
    mount({ contentBounds: { minX: -400, minY: 0, maxX: 100, maxY: 100 }, keepInViewKey: 'step-3' });
    expect(zoom()).toBe(refitted);

    // Once the user has zoomed, their view stays while the new content mostly shows in it —
    // x −168…118, y −93…193 shows now — even with a sliver of it off the edge.
    act(() => surface().controls.zoomIn());
    const theirs = zoom();
    mount({ contentBounds: { minX: 0, minY: -100, maxX: 100, maxY: 100 }, keepInViewKey: 'step-4' });
    expect(zoom()).toBe(theirs);

    // Content that would arrive mostly off screen is fitted, however the user left the camera.
    mount({ contentBounds: { minX: 300, minY: 0, maxX: 400, maxY: 100 }, keepInViewKey: 'step-5' });
    expect(zoom()).toBeCloseTo((400 / 100) * 0.7);

    // Fit hands the camera back: the next content that leaves the view is fitted again.
    act(() => surface().controls.fit());
    mount({ contentBounds: { minX: 0, minY: 0, maxX: 600, maxY: 100 }, keepInViewKey: 'step-6' });
    expect(zoom()).toBeCloseTo((400 / 600) * 0.7);
  });

  it('keeps a view zoomed in on part of the content, and judges a moved camera by the content’s own extent', () => {
    const zoom = () => surface().cssPerUserUnit();
    const square: UserBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    mount({ contentBounds: square, keepInViewKey: 'step-1' });
    // Zoomed far in on the square's middle: it fills the screen, so a new step keeps the view.
    for (let press = 0; press < 6; press += 1) act(() => surface().controls.zoomIn());
    const close = zoom();
    mount({ contentBounds: square, keepInViewKey: 'step-2' });
    expect(zoom()).toBe(close);

    // A frame that still covers the view, round content that has gone: what must show is the content.
    mount({
      contentBounds: { minX: -100, minY: -100, maxX: 1000, maxY: 200 },
      keepInViewBounds: { minX: 800, minY: 0, maxX: 1000, maxY: 100 },
      keepInViewKey: 'step-3',
    });
    expect(zoom()).toBeCloseTo((400 / 1100) * 0.7);
  });

  it('keeps nothing in view without a key, as before', () => {
    const square: UserBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    mount({ contentBounds: square });
    const fitted = surface().cssPerUserUnit();
    mount({ contentBounds: { minX: -150, minY: 0, maxX: 100, maxY: 100 } });
    expect(surface().cssPerUserUnit()).toBe(fitted);
  });

  it('sets a zoom percentage about the centre', () => {
    const onZoomPercentChange = vi.fn<(percent: number) => void>();
    mount({ onZoomPercentChange });
    act(() => surface().controls.setZoomPercent(250));
    expect(onZoomPercentChange).toHaveBeenLastCalledWith(250);
    expect(surface().cssPerUserUnit()).toBeCloseTo(2.5, 6);
  });
});

/**
 * The canvas's box, as layout gives it, and the observer that reports it:
 * jsdom has neither, so a test lays the canvas out and resizes it by hand.
 */
function layOut(initial: { width: number; height: number }) {
  const box = { ...initial };
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
  const observers: (() => void)[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  return {
    /** The canvas gets a new box, and the observer says so — or, `quiet`, has yet to. */
    resize(width: number, height: number, quiet = false) {
      box.width = width;
      box.height = height;
      if (!quiet) act(() => observers.forEach((notify) => notify()));
    },
  };
}

describe('useCpSurface opening fit', () => {
  beforeEach(() => stubWebgl());

  // The fit of the whole content to a 400 × 400 canvas, in percent.
  const FIT_400 = Math.round((400 / 200) * 0.7 * 100);

  it('fits to the box the canvas has at mount', () => {
    layOut({ width: 400, height: 400 });
    const onZoomPercentChange = vi.fn<(percent: number) => void>();
    mount({ onZoomPercentChange });
    expect(onZoomPercentChange).toHaveBeenLastCalledWith(FIT_400);
  });

  it('takes no fit while the canvas has no box, and fits once it has one', () => {
    // A dock not laid out yet, or a page in a hidden tab: the canvas is in
    // the document with nothing to draw in, and its content already known.
    const layout = layOut({ width: 400, height: 0 });
    const onZoomPercentChange = vi.fn<(percent: number) => void>();
    mount({ onZoomPercentChange });
    expect(surface().cssPerUserUnit()).toBeNull();
    expect(onZoomPercentChange).not.toHaveBeenCalled();

    layout.resize(400, 400);
    expect(onZoomPercentChange).toHaveBeenLastCalledWith(FIT_400);
    expect(surface().cssPerUserUnit()).toBeCloseTo((400 / 200) * 0.7);
  });

  it('fits a new inset to the box the canvas has now, before its observer has said', () => {
    // A phone's pane squeezed under a bar, then given back its height in the
    // same commit as a window comes back over its bottom half.
    const layout = layOut({ width: 400, height: 100 });
    mount({ inset: null });
    layout.resize(400, 400, true);
    mount({ inset: { top: 0, right: 0, bottom: 200, left: 0 } });
    // Fitted to the 400 × 200 left above the window (the 200 × 100 sheet's
    // height decides), not to the old 400 × 100 box the window covers whole.
    expect(surface().cssPerUserUnit()).toBeCloseTo((200 / 100) * 0.7);
  });

  it('fits content that arrives before the box once the box does', () => {
    const layout = layOut({ width: 0, height: 0 });
    const onZoomPercentChange = vi.fn<(percent: number) => void>();
    mount({ onZoomPercentChange, contentBounds: null, framingKey: 'none' });
    // The sheet comes in while the dock is still unsized.
    mount({ onZoomPercentChange, framingKey: 'doc-1' });
    expect(onZoomPercentChange).not.toHaveBeenCalled();

    layout.resize(400, 400);
    expect(onZoomPercentChange).toHaveBeenLastCalledWith(FIT_400);
  });

  it('keeps the camera it has while the box is gone, and takes a refit asked for then once the box is back', () => {
    const layout = layOut({ width: 400, height: 400 });
    const onZoomPercentChange = vi.fn<(percent: number) => void>();
    mount({ onZoomPercentChange });
    act(() => surface().controls.zoomIn());
    const zoomed = surface().cssPerUserUnit();

    // The pane is hidden, and a new document comes in meanwhile.
    layout.resize(400, 0);
    mount({ onZoomPercentChange, framingKey: 'doc-2' });
    expect(surface().cssPerUserUnit()).toBe(zoomed);

    layout.resize(400, 400);
    expect(onZoomPercentChange).toHaveBeenLastCalledWith(FIT_400);
  });
});

describe('useCpSurface press', () => {
  beforeEach(() => stubWebgl());

  function radiiOfAClick(): { point: Point; radii: CpSurfaceHitRadii } {
    const hitTest = vi.fn<(point: Point, radii: CpSurfaceHitRadii) => number | null>(() => 7);
    const onPick = vi.fn<(hit: number | null) => void>();
    const canvas = mount({ hitTest, onPick });
    click(canvas, VIEWPORT.width / 2, VIEWPORT.height / 2);
    expect(onPick).toHaveBeenCalledWith(7);
    const [point, radii] = hitTest.mock.calls.at(-1) ?? [];
    if (!point || !radii) throw new Error('no hit test');
    return { point, radii };
  }

  it('asks the caller what a click took, at the model point under it', () => {
    const { point } = radiiOfAClick();
    // The fit camera centres the content.
    expect(point.x).toBeCloseTo(100, 6);
    expect(point.y).toBeCloseTo(50, 6);
  });

  it('widens the hit floors to a fingertip under a coarse pointer', () => {
    const fine = radiiOfAClick().radii;
    act(() => root?.unmount());
    root = container ? createRoot(container) : null;
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === COARSE_POINTER_QUERY,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const coarse = radiiOfAClick().radii;
    expect(coarse.point / fine.point).toBeCloseTo(
      CP_POINT_HIT_MIN_CSS_COARSE / CP_POINT_HIT_MIN_CSS,
      6
    );
    expect(coarse.line / fine.line).toBeCloseTo(
      CP_LINE_HIT_MIN_CSS_COARSE / CP_LINE_HIT_MIN_CSS,
      6
    );
  });
});

describe('useCpSurface renderer lifecycle', () => {
  it('keeps the camera across a lost context and rebuilds the renderer on restore', () => {
    stubWebgl();
    mount();
    act(() => surface().controls.zoomIn());
    const zoomed = surface().cssPerUserUnit();

    act(() => regl.built[0].onContextLost?.());
    expect(surface().rendererStatus).toEqual({ kind: 'context-lost' });

    act(() => regl.built[0].onContextRestored?.());
    expect(regl.dispose).toHaveBeenCalledTimes(1);
    expect(regl.built).toHaveLength(2);
    expect(surface().rendererGeneration).toBe(1);
    expect(surface().rendererStatus).toBeNull();
    expect(surface().rendererRef.current).not.toBeNull();
    expect(surface().cssPerUserUnit()).toBe(zoomed);
  });

  it('reports a renderer that fails to start under the caller’s surface tag', () => {
    stubWebgl();
    const error = new Error('shader did not compile');
    regl.fail = error;
    mount();
    expect(monitoring.reportError).toHaveBeenCalledWith(error, {
      surface: 'test:webgl',
      tags: { webgl_gap: 'unclassified' },
    });
    expect(surface().rendererStatus).toEqual({
      kind: 'unsupported',
      detail: 'shader did not compile',
    });
  });

  it('waits out a context lost at start without reporting it', () => {
    stubWebgl({ lost: true });
    regl.fail = new Error('missing extension');
    const canvas = mount();
    expect(surface().rendererStatus).toEqual({ kind: 'context-lost' });
    expect(monitoring.reportError).not.toHaveBeenCalled();

    regl.fail = null;
    act(() => {
      canvas.dispatchEvent(new Event('webglcontextrestored'));
    });
    expect(regl.built).toHaveLength(1);
    expect(surface().rendererStatus).toBeNull();
  });
});
