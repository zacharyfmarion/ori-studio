import { normalizeFoldLandingOp } from './foldLandingMigration';
import { describe, expect, it } from 'vitest';
import { isLockedStep, type FoldStep } from './foldSequenceDocument';
import { readFoldSequence, writeFoldSequence } from './foldSequenceFile';

/**
 * A fold's moving side as the file reads it (`Motion` in the bridge's
 * `wire.rs`, the truth): `moving` is stored only when neither the line nor
 * the seed says the side. An axiom that carries a point says it — the tools
 * store no `moving` for one (`foldStepBuilder`) — and a depth or flaps seed
 * says it; a free line or a crease through every layer says nothing.
 */

/** O3, the bottom edge onto the diagonal: the kite base's first fold, as the tools store it. */
const KITE_AXIOM = {
  via: 'axiom',
  axiom: 3,
  inputs: [
    { kind: 'edge', a: [0, 0], b: [1, 0] },
    { kind: 'edge', a: [0, 0], b: [1, 1] },
  ],
};
const CORNER_TO_CORNER = {
  via: 'axiom',
  axiom: 2,
  inputs: [
    { kind: 'point', at: [1, 0] },
    { kind: 'point', at: [0, 1] },
  ],
};
const FREE = { via: 'free', through: [[0, 0.5], [1, 0.5]] };
const ALL = { scope: 'all' };

function readOne(op: Record<string, unknown>) {
  const raw = { formatVersion: 1, id: 'fold-a', title: '', steps: [{ id: 'a', parent: null, op }] };
  const held = readFoldSequence(JSON.parse(JSON.stringify(raw)));
  const node = held?.document.steps[0];
  if (!held || !node) throw new Error('no step');
  return { held, node };
}

describe('a fold’s moving side in the file', () => {
  it('reads a fold along an axiom through every layer with no moving point — the axiom says the side — and writes it back as it came', () => {
    const ops = [
      { kind: 'valley', line: KITE_AXIOM, seed: ALL },
      { kind: 'precrease', line: CORNER_TO_CORNER, direction: 'mountain', seed: ALL },
      { kind: 'inside-reverse', line: CORNER_TO_CORNER, seed: ALL },
      { kind: 'crimp', line: CORNER_TO_CORNER, second: FREE, crimp: 'inside', seed: ALL },
      { kind: 'closed-sink', line: KITE_AXIOM, seed: ALL },
    ];
    for (const op of ops) {
      const { held, node } = readOne(op);
      expect(isLockedStep(node), op.kind).toBe(false);
      expect((node as FoldStep).op, op.kind).not.toHaveProperty('moving');
      expect((writeFoldSequence(held).steps as { op: unknown }[])[0]!.op, op.kind).toEqual(
        JSON.parse(JSON.stringify(normalizeFoldLandingOp(op)))
      );
    }
  });

  it('locks a fold through every layer with no moving point whose line says no side: a free line, a crease', () => {
    const ops = [
      { kind: 'valley', line: FREE, seed: ALL },
      { kind: 'inside-reverse', line: { via: 'crease', at: [0.5, 0.5] }, seed: ALL },
      { kind: 'unfold', crease: [0.5, 0.5], direction: 'valley', seed: ALL },
      { kind: 'refold', crease: [0.5, 0.5], direction: 'valley', seed: ALL },
    ];
    for (const op of ops) expect(isLockedStep(readOne(op).node), op.kind).toBe(true);
  });
});
