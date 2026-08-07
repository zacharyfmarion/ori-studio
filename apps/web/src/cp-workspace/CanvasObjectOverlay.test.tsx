import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpOverlayViewStore } from './cpOverlayViewStore';
import { CanvasObjectOverlay } from './CanvasObjectOverlay';
import type { TransformableCanvasObject } from './canvasObjects/transformableObject';

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
