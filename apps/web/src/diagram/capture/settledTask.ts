/** Debounce a view edit, retaining only its newest value while a capture runs.
 * Cancellation invalidates a value already waiting at an asynchronous gate. */
export function settledTask<T>(write: (value: T, current: () => boolean) => Promise<unknown>, delay = 450) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | undefined;
  let running: Promise<void> | null = null;
  let generation = 0;
  const drain = (): Promise<void> => {
    running ??= (async () => {
      await null;
      try {
        while (pending !== undefined && timer === null) {
          const value = pending,
            epoch = generation;
          pending = undefined;
          await write(value, () => epoch === generation);
        }
      } finally {
        running = null;
      }
    })();
    return running;
  };
  return {
    offer(value: T) {
      generation++;
      pending = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, delay);
    },
    cancel() {
      generation++;
      pending = undefined;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      return drain();
    },
  };
}
