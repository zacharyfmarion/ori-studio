import { describe, expect, it } from 'vitest';
import {
  createCpTouchArbiter,
  isCoarsePointer,
  type CpGesturePointer,
  type CpTouchArbiter,
} from './cpTouchArbiter';

const finger = (id: number, x: number, y: number): CpGesturePointer => ({
  pointerId: id,
  pointerType: 'touch',
  clientX: x,
  clientY: y,
});

const pen = (id: number, x: number, y: number): CpGesturePointer => ({
  ...finger(id, x, y),
  pointerType: 'pen',
});

const mouse = (id: number, x: number, y: number): CpGesturePointer => ({
  ...finger(id, x, y),
  pointerType: 'mouse',
});

/** A `PointerEvent` built by hand (jsdom, synthetic tests) reports no type. */
const synthetic = (id: number, x: number, y: number): CpGesturePointer => ({
  ...finger(id, x, y),
  pointerType: '',
});

interface GestureStep {
  kind: 'down' | 'move' | 'up';
  pointer: CpGesturePointer;
}

const down = (pointer: CpGesturePointer): GestureStep => ({ kind: 'down', pointer });
const move = (pointer: CpGesturePointer): GestureStep => ({ kind: 'move', pointer });
const up = (pointer: CpGesturePointer): GestureStep => ({ kind: 'up', pointer });

/** Every action a whole pointer sequence produced, in order. */
const actionsOf = (arbiter: CpTouchArbiter, steps: readonly GestureStep[]): string[] =>
  steps.map((step) => {
    if (step.kind === 'down') return arbiter.down(step.pointer).action;
    if (step.kind === 'move') return arbiter.move(step.pointer).action;
    return arbiter.up(step.pointer).action;
  });

type PointerMaker = (id: number, x: number, y: number) => CpGesturePointer;

describe('isCoarsePointer', () => {
  it('is true only for touch', () => {
    expect(isCoarsePointer('touch')).toBe(true);
    expect(isCoarsePointer('pen')).toBe(false);
    expect(isCoarsePointer('mouse')).toBe(false);
    // An unknown or absent type defaults to precision, so a synthesised event
    // keeps the pre-existing single-pointer behaviour.
    expect(isCoarsePointer('')).toBe(false);
    expect(isCoarsePointer('trackpad')).toBe(false);
  });
});

describe('single-pointer sequences are untouched', () => {
  const makers: readonly [string, PointerMaker][] = [
    ['mouse', mouse],
    ['pen', pen],
    ['synthetic', synthetic],
    ['touch', finger],
  ];

  it.each(makers)('forwards a whole %s press-drag-release', (_label, make) => {
    const arbiter = createCpTouchArbiter();
    expect(
      actionsOf(arbiter, [
        down(make(1, 10, 10)),
        move(make(1, 40, 30)),
        move(make(1, 80, 60)),
        up(make(1, 80, 60)),
      ])
    ).toEqual(['forward', 'forward', 'forward', 'forward']);
    expect(arbiter.contactCount()).toBe(0);
  });

  it('never reports a transform for a lone contact', () => {
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 10, 10));
    expect(arbiter.isTransforming()).toBe(false);
    expect(arbiter.move(finger(1, 60, 10)).action).toBe('forward');
  });

  it('forwards a second button on the same physical pointer', () => {
    // A right-click while the left is held re-fires `pointerdown` with the same
    // id. That is how the canvas' erase gesture is claimed mid-drag, so it must
    // keep reaching the tool chain and must not abort anything.
    const arbiter = createCpTouchArbiter();
    arbiter.down(mouse(1, 10, 10));
    const second = arbiter.down(mouse(1, 12, 11));
    expect(second).toEqual({ action: 'forward', abort: [] });
    expect(arbiter.contactCount()).toBe(1);
  });
});

describe('a second finger lands mid-draw', () => {
  // The observed bug, as a sequence: on a real iPad, finger 2 relocated the
  // Line tool's crease start and finger 1's release committed the crease, so a
  // pinch drew geometry and did not zoom.
  it('converts the gesture instead of starting a second one', () => {
    const arbiter = createCpTouchArbiter();
    expect(arbiter.down(finger(1, 100, 100)).action).toBe('forward');
    expect(arbiter.move(finger(1, 110, 100)).action).toBe('forward');

    const second = arbiter.down(finger(2, 300, 100));
    expect(second.action).toBe('transform');
    // The signal the canvas needs to take back what finger 1 started.
    expect(second.abort).toEqual(['canvas']);
    expect(arbiter.isTransforming()).toBe(true);
  });

  it('never forwards another event from either finger for the rest of the gesture', () => {
    const arbiter = createCpTouchArbiter();
    const actions = actionsOf(arbiter, [
      down(finger(1, 100, 100)),
      move(finger(1, 110, 100)),
      down(finger(2, 300, 100)),
      move(finger(1, 90, 100)),
      move(finger(2, 310, 100)),
      up(finger(1, 90, 100)),
      // Finger 1 is gone and finger 2 is still down: it keeps driving the
      // camera rather than starting a crease of its own.
      move(finger(2, 340, 120)),
      up(finger(2, 340, 120)),
    ]);
    expect(actions).toEqual([
      'forward',
      'forward',
      'transform',
      'transform',
      'transform',
      'ignore',
      'transform',
      'ignore',
    ]);
    expect(arbiter.contactCount()).toBe(0);
  });

  it('aborts only once, however many fingers land', () => {
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    expect(arbiter.down(finger(2, 200, 100)).abort).toEqual(['canvas']);
    // A third finger joins a gesture that already owns the surface, so there is
    // nothing left in flight to roll back.
    expect(arbiter.down(finger(3, 300, 100))).toEqual({
      action: 'transform',
      abort: [],
    });
  });

  it('starts clean once every finger has lifted', () => {
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    arbiter.down(finger(2, 200, 100));
    arbiter.up(finger(1, 100, 100));
    arbiter.up(finger(2, 200, 100));
    expect(arbiter.isTransforming()).toBe(false);
    expect(arbiter.down(finger(3, 150, 150))).toEqual({
      action: 'forward',
      abort: [],
    });
  });

  it('treats pointercancel as a lift', () => {
    // iOS raises `pointercancel` freely — a system edge gesture, a call
    // arriving — and it arrives through the same `up` path.
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    arbiter.down(finger(2, 200, 100));
    expect(arbiter.up(finger(2, 200, 100)).action).toBe('ignore');
    expect(arbiter.up(finger(1, 100, 100)).action).toBe('ignore');
    expect(arbiter.contactCount()).toBe(0);
    expect(arbiter.isTransforming()).toBe(false);
  });

  it('forwards a cancel for a contact that never became a camera gesture', () => {
    // The canvas needs this one: only a forwarded release reaches
    // `cpPointerReleaseRoute`, which is where `cancelled` rolls the tool back.
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    expect(arbiter.up(finger(1, 100, 100)).action).toBe('forward');
  });
});

describe('camera samples', () => {
  it('reports no movement on the first sample of a new contact set', () => {
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    arbiter.down(finger(2, 200, 100));
    const first = arbiter.move(finger(1, 100, 100));
    expect(first).toEqual({
      action: 'transform',
      transform: { dx: 0, dy: 0, scale: 1 },
      anchor: { x: 150, y: 100 },
    });
  });

  it('anchors the zoom at the centroid the sample started from', () => {
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    arbiter.down(finger(2, 200, 100));
    // Both fingers move outward by 50 in one sample each; the anchor each time
    // is where the centroid was *before* that sample.
    const a = arbiter.move(finger(1, 50, 100));
    expect(a.action === 'transform' && a.anchor).toEqual({ x: 150, y: 100 });
    const b = arbiter.move(finger(2, 250, 100));
    expect(b.action === 'transform' && b.anchor).toEqual({ x: 125, y: 100 });
  });

  it('accumulates staggered per-finger samples into the whole spread change', () => {
    // A pinch delivers one `pointermove` per finger, so the camera is driven
    // from half-updated pairs. Frame-to-frame differencing makes each of those
    // a valid sample, and the product of the samples is the real ratio.
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    arbiter.down(finger(2, 200, 100));
    arbiter.move(finger(1, 100, 100)); // rebase sample
    const a = arbiter.move(finger(1, 50, 100));
    const b = arbiter.move(finger(2, 250, 100));
    const product =
      (a.action === 'transform' ? a.transform.scale : 1) *
      (b.action === 'transform' ? b.transform.scale : 1);
    expect(product).toBeCloseTo(2, 10);
  });

  it('contributes no jump when a third finger joins mid-pinch', () => {
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    arbiter.down(finger(2, 200, 100));
    arbiter.move(finger(1, 100, 100));
    arbiter.down(finger(3, 150, 300));
    const sample = arbiter.move(finger(3, 150, 300));
    expect(sample).toEqual({
      action: 'transform',
      transform: { dx: 0, dy: 0, scale: 1 },
      anchor: { x: 150, y: 500 / 3 },
    });
  });

  it('degrades to a pan when one finger of a pinch lifts', () => {
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    arbiter.down(finger(2, 200, 100));
    arbiter.up(finger(1, 100, 100));
    const sample = arbiter.move(finger(2, 240, 130));
    expect(sample).toEqual({
      action: 'transform',
      transform: { dx: 40, dy: 30, scale: 1 },
      anchor: { x: 200, y: 100 },
    });
  });

  it('silences hover while the camera gesture runs', () => {
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    arbiter.down(finger(2, 200, 100));
    expect(arbiter.move(mouse(9, 10, 10)).action).toBe('ignore');
    expect(arbiter.up(mouse(9, 10, 10)).action).toBe('ignore');
  });
});

describe('events with no press behind them', () => {
  // The regression this guards: a mouse or Pencil hovering the canvas has never
  // pressed, so it has no contact — and hover is what drives the snap indicator
  // and every tool preview. Treating "untracked" as "inert" would kill all of it.
  it('forwards a hover move', () => {
    const arbiter = createCpTouchArbiter();
    expect(arbiter.move(mouse(1, 10, 10)).action).toBe('forward');
    expect(arbiter.move(pen(2, 10, 10)).action).toBe('forward');
  });

  it('forwards a release whose press landed somewhere else', () => {
    // Pressing a text label on the DOM overlay above the canvas and releasing
    // over the canvas: the release routing already handles it through its own
    // flags, and its tail is what clears every stale gesture flag.
    const arbiter = createCpTouchArbiter();
    expect(arbiter.up(mouse(1, 10, 10)).action).toBe('forward');
  });

  it('forwards hover beside an inert finger', () => {
    // A palm is down and the Pencil is hovering rather than touching: nothing is
    // driving the camera, so the hover preview stays live.
    const arbiter = createCpTouchArbiter();
    arbiter.down(pen(1, 50, 50));
    arbiter.down(finger(2, 300, 300));
    arbiter.up(pen(1, 50, 50));
    expect(arbiter.move(pen(1, 60, 50)).action).toBe('forward');
  });
});

describe('a precision pointer owns the surface', () => {
  it('makes a finger arriving beside a Pencil inert', () => {
    // Palm rejection, stated as a rule rather than inferred from geometry: the
    // Pencil is the precision instrument, so nothing a hand does while it is
    // down reaches the tool chain or moves the camera.
    const arbiter = createCpTouchArbiter();
    expect(
      actionsOf(arbiter, [
        down(pen(1, 100, 100)),
        move(pen(1, 120, 100)),
        down(finger(2, 300, 300)),
        move(finger(2, 320, 300)),
        down(finger(3, 340, 300)),
        move(pen(1, 140, 100)),
        up(finger(2, 320, 300)),
        up(pen(1, 140, 100)),
      ])
    ).toEqual([
      'forward',
      'forward',
      'ignore',
      'ignore',
      'ignore',
      'forward',
      'ignore',
      'forward',
    ]);
  });

  it('preempts a finger that was already drawing, and says so', () => {
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    const penDown = arbiter.down(pen(2, 200, 200));
    expect(penDown).toEqual({ action: 'forward', abort: ['canvas'] });
    // The finger is now inert, not still drawing.
    expect(arbiter.move(finger(1, 150, 100)).action).toBe('ignore');
    expect(arbiter.up(finger(1, 150, 100)).action).toBe('ignore');
  });

  it('rolls back a precision press it takes the surface from', () => {
    // An iPad carries a trackpad pointer and a Pencil at once, so "the previous
    // press was a finger" is not the condition. A mouse drag that was drawing
    // has exactly as much in flight as a finger's, and skipping the rollback
    // leaves its half-drawn state behind while the Pencil's press re-enters the
    // tool chain — the double entry this module exists to prevent.
    const arbiter = createCpTouchArbiter();
    arbiter.down(mouse(1, 100, 100));
    expect(arbiter.down(pen(2, 200, 200)).abort).toEqual(['canvas']);
    expect(arbiter.move(mouse(1, 150, 100)).action).toBe('ignore');
  });

  it('takes over a pinch without claiming anything was in flight', () => {
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    arbiter.down(finger(2, 200, 100));
    // A camera gesture has touched no document state, so there is nothing to
    // roll back — only the surface changes hands.
    expect(arbiter.down(mouse(3, 50, 50))).toEqual({
      action: 'forward',
      abort: [],
    });
    expect(arbiter.isTransforming()).toBe(false);
  });
});


describe('the surface is wider than the canvas', () => {
  // The reported bug: pinching with one finger resting on a folded figure
  // dragged the figure and drew with the other finger. Windows and images are
  // grabbed through `CanvasObjectOverlay`, which captures the pointer, so that
  // contact reaches this arbiter tagged `overlay` and never as a canvas press.
  it('counts a finger on the overlay toward the pinch', () => {
    const arbiter = createCpTouchArbiter();
    expect(arbiter.down(finger(1, 100, 100), 'overlay').action).toBe('forward');

    // Rule 3 applies across layers: this is the second finger on the *surface*,
    // whatever it landed on. Before, it looked like the only one and drew.
    const second = arbiter.down(finger(2, 300, 100), 'canvas');
    expect(second.action).toBe('transform');
    expect(arbiter.isTransforming()).toBe(true);
  });

  it('names the overlay as the layer that must roll its drag back', () => {
    // The half a canvas-scoped arbiter could not express: the layer losing a
    // press is not the layer that asked.
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100), 'overlay');
    expect(arbiter.down(finger(2, 300, 100), 'canvas').abort).toEqual(['overlay']);
  });

  it('names the canvas when the fingers arrive the other way round', () => {
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100), 'canvas');
    expect(arbiter.down(finger(2, 300, 100), 'overlay').abort).toEqual(['canvas']);
  });

  it('measures the pinch from both fingers, wherever they landed', () => {
    // The point of tracking the overlay's contact rather than merely refusing
    // it: a contact the arbiter does not hold contributes no spread, so the
    // gesture would pan and never zoom.
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100), 'overlay');
    arbiter.down(finger(2, 200, 100), 'canvas');
    arbiter.move(finger(1, 100, 100)); // rebase sample
    const sample = arbiter.move(finger(1, 0, 100));
    expect(sample.action === 'transform' && sample.transform.scale).toBeCloseTo(2, 10);
  });

  it('keeps the overlay inert for the rest of the gesture', () => {
    // Same rule as the canvas': if lifting one finger of a pinch resumed the
    // window drag with the other, the bug would just move.
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100), 'overlay');
    arbiter.down(finger(2, 300, 100), 'canvas');
    expect(arbiter.up(finger(2, 300, 100)).action).toBe('ignore');
    expect(arbiter.move(finger(1, 140, 100)).action).toBe('transform');
    expect(arbiter.up(finger(1, 140, 100)).action).toBe('ignore');
  });

  it('leaves a lone press on the overlay forwarding, as it always did', () => {
    // One finger on a window still drags it, start to finish. The fix is about
    // the second finger, and this is what says it cost nothing to the first.
    const arbiter = createCpTouchArbiter();
    expect(arbiter.down(finger(1, 100, 100), 'overlay').action).toBe('forward');
    expect(arbiter.move(finger(1, 130, 120)).action).toBe('forward');
    expect(arbiter.up(finger(1, 130, 120)).action).toBe('forward');
    expect(arbiter.contactCount()).toBe(0);
  });

  it('lets a Pencil preempt a window drag', () => {
    // Rule 1 reaches across layers too: what it takes back is any forwarded
    // press, and the overlay's is as much in flight as the canvas'.
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100), 'overlay');
    expect(arbiter.down(pen(2, 200, 200), 'canvas')).toEqual({
      action: 'forward',
      abort: ['overlay'],
    });
  });
});

describe('reset', () => {
  it('drops every contact so a rebuilt surface starts idle', () => {
    const arbiter = createCpTouchArbiter();
    arbiter.down(finger(1, 100, 100));
    arbiter.down(finger(2, 200, 100));
    arbiter.reset();
    expect(arbiter.contactCount()).toBe(0);
    expect(arbiter.isTransforming()).toBe(false);
    expect(arbiter.down(finger(1, 10, 10)).action).toBe('forward');
  });
});
