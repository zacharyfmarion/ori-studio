import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
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
const uploads = vi.hoisted(() => ({ setStrokes: vi.fn(), setPreview: vi.fn(), setOverlayPoints: vi.fn() }));
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
    highlightLineIds: new Set(),
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

describe('ReferencesCpView overlays', () => {
  beforeEach(stubWebgl);

  it('uploads ghost lines and markers through the preview and overlay channels', () => {
    mount({
      ghostSegments: [{ a: { x: 0, y: 0 }, b: { x: 200, y: 100 }, kind: 'new' }],
      markers: [{ at: { x: 100, y: 50 }, kind: 'input' }],
    });
    const preview = uploads.setPreview.mock.calls.at(-1)?.[0];
    expect(preview?.count).toBe(1);
    const overlay = uploads.setOverlayPoints.mock.calls.at(-1)?.[0];
    expect(overlay?.count).toBe(1);
  });

  it('clears both channels when the step has nothing to draw', () => {
    mount();
    expect(uploads.setPreview.mock.calls.at(-1)?.[0]).toBeNull();
    expect(uploads.setOverlayPoints.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('draws highlighted and picked creases in the highlight slot', () => {
    mount({ highlightLineIds: new Set([2]), selected: { kind: 'line', id: 1 } });
    const strokes = uploads.setStrokes.mock.calls.at(-1)?.[0];
    // Both creases take the highlight width multiplier (a Float32 buffer).
    expect(strokes.widthMul).toHaveLength(2);
    expect(strokes.widthMul[0]).toBeCloseTo(2.6, 5);
    expect(strokes.widthMul[1]).toBeCloseTo(2.6, 5);
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
