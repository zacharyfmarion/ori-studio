import type { FoldChoices } from '../document/foldSequenceDocument';
import type { FoldEngineCalls } from './foldEngineCalls';
import type { FoldEngineOp } from './foldEngineWire';

/**
 * A square folded to the preliminary base and precreased across it — two
 * diagonal precreases, a mountain fold in half, two inside reverses, then a
 * valley fold and unfold through every layer at half the base's height — as
 * a user drew it (the open sink report, 2026-10-11): each step's op and the
 * root it stored. Step 6 is the precrease; it folds nothing, so every picture
 * of it should be step 5's with the precrease's lines on.
 */
export const PRECREASED_BASE_STEPS: ReadonlyArray<{ op: FoldEngineOp; choices: FoldChoices }> = [
  {
    op: {
      kind: 'precrease',
      line: { via: 'axiom', axiom: 1, inputs: [{ kind: 'point', at: [0, 0] }, { kind: 'point', at: [1, 1] }] },
      direction: 'valley',
      moving: [1 / 3, 2 / 3],
      seed: { scope: 'all' },
    },
    choices: { root: { n: [Math.SQRT1_2, -Math.SQRT1_2], d: 0 } },
  },
  {
    op: {
      kind: 'precrease',
      line: { via: 'axiom', axiom: 1, inputs: [{ kind: 'point', at: [0, 1] }, { kind: 'point', at: [1, 0] }] },
      direction: 'valley',
      moving: [1 / 6, 0.5],
      seed: { scope: 'all' },
    },
    choices: { root: { n: [Math.SQRT1_2, Math.SQRT1_2], d: Math.SQRT1_2 } },
  },
  {
    op: {
      kind: 'mountain',
      line: { via: 'axiom', axiom: 1, inputs: [{ kind: 'point', at: [0, 0.5] }, { kind: 'point', at: [1, 0.5] }] },
      moving: [0.5, 5 / 6],
      seed: { scope: 'all' },
    },
    choices: { root: { n: [0, 1], d: 0.5 } },
  },
  {
    op: {
      kind: 'inside-reverse',
      line: { via: 'axiom', axiom: 1, inputs: [{ kind: 'point', at: [0.5, 0.5] }, { kind: 'point', at: [1, 0] }] },
      moving: [5 / 6, 1 / 3],
      seed: { scope: 'all' },
    },
    choices: { root: { n: [Math.SQRT1_2, Math.SQRT1_2], d: Math.SQRT1_2 } },
  },
  {
    op: {
      kind: 'inside-reverse',
      line: { via: 'axiom', axiom: 1, inputs: [{ kind: 'point', at: [0.5, 0.5] }, { kind: 'point', at: [0, 0] }] },
      moving: [1 / 6, 1 / 3],
      seed: { scope: 'all' },
    },
    choices: { root: { n: [Math.SQRT1_2, -Math.SQRT1_2], d: 0 } },
  },
  {
    op: {
      kind: 'precrease',
      line: { via: 'axiom', axiom: 2, inputs: [{ kind: 'point', at: [0.5, 0.5] }, { kind: 'point', at: [0.5, 0] }] },
      direction: 'valley',
      seed: { scope: 'all' },
    },
    choices: { root: { n: [4.440892098500628e-16, -1], d: -0.2499999999999999 } },
  },
];

/** Every state of {@link PRECREASED_BASE_STEPS}, the flat sheet first: index `k` is after step `k`. */
export function precreasedBaseStates(calls: FoldEngineCalls): number[] {
  const sheet = calls.sheet({ shape: { kind: 'square' }, startSide: 'front' });
  if (sheet.status !== 'ok') throw new Error(`no sheet: ${JSON.stringify(sheet.refusal)}`);
  const states = [sheet.state];
  for (const { op, choices } of PRECREASED_BASE_STEPS) {
    const landed = calls.step(states[states.length - 1]!, op, choices);
    if (landed.status !== 'ok') throw new Error(`step ${states.length} refused: ${JSON.stringify(landed.refusal)}`);
    states.push(landed.state);
  }
  return states;
}
