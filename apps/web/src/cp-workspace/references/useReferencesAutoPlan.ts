/**
 * Work out the folding sequence on arrival, the way Simulate folds on arrival.
 *
 * The sequence is what the workspace is *for*; asking the user to press a button
 * before it will say anything made the landing state an empty page with a
 * question on it. Simulate has no such button — one effect in `SimulatorPanel`
 * calls `ensureFoldArtifacts()` whenever there is a crease pattern and no
 * artifacts, and the store's per-revision memo is what keeps that safe.
 *
 * References has no such memo, so this hook is one: it remembers every
 * (revision, sheet) it has already started, and refuses to start that pair
 * again. That covers the three ways an automatic run turns into a loop —
 * a failed run, a run the user stopped, and a re-render — because all three
 * leave the pair attempted and no plan behind, and none of them should be
 * retried without the user asking. Recompute is how they ask; it goes through
 * the same `run` and does not consult this.
 *
 * Deliberately *not* the Simulate behaviour in one respect: an edit does not
 * re-run. A plan takes seconds and is bounded only by a 30 s budget, so
 * recomputing on every keystroke in the Edit tab would be hostile; the panel
 * marks the plan out of date and offers Recompute instead (plan D9).
 */
import { useEffect, useRef } from 'react';

export interface ReferencesAutoPlanState {
  /** There is a crease pattern to answer for. */
  hasDocument: boolean;
  /** The identity of the geometry — a plan belongs to one. */
  revision: string;
  /** The sheet the rail has selected, or null before the frames land. */
  sheet: number | null;
  /** The frames analysis has resolved, so `run` has something to plan. */
  ready: boolean;
  /** A plan for this (revision, sheet) already exists. */
  planned: boolean;
  /** Anything is already computing. */
  busy: boolean;
  /** A vertex or crease is picked; the whole-pattern run is not what is wanted. */
  targeted: boolean;
}

/** Nothing has been attempted until frames exist, so the key is null until then. */
function autoPlanKey(state: ReferencesAutoPlanState): string | null {
  if (!state.hasDocument || !state.ready || state.sheet === null) return null;
  return `${state.revision}::${state.sheet}`;
}

export function useReferencesAutoPlan(state: ReferencesAutoPlanState, run: () => void): void {
  const attempted = useRef(new Set<string>());
  // Read through a ref so a new `run` identity each render does not re-fire the
  // effect; what decides a run is the key, and only the key.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  const key = autoPlanKey(state);
  const blocked = state.planned || state.busy || state.targeted;
  useEffect(() => {
    if (key === null || blocked) return;
    if (attempted.current.has(key)) return;
    attempted.current.add(key);
    runRef.current();
  }, [key, blocked]);
}
