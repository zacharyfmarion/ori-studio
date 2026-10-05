/**
 * How far a pick tool's sequence has come (15b): the step the next press is
 * for, and why the last finished nothing, if it did not — what the canvas
 * knows and the tool window says. One sequence is ever in progress: the
 * canvas open in Annotate writes it, and clears it when its tool or step
 * goes.
 */
import { useSyncExternalStore } from 'react';
import type { BisectorRefusal, BisectorStep } from './angleBisector';

/** The steps of the equal-angle mark put down on its own: an arm, the vertex, the other arm. */
export type AngleMarkStep = 'arm' | 'mark-vertex' | 'other-arm';

export interface PickProgress {
  step: BisectorStep | AngleMarkStep;
  refusal: BisectorRefusal | null;
}

let current: PickProgress | null = null;
const listeners = new Set<() => void>();

export function setPickProgress(next: PickProgress | null): void {
  if (current === next || (current && next && current.step === next.step && current.refusal === next.refusal)) return;
  current = next;
  for (const listener of listeners) listener();
}

export function pickProgress(): PickProgress | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The sequence in progress, for a surface that says what it asks for next. */
export function usePickProgress(): PickProgress | null {
  return useSyncExternalStore(subscribe, pickProgress, pickProgress);
}
