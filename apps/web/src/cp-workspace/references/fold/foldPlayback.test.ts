import { describe, expect, it } from 'vitest';
import {
  FOLD_AT_REST,
  FOLD_DURATION_MS,
  FOLD_SWING_SHARE,
  isFlat,
  isFolded,
  poseAt,
  snapFoldPlayback,
  tickFoldPlayback,
  toggleFoldPlayback,
} from './foldPlayback';

describe('toggleFoldPlayback', () => {
  it('heads for folded from flat, and back for flat from folded', () => {
    const going = toggleFoldPlayback(FOLD_AT_REST);
    expect(going).toEqual({ at: 0, heading: 'fold', playing: true });
    const folded = tickFoldPlayback(going, FOLD_DURATION_MS);
    expect(isFolded(folded)).toBe(true);
    expect(folded.playing).toBe(false);
    const back = toggleFoldPlayback(folded);
    expect(back).toEqual({ at: 1, heading: 'unfold', playing: true });
    const flat = tickFoldPlayback(back, FOLD_DURATION_MS);
    expect(isFlat(flat)).toBe(true);
    expect(flat.playing).toBe(false);
    // Flat again after unfolding: Play folds, whatever the last heading was.
    expect(toggleFoldPlayback(flat).heading).toBe('fold');
  });

  it('pauses mid-flight and resumes the same way', () => {
    const halfway = tickFoldPlayback(toggleFoldPlayback(FOLD_AT_REST), FOLD_DURATION_MS / 2);
    expect(halfway.at).toBeCloseTo(0.5);
    const paused = toggleFoldPlayback(halfway);
    expect(paused.playing).toBe(false);
    expect(tickFoldPlayback(paused, 1000)).toBe(paused);
    const resumed = toggleFoldPlayback(paused);
    expect(resumed).toEqual({ at: halfway.at, heading: 'fold', playing: true });
    // Paused on the way back, it keeps heading back.
    const returning = tickFoldPlayback(toggleFoldPlayback({ at: 1, heading: 'fold', playing: false }), 200);
    const pausedBack = toggleFoldPlayback(returning);
    expect(toggleFoldPlayback(pausedBack).heading).toBe('unfold');
  });

  it('comes to rest exactly at the ends, never past them', () => {
    const over = tickFoldPlayback(toggleFoldPlayback(FOLD_AT_REST), FOLD_DURATION_MS * 3);
    expect(over.at).toBe(1);
    expect(over.playing).toBe(false);
    const under = tickFoldPlayback({ at: 0.1, heading: 'unfold', playing: true }, FOLD_DURATION_MS);
    expect(under.at).toBe(0);
    expect(under.playing).toBe(false);
  });
});

describe('snapFoldPlayback', () => {
  it('jumps to the far end without playing', () => {
    expect(snapFoldPlayback(FOLD_AT_REST)).toEqual({ at: 1, heading: 'fold', playing: false });
    expect(snapFoldPlayback({ at: 1, heading: 'fold', playing: false })).toEqual({
      at: 0,
      heading: 'unfold',
      playing: false,
    });
    // Paused partway, it finishes the way it was going.
    expect(snapFoldPlayback({ at: 0.4, heading: 'unfold', playing: false }).at).toBe(0);
  });
});

describe('poseAt', () => {
  it('swings first and presses after, easing at both ends', () => {
    expect(poseAt(0)).toEqual({ angle: 0, press: 0 });
    const early = poseAt(0.1);
    expect(early.angle).toBeGreaterThan(0);
    expect(early.angle).toBeLessThan((Math.PI * 0.1) / FOLD_SWING_SHARE);
    expect(early.press).toBe(0);
    expect(poseAt(FOLD_SWING_SHARE)).toEqual({ angle: Math.PI, press: 0 });
    const pressing = poseAt((1 + FOLD_SWING_SHARE) / 2);
    expect(pressing.angle).toBe(Math.PI);
    expect(pressing.press).toBeGreaterThan(0.5);
    expect(pressing.press).toBeLessThan(1);
    expect(poseAt(1)).toEqual({ angle: Math.PI, press: 1 });
  });

  it('is monotone in both phases', () => {
    let last = poseAt(0);
    for (let i = 1; i <= 100; i += 1) {
      const next = poseAt(i / 100);
      expect(next.angle).toBeGreaterThanOrEqual(last.angle);
      expect(next.press).toBeGreaterThanOrEqual(last.press);
      last = next;
    }
  });
});
