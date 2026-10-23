import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  FOLD_DURATION_MS,
  FOLD_PACE,
  TURN_OVER_DURATION_MS,
  TURN_OVER_PACE,
  TWIN_HOLD_MS,
  foldLegs,
  type FoldHeading,
} from './foldPlayback';
import {
  AUTO_PLAY_SETTLE_MS,
  FoldTransport,
  prefersReducedMotion,
  type FoldPlayTrigger,
  type FoldPoseSink,
  type FoldProgramme,
} from './foldTransport';
import { FakeFoldClock } from './foldTransport.fixtures';

/** A fold of `flaps` flaps, played on arrival only under auto-play. */
function programme(kind = 'cp', flaps = 1): FoldProgramme {
  return { kind, legs: foldLegs(flaps, FOLD_PACE), arrival: 'auto-play' };
}

/** The whole sheet turning over: its own pace, and played on every arrival. */
function turnOver(): FoldProgramme {
  return { kind: 'turn-over', legs: foldLegs(1, TURN_OVER_PACE), arrival: 'always' };
}

let clock: FakeFoldClock;
let sink: FoldPoseSink;
let onPlay: Mock<(trigger: FoldPlayTrigger, heading: FoldHeading, programme: FoldProgramme) => void>;
let reduced = false;

function transport() {
  return new FoldTransport({
    sink: () => sink,
    onPlay,
    reducedMotion: () => reduced,
    clock,
  });
}

const lastPose = () => vi.mocked(sink.setFoldPose).mock.lastCall?.[0] ?? null;
/** What the last play reported: its trigger, its heading and the programme's kind. */
const lastPlay = () => {
  const call = onPlay.mock.lastCall;
  return call ? [call[0], call[1], call[2].kind] : null;
};

beforeEach(() => {
  clock = new FakeFoldClock();
  sink = { setFoldPose: vi.fn() };
  onPlay = vi.fn();
  reduced = false;
});

describe('FoldTransport', () => {
  it('plays the fold to the end, then plays it back, pushing poses straight to the view', () => {
    const t = transport();
    const changes = vi.fn();
    t.subscribe(changes);
    t.setProgramme(programme());
    expect(t.status()).toEqual({ available: true, playing: false, folded: false });
    expect(lastPose()).toBeNull();
    t.toggle();
    expect(t.status().playing).toBe(true);
    clock.frame(FOLD_DURATION_MS / 2);
    expect(lastPose()?.angle).toBeGreaterThan(0);
    expect(t.status().folded).toBe(false);
    clock.frame(FOLD_DURATION_MS);
    expect(t.status()).toEqual({ available: true, playing: false, folded: true });
    expect(lastPose()).toEqual({ flap: 0, angle: Math.PI, press: 1 });
    expect(clock.pendingFrames).toBe(0);
    t.toggle();
    clock.frame(FOLD_DURATION_MS * 2);
    expect(t.status().folded).toBe(false);
    expect(lastPose()).toBeNull();
    expect(onPlay).toHaveBeenCalledTimes(2);
    expect(lastPlay()).toEqual(['user', 'unfold', 'cp']);
    // Available, playing, rested folded, playing, rested flat.
    expect(changes).toHaveBeenCalledTimes(5);
  });

  it('hands the programme itself back with every play, for whatever its owner reports', () => {
    const t = transport();
    const played = { ...programme(), way: 'alternative' };
    t.setProgramme(played);
    t.toggle();
    expect(onPlay).toHaveBeenLastCalledWith('user', 'fold', played);
  });

  it('plays each leg at its own pace', () => {
    const t = transport();
    t.setProgramme(turnOver());
    t.toggle();
    clock.frame(FOLD_DURATION_MS);
    expect(t.status().playing).toBe(true);
    expect(lastPose()?.angle).toBeLessThan(Math.PI);
    clock.frame(TURN_OVER_DURATION_MS - FOLD_DURATION_MS);
    expect(t.status()).toEqual({ available: true, playing: false, folded: true });
    expect(lastPlay()).toEqual(['user', 'fold', 'turn-over']);
  });

  it('pauses without counting a play, and lays the paper flat on a new card', () => {
    const t = transport();
    t.setProgramme(programme('press'));
    t.toggle();
    clock.frame(200);
    t.toggle();
    expect(t.status().playing).toBe(false);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(lastPose()?.angle).toBeGreaterThan(0);
    // Paused, no frame is pending; resumed, it carries on.
    expect(clock.pendingFrames).toBe(0);
    t.toggle();
    expect(t.status().playing).toBe(true);
    const next = programme('press');
    t.setProgramme(next);
    expect(lastPose()).toBeNull();
    expect(t.status()).toEqual({ available: true, playing: false, folded: false });
    expect(clock.pendingFrames).toBe(0);
    // The same card again changes nothing.
    const calls = vi.mocked(sink.setFoldPose).mock.calls.length;
    t.setProgramme(next);
    expect(vi.mocked(sink.setFoldPose).mock.calls.length).toBe(calls);
  });

  it('does nothing on a card with no fold, or with no leg to play', () => {
    const t = transport();
    t.setProgramme(null);
    expect(t.status().available).toBe(false);
    t.toggle();
    expect(lastPose()).toBeNull();
    t.setAutoPlay(true);
    t.setProgramme({ ...turnOver(), legs: [] });
    expect(t.status().available).toBe(false);
    t.toggle();
    clock.wait(AUTO_PLAY_SETTLE_MS * 2);
    expect(t.status().playing).toBe(false);
    expect(lastPose()).toBeNull();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('auto-plays on arrival at a fold card, after a settle, and never on the first card', () => {
    const t = transport();
    t.setAutoPlay(true);
    t.setProgramme(programme());
    clock.wait(AUTO_PLAY_SETTLE_MS * 2);
    expect(t.status().playing).toBe(false);
    t.setProgramme(programme('aux'));
    expect(t.status().playing).toBe(false);
    clock.wait(AUTO_PLAY_SETTLE_MS);
    expect(t.status().playing).toBe(true);
    expect(lastPlay()).toEqual(['auto', 'fold', 'aux']);
    // Stepping straight on before it settles starts nothing for the card left.
    t.setProgramme(programme());
    t.setProgramme(programme());
    clock.wait(AUTO_PLAY_SETTLE_MS / 2);
    expect(t.status().playing).toBe(false);
    clock.wait(AUTO_PLAY_SETTLE_MS);
    expect(t.status().playing).toBe(true);
    // Off again: the next card stays put.
    t.setAutoPlay(false);
    t.setProgramme(programme());
    clock.wait(AUTO_PLAY_SETTLE_MS * 2);
    expect(t.status().playing).toBe(false);
  });

  it('plays a card that always plays on arrival whatever the setting says, but not on the first card', () => {
    const t = transport();
    t.setAutoPlay(false);
    t.setProgramme(turnOver());
    clock.wait(AUTO_PLAY_SETTLE_MS * 2);
    expect(t.status().playing).toBe(false);
    t.setProgramme(programme());
    t.setProgramme(turnOver());
    clock.wait(AUTO_PLAY_SETTLE_MS / 2);
    expect(t.status().playing).toBe(false);
    clock.wait(AUTO_PLAY_SETTLE_MS);
    expect(t.status().playing).toBe(true);
    expect(lastPlay()).toEqual(['auto', 'fold', 'turn-over']);
    // A fold card after it still waits to be asked.
    t.setProgramme(programme());
    clock.wait(AUTO_PLAY_SETTLE_MS * 2);
    expect(t.status().playing).toBe(false);
  });

  it('plays a twin as three legs and rests folded on the second flap', () => {
    const t = transport();
    t.setProgramme(programme('cp', 2));
    t.toggle();
    const flaps: number[] = [];
    for (let i = 0; i < 400 && t.status().playing; i += 1) {
      clock.frame(25);
      const pose = lastPose();
      if (pose && flaps[flaps.length - 1] !== pose.flap) flaps.push(pose.flap);
    }
    expect(flaps).toEqual([0, 1]);
    expect(t.status()).toEqual({ available: true, playing: false, folded: true });
    expect(lastPose()).toEqual({ flap: 1, angle: Math.PI, press: 1 });
    expect(clock.time).toBeGreaterThan(3 * FOLD_DURATION_MS + TWIN_HOLD_MS - 100);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('snaps to the far end when motion is unwelcome', () => {
    reduced = true;
    const t = transport();
    t.setProgramme(programme());
    t.toggle();
    expect(t.status()).toEqual({ available: true, playing: false, folded: true });
    expect(lastPose()).toEqual({ flap: 0, angle: Math.PI, press: 1 });
    expect(clock.pendingFrames).toBe(0);
    t.toggle();
    expect(lastPose()).toBeNull();
    expect(onPlay).toHaveBeenCalledTimes(2);
  });

  it('seeks: pauses where the scrubber is, pushes that pose, and plays on from it', () => {
    const t = transport();
    t.setProgramme(programme());
    t.toggle();
    clock.frame(FOLD_DURATION_MS / 4);
    expect(t.progress()).toBeCloseTo(0.25, 9);
    t.seek(0.5);
    expect(t.status().playing).toBe(false);
    expect(t.progress()).toBe(0.5);
    expect(lastPose()?.angle).toBeGreaterThan(0);
    expect(clock.pendingFrames).toBe(0);
    // A seek is not a play.
    expect(onPlay).toHaveBeenCalledTimes(1);
    t.toggle();
    for (let i = 0; i < 100 && t.status().playing; i += 1) clock.frame(25);
    expect(t.status()).toEqual({ available: true, playing: false, folded: true });
    expect(t.progress()).toBe(1);
    // Back to the start: flat, the pose gone, and Play folds again.
    t.seek(0);
    expect(lastPose()).toBeNull();
    expect(t.status().folded).toBe(false);
    t.toggle();
    expect(lastPlay()).toEqual(['user', 'fold', 'cp']);
  });

  it('overtakes a pending auto-play with a seek, and ignores one with nothing to play', () => {
    const t = transport();
    t.setAutoPlay(true);
    t.setProgramme(programme());
    t.setProgramme(programme());
    t.seek(0.3);
    clock.wait(AUTO_PLAY_SETTLE_MS * 2);
    expect(t.status().playing).toBe(false);
    expect(t.progress()).toBeCloseTo(0.3, 9);
    t.setProgramme(null);
    t.seek(0.5);
    expect(t.progress()).toBe(0);
  });

  it('stops everything when disposed', () => {
    const t = transport();
    t.setAutoPlay(true);
    t.setProgramme(programme());
    t.setProgramme(programme());
    t.toggle();
    t.dispose();
    clock.frame(AUTO_PLAY_SETTLE_MS * 2);
    expect(clock.pendingFrames).toBe(0);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});

describe('prefersReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the browser, and says no where there is nothing to ask', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    expect(prefersReducedMotion()).toBe(true);
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});
