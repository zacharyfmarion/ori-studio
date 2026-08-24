import { describe, expect, it } from 'vitest';
import { formatOrbitGesture } from './simulatorPerfProbe';

/**
 * The orbit line's arithmetic, driven directly.
 *
 * `formatOrbitGesture` is exported for this: the numbers *are* the diagnosis —
 * whether a drag was slow because each frame cost too much or because the
 * messages piled up behind each other — and driving them through real pointer
 * events would test the browser's input coalescing instead of this.
 */

function gesture(overrides: Partial<Parameters<typeof formatOrbitGesture>[0]> = {}) {
  return {
    surface: 'simulate-panel',
    startedAt: 1000,
    moves: 0,
    msgs: 0,
    replies: 0,
    latencyTotalMs: 0,
    latencyMaxMs: 0,
    peakInFlight: 0,
    releasedAt: null,
    inFlightAtRelease: 0,
    lastReplyAt: 0,
    reprojects: 0,
    reprojectTotalMs: 0,
    reprojectMaxMs: 0,
    ...overrides,
  };
}

describe('formatOrbitGesture', () => {
  it('says nothing for a press that never moved', () => {
    // A click is not a drag. Emitting for one would bury the gestures the log
    // exists to show in a list of clicks that cost nothing.
    expect(formatOrbitGesture(gesture({ releasedAt: 1100 }), 1100)).toBeNull();
  });

  it('reports a drag the worker kept up with as draining immediately', () => {
    const line = formatOrbitGesture(
      gesture({
        moves: 60,
        msgs: 60,
        replies: 60,
        latencyTotalMs: 60 * 4,
        latencyMaxMs: 9,
        peakInFlight: 1,
        releasedAt: 2000,
        inFlightAtRelease: 0,
        lastReplyAt: 2000,
      }),
      2000
    );
    expect(line).toContain('1000ms held');
    expect(line).toContain('60 moves (60/s) -> 60 msgs, 60 replies');
    expect(line).toContain('latency 4.0ms avg');
    expect(line).toContain('in-flight peak 1, 0 at release');
    expect(line).toContain('drain 0ms');
  });

  it('reports a backed-up queue as depth at release plus drain time', () => {
    // The shape this whole probe exists for: every render is individually fine,
    // the pointer outruns the worker, and the fold keeps turning after release.
    // Nothing in the per-render averages can distinguish this from the case
    // above — these two fields are what do.
    const line = formatOrbitGesture(
      gesture({
        moves: 120,
        msgs: 120,
        replies: 95,
        latencyTotalMs: 95 * 210,
        latencyMaxMs: 480,
        peakInFlight: 25,
        releasedAt: 2000,
        inFlightAtRelease: 25,
        lastReplyAt: 2600,
      }),
      2600
    );
    expect(line).toContain('120 moves (120/s) -> 120 msgs, 95 replies');
    expect(line).toContain('latency 210.0ms avg / 480.0 max');
    expect(line).toContain('in-flight peak 25, 25 at release');
    expect(line).toContain('drain 600ms');
  });

  it('omits reprojection entirely when none ran', () => {
    // Rather than printing a zero, which reads as "measured, and free" for a
    // surface that never takes that path at all.
    const line = formatOrbitGesture(gesture({ moves: 10, msgs: 10, releasedAt: 1100 }), 1100);
    expect(line).not.toContain('reproject');
  });

  it('reports main-thread reprojection for an unwindowed figure', () => {
    const line = formatOrbitGesture(
      gesture({
        surface: 'folded-2d-reproject',
        moves: 40,
        reprojects: 40,
        reprojectTotalMs: 40 * 18,
        reprojectMaxMs: 42,
        releasedAt: 2000,
        lastReplyAt: 0,
      }),
      2000
    );
    expect(line).toContain('folded-2d-reproject');
    // No worker traffic at all on this path, which is exactly why it needed its
    // own number: zero messages and still a slow drag.
    expect(line).toContain('0 msgs');
    expect(line).toContain('reproject 18.0ms avg / 42.0 max x40');
  });

  it('measures an unreleased gesture up to now, so a lost pointer still reports', () => {
    const line = formatOrbitGesture(gesture({ moves: 5, msgs: 5, startedAt: 1000 }), 1750);
    expect(line).toContain('750ms held');
  });
});
