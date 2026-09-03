import { useCallback, useSyncExternalStore } from 'react';
import {
  cpExactSolveRunFor,
  subscribeCpExactSolveRuns,
  type CpExactSolveRun,
} from '../engine/cpExactSolveRuns';

/**
 * The live exact solve for one target, or null.
 *
 * The registry is a module-level store with no React in it by design, so this is
 * the two-line `useSyncExternalStore` binding — here rather than in `engine/` so
 * that layer stays testable without a renderer, and here rather than in either
 * surface so the modal and the region chip read run state the same way. A run's
 * `cancellable` is what decides whether a surface offers Stop at all, and one
 * predicate answering that for both is the point.
 *
 * `cpExactSolveRunFor` returns the entry out of a snapshot that is stable by
 * reference between mutations, so this re-renders exactly when the run changes.
 */
export function useCpExactSolveRun(targetId: string | null): CpExactSolveRun | null {
  const read = useCallback(
    () => (targetId === null ? null : (cpExactSolveRunFor(targetId) ?? null)),
    [targetId]
  );
  return useSyncExternalStore(subscribeCpExactSolveRuns, read, read);
}
