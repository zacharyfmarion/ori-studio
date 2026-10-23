import { describe, expect, it } from 'vitest';

import { foldNodeDigest, foldStepKey } from './foldDigest';
import { isLockedStep, reverseKindOf, type FoldReverseOp, type FoldStep } from './foldSequenceDocument';
import { readFoldSequence, writeFoldOp } from './foldSequenceFile';
import { sequenceOf, sequentialIds, step } from './foldSequence.fixtures';

const inside: FoldReverseOp = {
  kind: 'inside-reverse',
  line: { via: 'free', through: [[0.6, 0.5], [0.9, 0.5]] },
  moving: [0.9, 0.2],
  seed: { scope: 'all' },
};

function readOne(op: unknown, choices?: unknown) {
  const held = readFoldSequence(
    { formatVersion: 1, id: 'fold-a', title: '', steps: [{ id: 'a', parent: null, op, ...(choices ? { choices } : {}) }] },
    { newId: sequentialIds() }
  );
  const node = held?.document.steps[0];
  if (!node) throw new Error('no step');
  return node;
}

describe('the reverse fold in the document', () => {
  it('reads and writes both kinds as a fold along a line, its choices the engine’s own', () => {
    for (const kind of ['inside-reverse', 'outside-reverse'] as const) {
      const op = { ...inside, kind };
      const choices = {
        completion: { faces: [[0.8, 0.3], [0.7, 0.6]], orders: [[0, 1, -1]] },
        opening: [{ upper: [[0.95, 0.1]] }],
      };
      const node = readOne(JSON.parse(JSON.stringify(op)), choices);
      expect(isLockedStep(node)).toBe(false);
      expect((node as FoldStep).op).toEqual(op);
      expect((node as FoldStep).choices).toEqual(choices);
      expect(writeFoldOp(op)).toEqual(JSON.parse(JSON.stringify(op)));
    }
    expect(reverseKindOf(inside)).toBe('inside');
    expect(reverseKindOf({ ...inside, kind: 'outside-reverse' })).toBe('outside');
  });

  it('locks one it cannot read — a key it does not know, a seed it cannot store — as a build without it locks it', () => {
    for (const op of [
      { ...inside, direction: 'valley' },
      { ...inside, moving: undefined },
      { ...inside, line: { via: 'model', line: { n: [0, 1], d: 0.5 } } },
      // A compound fold this build does not fold: locked by the same rule.
      { ...inside, kind: 'crimp' },
    ]) {
      expect(isLockedStep(readOne(JSON.parse(JSON.stringify(op)))), JSON.stringify(op)).toBe(true);
    }
  });

  it('spells its kind and its choices into fh1, so a step chosen otherwise is another path', () => {
    const base = step('a', null, inside);
    const outside = step('a', null, { ...inside, kind: 'outside-reverse' });
    const opened = step('a', null, inside, { choices: { opening: [{ upper: [[0.95, 0.1]] }] } });
    const ordered = step('a', null, inside, {
      choices: { completion: { faces: [[0.8, 0.3], [0.7, 0.6]], orders: [[0, 1, 1]] } },
    });
    const keys = [base, outside, opened, ordered].map(foldStepKey);
    expect(new Set(keys).size).toBe(4);
    const paths = [base, outside].map((node) => foldNodeDigest(sequenceOf([node]), node.id));
    expect(paths[0]).not.toBeNull();
    expect(paths[0]).not.toBe(paths[1]);
  });
});
