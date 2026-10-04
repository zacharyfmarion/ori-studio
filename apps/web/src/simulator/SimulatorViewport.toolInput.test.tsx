import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  DEFAULT_SIMULATOR_VIEW,
  SimulatorViewport,
  type SimulatorViewportHandle,
  type SimulatorViewportToolInput,
} from './SimulatorViewport';
import { DEFAULT_SIMULATOR_SETTINGS } from '../lib/simulatorSettings';
import { DEFAULT_PAPER_STYLE } from '../lib/paper/paperStyle';
import type { SimulatorOrbitView } from '../lib/simulatorOrbit';

/**
 * The viewport's tool input: which presses reach the tool, what a drag and a
 * click hand it, and that navigation stays out of a tool's reach.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PushCamera = (view: SimulatorOrbitView, width: number, height: number) => void;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let pushCamera: Mock<PushCamera>;
let onGesture: Mock<SimulatorViewportToolInput['onGesture']>;
const handle = createRef<SimulatorViewportHandle>();

function render(toolInput: Partial<SimulatorViewportToolInput> | null) {
  act(() => {
    root?.render(
      <SimulatorViewport
        ref={handle}
        canvasKey="gl"
        onCanvasChange={() => {}}
        interactive
        gpuActive
        viewSettings={DEFAULT_SIMULATOR_SETTINGS}
        paperStyle={DEFAULT_PAPER_STYLE}
        toolInput={
          toolInput
            ? { mode: 'pick-faces', cursor: 'crosshair', enabled: true, onGesture, ...toolInput }
            : undefined
        }
        pushCamera={pushCamera}
        pushRenderSettings={() => {}}
        ariaLabel="simulator"
      />
    );
  });
  const element = canvas();
  // The canvas sits 10px in and 20px down, at 400 by 300.
  element.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 400, height: 300, right: 410, bottom: 320, x: 10, y: 20 }) as DOMRect;
  pushCamera.mockClear();
}

function canvas(): HTMLCanvasElement {
  const element = host?.querySelector('canvas');
  if (!element) throw new Error('no canvas');
  return element;
}

function marquee(): HTMLDivElement | null {
  return host?.querySelector('div[aria-hidden="true"]') ?? null;
}

function pointer(
  type: string,
  x: number,
  y: number,
  init: Partial<PointerEventInit> = {}
): PointerEvent {
  const event = new PointerEvent(type, {
    pointerId: 1,
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    canvas().dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  pushCamera = vi.fn<PushCamera>();
  onGesture = vi.fn();
  // jsdom implements no pointer capture.
  const element = HTMLElement.prototype as unknown as Record<string, unknown>;
  element.setPointerCapture = () => {};
  element.releasePointerCapture = () => {};
  element.hasPointerCapture = () => false;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  const element = HTMLElement.prototype as unknown as Record<string, unknown>;
  delete element.setPointerCapture;
  delete element.releasePointerCapture;
  delete element.hasPointerCapture;
});

describe('SimulatorViewport tool input', () => {
  it('hands a dragged box to the tool in canvas pixels, with the canvas size', () => {
    render({});

    pointer('pointerdown', 30, 40);
    pointer('pointermove', 90, 100);
    expect(marquee()?.hidden).toBe(false);
    expect(marquee()?.style.width).toBe('60px');
    pointer('pointerup', 130, 140);

    expect(marquee()?.hidden).toBe(true);
    expect(onGesture).toHaveBeenCalledWith(
      { kind: 'box', rect: { left: 20, top: 20, right: 120, bottom: 120 }, shift: false, touch: false },
      { width: 400, height: 300 }
    );
    expect(pushCamera).not.toHaveBeenCalled();
  });

  it('reads a release near the press as a click where it landed', () => {
    render({});

    pointer('pointerdown', 30, 40, { shiftKey: true });
    pointer('pointerup', 32, 41);

    expect(onGesture).toHaveBeenCalledWith(
      { kind: 'click', point: { x: 20, y: 20 }, shift: true, touch: false },
      { width: 400, height: 300 }
    );
  });

  it('orbits on a Meta drag and on the middle button, whatever the tool', () => {
    render({});

    pointer('pointerdown', 30, 40, { metaKey: true });
    pointer('pointermove', 80, 40, { metaKey: true });
    pointer('pointerup', 80, 40, { metaKey: true });
    expect(pushCamera).toHaveBeenCalled();

    pushCamera.mockClear();
    const middle = pointer('pointerdown', 30, 40, { button: 1 });
    expect(middle.defaultPrevented).toBe(true);
    pointer('pointermove', 80, 40, { button: 1 });
    pointer('pointerup', 80, 40, { button: 1 });
    expect(pushCamera).toHaveBeenCalled();
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('leaves the secondary button to the context menu', () => {
    render({});

    pointer('pointerdown', 30, 40, { button: 2 });
    pointer('pointermove', 90, 100, { button: 2 });
    pointer('pointerup', 90, 100, { button: 2 });

    expect(pushCamera).not.toHaveBeenCalled();
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('starts no tool gesture while the tool is not enabled', () => {
    render({ enabled: false });

    pointer('pointerdown', 30, 40);
    pointer('pointerup', 130, 140);

    expect(onGesture).not.toHaveBeenCalled();
  });

  it('abandons a box in flight when asked, and says whether there was one', () => {
    render({});

    pointer('pointerdown', 30, 40);
    pointer('pointermove', 90, 100);
    let cancelled = false;
    act(() => {
      cancelled = handle.current?.cancelToolGesture() ?? false;
    });
    expect(cancelled).toBe(true);
    expect(marquee()?.hidden).toBe(true);
    pointer('pointerup', 130, 140);

    expect(onGesture).not.toHaveBeenCalled();
    expect(handle.current?.cancelToolGesture()).toBe(false);
  });

  it('lets a second finger abort the box rather than finish it', () => {
    render({});

    pointer('pointerdown', 30, 40, { pointerType: 'touch', pointerId: 1 });
    pointer('pointermove', 90, 100, { pointerType: 'touch', pointerId: 1 });
    pointer('pointerdown', 200, 200, { pointerType: 'touch', pointerId: 2 });
    pointer('pointerup', 90, 100, { pointerType: 'touch', pointerId: 1 });
    pointer('pointerup', 200, 200, { pointerType: 'touch', pointerId: 2 });

    expect(onGesture).not.toHaveBeenCalled();
    expect(marquee()?.hidden).toBe(true);
  });

  it('marks a finger’s gesture as touch', () => {
    render({});

    pointer('pointerdown', 30, 40, { pointerType: 'touch' });
    pointer('pointerup', 31, 40, { pointerType: 'touch' });

    expect(onGesture).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'click', touch: true }),
      expect.anything()
    );
  });

  it('resets the view on a double click under Orbit only', () => {
    render({});
    act(() => handle.current?.zoomBy(2));
    pushCamera.mockClear();
    act(() => {
      canvas().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(pushCamera).not.toHaveBeenCalled();

    render({ mode: 'orbit', cursor: 'grab' });
    act(() => {
      canvas().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(pushCamera.mock.calls.at(-1)?.[0].zoom).toBe(DEFAULT_SIMULATOR_VIEW.zoom);
  });

  it('wears the tool’s cursor, and leaves the cursor to the stylesheet without tools', () => {
    render({});
    expect(canvas().style.cursor).toBe('crosshair');

    render(null);
    expect(canvas().style.cursor).toBe('');
  });

  it('orbits on any button on a surface without tools, as it always has', () => {
    render(null);

    pointer('pointerdown', 30, 40, { button: 2 });
    pointer('pointermove', 80, 40, { button: 2 });
    pointer('pointerup', 80, 40, { button: 2 });

    expect(pushCamera).toHaveBeenCalled();
    expect(marquee()).toBeNull();
  });
});
