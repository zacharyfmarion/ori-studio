import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../components/ui/Tooltip';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { Viewport3d, type Viewport3dHandle } from './Viewport3d';

let host: HTMLDivElement;
let root: Root;
const ref = createRef<Viewport3dHandle>();
const onView = vi.fn();
const onGesture = vi.fn();
const start = { yaw: 0.4, pitch: -0.5, zoom: 1 };
function pointer(type: string, x: number, y: number, extra: PointerEventInit = {}) {
  act(() =>
    host.querySelector('canvas')!.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        clientX: x,
        clientY: y,
        bubbles: true,
        ...extra,
      })
    )
  );
}
function mount(interactive = true) {
  act(() =>
    root.render(
      <TooltipProvider>
        <Viewport3d
          ref={ref}
          initialView={start}
          onView={onView}
          onGesture={onGesture}
          label="Paper camera"
          interactive={interactive}
        />
      </TooltipProvider>
    )
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 300,
  } as DOMRect);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.releasePointerCapture = () => {};
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shared static camera surface', () => {
  it('pans with the middle button and cancels to the gesture origin', () => {
    mount();
    pointer('pointerdown', 10, 20, { button: 1 });
    pointer('pointermove', 70, 50, { button: 1 });
    expect(onView.mock.lastCall?.[0]).toEqual({ ...start, pan: [0.2, 0.1] });
    expect(onGesture).toHaveBeenCalledWith(true);
    pointer('pointercancel', 70, 50);
    expect(onView.mock.lastCall?.[0]).toEqual(start);
    expect(onGesture.mock.lastCall).toEqual([false, true]);
  });
  it('stops an old drag when an undo supplies a new camera', () => {
    mount();
    pointer('pointerdown', 10, 20);
    pointer('pointermove', 40, 80);
    const restored = { ...start, yaw: 1, pan: [0.1, 0.2] as [number, number] };
    act(() => ref.current!.setView(restored));
    pointer('pointermove', 200, 200);
    expect(onView.mock.lastCall?.[0]).toEqual(restored);
    expect(onGesture.mock.lastCall).toEqual([false, true]);
  });
  it('keeps read-only views fixed through pointer, wheel and double click', () => {
    mount(false);
    onView.mockClear();
    pointer('pointerdown', 10, 20);
    pointer('pointermove', 70, 50);
    pointer('pointerup', 70, 50);
    act(() => {
      host.querySelector('canvas')!.dispatchEvent(new WheelEvent('wheel', { deltaY: 20 }));
      host.querySelector('canvas')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(onView).not.toHaveBeenCalled();
  });
});
