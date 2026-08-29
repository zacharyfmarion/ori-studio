import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COARSE_POINTER_QUERY } from '../platform/pointerSurface';
import { cpOverlayViewStore } from './cpOverlayViewStore';
import { CanvasObjectOverlay } from './CanvasObjectOverlay';
import type { CanvasObjectBoxUpdate } from './CanvasObjectOverlay';
import { cpSurfaceGestures } from './gestures/cpSurfaceGestures';
import { registerCpSurfacePress } from './picking/cpSurfacePressRegistry';
import type { TransformableCanvasObject } from './canvasObjects/transformableObject';
import { resetShiftLatch, setShiftLatched } from './touchModifiers/shiftLatch';

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
    // Above the creases, so the surface is never consulted — the default for
    // every kind but a reference image.
    paintedBehindCreases: false,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
/** Unregister for a stub surface, so one case's canvas cannot leak into the next. */
let detachSurface: (() => void) | null = null;

beforeEach(() => {
  // Module state shared with the canvas, so a contact left behind by one case
  // would make the next one's first touch look like the second finger of a
  // pinch — and every assertion after it meaningless.
  cpSurfaceGestures.reset();
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
  detachSurface?.();
  detachSurface = null;
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

/**
 * Crease-over-image press precedence.
 *
 * A reference image is drawn *under* the crease pattern so you can trace on top
 * of it, while its overlay body sits above the canvas and is handed the press
 * first — so a crease drawn over an image was unselectable, and erase, pan and
 * marquee all died inside the image's box too. The fix is for a body flagged
 * `paintedBehindCreases` to ask the canvas whether the press is really the
 * surface's, and hand the native event over when it is.
 *
 * The canvas is not mounted here; `cpSurfacePressRegistry` is the whole contract
 * between the two layers, so a stub registered through it *is* the canvas as far
 * as this component can tell.
 */
describe('CanvasObjectOverlay crease precedence', () => {
  /** An object of the one kind the creases are painted over. */
  function image(id: string): TransformableCanvasObject {
    return { ...object(id), paintedBehindCreases: true };
  }

  /**
   * Register a stub surface and return what it was asked and told.
   * `claims` decides every answer, standing in for "is a crease under here";
   * `cursor` is what the canvas would show there when it does claim.
   */
  function stubSurface(claims: boolean, cursor = 'pointer') {
    const asked: { clientX: number; clientY: number; button: number }[] = [];
    const cursorAsked: { clientX: number; clientY: number }[] = [];
    const pressed: PointerEvent[] = [];
    detachSurface = registerCpSurfacePress({
      claimsPress: (point) => {
        asked.push({ clientX: point.clientX, clientY: point.clientY, button: point.button });
        return claims;
      },
      press: (event) => {
        pressed.push(event);
      },
      hoverCursor: (point) => {
        cursorAsked.push({ clientX: point.clientX, clientY: point.clientY });
        return claims ? cursor : null;
      },
    });
    return { asked, cursorAsked, pressed };
  }

  function pressBody(
    body: SVGPolygonElement,
    init: PointerEventInit & { type?: string } = {}
  ): void {
    const { type = 'pointerdown', ...rest } = init;
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 50,
      clientY: 50,
      ...rest,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    act(() => {
      body.dispatchEvent(event);
    });
  }

  /** Stub the capture API jsdom lacks, and report whether it was used. */
  function trackCapture(body: SVGPolygonElement): { captured: number[] } {
    const captured: number[] = [];
    const target = body as unknown as Record<string, unknown>;
    target.setPointerCapture = (id: number) => captured.push(id);
    target.hasPointerCapture = () => false;
    target.releasePointerCapture = () => {};
    return { captured };
  }

  it('hands a press on a crease to the surface, selecting nothing', () => {
    const { pressed } = stubSurface(true);
    const selected: (string | null)[] = [];
    render({ objects: [image('a')], selectedId: null, onSelect: (id) => selected.push(id) });
    const body = bodyPolygon()!;
    const { captured } = trackCapture(body);

    pressBody(body);

    expect(pressed).toHaveLength(1);
    // Nothing else may happen: selecting would steal the canvas selection the
    // crease is about to take, and capturing would keep the rest of the gesture
    // on this layer instead of the canvas that now owns it.
    expect(selected).toEqual([]);
    expect(captured).toEqual([]);
  });

  it('reports no contact to the touch arbiter on the path it declines', () => {
    // The subtle half. A contact reported by both layers leaves the arbiter
    // believing a finger is still down, after which every later single touch
    // looks like the second finger of a pinch and the canvas stops drawing —
    // a leak that outlives the gesture that caused it.
    stubSurface(true);
    render({ objects: [image('a')], selectedId: null });
    const body = bodyPolygon()!;
    trackCapture(body);

    pressBody(body);

    // A fresh single touch must still read as a first finger, not a second.
    expect(
      cpSurfaceGestures.down(
        { pointerId: 9, pointerType: 'touch', clientX: 10, clientY: 10 },
        'canvas'
      )
    ).toBe('forward');
  });

  it('keeps a press on empty space, so the image stays selectable and movable', () => {
    const { pressed } = stubSurface(false);
    const selected: (string | null)[] = [];
    render({ objects: [image('a')], selectedId: null, onSelect: (id) => selected.push(id) });
    const body = bodyPolygon()!;
    const { captured } = trackCapture(body);

    pressBody(body);

    expect(pressed).toEqual([]);
    expect(selected).toEqual(['a']);
    expect(captured).toEqual([1]);
  });

  it('never asks about an object the creases are drawn under', () => {
    // The guard that text boxes, folded figures and inline simulations are
    // untouched by any of this: they paint above the creases, so they keep every
    // press without the surface being consulted at all.
    const { asked, pressed } = stubSurface(true);
    const selected: (string | null)[] = [];
    render({ objects: [object('a')], selectedId: null, onSelect: (id) => selected.push(id) });
    const body = bodyPolygon()!;
    trackCapture(body);

    pressBody(body);

    expect(asked).toEqual([]);
    expect(pressed).toEqual([]);
    expect(selected).toEqual(['a']);
  });

  it('leaves the context menu to the crease under the pointer', () => {
    stubSurface(true);
    const menus: string[] = [];
    render({
      objects: [image('a')],
      selectedId: null,
      onContextMenu: (id) => menus.push(id),
    });

    pressBody(bodyPolygon()!, { type: 'contextmenu', button: 2 });

    expect(menus).toEqual([]);
  });

  it('still opens the image context menu on empty space', () => {
    // Why the secondary button asks the crease question rather than claiming
    // outright: an unconditional claim would take this menu away entirely.
    stubSurface(false);
    const menus: string[] = [];
    render({
      objects: [image('a')],
      selectedId: null,
      onContextMenu: (id) => menus.push(id),
    });

    pressBody(bodyPolygon()!, { type: 'contextmenu', button: 2 });

    expect(menus).toEqual(['a']);
  });

  it('does not toggle crop from a double-click aimed at a crease', () => {
    stubSurface(true);
    const selected: (string | null)[] = [];
    render({
      objects: [image('a')],
      selectedId: null,
      onSelect: (id) => selected.push(id),
      canCrop: () => true,
    });

    pressBody(bodyPolygon()!, { type: 'dblclick' });

    // Both underlying presses went to the canvas, so the image is not even
    // selected — putting it into crop mode here would be a surprise.
    expect(selected).toEqual([]);
  });

  /**
   * The cursor is a promise about what a drag will do, so it has to answer the
   * same question the press does. Reported after the press routing landed: the
   * body still read "move" while hovering directly over a crease, which is the
   * one thing a press there would not do.
   */
  describe('cursor', () => {
    /** Run the queued animation frame the cursor probe books. */
    function flushProbe(): void {
      act(() => {
        vi.advanceTimersByTime(32);
      });
    }

    function hover(body: SVGPolygonElement): void {
      const event = new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 50,
        clientY: 50,
      });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      act(() => {
        body.dispatchEvent(event);
      });
    }

    beforeEach(() => {
      // requestAnimationFrame is what the probe coalesces onto, so the fake
      // clock has to drive it too.
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows the crease cursor where a press would go to the crease instead', () => {
      // The reported bug: over a crease drawn on a reference image the body kept
      // showing `move`, and the first fix only got as far as dropping it to
      // `default` — because it mirrored the canvas' rendered style, which the
      // canvas never updates while this overlay is intercepting the hover.
      stubSurface(true, 'pointer');
      render({ objects: [image('a')], selectedId: null });
      const body = bodyPolygon()!;
      expect(body.style.cursor).toBe('move');

      hover(body);
      flushProbe();

      expect(body.style.cursor).toBe('pointer');
    });

    it('shows whatever else the canvas would, not just pointer', () => {
      // A pan modifier held over an image is still a pan. The canvas answers
      // with its own cursor, so this layer needs no rules of its own.
      stubSurface(true, 'grab');
      render({ objects: [image('a')], selectedId: null });
      const body = bodyPolygon()!;

      hover(body);
      flushProbe();

      expect(body.style.cursor).toBe('grab');
    });

    it('keeps the move cursor over empty space inside the image', () => {
      stubSurface(false);
      render({ objects: [image('a')], selectedId: null });
      const body = bodyPolygon()!;

      hover(body);
      flushProbe();

      expect(body.style.cursor).toBe('move');
    });

    it('never probes for an object drawn over the creases', () => {
      // A text box or folded figure keeps every press, so its cursor is not in
      // question and it must not pay for a hit test on every hover.
      const { asked } = stubSurface(true);
      render({ objects: [object('a')], selectedId: null });
      const body = bodyPolygon()!;

      hover(body);
      flushProbe();

      expect(asked).toEqual([]);
      expect(body.style.cursor).toBe('move');
    });

    it('coalesces a burst of moves into one hit test', () => {
      // A high-rate pointer reports far more often than the screen redraws, and
      // the probe runs a hit test — which is cheap per frame and not per sample.
      const { cursorAsked } = stubSurface(true);
      render({ objects: [image('a')], selectedId: null });
      const body = bodyPolygon()!;

      for (let i = 0; i < 10; i++) hover(body);
      flushProbe();

      expect(cursorAsked).toHaveLength(1);
    });

    it('restores the move cursor when the pointer leaves', () => {
      stubSurface(true);
      render({ objects: [image('a')], selectedId: null });
      const body = bodyPolygon()!;
      hover(body);
      flushProbe();
      expect(body.style.cursor).toBe('pointer');

      // `pointerleave` does not bubble, so React synthesizes it from the
      // bubbling `pointerout` and the element being moved to.
      const out = new MouseEvent('pointerout', {
        bubbles: true,
        relatedTarget: document.body,
      });
      Object.defineProperty(out, 'pointerId', { value: 1 });
      Object.defineProperty(out, 'pointerType', { value: 'mouse' });
      act(() => {
        body.dispatchEvent(out);
      });

      expect(body.style.cursor).toBe('move');
    });
  });

  it('keeps the handles live, so a selected image over a dense pattern can be sized', () => {
    stubSurface(true);
    render({ objects: [image('a')], selectedId: 'a' });

    const handles = container?.querySelectorAll('rect') ?? [];
    expect(handles.length).toBeGreaterThan(0);
    for (const handle of handles) {
      expect((handle as SVGRectElement).style.pointerEvents).toBe('auto');
    }
  });
});

/*
 * The reported bug: two-finger pinching with one finger resting on a folded
 * figure dragged the figure instead of zooming. The overlay captures that press
 * and the canvas never sees it, so before the surface arbiter existed neither
 * layer could tell there were two fingers down at all.
 *
 * The canvas is not mounted here; `cpSurfaceGestures` is the contract between
 * the two layers, so a press reported through it *is* the other finger landing.
 */
describe('CanvasObjectOverlay multi-touch', () => {
  function touch(type: string, id: number, clientX: number, clientY: number): Event {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
    Object.defineProperty(event, 'pointerId', { value: id });
    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    return event;
  }

  function beginBodyDrag(
    props: Partial<Parameters<typeof CanvasObjectOverlay>[0]> = {}
  ): {
    body: SVGPolygonElement;
    patches: CanvasObjectBoxUpdate[];
    commits: string[];
    selected: (string | null)[];
  } {
    const patches: CanvasObjectBoxUpdate[] = [];
    const commits: string[] = [];
    const selected: (string | null)[] = [];
    render({
      onUpdate: (_id, patch) => patches.push(patch),
      onGestureCommit: (_id, kind) => commits.push(kind),
      onSelect: (id) => selected.push(id),
      ...props,
    });
    const body = bodyPolygon();
    if (!body) throw new Error('no body polygon');
    const target = body as unknown as Record<string, unknown>;
    target.setPointerCapture = () => {};
    target.hasPointerCapture = () => false;
    target.releasePointerCapture = () => {};

    // The box is centred on (50, 50) under this file's identity camera.
    act(() => {
      body.dispatchEvent(touch('pointerdown', 1, 50, 50));
      body.dispatchEvent(touch('pointermove', 1, 70, 50));
    });
    return { body, patches, commits, selected };
  }

  /** The second finger of a pinch, landing on the canvas beside the first. */
  function secondFingerOnCanvas(): void {
    act(() => {
      cpSurfaceGestures.down(
        { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 50 },
        'canvas'
      );
    });
  }

  it('drags on one finger, as it always has', () => {
    const { patches } = beginBodyDrag();
    expect(patches.at(-1)?.center).toEqual({ x: 70, y: 50 });
  });

  it('puts the object back when a second finger lands', () => {
    const { patches } = beginBodyDrag();
    expect(patches.at(-1)?.center).toEqual({ x: 70, y: 50 });

    secondFingerOnCanvas();

    // Back to where the gesture found it. A pinch that nudges a figure a few
    // pixels every time is a document edit nobody asked for.
    expect(patches.at(-1)?.center).toEqual({ x: 50, y: 50 });
  });

  /*
   * Reported from a tablet against the first cut of this fix: "it properly
   * doesn't move the window, but it still *selects* the window". Fingers land
   * tens of milliseconds apart, so the first one has already selected whatever
   * it came down on by the time the second makes the gesture a pinch.
   */
  it('takes the selection back when a second finger lands', () => {
    const { selected } = beginBodyDrag({ selectedId: null });
    expect(selected).toEqual(['a']);

    secondFingerOnCanvas();

    expect(selected).toEqual(['a', null]);
  });

  it('takes the selection back even when the finger never moved', () => {
    // The geometry roll-back is gated on `moved`; this one must not be, or a
    // pinch that starts as a still touch leaves the window selected.
    const selected: (string | null)[] = [];
    render({ selectedId: null, onSelect: (id) => selected.push(id) });
    const body = bodyPolygon();
    if (!body) throw new Error('no body polygon');
    const target = body as unknown as Record<string, unknown>;
    target.setPointerCapture = () => {};
    target.hasPointerCapture = () => false;
    target.releasePointerCapture = () => {};

    act(() => body.dispatchEvent(touch('pointerdown', 1, 50, 50)));
    secondFingerOnCanvas();

    expect(selected).toEqual(['a', null]);
  });

  it('restores whatever held the selection before, not just nothing', () => {
    const { selected } = beginBodyDrag({
      objects: [object('a'), object('b')],
      selectedId: 'b',
    });
    expect(selected).toEqual(['a']);

    secondFingerOnCanvas();

    expect(selected).toEqual(['a', 'b']);
  });

  it('leaves an already-selected object selected', () => {
    // Nothing to take back: the press did not change the selection, so undoing
    // it would deselect an object the pinch never touched.
    const { selected } = beginBodyDrag({ selectedId: 'a' });
    secondFingerOnCanvas();
    expect(selected).toEqual(['a']);
  });

  it('stops dragging for the rest of the gesture', () => {
    const { body, patches } = beginBodyDrag();
    secondFingerOnCanvas();
    const afterAbort = patches.length;

    act(() => {
      body.dispatchEvent(touch('pointermove', 1, 120, 90));
    });

    expect(patches.length).toBe(afterAbort);
  });

  it('commits nothing, so the pinch leaves no undo entry', () => {
    const { body, commits } = beginBodyDrag();
    act(() => {
      cpSurfaceGestures.down(
        { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 50 },
        'canvas'
      );
      body.dispatchEvent(touch('pointerup', 1, 120, 90));
    });

    expect(commits).toEqual([]);
  });

  it('refuses to start a drag while another finger is already down', () => {
    const patches: CanvasObjectBoxUpdate[] = [];
    const selected: (string | null)[] = [];
    render({
      onUpdate: (_id, patch) => patches.push(patch),
      onSelect: (id) => selected.push(id),
    });
    const body = bodyPolygon();
    if (!body) throw new Error('no body polygon');
    const target = body as unknown as Record<string, unknown>;
    target.setPointerCapture = () => {};
    target.hasPointerCapture = () => false;
    target.releasePointerCapture = () => {};

    act(() => {
      cpSurfaceGestures.down(
        { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 50 },
        'canvas'
      );
      body.dispatchEvent(touch('pointerdown', 1, 50, 50));
      body.dispatchEvent(touch('pointermove', 1, 70, 50));
    });

    expect(patches).toEqual([]);
    // Nor does it select: the second finger of a pinch is not a tap on a window.
    expect(selected).toEqual([]);
  });

  it('keeps reporting its finger, so the pinch measures both', () => {
    // The reason the press is captured even when the drag is refused. A pinch
    // anchored by a thumb on the canvas moves only the finger on the window, and
    // a contact the arbiter cannot see contributes no spread — so the gesture
    // would pan and never zoom.
    const samples: { scale: number }[] = [];
    const detach = cpSurfaceGestures.setTransformSink((transform) => samples.push(transform));
    try {
      const { body } = beginBodyDrag();
      act(() => {
        cpSurfaceGestures.down(
          { pointerId: 2, pointerType: 'touch', clientX: 90, clientY: 50 },
          'canvas'
        );
        // Contacts at 70 and 90; this finger pulls out to 10, tripling the gap.
        body.dispatchEvent(touch('pointermove', 1, 10, 50));
      });

      expect(samples.at(-1)?.scale).toBeCloseTo(4, 6);
    } finally {
      detach();
    }
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

/*
 * Shift during a resize decides the aspect ratio, and a touch device has no
 * Shift key — so the rail's latch has to reach this code path or a text box can
 * never be constrained and a reference image can never be freed. The overlay
 * reads `withShiftLatch(event.shiftKey)`, and these drive the drag with the key
 * down in neither hand.
 */
describe('CanvasObjectOverlay aspect lock', () => {
  function dragCornerBy(dx: number, dy: number): { width: number; height: number } | null {
    let last: { width?: number; height?: number } | null = null;
    render({ onUpdate: (_id, patch) => (last = patch) });

    // Handle order is `nw n ne e se s sw w`, so index 4 is the south-east
    // corner. A corner is what the aspect lock applies to.
    const corner = (container?.querySelectorAll('rect') ?? [])[4];
    if (!(corner instanceof SVGElement)) throw new Error('no corner handle');
    stubCapture(corner);

    // The identity camera in this file means model units and CSS px agree, so
    // the box's corner is at (70, 70) and the drag target is that plus the delta.
    act(() => {
      corner.dispatchEvent(pointerEvent('pointerdown', 70, 70));
      corner.dispatchEvent(pointerEvent('pointermove', 70 + dx, 70 + dy));
    });
    if (!last) return null;
    const patch = last as { width?: number; height?: number };
    return patch.width !== undefined && patch.height !== undefined
      ? { width: patch.width, height: patch.height }
      : null;
  }

  function stubCapture(element: SVGElement) {
    const target = element as unknown as Record<string, unknown>;
    target.setPointerCapture = () => {};
    target.hasPointerCapture = () => false;
    target.releasePointerCapture = () => {};
  }

  function pointerEvent(type: string, clientX: number, clientY: number): Event {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    return event;
  }

  // The latch only exists on a touch device, so these have to be run on one.
  // The events below already say `pointerType: 'touch'`, but the latch asks the
  // media query rather than the event — it stands in for a key the *device* does
  // not have, which is a property of the device and not of one gesture.
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query === COARSE_POINTER_QUERY,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    resetShiftLatch();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('resizes freely with the latch off, as a bare drag always has', () => {
    const size = dragCornerBy(20, 0);
    expect(size).not.toBeNull();
    // `default-off`: width moved, height did not.
    expect(size?.width).toBeGreaterThan(size?.height ?? 0);
  });

  it('keeps the proportions with the latch on, which is what Shift does', () => {
    setShiftLatched(true);
    const size = dragCornerBy(20, 0);
    expect(size).not.toBeNull();
    expect(size?.width).toBeCloseTo(size?.height ?? 0, 6);
  });
});
