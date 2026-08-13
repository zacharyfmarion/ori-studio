import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineSimulationLayer } from './InlineSimulationLayer';
import { cpOverlayViewStore } from './cpOverlayViewStore';
import { CP_VIEWPORT_CANVAS_CLASS } from './cpViewportCanvas';
import type { InlineSimulation } from './inlineSimulation/inlineSimulation';
import { DEFAULT_SIMULATOR_SETTINGS } from '../lib/simulatorSettings';
import { claimWheelBurst, endWheelBurst, forwardWheel } from '../lib/wheelBurst';
import type { SimulatorStatus } from '../simulator/useSimulatorRuntime';

/**
 * Wheel handling for an inline simulation window.
 *
 * A window takes pointer events whenever it is focused *or* the shared selection
 * overlay is inert — which is any time a drawing tool is armed — and that also
 * makes it swallow the wheel: the crease-pattern canvas listens on the canvas
 * element, which is no ancestor of a window, so a pan crossing one simply
 * stopped. The window claims the gesture either way (nothing behind it wants a
 * browser page zoom), so the stall was silent.
 *
 * What is asserted is therefore *where the gesture ends up*: the canvas, unless
 * this window is the one entitled to it.
 */

const status = vi.hoisted(() => ({ current: 'ready' as SimulatorStatus }));
/** Cameras the window pushed to its worker — one per zoom of its own fold. */
const cameras = vi.hoisted(() => [] as { zoom: number }[]);

// The worker runtime is stubbed: what is under test is which element the wheel
// reaches, and a real solver session would only sit between the two.
vi.mock('../simulator/useSimulatorRuntime', () => ({
  webglRenderSupported: () => true,
  useSimulatorRuntime: () => ({
    status: status.current,
    error: null,
    model: null,
    playing: false,
    gpuActive: true,
    setPlaying: () => {},
    setFoldPercent: () => {},
    settleTo: () => {},
    reset: () => {},
    setMaterial: () => {},
    setCamera: (view: { zoom: number }) => {
      cameras.push(view);
    },
    setRenderSettings: () => {},
    exportSvg: async () => null,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The viewport observes its own canvas for resizes; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

/** An identity-ish camera, which is all the layer needs to place a window. */
const VIEW = { origin: [0, 0] as const, ex: [1, 0] as const, ey: [0, 1] as const };

const SIMULATION: InlineSimulation = {
  id: 'sim-1',
  box: { center: { x: 0, y: 0 }, width: 120, height: 120, rotation: 0 },
  z: 1,
  view: { yaw: 0, pitch: 0, zoom: 1 },
  sourceBoundary: null,
  sourceBounds: null,
  sourceFingerprint: null,
  segmentIdHint: null,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let cpCanvas: HTMLCanvasElement | null = null;
let forwarded: WheelEvent[] = [];

function renderLayer(options: { focused: boolean; overlayInteractive: boolean }): void {
  act(() => {
    root?.render(
      <InlineSimulationLayer
        simulations={[SIMULATION]}
        focusedId={options.focused ? SIMULATION.id : null}
        staleIds={new Set()}
        viewSettings={DEFAULT_SIMULATOR_SETTINGS}
        playing={false}
        overlayInteractive={options.overlayInteractive}
        replayRequest={0}
        onFocus={() => {}}
        onPlayingChange={() => {}}
      />
    );
  });
  // Mounting pushes the window's opening camera; the assertions are about what
  // a gesture adds to that.
  cameras.length = 0;
}

/** The window's own canvas — where a wheel over a window actually lands. */
function windowCanvas(): HTMLCanvasElement {
  const element = container?.querySelector<HTMLCanvasElement>('.cp-inline-simulation__canvas');
  if (!element) throw new Error('inline simulation window did not render');
  return element;
}

/** Two-finger scroll: a pan on the crease-pattern canvas, under either preference. */
function scroll(): WheelEvent {
  const event = new WheelEvent('wheel', {
    deltaX: 12,
    deltaY: 40,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    windowCanvas().dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  status.current = 'ready';
  endWheelBurst();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  cpCanvas = document.createElement('canvas');
  cpCanvas.className = CP_VIEWPORT_CANVAS_CLASS;
  document.body.appendChild(cpCanvas);
  forwarded = [];
  cameras.length = 0;
  cpCanvas.addEventListener('wheel', (event) => forwarded.push(event as WheelEvent));
  act(() => cpOverlayViewStore.set({ model: VIEW, user: VIEW }));
});

afterEach(() => {
  endWheelBurst();
  act(() => root?.unmount());
  container?.remove();
  cpCanvas?.remove();
  root = null;
  container = null;
  cpCanvas = null;
});

describe('InlineSimulationLayer wheel', () => {
  it('hands a pan over an unfocused window to the crease-pattern canvas', () => {
    // The overlay goes inert the moment a drawing tool is armed, which is what
    // makes every window on the canvas take pointer events.
    renderLayer({ focused: false, overlayInteractive: false });

    const event = scroll();

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.deltaX).toBe(12);
    expect(forwarded[0]?.deltaY).toBe(40);
    // Claimed rather than left to the browser: an unhandled ctrl+wheel here
    // would zoom the whole page.
    expect(event.defaultPrevented).toBe(true);
  });

  it('hands a pan over a focused window that is still loading to the canvas', () => {
    // The viewport claims the wheel and then drops it while it is not
    // interactive, so this is the same silent stall by another route.
    status.current = 'loading';
    renderLayer({ focused: true, overlayInteractive: true });

    scroll();

    expect(forwarded).toHaveLength(1);
  });

  it('keeps the wheel when the focused window is ready to zoom its own fold', () => {
    renderLayer({ focused: true, overlayInteractive: true });

    const event = scroll();

    expect(forwarded).toHaveLength(0);
    expect(cameras).toHaveLength(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets a pan that began on the crease pattern cross a focused window', () => {
    renderLayer({ focused: true, overlayInteractive: true });
    // The gesture in flight: the canvas claimed it when the user started
    // scrolling out on open paper, before the cursor got here.
    if (cpCanvas) claimWheelBurst(cpCanvas);

    scroll();

    expect(forwarded).toHaveLength(1);
    // And it stays a pan, rather than zooming the window it is passing over.
    expect(cameras).toHaveLength(0);
  });

  it('keeps a zoom on the window it began on once the cursor moves away', () => {
    renderLayer({ focused: true, overlayInteractive: true });

    // Started here, so this window owns the gesture.
    scroll();

    // What the crease-pattern canvas asks when the cursor strays onto it
    // mid-gesture, and what it does with the answer — the two lines of its
    // `onWheel`, replayed here because mounting that canvas needs a GPU.
    const owner = cpCanvas ? claimWheelBurst(cpCanvas).owner : null;
    expect(owner).toBe(windowCanvas());
    act(() => {
      if (owner) forwardWheel(owner, new WheelEvent('wheel', { deltaY: 40 }));
    });

    expect(cameras).toHaveLength(2);
    expect(forwarded).toHaveLength(0);
  });
});
