import { normalizeFoldLandingOp } from './foldLandingMigration';
import { describe, expect, it } from 'vitest';

import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { FOLD_DEFAULT_PAPER_STYLE, isLockedStep, type FoldStep, type FoldStepNode } from './foldSequenceDocument';
import {
  readFoldSequence,
  readFoldSequences,
  writeFoldSequence,
  writeFoldSequences,
  type HeldFoldSequence,
} from './foldSequenceFile';
import { sequentialIds, writtenSequence } from './foldSequence.fixtures';
import { foldStepTree, lockedIds } from './foldStepTree';

const valleyOp = {
  kind: 'valley',
  line: { via: 'free', through: [[0, 0.5], [1, 0.5]] },
  moving: [0.5, 0.75],
  seed: { scope: 'all' },
};

/** A raw node folding a valley from `parent`. */
const raw = (id: unknown, parent: unknown, extra: Record<string, unknown> = {}) => ({ id, parent, op: valleyOp, ...extra });

/** The sequence a file of these raw steps reads as. */
function readSteps(steps: unknown[], extra: Record<string, unknown> = {}): HeldFoldSequence {
  const held = readFoldSequence({ formatVersion: 1, id: 'fold-a', title: '', steps, ...extra }, { newId: sequentialIds() });
  if (!held) throw new Error('expected a sequence');
  return held;
}

const ids = (steps: readonly FoldStepNode[]) => steps.map((node) => node.id);

describe('readFoldSequence and writeFoldSequence', () => {
  it('migrates the landing spelling while preserving every other field', () => {
    const value = writtenSequence();
    const held = readFoldSequence(JSON.parse(JSON.stringify(value)));
    expect(held?.readOnlyRaw).toBeNull();
    expect(held?.document.steps.every((node) => !isLockedStep(node))).toBe(true);
    const migrated = {
      ...value,
      formatVersion: 2,
      steps: (value.steps as { op: unknown }[]).map((node) => ({ ...node, op: normalizeFoldLandingOp(node.op) })),
    };
    expect(JSON.parse(JSON.stringify(writeFoldSequence(held!)))).toEqual(JSON.parse(JSON.stringify(migrated)));
  });

  it('reads a sequence’s paper style, draws one with none in the Diagram style, and carries a newer one back', () => {
    // None: the default, written explicitly so a later default never changes it.
    const none = readSteps([]);
    expect(none.document.style).toEqual(FOLD_DEFAULT_PAPER_STYLE);
    expect(writeFoldSequence(none).style).toEqual(FOLD_DEFAULT_PAPER_STYLE);
    // A built-in by id only (as a hand-written file may say it): its values.
    const byId = readSteps([], { style: { preset: 'default' } });
    expect(byId.document.style).toEqual({ preset: 'default', style: builtInPaperPreset('default').style });
    expect(writeFoldSequence(byId).style).toEqual(byId.document.style);
    // A resolved style, as the Paper tab stores a Settings one: kept as it is.
    const red = { ...DEFAULT_PAPER_STYLE, paper: { front: '#ff0000', back: '#ffffff' } };
    const resolved = readSteps([], { style: { style: red } });
    expect(resolved.document.style).toEqual({ style: red });
    expect(writeFoldSequence(resolved).style).toEqual({ style: red });
    // A newer build's style: drawn as this build reads it, written back as it came.
    const newer = { style: { ...red, glitter: 1 }, finish: 'satin' };
    const carried = readSteps([], { style: newer });
    expect(carried.document.style).toEqual({ style: red });
    expect(writeFoldSequence(carried).style).toEqual(newer);
    // Damaged: the default.
    expect(readSteps([], { style: 'blue' }).document.style).toEqual(FOLD_DEFAULT_PAPER_STYLE);
  });

  it('reads what it writes', () => {
    const held = readFoldSequence(writtenSequence())!;
    const again = readFoldSequence(JSON.parse(JSON.stringify(writeFoldSequence(held))))!;
    expect(again.document).toEqual(held.document);
  });

  it('is no sequence for a value that is not a record', () => {
    for (const value of [undefined, null, 3, 'fold', [writtenSequence()]]) {
      expect(readFoldSequence(value), String(value)).toBeNull();
    }
  });

  it('gives a sequence with no id a new one, and passes its title through xmlText', () => {
    const held = readFoldSequence({ formatVersion: 1, title: 'A\u000bB', steps: [] }, { newId: sequentialIds() })!;
    expect(held.document.id).toBe('fold-1');
    expect(held.document.title).toBe('AB');
  });
});

describe('the step tree', () => {
  it('drops a node with a malformed id or parent, and its subtree', () => {
    const { document } = readSteps([
      raw('a', null),
      raw(7, null),
      raw('', null),
      raw('b', 'a'),
      raw('c', 5),
      raw('d', ''),
      raw('e', undefined),
      raw('c-child', 'c'),
      raw('d-child', 'd'),
      raw('b-child', 'b'),
    ]);
    expect(ids(document.steps)).toEqual(['a', 'b', 'b-child']);
  });

  it('keeps a node with an unknown op kind verbatim, locked, and writes it back unchanged', () => {
    const newer = { id: 'b', parent: 'a', op: { kind: 'stretch', axis: [0, 1] }, note: 'Stretch it.' };
    const held = readSteps([raw('a', null), newer, raw('c', 'b')]);
    const locked = held.document.steps[1];
    expect(isLockedStep(locked)).toBe(true);
    expect(locked).toMatchObject({ id: 'b', parent: 'a', note: 'Stretch it.' });
    expect((writeFoldSequence(held).steps as unknown[])[1]).toBe(newer);
    // Its child still reads, and is locked with it.
    expect(ids(held.document.steps)).toEqual(['a', 'b', 'c']);
    expect([...lockedIds(foldStepTree(held.document.steps))].sort()).toEqual(['b', 'c']);
  });

  it('keeps a node whose op does not read locked, rather than dropping its subtree', () => {
    const malformed = [
      { ...valleyOp, moving: undefined },
      { ...valleyOp, seed: { scope: 'depth', at: [0.5, 0.75], layers: 0 } },
      // More layers than the engine's 32-bit usize holds.
      { ...valleyOp, seed: { scope: 'depth', at: [0.5, 0.75], layers: 2 ** 32 } },
      { ...valleyOp, seed: { scope: 'depth', at: [0.5, 0.75], layers: 1e20 } },
      { ...valleyOp, seed: { scope: 'flaps', at: [] } },
      { ...valleyOp, line: { via: 'free', through: [[0, 0.5]] } },
      { ...valleyOp, line: { via: 'axiom', axiom: 4, inputs: [{ kind: 'point', at: [0, 0] }] } },
      {
        ...valleyOp,
        line: { via: 'axiom', axiom: 4, inputs: [{ kind: 'point', at: [0, 0] }, { kind: 'point', at: [1, 1] }] },
      },
      { ...valleyOp, line: { via: 'axiom', axiom: 8, inputs: [] } },
      { ...valleyOp, moving: [0.5, Number.NaN] },
      { ...valleyOp, extent: { kind: 'pinches' } },
      { kind: 'precrease', line: valleyOp.line, moving: [0.5, 0.75], seed: { scope: 'all' } },
      { kind: 'turn', axis: 'diagonal' },
      { kind: 'rotate', rotate: { amount: 'third', direction: 'cw' } },
      { kind: 'cp-jump', cpJson: '{}', orderJson: '[]', origin: 'my-file.cp' },
      // A crimp's second line has no root to replay with, and its kind is one of two.
      { ...valleyOp, kind: 'crimp', second: valleyOp.line, crimp: 'sideways' },
      { ...valleyOp, kind: 'crimp', crimp: 'inside' },
      {
        ...valleyOp,
        kind: 'crimp',
        second: { via: 'axiom', axiom: 1, inputs: [{ kind: 'point', at: [0, 0] }, { kind: 'point', at: [1, 1] }] },
        crimp: 'inside',
      },
      { ...valleyOp, kind: 'crimp', second: valleyOp.line, crimp: 'inside', direction: 'valley' },
      { ...valleyOp, kind: 'tuck', direction: 'valley' },
      { ...valleyOp, kind: 'tuck', direction: 'sideways', target: [0.5, 0.5] },
      { ...valleyOp, kind: 'tuck', direction: 'valley', target: [0.5, Number.NaN] },
      { ...valleyOp, kind: 'tuck', direction: 'valley', target: [0.5, 0.5], placement: 'under' },
      // A sink through every layer names its side; it has no direction.
      { kind: 'open-sink', line: valleyOp.line, seed: { scope: 'all' } },
      { kind: 'closed-sink', line: valleyOp.line, moving: [0.5, 0.75], seed: { scope: 'all' }, direction: 'valley' },
      { kind: 'unsink', line: { via: 'crease' }, seed: { scope: 'flaps', at: [[0.5, 0.75]] } },
      'valley',
      null,
    ];
    for (const op of malformed) {
      const { document } = readSteps([raw('a', null, { op }), raw('b', 'a')]);
      expect(ids(document.steps), JSON.stringify(op)).toEqual(['a', 'b']);
      expect(isLockedStep(document.steps[0]), JSON.stringify(op)).toBe(true);
    }
  });

  it('reads a precrease’s extent, a segment or a pinch, and writes it back only when present', () => {
    const precrease = { kind: 'precrease', line: valleyOp.line, direction: 'valley', moving: [0.5, 0.75], seed: { scope: 'all' } };
    const pinch = { kind: 'pinch', at: { kind: 'point', at: [0.5, 0.5] }, length: 0.0625 };
    const segment = {
      kind: 'segment',
      from: { kind: 'mark', at: [0.25, 0.5], mark: 'fmark-1' },
      to: { kind: 'point', at: [0.75, 0.5] },
    };
    const { document } = readSteps([
      raw('whole', null, { op: precrease }),
      raw('pinch', null, { op: { ...precrease, extent: pinch } }),
      raw('segment', null, { op: { ...precrease, extent: segment } }),
    ]);
    const [whole, pinched, segmented] = document.steps as FoldStep[];
    expect(document.steps.map(isLockedStep)).toEqual([false, false, false]);
    expect(whole!.op).toEqual(precrease);
    expect(pinched!.op).toEqual({ ...precrease, extent: pinch });
    expect(segmented!.op).toEqual({ ...precrease, extent: segment });
    // A whole precrease writes no `extent` key; a partial one writes it last.
    const written = writeFoldSequence({ document, readOnlyRaw: null }).steps as { op: Record<string, unknown> }[];
    expect(Object.keys(written[0]!.op)).toEqual(['kind', 'line', 'direction', 'moving', 'seed']);
    expect(Object.keys(written[1]!.op)).toEqual(['kind', 'line', 'direction', 'moving', 'seed', 'extent']);
    expect(written[2]!.op.extent).toEqual(segment);
  });

  it('locks a precrease whose extent does not read, rather than folding the whole line', () => {
    const precrease = { kind: 'precrease', line: valleyOp.line, direction: 'valley', moving: [0.5, 0.75], seed: { scope: 'all' } };
    const point = { kind: 'point', at: [0.5, 0.5] };
    const extents = [
      // A kind or a key a newer build may write.
      { kind: 'arc', at: point, length: 0.1 },
      { kind: 'pinch', at: point, length: 0.1, align: 'start' },
      { kind: 'segment', from: point, to: point, through: point },
      // Damage: no length, or one that is no positive number.
      { kind: 'pinch', at: point },
      { kind: 'pinch', at: point, length: 0 },
      { kind: 'pinch', at: point, length: -0.1 },
      { kind: 'pinch', at: point, length: '0.1' },
      { kind: 'pinch', at: point, length: Number.NaN },
      // A point that is no point input: a bare point, an edge, a mark without its id.
      { kind: 'pinch', at: [0.5, 0.5], length: 0.1 },
      { kind: 'segment', from: { kind: 'edge', a: [0, 0], b: [1, 0] }, to: point },
      { kind: 'segment', from: { kind: 'mark', at: [0.5, 0.5], mark: '' }, to: point },
      { kind: 'segment', from: point },
      'pinch',
      null,
    ];
    for (const extent of extents) {
      const op = { ...precrease, extent };
      const held = readSteps([raw('a', null, { op }), raw('b', 'a')]);
      expect(isLockedStep(held.document.steps[0]!), JSON.stringify(extent)).toBe(true);
      expect([...lockedIds(foldStepTree(held.document.steps))].sort(), JSON.stringify(extent)).toEqual(['a', 'b']);
      // Written back as it came.
      expect((writeFoldSequence(held).steps as { op: unknown }[])[0]!.op).toEqual(op);
    }
  });

  it('reads and writes a rotation by an exact angle, its degrees between, and a preset as it always was', () => {
    const exact = { kind: 'rotate', rotate: { amount: 'degrees', degrees: 30, direction: 'cw' } };
    const preset = { kind: 'rotate', rotate: { amount: 'eighth', direction: 'ccw' } };
    const held = readSteps([raw('a', null, { op: exact }), raw('b', 'a', { op: preset })]);
    expect(held.document.steps.map((node) => node.op)).toEqual([
      { kind: 'rotate', rotate: { amount: 'degrees', degrees: 30, direction: 'cw' } },
      { kind: 'rotate', rotate: { amount: 'eighth', direction: 'ccw' } },
    ]);
    const written = writeFoldSequence(held).steps as { op: unknown }[];
    expect(JSON.stringify(written[0]!.op)).toBe('{"kind":"rotate","rotate":{"amount":"degrees","degrees":30,"direction":"cw"}}');
    expect(JSON.stringify(written[1]!.op)).toBe('{"kind":"rotate","rotate":{"amount":"eighth","direction":"ccw"}}');
  });

  it('locks a rotation it cannot read as one, and one a build without exact angles could not: never another amount', () => {
    for (const rotate of [
      // Not as this build writes an exact angle: no number, no turn, past a half turn, a preset's own angle.
      { amount: 'degrees', direction: 'cw' },
      { amount: 'degrees', degrees: 0, direction: 'cw' },
      { amount: 'degrees', degrees: -30, direction: 'cw' },
      { amount: 'degrees', degrees: 270, direction: 'cw' },
      { amount: 'degrees', degrees: 90, direction: 'cw' },
      // Degrees beside a preset, and a key newer than this build.
      { amount: 'quarter', degrees: 30, direction: 'cw' },
      { amount: 'degrees', degrees: 30, direction: 'cw', about: [0.5, 0.5] },
    ]) {
      const held = readSteps([raw('a', null, { op: { kind: 'rotate', rotate } }), raw('b', 'a')]);
      expect(isLockedStep(held.document.steps[0]!), JSON.stringify(rotate)).toBe(true);
      expect([...lockedIds(foldStepTree(held.document.steps))].sort()).toEqual(['a', 'b']);
      expect((writeFoldSequence(held).steps as { op: unknown }[])[0]!.op).toEqual({ kind: 'rotate', rotate });
    }
    // A build that predates exact angles read a rotation's keys as `amount` and
    // `direction`, and locked any other: an exact angle's `degrees` locks its
    // step there, as a key newer than this build locks one here.
    const written = writeFoldSequence(readSteps([raw('a', null, { op: { kind: 'rotate', rotate: { amount: 'degrees', degrees: 30, direction: 'cw' } } })]));
    const rotate = (written.steps as { op: { rotate: Record<string, unknown> } }[])[0]!.op.rotate;
    expect(Object.keys(rotate).filter((key) => key !== 'amount' && key !== 'direction')).toEqual(['degrees']);
    expect(['eighth', 'quarter', 'half']).not.toContain(rotate.amount);
  });

  it('locks a precrease with a key it does not know: the rule that makes a build without extents lock one', () => {
    // A build that predates `extent` knew a precrease's keys to be the line's,
    // `moving`, the seed's and `direction`, and locked any other: an extent it
    // cannot read never folds as the whole line there. This build applies the
    // same rule to a key newer than it.
    const op = {
      kind: 'precrease',
      line: valleyOp.line,
      direction: 'valley',
      moving: [0.5, 0.75],
      seed: { scope: 'all' },
      reach: { kind: 'pinch' },
    };
    const held = readSteps([raw('a', null, { op })]);
    expect(isLockedStep(held.document.steps[0]!)).toBe(true);
  });

  it('reads every seed and root the engine can take, up to its limits', () => {
    const { document } = readSteps([
      raw('a', null, { op: { ...valleyOp, seed: { scope: 'depth', at: [0.5, 0.75], layers: 2 ** 32 - 1 } } }),
      // A short normal the engine normalises.
      raw('b', 'a', { choices: { root: { n: [1e-6, 0], d: 0 } } }),
    ]);
    expect(document.steps.map(isLockedStep)).toEqual([false, false]);
  });

  it('locks a node with choices that do not read, or a key it does not know', () => {
    const cases = [
      { choices: { root: { n: [0, 0], d: 1 } } },
      // A normal the engine's line cannot be made from: shorter than its tolerance.
      { choices: { root: { n: [1e-200, 0], d: 1 } } },
      { choices: { root: { n: [5e-7, 5e-7], d: 0 } } },
      // A completion is FOLD triples over its witnesses: a sign of 1 or -1, whole indices.
      // (A triple naming a witness that is not there, or a face against
      // itself, reads: it is the engine's to call broken on replay.)
      { choices: { completion: [{ above: [0, 0], below: [1, 1] }] } },
      { choices: { completion: { faces: [[0, 0]], orders: [[0, 1, 0]] } } },
      { choices: { completion: { faces: [[0, 0]], orders: [[0.5, 1, 1]] } } },
      { choices: { completion: { faces: [[0, 0]], orders: [[0, 1, 1]], pinned: true } } },
      { choices: { completion: { faces: [[0, 0], [1, 1]], orders: [[0, 1]] } } },
      { choices: { completion: { faces: [], orders: [], pairs: [] } } },
      { choices: { completion: { faces: [[0, 0]], orders: [[0, -1, 1]] } } },
      { choices: { completion: { faces: [[0, 0]], orders: [], pinned: true } } },
      { choices: { pocket: [[0, 0]] } },
      { choices: { rootIndex: 2 } },
      { choices: 'first' },
      { pinned: true },
    ];
    for (const extra of cases) {
      const { document } = readSteps([raw('a', null, extra)]);
      expect(isLockedStep(document.steps[0]), JSON.stringify(extra)).toBe(true);
    }
  });

  it('keeps the first of two nodes with one id, and hangs the later one’s children on it', () => {
    const { document } = readSteps([
      raw('a', null, { note: 'first' }),
      raw('a', null, { note: 'second' }),
      raw('b', 'a'),
    ]);
    expect(ids(document.steps)).toEqual(['a', 'b']);
    expect((document.steps[0] as FoldStep).note).toBe('first');
    expect(document.steps[1].parent).toBe('a');
  });

  it('drops orphans and cycles, with everything that folds from them, and keeps the file’s order', () => {
    const { document } = readSteps([
      raw('child-first', 'root'),
      raw('orphan', 'missing'),
      raw('orphan-child', 'orphan'),
      raw('loop-a', 'loop-b'),
      raw('loop-b', 'loop-a'),
      raw('loop-child', 'loop-a'),
      raw('self', 'self'),
      raw('root', null),
    ]);
    expect(ids(document.steps)).toEqual(['child-first', 'root']);
  });
});

describe('versions and newer builds', () => {
  it('opens a sequence with a newer formatVersion read-only, and writes its raw value back', () => {
    const value = { ...writtenSequence(), formatVersion: 3, steps: [{ id: 'x', parent: null, op: { kind: 'sink' } }] };
    const held = readFoldSequence(value)!;
    expect(held.readOnlyRaw).toBe(value);
    expect(writeFoldSequence(held)).toBe(value);
  });

  it('opens each sequence read-only on its own', () => {
    const newer = { ...writtenSequence(), id: 'fold-newer', formatVersion: 3 };
    const [first, second] = readFoldSequences([newer, writtenSequence()]);
    expect(first.readOnlyRaw).toBe(newer);
    expect(second.readOnlyRaw).toBeNull();
  });

  it('opens a sequence read-only when a newer build wrote its paper', () => {
    const papers = [
      { shape: { kind: 'star', points: 5 }, startSide: 'front' },
      { shape: { kind: 'square', rounded: true }, startSide: 'front' },
      { shape: { kind: 'square' }, startSide: 'front', thickness: 0.1 },
      { shape: { kind: 'square' }, startSide: 'edge' },
      {
        shape: { kind: 'polygon', points: Array.from({ length: 12 }, (_, k) => [Math.cos(k), Math.sin(k)]) },
        startSide: 'front',
      },
    ];
    for (const paper of papers) {
      const value = { formatVersion: 1, id: 'fold-a', title: '', paper, steps: [] };
      const held = readFoldSequence(value)!;
      expect(held.readOnlyRaw, JSON.stringify(paper)).toBe(value);
    }
  });

  it('reads a damaged paper as the square, front up, and keeps the sequence editable', () => {
    for (const paper of [7, { shape: 'square' }, { shape: { kind: 'rectangle', aspect: [0, 1] } }, { startSide: 3 }]) {
      const held = readFoldSequence({ formatVersion: 1, id: 'fold-a', title: '', paper, steps: [] })!;
      expect(held.readOnlyRaw, JSON.stringify(paper)).toBeNull();
      expect(held.document.paper, JSON.stringify(paper)).toEqual({ shape: { kind: 'square' }, startSide: 'front' });
    }
  });

  it('normalises a rectangle to longer side 1', () => {
    const held = readFoldSequence({
      formatVersion: 1,
      id: 'fold-a',
      paper: { shape: { kind: 'rectangle', aspect: [3, 4] }, startSide: 'front' },
      steps: [],
    })!;
    expect(held.document.paper.shape).toEqual({ kind: 'rectangle', aspect: [0.75, 1] });
  });

  it('carries unknown sequence-level keys verbatim, after its own, and stays editable', () => {
    const bookmarks = { list: ['fstep-1'] };
    const value = { ...writtenSequence(), bookmarks, zoom: 2 };
    const held = readFoldSequence(value)!;
    expect(held.readOnlyRaw).toBeNull();
    expect(held.document.carried).toEqual({ bookmarks, zoom: 2 });
    const written = writeFoldSequence(held);
    expect(written.bookmarks).toBe(bookmarks);
    expect(Object.keys(written).slice(-3)).toEqual(['steps', 'bookmarks', 'zoom']);
  });
});

describe('marks, notes, spreads and expect', () => {
  it('drops a malformed mark, carries a newer build’s, and writes the carried one back unchanged', () => {
    const kept = { id: 'm-ok', from: [0, 0], to: [1, 0], divide: { mode: 'count', parts: 2 } };
    const newerMode = { id: 'm-mode', from: [0, 0], to: [1, 0], divide: { mode: 'golden' } };
    const newerParts = { id: 'm-parts', from: [0, 0], to: [1, 0], divide: { mode: 'count', parts: 64 } };
    const newerKey = { ...kept, id: 'm-key', color: 'red' };
    const marks = [
      kept,
      newerMode,
      newerParts,
      newerKey,
      { id: 'm-short', from: [0, 0], to: [1, 0], divide: { mode: 'count', parts: 1 } },
      { id: 'm-ratio', from: [0, 0], to: [1, 0], divide: { mode: 'ratio', ratio: { a: 0, b: 0, c: 0, d: 1, e: 0, f: 0 } } },
      { id: 'm-point', from: [0], to: [1, 0], divide: { mode: 'count', parts: 2 } },
    ];
    const held = readSteps([raw('a', null, { marks })]);
    const node = held.document.steps[0] as FoldStep;
    expect(node.marks?.map((mark) => mark.id)).toEqual(['m-ok', 'm-mode', 'm-parts', 'm-key']);
    const written = (writeFoldSequence(held).steps as Record<string, unknown>[])[0].marks as unknown[];
    expect(written[1]).toBe(newerMode);
    expect(written[2]).toBe(newerParts);
    expect(written[3]).toBe(newerKey);
  });

  it('drops an expect or a note that is not a string, and passes a note through xmlText', () => {
    const { document } = readSteps([raw('a', null, { expect: 3, note: ['x'] }), raw('b', null, { note: 'a\u0000b' })]);
    expect(document.steps[0]).not.toHaveProperty('expect');
    expect(document.steps[0]).not.toHaveProperty('note');
    expect((document.steps[1] as FoldStep).note).toBe('ab');
  });

  it('reads a step’s spread or off, carries a newer build’s, drops a damaged one, and never locks the step', () => {
    const affine = { kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 };
    const newerKind = { kind: 'curve', amount: 0.1 };
    const newerKey = { ...affine, bend: 2 };
    const { document } = readSteps([
      raw('a', null, { spread: affine }),
      raw('b', 'a', { spread: 'off' }),
      raw('c', 'b', { spread: newerKind }),
      raw('d', 'c', { spread: newerKey }),
      raw('e', 'd', { spread: 'auto' }),
      raw('f', 'e', { spread: { ...affine, amount: -1 } }),
      raw('g', 'f', { spread: 3 }),
    ]);
    expect(document.steps.every((node) => !isLockedStep(node))).toBe(true);
    const spreads = document.steps.map((node) => (node as FoldStep).spread);
    expect(spreads).toEqual([affine, 'off', { unknown: newerKind }, { unknown: newerKey }, { unknown: 'auto' }, undefined, undefined]);
    const written = writeFoldSequence({ document, readOnlyRaw: null }).steps as Record<string, unknown>[];
    expect(written.map((node) => node.spread)).toEqual([affine, 'off', newerKind, newerKey, 'auto', undefined, undefined]);
    expect(written[2]!.spread).toBe(newerKind);
    // Written only when set, after every other field.
    expect(Object.keys(written[0]!).at(-1)).toBe('spread');
    expect(written[5]).not.toHaveProperty('spread');
  });

  it('reads empty choices as none', () => {
    const { document } = readSteps([
      raw('a', null, { choices: { completion: { faces: [], orders: [] }, opening: [] } }),
      raw('b', null, { choices: {} }),
    ]);
    expect(document.steps[0]).not.toHaveProperty('choices');
    expect(document.steps[1]).not.toHaveProperty('choices');
  });
});

describe('readFoldSequences and writeFoldSequences', () => {
  it('writes no key for no sequences, so the file stays byte-identical', () => {
    expect(writeFoldSequences([])).toBeNull();
    const project = { workspace: { foldSequences: writeFoldSequences([]) ?? undefined } };
    expect(JSON.stringify(project)).toBe(JSON.stringify({ workspace: {} }));
  });

  it('is no sequences for a value that is not an array, and skips entries that are not records', () => {
    for (const value of [undefined, null, {}, 'fold']) expect(readFoldSequences(value)).toEqual([]);
    expect(readFoldSequences([3, null, writtenSequence()]).map((held) => held.document.id)).toEqual(['fold-full']);
  });

  it('gives a later sequence with an id already read a new one, and keeps its steps', () => {
    const [first, second] = readFoldSequences([writtenSequence(), writtenSequence()], { newId: sequentialIds() });
    expect(first.document.id).toBe('fold-full');
    expect(second.document.id).toBe('fold-1');
    expect(second.document.steps).toHaveLength(first.document.steps.length);
  });

  it('writes every sequence in order', () => {
    const sequences = readFoldSequences([writtenSequence(), { ...writtenSequence(), id: 'fold-other' }]);
    expect(writeFoldSequences(sequences)?.map((value) => value.id)).toEqual(['fold-full', 'fold-other']);
  });
});


describe('tucks with several stationary targets', () => {
  const op = { ...valleyOp, kind: 'tuck', direction: 'valley', target: [0.2, 0.6] };
  it('migrates every target witness, including legacy single-target steps', () => {
    for (const tuck of [op, { ...op, additionalTargets: [[0.8, 0.6], [0.5, 0.7]] }]) {
      const node = raw('tuck', null, { op: tuck });
      const held = readSteps([node]);
      expect(isLockedStep(held.document.steps[0])).toBe(false);
      expect((writeFoldSequence(held).steps as unknown[])[0]).toEqual({ ...node, op: normalizeFoldLandingOp(tuck) });
    }
  });
  it('preserves and locks damaged or future target constraints rather than dropping them', () => {
    for (const extra of [
      { additionalTargets: 'all' }, { additionalTargets: [[0, Number.NaN]] },
      { additionalTargets: [[0]] }, { additionalTargets: Array.from({ length: 65 }, () => [0, 0]) },
      { targetRelation: 'between' },
    ]) {
      const node = raw('tuck', null, { op: { ...op, ...extra } });
      const held = readSteps([node]);
      expect(isLockedStep(held.document.steps[0])).toBe(true);
      expect((writeFoldSequence(held).steps as unknown[])[0]).toBe(node);
    }
  });
});


describe('a swivel by its valley and mountain', () => {
  const valley = { line: { via:'axiom', axiom:1, inputs:[{kind:'point',at:[0.5,0.5]},{kind:'point',at:[0.1,0.8]}] }, root:{n:[0.6,0.8],d:0.7} };
  const mountain = { line:{via:'crease',at:[0.05,0.1]} };
  const op = { kind:'swivel', via:'valley-mountain', valley, mountain, swivel:'inside' };
  it('preserves both lines and each chosen root through save and open, and stores no direction', () => {
    const held=readSteps([raw('a',null,{op, note:'The dragon’s step 35'})]);
    expect(isLockedStep(held.document.steps[0]!)).toBe(false);
    const written = (writeFoldSequence(held).steps as {op:Record<string, unknown>}[])[0]!.op;
    expect(written).toEqual(op);
    expect(written).not.toHaveProperty('direction');
    expect(readFoldSequence(writeFoldSequence(held))!.document).toEqual(held.document);
    // Open spells no kind.
    const { swivel: _inside, ...open } = op;
    const openHeld = readSteps([raw('a',null,{op:open})]);
    expect((writeFoldSequence(openHeld).steps as {op:unknown}[])[0]!.op).toEqual(open);
  });
  it('locks incomplete roots, extra fields, a direction and the two located hinges it replaced', () => {
    for(const bad of [
      {...op,valley:{line:valley.line}},
      {...op,mountain:{...mountain,root:valley.root}},
      {...op,valley:{...valley,other:true}},
      {...op,direction:'valley'},
      {...op,swivel:'outside'},
      {...op,fold:[0.5,0.5]},
      // The construction it replaced, which no saved file holds: a form this build does not know, locked.
      { kind:'swivel', via:'lines', first:valley, second:mountain, direction:'mountain' },
      { kind:'swivel', via:'creases', fold:[0.5,0.5], first:[0.05,0.1], second:[0.1,0.8], direction:'mountain' },
    ]) {
      const held = readSteps([raw('a',null,{op:bad})]);
      expect(isLockedStep(held.document.steps[0]!)).toBe(true);
      expect((writeFoldSequence(held).steps as {op:unknown}[])[0]!.op).toEqual(bad);
    }
  });
});
