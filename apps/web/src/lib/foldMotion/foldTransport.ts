/**
 * The fold's transport, free of React: the animation frame loop, the pose it
 * pushes to the view, the auto-play settle, and the two facts a button needs.
 *
 * What it plays is a {@link FoldProgramme}: the legs, what kind of motion they
 * make, and whether it plays by itself on arrival. Whoever owns the paper —
 * References' cards, the Fold workspace's steps — adapts its own model to
 * one; nothing here knows what drew the paper or what a flap is made of.
 *
 * Progress lives here and reaches the view straight through its handle,
 * never through React state — at sixty frames a second a re-render per frame
 * would starve the loop that produces them (`SimulatorPanel` says the same).
 * Only the transitions are published, through `subscribe`: whether the paper
 * is moving, and whether it has come to rest folded.
 *
 * The clock is injectable so the whole thing runs under a hand-driven one in
 * tests; the default is the browser's, and so is the motion preference.
 */
import {
  isFolded,
  runAtRest,
  runHeading,
  runPose,
  runProgress,
  seekFoldRun,
  snapFoldRun,
  tickFoldRun,
  toggleFoldRun,
  type FoldHeading,
  type FoldLeg,
  type FoldPose,
  type FoldRun,
} from './foldPlayback';

/**
 * When a programme plays by itself on arrival: under the auto-play setting,
 * or always — a motion that *is* the card, not one there to be asked for.
 */
export type FoldArrival = 'auto-play' | 'always';

/** What the transport plays: a card's legs, and what kind of motion they make. */
export interface FoldProgramme<Kind extends string = string> {
  /** What moves, as the owner names it: handed back with every play, never read here. */
  kind: Kind;
  /** The legs, played forwards from flat. */
  legs: readonly FoldLeg[];
  arrival: FoldArrival;
}

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

export interface FoldTransportOptions<P extends FoldProgramme = FoldProgramme> {
  /** The view to pose, looked up at each push: it may not be mounted yet. */
  sink: () => FoldPoseSink | null;
  /** Every play, for the analytics event; a pause is not one. */
  onPlay?: (trigger: FoldPlayTrigger, heading: FoldHeading, programme: P) => void;
  /**
   * Motion is unwelcome: Play snaps between the rest poses instead. Asked at
   * every play; the browser's `prefers-reduced-motion` by default.
   */
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

/** The reader's motion preference, false where there is no window to ask. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const AT_REST_STATUS: FoldTransportStatus = { available: false, playing: false, folded: false };

export class FoldTransport<P extends FoldProgramme = FoldProgramme> {
  private run: FoldRun = runAtRest([]);
  private programme: P | null = null;
  private autoPlay = false;
  private frame = 0;
  private last = 0;
  private timer = 0;
  private seenProgramme = false;
  private snapshot: FoldTransportStatus = AT_REST_STATUS;
  private readonly listeners = new Set<() => void>();
  private readonly clock: FoldTransportClock;
  private readonly reducedMotion: () => boolean;

  constructor(private readonly options: FoldTransportOptions<P>) {
    this.clock = options.clock ?? browserClock;
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion;
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
   * The card's programme, or none. The same object again changes nothing. A
   * different one lays the paper flat, whatever was playing, and plays it
   * after a moment when it plays on arrival — with auto-play on, or always,
   * as its {@link FoldProgramme.arrival} says — except the first, which is
   * the card the transport starts on, not one arrived at.
   */
  setProgramme(programme: P | null): void {
    if (this.seenProgramme && programme === this.programme) return;
    const arrived = this.seenProgramme;
    this.seenProgramme = true;
    this.programme = programme;
    this.clearTimer();
    this.rest();
    const playable = this.playable();
    if (arrived && playable && (this.autoPlay || playable.arrival === 'always')) {
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

  /**
   * How far through its legs the paper is, 0 to 1 by time
   * (`runProgress`): read at a push, never published, so a scrubber can follow
   * the frames without a render per transition.
   */
  readonly progress = (): number => runProgress(this.run);

  /**
   * A scrubber: the paper paused `progress` of the way through the
   * programme's legs (`seekFoldRun`), whatever was playing, and a pending
   * auto-play overtaken. Play then carries on from there. Not a play: nothing
   * is reported.
   */
  seek(progress: number): void {
    if (!this.playable()) return;
    this.clearTimer();
    this.stop();
    this.run = seekFoldRun(this.run, progress);
    this.push();
    this.publish();
  }

  dispose(): void {
    this.stop();
    this.clearTimer();
    this.listeners.clear();
  }

  /** The programme, while it has a leg to play. */
  private playable(): P | null {
    const programme = this.programme;
    return programme && programme.legs.length > 0 ? programme : null;
  }

  private play(trigger: FoldPlayTrigger): void {
    const programme = this.playable();
    if (!programme) return;
    const before = this.run;
    const next = this.reducedMotion() ? snapFoldRun(before) : toggleFoldRun(before);
    this.run = next;
    this.push();
    this.publish();
    if (next.playing) this.start();
    else this.stop();
    // A pause is not a play; everything else that moves the paper is.
    if (!before.playing) this.options.onPlay?.(trigger, runHeading(next), programme);
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
    this.run = runAtRest(this.programme?.legs ?? []);
    this.push();
    this.publish();
  }

  private push(): void {
    this.options.sink()?.setFoldPose(runPose(this.run));
  }

  private publish(): void {
    const next: FoldTransportStatus = {
      available: this.playable() !== null,
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
