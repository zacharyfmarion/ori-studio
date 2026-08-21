import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpOverlayViewStore } from './cpOverlayViewStore';
import { CanvasObjectOverlay } from './CanvasObjectOverlay';
import type { TransformableCanvasObject } from './canvasObjects/transformableObject';
import { resetShiftLatch, setShiftLatched } from './touchModifiers/shiftLatch';

// Identity camera, so a model-space box lands on the same CSS coordinates.
const IDENTITY = { origin: [0, 0] as const, ex: [1, 0] as const, ey: [0, 1] as const };

function object(id: string): TransformableCanvasObject {
  return {
    id,
    space: 'model',
    box: { center: { x: 50, y: 50 }, width: 40, height: 40, rotation: 0 },
    locked: false,
    hidden: false,
    aspectLock: 'default-off',
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    cpOverlayViewStore.set({ model: IDENTITY, user: IDENTITY });
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

function render(props: Partial<Parameters<typeof CanvasObjectOverlay>[0]> = {}): void {
  act(() => {
    root?.render(
      <CanvasObjectOverlay
        objects={[object('a')]}
        selectedId="a"
        suppressedId={null}
        interactive
        onSelect={() => {}}
        onUpdate={() => {}}
        {...props}
      />
    );
  });
}

function bodyPolygon(): SVGPolygonElement | null {
  return container?.querySelector('polygon') ?? null;
}

describe('CanvasObjectOverlay body interactivity', () => {
  it('takes pointer events on an ordinary object', () => {
    render();
    expect(bodyPolygon()?.style.pointerEvents).toBe('auto');
  });

  it('yields the body to objects whose own content is interactive', () => {
    // A focused inline simulation orbits on drag. The overlay polygon sits above
    // it, so leaving the body live meant every gesture aimed at the fold moved
    // the window instead — which read as the window being uninteractive.
    render({ inertBodyIds: new Set(['a']) });

    const polygon = bodyPolygon();
    expect(polygon?.style.pointerEvents).toBe('none');
    // Not the move cursor either: the body no longer moves anything.
    expect(polygon?.style.cursor).toBe('default');
  });

  it('keeps the handles live for an inert body, so it can still be sized', () => {
    render({ inertBodyIds: new Set(['a']) });

    // Distinct from `suppressedId`, which removes the chrome altogether.
    const handles = container?.querySelectorAll('rect') ?? [];
    expect(handles.length).toBeGreaterThan(0);
    for (const handle of handles) {
      expect((handle as SVGRectElement).style.pointerEvents).toBe('auto');
    }
  });

  it('leaves other objects alone', () => {
    act(() => {
      root?.render(
        <CanvasObjectOverlay
          objects={[object('a'), object('b')]}
          selectedId="a"
          suppressedId={null}
          inertBodyIds={new Set(['a'])}
          interactive
          onSelect={() => {}}
          onUpdate={() => {}}
        />
      );
    });

    const polygons = container?.querySelectorAll('polygon') ?? [];
    expect(polygons.length).toBe(2);
    expect((polygons[0] as SVGPolygonElement).style.pointerEvents).toBe('none');
    expect((polygons[1] as SVGPolygonElement).style.pointerEvents).toBe('auto');
  });
});

describe('CanvasObjectOverlay wheel forwarding', () => {
  function forwardedWheel(init: WheelEventInit): WheelEvent {
    render();
    const canvas = document.createElement('canvas');
    container?.append(canvas);
    const received: WheelEvent[] = [];
    canvas.addEventListener('wheel', (event) => received.push(event as WheelEvent));

    container?.querySelector('svg')?.dispatchEvent(new WheelEvent('wheel', { ...init, cancelable: true }));

    expect(received).toHaveLength(1);
    return received[0];
  }

  it('carries the modifiers across, so a pinch over an object still zooms', () => {
    // The overlay's polygons capture pointer events, so the canvas never sees
    // the wheel directly. A copy without modifiers made every pinch over a
    // folded figure or reference image read as an unmodified scroll.
    const forwarded = forwardedWheel({ deltaY: -4, ctrlKey: true });

    expect(forwarded.ctrlKey).toBe(true);
    expect(forwarded.deltaY).toBe(-4);
  });

  // One mount per case: the component forwards to the *first* canvas it finds,
  // so two `forwardedWheel` calls in one test would both address the first.
  it('carries the accel modifier too', () => {
    expect(forwardedWheel({ deltaY: -4, metaKey: true }).metaKey).toBe(true);
  });

  it('carries the shift modifier too', () => {
    expect(forwardedWheel({ deltaY: 4, shiftKey: true }).shiftKey).toBe(true);
  });

  it('preserves the deltas and deltaMode a plain scroll carries', () => {
    const forwarded = forwardedWheel({ deltaX: 7, deltaY: 3, deltaMode: 1 });

    expect(forwarded.deltaX).toBe(7);
    expect(forwarded.deltaY).toBe(3);
    expect(forwarded.deltaMode).toBe(1);
  });
});

/*
 * Shift during a resize decides the aspect ratio, and a touch device has no
 * Shift key — so the rail's latch has to reach this code path or a text box can
 * never be constrained and a reference image can never be freed. The overlay
 * reads `withShiftLatch(event.shiftKey)`, and these drive the drag with the key
 * down in neither hand.
 */
describe('CanvasObjectOverlay aspect lock', () => {
  function dragCornerBy(dx: number, dy: number): { width: number; height: number } | null {
    let last: { width?: number; height?: number } | null = null;
    render({ onUpdate: (_id, patch) => (last = patch) });

    // Handle order is `nw n ne e se s sw w`, so index 4 is the south-east
    // corner. A corner is what the aspect lock applies to.
    const corner = (container?.querySelectorAll('rect') ?? [])[4];
    if (!(corner instanceof SVGElement)) throw new Error('no corner handle');
    stubCapture(corner);

    // The identity camera in this file means model units and CSS px agree, so
    // the box's corner is at (70, 70) and the drag target is that plus the delta.
    act(() => {
      corner.dispatchEvent(pointerEvent('pointerdown', 70, 70));
      corner.dispatchEvent(pointerEvent('pointermove', 70 + dx, 70 + dy));
    });
    if (!last) return null;
    const patch = last as { width?: number; height?: number };
    return patch.width !== undefined && patch.height !== undefined
      ? { width: patch.width, height: patch.height }
      : null;
  }

  function stubCapture(element: SVGElement) {
    const target = element as unknown as Record<string, unknown>;
    target.setPointerCapture = () => {};
    target.hasPointerCapture = () => false;
    target.releasePointerCapture = () => {};
  }

  function pointerEvent(type: string, clientX: number, clientY: number): Event {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    return event;
  }

  afterEach(() => {
    resetShiftLatch();
  });

  it('resizes freely with the latch off, as a bare drag always has', () => {
    const size = dragCornerBy(20, 0);
    expect(size).not.toBeNull();
    // `default-off`: width moved, height did not.
    expect(size?.width).toBeGreaterThan(size?.height ?? 0);
  });

  it('keeps the proportions with the latch on, which is what Shift does', () => {
    setShiftLatched(true);
    const size = dragCornerBy(20, 0);
    expect(size).not.toBeNull();
    expect(size?.width).toBeCloseTo(size?.height ?? 0, 6);
  });
});
