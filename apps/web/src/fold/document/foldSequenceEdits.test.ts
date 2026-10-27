import { describe, expect, it } from 'vitest';

import {
  FOLD_OP_KINDS,
  isLockedStep,
  rectangleShape,
  type FoldLockedStep,
  type FoldMark,
  type FoldOp,
  type FoldStep,
} from './foldSequenceDocument';
import { readFoldSequence } from './foldSequenceFile';
import {
  appendFoldStep,
  deleteFoldStep,
  setFoldMarks,
  setFoldPaperShape,
  setFoldPaperStyle,
  setFoldSequenceTitle,
  setFoldStartSide,
  setFoldStepNote,
} from './foldSequenceEdits';
import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { sequenceOf, sequentialIds, step, valleyAt, writtenSequence } from './foldSequence.fixtures';

const locked: FoldLockedStep = { id: 'l', parent: 'a', unknown: { id: 'l', parent: 'a', op: { kind: 'sink' } } };
const document = () => sequenceOf([step('a', null), step('b', 'a', valleyAt(0.25)), locked, step('m', 'l')]);
const mark: FoldMark = { id: 'fmark-9', from: [0, 0], to: [1, 0], divide: { mode: 'count', parts: 3 } };
const ids = (steps: readonly { id: string }[]) => steps.map((node) => node.id);

describe('appendFoldStep', () => {
  it('appends a step under its parent, making a branch at a step that has children', () => {
    const committed = appendFoldStep(
      document(),
      { parent: 'a', op: valleyAt(0.6), expect: 'fs1:0000000000000000' },
      sequentialIds()
    )!;
    expect(committed.id).toBe('fstep-1');
    expect(ids(committed.document.steps)).toEqual(['a', 'b', 'l', 'm', 'fstep-1']);
    expect(committed.document.steps[4]).toEqual({
      id: 'fstep-1',
      parent: 'a',
      op: valleyAt(0.6),
      expect: 'fs1:0000000000000000',
    });
  });

  it('commits from the flat sheet', () => {
    expect(appendFoldStep(document(), { parent: null, op: valleyAt(0.6) })?.document.steps).toHaveLength(5);
  });

  it('refuses a parent the sequence does not hold, or one that is locked', () => {
    for (const parent of ['missing', 'l', 'm']) {
      expect(appendFoldStep(document(), { parent, op: valleyAt(0.6) }), parent).toBeNull();
    }
  });

  it('adopts a sheet with the first step of an empty sequence, in the same edit (plan D16)', () => {
    const rectangle = rectangleShape(1, 0.5)!;
    const empty = { ...sequenceOf([]), sheetMarks: [mark] };
    const adopted = appendFoldStep(empty, { parent: null, op: valleyAt(0.25), adopt: rectangle }, sequentialIds())!;
    expect(adopted.document.paper).toEqual({ shape: rectangle, startSide: 'front' });
    // The shape changed, so the marks made on the old sheet go, as a change of shape takes them.
    expect(adopted.document.sheetMarks).toBeUndefined();
    // What the step stores is the op, never the sheet it adopted.
    expect(adopted.document.steps).toEqual([{ id: 'fstep-1', parent: null, op: valleyAt(0.25) }]);

    // The same shape is no change of shape: the marks stay.
    const square = appendFoldStep(empty, { parent: null, op: valleyAt(0.25), adopt: { kind: 'square' } })!;
    expect(square.document.paper).toBe(empty.paper);
    expect(square.document.sheetMarks).toEqual([mark]);
  });

  it('refuses to adopt a sheet for a sequence that already has steps, or for a step after another', () => {
    const adopt = rectangleShape(1, 0.5)!;
    expect(appendFoldStep(document(), { parent: null, op: valleyAt(0.6), adopt })).toBeNull();
    expect(appendFoldStep(document(), { parent: 'a', op: valleyAt(0.6), adopt })).toBeNull();
  });

  it('appends every op and choice the file keeps, of every kind', () => {
    const steps = readFoldSequence(writtenSequence())!.document.steps.filter((node): node is FoldStep => !isLockedStep(node));
    expect(new Set(steps.map((node) => node.op.kind))).toEqual(new Set(FOLD_OP_KINDS.filter((kind) => kind !== 'tuck')));
    for (const node of steps) {
      const history = node.op.kind === 'unfold-to' ? [step('a', null)] : [];
      const draft = { parent: history.at(-1)?.id ?? null, op: node.op, ...(node.choices ? { choices: node.choices } : {}) };
      expect(appendFoldStep(sequenceOf(history), draft)?.document.steps.at(-1), node.id).toMatchObject(draft);
    }
  });

  it('refuses a step the file would not keep as it folds: it would come back locked, or folding otherwise', () => {
    const model = { via: 'model', line: { n: [0, 1], d: 0.5 } };
    const reverse = { kind: 'inside-reverse', line: valleyAt(0.5).line, moving: [0.5, 0.9], seed: { scope: 'all' } };
    const tuck = {
      kind: 'tuck',
      line: valleyAt(0.5).line,
      direction: 'valley',
      seed: { scope: 'flaps', at: [[0.5, 0.9]] },
      target: [0.5, 0.25],
    };
    const ops = [
      // The tools' line in the parent's model frame, which the document never writes, and its side.
      { kind: 'valley', line: model, side: 'positive', seed: { scope: 'all' } },
      { ...reverse, line: model },
      { kind: 'crimp', line: valleyAt(0.5).line, second: model, crimp: 'inside', moving: [0.5, 0.9], seed: { scope: 'all' } },
      // The tools' other additions, which change how the step folds.
      { ...valleyAt(0.5), closure: 'refuse' },
      { ...tuck, placement: { placement: 'on_top' } },
    ];
    for (const op of ops) {
      expect(appendFoldStep(document(), { parent: 'a', op: op as unknown as FoldOp }), JSON.stringify(op)).toBeNull();
    }
    // Choices the file would not read: a root whose normal is no direction.
    const choices = { root: { n: [0, 0] as [number, number], d: 0.5 } };
    expect(appendFoldStep(document(), { parent: 'a', op: valleyAt(0.6), choices })).toBeNull();
  });
});

describe('deleteFoldStep', () => {
  it('deletes a step and what follows it, locked or not', () => {
    expect(ids(deleteFoldStep(document(), 'l').steps)).toEqual(['a', 'b']);
    expect(ids(deleteFoldStep(document(), 'a').steps)).toEqual([]);
  });

  it('changes nothing for a step it does not hold', () => {
    const original = document();
    expect(deleteFoldStep(original, 'missing')).toBe(original);
  });
});

describe('notes and marks', () => {
  it('sets a note, and clears it when empty', () => {
    const noted = setFoldStepNote(document(), 'b', 'Fold\u000b down.');
    expect((noted.steps[1] as FoldStep).note).toBe('Fold down.');
    expect(noted.steps[1]).not.toBe(document().steps[1]);
    expect(setFoldStepNote(noted, 'b', '').steps[1]).not.toHaveProperty('note');
    expect(setFoldStepNote(noted, 'b', 'Fold down.')).toBe(noted);
  });

  it('edits nothing locked', () => {
    const original = document();
    expect(setFoldStepNote(original, 'l', 'x')).toBe(original);
    expect(setFoldStepNote(original, 'm', 'x')).toBe(original);
    expect(setFoldMarks(original, 'm', [mark])).toBe(original);
  });

  it('sets and clears the marks of a step and of the sheet', () => {
    const marked = setFoldMarks(setFoldMarks(document(), 'b', [mark]), null, [mark]);
    expect((marked.steps[1] as FoldStep).marks).toEqual([mark]);
    expect(marked.sheetMarks).toEqual([mark]);
    const cleared = setFoldMarks(setFoldMarks(marked, 'b', []), null, []);
    expect(cleared.steps[1]).not.toHaveProperty('marks');
    expect(cleared).not.toHaveProperty('sheetMarks');
    expect(setFoldMarks(cleared, null, [])).toBe(cleared);
  });
});

describe('setFoldPaperShape', () => {
  it('replaces the shape and empties the steps and the sheet’s marks, as one edit', () => {
    const changed = setFoldPaperShape(setFoldMarks(document(), null, [mark]), rectangleShape(1, Math.SQRT2)!);
    expect(changed.paper).toEqual({ shape: rectangleShape(1, Math.SQRT2), startSide: 'front' });
    expect(changed.steps).toEqual([]);
    expect(changed).not.toHaveProperty('sheetMarks');
  });

  it('changes nothing for the same shape', () => {
    const original = document();
    expect(setFoldPaperShape(original, { kind: 'square' })).toBe(original);
  });
});

describe('setFoldPaperStyle', () => {
  it('draws the sequence in another style and keeps its steps', () => {
    const original = document();
    const changed = setFoldPaperStyle(original, { preset: 'default' });
    expect(changed.style).toEqual({ preset: 'default', style: builtInPaperPreset('default').style });
    expect(changed.steps).toBe(original.steps);
    expect(changed.paper).toBe(original.paper);
  });

  it('changes nothing for the style it has, the default included', () => {
    const original = document();
    // A new sequence uses Diagram: picking it again changes nothing.
    expect(setFoldPaperStyle(original, { preset: 'diagram' })).toBe(original);
    const styled = setFoldPaperStyle(original, { preset: 'default' });
    expect(setFoldPaperStyle(styled, { preset: 'default' })).toBe(styled);
  });

  it('lets go of a newer build’s style once another is chosen', () => {
    const held = { ...document(), carried: { style: { preset: 'satin' }, other: 1 } };
    const changed = setFoldPaperStyle(held, { preset: 'diagram' });
    expect(changed.carried).toEqual({ other: 1 });
    expect(changed.style).toEqual({ preset: 'diagram', style: builtInPaperPreset('diagram').style });
  });
});

describe('setFoldSequenceTitle', () => {
  it('sets the title as text a file can hold, without surrounding space', () => {
    expect(setFoldSequenceTitle(document(), '  Crane\u000b base ').title).toBe('Crane base');
  });

  it('changes nothing for the same title', () => {
    const original = document();
    expect(setFoldSequenceTitle(original, 'Test ')).toBe(original);
  });
});

describe('setFoldStartSide', () => {
  const expecting = () =>
    sequenceOf([
      step('a', null, valleyAt(0.5), { expect: 'fs1:0000000000000000', note: 'Kept.' }),
      step('b', 'a', valleyAt(0.25)),
      locked,
    ]);

  it('turns the sheet over and keeps the steps, letting go of where each landed', () => {
    const original = expecting();
    const turned = setFoldStartSide(original, 'back');
    expect(turned.paper).toEqual({ shape: { kind: 'square' }, startSide: 'back' });
    expect(ids(turned.steps)).toEqual(['a', 'b', 'l']);
    // Each step now lands as the mirror of what it was committed at: no drift to report.
    expect(turned.steps[0]).toEqual(step('a', null, valleyAt(0.5), { note: 'Kept.' }));
    // A step with nothing to let go of, and one this build cannot read, are carried as they came.
    expect(turned.steps[1]).toBe(original.steps[1]);
    expect(turned.steps[2]).toBe(locked);
  });

  it('changes nothing for the side already up', () => {
    const original = expecting();
    expect(setFoldStartSide(original, 'front')).toBe(original);
  });
});
