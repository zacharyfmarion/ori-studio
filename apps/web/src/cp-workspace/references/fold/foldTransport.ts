/**
 * The fold's transport, free of React: the animation frame loop, the pose it
 * pushes to the view, the auto-play settle, and the two facts a button needs.
 *
 * Progress lives here and reaches the view straight through its handle,
 * never through React state — at sixty frames a second a re-render per frame
 * would starve the loop that produces them (`SimulatorPanel` says the same).
 * Only the transitions are published, through `subscribe`: whether the paper
 * is moving, and whether it has come to rest folded.
 *
 * The clock is injectable so the whole thing runs under a hand-driven one in
 * tests; the default is the browser's.
 */
import {
  foldLegs,
  isFolded,
  legPace,
  runAtRest,
  runHeading,
  runPose,
  snapFoldRun,
  tickFoldRun,
  toggleFoldRun,
  type FoldHeading,
  type FoldPose,
  type FoldRun,
} from './foldPlayback';
import type { FoldScene, FoldSceneKind } from './foldScene';

/** Where a pose goes: the view's imperative handle, or anything shaped like it. */
export interface FoldPoseSink {
  setFoldPose: (pose: FoldPose | null) => void;
}

/** What asked for the fold: the reader, by button, key or menu, or the setting. */
export type FoldPlayTrigger = 'user' | 'auto';

export interface FoldTransportStatus {
  /** The card has something to play. */
  available: boolean;
  playing: boolean;
  /** At rest, folded over: Play would unfold. */
  folded: boolean;
}

export interface FoldTransportClock {
  now(): number;
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, ms: number): number;
  clearTimer(handle: number): void;
}

export interface FoldTransportOptions {
  /** The view to pose, looked up at each push: it may not be mounted yet. */
  sink: () => FoldPoseSink | null;
  /** Every play, for the analytics event; a pause is not one. */
  onPlay?: (trigger: FoldPlayTrigger, heading: FoldHeading, kind: FoldSceneKind) => void;
  /** Motion is unwelcome: Play snaps between the rest poses instead. */
  reducedMotion?: () => boolean;
  clock?: FoldTransportClock;
}

/** How long a card sits before auto-play starts, so stepping through with a key does not. */
export const AUTO_PLAY_SETTLE_MS = 120;

const browserClock: FoldTransportClock = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  setTimer: (callback, ms) => window.setTimeout(callback, ms),
  clearTimer: (handle) => window.clearTimeout(handle),
};

const AT_REST_STATUS: FoldTransportStatus = { available: false, playing: false, folded: false };

export class FoldTransport {
  private run: FoldRun = runAtRest([]);
  private scene: FoldScene | null = null;
  private autoPlay = false;
  private frame = 0;
  private last = 0;
  private timer = 0;
  private seenScene = false;
  private snapshot: FoldTransportStatus = AT_REST_STATUS;
  private readonly listeners = new Set<() => void>();
  private readonly clock: FoldTransportClock;

  constructor(private readonly options: FoldTransportOptions) {
    this.clock = options.clock ?? browserClock;
  }

  /** The status as of the last transition; the same object until it changes. */
  readonly status = (): FoldTransportStatus => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setAutoPlay(on: boolean): void {
    this.autoPlay = on;
  }

  /**
   * The card's fold, or none. The same object again changes nothing. A
   * different one lays the paper flat, whatever was playing, and with
   * auto-play on plays it after a moment — except the first, which is the
   * card the transport starts on, not one arrived at.
   */
  setScene(scene: FoldScene | null): void {
    if (this.seenScene && scene === this.scene) return;
    const arrival = this.seenScene;
    this.seenScene = true;
    this.scene = scene;
    this.clearTimer();
    this.rest();
    if (arrival && this.autoPlay && scene) {
      this.timer = this.clock.setTimer(() => {
        this.timer = 0;
        this.play('auto');
      }, AUTO_PLAY_SETTLE_MS);
    }
  }

  /** The Play button, Space and the menu row: play, pause, resume, play back. */
  toggle(): void {
    this.play('user');
  }

  dispose(): void {
    this.stop();
    this.clearTimer();
    this.listeners.clear();
  }

  private play(trigger: FoldPlayTrigger): void {
    const scene = this.scene;
    if (!scene) return;
    const before = this.run;
    const next = this.options.reducedMotion?.() ? snapFoldRun(before) : toggleFoldRun(before);
    this.run = next;
    this.push();
    this.publish();
    if (next.playing) this.start();
    else this.stop();
    // A pause is not a play; everything else that moves the paper is.
    if (!before.playing) this.options.onPlay?.(trigger, runHeading(next), scene.kind);
  }

  private start(): void {
    this.stop();
    this.last = this.clock.now();
    const frame = (now: number): void => {
      this.run = tickFoldRun(this.run, now - this.last);
      this.last = now;
      this.push();
      if (this.run.playing) {
        this.frame = this.clock.requestFrame(frame);
      } else {
        this.frame = 0;
        this.publish();
      }
    };
    this.frame = this.clock.requestFrame(frame);
  }

  private stop(): void {
    if (this.frame !== 0) this.clock.cancelFrame(this.frame);
    this.frame = 0;
  }

  private clearTimer(): void {
    if (this.timer !== 0) this.clock.clearTimer(this.timer);
    this.timer = 0;
  }

  private rest(): void {
    this.stop();
    const scene = this.scene;
    this.run = runAtRest(scene ? foldLegs(scene.flaps.length, legPace(scene.kind)) : []);
    this.push();
    this.publish();
  }

  private push(): void {
    this.options.sink()?.setFoldPose(runPose(this.run));
  }

  private publish(): void {
    const next: FoldTransportStatus = {
      available: this.scene !== null,
      playing: this.run.playing,
      folded: isFolded(this.run),
    };
    const prev = this.snapshot;
    if (
      prev.available === next.available &&
      prev.playing === next.playing &&
      prev.folded === next.folded
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
