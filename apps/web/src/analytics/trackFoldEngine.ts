import type { FoldEngineRestart } from '../fold/session/foldSession';
import { ANALYTICS_EVENTS, bucketCount } from './events';
import { track } from './runtime';

/** How many crashes in a row: the session gives up after the third (`MAX_RESTARTS`), and a fourth is the one more try a change earns. */
export const FOLD_ENGINE_RESTART_BUCKETS = [1, 2, 3] as const;

/**
 * The Fold engine crashed (`fold/session/foldSession.ts`), once what came of
 * the restart is known: why (`reason`: the module trapped, it was already
 * dead, another failure mid-call, or the worker itself died), the how-many-th
 * crash in a row it was, and the `outcome`. Enums and a bucket only; the
 * failure itself goes to Sentry, from the runtime.
 */
export function trackFoldEngineCrashed({ cause, attempt, outcome }: FoldEngineRestart): void {
  track(ANALYTICS_EVENTS.foldEngineCrashed, {
    reason: cause,
    outcome,
    restart_count_bucket: bucketCount(attempt, FOLD_ENGINE_RESTART_BUCKETS),
  });
}
