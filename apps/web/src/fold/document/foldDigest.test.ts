import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  foldDrift,
  foldNodeDigest,
  foldPathDigest,
  foldStateFingerprint,
  foldStepKey,
} from './foldDigest';
import { rectangleShape, type FoldLockedStep, type FoldPaper, type FoldStep } from './foldSequenceDocument';
import { readFoldSequence, writeFoldOp, writeFoldSequence } from './foldSequenceFile';
import { setFoldMarks, setFoldStepNote, setFoldStepSpread } from './foldSequenceEdits';
import { sequenceOf, step, valleyAt, writtenSequence } from './foldSequence.fixtures';

const axiomValley = (d: number): FoldStep =>
  step('x', 'a', {
    kind: 'valley',
    line: {
      via: 'axiom',
      axiom: 5,
      inputs: [
        { kind: 'point', at: [0, 0.5] },
        { kind: 'point', at: [1, 0] },
        { kind: 'edge', a: [0, 1], b: [1, 1] },
      ],
    },
    seed: { scope: 'flaps', at: [[0.9, 0.1]] },
  }, { choices: { root: { n: [0.6, 0.8], d } } });

describe('fh1', () => {
  it('tells apart siblings that differ only in their choices', () => {
    const first = { ...axiomValley(0.4), id: 'x' };
    const second = { ...axiomValley(0.6), id: 'y' };
    const document = sequenceOf([step('a', null), first, second]);
    expect(foldNodeDigest(document, 'x')).not.toBe(foldNodeDigest(document, 'y'));
  });

  it('spells a rotation’s exact angle into its path, and a preset’s as it always was', () => {
    const rotate = (id: string, rotation: Extract<FoldStep['op'], { kind: 'rotate' }>['rotate']) =>
      step(id, 'a', { kind: 'rotate', rotate: rotation });
    const document = sequenceOf([
      step('a', null),
      rotate('thirty', { amount: 'degrees', degrees: 30, direction: 'cw' }),
      rotate('thirtyOne', { amount: 'degrees', degrees: 31, direction: 'cw' }),
      rotate('thirtyBack', { amount: 'degrees', degrees: 30, direction: 'ccw' }),
      rotate('eighth', { amount: 'eighth', direction: 'cw' }),
      rotate('quarter', { amount: 'quarter', direction: 'cw' }),
    ]);
    const digests = ['thirty', 'thirtyOne', 'thirtyBack', 'eighth', 'quarter'].map((id) => foldNodeDigest(document, id));
    expect(new Set(digests).size).toBe(5);
    // A preset is spelled as before exact angles: `{ amount, direction }`, so an old path keeps its `fh1`.
    const quarter = document.steps.find((node) => node.id === 'quarter') as FoldStep;
    expect(canonicalJson(writeFoldOp(quarter.op))).toBe('{"kind":"rotate","rotate":{"amount":"quarter","direction":"cw"}}');
  });

  it('gives siblings with the same op and choices one digest: the same path is the same state', () => {
    const document = sequenceOf([step('a', null), step('x', 'a'), step('y', 'a')]);
    expect(foldNodeDigest(document, 'x')).toBe(foldNodeDigest(document, 'y'));
  });

  it('tells apart sequences that differ only in their paper', () => {
    const steps = [step('a', null), step('b', 'a', valleyAt(0.25))];
    const papers: FoldPaper[] = [
      { shape: { kind: 'square' }, startSide: 'front' },
      { shape: { kind: 'square' }, startSide: 'back' },
      { shape: rectangleShape(1, Math.SQRT2)!, startSide: 'front' },
      { shape: rectangleShape(3, 4)!, startSide: 'front' },
    ];
    const digests = papers.map((paper) => foldNodeDigest(sequenceOf(steps, paper), 'b'));
    expect(new Set(digests).size).toBe(papers.length);
    const sheets = papers.map((paper) => foldPathDigest(paper, []));
    expect(new Set(sheets).size).toBe(papers.length);
  });

  it('depends on the whole path, not only the node', () => {
    const document = sequenceOf([
      step('a', null, valleyAt(0.5)),
      step('b', null, valleyAt(0.25)),
      step('x', 'a', valleyAt(0.75)),
      step('y', 'b', valleyAt(0.75)),
    ]);
    expect(foldNodeDigest(document, 'x')).not.toBe(foldNodeDigest(document, 'y'));
  });

  it('is unchanged by a note, marks, a spread or an expect', () => {
    const document = sequenceOf([step('a', null), step('b', 'a', valleyAt(0.25))]);
    const before = foldNodeDigest(document, 'b');
    const noted = setFoldStepNote(document, 'a', 'Fold in half.');
    const marked = setFoldMarks(noted, 'a', [
      { id: 'fmark-1', from: [0, 0], to: [1, 0], divide: { mode: 'count', parts: 4 } },
    ]);
    const sheetMarked = setFoldMarks(marked, null, [
      { id: 'fmark-2', from: [0, 0], to: [0, 1], divide: { mode: 'count', parts: 2 } },
    ]);
    const spread = setFoldStepSpread(
      setFoldStepSpread(sheetMarked, 'a', { kind: 'depth', amount: 0.05, toward: 'up' }),
      'b',
      'off'
    );
    const expected = {
      ...spread,
      steps: spread.steps.map((node) => ({ ...node, expect: 'fs1:0000000000000000' })),
    };
    expect(noted).not.toBe(document);
    expect(spread).not.toBe(sheetMarked);
    for (const edited of [noted, marked, sheetMarked, spread, expected]) expect(foldNodeDigest(edited, 'b')).toBe(before);
  });

  it('survives a write and a read', () => {
    const held = readFoldSequence(writtenSequence())!;
    const again = readFoldSequence(JSON.parse(JSON.stringify(writeFoldSequence(held))))!;
    for (const node of held.document.steps) {
      expect(foldNodeDigest(again.document, node.id)).toBe(foldNodeDigest(held.document, node.id));
    }
  });

  it('spells a locked node from the op and choices it came with, as the build that reads it does', () => {
    const known = axiomValley(0.4);
    const locked: FoldLockedStep = {
      id: known.id,
      parent: known.parent,
      unknown: { id: known.id, parent: known.parent, op: writeFoldOp(known.op), choices: known.choices, note: 'x' },
    };
    expect(foldStepKey(locked)).toBe(foldStepKey(known));
  });

  it('tells apart a whole precrease and its partial ones by every field of the extent', () => {
    const line = { via: 'free', through: [[0, 0.5], [1, 0.5]] } as const;
    const whole = step('x', 'a', { kind: 'precrease', line, direction: 'valley', moving: [0.5, 0.75], seed: { scope: 'all' } });
    const point = (at: readonly [number, number]) => ({ kind: 'point', at }) as const;
    const pinch = (at: readonly [number, number], length: number) =>
      ({ ...whole, op: { ...whole.op, extent: { kind: 'pinch', at: point(at), length } } }) as FoldStep;
    const segment = (from: readonly [number, number], to: readonly [number, number]) =>
      ({ ...whole, op: { ...whole.op, extent: { kind: 'segment', from: point(from), to: point(to) } } }) as FoldStep;
    const keys = [
      whole,
      pinch([0.5, 0.5], 0.0625),
      pinch([0.25, 0.5], 0.0625),
      pinch([0.5, 0.5], 0.125),
      segment([0.2, 0.5], [0.8, 0.5]),
      segment([0.8, 0.5], [0.2, 0.5]),
    ].map(foldStepKey);
    expect(new Set(keys).size).toBe(keys.length);
    // A whole precrease spells as it did before extents existed.
    expect(foldStepKey(whole)).not.toContain('extent');
    // A mark's id is the sentence's, and it rides along in `fh1` as an axiom's does.
    const marked = {
      ...whole,
      op: {
        ...whole.op,
        extent: { kind: 'pinch', at: { kind: 'mark', at: [0.5, 0.5], mark: 'fmark-1' }, length: 0.0625 },
      },
    } as FoldStep;
    expect(foldStepKey(marked)).not.toBe(foldStepKey(pinch([0.5, 0.5], 0.0625)));
  });

  it('tells apart crimps and tucks by every field they fold by, and by their stored order', () => {
    const line = { via: 'free', through: [[0, 0.5], [1, 0.5]] } as const;
    const second = { via: 'free', through: [[0, 0.3], [1, 0.3]] } as const;
    const crimp = step('x', 'a', { kind: 'crimp', line, second, crimp: 'inside', seed: { scope: 'all' } });
    const tuck = step('x', 'a', { kind: 'tuck', line, direction: 'valley', seed: { scope: 'all' }, target: [0.5, 0.75] });
    const order = (s: 1 | -1) => ({
      completion: {
        faces: [
          [0.1, 0.1],
          [0.9, 0.1],
        ] as const,
        orders: [[0, 1, s]] as const,
      },
    });
    const keys = [
      crimp,
      { ...crimp, op: { ...crimp.op, crimp: 'outside' } },
      { ...crimp, op: { ...crimp.op, second: line } },
      { ...crimp, choices: { opening: [{ upper: [[0.2, 0.2]] }] } },
      { ...crimp, choices: order(1) },
      { ...crimp, choices: order(-1) },
      tuck,
      { ...tuck, op: { ...tuck.op, direction: 'mountain' } },
      { ...tuck, op: { ...tuck.op, target: [0.5, 0.8] } },
      { ...tuck, choices: order(1) },
    ].map((node) => foldStepKey(node as FoldStep));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('spells a sink as a build that locks it does: the file as written, its choices the engine’s', () => {
    // A build older than the sinks reads each of these as locked, and spells
    // it from the raw node: the same `fh1`, so a link to it holds either way.
    const raw = writtenSequence().steps as Record<string, unknown>[];
    const sinks = raw.filter((node) => String((node.op as { kind: string }).kind).includes('sink'));
    expect(sinks.map((node) => (node.op as { kind: string }).kind)).toEqual(['open-sink', 'closed-sink', 'unsink']);
    const held = readFoldSequence(writtenSequence())!;
    for (const node of sinks) {
      const known = held.document.steps.find((s) => s.id === node.id)!;
      const locked: FoldLockedStep = { id: String(node.id), parent: String(node.parent), unknown: node };
      expect(foldStepKey(locked), String(node.id)).toBe(foldStepKey(known));
    }
    // The pocket and the completion are the path's: another of either is another state.
    const closed = held.document.steps.find((s) => s.id === 'fstep-19') as FoldStep;
    const otherPocket = { ...closed, choices: { ...closed.choices, pocket: [[0.15, 0.6], [0.15, 0.4]] as const } };
    expect(foldStepKey(otherPocket)).not.toBe(foldStepKey(closed));
  });

  it('is null for a node the document does not hold', () => {
    expect(foldNodeDigest(sequenceOf([step('a', null)]), 'missing')).toBeNull();
  });

  it('names its algorithm', () => {
    expect(foldPathDigest({ shape: { kind: 'square' }, startSide: 'front' }, [])).toMatch(/^fh1:[0-9a-f]{16}$/);
  });
});

describe('canonicalJson', () => {
  it('spells a value one way, whatever order its keys were made in', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: 0 } })).toBe(
      canonicalJson({ a: { c: 0, d: [1, { e: 3, f: 2 }] }, b: 1 })
    );
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('writes numbers in their shortest round-trip form, and -0 as 0', () => {
    expect(canonicalJson([0.1 + 0.2, 1 / 3, -0, 1e21, 5e-324])).toBe(
      '[0.30000000000000004,0.3333333333333333,0,1e+21,5e-324]'
    );
  });

  it('leaves out undefined fields, so an absent field and an undefined one are the same', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('spells empty choices as none', () => {
    const plain = step('a', null);
    expect(foldStepKey({ ...plain, choices: {} })).toBe(foldStepKey({ ...plain }));
    expect(foldStepKey({ ...plain, choices: { completion: { faces: [], orders: [] } } })).toBe(
      foldStepKey({ ...plain })
    );
    expect(foldStepKey({ ...plain, choices: { opening: [] } })).toBe(foldStepKey({ ...plain }));
  });
});

describe('fs1', () => {
  it('does not depend on the order the engine lists a state’s keys in', () => {
    expect(foldStateFingerprint({ keys: ['crease:a', 'order:b', 'view:c'] })).toBe(
      foldStateFingerprint({ keys: ['view:c', 'crease:a', 'order:b'] })
    );
    expect(foldStateFingerprint({ keys: ['crease:a'] })).not.toBe(foldStateFingerprint({ keys: ['crease:b'] }));
    expect(foldStateFingerprint({ keys: [] })).toMatch(/^fs1:[0-9a-f]{16}$/);
  });

  it('says whether an expect matches, differs, or cannot be judged', () => {
    const fingerprint = foldStateFingerprint({ keys: ['a'] });
    expect(foldDrift(fingerprint, fingerprint)).toBe('same');
    expect(foldDrift(foldStateFingerprint({ keys: ['b'] }), fingerprint)).toBe('changed');
    expect(foldDrift(undefined, fingerprint)).toBe('unknown');
    expect(foldDrift('fs2:0123456789abcdef', fingerprint)).toBe('unknown');
  });
});
