import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import { registerCpSurfacePress } from '../picking/cpSurfacePressRegistry';
import type { CpSurfaceClaim } from '../picking/surfacePressClaim';
import type { Vec2 } from '../annotations/annotationTransform';
import { useCpRegionChipDrag } from './useCpRegionChipDrag';

/**
 * The chip bar's press, against the one gesture it may not answer.
 *
 * A region's body takes no pointer events, so its chip *is* the region's handle:
 * press to select, drag to move, like a window title bar. But it floats over the
 * crease pattern, and a Cmd+drag that starts on it has to pan like a Cmd+drag
 * anywhere else — otherwise pan has a dead patch wherever a region is open.
 *
 * The bar is portalled out of the viewport, so the press registry is not merely
 * the tidy channel to the canvas; it is the only one. A stub registered through
 * it *is* the canvas as far as this hook can tell.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Identity camera, so a CSS delta is a model delta. */
const IDENTITY = { origin: [0, 0] as const, ex: [1, 0] as const, ey: [0, 1] as const };

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let detachSurface: (() => void) | null = null;

interface Recorded {
  selected: number;
  moved: Vec2[];
  gestures: number;
  commits: string[];
  pressed: PointerEvent[];
}

function mount(claim: CpSurfaceClaim): Recorded {
  const recorded: Recorded = {
    selected: 0,
    moved: [],
    gestures: 0,
    commits: [],
    pressed: [],
  };
  detachSurface = registerCpSurfacePress({
    pressClaim: () => claim,
    press: (event) => recorded.pressed.push(event),
    hoverCursor: () => null,
  });

  function Host() {
    const drag = useCpRegionChipDrag({
      center: { x: 10, y: 10 },
      onSelect: () => (recorded.selected += 1),
      onMove: (center) => recorded.moved.push(center),
      onGestureStart: () => (recorded.gestures += 1),
      onGestureCommit: (label) => recorded.commits.push(label),
    });
    return <div data-testid="bar" {...drag} />;
  }

  act(() => {
    cpOverlayViewStore.set({ model: IDENTITY, user: IDENTITY });
    root?.render(<Host />);
  });
  return recorded;
}

function bar(): HTMLElement {
  const el = container!.querySelector('[data-testid="bar"]') as HTMLElement;
  // jsdom implements no pointer capture, and the hook calls it optionally.
  const target = el as unknown as Record<string, unknown>;
  target.setPointerCapture = () => {};
  target.hasPointerCapture = () => false;
  target.releasePointerCapture = () => {};
  return el;
}

/** Press, drag well past the 2px threshold, release. */
function dragBar(el: HTMLElement, init: PointerEventInit = {}): void {
  const send = (type: string, clientX: number, clientY: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX,
      clientY,
      ...init,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    act(() => {
      el.dispatchEvent(event);
    });
  };
  send('pointerdown', 100, 100);
  send('pointermove', 140, 130);
  send('pointerup', 140, 130);
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  detachSurface?.();
  detachSurface = null;
});

describe('useCpRegionChipDrag', () => {
  it('moves the region on a plain drag, which is what the bar is for', () => {
    const recorded = mount(null);

    dragBar(bar());

    expect(recorded.selected).toBe(1);
    expect(recorded.moved).toEqual([{ x: 50, y: 40 }]);
    expect(recorded.commits).toHaveLength(1);
    expect(recorded.pressed).toEqual([]);
  });

  it('hands a pan press to the surface and moves nothing', () => {
    const recorded = mount('pan');

    dragBar(bar(), { metaKey: true });

    expect(recorded.pressed).toHaveLength(1);
    expect(recorded.moved).toEqual([]);
    expect(recorded.gestures).toBe(0);
    expect(recorded.commits).toEqual([]);
    // Not even the selection: a pan is the camera moving, and it should leave
    // whatever was selected exactly as it found it.
    expect(recorded.selected).toBe(0);
  });

  it('still moves when the surface reports a crease under the bar', () => {
    // The bar is chrome the user aimed at, like a resize handle — the creases it
    // covers do not take its press. Only the camera does.
    const recorded = mount('crease');

    dragBar(bar());

    expect(recorded.pressed).toEqual([]);
    expect(recorded.moved).toEqual([{ x: 50, y: 40 }]);
  });
});
