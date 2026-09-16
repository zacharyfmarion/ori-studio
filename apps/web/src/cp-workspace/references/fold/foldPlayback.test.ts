import { describe, expect, it } from 'vitest';
import {
  FOLD_DURATION_MS,
  FOLD_SWING_SHARE,
  TWIN_HOLD_MS,
  foldLegs,
  isFlat,
  isFolded,
  poseAt,
  runAtRest,
  runPose,
  snapFoldRun,
  tickFoldRun,
  toggleFoldRun,
  type FoldRun,
} from './foldPlayback';

const single = () => runAtRest(foldLegs(1));
const twin = () => runAtRest(foldLegs(2));

/** Tick in frames of `ms` until the run stops or `limit` ms have passed. */
function playOut(run: FoldRun, ms = 50, limit = 20_000): FoldRun {
  let state = run;
  for (let t = 0; t < limit && state.playing; t += ms) state = tickFoldRun(state, ms);
  return state;
}

describe('a fold card', () => {
  it('folds to the end, rests folded, then unfolds on the next Play', () => {
    const going = toggleFoldRun(single());
    expect(going.playing).toBe(true);
    const folded = playOut(going);
    expect(isFolded(folded)).toBe(true);
    expect(runPose(folded)).toEqual({ flap: 0, angle: Math.PI, press: 1 });
    const back = toggleFoldRun(folded);
    expect(back.legs[0]?.heading).toBe('unfold');
    expect(back.at).toBe(1);
    const flat = playOut(back);
    expect(isFlat(flat)).toBe(true);
    expect(runPose(flat)).toBeNull();
    expect(flat.playing).toBe(false);
    // Flat again: Play folds, whatever the last run was.
    expect(toggleFoldRun(flat).legs[0]?.heading).toBe('fold');
  });

  it('pauses mid-flight and resumes the same way', () => {
    const halfway = tickFoldRun(toggleFoldRun(single()), FOLD_DURATION_MS / 2);
    expect(halfway.at).toBeCloseTo(0.5);
    const paused = toggleFoldRun(halfway);
    expect(paused.playing).toBe(false);
    expect(tickFoldRun(paused, 1000)).toBe(paused);
    const resumed = toggleFoldRun(paused);
    expect(resumed).toEqual({ ...halfway, playing: true });
    // Paused on the way back, it keeps heading back.
    const returning = tickFoldRun(toggleFoldRun(playOut(toggleFoldRun(single()))), 200);
    const pausedBack = toggleFoldRun(returning);
    expect(toggleFoldRun(pausedBack).legs[0]?.heading).toBe('unfold');
  });

  it('comes to rest exactly at the ends, never past them', () => {
    const over = tickFoldRun(toggleFoldRun(single()), FOLD_DURATION_MS * 3);
    expect(over.at).toBe(1);
    expect(over.playing).toBe(false);
    const under = tickFoldRun(
      { ...runAtRest([{ flap: 0, heading: 'unfold', holdMs: 0 }]), at: 0.1, playing: true },
      FOLD_DURATION_MS
    );
    expect(under.at).toBe(0);
    expect(under.playing).toBe(false);
  });
});

describe('a twin card', () => {
  it('folds the first, holds, unfolds it, then folds the second and rests there', () => {
    expect(foldLegs(2).map((leg) => `${leg.flap}:${leg.heading}`)).toEqual([
      '0:fold',
      '0:unfold',
      '1:fold',
    ]);
    let run = toggleFoldRun(twin());
    const seen: string[] = [];
    let t = 0;
    while (run.playing && t < 20_000) {
      run = tickFoldRun(run, 25);
      t += 25;
      const pose = runPose(run);
      const mark = pose ? `${pose.flap}:${pose.angle > 3 ? 'over' : 'up'}` : 'flat';
      if (seen[seen.length - 1] !== mark) seen.push(mark);
    }
    expect(seen).toEqual(['0:up', '0:over', '0:up', 'flat', '1:up', '1:over']);
    expect(isFolded(run)).toBe(true);
    expect(runPose(run)).toEqual({ flap: 1, angle: Math.PI, press: 1 });
    // Long enough for three legs and one hold, and not much longer.
    expect(t).toBeGreaterThan(3 * FOLD_DURATION_MS + TWIN_HOLD_MS - 100);
    expect(t).toBeLessThan(3 * FOLD_DURATION_MS + TWIN_HOLD_MS + 200);
    // Rested folded on the second flap, Play unfolds that flap alone…
    const back = toggleFoldRun(run);
    expect(back.legs).toEqual([{ flap: 1, heading: 'unfold', holdMs: 0 }]);
    const flat = playOut(back);
    expect(isFlat(flat)).toBe(true);
    // …and flat again, Play runs the whole card forwards.
    expect(toggleFoldRun(flat).legs).toEqual(foldLegs(2));
  });

  it('holds the landing before unfolding', () => {
    const landed = tickFoldRun(toggleFoldRun(twin()), FOLD_DURATION_MS);
    expect(landed.at).toBe(1);
    expect(landed.holdLeft).toBe(TWIN_HOLD_MS);
    expect(landed.playing).toBe(true);
    const still = tickFoldRun(landed, TWIN_HOLD_MS / 2);
    expect(still.at).toBe(1);
    expect(still.leg).toBe(0);
    const moving = tickFoldRun(still, TWIN_HOLD_MS);
    expect(moving.leg).toBe(1);
    expect(moving.at).toBe(1);
  });
});

describe('snapFoldRun', () => {
  it('jumps to the run’s end without playing, and to the next run’s end after that', () => {
    const folded = snapFoldRun(single());
    expect(isFolded(folded)).toBe(true);
    expect(folded.playing).toBe(false);
    const flat = snapFoldRun(folded);
    expect(isFlat(flat)).toBe(true);
    // A twin snaps to its end: the second flap folded.
    const snapped = snapFoldRun(twin());
    expect(isFolded(snapped)).toBe(true);
    expect(runPose(snapped)?.flap).toBe(1);
    // Paused partway, it finishes the run it was on.
    const partway = { ...toggleFoldRun(single()), at: 0.4, playing: false };
    expect(isFolded(snapFoldRun(partway))).toBe(true);
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
