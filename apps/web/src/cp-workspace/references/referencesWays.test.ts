import { describe, expect, it } from 'vitest';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import {
  chosenWitness,
  type PrecreaseSequence,
  type PrecreaseStep,
  type PrecreaseWay,
  type PrecreaseWitness,
} from './precreaseSequence';
import {
  cardWays,
  cardsWithWays,
  presentedSequence,
  waySignature,
  wayKey,
  withWayChoice,
} from './referencesWays';

function witness(axiom: number, inputs: PrecreaseWitness['inputs'], ease = 0): PrecreaseWitness {
  return {
    axiom,
    inputs,
    root: 0,
    who_moves: [0],
    hard: false,
    visible: true,
    skinny: false,
    ease,
    err: 0,
  };
}

const bottomOntoLandmark = witness(3, [
  { kind: 'edge', id: 2, side: 'bottom' },
  { kind: 'line', id: 4 },
]);
const cornerOntoMark = witness(2, [{ kind: 'corner', id: 0, corner: 'sw' }, { kind: 'point', id: 4 }]);
const mirror = witness(2, [{ kind: 'corner', id: 2, corner: 'nw' }, { kind: 'point', id: 5 }]);
const throughMarks = witness(1, [{ kind: 'point', id: 4 }, { kind: 'point', id: 5 }], 7);

/** Step 5 of the fixture (index 4) offers three ways: its pick, then two. */
function ways(): PrecreaseWay[] {
  return [
    { witness: bottomOntoLandmark, kind: 'O3:el' },
    { witness: cornerOntoMark, kind: 'O2:cp', decided_by: 'local', also: mirror, alignment: 0.5 },
    { witness: throughMarks, kind: 'O1:pp', decided_by: 'one_motion' },
  ];
}

function sequenceWithWays(): PrecreaseSequence {
  const sequence = plannerSequenceFixture();
  sequence.steps[4] = { ...sequence.steps[4], ways: ways() };
  return sequence;
}

const STEP = 4;

function choose(sequence: PrecreaseSequence, index: number) {
  return withWayChoice({}, 0, sequence.steps[STEP], index);
}

describe('presentedSequence', () => {
  it('is the plan itself while nothing is chosen', () => {
    const sequence = sequenceWithWays();
    expect(presentedSequence(sequence, 0, {})).toBe(sequence);
  });

  it('shows the chosen way on its card and leaves every other step as it was', () => {
    const sequence = sequenceWithWays();
    const presented = presentedSequence(sequence, 0, choose(sequence, 1));
    const step = presented.steps[STEP];
    expect(chosenWitness(step)).toEqual(cornerOntoMark);
    expect(step.also).toEqual(mirror);
    expect(step.alignment).toBe(0.5);
    expect(step.ease).toBe(cornerOntoMark.ease);
    // The planned witnesses are still there; the way is added to present it.
    expect(step.witnesses.slice(0, sequence.steps[STEP].witnesses.length)).toEqual(
      sequence.steps[STEP].witnesses
    );
    presented.steps.forEach((other, index) => {
      if (index !== STEP) expect(other).toBe(sequence.steps[index]);
    });
    expect(cardWays(step)).toEqual({ count: 3, index: 1 });
  });

  it('drops the pick\'s own mirror alignment for a way that has none', () => {
    const sequence = sequenceWithWays();
    sequence.steps[STEP] = { ...sequence.steps[STEP], also: mirror, alignment: 0.2 };
    const presented = presentedSequence(sequence, 0, choose(sequence, 2));
    expect(presented.steps[STEP].also).toBeUndefined();
    expect(presented.steps[STEP].alignment).toBeUndefined();
  });

  it('falls back to the pick for a choice this plan does not offer', () => {
    const sequence = sequenceWithWays();
    const stale = { [wayKey(0, sequence.steps[STEP])]: waySignature(witness(6, [])) };
    expect(presentedSequence(sequence, 0, stale)).toBe(sequence);
    expect(presentedSequence(sequence, 1, choose(sequence, 1))).toBe(sequence);
  });

  it('switches a twin card as one, each fold to the way of the same index', () => {
    const sequence = sequenceWithWays();
    const first: PrecreaseStep = { ...sequence.steps[1], twin: 3, ways: ways() };
    const twinWays: PrecreaseWay[] = ways().map((way) => ({ ...way, kind: `${way.kind}'` }));
    const second: PrecreaseStep = { ...sequence.steps[2], twin: 2, ways: twinWays };
    sequence.steps[1] = first;
    sequence.steps[2] = second;
    const choices = withWayChoice({}, 0, first, 2);
    const presented = presentedSequence(sequence, 0, choices);
    expect(chosenWitness(presented.steps[1])).toEqual(throughMarks);
    expect(chosenWitness(presented.steps[2])).toEqual(twinWays[2].witness);
    expect(cardWays(presented.steps[2])).toEqual({ count: 3, index: 2 });
  });

  it('carries a fold\'s way to the presses that show its witness', () => {
    const sequence = sequenceWithWays();
    const fold = sequence.steps[STEP];
    const press: PrecreaseStep = { ...fold, id: 6, card: 6, kind: 'press' };
    sequence.steps.push(press);
    const presented = presentedSequence(sequence, 0, choose(sequence, 1));
    expect(chosenWitness(presented.steps[5])).toEqual(cornerOntoMark);
  });
});

describe('withWayChoice', () => {
  it('remembers a way by its construction, and forgets the card on its pick', () => {
    const sequence = sequenceWithWays();
    const step = sequence.steps[STEP];
    const chosen = withWayChoice({}, 0, step, 1);
    expect(chosen).toEqual({ [wayKey(0, step)]: waySignature(cornerOntoMark) });
    expect(withWayChoice(chosen, 0, step, 0)).toEqual({});
  });

  it('changes nothing for a way the card does not offer, or a pick already shown', () => {
    const sequence = sequenceWithWays();
    const choices = {};
    expect(withWayChoice(choices, 0, sequence.steps[STEP], 7)).toBe(choices);
    expect(withWayChoice(choices, 0, sequence.steps[STEP], 0)).toBe(choices);
    expect(withWayChoice(choices, 0, sequence.steps[0], 1)).toBe(choices);
  });

  it('tells two constructions apart by their inputs and root', () => {
    expect(waySignature(cornerOntoMark)).not.toBe(waySignature(mirror));
    expect(waySignature(cornerOntoMark)).not.toBe(waySignature({ ...cornerOntoMark, root: 1 }));
  });
});

describe('cardWays', () => {
  it('is null for a card with one way', () => {
    const sequence = sequenceWithWays();
    expect(cardWays(sequence.steps[0])).toBeNull();
    expect(cardWays({ ...sequence.steps[0], ways: ways().slice(0, 1) })).toBeNull();
    expect(cardWays(sequence.steps[STEP])).toEqual({ count: 3, index: 0 });
  });

  it('counts the cards that offer a choice once each, a twin pair as one', () => {
    const sequence = sequenceWithWays();
    expect(cardsWithWays(sequence)).toBe(1);
    sequence.steps[1] = { ...sequence.steps[1], ways: ways(), card: 2 };
    sequence.steps[2] = { ...sequence.steps[2], ways: ways(), card: 2 };
    expect(cardsWithWays(sequence)).toBe(2);
  });
});
