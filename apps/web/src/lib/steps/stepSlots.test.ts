import { describe, expect, it } from 'vitest';
import { stepSlots } from './stepSlots';

type Step = { id: string };
type Turn = { id: string; turn: true };
const isTurn = (entry: Step | Turn): entry is Turn => 'turn' in entry;
const step = (id: string): Step => ({ id });
const turn = (id: string): Turn => ({ id, turn: true });

describe('stepSlots', () => {
  it('numbers the steps from 1 and leaves a turn unnumbered, with the steps either side of it', () => {
    const slots = stepSlots([step('a'), step('b'), turn('t'), step('c')], isTurn);
    expect(slots).toEqual([
      { kind: 'step', entry: step('a'), number: 1 },
      { kind: 'step', entry: step('b'), number: 2 },
      { kind: 'turn', entry: turn('t'), between: { before: 2, after: 3 } },
      { kind: 'step', entry: step('c'), number: 3 },
    ]);
  });

  it('gives a turn at either end no step on that side, and turns side by side the same pair', () => {
    const slots = stepSlots([turn('first'), step('a'), turn('one'), turn('two'), step('b'), turn('last')], isTurn);
    expect(slots.flatMap((slot) => (slot.kind === 'turn' ? [[slot.entry.id, slot.between]] : []))).toEqual([
      ['first', { before: null, after: 1 }],
      ['one', { before: 1, after: 2 }],
      ['two', { before: 1, after: 2 }],
      ['last', { before: 2, after: null }],
    ]);
  });

  it('has no step either side of a turn in a sequence of turns alone', () => {
    expect(stepSlots([turn('t')], isTurn)).toEqual([
      { kind: 'turn', entry: turn('t'), between: { before: null, after: null } },
    ]);
    expect(stepSlots([], isTurn)).toEqual([]);
  });
});
