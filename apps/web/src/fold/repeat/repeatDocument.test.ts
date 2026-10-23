import { describe, expect, it } from 'vitest';
import type { FoldOp, FoldRepeatOp } from '../document/foldSequenceDocument';
import { isLockedStep } from '../document/foldSequenceDocument';
import { readFoldSequence, writeFoldSequence } from '../document/foldSequenceFile';
import { appendFoldSteps, setFoldStepNote, updateFoldRepeat } from '../document/foldSequenceEdits';
import { foldNodeDigest } from '../document/foldDigest';
import { sequenceOf, sequentialIds, step, valleyAt } from '../document/foldSequence.fixtures';

const recipe = (): FoldRepeatOp => ({
  kind: 'repeat',
  source: { first: 'a', last: 'a', revision: 'fh1:original' },
  axis: { n: [1, 0], d: 0.5 },
  parentState: 'fs1:parent',
  steps: [{ op: valleyAt(0.2), sourceStep: 'a', expect: 'fs1:after' }],
});
const document = () =>
  sequenceOf([
    step('a', null),
    { ...step('repeat', 'a', recipe()), note: 'Keep this note.', spread: 'off' as const },
    step('later', 'repeat'),
  ]);

describe('Repeat document transactions', () => {
  it('keeps the frozen recipe and cache identity when source annotations change', () => {
    const before = document();
    const annotated = setFoldStepNote(before, 'a', 'New tutorial reference');
    expect(annotated.steps[1]).toBe(before.steps[1]);
    expect(foldNodeDigest(annotated, 'repeat')).toBe(foldNodeDigest(before, 'repeat'));
  });

  it('updates explicitly with compare-and-swap, retaining annotations and descendants', () => {
    const before = document();
    const op = recipe();
    const replacement = { ...op, parentState: 'fs1:updated' };
    const updated = updateFoldRepeat(before, 'repeat', op, replacement, 'fs1:result');
    expect(updated.steps[1]).toMatchObject({
      id: 'repeat',
      note: 'Keep this note.',
      spread: 'off',
      op: replacement,
    });
    expect(updated.steps[2]).toBe(before.steps[2]);
    expect(foldNodeDigest(updated, 'later')).not.toBe(foldNodeDigest(before, 'later'));
    expect(updateFoldRepeat(updated, 'repeat', op, replacement, 'fs1:other')).toBe(updated);
  });

  it('refuses a malformed later individual operation without partially changing the document', () => {
    const before = document();
    const ids = sequentialIds();
    expect(
      appendFoldSteps(
        before,
        'a',
        [{ op: valleyAt(0.2) }, { op: { kind: 'future-operation' } as unknown as FoldOp }],
        ids,
      ),
    ).toBeNull();
    expect(before.steps.map((s) => s.id)).toEqual(['a', 'repeat', 'later']);
  });

  it.each([
    { steps: [{ op: { kind: 'future-operation' }, expect: 'fs1:a', sourceStep: 'a' }] },
    { steps: [] },
    { axis: { n: [0, 0], d: 0.5 } },
    { steps: [{ ...recipe().steps[0], returnTo: 0 }] },
    {
      steps: [
        {
          op: {
            kind: 'unfold-to',
            target: 'a',
            source: { path: 'fh1:a', state: 'fs1:a', targetState: 'fs1:b' },
          },
          expect: 'fs1:c',
          sourceStep: 'a',
          returnTo: 1,
        },
      ],
    },
    { steps: Array.from({ length: 129 }, () => recipe().steps[0]) },
  ])('locks and preserves unsupported or malformed internal payloads: %j', (change) => {
    const raw = { ...document(), steps: [{ id: 'r', parent: null, op: { ...recipe(), ...change } }] };
    const held = readFoldSequence(raw)!;
    expect(isLockedStep(held.document.steps[0])).toBe(true);
    expect((writeFoldSequence(held).steps as unknown[])[0]).toEqual(raw.steps[0]);
  });

  it('bounds nested recipes and their combined operation count', () => {
    const nested = (levels: number): FoldRepeatOp =>
      levels === 0
        ? recipe()
        : {
            ...recipe(),
            steps: [{ op: nested(levels - 1), expect: 'fs1:x', sourceStep: 'a' }],
          };
    for (const op of [
      nested(5),
      {
        ...recipe(),
        steps: Array.from({ length: 128 }, () => ({
          op: { ...recipe(), steps: [recipe().steps[0]!, recipe().steps[0]!] },
          expect: 'fs1:x',
          sourceStep: 'a',
        })),
      },
    ]) {
      const held = readFoldSequence({ ...document(), steps: [{ id: 'r', parent: null, op }] })!;
      expect(isLockedStep(held.document.steps[0])).toBe(true);
    }
  });
});
