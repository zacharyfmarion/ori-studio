import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { vertexPointsFromTransport } from '../../engine/oristudioCpGeometry';
import { cpModelToSvg } from '../../lib/creasePatternViewport';
import { fitUserCamera, modelViewFromCamera, projectModelPoint } from '../renderer/camera';
import { transportUserBounds, type ReferencesPick } from './referencesViewGeometry';
import type { ReferencesCpViewHandle, ReferencesCpViewProps } from './ReferencesCpView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The renderer is stubbed whole: this file is about what the view does with a
 * press and what it shows when it cannot draw, and nothing below `CpRenderer`
 * bears on either. The stub records the uploads so a test can see that the
 * highlight props reach the renderer's channels.
 */
const uploads = vi.hoisted(() => ({
  setStrokes: vi.fn(),
  setPreview: vi.fn(),
  setOverlayPoints: vi.fn(),
  setPoints: vi.fn(),
  render: vi.fn(),
}));
vi.mock('../renderer/reglRenderer', () => ({
  createReglRenderer: () =>
    new Proxy(
      {},
      {
        get: (_target, key) =>
          key in uploads ? uploads[key as keyof typeof uploads] : () => undefined,
      }
    ) as unknown as ReturnType<typeof import('../renderer/reglRenderer').createReglRenderer>,
}));

const { ReferencesCpView } = await import('./ReferencesCpView');

const VIEWPORT = { left: 0, top: 0, width: 400, height: 400 };

// A horizontal crease (id 1) from (0, 50) to (200, 50) and a vertical one
// (id 2) from (100, 0) ending on it at (100, 50) — a vertex, since the vertical
// crease's endpoint sits on the horizontal one.
const GEOMETRY = {
  segEndpoints: Float64Array.from([0, 50, 200, 50, 100, 0, 100, 50]),
  segAttr: new Int32Array(10),
} as unknown as CpGeometryTransport;

/**
 * Where a model point lands on screen under the camera the view fits on mount
 * (`fitUserCamera` over the transport's bounds), so presses can be aimed.
 */
function clientOf(x: number, y: number): { clientX: number; clientY: number } {
  const viewport = { width: VIEWPORT.width, height: VIEWPORT.height, dpr: 1 };
  const bounds = transportUserBounds(GEOMETRY);
  if (!bounds) throw new Error('empty geometry');
  const camera = fitUserCamera(bounds, viewport);
  const view = modelViewFromCamera(camera, viewport, cpModelToSvg);
  const device = projectModelPoint(view, x, y);
  return { clientX: device.x, clientY: device.y };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function stubWebgl(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    getExtension: () => ({ loseContext: () => {} }),
  } as unknown as RenderingContext);
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
  // jsdom implements neither; the view only needs them not to throw.
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
  uploads.setStrokes.mockClear();
  uploads.setPreview.mockClear();
  uploads.setOverlayPoints.mockClear();
  uploads.setPoints.mockClear();
  uploads.render.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function props(overrides: Partial<ReferencesCpViewProps> = {}): ReferencesCpViewProps {
  return {
    geometry: GEOMETRY,
    lineStyle: 'color',
    mode: 'mvf',
    lineWidth: 1,
    pointSize: 1,
    wheelGesture: 'zoom',
    highlightVertexIdx: new Set(),
    selected: null,
    onPick: () => undefined,
    framingKey: 'doc-1',
    ariaLabel: 'Crease pattern',
    ...overrides,
  };
}

function mount(
  overrides: Partial<ReferencesCpViewProps> = {},
  ref?: React.RefObject<ReferencesCpViewHandle | null>
): HTMLCanvasElement {
  act(() => root?.render(<ReferencesCpView ref={ref} {...props(overrides)} />));
  const canvas = container?.querySelector('canvas');
  if (!canvas) throw new Error('no canvas');
  return canvas;
}

function pointer(type: string, point: { clientX: number; clientY: number }, pointerId = 1) {
  return new PointerEvent(type, {
    pointerId,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    bubbles: true,
    ...point,
  });
}

function click(canvas: HTMLCanvasElement, point: { clientX: number; clientY: number }): void {
  act(() => {
    canvas.dispatchEvent(pointer('pointerdown', point));
    canvas.dispatchEvent(pointer('pointerup', point));
  });
}

describe('ReferencesCpView without WebGL', () => {
  it('renders the unavailable state instead of a blank canvas', () => {
    // jsdom's `getContext` returns null, which is exactly the probe's "no".
    mount();
    const status = container?.querySelector('[role="status"]');
    expect(status?.textContent).toContain('The crease-pattern canvas could not start.');
  });
});

describe('ReferencesCpView picking', () => {
  beforeEach(stubWebgl);

  /**
   * The cursor has to say a click will do something. Hover is coalesced to a
   * frame, so these drive `requestAnimationFrame` synchronously rather than
   * waiting on jsdom's ~16 ms timer.
   */
  function hover(canvas: HTMLCanvasElement, point: { clientX: number; clientY: number }): void {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    act(() => {
      canvas.dispatchEvent(pointer('pointermove', point));
    });
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
  }

  it('shows a pointer cursor over a crease and over a vertex, and grab over bare paper', () => {
    const canvas = mount();
    expect(canvas.style.cursor).toBe('');

    hover(canvas, clientOf(100, 50));
    expect(canvas.style.cursor).toBe('pointer');

    hover(canvas, clientOf(40, 50));
    expect(canvas.style.cursor).toBe('pointer');

    // Far from both creases: back to the resting grab, which is the CSS default
    // and so is spelled by *not* setting an inline cursor.
    hover(canvas, clientOf(180, 10));
    expect(canvas.style.cursor).toBe('');
  });

  it('marks the crease under the pointer on the preview channel, in the pick accent', () => {
    const canvas = mount();
    uploads.setPreview.mockClear();

    hover(canvas, clientOf(150, 50));
    const preview = uploads.setPreview.mock.calls.at(-1)?.[0];
    expect(preview?.count).toBe(1);
    // Crease 1, from (0, 50) to (200, 50), translucent and at the picked width.
    expect([...preview.a, ...preview.b]).toEqual([0, 50, 200, 50]);
    expect(preview.color[3]).toBeGreaterThan(0);
    expect(preview.color[3]).toBeLessThan(1);
    expect(preview.widthMul[0]).toBeGreaterThan(1);
    expect(preview.dashSlot?.[0]).toBe(0);

    // Off the pattern, the mark goes with it.
    hover(canvas, clientOf(180, 10));
    expect(uploads.setPreview.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('rings the vertex under the pointer on the overlay channel, and not the picked one', () => {
    const canvas = mount();
    uploads.setOverlayPoints.mockClear();

    hover(canvas, clientOf(100, 50));
    const overlay = uploads.setOverlayPoints.mock.calls.at(-1)?.[0];
    expect(overlay?.count).toBe(1);
    expect([overlay.center[0], overlay.center[1]]).toEqual([100, 50]);
    // A ring: a wider mark than the dot, filled faintly, outlined in full.
    expect(overlay.radius[0]).toBeGreaterThan(1);
    expect(overlay.fill[3]).toBeLessThan(overlay.stroke[3]);

    // Already picked: it is drawn as picked, and the hover adds nothing.
    const idx = vertexPointsFromTransport(GEOMETRY).findIndex((p) => p.x === 100 && p.y === 50);
    act(() => root?.render(<ReferencesCpView {...props({ selected: { kind: 'vertex', idx } })} />));
    hover(canvas, clientOf(100, 50));
    const picked = uploads.setOverlayPoints.mock.calls.at(-1)?.[0];
    expect(picked?.count).toBe(1);
    expect(picked.radius[0]).toBeLessThan(overlay.radius[0]);
  });

  it('draws the hovered crease with the step’s own lines, not instead of them', () => {
    const strokes = {
      a: new Float32Array([0, 0]),
      b: new Float32Array([10, 10]),
      color: new Float32Array([0, 0, 0, 1]),
      widthMul: new Float32Array([1]),
      dashSlot: new Float32Array([1]),
      count: 1,
      dashPatterns: [[4, 2]],
    };
    const canvas = mount({ diagramStrokes: strokes });
    hover(canvas, clientOf(150, 50));
    const preview = uploads.setPreview.mock.calls.at(-1)?.[0];
    expect(preview?.count).toBe(2);
    expect(preview.dashPatterns).toEqual([[4, 2]]);
    expect([...preview.dashSlot]).toEqual([1, 0]);
  });

  it('shows grabbing while a drag is in progress, whatever is under the pointer', () => {
    const canvas = mount();
    hover(canvas, clientOf(100, 50));
    expect(canvas.style.cursor).toBe('pointer');
    act(() => {
      canvas.dispatchEvent(pointer('pointerdown', clientOf(100, 50)));
    });
    expect(canvas.style.cursor).toBe('grabbing');
    act(() => {
      canvas.dispatchEvent(pointer('pointerup', clientOf(100, 50)));
    });
    expect(canvas.style.cursor).not.toBe('grabbing');
  });

  it('never carries the editor canvas class that floating toolbars forward wheel events to', () => {
    const canvas = mount();
    expect(canvas.classList.contains('cp-webgl-layer')).toBe(false);
    expect(canvas.getAttribute('aria-label')).toBe('Crease pattern');
  });

  it('picks the vertex before the two creases meeting at it', () => {
    const onPick = vi.fn<(hit: ReferencesPick | null) => void>();
    const canvas = mount({ onPick });
    click(canvas, clientOf(100, 50));
    expect(onPick).toHaveBeenCalledTimes(1);
    // (100, 50) is the fourth distinct endpoint in transport order.
    expect(onPick).toHaveBeenCalledWith({ kind: 'vertex', idx: 3, point: { x: 100, y: 50 } });
  });

  it('picks a crease by its 1-based id away from its vertices', () => {
    const onPick = vi.fn<(hit: ReferencesPick | null) => void>();
    const canvas = mount({ onPick });
    click(canvas, clientOf(150, 50));
    expect(onPick).toHaveBeenCalledWith({ kind: 'line', id: 1 });
    click(canvas, clientOf(100, 20));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'line', id: 2 });
  });

  it('reports empty space as null', () => {
    const onPick = vi.fn<(hit: ReferencesPick | null) => void>();
    const canvas = mount({ onPick });
    click(canvas, clientOf(180, 5));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it('picks and hovers only what is on the paper at the step being read', () => {
    // Reading step k: crease 1 is made, crease 2 is a later step's. The
    // vertical crease is not there to point at, and the vertex where it lands
    // on the horizontal one is not there yet either — the horizontal crease
    // simply runs through that point.
    const onPick = vi.fn<(hit: ReferencesPick | null) => void>();
    const canvas = mount({
      onPick,
      creaseVisibility: { visible: new Set([1]), pickable: new Set([1]), dimmed: null, dimAlpha: 1 },
    });
    uploads.setPreview.mockClear();
    hover(canvas, clientOf(100, 20));
    expect(canvas.style.cursor).toBe('');
    expect(uploads.setPreview.mock.calls.at(-1)?.[0] ?? null).toBeNull();
    click(canvas, clientOf(100, 20));
    expect(onPick).toHaveBeenLastCalledWith(null);
    click(canvas, clientOf(100, 50));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'line', id: 1 });
    // The crease that is there still answers, and its own ends do.
    click(canvas, clientOf(150, 50));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'line', id: 1 });
    click(canvas, clientOf(0, 50));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'vertex', idx: 0, point: { x: 0, y: 50 } });
  });

  it('leaves the whole sheet pickable when the visibility says nothing about picking', () => {
    const onPick = vi.fn<(hit: ReferencesPick | null) => void>();
    const canvas = mount({
      onPick,
      creaseVisibility: { visible: new Set([1]), dimmed: null, dimAlpha: 1 },
    });
    click(canvas, clientOf(100, 20));
    expect(onPick).toHaveBeenLastCalledWith({ kind: 'line', id: 2 });
  });

  it('does not pick after a drag, which pans instead', () => {
    const onPick = vi.fn<(hit: ReferencesPick | null) => void>();
    const canvas = mount({ onPick });
    const start = clientOf(150, 50);
    act(() => {
      canvas.dispatchEvent(pointer('pointerdown', start));
      canvas.dispatchEvent(
        pointer('pointermove', { clientX: start.clientX + 30, clientY: start.clientY + 30 })
      );
      canvas.dispatchEvent(
        pointer('pointerup', { clientX: start.clientX + 30, clientY: start.clientY + 30 })
      );
    });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('ignores the right button, which is the panel context menu', () => {
    const onPick = vi.fn<(hit: ReferencesPick | null) => void>();
    const canvas = mount({ onPick });
    const at = clientOf(150, 50);
    act(() => {
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 2, ...at })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 2, ...at })
      );
    });
    expect(onPick).not.toHaveBeenCalled();
  });
});

/**
 * A dense pattern: 200 short creases spread over the same extent as `GEOMETRY`,
 * so the fit camera puts neighbouring vertices a couple of CSS px apart — the
 * shape of a real 9k-segment CP, where the editor fades its vertex dots out.
 */
const DENSE_GEOMETRY = (() => {
  const endpoints: number[] = [];
  for (let i = 0; i < 200; i += 1) {
    const x = i;
    endpoints.push(x, 0, x + 0.5, 0.5);
  }
  return {
    segEndpoints: Float64Array.from(endpoints),
    segAttr: new Int32Array(200 * 5),
  } as unknown as CpGeometryTransport;
})();

describe('ReferencesCpView vertex crowding', () => {
  beforeEach(stubWebgl);

  it('keeps every vertex dot on a sparse pattern', () => {
    mount();
    expect(uploads.render.mock.calls.at(-1)?.[0].pointOpacity).toBe(1);
  });

  it('fades the vertex layer out on a dense one, as the editor does', () => {
    mount({ geometry: DENSE_GEOMETRY });
    const frame = uploads.render.mock.calls.at(-1)?.[0];
    expect(frame.pointOpacity).toBeLessThan(1);
    expect(frame.pointOpacity).toBe(0);
    // The outline ring collapses first, so it is gone too.
    expect(frame.pointOutlinePx).toBe(0);
  });

  it('still marks the picked vertex when the layer under it has faded', () => {
    // The whole point of the workspace: picking a vertex must leave a visible
    // mark on exactly the patterns where the dots had to be faded away.
    mount({ geometry: DENSE_GEOMETRY, selected: { kind: 'vertex', idx: 0 } });
    expect(uploads.render.mock.calls.at(-1)?.[0].pointOpacity).toBe(0);
    const overlay = uploads.setOverlayPoints.mock.calls.at(-1)?.[0];
    expect(overlay?.count).toBe(1);
    expect([overlay.center[0], overlay.center[1]]).toEqual([0, 0]);
    // Drawn opaque: the overlay channel carries no per-instance alpha ramp.
    expect(overlay.fill[3]).toBeGreaterThan(0);
  });

  it('marks the step-highlighted vertices there too', () => {
    mount({ geometry: DENSE_GEOMETRY, highlightVertexIdx: new Set([0, 1]) });
    expect(uploads.setOverlayPoints.mock.calls.at(-1)?.[0]?.count).toBe(2);
  });
});

describe('ReferencesCpView device pixel ratio', () => {
  beforeEach(stubWebgl);

  it('caps the drawing buffer at the shared CP DPR policy', () => {
    // The editor caps at 2 for the fill budget; a second surface on the same
    // renderer must not quietly take the other side of that decision.
    vi.stubGlobal('devicePixelRatio', 3);
    const canvas = mount();
    expect(canvas.width).toBe(Math.round(VIEWPORT.width * 2));
    expect(canvas.height).toBe(Math.round(VIEWPORT.height * 2));
  });
});

describe('ReferencesCpView overlays', () => {
  beforeEach(stubWebgl);

  // The step's lines arrive already packed — built once from the same
  // primitives the filmstrip card draws — so this channel hands them straight
  // to the renderer rather than deciding anything about them.
  it('uploads the step’s packed lines through the preview channel', () => {
    mount({
      diagramStrokes: {
        a: new Float32Array([0, 0]),
        b: new Float32Array([200, 100]),
        color: new Float32Array([1, 1, 1, 1]),
        widthMul: new Float32Array([1]),
        count: 1,
      },
    });
    expect(uploads.setPreview.mock.calls.at(-1)?.[0]?.count).toBe(1);
  });

  it('clears both channels when the step has nothing to draw', () => {
    mount();
    expect(uploads.setPreview.mock.calls.at(-1)?.[0]).toBeNull();
    expect(uploads.setOverlayPoints.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('gives the picked crease the highlight slot and the step’s creases the emphasis width', () => {
    // Two different questions, and they used to share one channel: the picked
    // crease is recoloured, while a step's creases keep their own mountain or
    // valley ink and are widened instead.
    mount({
      selected: { kind: 'line', id: 1 },
      creaseVisibility: {
        visible: new Set([1, 2]),
        dimmed: null,
        dimAlpha: 1,
        emphasis: new Set([2]),
        emphasisWidth: 2.6,
      },
    });
    const strokes = uploads.setStrokes.mock.calls.at(-1)?.[0];
    expect(strokes.widthMul).toHaveLength(2);
    expect(strokes.widthMul[0]).toBeCloseTo(2.6, 5);
    expect(strokes.widthMul[1]).toBeCloseTo(2.6, 5);
  });

  it('leaves an unemphasised crease its own ink and width', () => {
    mount({
      creaseVisibility: {
        visible: new Set([1, 2]),
        dimmed: new Set([1]),
        dimAlpha: 0.25,
        emphasis: new Set([2]),
        emphasisWidth: 2.6,
      },
    });
    const strokes = uploads.setStrokes.mock.calls.at(-1)?.[0];
    expect(strokes.widthMul[0]).toBeCloseTo(1, 5);
    expect(strokes.widthMul[1]).toBeCloseTo(2.6, 5);
    // Dimmed, not recoloured: alpha alone moves.
    expect(strokes.color[3]).toBeCloseTo(0.25, 5);
    expect(strokes.color[7]).toBeCloseTo(1, 5);
  });

  it('exposes zoom, fit and framing on its handle', () => {
    const ref = createRef<ReferencesCpViewHandle>();
    mount({}, ref);
    expect(ref.current).not.toBeNull();
    expect(() => {
      ref.current?.zoomIn();
      ref.current?.zoomOut();
      ref.current?.frameModelBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
      ref.current?.fit();
    }).not.toThrow();
  });
});
