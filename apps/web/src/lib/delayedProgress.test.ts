import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDelayedProgress } from './delayedProgress';

const DELAY = 500;
const MIN_VISIBLE = 1000;

function makeProgress() {
  const show = vi.fn();
  const hide = vi.fn();
  const progress = createDelayedProgress({
    delayMs: DELAY,
    minVisibleMs: MIN_VISIBLE,
    show,
    hide,
  });
  return { progress, show, hide };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createDelayedProgress', () => {
  it('shows nothing when the work finishes before the delay', () => {
    const { progress, show, hide } = makeProgress();
    progress.start();
    vi.advanceTimersByTime(DELAY - 1);
    progress.stop();
    vi.advanceTimersByTime(10_000);
    expect(show).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it('shows once the work outlasts the delay', () => {
    const { progress, show } = makeProgress();
    progress.start();
    vi.advanceTimersByTime(DELAY);
    expect(show).toHaveBeenCalledTimes(1);
  });

  // The half that is easy to omit: without it, work finishing just after the
  // delay flashes exactly as if there were no delay at all.
  it('keeps the indicator up for the minimum visible time', () => {
    const { progress, hide } = makeProgress();
    progress.start();
    vi.advanceTimersByTime(DELAY);
    progress.stop();
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MIN_VISIBLE - 1);
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('hides immediately when the work already outlasted the minimum', () => {
    const { progress, hide } = makeProgress();
    progress.start();
    vi.advanceTimersByTime(DELAY + MIN_VISIBLE + 100);
    progress.stop();
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('ignores a second start while already running', () => {
    const { progress, show } = makeProgress();
    progress.start();
    progress.start();
    vi.advanceTimersByTime(DELAY);
    expect(show).toHaveBeenCalledTimes(1);
  });

  // Back-to-back folds: restarting inside the minimum-visible window must not
  // let the pending hide fire underneath the new work.
  it('keeps the indicator up when work restarts during the minimum window', () => {
    const { progress, show, hide } = makeProgress();
    progress.start();
    vi.advanceTimersByTime(DELAY);
    progress.stop();
    vi.advanceTimersByTime(100);
    progress.start();
    vi.advanceTimersByTime(MIN_VISIBLE);
    expect(hide).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledTimes(1);
    progress.stop();
    vi.advanceTimersByTime(MIN_VISIBLE);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a stop that was never started', () => {
    const { progress, show, hide } = makeProgress();
    progress.stop();
    vi.advanceTimersByTime(10_000);
    expect(show).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it('drops pending timers on dispose', () => {
    const { progress, show, hide } = makeProgress();
    progress.start();
    progress.dispose();
    vi.advanceTimersByTime(10_000);
    expect(show).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  // Whatever the indicator is — a toast that only a `hide` can remove — has to
  // come down with its host. Otherwise unmounting mid-run strands it on screen.
  it('hides an indicator that is on screen when it is disposed', () => {
    const { progress, show, hide } = makeProgress();
    progress.start();
    vi.advanceTimersByTime(600);
    expect(show).toHaveBeenCalledOnce();

    progress.dispose();

    expect(hide).toHaveBeenCalledOnce();
  });

  // The window where `running` is already false but the indicator is still up:
  // stopping inside the minimum-visible time queues the hide rather than doing
  // it, and dispose then throws that timer away.
  it('hides when disposed while a queued hide is still pending', () => {
    const { progress, show, hide } = makeProgress();
    progress.start();
    vi.advanceTimersByTime(600);
    progress.stop();
    expect(show).toHaveBeenCalledOnce();
    expect(hide).not.toHaveBeenCalled();

    progress.dispose();

    expect(hide).toHaveBeenCalledOnce();
  });
});
