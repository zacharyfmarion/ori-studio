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
 *
 * The corollary is that nothing about *size* can be tested here, and one thing
 * worth testing lives there: the nine cells must be equal thirds of their face,
 * which a `1fr` track does not guarantee because it will not shrink below its
 * content. jsdom loads no stylesheet at all — `getComputedStyle` returns empty
 * strings — so an assertion about it would pass whatever the rule said. It is
 * checked in the browser instead; see the `minmax(0, 1fr)` note in `theme.css`.
 */

type Snap = (direction: SimulatorViewDirection, face: ViewCubeFaceId) => void;

const OPENING = { yaw: Math.PI / 4, pitch: -0.955, zoom: 1.4 };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let onSnap: Mock<Snap>;
let onRoll: Mock<(delta: number) => void>;
let orbit: { [K in keyof SimulatorOrbitGesture]: Mock<SimulatorOrbitGesture[K]> };
let handle: SimulatorViewCubeHandle | null = null;
let litCell: HTMLElement | null = null;

function render(interactive = true) {
  act(() => {
    root?.render(
      <SimulatorViewCube
        ref={(value) => {
          handle = value;
        }}
        interactive={interactive}
        onSnap={onSnap}
        onRoll={onRoll}
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
  const found = faces().find(
    (element) => element.querySelector('.simulator-view-cube__label')?.textContent === label
  );
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

/** Move the pointer onto a cell, as the browser reports it. */
function hover(target: HTMLElement | null) {
  act(() => {
    if (litCell) litCell.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
    litCell = target;
    target?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  });
}

/** Two angles are the same when they differ by a whole number of turns. */
function expectAngle(actual: number | undefined, expected: number) {
  const turn = Math.PI * 2;
  const apart = Math.abs((((actual ?? Number.NaN) - expected) % turn) + turn) % turn;
  expect(Math.min(apart, turn - apart)).toBeCloseTo(0, 12);
}

/** Every cell currently lit, named by the face it sits on. */
function litFaces(): string[] {
  return faces()
    .filter((element) => element.querySelector('[data-lit="true"]'))
    .map((element) => element.querySelector('.simulator-view-cube__label')?.textContent ?? '')
    .sort();
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
  onRoll = vi.fn<(delta: number) => void>();
  orbit = { begin: vi.fn(), move: vi.fn(), end: vi.fn() };
  handle = null;
  litCell = null;
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
    // Named by `aria-label`: the visible word is painted across the whole face,
    // so it is not this button's text and is hidden from assistive tech there.
    expect(tabbable[0]?.getAttribute('aria-label')).toBe('Front');
  });

  it('lights all three cells that reach a corner', () => {
    // The three sit together in plain sight around a visible corner and snap to
    // the identical view, so lighting one of them says they are three different
    // targets — which is the opposite of true.
    render();

    // The Front face's bottom-right cell is the front-right-bottom corner, and
    // Right and Bottom each offer it too.
    hover(spots('Front')[8]!);

    expect(litFaces()).toEqual(['Bottom', 'Front', 'Right']);
  });

  it('lights both cells that reach an edge', () => {
    render();

    // The Front face's middle-right cell is the front-right edge.
    hover(spots('Front')[5]!);

    expect(litFaces()).toEqual(['Front', 'Right']);
  });

  it('lights one face at a time', () => {
    render();

    hover(faceButton('Front'));

    expect(litFaces()).toEqual(['Front']);
  });

  it('puts the last viewpoint out when the pointer moves on', () => {
    render();
    hover(spots('Front')[8]!);

    hover(spots('Front')[5]!);
    expect(litFaces()).toEqual(['Front', 'Right']);

    hover(null);
    expect(litFaces()).toEqual([]);
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

    expect(orbit.begin).toHaveBeenCalledWith({ x: 100, y: 100 }, 'orbit');
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

  /** The roll ring: the circle through the corners of the square face. */
  function ring(): SVGSVGElement {
    const svg = host?.querySelector<SVGSVGElement>('.simulator-view-cube__ring');
    expect(svg).not.toBeNull();
    return svg as SVGSVGElement;
  }

  function ringHit(): SVGCircleElement {
    return ring().querySelector('.simulator-view-cube__ring-hit') as SVGCircleElement;
  }

  /** How far round the mark is, in degrees clockwise from straight up. */
  function markDegrees(): number {
    const mark = ring().querySelector('.simulator-view-cube__ring-mark')
      ?.parentElement as unknown as SVGGElement;
    const match = /rotate\(([-\d.]+)\)/.exec(mark?.getAttribute('transform') ?? '');
    return match ? Number(match[1]) : Number.NaN;
  }

  /**
   * Grab the ring at a point measured from its centre, in client pixels.
   *
   * jsdom gives every element a zero-sized box at the origin, so the component's
   * one layout read lands on (0, 0) — which is exactly the centre these offsets
   * are relative to.
   */
  function grabRing(...points: Array<[number, number]>) {
    const hit = ringHit();
    const send = (type: string, [x, y]: [number, number]) =>
      act(() => {
        hit.dispatchEvent(
          new PointerEvent(type, { pointerId: 5, clientX: x, clientY: y, bubbles: true })
        );
      });
    send('pointerdown', points[0] ?? [0, 0]);
    for (const point of points.slice(1)) send('pointermove', point);
    send('pointerup', points.at(-1) ?? [0, 0]);
  }

  it('offers the ring only square-on to a face', () => {
    // At any other angle the picture is already tilted and a circle drawn round
    // the cube would not sit on anything. Shift and drag still rolls from there.
    render();
    expect(ring().dataset.available).toBe('false');

    act(() => handle?.setView(simulatorViewLookingFrom(OPENING, [0, 0, -1])));
    expect(ring().dataset.available).toBe('true');

    const half = 1 / Math.sqrt(2);
    act(() => handle?.setView(simulatorViewLookingFrom(OPENING, [half, 0, -half])));
    expect(ring().dataset.available).toBe('false');
  });

  it('puts the mark straight up at rest, and turns it clockwise with the roll', () => {
    render();
    expect(markDegrees()).toBe(0);

    act(() => handle?.setView({ ...OPENING, roll: Math.PI / 2 }));

    expect(markDegrees()).toBeCloseTo(90, 3);
  });

  it('does not move on the press, however far from the mark it lands', () => {
    // A steering wheel turns by how far your hand travels; taking hold of it at
    // ten to two does not straighten the wheels.
    render();
    act(() => handle?.setView(simulatorViewLookingFrom(OPENING, [0, 0, -1])));

    // Straight right of centre — a quarter turn away from the mark at the top.
    grabRing([10, 0]);

    expect(onRoll).not.toHaveBeenCalled();
  });

  it('turns by how far the grab sweeps, from wherever it started', () => {
    render();
    act(() => handle?.setView({ ...simulatorViewLookingFrom(OPENING, [0, 0, -1]), roll: 0.25 }));

    // Take hold at 3 o'clock and sweep a quarter turn to 6 o'clock: a quarter
    // turn is added to the roll that was already there, rather than replacing it.
    grabRing([10, 0], [0, 10]);

    expect(onRoll).toHaveBeenLastCalledWith(0.25 + Math.PI / 2);
  });

  it('keeps turning the long way round rather than snapping back', () => {
    // Measured from the press, a sweep past half a turn would fold back through
    // the short arc. Accumulating a step at a time is what makes three quarters
    // of a turn read as three quarters.
    render();
    act(() => handle?.setView({ ...simulatorViewLookingFrom(OPENING, [0, 0, -1]), roll: 0 }));

    grabRing([0, -10], [10, 0], [0, 10], [-10, 0]);

    const seen = onRoll.mock.calls.map(([roll]) => roll);
    expectAngle(seen[0], Math.PI / 2);
    // A half turn normalizes to −π, which is the same angle as π — hence the
    // comparison modulo a whole turn rather than on the number itself.
    expectAngle(seen[1], Math.PI);
    expectAngle(seen[2], (3 * Math.PI) / 2);
  });

  it('does not read a grab on the ring as a turn of the cube', () => {
    // The ring sits inside the root, whose handlers turn the model. Without the
    // stop, grabbing it would begin an orbit underneath.
    render();
    act(() => handle?.setView(simulatorViewLookingFrom(OPENING, [0, 0, -1])));

    grabRing([10, 0], [0, 10]);

    expect(orbit.begin).not.toHaveBeenCalled();
  });

  it('nudges the roll from the keyboard', () => {
    // The ring is the only roll control on the cube, so it has to be reachable
    // without a pointer.
    render();
    act(() => handle?.setView({ ...OPENING, roll: 0.5 }));

    act(() => {
      ringHit().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    });

    expect(onRoll).toHaveBeenCalledWith(0.5 + Math.PI / 12);
  });

  it('rolls rather than orbits while Shift is held', () => {
    render();
    const target = faceButton('Front');

    act(() => {
      target.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 4,
          clientX: 100,
          clientY: 100,
          shiftKey: true,
          bubbles: true,
        })
      );
    });

    expect(orbit.begin).toHaveBeenCalledWith({ x: 100, y: 100 }, 'roll');
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
