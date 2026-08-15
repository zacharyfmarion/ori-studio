/**
 * Progress indication that stays out of the way of fast work.
 *
 * Two rules, and both are needed:
 *
 * - **Wait before showing.** Most folds finish quickly, and an indicator that
 *   appears for 80ms reads as a glitch rather than as feedback.
 * - **Once shown, stay a while.** This is the half that gets forgotten: without
 *   it, work finishing just after the delay produces exactly the flash the delay
 *   was meant to prevent — now with worse timing, because the eye has already
 *   been drawn to it.
 *
 * Deliberately free of React and of any toast library: the decision of *when*
 * something should be visible is timing logic, and testable on its own.
 */
export interface DelayedProgressOptions {
  /** How long work must run before it is worth mentioning. */
  delayMs: number;
  /** How long the indicator stays once shown, even if the work finished. */
  minVisibleMs: number;
  show: () => void;
  hide: () => void;
}

export interface DelayedProgress {
  /** Work started. Idempotent — a second start while running does nothing. */
  start: () => void;
  /** Work finished. Hides now, or once the minimum visible time has elapsed. */
  stop: () => void;
  /** Drop pending timers, hiding the indicator if it is currently shown. */
  dispose: () => void;
}

export function createDelayedProgress(options: DelayedProgressOptions): DelayedProgress {
  const { delayMs, minVisibleMs, show, hide } = options;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let shownAt: number | null = null;
  let running = false;

  function clearTimers() {
    if (showTimer !== null) clearTimeout(showTimer);
    if (hideTimer !== null) clearTimeout(hideTimer);
    showTimer = null;
    hideTimer = null;
  }

  return {
    start() {
      if (running) return;
      running = true;
      // A stop still inside its minimum-visible window leaves the indicator up;
      // starting again should keep it up rather than let that timer hide it.
      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      if (shownAt !== null) return;
      showTimer = setTimeout(() => {
        showTimer = null;
        shownAt = Date.now();
        show();
      }, delayMs);
    },

    stop() {
      if (!running) return;
      running = false;
      if (showTimer !== null) {
        // Finished before it was ever worth mentioning: the good case.
        clearTimeout(showTimer);
        showTimer = null;
        return;
      }
      if (shownAt === null) return;
      const remaining = minVisibleMs - (Date.now() - shownAt);
      if (remaining <= 0) {
        shownAt = null;
        hide();
        return;
      }
      hideTimer = setTimeout(() => {
        hideTimer = null;
        shownAt = null;
        hide();
      }, remaining);
    },

    dispose() {
      // Anything already on screen has to come down with the host. `clearTimers`
      // has just discarded a queued hide, so `shownAt` — not `running` — is what
      // says something is visible: a stop() inside its minimum-visible window
      // leaves the indicator up with `running` already false.
      const wasShown = shownAt !== null;
      clearTimers();
      shownAt = null;
      running = false;
      if (wasShown) hide();
    },
  };
}
