import type { TurnBetween } from './turn';

/** An entry of a sequence in its place: a step with its number, or a turn with the numbers either side of it. */
export type StepSlot<Step, Turn> =
  | { kind: 'step'; entry: Step; number: number }
  | { kind: 'turn'; entry: Turn; between: TurnBetween };

/**
 * Each entry in order, numbered as a page prints it: a step by its place among
 * the steps, from 1, and a turn not at all — it carries the numbers of the steps
 * either side of it instead (D22), so the cards around a turn read 3 and 4.
 *
 * Pure: no DOM, no store.
 */
export function stepSlots<Step, Turn>(
  entries: readonly (Step | Turn)[],
  isTurn: (entry: Step | Turn) => entry is Turn
): StepSlot<Step, Turn>[] {
  const total = entries.filter((entry) => !isTurn(entry)).length;
  let number = 0;
  return entries.map((entry): StepSlot<Step, Turn> => {
    if (isTurn(entry)) {
      return {
        kind: 'turn',
        entry,
        between: { before: number > 0 ? number : null, after: number < total ? number + 1 : null },
      };
    }
    number += 1;
    return { kind: 'step', entry, number };
  });
}
