import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SimulatorViewCube, type SimulatorViewCubeHandle } from './SimulatorViewCube';
import type { ViewCubeFaceId } from './viewCubeGeometry';
import {
  simulatorViewLookingFrom,
  type SimulatorOrbitGesture,
  type SimulatorViewDirection,
} from '../../lib/simulatorOrbit';

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
let orbit: { [K in keyof SimulatorOrbitGesture]: Mock<SimulatorOrbitGesture[K]> };
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
        orbit={orbit}
      />
    );
  });
  // The cube has no camera of its own: the viewport points it at `viewRef` as
  // the handle attaches, and this stands in for that.
  act(() => handle?.setView(OPENING));
}

/** The six face panels, which carry the label and the visibility state. */
function faces(): HTMLElement[] {
  return Array.from(host?.querySelectorAll('.simulator-view-cube__face') ?? []);
}

function face(label: string): HTMLElement {
  const found = faces().find((element) => element.textContent === label);
  expect(found, `a face labelled ${label}`).toBeDefined();
  return found as HTMLElement;
}

/** A face's own middle cell — the one that snaps to the face itself. */
function faceButton(label: string): HTMLButtonElement {
  const button = face(label).querySelector<HTMLButtonElement>(
    '.simulator-view-cube__spot--face'
  );
  expect(button, `a button on the ${label} face`).not.toBeNull();
  return button as HTMLButtonElement;
}

/** A face's nine cells, in reading order from its top-left. */
function spots(label: string): HTMLButtonElement[] {
  return Array.from(face(label).querySelectorAll('.simulator-view-cube__spot'));
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
  orbit = { begin: vi.fn(), move: vi.fn(), end: vi.fn() };
  handle = null;
  // jsdom implements no pointer capture, and a drag on a face takes it.
  const element = HTMLElement.prototype as unknown as Record<string, unknown>;
  element.setPointerCapture = () => {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
});

afterEach(() => {
  const element = HTMLElement.prototype as unknown as Record<string, unknown>;
  delete element.setPointerCapture;
  delete element.hasPointerCapture;
  delete element.releasePointerCapture;
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

    act(() => faceButton('Top').click());

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

    act(() => faceButton('Top').click());

    expect(onSnap).not.toHaveBeenCalled();
    expect(host?.querySelector('.simulator-view-cube')?.getAttribute('data-interactive')).toBeNull();
  });

  it('offers a face’s eight neighbours alongside it', () => {
    // A face-on view leaves every other face edge-on, so faces alone would make
    // the cube a dead end: press Front and nothing but Front is clickable until
    // you drag. Its own corners and edges are the way out.
    render();

    const cells = spots('Front');
    expect(cells).toHaveLength(9);
    // Reading order from the face's top-left, so its top-left cell is the
    // front-top-left corner of the cube.
    const root = 1 / Math.sqrt(3);
    act(() => cells[0]?.click());
    const direction = onSnap.mock.calls.at(-1)?.[0] ?? [0, 0, 0];
    expect(direction[0]).toBeCloseTo(-root, 12);
    expect(direction[1]).toBeCloseTo(root, 12);
    expect(direction[2]).toBeCloseTo(-root, 12);
  });

  it('keeps the eight out of the keyboard’s way', () => {
    // Six stops in the tab order, not fifty-four. They are redundant with
    // dragging, and the six faces are what a keyboard user actually needs.
    render();

    const tabbable = spots('Front').filter((spot) => spot.tabIndex !== -1);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]?.textContent).toBe('Front');
  });

  /** Press, move through the given offsets, release — all on one face. */
  function drag(label: string, ...offsets: Array<[number, number]>) {
    const target = faceButton(label);
    const send = (type: string, x: number, y: number) =>
      act(() => {
        target.dispatchEvent(
          new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true })
        );
      });
    send('pointerdown', 100, 100);
    for (const [dx, dy] of offsets) send('pointermove', 100 + dx, 100 + dy);
    const [lastX, lastY] = offsets.at(-1) ?? [0, 0];
    send('pointerup', 100 + lastX, 100 + lastY);
  }

  it('turns the model when the cube is dragged', () => {
    // What most people try first, and what the cube did nothing about until now.
    render();

    drag('Front', [40, 0], [80, 12]);

    expect(orbit.begin).toHaveBeenCalledWith({ x: 100, y: 100 });
    expect(orbit.move.mock.calls).toEqual([[{ x: 140, y: 100 }], [{ x: 180, y: 112 }]]);
    expect(orbit.end).toHaveBeenCalledTimes(1);
  });

  it('does not also snap to the face a drag ended on', () => {
    // Press and drag start identically, so the press has to be decided late: a
    // turn that finishes over Front must not then jump the camera to Front.
    render();

    drag('Front', [40, 0]);
    act(() => faceButton('Front').click());

    expect(onSnap).not.toHaveBeenCalled();
  });

  it('still snaps when the pointer barely moved', () => {
    // A press is never perfectly still. Under the slop it is a press.
    render();

    drag('Top', [1, -1]);
    act(() => faceButton('Top').click());

    expect(orbit.move).not.toHaveBeenCalled();
    expect(onSnap).toHaveBeenCalledWith([0, 1, 0], 'top');
  });

  it('swallows only the press the drag earned', () => {
    // The flag is cleared by the press it eats, so the *next* one gets through.
    render();

    drag('Front', [40, 0]);
    act(() => faceButton('Front').click());
    act(() => faceButton('Front').click());

    expect(onSnap).toHaveBeenCalledTimes(1);
  });

  it('takes no drag while the simulation is not ready', () => {
    render(false);

    drag('Front', [40, 0]);

    expect(orbit.begin).not.toHaveBeenCalled();
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
