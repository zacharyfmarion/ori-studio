import { useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { folded3dRehydrationQueue } from './folded3dRehydrate';

/**
 * When a rehydrate that nobody asked for is allowed to happen.
 *
 * `requestIdleCallback`'s timeout, so a page that never goes idle still gets
 * round to it — a document open beside a running simulation would otherwise wait
 * for the simulation to stop. Long enough that it is never the first thing after
 * a load, short enough that "background" does not mean "never".
 */
const REHYDRATE_IDLE_TIMEOUT_MS = 2_000;

/**
 * The wait when the browser has no idle callback (Safari, historically).
 *
 * A plain timer cannot know whether the main thread is busy, so it is set well
 * past the load rather than near it: the point is to be off the critical path,
 * and a fixed delay is the only lever available.
 */
const REHYDRATE_FALLBACK_DELAY_MS = 1_500;

/**
 * Run `task` once the browser has nothing better to do. Returns its canceller.
 *
 * Always asynchronous, on every path, because a caller that could be handed a
 * synchronous callback would have to reason about re-entering its own effect.
 */
function runWhenIdle(task: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => task(), {
      timeout: REHYDRATE_IDLE_TIMEOUT_MS,
    });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(task, REHYDRATE_FALLBACK_DELAY_MS);
  return () => window.clearTimeout(id);
}

export interface UseFolded3dRehydrationOptions {
  /** Every figure folded from this document's creases. */
  figures: readonly OristudioCpFoldedFigureEntry[];
  /** Figures whose creases have moved since they were folded. Left alone. */
  staleIds: ReadonlySet<string>;
  /**
   * The figure the user is working with — focused if any, otherwise selected.
   * It goes to the head of the queue, and once the user has pressed it, it stops
   * waiting for idle.
   */
  priorityId: string | null;
}

/**
 * Make reopened 3D figures live again, quietly.
 *
 * A 3D figure loaded from a file draws its stored picture and cannot be turned,
 * because the geometry every re-projection needs is not persisted. This walks
 * the figures that can get it back and rehydrates them **one at a time, after
 * paint, on idle** — which is the whole of R5's mitigation, and the reason app
 * start pays nothing for it. Nothing changes on screen when one lands; the
 * figure simply stops being inert.
 *
 * Two things it is careful about, both because the alternative is a loop:
 *
 * - **One in flight.** Each fold is a real kernel solve; running the document's
 *   figures concurrently would put the whole cost back on the load it is trying
 *   to stay out of.
 * - **A figure that could not be adopted is not retried**, keyed on the entry
 *   object rather than its id — so a refold, an undo, or a different document
 *   reusing the id gets a fresh attempt, while a figure that simply cannot be
 *   reproduced is asked once.
 *
 * The press case is the exception to "on idle": someone waiting on a figure they
 * just pressed is not a background task, so it runs at once and shows the
 * ordinary `loading` status while it does.
 */
export function useFolded3dRehydration({
  figures,
  staleIds,
  priorityId,
}: UseFolded3dRehydrationOptions): void {
  const rehydrate = useWorkspaceStore((state) => state.rehydrateOristudioCpFolded3dFigure);

  /**
   * Whichever figure was already selected when the surface mounted — restored
   * from the file, not pressed by anyone. Without this a document saved with a
   * figure selected would rehydrate it *during* start-up, with a status flicker,
   * which is precisely what "after paint, on idle" is for.
   */
  const mountedWithRef = useRef(priorityId);
  const inFlightRef = useRef(false);
  const skippedRef = useRef(new WeakSet<OristudioCpFoldedFigureEntry>());
  // Bumped when an attempt finishes, so the effect looks for the next one. The
  // successful case also changes `figures`, but the refused case changes nothing
  // the effect is subscribed to and would otherwise stop the queue dead.
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (inFlightRef.current) return;
    const queue = folded3dRehydrationQueue(figures, {
      staleIds,
      skip: (figure) => skippedRef.current.has(figure),
      priorityId,
    });
    const next = queue[0];
    if (next === undefined) return;
    const pressed = next === priorityId && priorityId !== mountedWithRef.current;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      inFlightRef.current = true;
      const entry = figures.find((figure) => figure.id === next);
      void rehydrate(next, { pending: pressed })
        .then((adopted) => {
          if (!adopted && entry) skippedRef.current.add(entry);
        })
        .finally(() => {
          inFlightRef.current = false;
          // Deliberately not guarded by `cancelled`: this effect is re-run by
          // every change to the figures list, so the cleanup that set it fires
          // routinely while a fold is in flight. Skipping the bump there would
          // leave the queue waiting for a change that has already happened.
          setAttempts((count) => count + 1);
        });
    };

    if (pressed) {
      run();
      return () => {
        cancelled = true;
      };
    }
    const cancel = runWhenIdle(run);
    return () => {
      cancelled = true;
      cancel();
    };
    // `attempts` is a tick, not data: it is what wakes this after a refusal.
  }, [attempts, figures, priorityId, rehydrate, staleIds]);
}
