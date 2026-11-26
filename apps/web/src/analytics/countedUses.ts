/**
 * The CP editor's operations and the app's commands, counted per window rather
 * than sent once per use.
 *
 * Both used to send one event per use: one per line drawn, one per Undo. Between
 * them that was three quarters of every event the app sent, most of it from a
 * few heavy users, and it ran the project into PostHog's free allowance
 * (`implementation-plans/counted-tool-and-command-events.md`). The questions
 * these events answer need much less: "who used this tool" needs its first use,
 * and "how often" needs a count.
 *
 * A window opens at the first counted use and closes after
 * {@link USE_COUNT_WINDOW_MS}, or earlier when the provider flushes it (the page
 * is hidden or unloads). Within it, each tool or command sends:
 *
 * - **Its first use, at once**, as the event it always was (`cp tool used`,
 *   `command invoked`), with `counting: 'first_in_window'`. It never waits for
 *   the window, so unique-user charts and funnels read as they did, and a page
 *   that dies before its window closes still says who used what. The marker is
 *   what PostHog's drop filter lets through: builds without it sent one event
 *   per use, and their events are dropped at ingestion.
 * - **Its count, when the window closes**, as `cp tool uses counted` /
 *   `command uses counted` with `use_count_bucket`, dated to when the window
 *   opened. The count is bucketed, never exact (`docs/analytics.md`).
 *
 * Opting out discards the window without sending it.
 */

import { bucketCount, COUNT_BUCKETS, type AnalyticsProperties } from './events';

/** How long a counting window stays open after its first use. */
export const USE_COUNT_WINDOW_MS = 30 * 60 * 1000;

/** `counting` on a first use. PostHog's drop filter keys on this property. */
export const FIRST_IN_WINDOW = 'first_in_window';

/** Each counted event: the event its count goes out as, and the property that names the tool. */
const COUNTED_USE_EVENTS = {
  'cp tool used': { countEvent: 'cp tool uses counted', key: 'operation' },
  'command invoked': { countEvent: 'command uses counted', key: 'command_id' },
} as const;

export type CountedUseEvent = keyof typeof COUNTED_USE_EVENTS;

export interface CountedUseCaptureOptions {
  timestamp: Date;
  transport?: 'sendBeacon';
}

/** PostHog's `capture`, narrowed to what the counter sends. */
export type CountedUseCapture = (
  eventName: string,
  properties: AnalyticsProperties,
  options?: CountedUseCaptureOptions
) => void;

export interface FlushCountedUsesOptions {
  /** Send by beacon, for a page that is being hidden or torn down. */
  beacon?: boolean;
}

export interface UseCounter {
  /** Count one use: sent at once if it is the first in this window, counted otherwise. */
  record(eventName: CountedUseEvent, properties: AnalyticsProperties): void;
  /** Close the window: send every count in it and start afresh. */
  flush(options?: FlushCountedUsesOptions): void;
  /** Close the window without sending its counts. */
  discard(): void;
}

interface PendingUse {
  eventName: CountedUseEvent;
  properties: AnalyticsProperties;
  uses: number;
}

export function createUseCounter(
  capture: CountedUseCapture,
  windowMs: number = USE_COUNT_WINDOW_MS
): UseCounter {
  const pending = new Map<string, PendingUse>();
  let openedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function close(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    openedAt = null;
    pending.clear();
  }

  const counter: UseCounter = {
    record(eventName, properties) {
      if (openedAt === null) {
        openedAt = Date.now();
        timer = setTimeout(() => counter.flush(), windowMs);
      }
      const key = `${eventName}\u0000${String(properties[COUNTED_USE_EVENTS[eventName].key])}`;
      const seen = pending.get(key);
      if (seen) {
        seen.uses += 1;
        return;
      }
      pending.set(key, { eventName, properties: { ...properties }, uses: 1 });
      capture(eventName, { ...properties, counting: FIRST_IN_WINDOW });
    },

    flush({ beacon = false } = {}) {
      if (openedAt === null) return;
      const options: CountedUseCaptureOptions = { timestamp: new Date(openedAt) };
      if (beacon) options.transport = 'sendBeacon';
      for (const { eventName, properties, uses } of pending.values()) {
        capture(
          COUNTED_USE_EVENTS[eventName].countEvent,
          { ...properties, use_count_bucket: bucketCount(uses, COUNT_BUCKETS) },
          options
        );
      }
      close();
    },

    discard: close,
  };

  return counter;
}
