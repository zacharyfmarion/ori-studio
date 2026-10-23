import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { hasNewerKey } from '../../lib/documentFile';
import { foldNodeDigest, foldStepKey } from './foldDigest';
import { sequenceOf, step } from './foldSequence.fixtures';
import {
  FOLD_OP_KINDS,
  FOLD_VERTEX_OP_KINDS,
  isLockedStep,
  isSwivelEdgeOp,
  isVertexOp,
  petalHinge,
  petalOp,
  type FoldLockedStep,
  type FoldPetalCreaseOp,
  type FoldPetalEndsOp,
  type FoldRabbitEarOp,
  type FoldSquashOp,
  type FoldStep,
  isSwivelOnFoldOp,
  type FoldSwivelEdgeOp,
  type FoldSwivelFreeOp,
  type FoldSwivelOnFoldOp,
  type FoldSwivelOp,
  swivelKindOf,
  withSwivelKind,
} from './foldSequenceDocument';
import { readBackFoldStep, readFoldSequence, writeFoldOp, writeFoldSequence } from './foldSequenceFile';

/**
 * The vertex folds' ops in the document (plan Phase 11, D6): sheet points
 * and the directions their choices stored, read and written exactly; an
 * absent optional direction is none; anything that does not read locks the
 * node, as a newer build's op does; and `fh1` tells every field apart.
 */

const squash: FoldSquashOp = { kind: 'squash', flap: [0.1, 0.4], direction: 'valley' };

const ear: FoldRabbitEarOp = {
  kind: 'rabbit-ear',
  corners: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  emergent: [-1, 0],
  seed: { scope: 'all' },
  stayer: [0.6, 0.35],
  direction: 'valley',
};

/** The steps a file of these raw ops reads as, each folding from the one before. */
function readOps(ops: unknown[]) {
  const steps = ops.map((op, k) => ({ id: `s${k}`, parent: k === 0 ? null : `s${k - 1}`, op }));
  const held = readFoldSequence({ formatVersion: 1, id: 'fold-a', title: '', steps });
  if (!held) throw new Error('expected a sequence');
  return held;
}

describe('the vertex folds’ ops', () => {
  it('are op kinds of this build', () => {
    for (const kind of FOLD_VERTEX_OP_KINDS) expect(FOLD_OP_KINDS).toContain(kind);
    expect(isVertexOp(squash)).toBe(true);
    expect(isVertexOp({ kind: 'turn', axis: 'vertical' })).toBe(false);
  });

  it('read and write back exactly, with and without their optional directions', () => {
    const ops = [
      squash,
      { ...squash, target: [-1, 0.5] },
      // About a drawn hinge, located as a fold's line is: a crease, a free line, an axiom with its root.
      { ...squash, hinge: { line: { via: 'crease', at: [0.3, 0.3] } } },
      { ...squash, target: [-1, 0.5], hinge: { line: { via: 'free', through: [[0, 0.6], [0.6, 0]] } } },
      {
        ...squash,
        hinge: {
          line: { via: 'axiom', axiom: 2, inputs: [{ kind: 'point', at: [0, 0] }, { kind: 'point', at: [0.6, 0.6] }] },
          root: { n: [0.7071067811865476, 0.7071067811865476], d: 0.4242640687119285 },
        },
      },
      { kind: 'petal', crease: [0.3, 0.2], petal: [0.25, 0.1], direction: 'mountain' },
      ear,
      { ...ear, ridge: [0, -1], seed: { scope: 'flaps', at: [[0.2, 0.1]] } },
      {
        kind: 'swivel',
        vertex: [0.5, 0.3],
        toward: [
          [1, 0.6],
          [0, 0.6],
          [0.5, 0],
        ],
        emergent: [0, 1],
        seed: { scope: 'depth', at: [0.5, 0.3], layers: 2 },
        stayer: [0.3, 0.9],
        direction: 'valley',
      },
    ];
    const held = readOps(ops);
    expect(held.document.steps.map(isLockedStep)).toEqual(ops.map(() => false));
    const written = writeFoldSequence(held).steps as { op: unknown }[];
    expect(written.map((node) => node.op)).toEqual(ops);
  });

  it('lock a node whose op does not read, or that a newer build extended', () => {
    const malformed = [
      { ...squash, flap: [0.1] },
      { ...squash, direction: 'sideways' },
      // A target with no direction.
      { ...squash, target: [0, 0] },
      { ...squash, target: [Number.NaN, 1] },
      // A drawn hinge that does not read, or an axiom's with no root.
      { ...squash, hinge: { line: { via: 'sideways' } } },
      { ...squash, hinge: { line: { via: 'axiom', axiom: 2, inputs: [{ kind: 'point', at: [0, 0] }, { kind: 'point', at: [1, 1] }] } } },
      { kind: 'petal', crease: [0.3, 0.2], direction: 'valley' },
      { ...ear, corners: [[0, 0], [1, 0]] },
      { ...ear, seed: { scope: 'depth', at: [0.2, 0.1], layers: 0 } },
      { ...ear, emergent: 'left' },
      { ...ear, ridge: null },
      { ...ear, stayer: undefined },
      // A key this build does not know.
      { ...ear, layers: 2 },
      { ...squash, pleat: true },
    ];
    for (const op of malformed) {
      const held = readOps([op]);
      expect(isLockedStep(held.document.steps[0]), JSON.stringify(op)).toBe(true);
      // Written back as it came.
      expect((writeFoldSequence(held).steps as { op: unknown }[])[0]?.op).toBe(op);
    }
  });

  it('give fh1 every field: a target, an emergent ray or a ridge is another path', () => {
    const key = (node: FoldStep) => foldStepKey(node);
    const keys = [
      key(step('x', null, squash)),
      key(step('x', null, { ...squash, target: [-1, 0.5] })),
      key(step('x', null, { ...squash, direction: 'mountain' })),
      key(step('x', null, ear)),
      key(step('x', null, { ...ear, emergent: [0, -1] })),
      key(step('x', null, { ...ear, ridge: [-1, 0] })),
      key(
        step('x', null, ear, {
          choices: {
            completion: {
              faces: [
                [0.2, 0.2],
                [0.6, 0.2],
              ],
              orders: [[0, 1, 1]],
            },
          },
        })
      ),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    // The written op is what fh1 spells: no key for an absent direction.
    expect(Object.keys(writeFoldOp(squash))).toEqual(['kind', 'flap', 'direction']);
    expect(sequenceOf([step('a', null, ear)]).steps).toHaveLength(1);
  });
});

/**
 * A petal fold's H, named by its precrease (`crease`, every step before
 * `ends` existed) or by its two ends (`ends`, creased by the fold): one of
 * the two. The crease form reads and writes exactly as it always did; the
 * ends form round-trips; anything else locks the node; `fh1` tells the two
 * forms, and every end, apart; and a build before `ends`, which locks a step
 * using it, spells it under the same `fh1`.
 */
describe('a petal fold’s H', () => {
  const byCrease: FoldPetalCreaseOp = { kind: 'petal', crease: [0.3, 0.2], petal: [0.25, 0.1], direction: 'valley' };
  const byEnds: FoldPetalEndsOp = {
    kind: 'petal',
    ends: [
      [0.2, 0.5],
      [0.5, 0.2],
    ],
    petal: [0.25, 0.1],
    direction: 'valley',
  };

  it('is one shape whichever form names it, and writes back the form it came in', () => {
    expect(petalHinge(byCrease)).toEqual({ kind: 'crease', at: [0.3, 0.2] });
    expect(petalHinge(byEnds)).toEqual({ kind: 'points', from: [0.2, 0.5], to: [0.5, 0.2] });
    for (const op of [byCrease, byEnds]) {
      expect(petalOp(petalHinge(op), op.petal, op.direction)).toEqual(op);
      expect(readBackFoldStep(op)?.op).toEqual(op);
    }
    // Written in a fixed order, H's key where the crease form has always had it.
    expect(Object.keys(writeFoldOp(byCrease))).toEqual(['kind', 'crease', 'petal', 'direction']);
    expect(Object.keys(writeFoldOp(byEnds))).toEqual(['kind', 'ends', 'petal', 'direction']);
  });

  it('reads a saved step byte for byte: the bird-base example’s petal folds, H by its ends, come back exactly as saved', () => {
    const file = JSON.parse(
      readFileSync(resolve(process.cwd(), '../../tests/fixtures/fold-examples/petal-fold.osf'), 'utf8')
    ) as { workspace: { foldSequences: unknown[] } };
    const [raw] = file.workspace.foldSequences;
    const held = readFoldSequence(raw);
    if (!held) throw new Error('no sequence');
    const petals = held.document.steps.filter((node) => !isLockedStep(node) && node.op.kind === 'petal');
    expect(petals).toHaveLength(2);
    for (const node of petals) {
      if (isLockedStep(node) || node.op.kind !== 'petal') continue;
      expect(petalHinge(node.op).kind).toBe('points');
    }
    expect(readFoldSequence(writeFoldSequence(held))?.document).toEqual(held.document);
  });

  it('locks a node whose H is named both ways, neither way, or by ends that do not read', () => {
    const malformed = [
      { ...byEnds, crease: [0.3, 0.2] },
      { kind: 'petal', petal: [0.25, 0.1], direction: 'valley' },
      { ...byEnds, ends: [[0.2, 0.5]] },
      { ...byEnds, ends: [[0.2, 0.5], [0.5, 0.2], [0.4, 0.4]] },
      { ...byEnds, ends: [[0.2, 0.5], [0.5, Number.NaN]] },
      { ...byEnds, ends: { from: [0.2, 0.5], to: [0.5, 0.2] } },
      { ...byEnds, ends: null },
      { ...byCrease, crease: null },
      // A key this build does not know: an even newer form of H.
      { ...byEnds, through: [[0.2, 0.5], [0.5, 0.2]] },
    ];
    for (const op of malformed) {
      const held = readFoldSequence({ formatVersion: 1, id: 'fold-a', title: '', steps: [{ id: 's0', parent: null, op }] });
      if (!held) throw new Error('expected a sequence');
      expect(isLockedStep(held.document.steps[0]), JSON.stringify(op)).toBe(true);
      expect((writeFoldSequence(held).steps as { op: unknown }[])[0]?.op).toBe(op);
    }
  });

  it('gives fh1 its form and its ends, and a build that locks the ends form spells it the same', () => {
    const key = (op: FoldPetalCreaseOp | FoldPetalEndsOp) => foldStepKey(step('x', null, op));
    const keys = [
      key(byCrease),
      key(byEnds),
      key({ ...byEnds, ends: [byEnds.ends[1], byEnds.ends[0]] }),
      key({ ...byEnds, ends: [[0.2, 0.5], [0.5, 0.25]] }),
      key({ ...byEnds, direction: 'mountain' }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    // A build before `ends` has no such key for a petal op, so it reads the
    // step as locked — never as a petal fold over a precrease it does not
    // name — and spells it from the raw node: the same fh1, so a link to it
    // holds in either build.
    const raw = { id: 'x', parent: null, op: writeFoldOp(byEnds) };
    const locked: FoldLockedStep = { id: 'x', parent: null, unknown: raw };
    expect(foldStepKey(locked)).toBe(key(byEnds));
    const path = sequenceOf([step('a', null, byCrease), step('b', 'a', byEnds)]);
    const other = sequenceOf([step('a', null, byCrease), step('b', 'a', { ...byEnds, ends: [[0.2, 0.5], [0.5, 0.25]] })]);
    expect(foldNodeDigest(path, 'b')).not.toBe(foldNodeDigest(other, 'b'));
    expect(foldNodeDigest(path, 'a')).toBe(foldNodeDigest(other, 'a'));
  });
});

/**
 * The swivel's edge form (`via: 'edge'`, engine `compound::swivel`) beside
 * its rays form: read and written exactly, its target a crease's point or
 * two points and its ridge only when taken; anything that does not read
 * locks the node; an older build, which knows only the rays form's keys,
 * locks it too rather than fold it; and the rays form is spelled as it was.
 */
describe('the swivel’s edge form', () => {
  const rays: FoldSwivelOp = {
    kind: 'swivel',
    vertex: [0.5, 0.3],
    toward: [
      [1, 0.6],
      [0, 0.6],
      [0.5, 0],
    ],
    emergent: [0, 1],
    seed: { scope: 'all' },
    stayer: [0.3, 0.9],
    direction: 'valley',
  };
  const edge: FoldSwivelFreeOp = {
    kind: 'swivel',
    via: 'edge',
    pivot: [0.8, 0.33],
    edge: [0.5, 0],
    target: { via: 'crease', at: [0.5, 0.5] },
    seed: { scope: 'all' },
    direction: 'valley',
  };

  it('is a vertex op, and the one swivel form with a `via`', () => {
    expect(isVertexOp(edge)).toBe(true);
    expect(isSwivelEdgeOp(edge)).toBe(true);
    expect(isSwivelEdgeOp(rays)).toBe(false);
    expect(isSwivelEdgeOp(squash)).toBe(false);
  });

  it('reads and writes back exactly, its target a crease or two points, its ridge only when taken', () => {
    const ops = [
      edge,
      { ...edge, ridge: [0.6, -0.8] },
      {
        ...edge,
        target: {
          via: 'free',
          through: [
            [0.2, 0.2],
            [0.9, 0.9],
          ],
        },
        seed: { scope: 'depth', at: [0.7, 0.2], layers: 1 },
        direction: 'mountain',
      },
      rays,
    ];
    const held = readOps(ops);
    expect(held.document.steps.map(isLockedStep)).toEqual(ops.map(() => false));
    const written = writeFoldSequence(held).steps as { op: unknown }[];
    expect(written.map((node) => node.op)).toEqual(ops);
    expect(Object.keys(writeFoldOp(edge))).toEqual(['kind', 'via', 'pivot', 'edge', 'target', 'seed', 'direction']);
  });

  it('locks a node whose edge form does not read, and writes it back as it came', () => {
    const malformed = [
      { ...edge, via: 'rays' },
      { ...edge, pivot: undefined },
      { ...edge, edge: [0.5] },
      // A target an axiom names would need a root the step does not store.
      {
        ...edge,
        target: {
          via: 'axiom',
          axiom: 1,
          inputs: [
            { kind: 'point', at: [0, 0] },
            { kind: 'point', at: [1, 1] },
          ],
        },
      },
      { ...edge, target: { via: 'model', line: { n: [1, -1], d: 0 } } },
      { ...edge, ridge: [0, 0] },
      { ...edge, ridge: null },
      { ...edge, seed: { scope: 'depth', at: [0.7, 0.2], layers: 0 } },
      { ...edge, direction: 'sideways' },
      // The rays form's fields beside the edge form's: keys this form does not know.
      { ...edge, vertex: [0.5, 0.3] },
      { ...edge, emergent: [0, 1] },
    ];
    for (const op of malformed) {
      const held = readOps([op]);
      expect(isLockedStep(held.document.steps[0]), JSON.stringify(op)).toBe(true);
      expect((writeFoldSequence(held).steps as { op: unknown }[])[0]?.op).toBe(op);
    }
  });

  it('locks in an older build: `via` is a key the rays form never had', () => {
    // An older build's reader (`readOp`) locks an op with a key its kind's
    // set lacks; its swivel's set was the rays form's.
    const older = new Set(['kind', 'vertex', 'toward', 'emergent', 'seed', 'stayer', 'direction']);
    expect(hasNewerKey(writeFoldOp(edge), older)).toBe(true);
    expect(hasNewerKey(writeFoldOp({ ...edge, ridge: [0, -1] }), older)).toBe(true);
    expect(hasNewerKey(writeFoldOp(rays), older)).toBe(false);
  });

  it('spells the rays form as it always was, and gives fh1 every field of the edge form', () => {
    expect(JSON.stringify(writeFoldOp(rays))).toBe(
      '{"kind":"swivel","vertex":[0.5,0.3],"toward":[[1,0.6],[0,0.6],[0.5,0]],"emergent":[0,1],' +
        '"seed":{"scope":"all"},"stayer":[0.3,0.9],"direction":"valley"}'
    );
    const key = (op: FoldSwivelOp | FoldSwivelEdgeOp) => foldStepKey(step('x', null, op));
    const keys = [
      key(rays),
      key(edge),
      key({ ...edge, ridge: [0.6, -0.8] }),
      key({ ...edge, pivot: [0.8, 0.34] }),
      key({ ...edge, edge: [0.4, 0] }),
      key({ ...edge, target: { via: 'crease', at: [0.4, 0.4] } }),
      key({ ...edge, direction: 'mountain' }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * The swivel on a folded edge (`fold`, engine `compound::swivel_on_edge`):
 * the edge form with the folded edge its creases meet on in place of its
 * pivot, and no seed or ridge. Read and written exactly; a `fold` beside a
 * pivot, a seed or a ridge does not read and locks the node; an older build,
 * whose edge form always had a pivot, locks it rather than fold it; old
 * steps are spelled as before; and `fh1` tells every field apart.
 */
describe('the swivel on a folded edge', () => {
  const free: FoldSwivelFreeOp = {
    kind: 'swivel',
    via: 'edge',
    pivot: [0.8, 0.33],
    edge: [0.5, 0],
    target: { via: 'crease', at: [0.5, 0.5] },
    seed: { scope: 'all' },
    direction: 'valley',
  };
  const onFold: FoldSwivelOnFoldOp = {
    kind: 'swivel',
    via: 'edge',
    fold: [0.75, 0.6035533905932737],
    edge: [1, 0.8535533905932737],
    target: { via: 'crease', at: [0.75, 0.5] },
    direction: 'valley',
  };

  it('is a swivel by its edge, and the one with a fold', () => {
    expect(isVertexOp(onFold)).toBe(true);
    expect(isSwivelEdgeOp(onFold)).toBe(true);
    expect(isSwivelOnFoldOp(onFold)).toBe(true);
    expect(isSwivelOnFoldOp(free)).toBe(false);
    expect(isSwivelOnFoldOp(squash)).toBe(false);
  });

  it('reads and writes back exactly, its fold where the free form has its pivot', () => {
    const ops = [
      onFold,
      {
        ...onFold,
        target: {
          via: 'free',
          through: [
            [0.5, 0.5],
            [1, 1],
          ],
        },
        direction: 'mountain',
      },
      free,
    ];
    const held = readOps(ops);
    expect(held.document.steps.map(isLockedStep)).toEqual(ops.map(() => false));
    const written = writeFoldSequence(held).steps as { op: unknown }[];
    expect(written.map((node) => node.op)).toEqual(ops);
    expect(Object.keys(writeFoldOp(onFold))).toEqual(['kind', 'via', 'fold', 'edge', 'target', 'direction']);
    expect(readBackFoldStep(onFold)?.op).toEqual(onFold);
  });

  it('locks a node whose fold does not read, or stands beside a pivot, a seed or a ridge', () => {
    const malformed = [
      { ...onFold, fold: [0.75] },
      { ...onFold, fold: null },
      { ...onFold, pivot: [0.8, 0.33] },
      { ...onFold, seed: { scope: 'all' } },
      { ...onFold, ridge: [0, -1] },
      { ...onFold, via: 'fold' },
      { ...onFold, target: { via: 'model', line: { n: [1, 0], d: 0 } } },
    ];
    for (const op of malformed) {
      const held = readOps([op]);
      expect(isLockedStep(held.document.steps[0]), JSON.stringify(op)).toBe(true);
      expect((writeFoldSequence(held).steps as { op: unknown }[])[0]?.op).toBe(op);
    }
  });

  it('locks in an older build: `fold` is a key its edge form never had', () => {
    const older = new Set(['kind', 'via', 'pivot', 'edge', 'target', 'seed', 'direction', 'ridge']);
    expect(hasNewerKey(writeFoldOp(onFold), older)).toBe(true);
    expect(hasNewerKey(writeFoldOp(free), older)).toBe(false);
  });

  it('spells the free form as it always was, and gives fh1 every field of the fold form', () => {
    expect(JSON.stringify(writeFoldOp(free))).toBe(
      '{"kind":"swivel","via":"edge","pivot":[0.8,0.33],"edge":[0.5,0],' +
        '"target":{"via":"crease","at":[0.5,0.5]},"seed":{"scope":"all"},"direction":"valley"}'
    );
    const key = (op: FoldSwivelEdgeOp) => foldStepKey(step('x', null, op));
    const keys = [
      key(free),
      key(onFold),
      key({ ...onFold, fold: [0.75, 0.6] }),
      key({ ...onFold, edge: [1, 0.9] }),
      key({ ...onFold, target: { via: 'crease', at: [0.7, 0.5] } }),
      key({ ...onFold, direction: 'mountain' }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * The inside swivel (`swivel: 'inside'`, engine `SwivelKind::Inside`): a
 * swivel on a folded edge with its strip tucked between the two layers.
 * Spelled only when inside, last, so every open swivel reads and writes as
 * it always did; any other value, or one beside a pivot, does not read and
 * locks the node; an older build locks it rather than fold it open; and
 * `fh1` tells the two kinds apart.
 */
describe('the inside swivel', () => {
  const open: FoldSwivelOnFoldOp = {
    kind: 'swivel',
    via: 'edge',
    fold: [0.75, 0.6035533905932737],
    edge: [1, 0.8535533905932737],
    target: { via: 'crease', at: [0.75, 0.5] },
    direction: 'valley',
  };
  const inside: FoldSwivelOnFoldOp = { ...open, swivel: 'inside' };

  it('is a swivel on a folded edge of the inside kind, and the open one is spelled as before', () => {
    expect(isSwivelOnFoldOp(inside)).toBe(true);
    expect(swivelKindOf(inside)).toBe('inside');
    expect(swivelKindOf(open)).toBe('open');
    expect(withSwivelKind(open, 'inside')).toEqual(inside);
    expect(withSwivelKind(inside, 'open')).toEqual(open);
    expect('swivel' in withSwivelKind(inside, 'open')).toBe(false);
    expect(JSON.stringify(writeFoldOp(open))).toBe(
      '{"kind":"swivel","via":"edge","fold":[0.75,0.6035533905932737],"edge":[1,0.8535533905932737],' +
        '"target":{"via":"crease","at":[0.75,0.5]},"direction":"valley"}'
    );
  });

  it('reads and writes back exactly, its kind last', () => {
    const ops = [inside, open, { ...inside, direction: 'mountain' }];
    const held = readOps(ops);
    expect(held.document.steps.map(isLockedStep)).toEqual(ops.map(() => false));
    const written = writeFoldSequence(held).steps as { op: unknown }[];
    expect(written.map((node) => node.op)).toEqual(ops);
    expect(Object.keys(writeFoldOp(inside))).toEqual(['kind', 'via', 'fold', 'edge', 'target', 'direction', 'swivel']);
    expect(readBackFoldStep(inside)?.op).toEqual(inside);
  });

  it('locks a node whose kind does not read, or stands beside a pivot', () => {
    const free = {
      kind: 'swivel',
      via: 'edge',
      pivot: [0.8, 0.33],
      edge: [0.5, 0],
      target: { via: 'crease', at: [0.5, 0.5] },
      seed: { scope: 'all' },
      direction: 'valley',
    };
    const malformed = [
      { ...open, swivel: 'open' },
      { ...open, swivel: 'closed' },
      { ...open, swivel: null },
      { ...free, swivel: 'inside' },
      { ...free, swivel: 'open' },
    ];
    for (const op of malformed) {
      const held = readOps([op]);
      expect(isLockedStep(held.document.steps[0]), JSON.stringify(op)).toBe(true);
      expect((writeFoldSequence(held).steps as { op: unknown }[])[0]?.op).toBe(op);
    }
  });

  it('locks in an older build: `swivel` is a key its folded-edge form never had', () => {
    const older = new Set(['kind', 'via', 'pivot', 'fold', 'edge', 'target', 'seed', 'direction', 'ridge']);
    expect(hasNewerKey(writeFoldOp(inside), older)).toBe(true);
    expect(hasNewerKey(writeFoldOp(open), older)).toBe(false);
  });

  it('gives fh1 its kind: the inside swivel is another path', () => {
    const key = (op: FoldSwivelEdgeOp) => foldStepKey(step('x', null, op));
    expect(key(inside)).not.toBe(key(open));
    expect(key({ ...inside, direction: 'mountain' })).not.toBe(key(inside));
    expect(key(withSwivelKind(inside, 'open'))).toBe(key(open));
  });
});
