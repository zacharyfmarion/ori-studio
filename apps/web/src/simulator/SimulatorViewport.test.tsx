import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_SIMULATOR_VIEW, SimulatorViewport } from './SimulatorViewport';
import { DEFAULT_SIMULATOR_SETTINGS } from '../lib/simulatorSettings';
import type { SimulatorOrbitView } from '../lib/simulatorOrbit';

/**
 * The viewport's wheel handling, which has to do two things at once: zoom the
 * fold, and stop the browser doing anything of its own with the gesture.
 *
 * The second half is the one that regressed. A trackpad pinch arrives as
 * ctrl+wheel, and React registers `wheel` passively at its root — so an
 * `onWheel` prop calling `preventDefault()` is silently ignored and the pinch
 * zooms the whole page as well as the fold. `defaultPrevented` is therefore the
 * assertion that matters here; it is the only observable difference between the
 * two implementations.
 */

type PushCamera = (view: SimulatorOrbitView, width: number, height: number) => void;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let pushCamera: Mock<PushCamera>;

function render(interactive: boolean) {
  act(() => {
    root?.render(
      <SimulatorViewport
        canvasKey="gl"
        onCanvasChange={() => {}}
        interactive={interactive}
        gpuActive
        viewSettings={DEFAULT_SIMULATOR_SETTINGS}
        pushCamera={pushCamera}
        pushRenderSettings={() => {}}
        ariaLabel="simulator"
      />
    );
  });
  // Mounting pushes the initial camera; the tests are about what the gesture
  // adds to that.
  pushCamera.mockClear();
}

function canvas(): HTMLCanvasElement {
  const element = host?.querySelector('canvas');
  expect(element).not.toBeNull();
  return element as HTMLCanvasElement;
}

/** Dispatch a trackpad pinch: the browser reports one as ctrl+wheel. */
function pinch(deltaY: number): WheelEvent {
  const event = new WheelEvent('wheel', {
    deltaY,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    canvas().dispatchEvent(event);
  });
  return event;
}

/** The zoom of the most recent camera the viewport pushed. */
function lastZoom(): number | null {
  return pushCamera.mock.calls.at(-1)?.[0].zoom ?? null;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  pushCamera = vi.fn<PushCamera>();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('SimulatorViewport wheel gestures', () => {
  it('zooms the fold on a pinch and keeps the gesture off the page', () => {
    render(true);

    const zoomIn = pinch(-100);

    expect(zoomIn.defaultPrevented).toBe(true);
    expect(lastZoom()).toBeGreaterThan(DEFAULT_SIMULATOR_VIEW.zoom);
  });

  it('zooms out on the opposite pinch', () => {
    render(true);

    pinch(100);

    expect(lastZoom()).toBeLessThan(DEFAULT_SIMULATOR_VIEW.zoom);
  });

  it('swallows the gesture while not interactive rather than letting the page zoom', () => {
    render(false);

    const event = pinch(-100);

    // Prevented even though nothing was zoomed: a window that is loading,
    // errored or unfocused still sits over the crease pattern, and the
    // browser's own zoom is never the right answer there.
    expect(event.defaultPrevented).toBe(true);
    expect(pushCamera).not.toHaveBeenCalled();
  });

  it('stops listening once unmounted', () => {
    render(true);
    const element = canvas();

    act(() => root?.unmount());
    root = null;

    const event = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(pushCamera).not.toHaveBeenCalled();
  });
});
