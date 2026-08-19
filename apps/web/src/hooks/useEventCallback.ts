import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * A callback with a stable identity that always runs the latest closure.
 *
 * For handlers passed to a memoized child. `useCallback` cannot do this job when
 * the handler reads state that legitimately changes — the deps list would make
 * the identity churn, the child would re-render, and the memo boundary that the
 * whole design rests on would quietly stop working. Wrapping the handler instead
 * of listing its dependencies keeps the boundary intact without letting the
 * handler go stale.
 *
 * This is React's own `useEffectEvent` proposal, written out. When that ships,
 * this can be deleted in its favour.
 *
 * Not for effects: the identity never changes, so it carries no signal about
 * when to re-run. It is for event handlers, which is why it is named for them.
 */
export function useEventCallback<Args extends unknown[], Result>(
  handler: (...args: Args) => Result,
): (...args: Args) => Result {
  const ref = useRef<(...args: Args) => Result>(handler);
  // Written before any effect or layout effect can fire, so a handler invoked
  // from one during the same commit already sees this render's closure.
  useInsertionEffect(() => {
    ref.current = handler;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
