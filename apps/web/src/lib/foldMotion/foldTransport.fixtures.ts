/**
 * A hand-driven {@link FoldTransportClock} for tests: frames and timers run
 * when the test says so, so a fold plays frame by frame, at whatever times a
 * test wants to look at it.
 */
import type { FoldTransportClock } from './foldTransport';

export class FakeFoldClock implements FoldTransportClock {
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
