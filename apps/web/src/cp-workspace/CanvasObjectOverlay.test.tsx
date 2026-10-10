import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COARSE_POINTER_QUERY } from '../platform/pointerSurface';
import { cpOverlayViewStore } from './cpOverlayViewStore';
import { CanvasObjectOverlay } from './CanvasObjectOverlay';
import type { CanvasObjectBoxUpdate } from './CanvasObjectOverlay';
import { cpSurfaceGestures } from './gestures/cpSurfaceGestures';
import { registerCpSurfacePress } from './picking/cpSurfacePressRegistry';
import type { CpSurfaceClaim } from './picking/surfacePressClaim';
import { clearHeldModifiers, syncHeldModifiersFromEvent } from '../keyboard/heldModifiers';
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
    // Opaque and drawn over the pattern, so the surface is never consulted —
    // a folded figure or an inline simulation window.
    yieldsPressToCreases: false,
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

function stubCapture(element: SVGElement) {
  const target = element as unknown as Record<string, unknown>;
  target.setPointerCapture = () => {};
  target.hasPointerCapture = () => false;
  target.releasePointerCapture = () => {};
}

/** A one-finger touch event at a client point; pointer 1 throughout. */
function pointerEvent(type: string, clientX: number, clientY: number): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  return event;
}

describe('CanvasObjectOverlay Escape', () => {
  function pressEscape(target: EventTarget, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
    act(() => void target.dispatchEvent(event));
    return event;
  }

  it('deselects from the canvas, even though the runtime claimed the key first', () => {
    // `viewport.cancel` claims every canvas Escape ahead of this listener and
    // never deselects a canvas object itself, so `defaultPrevented` is the
    // normal state of the key when it arrives here — not a reason to yield.
    const onSelect = vi.fn();
    render({ onSelect });
    const canvas = document.body.appendChild(document.createElement('div'));
    canvas.tabIndex = 0;

    const event = pressEscape(canvas);
    event.preventDefault();
    pressEscape(canvas);

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    canvas.remove();
  });

  it('leaves Escape aimed into an open layer to the layer', () => {
    // The object's own context menu: Radix dismisses it on Escape, and the
    // object it was about has to still be selected afterwards.
    const onSelect = vi.fn();
    render({ onSelect });
    const menu = document.body.appendChild(document.createElement('div'));
    menu.setAttribute('role', 'menu');
    menu.tabIndex = -1;

    pressEscape(menu);

    expect(onSelect).not.toHaveBeenCalled();
    menu.remove();
  });

  it('leaves Escape in a text field to the field', () => {
    const onSelect = vi.fn();
    render({ onSelect });
    const input = document.body.appendChild(document.createElement('input'));

    pressEscape(input);

    expect(onSelect).not.toHaveBeenCalled();
    input.remove();
  });
});

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
 * `yieldsPressToCreases` to ask the canvas whether the press is really the
 * surface's, and hand the native event over when it is.
 *
 * The canvas is not mounted here; `cpSurfacePressRegistry` is the whole contract
 * between the two layers, so a stub registered through it *is* the canvas as far
 * as this component can tell.
 */
describe('CanvasObjectOverlay crease precedence', () => {
  /** An object you can see the crease pattern through — an image or a text box. */
  function image(id: string): TransformableCanvasObject {
    return { ...object(id), yieldsPressToCreases: true };
  }

  /**
   * Register a stub surface and return what it was asked and told.
   * `claim` decides every answer — `'crease'` stands in for "a crease is under
   * here", `'pan'` for "this press moves the camera", null for neither — and
   * `cursor` is what the canvas would show there when it does claim.
   */
  function stubSurface(claim: CpSurfaceClaim, cursor = 'pointer') {
    const asked: { clientX: number; clientY: number; button: number }[] = [];
    const cursorAsked: { clientX: number; clientY: number }[] = [];
    const pressed: PointerEvent[] = [];
    detachSurface = registerCpSurfacePress({
      pressClaim: (point) => {
        asked.push({ clientX: point.clientX, clientY: point.clientY, button: point.button });
        return claim;
      },
      press: (event) => {
        pressed.push(event);
      },
      hoverCursor: (point) => {
        cursorAsked.push({ clientX: point.clientX, clientY: point.clientY });
        return claim ? cursor : null;
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
    const { pressed } = stubSurface('crease');
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
    stubSurface('crease');
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
    const { pressed } = stubSurface(null);
    const selected: (string | null)[] = [];
    render({ objects: [image('a')], selectedId: null, onSelect: (id) => selected.push(id) });
    const body = bodyPolygon()!;
    const { captured } = trackCapture(body);

    pressBody(body);

    expect(pressed).toEqual([]);
    expect(selected).toEqual(['a']);
    expect(captured).toEqual([1]);
  });

  it('keeps a crease press for an object the creases are drawn under', () => {
    // The guard on the *crease* half: a folded figure or an inline simulation
    // paints above the creases, so there is nothing to see through it and
    // nothing to yield to. It still asks — that is how it learns whether the
    // press was a pan — and then declines this answer.
    const { asked, pressed } = stubSurface('crease');
    const selected: (string | null)[] = [];
    render({ objects: [object('a')], selectedId: null, onSelect: (id) => selected.push(id) });
    const body = bodyPolygon()!;
    trackCapture(body);

    pressBody(body);

    expect(asked).toHaveLength(1);
    expect(pressed).toEqual([]);
    expect(selected).toEqual(['a']);
  });

  it('leaves the context menu to the crease under the pointer', () => {
    stubSurface('crease');
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
    stubSurface(null);
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
    stubSurface('crease');
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
      stubSurface('crease', 'pointer');
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
      stubSurface('pan', 'grab');
      render({ objects: [image('a')], selectedId: null });
      const body = bodyPolygon()!;

      hover(body);
      flushProbe();

      expect(body.style.cursor).toBe('grab');
    });

    it('keeps the move cursor over empty space inside the image', () => {
      stubSurface(null);
      render({ objects: [image('a')], selectedId: null });
      const body = bodyPolygon()!;

      hover(body);
      flushProbe();

      expect(body.style.cursor).toBe('move');
    });

    it('never probes for an object drawn over the creases', () => {
      // A text box or folded figure keeps every press, so its cursor is not in
      // question and it must not pay for a hit test on every hover.
      const { asked } = stubSurface('crease');
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
      const { cursorAsked } = stubSurface('crease');
      render({ objects: [image('a')], selectedId: null });
      const body = bodyPolygon()!;

      for (let i = 0; i < 10; i++) hover(body);
      flushProbe();

      expect(cursorAsked).toHaveLength(1);
    });

    it('restores the move cursor when the pointer leaves', () => {
      stubSurface('crease');
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
    stubSurface('crease');
    render({ objects: [image('a')], selectedId: 'a' });

    const handles = container?.querySelectorAll('rect') ?? [];
    expect(handles.length).toBeGreaterThan(0);
    for (const handle of handles) {
      expect((handle as SVGRectElement).style.pointerEvents).toBe('auto');
    }
  });
});

/**
 * Pan, which is nobody's press.
 *
 * The reported bug: Cmd+dragging on top of a canvas object moved that object
 * instead of panning — the same thing a plain drag does — so the pan gesture
 * died anywhere an object was in the way. Only the bodies you can see the
 * pattern through were routed correctly, and only because they were already
 * asking the surface about creases; everything else on this layer answered the
 * press itself.
 *
 * The middle button and the hand tool reach the surface by the same verdict, and
 * were broken in the same places.
 */
describe('CanvasObjectOverlay pan precedence', () => {
  /** Register a surface that answers `claim` for every press. */
  function stubClaim(claim: CpSurfaceClaim) {
    const pressed: PointerEvent[] = [];
    detachSurface = registerCpSurfacePress({
      pressClaim: () => claim,
      press: (event) => pressed.push(event),
      hoverCursor: () => (claim ? 'grab' : null),
    });
    return pressed;
  }

  const stubPan = () => stubClaim('pan');

  /** Press an element the way a pointer would, reporting what capture it took. */
  function pressElement(el: SVGElement, init: PointerEventInit = {}): number[] {
    const captured: number[] = [];
    const target = el as unknown as Record<string, unknown>;
    target.setPointerCapture = (id: number) => captured.push(id);
    target.hasPointerCapture = () => false;
    target.releasePointerCapture = () => {};
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 50,
      clientY: 50,
      ...init,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    act(() => {
      el.dispatchEvent(event);
    });
    return captured;
  }

  it('hands a pan press on an opaque object to the surface', () => {
    // A folded figure or an inline simulation: nothing to see the pattern
    // through, so it declines the crease claim — but a pan is not a claim on
    // what is underneath, and this is the press that used to move the figure.
    const pressed = stubPan();
    const selected: (string | null)[] = [];
    render({ objects: [object('a')], selectedId: null, onSelect: (id) => selected.push(id) });
    const body = bodyPolygon()!;

    const captured = pressElement(body);

    expect(pressed).toHaveLength(1);
    // Nothing else: selecting would take the selection a pan never touches, and
    // capturing would keep the rest of the gesture here instead of the canvas.
    expect(selected).toEqual([]);
    expect(captured).toEqual([]);
  });

  it('hands a pan press on a resize handle to the surface', () => {
    const pressed = stubPan();
    render({ objects: [object('a')], selectedId: 'a' });
    const handle = container!.querySelector('rect') as SVGRectElement;

    pressElement(handle);

    expect(pressed).toHaveLength(1);
  });

  it('hands a pan press on a rotate handle to the surface', () => {
    const pressed = stubPan();
    render({ objects: [object('a')], selectedId: 'a' });
    const handle = container!.querySelector('circle') as SVGCircleElement;

    pressElement(handle);

    expect(pressed).toHaveLength(1);
  });

  it('hands over a middle-button press on a handle, which used to do nothing', () => {
    // The handles only ever let the primary button through, so a middle-button
    // pan started on one was swallowed with no drag begun anywhere.
    const pressed = stubPan();
    render({ objects: [object('a')], selectedId: 'a' });

    pressElement(container!.querySelector('rect') as SVGRectElement, { button: 1 });

    expect(pressed).toHaveLength(1);
  });

  it('still sizes from a handle over a crease, which is chrome outranking the pattern', () => {
    // The other side of the rule, and the reason handles ask a narrower question
    // than bodies do: a crease under a handle must not take its press, or an
    // object over a dense pattern could not be sized at all.
    const pressed = stubClaim('crease');
    const started: string[] = [];
    render({
      objects: [object('a')],
      selectedId: 'a',
      onGestureStart: (id) => {
        started.push(id);
      },
    });

    const handle = container!.querySelector('rect') as SVGRectElement;
    pressElement(handle);
    // The press itself opens nothing — a click must not hold the undo bracket.
    // The first move does.
    expect(started).toEqual([]);
    act(() => {
      handle.dispatchEvent(pointerEvent('pointermove', 80, 80));
    });

    expect(pressed).toEqual([]);
    expect(started).toEqual(['a']);
  });

  it('never opens the undo bracket for a click, and drops it on cancel', () => {
    const started: string[] = [];
    const cancelled: string[] = [];
    const commits: string[] = [];
    render({
      objects: [object('a')],
      selectedId: null,
      onGestureStart: (id) => {
        started.push(id);
      },
      onGestureCancel: (id) => {
        cancelled.push(id);
      },
      onGestureCommit: (_id, kind) => commits.push(kind),
    });
    const body = bodyPolygon();
    if (!body) throw new Error('no body polygon');
    stubCapture(body);

    // A click: press and release, no move.
    act(() => {
      body.dispatchEvent(pointerEvent('pointerdown', 50, 50));
      body.dispatchEvent(pointerEvent('pointerup', 50, 50));
    });
    expect(started).toEqual([]);
    expect(commits).toEqual([]);
    expect(cancelled).toEqual([]);

    // A drag that is cancelled: the bracket opened on the first move is
    // dropped, not left for a later commit to close.
    act(() => {
      body.dispatchEvent(pointerEvent('pointerdown', 50, 50));
      body.dispatchEvent(pointerEvent('pointermove', 70, 50));
      body.dispatchEvent(pointerEvent('pointercancel', 70, 50));
    });
    expect(started).toEqual(['a']);
    expect(cancelled).toEqual(['a']);
    expect(commits).toEqual([]);
  });

  it('does not start a drag whose bracket is refused', () => {
    const patches: CanvasObjectBoxUpdate[] = [];
    render({
      objects: [object('a')],
      selectedId: null,
      onUpdate: (_id, patch) => patches.push(patch),
      onGestureStart: () => false,
    });
    const body = bodyPolygon();
    if (!body) throw new Error('no body polygon');
    stubCapture(body);
    act(() => {
      body.dispatchEvent(pointerEvent('pointerdown', 50, 50));
      body.dispatchEvent(pointerEvent('pointermove', 70, 50));
      body.dispatchEvent(pointerEvent('pointermove', 90, 50));
      body.dispatchEvent(pointerEvent('pointerup', 90, 50));
    });
    // Nothing was written: a move that could not be recorded must not happen.
    expect(patches).toEqual([]);
  });

  /**
   * The cursor half. Read from the held-modifier state rather than from the last
   * pointer event, because pressing Cmd with the pointer already at rest over an
   * object fires no pointer event at all — and the glyph still has to change.
   */
  describe('cursor', () => {
    afterEach(() => clearHeldModifiers());

    function holdMeta(): void {
      act(() => {
        syncHeldModifiersFromEvent({
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          metaKey: true,
        });
      });
    }

    it('says grab on every body while the modifier is held', () => {
      stubClaim(null);
      render({ objects: [object('a')], selectedId: 'a' });
      const body = bodyPolygon()!;
      expect(body.style.cursor).toBe('move');

      holdMeta();

      expect(body.style.cursor).toBe('grab');
    });

    it('says grab on the resize handles too, which would pan rather than size', () => {
      stubClaim(null);
      render({ objects: [object('a')], selectedId: 'a' });
      const handle = container!.querySelector('rect') as SVGRectElement;
      expect(handle.style.cursor).toBe('pointer');

      holdMeta();

      expect(handle.style.cursor).toBe('grab');
    });

    it('says grab under the hand tool, for which every drag pans', () => {
      stubClaim(null);
      render({ objects: [object('a')], selectedId: 'a', panToolActive: true });

      expect(bodyPolygon()!.style.cursor).toBe('grab');
      expect((container!.querySelector('rect') as SVGRectElement).style.cursor).toBe('grab');
    });
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

/*
 * The handles for a mouse and for a finger (Diagram Revision 3, 18d follow-up).
 * A mouse's are drawn exactly as they were before the box was shared, byte for
 * byte; a finger's sit further apart and each has a touch target round it.
 */
describe('CanvasObjectOverlay handles, a mouse and a finger', () => {
  /** A reference image's box, turned, so every handle sits off the axes. */
  function image(): TransformableCanvasObject {
    return { ...object('a'), box: { center: { x: 50, y: 50 }, width: 60, height: 30, rotation: 0.3 }, aspectLock: 'default-on' };
  }

  /** Everything drawn for the selected object's handles. */
  const handles = () => container!.querySelector('svg > g')!.outerHTML;

  /** The patches a drag from `from` by `by` sends, pressed on `element`. */
  function dragOn(element: Element, from: [number, number], by: [number, number]): CanvasObjectBoxUpdate[] {
    stubCapture(element as SVGElement);
    const patches: CanvasObjectBoxUpdate[] = [];
    updates = patches;
    act(() => {
      element.dispatchEvent(pointerEvent('pointerdown', ...from));
      element.dispatchEvent(pointerEvent('pointermove', from[0] + by[0], from[1] + by[1]));
      element.dispatchEvent(pointerEvent('pointerup', from[0] + by[0], from[1] + by[1]));
    });
    return patches;
  }
  let updates: CanvasObjectBoxUpdate[] = [];
  const renderRecording = (objects: TransformableCanvasObject[]) => render({ objects, onUpdate: (_id, patch) => updates.push(patch) });

  it('takes a mouse’s square to the pointer, as it always has', () => {
    // A 40 × 40 box about (50, 50): its se corner at (70, 70), the nw held at (30, 30). Pressed 2 px right of the
    // square's middle and 1 px below it, and moved 10 px each way: the corner goes to the pointer, 52 × 51.
    renderRecording([object('a')]);
    const [patch] = dragOn(container!.querySelectorAll('rect')[4]!, [72, 71], [10, 10]);
    expect(patch?.width).toBeCloseTo(52, 9);
    expect(patch?.height).toBeCloseTo(51, 9);
  });

  describe('for a finger', () => {
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
      Reflect.deleteProperty(window, 'matchMedia');
    });

    /** `by` px out from the se corner of `object('a')`'s box, (70, 70), along the line from its middle. */
    const outFromSe = (by: number): [number, number] => [70 + by / Math.SQRT2, 70 + by / Math.SQRT2];

    it('draws 12 px squares and 7 px turn handles 44 px out, each with a 22 px target outside the box', () => {
      renderRecording([object('a')]);
      const squares = [...container!.querySelectorAll('rect')];
      expect(squares.map((square) => square.getAttribute('width'))).toEqual(Array(8).fill('12'));
      const turns = [...container!.querySelectorAll('circle:not([data-touch-target])')];
      expect(turns.map((turn) => turn.getAttribute('r'))).toEqual(['7', '7', '7', '7']);
      const [x, y] = outFromSe(44);
      expect(Number(turns[2]!.getAttribute('cx'))).toBeCloseTo(x, 9);
      expect(Number(turns[2]!.getAttribute('cy'))).toBeCloseTo(y, 9);
      const targets = [...container!.querySelectorAll('[data-touch-target]')];
      expect(targets.map((target) => target.getAttribute('data-touch-target'))).toEqual([
        'rotate-nw',
        'rotate-ne',
        'rotate-se',
        'rotate-sw',
        'scale-nw',
        'scale-n',
        'scale-ne',
        'scale-e',
        'scale-se',
        'scale-s',
        'scale-sw',
        'scale-w',
      ]);
      for (const target of targets) expect(target.getAttribute('r')).toBe('22');
      // Clipped to everything but the box: inside it a press is the body's.
      const clip = /^url\(#(.+)\)$/.exec(targets[0]!.parentElement!.getAttribute('clip-path') ?? '')?.[1];
      const outside = container!.querySelector(`clipPath[id="${clip}"] path`)!;
      expect(outside.getAttribute('clip-rule')).toBe('evenodd');
      expect(outside.getAttribute('d')).toContain('M 30 30 L 70 30 L 70 70 L 30 70 Z');
      // Under the handles as drawn, which keep their own presses.
      expect(container!.querySelector('svg > g')!.firstElementChild!.tagName.toLowerCase()).toBe('defs');
    });

    it('draws a finger’s square out by its travel since the press, so a press off its middle does not jump the box', () => {
      // As the mouse's case above: 50 × 50, the centre moved 5 each way, not 52 × 51.
      renderRecording([object('a')]);
      const [patch] = dragOn(container!.querySelectorAll('rect')[4]!, [72, 71], [10, 10]);
      expect(patch?.width).toBeCloseTo(50, 9);
      expect(patch?.height).toBeCloseTo(50, 9);
      expect(patch?.center).toEqual({ x: 55, y: 55 });
    });

    it('takes a press 14 px wide of a corner as its square, not its turn handle, and draws it out without a jump', () => {
      renderRecording([object('a')]);
      const [patch] = dragOn(container!.querySelector('[data-touch-target="scale-se"]')!, outFromSe(14), [10, 10]);
      expect(patch).not.toHaveProperty('rotation');
      expect(patch?.width).toBeCloseTo(50, 9);
      expect(patch?.height).toBeCloseTo(50, 9);
    });

    it('gives a press where two targets overlap to the nearer handle, whichever disc it landed on', () => {
      renderRecording([object('a')]);
      // 14 px out is in the square's target alone; pressed on the turn handle's disc, it is still the square's.
      const [square] = dragOn(container!.querySelector('[data-touch-target="rotate-se"]')!, outFromSe(14), [10, 10]);
      expect(square?.width).toBeCloseTo(50, 9);
      // 30 px out, the turn handle's: a drag across it turns the box.
      const [turn] = dragOn(container!.querySelector('[data-touch-target="rotate-se"]')!, outFromSe(30), [-10, 10]);
      expect(Object.keys(turn ?? {})).toEqual(['rotation']);
      expect(turn?.rotation).toBeGreaterThan(0);
    });

    it('offers no turn targets while cropping, as it draws no turn handles', () => {
      renderRecording([object('a')]);
      act(() => {
        root?.render(
          <CanvasObjectOverlay objects={[object('a')]} selectedId="a" suppressedId={null} interactive canCrop={() => true} onSelect={() => {}} onUpdate={() => {}} />
        );
      });
      const body = bodyPolygon()!;
      act(() => void body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      const targets = [...container!.querySelectorAll('[data-touch-target]')].map((target) => target.getAttribute('data-touch-target'));
      expect(targets).toHaveLength(8);
      expect(targets.every((name) => name?.startsWith('scale-'))).toBe(true);
    });
  });

  it('draws a mouse’s handles exactly as before: no touch targets, nothing moved or resized', () => {
    render({ objects: [image()] });
    expect(container!.querySelectorAll('[data-touch-target]')).toHaveLength(0);
    expect(handles()).toMatchInlineSnapshot(`"<g><circle cx="12.77097941739219" cy="14.35625252151999" r="5" fill="var(--bg-primary, #202430)" stroke="var(--accent-primary, #4c9aff)" stroke-width="1.5" style="pointer-events: auto; cursor: grab; vector-effect: non-scaling-stroke;"></circle><circle cx="100.85241033234871" cy="41.60303202100175" r="5" fill="var(--bg-primary, #202430)" stroke="var(--accent-primary, #4c9aff)" stroke-width="1.5" style="pointer-events: auto; cursor: grab; vector-effect: non-scaling-stroke;"></circle><circle cx="87.22902058260782" cy="85.64374747848001" r="5" fill="var(--bg-primary, #202430)" stroke="var(--accent-primary, #4c9aff)" stroke-width="1.5" style="pointer-events: auto; cursor: grab; vector-effect: non-scaling-stroke;"></circle><circle cx="-0.8524103323486969" cy="58.39696797899825" r="5" fill="var(--bg-primary, #202430)" stroke="var(--accent-primary, #4c9aff)" stroke-width="1.5" style="pointer-events: auto; cursor: grab; vector-effect: non-scaling-stroke;"></circle><rect x="21.772708426151915" y="22.804346463275724" width="8" height="8" fill="var(--bg-primary, #202430)" stroke="var(--accent-primary, #4c9aff)" stroke-width="1.5" style="pointer-events: auto; cursor: pointer; vector-effect: non-scaling-stroke;"></rect><rect x="50.43280309992009" y="31.669952663115907" width="8" height="8" fill="var(--bg-primary, #202430)" stroke="var(--accent-primary, #4c9aff)" stroke-width="1.5" style="pointer-events: auto; cursor: pointer; vector-effect: non-scaling-stroke;"></rect><rect x="79.09289777368828" y="40.535558862956094" width="8" height="8" fill="var(--bg-primary, #202430)" stroke="var(--accent-primary, #4c9aff)" stroke-width="1.5" style="pointer-events: auto; cursor: pointer; vector-effect: non-scaling-stroke;"></rect><rect x="74.66009467376819" y="54.86560619984019" width="8" height="8" fill="var(--bg-primary, #202430)" stroke="var(--accent-primary, #4c9aff)" stroke-width="1.5" style="pointer-events: auto; cursor: pointer; vector-effect: non-scaling-stroke;"></rect><rect x="70.22729157384809" y="69.19565353672428" width="8" height="8" fill="var(--bg-primary, #202430)" stroke="var(--accent-primary, #4c9aff)" stroke-width="1.5" style="pointer-events: auto; cursor: pointer; vector-effect: non-scaling-stroke;"></rect><rect x="41.56719690007991" y="60.33004733688409" width="8" height="8" fill="var(--bg-primary, #202430)" stroke="var(--accent-primary, #4c9aff)" stroke-width="1.5" style="pointer-events: auto; cursor: pointer; vector-effect: non-scaling-stroke;"></rect><rect x="12.907102226311729" y="51.464441137043906" width="8" height="8" fill="var(--bg-primary, #202430)" stroke="var(--accent-primary, #4c9aff)" stroke-width="1.5" style="pointer-events: auto; cursor: pointer; vector-effect: non-scaling-stroke;"></rect><rect x="17.339905326231822" y="37.13439380015981" width="8" height="8" fill="var(--bg-primary, #202430)" stroke="var(--accent-primary, #4c9aff)" stroke-width="1.5" style="pointer-events: auto; cursor: pointer; vector-effect: non-scaling-stroke;"></rect></g>"`);
  });
});
