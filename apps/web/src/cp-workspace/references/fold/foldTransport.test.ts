import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { FOLD_DURATION_MS, TWIN_HOLD_MS, type FoldHeading } from './foldPlayback';
import type { FoldScene, FoldSceneKind } from './foldScene';
import {
  AUTO_PLAY_SETTLE_MS,
  FoldTransport,
  type FoldPlayTrigger,
  type FoldPoseSink,
  type FoldTransportClock,
} from './foldTransport';

const FLAP: FoldScene['flaps'][number] = {
  chord: [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
  ],
  side: 1,
  polygon: [],
  creased: [],
};

function scene(kind: FoldSceneKind = 'cp', flaps = 1): FoldScene {
  return { kind, flaps: Array.from({ length: flaps }, () => FLAP), sheetShortSide: 1, reach: 1 };
}

/** A hand-driven clock: frames and timers run when the test says so. */
class FakeClock implements FoldTransportClock {
  time = 0;
  private frames = new Map<number, (now: number) => void>();
  private timers = new Map<number, { at: number; callback: () => void }>();
  private next = 1;
  now = () => this.time;
  requestFrame = (callback: (now: number) => void) => {
    const handle = this.next++;
    this.frames.set(handle, callback);
    return handle;
  };
  cancelFrame = (handle: number) => {
    this.frames.delete(handle);
  };
  setTimer = (callback: () => void, ms: number) => {
    const handle = this.next++;
    this.timers.set(handle, { at: this.time + ms, callback });
    return handle;
  };
  clearTimer = (handle: number) => {
    this.timers.delete(handle);
  };
  /** One animation frame, `ms` later. */
  frame(ms: number) {
    this.time += ms;
    const due = [...this.frames.values()];
    this.frames.clear();
    for (const callback of due) callback(this.time);
    this.fireTimers();
  }
  /** Time passing with no frame drawn. */
  wait(ms: number) {
    this.time += ms;
    this.fireTimers();
  }
  private fireTimers() {
    for (const [handle, timer] of [...this.timers]) {
      if (timer.at > this.time) continue;
      this.timers.delete(handle);
      timer.callback();
    }
  }
  get pendingFrames() {
    return this.frames.size;
  }
}

let clock: FakeClock;
let sink: FoldPoseSink;
let onPlay: Mock<(trigger: FoldPlayTrigger, heading: FoldHeading, kind: FoldSceneKind) => void>;
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

beforeEach(() => {
  clock = new FakeClock();
  sink = { setFoldPose: vi.fn() };
  onPlay = vi.fn();
  reduced = false;
});

describe('FoldTransport', () => {
  it('plays the fold to the end, then plays it back, pushing poses straight to the view', () => {
    const t = transport();
    const changes = vi.fn();
    t.subscribe(changes);
    t.setScene(scene());
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
    expect(onPlay).toHaveBeenLastCalledWith('user', 'unfold', 'cp');
    // Available, playing, rested folded, playing, rested flat.
    expect(changes).toHaveBeenCalledTimes(5);
  });

  it('pauses without counting a play, and lays the paper flat on a new card', () => {
    const t = transport();
    t.setScene(scene('press'));
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
    t.setScene(scene('press'));
    expect(lastPose()).toBeNull();
    expect(t.status()).toEqual({ available: true, playing: false, folded: false });
    expect(clock.pendingFrames).toBe(0);
    // The same card again changes nothing.
    const calls = vi.mocked(sink.setFoldPose).mock.calls.length;
    t.setScene(t['scene']);
    expect(vi.mocked(sink.setFoldPose).mock.calls.length).toBe(calls);
  });

  it('does nothing on a card with no fold', () => {
    const t = transport();
    t.setScene(null);
    expect(t.status().available).toBe(false);
    t.toggle();
    expect(lastPose()).toBeNull();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('auto-plays on arrival at a fold card, after a settle, and never on the first card', () => {
    const t = transport();
    t.setAutoPlay(true);
    t.setScene(scene());
    clock.wait(AUTO_PLAY_SETTLE_MS * 2);
    expect(t.status().playing).toBe(false);
    t.setScene(scene('aux'));
    expect(t.status().playing).toBe(false);
    clock.wait(AUTO_PLAY_SETTLE_MS);
    expect(t.status().playing).toBe(true);
    expect(onPlay).toHaveBeenLastCalledWith('auto', 'fold', 'aux');
    // Stepping straight on before it settles starts nothing for the card left.
    t.setScene(scene());
    t.setScene(scene());
    clock.wait(AUTO_PLAY_SETTLE_MS / 2);
    expect(t.status().playing).toBe(false);
    clock.wait(AUTO_PLAY_SETTLE_MS);
    expect(t.status().playing).toBe(true);
    // Off again: the next card stays put.
    t.setAutoPlay(false);
    t.setScene(scene());
    clock.wait(AUTO_PLAY_SETTLE_MS * 2);
    expect(t.status().playing).toBe(false);
  });

  it('plays a twin as three legs and rests folded on the second flap', () => {
    const t = transport();
    t.setScene(scene('cp', 2));
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
    t.setScene(scene());
    t.toggle();
    expect(t.status()).toEqual({ available: true, playing: false, folded: true });
    expect(lastPose()).toEqual({ flap: 0, angle: Math.PI, press: 1 });
    expect(clock.pendingFrames).toBe(0);
    t.toggle();
    expect(lastPose()).toBeNull();
    expect(onPlay).toHaveBeenCalledTimes(2);
  });

  it('stops everything when disposed', () => {
    const t = transport();
    t.setAutoPlay(true);
    t.setScene(scene());
    t.setScene(scene());
    t.toggle();
    t.dispose();
    clock.frame(AUTO_PLAY_SETTLE_MS * 2);
    expect(clock.pendingFrames).toBe(0);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});
