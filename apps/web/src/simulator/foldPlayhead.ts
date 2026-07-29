/**
 * Where a window's fold sits, and who is allowed to move it.
 *
 * Two things report a fold position and they disagree at exactly one moment: a
 * restart. Pressing play on a fully folded window rewinds it to flat, but a
 * frame the solver dispatched before that is still in flight, and it arrives
 * afterwards carrying the position the fold used to be at. Both wrote to the
 * same value and the later write won, so the loop's next step read 100, clamped
 * to 100, declared playback finished and commanded the fold back to where it
 * had just come from. That is the snap.
 *
 * It also explains why it came right after a few tries: once the solver has
 * gone quiet there is no frame in flight to land late, so the rewind survives.
 * A race that resolves correctly when nothing else is happening is not one that
 * careful ordering fixes — the two writers need different authority.
 *
 * So: the loop owns the position while it is running, the solver owns it the
 * rest of the time, and a deliberate move by the user always wins.
 */
export class FoldPlayhead {
  private percent: number;
  private playing = false;

  constructor(percent = 0) {
    this.percent = clamp(percent);
  }

  get value(): number {
    return this.percent;
  }

  /** Whether the loop currently holds the pen. */
  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Take control for playback, rewinding first if the fold is already complete.
   *
   * `rewound` is the caller's cue to reset the solver too: the playhead only
   * tracks the number, and flat paper is the solver's business.
   */
  begin(): { from: number; rewound: boolean } {
    const rewound = this.percent >= 100;
    if (rewound) this.percent = 0;
    this.playing = true;
    return { from: this.percent, rewound };
  }

  /** Hand the position back to the solver. */
  end(): void {
    this.playing = false;
  }

  /** Step forward under the loop's control. Returns the new position. */
  advance(elapsedSeconds: number, percentPerSecond: number): number {
    this.percent = clamp(this.percent + elapsedSeconds * percentPerSecond);
    return this.percent;
  }

  /**
   * A position observed from a solver frame.
   *
   * Ignored while the loop is running — that is the whole point of this class.
   */
  report(percent: number): void {
    if (this.playing) return;
    this.percent = clamp(percent);
  }

  /**
   * A deliberate move: a scrub, a nudge, a jump to either end, or a replay.
   *
   * Always accepted. Callers stop playback alongside this, but a user's own
   * input should not be silently dropped even if they do not.
   */
  set(percent: number): void {
    this.percent = clamp(percent);
  }
}

function clamp(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}
