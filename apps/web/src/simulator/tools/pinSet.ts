import type { PinMode } from './types';

/**
 * A pin set: crease-pattern face ids, ascending and without repeats, so two
 * sets that pin the same faces compare equal element by element.
 */
export type PinSet = readonly number[];

export const EMPTY_PIN_SET: PinSet = [];

function normalise(faces: Iterable<number>): PinSet {
  return [...new Set(faces)].sort((a, b) => a - b);
}

/** The faces pinned after a pick combines with the ones already pinned. */
export function applyPinPick(current: PinSet, picked: readonly number[], mode: PinMode): PinSet {
  switch (mode) {
    case 'replace':
      return normalise(picked);
    case 'add':
      return picked.length === 0 ? current : normalise([...current, ...picked]);
    case 'toggle': {
      if (picked.length === 0) return current;
      const next = new Set(current);
      for (const face of new Set(picked)) {
        if (next.has(face)) next.delete(face);
        else next.add(face);
      }
      return normalise(next);
    }
  }
}

export function pinSetsEqual(a: PinSet, b: PinSet): boolean {
  return a.length === b.length && a.every((face, index) => face === b[index]);
}

/**
 * How a pick went, as the analytics event reports it: it found nothing, it
 * changed the set, or it found faces and left the set as it was.
 */
export function pinPickOutcome(
  before: PinSet,
  after: PinSet,
  picked: readonly number[]
): 'empty' | 'changed' | 'unchanged' {
  if (picked.length === 0) return 'empty';
  return pinSetsEqual(before, after) ? 'unchanged' : 'changed';
}
