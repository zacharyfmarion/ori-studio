import { describe, expect, it } from 'vitest';

import { foldStateFingerprint } from './foldDigest';
import {
  createFoldReplayer,
  type FoldEngineOutcome,
  type FoldEnginePort,
  type FoldReplayProgress,
} from './foldReplay';
import type { FoldChoices, FoldLockedStep, FoldOp, FoldPaper, FoldSequenceDocument } from './foldSequenceDocument';
import { appendFoldStep } from './foldSequenceEdits';
import { sequenceOf, sequentialIds, step, valleyAt } from './foldSequence.fixtures';

/** A mock state: the labels of the steps that landed it, the sheet's first. */
interface Trail {
  trail: string[];
}

/** `valley@0.25` for a valley along the free line at 0.25; the kind otherwise. */
function labelOf(op: FoldOp): string {
  return (op.kind === 'valley' || op.kind === 'mountain') && op.line.via === 'free'
    ? `${op.kind}@${op.line.through[0][1]}`
    : op.kind;
}

const fingerprintOf = (trail: string[]) => foldStateFingerprint({ keys: trail.map((label, k) => `${k}:${label}`) });

interface MockPortOptions {
  /** A refusal code for a step, or null to land it. */
  refuse?: (op: FoldOp, choices: FoldChoices | undefined) => string | null;
  refuseSheet?: string;
  /** Hold every call until the test lets it go. */
  gated?: boolean;
}

function mockPort({ refuse, refuseSheet, gated = false }: MockPortOptions = {}) {
  const calls: string[] = [];
  const released: Trail[] = [];
  const gates: (() => void)[] = [];
  let failNext: Error | null = null;
  const port = {
    engineVersion: 1,
    async sheet(paper: FoldPaper): Promise<FoldEngineOutcome<Trail>> {
      calls.push('sheet');
      if (gated) await new Promise<void>((open) => gates.push(open));
      if (refuseSheet) return { landed: false, code: refuseSheet };
      const trail = [`sheet:${paper.shape.kind}:${paper.startSide}`];
      return { landed: true, state: { trail }, fingerprint: fingerprintOf(trail) };
    },
    async step(parent: Trail, { op, choices }: { op: FoldOp; choices?: FoldChoices }): Promise<FoldEngineOutcome<Trail>> {
      const label = labelOf(op);
      calls.push(label);
      if (gated) await new Promise<void>((open) => gates.push(open));
      if (failNext) {
        const error = failNext;
        failNext = null;
        throw error;
      }
      const code = refuse?.(op, choices) ?? null;
      if (code) return { landed: false, code };
      const trail = [...parent.trail, label];
      return { landed: true, state: { trail }, fingerprint: fingerprintOf(trail) };
    },
    release(state: Trail) {
      released.push(state);
    },
  } satisfies FoldEnginePort<Trail>;
  return {
    port,
    calls,
    released,
    /** Let every held call go, and let what follows settle. */
    open: async () => {
      for (let round = 0; round < 20; round += 1) {
        for (const gate of gates.splice(0)) gate();
        await new Promise((settle) => setTimeout(settle, 0));
      }
    },
    failNextStep: (error: Error) => {
      failNext = error;
    },
  };
}

/** A at the sheet; B and C under A (C the newer); D under B. */
function branching(): FoldSequenceDocument {
  return sequenceOf([
    step('a', null, valleyAt(0.5)),
    step('b', 'a', valleyAt(0.25)),
    step('c', 'a', valleyAt(0.75)),
    step('d', 'b', valleyAt(0.1)),
  ]);
}

const statuses = (progress: FoldReplayProgress<Trail> | null) =>
  Object.fromEntries([...(progress?.steps ?? [])].map(([id, replay]) => [id, replay.status]));

describe('createFoldReplayer', () => {
  it('replays the sheet, then the active path step by step, then the other branches', async () => {
    const { port, calls } = mockPort();
    const reports: FoldReplayProgress<Trail>[] = [];
    const done = await createFoldReplayer(port).run(
      { loadId: 1, sequence: branching(), activeChild: { a: 'b' } },
      (progress) => reports.push(progress)
    );
    expect(calls).toEqual(['sheet', 'valley@0.5', 'valley@0.25', 'valley@0.1', 'valley@0.75']);
    expect(reports.map((progress) => progress.done)).toEqual([false, false, false, false, false, true]);
    expect(statuses(reports[1])).toEqual({ a: 'ok', b: 'pending', c: 'pending', d: 'pending' });
    expect(statuses(done)).toEqual({ a: 'ok', b: 'ok', c: 'ok', d: 'ok' });
    expect(done?.steps.get('d')?.state?.trail).toEqual([
      'sheet:square:front',
      'valley@0.5',
      'valley@0.25',
      'valley@0.1',
    ]);
    expect(done).toMatchObject({ loadId: 1, sequenceId: 'fold-a', done: true, sheet: { status: 'ok' } });
  });

  it('takes the newest child where the reader chose none', async () => {
    const { port, calls } = mockPort();
    await createFoldReplayer(port).run({ loadId: 1, sequence: branching() });
    expect(calls).toEqual(['sheet', 'valley@0.5', 'valley@0.75', 'valley@0.25', 'valley@0.1']);
  });

  it('serves the same paths from the cache: no engine call, and one report', async () => {
    const { port, calls } = mockPort();
    const replayer = createFoldReplayer(port);
    const first = await replayer.run({ loadId: 1, sequence: branching() });
    calls.length = 0;
    const reports: FoldReplayProgress<Trail>[] = [];
    const again = await replayer.run({ loadId: 1, sequence: branching() }, (progress) => reports.push(progress));
    expect(calls).toEqual([]);
    expect(reports).toHaveLength(1);
    expect(again?.steps.get('d')?.state).toBe(first?.steps.get('d')?.state);
  });

  it('asks the engine only for the step a commit added', async () => {
    const { port, calls } = mockPort();
    const replayer = createFoldReplayer(port);
    const before = branching();
    await replayer.run({ loadId: 1, sequence: before });
    calls.length = 0;
    const committed = appendFoldStep(before, { parent: 'd', op: valleyAt(0.05) }, sequentialIds())!;
    const done = await replayer.run({ loadId: 1, sequence: committed.document });
    expect(calls).toEqual(['valley@0.05']);
    expect(done?.steps.get(committed.id)?.status).toBe('ok');
  });

  it('breaks a step whose inputs no longer resolve, and its subtree, and leaves its siblings alone', async () => {
    const { port, calls } = mockPort({ refuse: (op) => (labelOf(op) === 'valley@0.25' ? 'witness_not_in_face' : null) });
    const done = await createFoldReplayer(port).run({ loadId: 1, sequence: branching(), activeChild: { a: 'b' } });
    expect(statuses(done)).toEqual({ a: 'ok', b: 'broken', c: 'ok', d: 'broken' });
    expect(done?.steps.get('b')?.refusal).toEqual({ at: 'b', code: 'witness_not_in_face' });
    expect(done?.steps.get('d')?.refusal).toEqual({ at: 'b', code: 'witness_not_in_face' });
    expect(done?.steps.get('d')?.state).toBeNull();
    expect(calls).not.toContain('valley@0.1');
  });

  it('breaks a step whose stored choice conflicts, and marks one whose state drifted as changed', async () => {
    const conflicting: FoldChoices = {
      completion: {
        faces: [
          [0.2, 0.2],
          [0.8, 0.8],
        ],
        orders: [[0, 1, 1]],
      },
    };
    const { port } = mockPort({ refuse: (_op, choices) => (choices?.completion ? 'choice_conflict' : null) });
    const landedA = ['sheet:square:front', 'valley@0.5'];
    const sequence = sequenceOf([
      step('a', null, valleyAt(0.5), { expect: fingerprintOf(landedA) }),
      step('x', 'a', valleyAt(0.25), { choices: conflicting }),
      step('y', 'a', valleyAt(0.75), { expect: fingerprintOf(['something', 'else']) }),
      step('z', 'y', valleyAt(0.9), { expect: fingerprintOf([...landedA, 'valley@0.75', 'valley@0.9']) }),
      step('w', 'y', valleyAt(0.95), { expect: 'fs2:0123456789abcdef' }),
    ]);
    const done = await createFoldReplayer(port).run({ loadId: 1, sequence });
    expect(statuses(done)).toEqual({ a: 'ok', x: 'broken', y: 'changed', z: 'ok', w: 'ok' });
    expect(done?.steps.get('x')?.refusal).toEqual({ at: 'x', code: 'choice_conflict' });
    // A changed step still landed, and what folds from it replays on it.
    expect(done?.steps.get('y')?.state?.trail).toEqual([...landedA, 'valley@0.75']);
  });

  it('locks a step this build cannot read, and its subtree, and never asks the engine for either', async () => {
    const { port, calls } = mockPort({ refuse: (op) => (labelOf(op) === 'valley@0.25' ? 'near_miss' : null) });
    const locked = (id: string, parent: string): FoldLockedStep => ({
      id,
      parent,
      unknown: { id, parent, op: { kind: 'sink' } },
    });
    const sequence = sequenceOf([
      step('a', null, valleyAt(0.5)),
      locked('l', 'a'),
      step('m', 'l', valleyAt(0.75)),
      step('b', 'a', valleyAt(0.25)),
      locked('n', 'b'),
    ]);
    const reports: FoldReplayProgress<Trail>[] = [];
    const done = await createFoldReplayer(port).run({ loadId: 1, sequence }, (progress) => reports.push(progress));
    expect(statuses(done)).toEqual({ a: 'ok', l: 'locked', m: 'locked', b: 'broken', n: 'broken' });
    expect(calls).toEqual(['sheet', 'valley@0.5', 'valley@0.25']);
    // Locked is known before anything is replayed.
    expect(statuses(reports[0])).toEqual({ a: 'pending', l: 'locked', m: 'locked', b: 'pending', n: 'locked' });
  });

  it('breaks every step when the sheet does not land', async () => {
    const { port, calls } = mockPort({ refuseSheet: 'sheet_not_convex' });
    const done = await createFoldReplayer(port).run({ loadId: 1, sequence: branching() });
    expect(done?.sheet).toMatchObject({ status: 'broken', refusal: { at: null, code: 'sheet_not_convex' } });
    expect(statuses(done)).toEqual({ a: 'broken', b: 'broken', c: 'broken', d: 'broken' });
    expect(done?.steps.get('d')?.refusal).toEqual({ at: null, code: 'sheet_not_convex' });
    expect(calls).toEqual(['sheet']);
  });

  it('keeps a state another engine version made out of the cache', async () => {
    const { port, calls } = mockPort();
    const replayer = createFoldReplayer(port);
    await replayer.run({ loadId: 1, sequence: branching() });
    calls.length = 0;
    port.engineVersion = 2;
    await replayer.run({ loadId: 1, sequence: branching() });
    expect(calls).toHaveLength(5);
  });
});

describe('superseded runs', () => {
  it('lets the latest run win: an earlier one stops, reports nothing more, and shares its engine call', async () => {
    const mock = mockPort({ gated: true });
    const replayer = createFoldReplayer(mock.port);
    const earlier: FoldReplayProgress<Trail>[] = [];
    const first = replayer.run({ loadId: 1, sequence: branching() }, (progress) => earlier.push(progress));
    const second = replayer.run({ loadId: 1, sequence: branching() });
    await mock.open();
    expect(await first).toBeNull();
    expect(earlier).toEqual([]);
    expect(statuses(await second)).toEqual({ a: 'ok', b: 'ok', c: 'ok', d: 'ok' });
    // The sheet was asked once, by the first run, and the second waited on it.
    expect(mock.calls.filter((call) => call === 'sheet')).toHaveLength(1);
  });

  it('runs a load older than one already run: a failed open puts back the document it discarded', async () => {
    const { port, calls } = mockPort();
    const replayer = createFoldReplayer(port);
    await replayer.run({ loadId: 2, sequence: branching() });
    calls.length = 0;
    const done = await replayer.run({ loadId: 1, sequence: sequenceOf([step('z', null, valleyAt(0.3))]) });
    expect(done).toMatchObject({ loadId: 1, done: true });
    expect(done?.steps.get('z')?.status).toBe('ok');
    // The sheet came from the cache; only the new step was folded.
    expect(calls).toEqual(['valley@0.3']);
  });

  it('stops a run on cancel', async () => {
    const mock = mockPort({ gated: true });
    const replayer = createFoldReplayer(mock.port);
    const reports: FoldReplayProgress<Trail>[] = [];
    const run = replayer.run({ loadId: 1, sequence: branching() }, (progress) => reports.push(progress));
    replayer.cancel();
    await mock.open();
    expect(await run).toBeNull();
    expect(reports).toEqual([]);
  });

  it('rejects when the port fails, and asks again on the next run', async () => {
    const mock = mockPort();
    const replayer = createFoldReplayer(mock.port);
    mock.failNextStep(new Error('worker gone'));
    await expect(replayer.run({ loadId: 1, sequence: branching() })).rejects.toThrow('worker gone');
    const done = await replayer.run({ loadId: 1, sequence: branching() });
    expect(statuses(done)).toEqual({ a: 'ok', b: 'ok', c: 'ok', d: 'ok' });
  });
});

describe('the cache', () => {
  const squareOnly = () => sequenceOf([step('a', null, valleyAt(0.5))]);
  const backUp = () => sequenceOf([step('a', null, valleyAt(0.5))], { shape: { kind: 'square' }, startSide: 'back' });

  it('releases every state on clear, and asks again afterwards', async () => {
    const mock = mockPort();
    const replayer = createFoldReplayer(mock.port);
    await replayer.run({ loadId: 1, sequence: branching() });
    replayer.clear();
    expect(mock.released).toHaveLength(5);
    mock.calls.length = 0;
    await replayer.run({ loadId: 1, sequence: branching() });
    expect(mock.calls).toHaveLength(5);
  });

  it('trims beyond its capacity, but never the states of the newest run', async () => {
    const mock = mockPort();
    const replayer = createFoldReplayer(mock.port, { capacity: 0 });
    await replayer.run({ loadId: 1, sequence: squareOnly() });
    expect(mock.released).toEqual([]);
    await replayer.run({ loadId: 1, sequence: backUp() });
    expect(mock.released.map((state) => state.trail.join(' '))).toEqual([
      'sheet:square:front',
      'sheet:square:front valley@0.5',
    ]);
    mock.calls.length = 0;
    await replayer.run({ loadId: 1, sequence: backUp() });
    expect(mock.calls).toEqual([]);
  });

  it('keeps the states undo comes back to within its capacity', async () => {
    const mock = mockPort();
    const replayer = createFoldReplayer(mock.port, { capacity: 8 });
    await replayer.run({ loadId: 1, sequence: squareOnly() });
    await replayer.run({ loadId: 1, sequence: backUp() });
    mock.calls.length = 0;
    await replayer.run({ loadId: 1, sequence: squareOnly() });
    expect(mock.calls).toEqual([]);
    expect(mock.released).toEqual([]);
  });
});
