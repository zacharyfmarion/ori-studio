import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SimulatorViewCube, type SimulatorViewCubeHandle } from './SimulatorViewCube';
import type { ViewCubeFaceId } from './viewCubeGeometry';
import { simulatorViewLookingFrom, type SimulatorViewDirection } from '../../lib/simulatorOrbit';

/**
 * The cube's DOM contract.
 *
 * jsdom has no layout and therefore no backfaces, so the thing the browser would
 * otherwise handle — not letting a click through to the face behind — is the
 * thing this file has to assert. `data-hidden` is that statement, and it is why
 * the mask is computed rather than left to CSS.
 */

type Snap = (direction: SimulatorViewDirection, face: ViewCubeFaceId) => void;

const OPENING = { yaw: Math.PI / 4, pitch: -0.955, zoom: 1.4 };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let onSnap: Mock<Snap>;
let handle: SimulatorViewCubeHandle | null = null;

function render(interactive = true) {
  act(() => {
    root?.render(
      <SimulatorViewCube
        ref={(value) => {
          handle = value;
        }}
        interactive={interactive}
        onSnap={onSnap}
      />
    );
  });
  // The cube has no camera of its own: the viewport points it at `viewRef` as
  // the handle attaches, and this stands in for that.
  act(() => handle?.setView(OPENING));
}

function faces(): HTMLButtonElement[] {
  return Array.from(host?.querySelectorAll('.simulator-view-cube__face') ?? []);
}

function face(label: string): HTMLButtonElement {
  const found = faces().find((element) => element.textContent === label);
  expect(found, `a face labelled ${label}`).toBeDefined();
  return found as HTMLButtonElement;
}

function visibleLabels(): string[] {
  return faces()
    .filter((element) => element.dataset.hidden === 'false')
    .map((element) => element.textContent ?? '')
    .sort();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onSnap = vi.fn<Snap>();
  handle = null;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('SimulatorViewCube', () => {
  it('offers all six faces, with the opening view’s three turned toward the eye', () => {
    render();

    expect(faces()).toHaveLength(6);
    expect(visibleLabels()).toEqual(['Front', 'Right', 'Top']);
  });

  it('reports the direction the pressed face looks from', () => {
    render();

    act(() => face('Top').click());

    expect(onSnap).toHaveBeenCalledWith([0, 1, 0], 'top');
  });

  it('turns when the camera does, without a re-render', () => {
    render();
    const scene = host?.querySelector('.simulator-view-cube__scene') as HTMLElement;
    const before = scene.style.transform;

    act(() => handle?.setView(simulatorViewLookingFrom(OPENING, [0, 0, 1])));

    expect(scene.style.transform).toMatch(/^matrix3d\(/);
    expect(scene.style.transform).not.toBe(before);
    // Turned to the Back, so the Front is now behind the cube.
    expect(visibleLabels()).toContain('Back');
    expect(visibleLabels()).not.toContain('Front');
  });

  it('does not let a press through to the face behind', () => {
    // Without this the browser's backface culling is the only thing between a
    // click on "Front" and a snap to the Back — the opposite of what was aimed
    // at, and invisible until it happens.
    render();

    expect(face('Back').dataset.hidden).toBe('true');
    expect(face('Front').dataset.hidden).toBe('false');
  });

  it('takes no press while the simulation is not ready', () => {
    render(false);

    act(() => face('Top').click());

    expect(onSnap).not.toHaveBeenCalled();
    expect(host?.querySelector('.simulator-view-cube')?.getAttribute('data-interactive')).toBeNull();
  });

  it('keeps a trackpad pinch off the page', () => {
    // The cube covers a corner of the canvas, which claims the wheel itself so a
    // ctrl+wheel never reaches the browser's own zoom. A hole in that corner
    // would be a hole in the app.
    render();
    const event = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true });

    act(() => {
      host?.querySelector('.simulator-view-cube')?.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });
});
