import { describe, expect, it } from 'vitest';
import {
  readFoldSequence,
  writeFoldSequence,
} from '../../document/foldSequenceFile';
import { FOLD_DEFAULT_PAPER_STYLE, isLockedStep } from '../../document/foldSequenceDocument';
const op = {
  kind: 'pleat',
  line: {
    via: 'free',
    through: [
      [0.5, 0],
      [0.5, 1],
    ],
  },
  second: {
    via: 'free',
    through: [
      [0.75, 0],
      [0.75, 1],
    ],
  },
  seed: { scope: 'all' },
  moving: [0.9, 0.5],
  resolved: [
    { landing: { kind: 'outer' } },
    {
      landing: { kind: 'against', targets: [[0.2, 0.3]] },
      completion: {
        faces: [
          [0.2, 0.3],
          [0.8, 0.3],
        ],
        orders: [[0, 1, 1]],
      },
    },
  ],
};
const doc = {
  formatVersion: 2,
  id: 'pleat',
  title: '',
  paper: { shape: { kind: 'square' }, startSide: 'front' },
  style: FOLD_DEFAULT_PAPER_STYLE,
  steps: [{ id: 'one', parent: null, op }],
};
describe('Pleat file format', () => {
  it('round-trips both lines and native placement decisions', () => {
    const held = readFoldSequence(doc)!;
    expect(isLockedStep(held.document.steps[0]!)).toBe(false);
    expect(writeFoldSequence(held)).toEqual(doc);
    expect(
      readFoldSequence(JSON.parse(JSON.stringify(writeFoldSequence(held))))
        ?.document,
    ).toEqual(held.document);
  });
  it.each(
    [
      [],
      [{ landing: { kind: 'outer' } }],
      [
        { landing: { kind: 'outer' } },
        { landing: { kind: 'outer' } },
        { landing: { kind: 'outer' } },
      ],
      [{}, {}],
    ].map((resolved) => ({ resolved })),
  )(
    'preserves a malformed saved decision as a locked step: %j',
    ({ resolved }) => {
      const held = readFoldSequence({
        ...doc,
        steps: [{ ...doc.steps[0], op: { ...op, resolved } }],
      })!;
      expect(isLockedStep(held.document.steps[0]!)).toBe(true);
    },
  );
});

it('round-trips the independently chosen second axiom root and locks missing or malformed roots', () => {
  const second = { via: 'axiom', axiom: 2, inputs: [{ kind: 'point', at: [0.5, 0.3] }, { kind: 'point', at: [0.5, 0.7] }] };
  const rooted = { ...doc, steps: [{ ...doc.steps[0], op: { ...op, second, secondRoot: { n: [0, 1], d: 0.5 } } }] };
  const held = readFoldSequence(rooted)!;
  expect(isLockedStep(held.document.steps[0]!)).toBe(false);
  expect(writeFoldSequence(held)).toEqual(rooted);
  for (const secondRoot of [undefined, { n: [0, 0], d: 0.5 }, { n: [0, 1], d: 'bad' }]) {
    const malformed = { ...rooted, steps: [{ ...doc.steps[0], op: { ...op, second, secondRoot } }] };
    expect(isLockedStep(readFoldSequence(malformed)!.document.steps[0]!)).toBe(true);
  }
});
