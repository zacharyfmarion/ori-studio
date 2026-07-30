import { describe, expect, it } from 'vitest';
import { FoldPlayhead } from './foldPlayhead';

describe('fold playhead', () => {
  it('rewinds to flat when play starts from a complete fold', () => {
    const playhead = new FoldPlayhead(100);
    expect(playhead.begin()).toEqual({ from: 0, rewound: true });
    expect(playhead.value).toBe(0);
  });

  it('resumes in place when play starts part way through', () => {
    const playhead = new FoldPlayhead(40);
    expect(playhead.begin()).toEqual({ from: 40, rewound: false });
  });

  it('ignores a frame that was already in flight when playback rewound', () => {
    // The regression. Pressing play on a fully folded window rewinds to flat,
    // but a frame the solver dispatched beforehand lands afterwards still
    // carrying 100. When both wrote to one value the late frame won, the next
    // step read 100, and playback ended instantly having commanded the fold
    // back to exactly where it started. Which is what the user saw: a snap.
    const playhead = new FoldPlayhead(100);
    playhead.begin();

    playhead.report(100);

    expect(playhead.value).toBe(0);
    expect(playhead.advance(0.1, 50)).toBeCloseTo(5);
  });

  it('takes frames again once playback ends', () => {
    const playhead = new FoldPlayhead(0);
    playhead.begin();
    playhead.end();
    playhead.report(62);
    expect(playhead.value).toBe(62);
  });

  it('accepts a deliberate move even mid-playback', () => {
    // Scrub, nudge and jump are the user talking. Dropping those would trade
    // one silent failure for another.
    const playhead = new FoldPlayhead(10);
    playhead.begin();
    playhead.set(80);
    expect(playhead.value).toBe(80);
  });

  it('advances at the requested rate and stops at fully folded', () => {
    const playhead = new FoldPlayhead(0);
    playhead.begin();
    expect(playhead.advance(0.5, 40)).toBeCloseTo(20);
    expect(playhead.advance(10, 40)).toBe(100);
  });

  it('keeps every position within range, whatever it is handed', () => {
    const playhead = new FoldPlayhead(0);
    playhead.set(-20);
    expect(playhead.value).toBe(0);
    playhead.set(400);
    expect(playhead.value).toBe(100);
    playhead.set(Number.NaN);
    expect(playhead.value).toBe(0);
  });

  it('starts a second run from flat after the first one completes', () => {
    // The whole cycle: play to the end, then play again.
    const playhead = new FoldPlayhead(0);
    playhead.begin();
    playhead.advance(10, 40);
    playhead.end();
    expect(playhead.value).toBe(100);

    expect(playhead.begin()).toEqual({ from: 0, rewound: true });
  });
});
