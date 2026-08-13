import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimWheelBurst, endWheelBurst, forwardWheel } from './wheelBurst';

/**
 * Ownership of a wheel gesture. What matters is that it survives the cursor
 * moving — that is the whole point — and that it does not survive the gesture
 * itself, or the next flick would be delivered to whatever the last one hit.
 */

let a: HTMLDivElement;
let b: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  endWheelBurst();
  a = document.createElement('div');
  b = document.createElement('div');
});

afterEach(() => {
  endWheelBurst();
  vi.useRealTimers();
});

describe('claimWheelBurst', () => {
  it('keeps the first claimant as owner while the gesture is in flight', () => {
    expect(claimWheelBurst(a).owner).toBe(a);
    // The cursor has moved onto `b`; the gesture has not changed hands.
    expect(claimWheelBurst(b).owner).toBe(a);
    vi.advanceTimersByTime(200);
    expect(claimWheelBurst(b).owner).toBe(a);
  });

  it('reports one identity for the whole gesture, and a new one for the next', () => {
    const first = claimWheelBurst(a).id;
    // Several handlers claim per event — the object, then the surface it
    // forwards to — and all of them are the same gesture.
    expect(claimWheelBurst(a).id).toBe(first);
    vi.advanceTimersByTime(1000);
    expect(claimWheelBurst(a).id).not.toBe(first);
  });

  it('hands the next gesture to whoever it starts on', () => {
    claimWheelBurst(a);
    // Long enough that the wheel has gone quiet: momentum is over, fingers are
    // off, this is someone starting again somewhere else.
    vi.advanceTimersByTime(1000);
    expect(claimWheelBurst(b).owner).toBe(b);
  });

  it('extends the gesture from its last event, not its first', () => {
    claimWheelBurst(a);
    // A long flick: events keep arriving inside the idle window, so it stays one
    // gesture however long it runs.
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(200);
      claimWheelBurst(b);
    }
    expect(claimWheelBurst(b).owner).toBe(a);
  });
});

describe('forwardWheel', () => {
  it('delivers the deltas and the modifiers that decide pan from zoom', () => {
    const seen: WheelEvent[] = [];
    b.addEventListener('wheel', (event) => seen.push(event as WheelEvent));

    forwardWheel(
      b,
      new WheelEvent('wheel', { deltaX: 3, deltaY: -7, ctrlKey: true, bubbles: true })
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.deltaX).toBe(3);
    expect(seen[0]?.deltaY).toBe(-7);
    expect(seen[0]?.ctrlKey).toBe(true);
    // Non-bubbling, so it cannot walk back up through whatever forwarded it.
    expect(seen[0]?.bubbles).toBe(false);
    expect(seen[0]?.cancelable).toBe(true);
  });
});
