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

function render(interactive: boolean, claimsWheel?: () => boolean, viewCube = false) {
  act(() => {
    root?.render(
      <SimulatorViewport
        canvasKey="gl"
        onCanvasChange={() => {}}
        interactive={interactive}
        claimsWheel={claimsWheel}
        gpuActive
        viewSettings={DEFAULT_SIMULATOR_SETTINGS}
        viewCube={viewCube}
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

  it('leaves the gesture to its owner when it does not claim it', () => {
    // An inline simulation window shares the wheel with the crease pattern it
    // floats over: a pan that began out on the paper stays a pan while the
    // cursor crosses the window.
    render(true, () => false);

    const event = pinch(-100);

    // Still claimed from the browser — whoever does act on it is on this page.
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

/**
 * The view cube snap.
 *
 * The animation is the *camera's*, not the cube's — it moves `viewRef` every
 * frame so the fold and the cube follow one motion — which is why it is asserted
 * here, on what reaches the worker, rather than on what the cube looks like.
 *
 * Frames are driven by hand. jsdom's `requestAnimationFrame` runs on a timer, so
 * waiting for real ones would make "did it land exactly" a race.
 */
describe('SimulatorViewport view cube', () => {
  let frames: FrameRequestCallback[];
  let clock: number;

  /** Run every frame requested so far, at `clock` ms. */
  function runFrames(steps: number) {
    for (let i = 0; i < steps; i += 1) {
      const pending = frames;
      frames = [];
      clock += 16;
      act(() => pending.forEach((frame) => frame(clock)));
    }
  }

  /** A face's own middle cell — the one that snaps to the face itself. */
  function press(label: string) {
    const spots = Array.from(
      host?.querySelectorAll<HTMLButtonElement>('.simulator-view-cube__spot--face') ?? []
    );
    const spot = spots.find((element) => element.textContent === label);
    expect(spot, label).toBeDefined();
    act(() => spot?.click());
  }

  /** The camera the viewport most recently pushed. */
  function lastView(): SimulatorOrbitView {
    const view = pushCamera.mock.calls.at(-1)?.[0];
    expect(view).toBeDefined();
    return view as SimulatorOrbitView;
  }

  beforeEach(() => {
    frames = [];
    clock = 1000;
    // jsdom implements no pointer capture at all, so these are added rather than
    // spied on, and removed again below.
    const element = HTMLElement.prototype as unknown as Record<string, unknown>;
    element.setPointerCapture = () => {};
    element.hasPointerCapture = () => false;
    element.releasePointerCapture = () => {};
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => {
      frames.push(frame);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      frames = [];
    });
  });

  afterEach(() => {
    const element = HTMLElement.prototype as unknown as Record<string, unknown>;
    delete element.setPointerCapture;
    delete element.hasPointerCapture;
    delete element.releasePointerCapture;
    vi.restoreAllMocks();
  });

  it('turns to the face that was pressed, and lands on it exactly', () => {
    render(true, undefined, true);

    press('Top');
    // Generous: the snap is ~250ms at 16ms a frame, and the loop stops itself.
    runFrames(40);

    // Looking straight down the paper's normal. Not "close to" — a snap that
    // stopped short would leave the camera off every named viewpoint.
    expect(lastView().pitch).toBeCloseTo(0, 12);
    expect(frames).toHaveLength(0);
  });

  it('moves through the turn rather than jumping', () => {
    render(true, undefined, true);
    const opening = DEFAULT_SIMULATOR_VIEW.pitch;

    press('Top');
    runFrames(3);
    const partway = lastView().pitch;

    expect(partway).toBeGreaterThan(opening);
    expect(partway).toBeLessThan(0);
    expect(frames.length).toBeGreaterThan(0);
  });

  it('gives the camera up the moment a drag starts', () => {
    // A snap still running would overwrite the drag on its next frame, and the
    // canvas would read as dead until the animation finished.
    render(true, undefined, true);
    press('Back');
    runFrames(2);

    act(() => {
      canvas().dispatchEvent(
        new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true })
      );
    });

    expect(frames).toHaveLength(0);
    const stopped = lastView().pitch;
    runFrames(5);
    expect(lastView().pitch).toBe(stopped);
  });

  it('keeps the zoom a snap was made at', () => {
    render(true, undefined, true);
    pinch(-100);
    const zoomed = lastZoom();

    press('Right');
    runFrames(40);

    expect(lastView().zoom).toBe(zoomed);
  });

  it('turns the model when the cube itself is dragged', () => {
    // End to end through the real gesture, not the cube's mock of it: a drag on
    // the cube has to reach the camera exactly as a drag on the canvas does.
    render(true, undefined, true);
    const front = Array.from(
      host?.querySelectorAll<HTMLButtonElement>('.simulator-view-cube__spot--face') ?? []
    ).find((spot) => spot.textContent === 'Front');
    expect(front).toBeDefined();

    const send = (type: string, x: number, y: number) =>
      act(() => {
        front?.dispatchEvent(
          new PointerEvent(type, { pointerId: 3, clientX: x, clientY: y, bubbles: true })
        );
      });
    send('pointerdown', 200, 200);
    send('pointermove', 260, 200);
    send('pointerup', 260, 200);

    // Dragging right lowers the yaw, the same way and by the same amount as on
    // the canvas — 60px at the shared sensitivity.
    expect(lastView().yaw).toBeCloseTo(DEFAULT_SIMULATOR_VIEW.yaw - 0.6, 12);
  });

  it('is off unless a surface asks for it', () => {
    render(true);

    expect(host?.querySelector('.simulator-view-cube')).toBeNull();
  });
});
